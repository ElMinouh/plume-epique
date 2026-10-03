// Worker Cloudflare de synchronisation multi-appareils — Plume (v8.1.0)
//
// Rôle : stocker/renvoyer des blobs opaques (déjà chiffrés côté client) par
// clé, pour que plusieurs appareils partagent le même profil et les mêmes
// manuscrits. Ce Worker ne déchiffre jamais rien et ne voit jamais de
// contenu en clair — il se contente de faire lire/écrire une base KV.
//
// ═══════════════════════════════════════════════════════════════════════
// v8.1.0 — NUMÉRO DE VERSION ET REFUS DES ÉCRITURES PÉRIMÉES
//
// Incident du 27/07/2026 : tous les profils sauf un ont disparu sur tous
// les appareils à la fois. Cause racine : la synchronisation n'avait AUCUNE
// notion de « plus récent ». Elle ne savait comparer que « identique » ou
// « différent ». Face à deux versions différentes d'une même donnée, elle
// était donc incapable de choisir la bonne — et prenait systématiquement la
// dernière arrivée, même si celle-ci était plus ANCIENNE. Concrètement, un
// appareil resté en arrière (non ouvert depuis la création de nouveaux
// profils) écrasait la version à jour dès sa connexion suivante, effaçant
// les profils pour tout le monde.
//
// Correctif : chaque clé porte désormais un numéro de version croissant,
// stocké dans les métadonnées KV. Toute écriture doit annoncer la version
// sur laquelle elle se base (en-tête X-Plume-Base-Version). Si ce numéro ne
// correspond pas à la version réellement stockée, c'est que l'appareil n'a
// pas connaissance de la dernière version : l'écriture est REFUSÉE (409) au
// lieu d'écraser. L'appareil relit alors la version à jour et repart de
// celle-ci. Un appareil en retard ne peut donc plus jamais écraser une
// version plus récente — c'est le serveur qui arbitre, plus « le dernier
// qui parle ».
//
// Limite résiduelle assumée : KV est un stockage à cohérence différée (une
// écriture met jusqu'à ~60 s à se propager entre régions du monde). Deux
// appareils écrivant depuis deux continents dans la même minute peuvent
// donc encore, en théorie, voir ce contrôle prendre une décision sur une
// lecture périmée. Ce cas ne correspond à aucun usage réel ici (un seul
// foyer, écritures espacées), et le garde-fou côté client — l'index des
// profils ne peut jamais rétrécir, voir mergeProfilesIndex() dans
// router.js — le neutralise de toute façon pour la donnée critique. Si une
// certitude absolue devenait nécessaire, il faudrait passer KV à D1 ou à un
// Durable Object (cohérence forte), au prix d'une migration.
// ═══════════════════════════════════════════════════════════════════════
//
// ─────────────────────────────────────────────────────────────────────────
// DÉPLOIEMENT (à faire une seule fois, dans le dashboard Cloudflare) :
//   1. Workers & Pages → Create → Create Worker. Collez ce fichier comme code.
//   2. Storage & Databases → KV → créez un namespace (ex. "plume-sync").
//   3. Dans les paramètres de CE Worker → Bindings → ajoutez ce namespace KV
//      sous le nom exact "PLUME_SYNC" (obligatoire, c'est ce nom que le code
//      utilise ci-dessous).
//   4. Dans les paramètres de CE Worker → Variables and Secrets → ajoutez un
//      secret nommé "SYNC_KEY" : c'est VOUS qui choisissez sa valeur (une
//      phrase longue et unique, ex. générée par un gestionnaire de mots de
//      passe). C'est LA clé à taper une fois sur chaque appareil.
//   5. Notez l'URL du Worker (ex. https://plume-epique-sync.VOTRE-SOUS-DOMAINE.workers.dev)
//      et reportez-la à 2 endroits dans le projet principal :
//        - js/router.js, constante SYNC_WORKER_URL
//        - _headers, dans connect-src
// ─────────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════
// v9.20.0 (audit AUD-01-010) — DURCISSEMENT DU WORKER
//   • comparaison de la clé à temps constant ;
//   • freinage des essais de clé ratés (429 après AUTH_FAIL_MAX échecs par
//     adresse sur AUTH_FAIL_WINDOW_MS) — compteur propre à chaque instance du
//     Worker, donc un frein de bon sens et non une garantie absolue (une règle
//     Cloudflare « Rate Limiting » sur le dashboard le complète) ;
//   • seules les clés que l'application utilise réellement sont acceptées ;
//   • taille de corps plafonnée (413) ;
//   • une erreur KV qui n'est pas un quota n'est plus déguisée en « quota ».
// ═══════════════════════════════════════════════════════
const AUTH_FAIL_WINDOW_MS = 60000;
const AUTH_FAIL_MAX = 10;
const _authFails = new Map(); // adresse -> { count, since }
// 20 Mio : sous la limite de 25 Mio d'une valeur KV (le manuscrit chiffré est du texte).
const MAX_BODY_BYTES = 20 * 1024 * 1024;
const ID = '[A-Za-z0-9_-]{1,80}';
const KEY_PATTERN = new RegExp(
  '^(profiles|main|__ping__' +
  '|(doclist|data|libsettings)_' + ID +
  '|(doc|aichat)_' + ID + '_' + ID + ')$'
);

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}
function isRateLimited(ip, now) {
  const rec = _authFails.get(ip);
  if (!rec) return false;
  if (now - rec.since > AUTH_FAIL_WINDOW_MS) { _authFails.delete(ip); return false; }
  return rec.count >= AUTH_FAIL_MAX;
}
function noteAuthFailure(ip, now) {
  if (_authFails.size > 500) _authFails.clear(); // borne mémoire
  const rec = _authFails.get(ip);
  if (!rec || now - rec.since > AUTH_FAIL_WINDOW_MS) _authFails.set(ip, { count: 1, since: now });
  else rec.count++;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = url.searchParams.get('key');

    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Plume-Base-Version',
      // Sans ceci, le navigateur cache la réponse mais REFUSE au JavaScript
      // de lire nos en-têtes de version (règle CORS) : le client croirait
      // alors toujours être en version 0 et le contrôle ne servirait à rien.
      'Access-Control-Expose-Headers': 'X-Plume-Version'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    // Authentification : une seule clé partagée pour tout le foyer/compte,
    // choisie par vous à l'étape 4 ci-dessus — jamais le mot de passe d'un
    // profil individuel.
    const ip = request.headers.get('CF-Connecting-IP') || 'inconnue';
    const now = Date.now();
    if (isRateLimited(ip, now)) {
      return new Response(JSON.stringify({ error: { message: 'Trop d\'essais invalides. Réessayez plus tard.' } }), {
        status: 429, headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': '60' }
      });
    }
    const auth = request.headers.get('Authorization') || '';
    const providedKey = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!env.SYNC_KEY || !providedKey || !timingSafeEqual(providedKey, env.SYNC_KEY)) {
      noteAuthFailure(ip, now);
      return new Response(JSON.stringify({ error: { message: 'Clé de synchronisation invalide.' } }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
    _authFails.delete(ip);

    if (!key) {
      return new Response(JSON.stringify({ error: { message: 'Paramètre "key" manquant.' } }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
    if (key.length > 200 || !KEY_PATTERN.test(key)) {
      return new Response(JSON.stringify({ error: { message: 'Format de clé non autorisé.' } }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    // Clé technique réservée, utilisée uniquement par le bouton "Vérifier"
    // de l'app (ne lit ni n'écrit rien de réel — sert juste à confirmer que
    // la clé fournie est acceptée).
    if (key === '__ping__') {
      return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // Version actuellement stockée pour cette clé. Les données écrites avant
    // la v8.1.0 n'ont pas de métadonnée : elles valent la version 0, et la
    // toute première écriture versionnée les fera passer à 1 (aucune
    // migration nécessaire, aucune donnée existante touchée).
    async function readCurrent() {
      const res = await env.PLUME_SYNC.getWithMetadata(key);
      const version = (res && res.metadata && Number.isInteger(res.metadata.v)) ? res.metadata.v : 0;
      return { value: res ? res.value : null, version };
    }

    if (request.method === 'GET') {
      const { value, version } = await readCurrent();
      // `null` (chaîne JSON) si cette clé n'a encore jamais été synchronisée
      // par aucun appareil — l'app le traite comme "pas encore de donnée ici".
      return new Response(value ?? 'null', {
        headers: { ...cors, 'Content-Type': 'application/json', 'X-Plume-Version': String(version) }
      });
    }

    if (request.method === 'PUT' || request.method === 'POST') {
      const declaredLength = Number(request.headers.get('Content-Length') || 0);
      if (declaredLength > MAX_BODY_BYTES) {
        return new Response(JSON.stringify({ error: { message: 'Donnée trop volumineuse.' } }), {
          status: 413, headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
      const body = await request.text();
      if (body.length > MAX_BODY_BYTES) {
        return new Response(JSON.stringify({ error: { message: 'Donnée trop volumineuse.' } }), {
          status: 413, headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
      const { version: current } = await readCurrent();

      // Version sur laquelle l'appareil déclare se baser. Absente = appareil
      // encore sur une version antérieure du code : on refuse plutôt que de
      // laisser passer une écriture non arbitrable (il lira d'abord, ce qui
      // lui donnera le numéro à annoncer).
      const rawBase = request.headers.get('X-Plume-Base-Version');
      const base = rawBase === null ? null : Number(rawBase);
      if (base === null || !Number.isInteger(base) || base < 0) {
        return new Response(JSON.stringify({ error: { message: 'En-tête X-Plume-Base-Version manquant ou invalide.' } }), {
          status: 400, headers: { ...cors, 'Content-Type': 'application/json', 'X-Plume-Version': String(current) }
        });
      }

      // ── LE CONTRÔLE QUI EMPÊCHE TOUTE PERTE ──
      // L'appareil pensait partir de la version `base` ; le serveur est en
      // réalité à `current`. S'ils diffèrent, quelqu'un d'autre (ou cet
      // appareil depuis un autre navigateur) a écrit entre-temps : accepter
      // reviendrait à écraser cette version plus récente. On refuse, et on
      // renvoie le numéro réel pour que le client relise puis recommence.
      if (base !== current) {
        return new Response(JSON.stringify({
          error: { message: 'Version périmée : le serveur détient une version plus récente.' },
          serverVersion: current
        }), {
          status: 409, headers: { ...cors, 'Content-Type': 'application/json', 'X-Plume-Version': String(current) }
        });
      }

      const next = current + 1;
      // v9.3.3 — Sans ce filet, une écriture refusée par Cloudflare (quota
      // KV du compte gratuit épuisé, ou toute autre panne du binding) faisait
      // planter tout le handler : le client recevait une erreur 500/1101
      // opaque, indiscernable d'un simple problème réseau. On distingue
      // désormais clairement ce cas par un 503 explicite avec Retry-After,
      // que le client utilise pour ralentir TOUS ses envois (voir
      // le repli global dans router.js) plutôt que de continuer à insister
      // sans effet pendant que le quota reste épuisé.
      try {
        await env.PLUME_SYNC.put(key, body, { metadata: { v: next } });
      } catch (e) {
        // Seul un refus de type quota/limite (429, « limit ») mérite le 503 +
        // Retry-After qui déclenche le repli global côté client. Toute autre
        // erreur (valeur refusée, panne du binding) est une 500 ordinaire.
        const msg = String((e && e.message) || e);
        if (/429|limit|quota|too many/i.test(msg)) {
          return new Response(JSON.stringify({
            error: { message: "Écriture momentanément indisponible (quota ou panne passagère)." }
          }), {
            status: 503, headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': '900' }
          });
        }
        return new Response(JSON.stringify({ error: { message: "Écriture refusée par le stockage." } }), {
          status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ ok: true, version: next }), {
        headers: { ...cors, 'Content-Type': 'application/json', 'X-Plume-Version': String(next) }
      });
    }

    return new Response(JSON.stringify({ error: { message: 'Méthode non supportée.' } }), {
      status: 405, headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
};
