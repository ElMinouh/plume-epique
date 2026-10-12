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
  '^(profiles|main|__ping__|__usage__|__security__|profile_[A-Za-z0-9-]{1,80}' +
  '|(doclist|data|libsettings)_' + ID +
  '|(doc|aichat)_' + ID + '_' + ID +
  '|img_' + ID + '_' + ID + '_' + ID + ')$'
);
// v9.28.0 — Budget des IMAGES synchronisées dans D1 (limite gratuite de la base : 500 Mo, partagés avec
// tous les textes) : au-delà, les nouvelles images sont refusées (507) ; les textes restent acceptés.
const IMG_BUDGET_BYTES = 350 * 1024 * 1024;
const D1_DB_LIMIT_BYTES = 500 * 1024 * 1024; // limite de la base D1 du plan gratuit (information affichée)

// ═══════════════════════════════════════════════════════
// v9.64.0 (audit AUD-06-010, 023, 022) — DURCISSEMENT, LOT 2
//   • CORS : plus de « * » ; seule l'application (et ses déploiements de prévisualisation) peut appeler ce
//     Worker depuis un navigateur ; env.CORS_EXTRA (liste séparée par des virgules) sert aux tests locaux ;
//   • corps des écritures lu en flux avec plafond (le contrôle ne dépend plus de Content-Length) ;
//   • version minimale du client : un appareil trop ancien reçoit 426 (en-tête absent = accepté) ;
//   • point de collecte des violations de CSP (/csp-report) : une ligne de journal, jamais de contenu.
// ═══════════════════════════════════════════════════════
const APP_ORIGIN = 'https://plume-epique.pages.dev';
const DEFAULT_MIN_CLIENT_VERSION = '0.0.0'; // à relever (variable MIN_CLIENT_VERSION) pour imposer un correctif de sécurité
function isAllowedOrigin(origin, env) {
  if (origin === APP_ORIGIN) return true;
  if (/^https:\/\/[a-z0-9-]+\.plume-epique\.pages\.dev$/.test(origin)) return true;
  // CORS_EXTRA (tests locaux uniquement) : origines exactes, ou « http://localhost:* » pour tout port local.
  return String((env && env.CORS_EXTRA) || '').split(',').map(x => x.trim()).filter(Boolean)
    .some(x => x === origin || (x === 'http://localhost:*' && /^http:\/\/localhost:\d+$/.test(origin)));
}
function versionLess(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0), pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0); }
  return false;
}
// Lit le corps par morceaux et s'arrête dès que le plafond est dépassé (renvoie null) : la mémoire du Worker
// n'est plus exposée à un corps sans Content-Length.
async function readBodyCapped(request, maxBytes) {
  if (!request.body) return '';
  const reader = request.body.getReader(), dec = new TextDecoder();
  let total = 0, out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { try { await reader.cancel(); } catch (e) { /* déjà fermé */ } return null; }
    out += dec.decode(value, { stream: true });
  }
  return out + dec.decode();
}
const _cspReports = new Map(); // adresse -> { count, since } : plafond de 30 rapports par minute et par adresse
function cspReportAllowed(ip, now) {
  if (_cspReports.size > 500) _cspReports.clear();
  const rec = _cspReports.get(ip);
  if (!rec || now - rec.since > 60000) { _cspReports.set(ip, { count: 1, since: now }); return true; }
  return ++rec.count <= 30;
}

// ═══════════════════════════════════════════════════════
// v9.65.0 (audit AUD-06-001, 002, 017) — SERRURE PAR PROFIL ET QUOTAS
// Avant : la clé de synchronisation commune ouvrait TOUTES les données de TOUS les profils (lire, écrire, supprimer,
// y compris poser une pierre tombale qui fait détruire un manuscrit chez tout le monde).
// Désormais chaque profil a un jeton, dérivé de sa clé de données (jamais envoyée au serveur), dont le Worker ne
// garde que l'empreinte (table profile_auth). Toute requête sur une donnée d'un profil (data_, doclist_, doc_,
// aichat_, libsettings_, img_) doit porter X-Plume-Profile-Id + X-Plume-Profile-Token.
//   • Mise en place PROGRESSIVE : tant qu'un profil n'a pas été « verrouillé » (premier appareil mis à jour qui s'y
//     connecte), les appareils plus anciens continuent de fonctionner sans jeton. Une fois verrouillé, tout
//     appareil sans jeton valide reçoit 403 (code « profile-token »).
//   • La serrure se pose à la première requête portant un jeton bien formé pour un profil non verrouillé (premier
//     arrivé). Au plus MAX_CLAIMED_PROFILES profils (507 au-delà).
//   • L'index `profiles` n'est pas encore protégé ici (lot 3b).
// Quotas (écritures) : PROFILE_QUOTA_BYTES et PROFILE_QUOTA_KEYS par profil ; au-delà de GLOBAL_GUARD_BYTES pour
// toute la base (limite gratuite de D1 : 500 Mo, partagée avec d'autres projets) : 507 plutôt qu'une base saturée.
// ═══════════════════════════════════════════════════════
const MAX_CLAIMED_PROFILES = 20;
const PROFILE_QUOTA_BYTES = 150 * 1024 * 1024;
const PROFILE_QUOTA_KEYS = 2000;
const GLOBAL_GUARD_BYTES = Math.floor(D1_DB_LIMIT_BYTES * 0.9);
// Identifiant de profil contenu dans une clé de synchronisation (null : clé non rattachée à un profil).
const PROFILE_KEY_PATTERNS = [
  /^(?:data|doclist|libsettings)_([A-Za-z0-9-]{1,80})$/,
  /^(?:doc|aichat)_([A-Za-z0-9-]{1,80})_.+$/,
  /^img_([A-Za-z0-9-]{1,80})_.+$/
];
function profileIdOfKey(key) {
  for (const re of PROFILE_KEY_PATTERNS) { const m = re.exec(key); if (m) return m[1]; }
  return null;
}
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
let _authTableReady = null;
function ensureAuthTable(env) {
  const db = env.DB;
  if (!_authTableReady) {
    _authTableReady = db.prepare("CREATE TABLE IF NOT EXISTS profile_auth (pid TEXT PRIMARY KEY, verifier TEXT NOT NULL, created_at INTEGER NOT NULL, role TEXT NOT NULL DEFAULT 'user')").run()
      // v9.65.1 : la table créée en 9.65.0 n'avait pas de colonne « role » : ajout une fois (erreur « duplicate column » ignorée).
      .then(async () => {
        let added = true;
        try { await db.prepare("ALTER TABLE profile_auth ADD COLUMN role TEXT NOT NULL DEFAULT 'user'").run(); } catch (e) { added = false; }
        if (!added) return;
        // Colonne tout juste ajoutée : les profils DÉJÀ verrouillés par la 9.65.0 (administrateur compris) ont reçu le
        // rôle par défaut « user » ; on rend « admin » ceux que l'index désigne comme administrateurs.
        const idx = await currentIndex(d1Store(env));
        for (const p of (idx ? idx.profiles : [])) {
          if (p.role === 'admin') await db.prepare("UPDATE profile_auth SET role = 'admin' WHERE pid = ?1").bind(p.id).run();
        }
      })
      .catch(e => { _authTableReady = null; throw e; });
  }
  return _authTableReady;
}
// ═══════════════════════════════════════════════════════
// v9.65.1 (audit AUD-06-001, suite) — PROTECTION DE L'INDEX DES PROFILS (`profiles`)
// Le rôle « admin » n'était qu'une étiquette de cet index, modifiable par tout porteur de la clé. Désormais le
// Worker compare chaque écriture à la version courante et exige un DROIT pour chaque profil dont l'entrée (ou la
// pierre tombale) change : le jeton de CE profil, ou celui d'un administrateur. Le rôle d'administrateur est fixé côté
// serveur (colonne role de profile_auth) à la première connexion du profil qui l'est dans l'index, s'il n'existe pas
// encore d'administrateur verrouillé ; il ne se modifie ensuite que par un administrateur. Créer un profil reste
// libre (en simple utilisateur, 20 au plus). Un profil pas encore verrouillé reste modifiable (mise en place
// progressive, comme pour ses données). Le contenu doit être un JSON conforme (taille, structure).
// ═══════════════════════════════════════════════════════
const MAX_INDEX_BYTES = 200 * 1024;
const MAX_INDEX_TOMBSTONES = 500;
function stableJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']';
  return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}';
}
function parseProfilesIndex(text) {
  let j;
  try { j = JSON.parse(text); } catch (e) { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j) || !Array.isArray(j.profiles)) return null;
  const dp = j.deletedProfiles === undefined ? [] : j.deletedProfiles;
  if (!Array.isArray(dp)) return null;
  const idOk = id => typeof id === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(id);
  if (!j.profiles.every(p => p && typeof p === 'object' && idOk(p.id))) return null;
  if (!dp.every(t => t && typeof t === 'object' && idOk(t.id))) return null;
  return j;
}
async function currentIndex(store) {
  try { const cur = await store.read('profiles'); return cur && cur.value ? parseProfilesIndex(cur.value) : null; } catch (e) { return null; }
}
// Rôle donné à un profil au moment où il se verrouille : « admin » seulement si l'index le dit ET qu'aucun
// administrateur n'est encore verrouillé ; sinon « user ».
async function roleAtClaim(env, pid) {
  const admin = await env.DB.prepare("SELECT pid FROM profile_auth WHERE role = 'admin' LIMIT 1").first();
  if (admin) return 'user';
  const idx = await currentIndex(d1Store(env));
  const entry = idx && idx.profiles.find(p => p.id === pid);
  return entry && entry.role === 'admin' ? 'admin' : 'user';
}
// Contrôle une écriture de l'index. Renvoie null si autorisée, sinon la réponse de refus (403/400/507).
async function authorizeProfilesWrite(request, env, body, cors) {
  const refuse = (status, message, extra) => new Response(JSON.stringify({ error: { message, code: 'profile-index' }, ...(extra || {}) }), {
    status, headers: { ...cors, 'Content-Type': 'application/json' }
  });
  if (body.length > MAX_INDEX_BYTES) return refuse(413, 'Liste de profils trop volumineuse.');
  const next = parseProfilesIndex(body);
  if (!next) return refuse(400, 'Liste de profils invalide.');
  if (next.profiles.length > MAX_CLAIMED_PROFILES) return refuse(507, 'Nombre maximal de profils atteint sur ce serveur.', { quota: 'profiles' });
  if ((next.deletedProfiles || []).length > MAX_INDEX_TOMBSTONES) return refuse(400, 'Trop de profils supprimés dans la liste.');
  const prev = await currentIndex(d1Store(env));
  if (!prev) return null; // aucune liste valide sur le serveur : première création

  // Qui écrit ? Un jeton bien formé vaut identification (et verrouille le profil s'il ne l'était pas).
  await ensureAuthTable(env);
  const token = request.headers.get('X-Plume-Profile-Token') || '';
  const actingId = request.headers.get('X-Plume-Profile-Id') || '';
  let acting = null, actingRole = 'user';
  if (/^[0-9a-f]{64}$/.test(token) && /^[A-Za-z0-9-]{1,80}$/.test(actingId)) {
    const denied = await authorizeProfile(request, env, actingId, cors);
    if (denied) return denied; // jeton faux pour un profil verrouillé
    acting = actingId;
    const row = await env.DB.prepare('SELECT role FROM profile_auth WHERE pid = ?1').bind(actingId).first();
    actingRole = row ? row.role : 'user';
  }
  const lockedRows = (await env.DB.prepare('SELECT pid FROM profile_auth').all()).results || [];
  const locked = new Set(lockedRows.map(r => r.pid));
  const hasAdmin = !!(await env.DB.prepare("SELECT pid FROM profile_auth WHERE role = 'admin' LIMIT 1").first());
  const allowed = pid => !locked.has(pid) || (acting !== null && (acting === pid || actingRole === 'admin'));
  const no = pid => refuse(403, "Modification du profil refusée : droits insuffisants (profil protégé).", { pid: undefined });

  const before = new Map(prev.profiles.map(p => [p.id, p])), after = new Map(next.profiles.map(p => [p.id, p]));
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(id), a = after.get(id);
    if (b && a && stableJson(b) === stableJson(a)) continue;
    if (!allowed(id)) return no(id);
    // Rôle : un profil NOUVEAU ne peut être « admin » que s'il n'existe aucun administrateur (installation initiale) ;
    // le rôle d'un profil existant ne change que par un administrateur.
    if (a && !b && a.role === 'admin' && (hasAdmin || prev.profiles.some(p => p.role === 'admin'))) return no(id);
    if (a && b && a.role !== b.role && actingRole !== 'admin') return no(id);
  }
  const beforeTombs = new Set((prev.deletedProfiles || []).map(t => t.id));
  for (const t of (next.deletedProfiles || [])) {
    if (!beforeTombs.has(t.id) && !allowed(t.id)) return no(t.id);
  }
  // Rôle serveur d'un profil verrouillé dont l'entrée change de rôle (par un administrateur) : suivre l'index.
  for (const [id, a] of after) {
    const b = before.get(id);
    if (b && a.role !== b.role && locked.has(id) && (a.role === 'admin' || a.role === 'user')) {
      await env.DB.prepare('UPDATE profile_auth SET role = ?1 WHERE pid = ?2').bind(a.role, id).run();
      await noteEvent(env, 'role_change', id, null, a.role);
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════
// v9.68.0 (audit AUD-06-015) — EFFACEMENT DES DONNÉES D'UN PROFIL SUPPRIMÉ : DELETE ?key=profile_<id>.
// Autorisé seulement si (1) l'appelant est identifié par son jeton ET administrateur, (2) le profil n'est plus dans la
// liste et y porte une pierre tombale (donc la suppression a bien été décidée et publiée). Efface en UNE transaction
// toutes les clés du profil (données, index, manuscrits, historiques, réglages, images) et sa serrure. Les copies de
// sauvegarde (Time Travel, 7 jours) disparaissent d'elles-mêmes.
// ═══════════════════════════════════════════════════════
async function eraseProfile(request, env, pid, cors) {
  const refuse = (status, code, message) => new Response(JSON.stringify({ error: { message, code } }), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (!env.DB) return refuse(405, 'profile-erase', 'Effacement indisponible avec ce stockage.');
  await ensureAuthTable(env);
  const token = request.headers.get('X-Plume-Profile-Token') || '';
  const actingId = request.headers.get('X-Plume-Profile-Id') || '';
  if (!/^[0-9a-f]{64}$/.test(token) || !/^[A-Za-z0-9-]{1,80}$/.test(actingId) || actingId === pid) return refuse(403, 'profile-erase', 'Effacement refusé : administrateur non identifié.');
  const row = await env.DB.prepare('SELECT verifier, role FROM profile_auth WHERE pid = ?1').bind(actingId).first();
  if (!row || !timingSafeEqual(await sha256Hex(token), row.verifier) || row.role !== 'admin') return refuse(403, 'profile-erase', 'Effacement refusé : réservé à un administrateur.');
  const idx = await currentIndex(d1Store(env));
  const supprime = idx && !idx.profiles.some(p => p.id === pid) && (idx.deletedProfiles || []).some(t => t.id === pid);
  if (!supprime) return refuse(403, 'profile-erase', 'Effacement refusé : ce profil n\'est pas marqué supprimé dans la liste.');
  const where = "(k = ?1 OR k = ?2 OR k = ?3 OR (k >= ?4 AND k < ?5) OR (k >= ?6 AND k < ?7) OR (k >= ?8 AND k < ?9))";
  const args = ['data_' + pid, 'doclist_' + pid, 'libsettings_' + pid, 'doc_' + pid + '_', 'doc_' + pid + '`', 'aichat_' + pid + '_', 'aichat_' + pid + '`', 'img_' + pid + '_', 'img_' + pid + '`'];
  const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM sync_meta WHERE ' + where).bind(...args).first()).n;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sync_chunks WHERE ' + where).bind(...args),
    env.DB.prepare('DELETE FROM sync_meta WHERE ' + where).bind(...args),
    env.DB.prepare('DELETE FROM profile_auth WHERE pid = ?1').bind(pid)
  ]);
  return new Response(JSON.stringify({ ok: true, erased: n }), { headers: { ...cors, 'Content-Type': 'application/json' } });
}

// Renvoie null si la requête est autorisée, sinon la réponse de refus.
async function authorizeProfile(request, env, pid, cors) {
  const refuse = (status, code, message, extra) => new Response(JSON.stringify({ error: { message, code }, ...(extra || {}) }), {
    status, headers: { ...cors, 'Content-Type': 'application/json' }
  });
  await ensureAuthTable(env);
  // v9.68.0 : un profil SUPPRIMÉ par un administrateur (pierre tombale dans la liste) ne se verrouille plus et ne répond
  // plus, quelle que soit la méthode : un appareil resté en retard ne fait pas renaître ses données (une simple lecture
  // avec un jeton le « re-verrouillerait » sinon, puis ses écritures passeraient).
  const idxNow = await currentIndex(d1Store(env));
  if (idxNow && (idxNow.deletedProfiles || []).some(t => t.id === pid)) return refuse(403, 'profile-deleted', 'Ce profil a été supprimé par un administrateur.');
  const token = request.headers.get('X-Plume-Profile-Token') || '';
  const claimedId = request.headers.get('X-Plume-Profile-Id') || '';
  const wellFormed = /^[0-9a-f]{64}$/.test(token) && claimedId === pid;
  const row = await env.DB.prepare('SELECT verifier FROM profile_auth WHERE pid = ?1').bind(pid).first();
  if (row) {
    if (wellFormed && timingSafeEqual(await sha256Hex(token), row.verifier)) return null;
    return refuse(403, 'profile-token', 'Ce profil est protégé par un autre appareil : mettez Plume à jour (rechargez la page) puis reconnectez-vous.');
  }
  // v9.68.0 : un profil SUPPRIMÉ par un administrateur ne peut plus rien écrire (ni se verrouiller de nouveau) :
  // un appareil resté en retard ne fait pas renaître ses données sur le serveur.
  if (!wellFormed) return null; // profil pas encore verrouillé : ancien appareil toléré
  const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM profile_auth').first()).n;
  if (n >= MAX_CLAIMED_PROFILES) return refuse(507, 'profile-limit', 'Nombre maximal de profils atteint sur ce serveur.', { quota: 'profiles' });
  const verifier = await sha256Hex(token);
  const role = await roleAtClaim(env, pid);
  await env.DB.prepare('INSERT OR IGNORE INTO profile_auth (pid, verifier, created_at, role) VALUES (?1, ?2, ?3, ?4)').bind(pid, verifier, Date.now(), role).run();
  const won = await env.DB.prepare('SELECT verifier FROM profile_auth WHERE pid = ?1').bind(pid).first();
  if (won && timingSafeEqual(won.verifier, verifier)) await noteEvent(env, 'profile_lock', pid, null, role);
  return won && timingSafeEqual(won.verifier, verifier) ? null
    : refuse(403, 'profile-token', 'Ce profil vient d\'être verrouillé par un autre appareil : rechargez la page.');
}

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
// Choix du stockage : si le binding `DB` (D1) existe, il est utilisé ; sinon (tests, ancien
// déploiement) le Worker se comporte comme avant avec KV (`PLUME_SYNC`).
// AUD-06-013 (Lot 1, v9.63.3) — FIN DE LA TRANSITION : le repli de lecture sur KV est supprimé. Il faisait
// réapparaître une donnée supprimée de D1 (l'ancienne version restée dans KV était servie à nouveau) : rien
// n'était réellement effacé du serveur. Les clés restées uniquement dans KV ont été copiées dans D1 par
// scripts/migrer-kv-vers-d1.cjs avant ce changement.
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
  const readMeta = key => db.prepare('SELECT version, wid, chunks FROM sync_meta WHERE k = ?1').bind(key).first();
  const dropChunks = (key, wid) => db.prepare('DELETE FROM sync_chunks WHERE k = ?1 AND wid = ?2').bind(key, wid).run();
  return {
    name: 'd1',
    async read(key) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const meta = await readMeta(key);
        if (!meta) return { value: null, version: 0 }; // AUD-06-013 : plus de repli sur KV (une donnée supprimée ne réapparaît plus)
        const { results } = await db.prepare('SELECT data FROM sync_chunks WHERE k = ?1 AND wid = ?2 ORDER BY idx').bind(key, meta.wid).all();
        if (results.length === meta.chunks) return { value: results.map(r => r.data).join(''), version: meta.version };
        // Une écriture concurrente vient de remplacer cette version (ses anciens
        // morceaux ont été effacés entre les deux lectures) : on relit.
      }
      throw new Error('Lecture incohérente (écritures concurrentes) : réessayez.');
    },
    async version(key) {
      const meta = await readMeta(key);
      return meta ? meta.version : 0;
    },
    // Octets et nombre de clés d'un profil (hors la clé `excludeKey`, celle qu'on s'apprête à réécrire).
    async profileUsage(pid, excludeKey) {
      const where = "(k = ?1 OR k = ?2 OR k = ?3 OR (k >= ?4 AND k < ?5) OR (k >= ?6 AND k < ?7) OR (k >= ?8 AND k < ?9)) AND k != ?10";
      const args = ['data_' + pid, 'doclist_' + pid, 'libsettings_' + pid, 'doc_' + pid + '_', 'doc_' + pid + '`', 'aichat_' + pid + '_', 'aichat_' + pid + '`', 'img_' + pid + '_', 'img_' + pid + '`', excludeKey || ''];
      const b = await db.prepare('SELECT COALESCE(SUM(LENGTH(data)), 0) AS n FROM sync_chunks WHERE ' + where).bind(...args).first();
      const c = await db.prepare('SELECT COUNT(*) AS n FROM sync_meta WHERE ' + where).bind(...args).first();
      return { bytes: b ? b.n : 0, keys: c ? c.n : 0 };
    },
    async totalBytes() {
      const r = await db.prepare('SELECT COALESCE(SUM(LENGTH(data)), 0) AS n FROM sync_chunks').first();
      return r ? r.n : 0;
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

    const requestOrigin = request.headers.get('Origin');
    const originOk = !requestOrigin || isAllowedOrigin(requestOrigin, env);
    const cors = {
      // Origine absente (appel hors navigateur : l'authentification fait foi) ou autorisée ; jamais « * ».
      ...(requestOrigin && originOk ? { 'Access-Control-Allow-Origin': requestOrigin } : {}),
      'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'GET,PUT,DELETE,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Plume-Base-Version, X-Plume-Client-Version, X-Plume-Profile-Id, X-Plume-Profile-Token',
      // Sans ceci, le navigateur cache la réponse mais REFUSE au JavaScript
      // de lire nos en-têtes de version (règle CORS) : le client croirait
      // alors toujours être en version 0 et le contrôle ne servirait à rien.
      'Access-Control-Expose-Headers': 'X-Plume-Version, X-Plume-Storage',
      // v9.23.0 — permet de vérifier à distance quel stockage répond (kv | d1).
      'X-Plume-Storage': env.DB ? 'd1' : 'kv'
    };
    const store = env.DB ? d1Store(env) : kvStore(env);

    if (!originOk) {
      return new Response(JSON.stringify({ error: { message: 'Origine non autorisée.' } }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    // Point de collecte des violations de CSP (rapports envoyés par le navigateur, sans clé). Une ligne de
    // journal par rapport (directive, origine bloquée, page) ; jamais d'adresse ni de contenu ; plafonné.
    if (request.method === 'POST' && url.pathname === '/csp-report') {
      const rip = request.headers.get('CF-Connecting-IP') || 'inconnue';
      if (cspReportAllowed(rip, Date.now())) {
        try {
          const raw = await readBodyCapped(request, 8192);
          const j = raw ? JSON.parse(raw) : null;
          const r = (j && (j['csp-report'] || (Array.isArray(j) && j[0] && j[0].body))) || {};
          const origin = u => { try { return new URL(u).origin; } catch (e) { return String(u || '').slice(0, 40); } };
          logEvent({ evt: 'csp', dir: String(r['violated-directive'] || r.effectiveDirective || '').slice(0, 60), blocked: origin(r['blocked-uri'] || r.blockedURL), page: origin(r['document-uri'] || r.documentURL) });
        } catch (e) { /* rapport illisible : ignoré */ }
      }
      return new Response(null, { status: 204, headers: cors });
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

    // Version minimale du client (audit AUD-06-023). En-tête absent (ancien appareil) : accepté, sans quoi un
    // appareil d'avant la v9.64.0 serait coupé d'un coup ; relever la valeur pour imposer un correctif.
    const clientVersion = request.headers.get('X-Plume-Client-Version');
    const minVersion = (env && env.MIN_CLIENT_VERSION) || DEFAULT_MIN_CLIENT_VERSION;
    if (clientVersion && versionLess(clientVersion, minVersion)) {
      return new Response(JSON.stringify({ error: { message: 'Cette version de Plume est trop ancienne : rechargez la page pour la mettre à jour.' }, minVersion }), {
        status: 426, headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

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
    if (key === '__security__' && request.method === 'GET') {
      if (!env.DB) return new Response(JSON.stringify({ storage: 'kv' }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      try {
        return new Response(JSON.stringify(await securitySummary(env.DB)), { headers: { ...cors, 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: { message: 'Registre indisponible.' } }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
      }
    }
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

    // v9.68.0 : clé d'effacement de profil (DELETE uniquement).
    if (key.startsWith('profile_')) {
      if (request.method !== 'DELETE') return new Response(JSON.stringify({ error: { message: 'Méthode non supportée pour cette clé.' } }), { status: 405, headers: { ...cors, 'Content-Type': 'application/json' } });
      return eraseProfile(request, env, key.slice('profile_'.length), cors);
    }

    // Serrure par profil (voir l'en-tête de ce fichier) : GET, PUT et DELETE d'une donnée de profil.
    const keyPid = env.DB ? profileIdOfKey(key) : null;
    if (keyPid) {
      const denied = await authorizeProfile(request, env, keyPid, cors);
      if (denied) return denied;
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
      const body = await readBodyCapped(request, MAX_BODY_BYTES);
      if (body === null) {
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

      // v9.65.1 — écriture de l'index des profils : droits par profil (voir authorizeProfilesWrite).
      if (key === 'profiles' && env.DB) {
        const deniedIndex = await authorizeProfilesWrite(request, env, body, cors);
        if (deniedIndex) return deniedIndex;
      }

      // v9.65.0 (AUD-06-017) — Quotas par profil et garde-fou global (D1 seulement).
      if (store.profileUsage) {
        const over = (quota, message) => new Response(JSON.stringify({ error: { message }, quota }), { status: 507, headers: { ...cors, 'Content-Type': 'application/json' } });
        if ((await store.totalBytes()) + body.length > GLOBAL_GUARD_BYTES) return over('global', 'Le stockage du serveur de synchronisation est presque plein : écriture refusée.');
        if (keyPid) {
          const u = await store.profileUsage(keyPid, key);
          if (u.bytes + body.length > PROFILE_QUOTA_BYTES) return over('profile', 'Espace de synchronisation de ce profil plein (150 Mo).');
          if (current === 0 && u.keys >= PROFILE_QUOTA_KEYS) return over('keys', 'Nombre maximal d\'éléments synchronisés pour ce profil atteint.');
        }
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

// ═══════════════════════════════════════════════════════
// v9.69.0 (audit AUD-06-016) — DÉTECTION ET TRAÇABILITÉ
// 1. Journal enrichi : chaque ligne porte l'empreinte courte du profil qui agit (`pid`) et le pays (`cc`).
// 2. Registre D1 `security_events` (30 jours) des événements qui comptent pour un enquêteur : échecs de clé, refus de la
//    serrure, suppressions, effacements de profil, verrouillages, changements de rôle, quotas. Les événements
//    « bruyants » (échecs, refus, quotas) sont PLAFONNÉS (10 par minute et par type et par instance) : une attaque ne
//    peut pas saturer la base partagée. Jamais d'adresse IP, de clé ni de contenu.
// 3. Lecture : GET ?key=__security__ (résumé 24 h + derniers événements) ou scripts/evenements-securite.cjs.
// ═══════════════════════════════════════════════════════
const EVENT_RETENTION_MS = 30 * 24 * 3600 * 1000;
const EVENT_CAPPED = new Set(['auth_fail', 'rate_limit', 'origin_refused', 'profile_denied', 'index_denied', 'quota']);
const EVENT_CAP_PER_MINUTE = 10;
const _eventCaps = new Map(); // « type:minute » -> nombre déjà enregistré par cette instance
let _eventsTableReady = null;
function ensureEventsTable(db) {
  if (!_eventsTableReady) {
    _eventsTableReady = db.prepare('CREATE TABLE IF NOT EXISTS security_events (ts INTEGER NOT NULL, kind TEXT NOT NULL, pid TEXT, cc TEXT, detail TEXT)').run()
      .then(() => db.prepare('CREATE INDEX IF NOT EXISTS security_events_ts ON security_events (ts)').run())
      .catch(e => { _eventsTableReady = null; throw e; });
  }
  return _eventsTableReady;
}
async function pseudonym(id) {
  return id ? (await sha256Hex('plume-evt|' + id)).slice(0, 10) : null;
}
async function recordEvent(env, kind, rawPid, cc, detail) {
  if (!env.DB) return;
  if (EVENT_CAPPED.has(kind)) {
    if (_eventCaps.size > 200) _eventCaps.clear();
    const k = kind + ':' + Math.floor(Date.now() / 60000);
    const n = (_eventCaps.get(k) || 0) + 1;
    _eventCaps.set(k, n);
    if (n > EVENT_CAP_PER_MINUTE) return;
  }
  await ensureEventsTable(env.DB);
  await env.DB.prepare('INSERT INTO security_events (ts, kind, pid, cc, detail) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(Date.now(), kind, await pseudonym(rawPid), cc || null, detail ? String(detail).slice(0, 80) : null).run();
  if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM security_events WHERE ts < ?1').bind(Date.now() - EVENT_RETENTION_MS).run();
}
// Enregistre sans jamais faire échouer ni ralentir la requête (waitUntil quand il existe).
function noteEvent(env, kind, rawPid, cc, detail) {
  const p = recordEvent(env, kind, rawPid, cc, detail).catch(() => { /* le registre ne doit jamais casser une requête */ });
  if (env && env.__ctx && typeof env.__ctx.waitUntil === 'function') { env.__ctx.waitUntil(p); return Promise.resolve(); }
  return p;
}
async function securitySummary(db) {
  await ensureEventsTable(db);
  const since = Date.now() - 24 * 3600 * 1000;
  const counts = (await db.prepare('SELECT kind, COUNT(*) AS n FROM security_events WHERE ts >= ?1 GROUP BY kind ORDER BY n DESC').bind(since).all()).results || [];
  const last = (await db.prepare('SELECT ts, kind, pid, cc, detail FROM security_events ORDER BY ts DESC LIMIT 50').all()).results || [];
  return { retentionDays: 30, last24h: Object.fromEntries(counts.map(r => [r.kind, r.n])), last };
}
// Déduit l'événement de sécurité de la réponse (un seul point de contrôle plutôt que des appels éparpillés).
async function classifyForEvent(request, key, res) {
  const st = res.status, m = request.method;
  const keyPid = profileIdOfKey(key);
  const fam = key.split('_')[0] || 'aucune';
  if (st === 401) return ['auth_fail', null, fam];
  if (st === 429) return ['rate_limit', null, fam];
  if (st === 507) return ['quota', keyPid, fam];
  if (st === 403) {
    let code = '';
    try { const j = await res.clone().json(); code = (j && j.error && j.error.code) || ''; } catch (e) { /* corps non JSON */ }
    if (code === 'profile-index') return ['index_denied', request.headers.get('X-Plume-Profile-Id'), 'profiles'];
    if (code) return ['profile_denied', key.startsWith('profile_') ? key.slice(8) : keyPid, code];
    return ['origin_refused', null, fam];
  }
  if (st === 200 && m === 'DELETE') return key.startsWith('profile_') ? ['profile_erase', key.slice(8), 'profile'] : ['delete', keyPid, fam];
  return null;
}

// v9.29.0 (audit AUD-01-016) — UNE ligne JSON par requête dans les journaux Cloudflare (Workers Logs) :
// méthode, famille de clé (profiles, doc, doclist, img…), code de réponse, durée, version. JAMAIS le
// contenu, ni l'identifiant de profil ou de manuscrit, ni la clé de synchronisation.
function logEvent(evt) { try { console.log(JSON.stringify(evt)); } catch (e) { /* le journal ne doit jamais casser une requête */ } }
export default {
  async fetch(request, rawEnv, ctx) {
    const t0 = Date.now();
    const env = { ...rawEnv, __ctx: ctx }; // le contexte sert au registre (waitUntil) ; les liaisons sont copiées par référence
    const key = new URL(request.url).searchParams.get('key') || '';
    const fam = key.split('_')[0] || 'aucune';
    try {
      const res = await handleRequest(request, env);
      const cc = (request.cf && request.cf.country) || null;
      const actingPid = await pseudonym(request.headers.get('X-Plume-Profile-Id'));
      logEvent({ evt: 'sync', m: request.method, fam, st: res.status, ms: Date.now() - t0, ver: res.headers.get('X-Plume-Version'), store: env.DB ? 'd1' : 'kv', pid: actingPid, cc });
      try {
        const ev = await classifyForEvent(request, key, res);
        if (ev) await noteEvent(env, ev[0], ev[1], cc, ev[2]);
      } catch (e) { /* le registre ne doit jamais casser une requête */ }
      return res;
    } catch (e) {
      logEvent({ evt: 'sync', m: request.method, fam, st: 'exception', ms: Date.now() - t0, err: String((e && e.message) || e).slice(0, 120) });
      throw e;
    }
  }
};
