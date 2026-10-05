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
  '^(profiles|main|__ping__|__usage__' +
  '|(doclist|data|libsettings)_' + ID +
  '|(doc|aichat)_' + ID + '_' + ID +
  '|img_' + ID + '_' + ID + '_' + ID + ')$'
);
// v9.28.0 — Budget des IMAGES synchronisées dans D1 (limite gratuite de la base : 500 Mo, partagés avec
// tous les textes) : au-delà, les nouvelles images sont refusées (507) ; les textes restent acceptés.
const IMG_BUDGET_BYTES = 350 * 1024 * 1024;
const D1_DB_LIMIT_BYTES = 500 * 1024 * 1024; // limite de la base D1 du plan gratuit (information affichée)

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

// ═══════════════════════════════════════════════════════
// v9.23.0 — STOCKAGE D1 (en remplacement de KV, voir l'étude du quota)
//
// Pourquoi : le quota gratuit de Cloudflare KV (1 000 écritures/jour pour tout
// le compte) est insuffisant dès qu'on est plusieurs. D1 offre 100 000 lignes
// écrites/jour (partagées avec les autres bases du compte), une cohérence
// immédiate, des écritures atomiques et 7 jours de sauvegarde (Time Travel).
//
// Choix du stockage : si le binding `DB` (D1) existe, il est utilisé ; sinon le
// Worker se comporte exactement comme avant avec KV (`PLUME_SYNC`). Pendant la
// transition les deux sont liés : on LIT dans D1 puis, à défaut, dans KV ; on
// n'ÉCRIT plus que dans D1. Chaque donnée migre donc toute seule à sa première
// écriture (aucune copie en masse, KV n'est jamais modifié ni supprimé).
//
// Découpage : D1 limite une valeur à 2 Mo. Une version est découpée en morceaux
// de D1_CHUNK_CHARS caractères (sync_chunks), repérés par un identifiant
// d'écriture `wid` unique. La table sync_meta pointe vers la version courante
// (numéro, wid, nombre de morceaux). Une écriture insère ses morceaux puis bascule
// `sync_meta` EN UNE SEULE TRANSACTION conditionnelle (… WHERE version = base) :
// deux appareils ne peuvent plus écrire « en même temps » sans que l'un reçoive
// un refus (409) — ce que KV, sans écriture conditionnelle, ne garantissait pas.
// ═══════════════════════════════════════════════════════
const D1_CHUNK_CHARS = 600000; // ≤ 1,8 Mo même si tous les caractères pèsent 3 octets (limite D1 : 2 Mo)

function kvStore(env) {
  return {
    name: 'kv',
    async read(key) {
      const res = await env.PLUME_SYNC.getWithMetadata(key);
      const version = (res && res.metadata && Number.isInteger(res.metadata.v)) ? res.metadata.v : 0;
      return { value: res ? res.value : null, version };
    },
    async version(key) { return (await this.read(key)).version; },
    async imagesBytes() { return 0; }, // pas de budget en mode KV (valeur limitée à 25 Mio, pas de base partagée)
    async usage() { return { storage: 'kv' }; },
    async remove(key) { await env.PLUME_SYNC.delete(key); },
    async write(key, body, current) {
      await env.PLUME_SYNC.put(key, body, { metadata: { v: current + 1 } });
      return { ok: true, version: current + 1 };
    }
  };
}

function d1Store(env) {
  const db = env.DB;
  // Lecture de l'ancien stockage KV (transition) : valeur et version telles quelles.
  async function kvFallback(key) {
    if (!env.PLUME_SYNC) return { value: null, version: 0 };
    return kvStore(env).read(key);
  }
  const readMeta = key => db.prepare('SELECT version, wid, chunks FROM sync_meta WHERE k = ?1').bind(key).first();
  const dropChunks = (key, wid) => db.prepare('DELETE FROM sync_chunks WHERE k = ?1 AND wid = ?2').bind(key, wid).run();
  return {
    name: 'd1',
    async read(key) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const meta = await readMeta(key);
        if (!meta) return kvFallback(key);
        const { results } = await db.prepare('SELECT data FROM sync_chunks WHERE k = ?1 AND wid = ?2 ORDER BY idx').bind(key, meta.wid).all();
        if (results.length === meta.chunks) return { value: results.map(r => r.data).join(''), version: meta.version };
        // Une écriture concurrente vient de remplacer cette version (ses anciens
        // morceaux ont été effacés entre les deux lectures) : on relit.
      }
      throw new Error('Lecture incohérente (écritures concurrentes) : réessayez.');
    },
    async version(key) {
      const meta = await readMeta(key);
      return meta ? meta.version : (await kvFallback(key)).version;
    },
    // Octets déjà occupés par les images (préfixe de clé « img_ » : parcours par intervalle sur la clé primaire).
    async imagesBytes() {
      const r = await db.prepare("SELECT COALESCE(SUM(LENGTH(data)), 0) AS n FROM sync_chunks WHERE k >= 'img_' AND k < 'img`'").first();
      return r ? r.n : 0;
    },
    // Occupation du stockage (panneau « Système » de l'application) : nombres et octets, jamais de contenu.
    async usage() {
      const n = async sql => { const r = await db.prepare(sql).first(); return r ? Object.values(r)[0] : 0; };
      return {
        storage: 'd1',
        keys: await n('SELECT COUNT(*) FROM sync_meta'),
        manuscripts: await n("SELECT COUNT(*) FROM sync_meta WHERE k >= 'doc_' AND k < 'doc`'"),
        images: await n("SELECT COUNT(*) FROM sync_meta WHERE k >= 'img_' AND k < 'img`'"),
        imagesBytes: await this.imagesBytes(),
        imagesBudget: IMG_BUDGET_BYTES,
        totalBytes: await n('SELECT COALESCE(SUM(LENGTH(data)), 0) FROM sync_chunks'),
        dbLimit: D1_DB_LIMIT_BYTES
      };
    },
    async remove(key) {
      await db.batch([
        db.prepare('DELETE FROM sync_chunks WHERE k = ?1').bind(key),
        db.prepare('DELETE FROM sync_meta WHERE k = ?1').bind(key)
      ]);
    },
    async write(key, body, current) {
      const next = current + 1;
      const wid = crypto.randomUUID();
      const chunks = [];
      for (let i = 0; i < body.length; i += D1_CHUNK_CHARS) chunks.push(body.slice(i, i + D1_CHUNK_CHARS));
      if (!chunks.length) chunks.push('');
      const prev = await readMeta(key);
      const now = Date.now();
      const stmts = chunks.map((c, i) => db.prepare('INSERT INTO sync_chunks (k, wid, idx, data) VALUES (?1, ?2, ?3, ?4)').bind(key, wid, i, c));
      stmts.push(prev
        ? db.prepare('UPDATE sync_meta SET version = ?1, wid = ?2, chunks = ?3, updated_at = ?4 WHERE k = ?5 AND version = ?6').bind(next, wid, chunks.length, now, key, current)
        : db.prepare('INSERT INTO sync_meta (k, version, wid, chunks, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(key, next, wid, chunks.length, now));
      let results;
      try {
        results = await db.batch(stmts);
      } catch (e) {
        // Une autre écriture a créé la clé entre-temps (violation d'unicité) :
        // la transaction est annulée, rien n'a été écrit → conflit ordinaire.
        if (/UNIQUE|constraint/i.test(String((e && e.message) || e))) return { conflict: true };
        throw e;
      }
      const last = results[results.length - 1];
      if (!last || !last.meta || last.meta.changes !== 1) {
        await dropChunks(key, wid); // la version attendue n'était plus la bonne : on retire nos morceaux orphelins
        return { conflict: true };
      }
      if (prev) { try { await dropChunks(key, prev.wid); } catch (e) { /* nettoyage différé : sans effet sur les données */ } }
      return { ok: true, version: next };
    }
  };
}

async function handleRequest(request, env) {
    const url = new URL(request.url);
    const key = url.searchParams.get('key');

    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Plume-Base-Version',
      // Sans ceci, le navigateur cache la réponse mais REFUSE au JavaScript
      // de lire nos en-têtes de version (règle CORS) : le client croirait
      // alors toujours être en version 0 et le contrôle ne servirait à rien.
      'Access-Control-Expose-Headers': 'X-Plume-Version, X-Plume-Storage',
      // v9.23.0 — permet de vérifier à distance quel stockage répond (kv | d1).
      'X-Plume-Storage': env.DB ? 'd1' : 'kv'
    };
    const store = env.DB ? d1Store(env) : kvStore(env);

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
    if (key === '__usage__' && request.method === 'GET') {
      try {
        return new Response(JSON.stringify(await store.usage()), { headers: { ...cors, 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: { message: 'Mesure indisponible.' } }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
      }
    }
    if (key === '__ping__') {
      return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    if (request.method === 'GET') {
      let value, version;
      try { ({ value, version } = await store.read(key)); }
      catch (e) {
        return new Response(JSON.stringify({ error: { message: 'Lecture momentanément impossible.' } }), {
          status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }
      // `null` (chaîne JSON) si cette clé n'a encore jamais été synchronisée
      // par aucun appareil — l'app le traite comme "pas encore de donnée ici".
      return new Response(value ?? 'null', {
        headers: { ...cors, 'Content-Type': 'application/json', 'X-Plume-Version': String(version) }
      });
    }

    // Suppression côté serveur (v9.28.0 images ; v9.30.0 manuscrits et historiques IA).
    //  • img_* : toujours permise (une image supprimée n'a plus de raison d'exister) ;
    //  • doc_<profil>_<manuscrit> et aichat_<profil>_<manuscrit> : permises UNIQUEMENT si l'index de
    //    bibliothèque du profil porte une pierre tombale pour ce manuscrit (voir mergeDocList côté
    //    client) — un client défaillant ne peut donc pas effacer un manuscrit vivant ;
    //  • tout le reste (profils, index, réglages) : jamais.
    if (request.method === 'DELETE') {
      const refus = (status, message) => new Response(JSON.stringify({ error: { message } }), {
        status, headers: { ...cors, 'Content-Type': 'application/json' }
      });
      const texte = /^(doc|aichat)_([A-Za-z0-9-]{1,80})_([A-Za-z0-9-]{1,80})$/.exec(key);
      if (!key.startsWith('img_') && !texte) return refus(405, 'Suppression non autorisée pour cette clé.');
      if (texte) {
        let index = null;
        try { const cur = await store.read('doclist_' + texte[2]); index = cur.value ? JSON.parse(cur.value) : null; } catch (e) { /* index illisible : refus ci-dessous */ }
        const marque = index && Array.isArray(index.deleted) && index.deleted.some(t => t && t.id === texte[3]);
        if (!marque) return refus(403, "Suppression refusée : ce manuscrit n'est pas marqué supprimé dans la bibliothèque.");
      }
      try { await store.remove(key); }
      catch (e) { return refus(500, 'Suppression refusée par le stockage.'); }
      return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
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
      const current = await store.version(key);

      // v9.28.0 — Budget des images : refus (507) quand la place réservée est consommée.
      if (key.startsWith('img_') && current === 0) {
        const used = await store.imagesBytes();
        if (used + body.length > IMG_BUDGET_BYTES) {
          return new Response(JSON.stringify({ error: { message: 'Espace de synchronisation des images plein.' }, used, budget: IMG_BUDGET_BYTES }), {
            status: 507, headers: { ...cors, 'Content-Type': 'application/json' }
          });
        }
      }

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

      // v9.3.3 — Sans ce filet, une écriture refusée par Cloudflare (quota
      // épuisé ou panne du stockage) faisait planter tout le handler : le client
      // recevait une erreur 500/1101 opaque, indiscernable d'un problème réseau.
      // On distingue le cas « quota » par un 503 avec Retry-After, que le client
      // utilise pour ralentir TOUS ses envois (repli global, router.js).
      let outcome;
      try {
        outcome = await store.write(key, body, current);
      } catch (e) {
        const msg = String((e && e.message) || e);
        if (/429|limit|quota|too many|exceed/i.test(msg)) {
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
      // v9.23.0 — Avec D1 l'écriture est conditionnelle : si quelqu'un d'autre a
      // écrit entre la vérification ci-dessus et maintenant, on obtient ici un
      // conflit (jamais d'écrasement silencieux).
      if (outcome.conflict) {
        const actual = await store.version(key);
        return new Response(JSON.stringify({
          error: { message: 'Version périmée : le serveur détient une version plus récente.' },
          serverVersion: actual
        }), {
          status: 409, headers: { ...cors, 'Content-Type': 'application/json', 'X-Plume-Version': String(actual) }
        });
      }
      const next = outcome.version;
      return new Response(JSON.stringify({ ok: true, version: next }), {
        headers: { ...cors, 'Content-Type': 'application/json', 'X-Plume-Version': String(next) }
      });
    }

    return new Response(JSON.stringify({ error: { message: 'Méthode non supportée.' } }), {
      status: 405, headers: { ...cors, 'Content-Type': 'application/json' }
    });
}

// v9.29.0 (audit AUD-01-016) — UNE ligne JSON par requête dans les journaux Cloudflare (Workers Logs) :
// méthode, famille de clé (profiles, doc, doclist, img…), code de réponse, durée, version. JAMAIS le
// contenu, ni l'identifiant de profil ou de manuscrit, ni la clé de synchronisation.
function logEvent(evt) { try { console.log(JSON.stringify(evt)); } catch (e) { /* le journal ne doit jamais casser une requête */ } }
export default {
  async fetch(request, env) {
    const t0 = Date.now();
    const key = new URL(request.url).searchParams.get('key') || '';
    const fam = key.split('_')[0] || 'aucune';
    try {
      const res = await handleRequest(request, env);
      logEvent({ evt: 'sync', m: request.method, fam, st: res.status, ms: Date.now() - t0, ver: res.headers.get('X-Plume-Version'), store: env.DB ? 'd1' : 'kv' });
      return res;
    } catch (e) {
      logEvent({ evt: 'sync', m: request.method, fam, st: 'exception', ms: Date.now() - t0, err: String((e && e.message) || e).slice(0, 120) });
      throw e;
    }
  }
};
