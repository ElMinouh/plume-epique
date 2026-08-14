'use strict';
// SCHÉMA & VERSIONING : voir schema.js (extrait en v6.1.0 pour être testable
// indépendamment de l'app — tests/test-runner.html)

// ═══════════════════════════════════════════════════════
// VERSION AFFICHÉE (v7.22.3)
// Le numéro affiché en bas de l'écran était auparavant écrit en dur dans
// index.html — il n'a donc jamais été mis à jour au fil des versions et
// affichait encore "v7.20.0" plusieurs versions plus tard, faisant croire
// à tort que les déploiements n'arrivaient pas. Il est désormais alimenté
// depuis cette constante unique, remplie au chargement (voir window.onload).
//
// ⚠️ À CHAQUE NOUVELLE VERSION, deux endroits sont à mettre à jour :
//    1. APP_VERSION ci-dessous (numéro affiché à l'utilisateur)
//    2. la constante CACHE en haut de sw.js (force le rafraîchissement du
//       cache hors-ligne — sans ça, les navigateurs gardent l'ancien code)
// Les deux vivent dans des contextes séparés (page vs Service Worker), ils
// ne peuvent pas se partager une même variable.
// ═══════════════════════════════════════════════════════
const APP_VERSION = '9.5.4';

// ═══════════════════════════════════════════════════════
// INDEXEDDB
// ═══════════════════════════════════════════════════════
let idbStore = null;
// v7.21.0 — la base s'appelait techniquement "plume_v55" depuis le tout premier
// fichier du projet (résidu historique sans rapport avec la version actuelle,
// jamais renommé — voir README, section "Limites connues"). Renommée ici en
// "plume_epique". Pour ne perdre aucune donnée existante, migrateLegacyIdbIfNeeded()
// copie une seule fois, silencieusement, le contenu de l'ancienne base vers la
// nouvelle la toute première fois qu'un navigateur charge cette version — après
// quoi la nouvelle base n'est plus vide, et la migration ne se relance jamais.
// L'ancienne base n'est jamais supprimée automatiquement (aucune suppression de
// données utilisateur sans action explicite de sa part, cohérent avec la
// corbeille à 30 jours ailleurs dans l'app) ; elle devient simplement inutilisée.
const IDB_NAME = 'plume_epique';
const IDB_LEGACY_NAME = 'plume_v55';
async function migrateLegacyIdbIfNeeded() {
  if (!idbStore) return;
  if (await idbStore.count('data') > 0) return; // déjà des données sous le nouveau nom : rien à faire
  if (!indexedDB.databases) return; // navigateur trop ancien pour lister les bases : pas de migration à l'aveugle
  const existing = await indexedDB.databases();
  if (!existing.some(d => d.name === IDB_LEGACY_NAME)) return; // pas d'ancienne base : nouvel utilisateur
  let legacyDb;
  try {
    legacyDb = await idb.openDB(IDB_LEGACY_NAME, 1);
    const keys = await legacyDb.getAllKeys('data');
    for (const key of keys) {
      const value = await legacyDb.get('data', key);
      await idbStore.put('data', value, key);
    }
  } catch(e) { console.warn('Migration depuis l\'ancienne base IndexedDB impossible', e); }
  finally { if (legacyDb) legacyDb.close(); }
}
async function initIDB() {
  try {
    idbStore = await idb.openDB(IDB_NAME, 1, { upgrade(db) { db.createObjectStore('data'); } });
    await migrateLegacyIdbIfNeeded();
  }
  catch(e) { console.warn('IDB unavailable'); }
}
// v7.0.0 : persistData/loadData prennent désormais une clé de stockage
// explicite ('profiles' pour l'index, 'data_<id>' pour chaque profil,
// 'main' pour les anciennes données mono-profil à migrer).
//
// ═══════════════════════════════════════════════════════
// SYNCHRONISATION MULTI-APPAREILS (v7.22.0)
// Un Worker Cloudflare (voir worker/sync-worker.js, à déployer séparément —
// même principe que le Worker IA) sert de second point de stockage, à côté
// d'IndexedDB. Le contenu qui y transite reste chiffré côté client
// exactement comme avant : le Worker ne stocke que des blobs opaques, il ne
// voit jamais rien en clair.
//
// Fonctionnement :
//   - persistData() écrit en local ET pousse vers le Worker en arrière-plan
//     (jamais bloquant — hors-ligne, la copie locale suffit).
//   - loadData() renvoie la copie locale immédiatement si elle existe (donc
//     toujours rapide, y compris hors-ligne), tout en rafraîchissant le
//     cache local en arrière-plan pour la prochaine fois. Si RIEN n'existe
//     encore en local (tout premier accès à cette clé depuis cet appareil —
//     le cas d'un nouvel appareil), on attend la réponse du Worker avant de
//     renvoyer, sinon un nouvel appareil verrait "aucune donnée" au lieu de
//     son vrai contenu.
//
// Protégé par une "clé de synchronisation" propre à CET APPAREIL (pas au
// profil, ni au mot de passe d'un profil en particulier) — demandée une
// seule fois, voir renderSyncKeyGate() dans profiles.js. Sans cette clé
// (ou en mode hors-ligne explicite), l'app se comporte exactement comme
// avant cette version : 100% locale.
// ═══════════════════════════════════════════════════════
// ⚠️ Remplacez cette URL par celle de VOTRE Worker de synchronisation une
// fois déployé (voir worker/sync-worker.js) — sinon la synchronisation reste
// silencieusement inactive (échec réseau ignoré), l'app continue de
// fonctionner en local uniquement.
const SYNC_WORKER_URL = 'https://plume-epique-sync.air7841.workers.dev';

function getSyncKey() { return localStorage.getItem('plume_sync_key') || ''; }
function setSyncKey(key) { localStorage.setItem('plume_sync_key', key); localStorage.removeItem('plume_sync_skipped'); }
function isSyncSkipped() { return localStorage.getItem('plume_sync_skipped') === '1'; }
function setSyncSkipped() { localStorage.setItem('plume_sync_skipped', '1'); }
// Utilisé au tout premier chargement de l'app (voir window.onload plus bas) :
// faut-il montrer l'écran de saisie de la clé avant même l'écran de connexion ?
function needsSyncKeySetup() { return !getSyncKey() && !isSyncSkipped(); }

// v7.25.0 — Visibilité de la synchronisation : jusqu'ici, un échec de
// syncPush()/syncPull() (Worker injoignable, hors-ligne...) était avalé en
// silence (aucune perte de données pour autant : la copie locale reste la
// source de vérité, réessayée à la prochaine écriture) mais l'utilisateur
// n'avait aucun moyen de le savoir. On mémorise ici la dernière tentative
// (succès ou échec + horodatage), consultable via getLastSyncStatus() —
// affiché dans le panneau "💾 Système" (voir library.js).
// `ok: null` = aucune tentative depuis l'ouverture de cette page (device
// hors-ligne, ou clé de sync non configurée).
let _lastSyncStatus = { ok: null, ts: null };
function getLastSyncStatus() { return _lastSyncStatus; }
// v7.36.0 (ergonomie) — setter centralisé : toute mise à jour du statut de
// synchro rafraîchit aussi le point de couleur du bandeau du bas, sans
// avoir à ajouter cet appel à chaque site d'écriture individuellement.
function setLastSyncStatus(ok) {
  _lastSyncStatus = { ok, ts: Date.now() };
  if (typeof renderSyncDot === 'function') renderSyncDot();
}
// v7.36.0 (ergonomie) — reflète l'état de la dernière synchro dans un petit
// point discret du bandeau du bas, sans avoir à ouvrir le panneau Système :
// gris = pas de clé de synchro configurée sur cet appareil, vert = dernière
// tentative réussie, rouge = dernière tentative échouée.
function renderSyncDot() {
  const dot = document.getElementById('sync-status-dot');
  const label = document.getElementById('sync-status-label');
  if (!dot) return;
  dot.classList.remove('sync-ok','sync-warn','sync-error');
  if (!getSyncKey()) { label.textContent = ''; dot.title = 'Synchro multi-appareils non configurée'; return; }
  const status = getLastSyncStatus();
  if (status.ok === null) { label.textContent = ''; dot.title = 'Aucune synchro tentée depuis l\'ouverture de la page'; return; }
  if (status.ok) { dot.classList.add('sync-ok'); label.textContent = 'Synchro OK'; dot.title = 'Dernière synchro réussie'; }
  else { dot.classList.add('sync-error'); label.textContent = 'Échec synchro'; dot.title = 'Dernière tentative de synchro échouée — réessai automatique à la prochaine sauvegarde'; }
}

// Vérifie une clé auprès du Worker sans rien lire ni écrire de réel (clé
// technique réservée "__ping__", voir worker/sync-worker.js) — utilisé par
// le bouton "Vérifier" de l'écran de configuration.
async function verifySyncKey(key) {
  try {
    const resp = await fetch(SYNC_WORKER_URL + '?key=__ping__', { headers: { 'Authorization': 'Bearer ' + key } });
    return resp.ok;
  } catch(e) { return false; }
}
// v7.27.0 — Détection de conflit multi-appareils : jusqu'ici, syncPush()
// écrasait toujours aveuglément la version distante, y compris si un AUTRE
// appareil avait poussé une modification entre-temps (dernier écrivain gagne,
// en silence — perte de texte possible sans aucun avertissement). On garde
// désormais localement une empreinte (SHA-256) de la dernière version
// distante connue pour chaque clé. Avant d'écraser, on récupère la version
// distante réelle : si son empreinte a changé depuis notre dernier passage
// ET qu'elle diffère aussi de ce qu'on s'apprête à écrire, un autre appareil
// a écrit entre-temps → on sauvegarde cette version distante localement
// (jamais perdue) avant de l'écraser, et on prévient l'utilisateur.
// Volontairement PAS de fusion automatique ni d'écran de résolution (hors
// scope pour un usage familial où ce cas est rare) — juste : rien ne
// disparaît jamais en silence.
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function getKnownRemoteHash(key) { return localStorage.getItem('plume_synchash_' + key); }
function setKnownRemoteHash(key, hash) { localStorage.setItem('plume_synchash_' + key, hash); }

// ═══════════════════════════════════════════════════════
// EMPREINTE DE CONTENU (v9.3.0)
//
// Problème résolu : Crypto.encrypt() tire un sel et un IV ALÉATOIRES à chaque
// appel — le même texte produit donc un chiffré différent à chaque sauvegarde.
// Comparer deux enveloppes chiffrées ne permet donc PAS de savoir si le
// contenu a réellement changé, ce qui obligeait la synchronisation à traiter
// toute divergence apparente comme un conflit, et l'empêchait de distinguer
// « je suis simplement en retard » de « nous avons tous les deux modifié ».
//
// On joint désormais à chaque enveloppe une empreinte du contenu EN CLAIR.
// Elle est dérivée avec la clé de données du profil (_dataKey) : deux
// appareils du même profil obtiennent la même empreinte pour le même texte,
// mais le serveur, qui n'a pas cette clé, ne peut rien en déduire — le
// chiffrement reste "zero-knowledge".
// ═══════════════════════════════════════════════════════
async function contentFingerprint(plaintext) {
  return await sha256Hex((_dataKey || '') + '\u0000' + plaintext);
}
// Fabrique l'enveloppe stockée/synchronisée d'un contenu chiffré. Point de
// passage UNIQUE : toute création d'enveloppe doit passer par ici, sinon
// l'empreinte manque et la synchronisation retombe en mode prudent.
async function makeEncryptedEnvelope(plaintext) {
  return {
    _enc: true,
    data: await Crypto.encrypt(plaintext, _dataKey),
    _fp: await contentFingerprint(plaintext),
    _ts: Date.now()
  };
}
// Empreinte comparable d'une valeur synchronisée, quelle qu'elle soit :
//  • enveloppe récente          → _fp joint (aucun déchiffrement nécessaire) ;
//  • enveloppe ancienne         → déchiffrée puis empreinte recalculée
//                                 (compatibilité avec l'existant) ;
//  • clé non chiffrée           → empreinte du JSON (doclist, index profils).
// Renvoie null si l'empreinte ne peut pas être établie (clé de profil absente,
// déchiffrement impossible) : l'appelant traite alors le cas avec prudence.
async function valueFingerprint(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && value._enc) {
    if (value._fp) return value._fp;
    if (!_dataKey || !value.data) return null;
    try {
      const plain = await Crypto.decrypt(value.data, _dataKey);
      if (plain === null) return null;
      return await contentFingerprint(plain);
    } catch(e) { return null; }
  }
  try { return await sha256Hex(JSON.stringify(value)); } catch(e) { return null; }
}
// Empreinte du contenu tel qu'il était à la dernière synchronisation RÉUSSIE
// avec le serveur — la "base commune" des deux appareils. C'est elle qui
// permet de répondre à la seule question qui compte lors d'un refus : qui, de
// nous deux, a réellement modifié quelque chose depuis cette base ?
function getKnownRemoteFp(key) { return localStorage.getItem('plume_syncfp_' + key); }
function setKnownRemoteFp(key, fp) { if (fp) localStorage.setItem('plume_syncfp_' + key, fp); }

// ═══════════════════════════════════════════════════════
// ARBITRAGE D'UN REFUS SERVEUR (v9.3.0)
//
// Remplace le comportement précédent, qui repoussait TOUJOURS la version
// locale après un refus — neutralisant complètement la protection du serveur
// et faisant gagner le dernier appareil connecté, même quand son contenu
// était le plus ancien (bug rapporté le 29/07/2026 : un manuscrit enrichi sur
// un appareil revenait systématiquement à sa version courte).
//
// Quatre verdicts possibles :
//   'identical'   → même contenu des deux côtés (seul le chiffrement diffère)
//   'remote-only' → seul l'autre appareil a modifié : nous étions en retard
//   'local-only'  → seul cet appareil a modifié : notre version fait autorité
//   'both'        → les deux ont modifié depuis la base commune : vrai conflit
// ═══════════════════════════════════════════════════════
async function classifySyncDivergence(localValue, remoteValue, baseFp) {
  const localFp = await valueFingerprint(localValue);
  const remoteFp = await valueFingerprint(remoteValue);
  if (localFp && remoteFp && localFp === remoteFp) return 'identical';
  // Sans empreinte exploitable ou sans base commune connue, on ne peut rien
  // affirmer : on traite comme un vrai conflit plutôt que de risquer d'écraser
  // le travail de quelqu'un.
  if (!localFp || !remoteFp || !baseFp) return 'both';
  if (localFp === baseFp) return 'remote-only';
  if (remoteFp === baseFp) return 'local-only';
  return 'both';
}

// ═══════════════════════════════════════════════════════
// MISE EN PAUSE D'UNE CLÉ EN CONFLIT (v9.3.0)
//
// Tant qu'un vrai conflit n'est pas tranché par l'utilisateur, cette clé ne
// doit plus être poussée : sinon notre version partirait quand même et
// écraserait celle de l'autre appareil pendant la réflexion — exactement ce
// qu'on cherche à éviter. Les AUTRES manuscrits continuent de se synchroniser
// normalement. Persisté : la pause survit à un rechargement de la page.
// ═══════════════════════════════════════════════════════
function getConflictPausedKeys() {
  try { const v = JSON.parse(localStorage.getItem('plume_conflict_paused') || '[]'); return Array.isArray(v) ? v : []; }
  catch(e) { return []; }
}
function isConflictPaused(key) { return getConflictPausedKeys().includes(key); }
function addConflictPausedKey(key) {
  const keys = new Set(getConflictPausedKeys());
  keys.add(key);
  localStorage.setItem('plume_conflict_paused', JSON.stringify([...keys]));
}
function removeConflictPausedKey(key) {
  const keys = new Set(getConflictPausedKeys());
  keys.delete(key);
  localStorage.setItem('plume_conflict_paused', JSON.stringify([...keys]));
}

// ═══════════════════════════════════════════════════════
// FUSION DE L'INDEX DES MANUSCRITS (v9.3.0)
//
// Même principe que mergeProfilesIndex : cet index (titres, nombre de mots,
// date de modification affichés dans la bibliothèque) était jusqu'ici écrasé
// en bloc par l'appareil qui écrivait en dernier. Un appareil en retard
// réimposait donc ses anciens compteurs — c'est ce qui rendait l'écart de
// nombre de mots visible dès la bibliothèque, avant même d'ouvrir le texte.
// Aucun manuscrit ne peut disparaître par fusion ; pour un même manuscrit,
// l'entrée la plus récemment modifiée l'emporte.
// ═══════════════════════════════════════════════════════
function mergeDocList(local, remote) {
  if (!remote || !Array.isArray(remote.documents)) return local;
  if (!local || !Array.isArray(local.documents)) return remote;
  const byId = new Map();
  for (const d of remote.documents) if (d && d.id) byId.set(d.id, d);
  for (const d of local.documents) {
    if (!d || !d.id) continue;
    const other = byId.get(d.id);
    if (!other) { byId.set(d.id, d); continue; }
    byId.set(d.id, (d.lastModified || 0) >= (other.lastModified || 0) ? d : other);
  }
  return { ...remote, documents: Array.from(byId.values()) };
}
function isDocListKey(key) { return typeof key === 'string' && key.startsWith('doclist_'); }

// ═══════════════════════════════════════════════════════
// NUMÉRO DE VERSION PAR CLÉ (v8.1.0)
//
// Incident du 27/07/2026 (perte de tous les profils sauf un, sur tous les
// appareils simultanément). Cause racine : la synchronisation ne savait
// comparer que « identique » ou « différent », jamais « plus récent » ou
// « plus ancien ». Deux conséquences, toutes deux constatées :
//
//   1. syncPushEntireLibrary() (appelée à CHAQUE connexion, y compris les
//      connexions automatiques via « rester connecté ») repoussait la copie
//      locale de l'index des profils. Sur un appareil resté en arrière, ça
//      écrasait la version à jour du serveur — donc celle de tous les autres
//      appareils.
//   2. Cette écriture locale incrémentait _localWriteVersion, ce qui
//      ANNULAIT la mise à jour entrante que loadData() était justement en
//      train de récupérer. L'appareil en retard ne pouvait donc même pas
//      apprendre qu'il était en retard : il restait périmé indéfiniment tout
//      en imposant sa version périmée aux autres.
//
// Le serveur attribue désormais à chaque clé un numéro de version croissant
// (voir worker/sync-worker.js). On mémorise ici, PAR CLÉ et de façon
// persistante, le numéro correspondant à la copie locale actuelle :
//   - toute écriture annonce ce numéro ; le serveur la refuse (409) s'il
//     détient déjà plus récent → un appareil en retard ne peut plus écraser ;
//   - toute lecture n'est appliquée en local que si son numéro est
//     STRICTEMENT supérieur au nôtre → une réponse périmée ne peut plus
//     écraser une copie locale plus récente.
// ═══════════════════════════════════════════════════════
function getSyncVersion(key) {
  const v = parseInt(localStorage.getItem('plume_syncver_' + key), 10);
  return Number.isInteger(v) && v >= 0 ? v : 0;
}
function setSyncVersion(key, v) {
  if (Number.isInteger(v) && v >= 0) localStorage.setItem('plume_syncver_' + key, String(v));
}
// Lit le numéro de version renvoyé par le Worker. Renvoie null si l'en-tête
// est absent (Worker pas encore redéployé en v8.1.0, ou en-tête masqué par
// une règle CORS) : l'appelant traite alors la réponse comme non arbitrable
// et, par prudence, ne remplace rien en local.
function readVersionHeader(resp) {
  const raw = resp.headers.get('X-Plume-Version');
  if (raw === null) return null;
  const v = parseInt(raw, 10);
  return Number.isInteger(v) && v >= 0 ? v : null;
}

// ═══════════════════════════════════════════════════════
// GARDE-FOU : L'INDEX DES PROFILS NE PEUT JAMAIS RÉTRÉCIR (v8.1.0)
//
// Deuxième filet, indépendant du numéro de version ci-dessus : même si une
// version périmée franchissait tous les contrôles (cohérence différée de KV
// entre deux continents, bug futur, régression...), un profil présent en
// local ne doit JAMAIS disparaître à cause d'une synchronisation. Une
// version entrante ne peut donc qu'AJOUTER ou METTRE À JOUR des profils,
// jamais en retirer.
//
// La suppression volontaire d'un profil (deleteProfile, profiles.js) reste
// possible : elle écrit en local puis pousse, et c'est cette version-là qui
// fait autorité. Le seul effet de bord acceptable est qu'un profil supprimé
// pendant qu'un autre appareil était hors ligne puisse réapparaître à son
// retour — un profil en trop se resupprime en trois clics, un profil perdu
// ne se récupère pas.
// ═══════════════════════════════════════════════════════
function mergeProfilesIndex(local, remote) {
  if (!remote || !Array.isArray(remote.profiles)) return local;
  if (!local || !Array.isArray(local.profiles)) return remote;
  const merged = remote.profiles.slice();
  const seen = new Set(merged.map(p => p && p.id));
  for (const p of local.profiles) {
    if (p && !seen.has(p.id)) { merged.push(p); seen.add(p.id); }
  }
  return { ...remote, profiles: merged };
}
// Sauvegarde locale uniquement (ne relance pas syncPush, sans quoi on
// boucle) — utilisée pour ne jamais perdre la version distante écrasée.
async function persistConflictBackup(key, payload) {
  try {
    // v9.2.1 — Avant la correction ci-dessus, une seule séquence de conflit
    // pouvait produire plusieurs sauvegardes strictement identiques (une par
    // tentative ratée). On évite désormais de dupliquer une sauvegarde dont
    // le contenu est déjà identique à la plus récente existante pour cette clé.
    const prefix = 'conflict_' + key + '_';
    const body = JSON.stringify(payload);
    let existingKeys = [];
    if (idbStore) existingKeys = (await idbStore.getAllKeys('data')).filter(k => typeof k === 'string' && k.startsWith(prefix));
    else existingKeys = Object.keys(localStorage).filter(k => k.startsWith('plume_' + prefix)).map(k => k.slice('plume_'.length));
    if (existingKeys.length) {
      const mostRecentKey = existingKeys.sort().slice(-1)[0];
      const existing = idbStore ? await idbStore.get('data', mostRecentKey) : JSON.parse(localStorage.getItem('plume_' + mostRecentKey));
      if (JSON.stringify(existing) === body) return; // déjà sauvegardé, rien à dupliquer
    }
    const backupKey = prefix + Date.now();
    if (idbStore) await idbStore.put('data', payload, backupKey);
    else localStorage.setItem('plume_' + backupKey, body);
  } catch(e) { /* la sauvegarde de secours elle-même ne doit jamais faire planter la sync normale */ }
}

// Écriture strictement locale, sans repasser par persistData() : utilisée
// pendant la réconciliation d'un conflit (ci-dessous), où déclencher un
// nouvel envoi depuis l'intérieur d'un envoi provoquerait une récursion.
async function writeLocalOnly(key, payload) {
  if (idbStore) await idbStore.put('data', payload, key);
  else if (payload === null) localStorage.removeItem('plume_' + key);
  else localStorage.setItem('plume_' + key, JSON.stringify(payload));
}

// Nombre maximal de réconciliations enchaînées pour une même écriture. Au-delà,
// on abandonne et on laisse la file de nouvelles tentatives reprendre la main :
// mieux vaut un envoi différé qu'une boucle infinie si un autre appareil écrit
// en rafale sur la même clé.
const SYNC_MAX_CONFLICT_RETRIES = 3;

async function syncPush(key, payload, attempt = 0) {
  const syncKey = getSyncKey();
  if (!syncKey) return;
  // v9.3.0 — Un conflit réel attend l'arbitrage de l'utilisateur sur cette
  // clé : on continue d'écrire en local (rien n'est perdu, l'écriture reste
  // fluide) mais on n'envoie rien, sinon notre version écraserait celle de
  // l'autre appareil avant même qu'il ait choisi. Reprend automatiquement dès
  // que le conflit est tranché (voir resolveSyncConflict*, library.js).
  if (isConflictPaused(key)) return;
  try {
    const body = JSON.stringify(payload);
    const newHash = await sha256Hex(body);

    // `keepalive` permet à une sauvegarde de se terminer même si l'utilisateur
    // ferme l'onglet juste après — mais Chrome impose une limite stricte
    // d'environ 64 Ko sur le corps de ce type de requête, et DÉPASSER cette
    // limite ne renvoie pas une simple erreur : le navigateur tue purement et
    // simplement la page (RESULT_CODE_KILLED_BAD_MESSAGE). Bug rencontré en
    // v7.22.0 : les manuscrits chiffrés dépassent largement 64 Ko, donc la
    // page plantait dès l'activation de la synchronisation (sur Chrome
    // uniquement — Firefox n'applique pas cette limite de la même façon).
    // On ne demande donc `keepalive` que pour les petits envois ; au-delà,
    // requête normale (si l'onglet se ferme pile pendant l'envoi, la copie
    // locale reste intacte et sera repoussée à la prochaine écriture).
    const opts = {
      method: 'PUT',
      headers: {
        'Content-Type':'application/json',
        'Authorization':'Bearer ' + syncKey,
        // v8.1.0 — version sur laquelle cette écriture se base. Le serveur
        // refuse (409) s'il détient déjà plus récent : c'est ce qui empêche
        // définitivement un appareil en retard d'écraser les autres.
        'X-Plume-Base-Version': String(getSyncVersion(key))
      },
      body
    };
    if (body.length < 60000) opts.keepalive = true;
    const resp = await fetch(SYNC_WORKER_URL + '?key=' + encodeURIComponent(key), opts);

    // ── Refus : le serveur détient une version plus récente que la nôtre ──
    if (resp.status === 409) {
      setLastSyncStatus(false);
      if (attempt >= SYNC_MAX_CONFLICT_RETRIES) { addPendingSyncKey(key); scheduleSyncRetry(); return; }
      // On relit la version à jour du serveur, on la réconcilie avec notre
      // copie locale, puis on repart de cette base. Rien n'est jamais jeté :
      //  • index des profils → fusion (aucun profil ne peut disparaître) ;
      //  • toute autre clé → la version du serveur est sauvegardée localement
      //    avant d'être remplacée par la nôtre, et l'utilisateur est prévenu.
      // ⚠️ L'empreinte de la base commune doit être lue AVANT syncPull(),
      // qui la met lui-même à jour avec ce qu'il vient de recevoir : la lire
      // après reviendrait à comparer la version distante à elle-même, et à
      // conclure à tort que nous sommes les seuls à avoir modifié.
      const baseFpBeforePull = getKnownRemoteFp(key);
      const pulled = await syncPull(key);
      if (pulled.version === null) { addPendingSyncKey(key); scheduleSyncRetry(); return; }
      // v9.2.1 — Ce numéro de version était récupéré mais jamais retenu : le
      // réessai repartait donc avec le MÊME numéro périmé, se faisait refuser
      // pour la même raison, et rejouait ce blocage à chaque connexion.
      setSyncVersion(key, pulled.version);

      // Rien côté serveur : notre version peut partir telle quelle.
      if (pulled.data === null || pulled.data === undefined) {
        await writeLocalOnly(key, payload);
        return await syncPush(key, payload, attempt + 1);
      }

      // ── Clés fusionnables : aucune décision à demander ──
      // L'index des profils et celui des manuscrits se fusionnent sans perte
      // (rien ne peut disparaître) ; il n'y a donc jamais de conflit à
      // arbitrer sur ces deux clés.
      if (key === 'profiles' || isDocListKey(key)) {
        const merged = key === 'profiles'
          ? mergeProfilesIndex(payload, pulled.data)
          : mergeDocList(payload, pulled.data);
        await writeLocalOnly(key, merged);
        return await syncPush(key, merged, attempt + 1);
      }

      // ── Manuscrits : arbitrage à trois voies ──
      const verdict = await classifySyncDivergence(payload, pulled.data, baseFpBeforePull);

      if (verdict === 'identical') {
        // Même texte des deux côtés, seul l'emballage chiffré diffère (sel et
        // IV aléatoires). Rien à signaler : on adopte la version distante pour
        // se recaler sur son numéro de version, et on s'arrête là.
        await writeLocalOnly(key, pulled.data);
        setKnownRemoteHash(key, await sha256Hex(JSON.stringify(pulled.data)));
        setKnownRemoteFp(key, await valueFingerprint(pulled.data));
        return;
      }

      if (verdict === 'remote-only') {
        // ── LE CORRECTIF CENTRAL (v9.3.0) ──
        // Nous n'avons rien modifié depuis la dernière synchro : c'est l'autre
        // appareil qui a du nouveau. Jusqu'ici, cette situation repoussait
        // quand même notre copie périmée, qui écrasait son travail — d'où un
        // manuscrit qui « rétrécissait » à chaque connexion de l'autre
        // appareil. On adopte désormais sa version, silencieusement.
        await writeLocalOnly(key, pulled.data);
        setKnownRemoteHash(key, await sha256Hex(JSON.stringify(pulled.data)));
        setKnownRemoteFp(key, await valueFingerprint(pulled.data));
        if (typeof onRemoteVersionAdopted === 'function') onRemoteVersionAdopted(key);
        return;
      }

      if (verdict === 'local-only') {
        // Seuls nos changements sont nouveaux : notre version fait autorité,
        // on la pousse sur la base à jour. Aucun conflit, aucun message.
        await writeLocalOnly(key, payload);
        return await syncPush(key, payload, attempt + 1);
      }

      // ── verdict === 'both' : vrai conflit ──
      // Les deux appareils ont modifié ce manuscrit depuis leur dernière base
      // commune. On ne tranche PAS à la place de l'utilisateur : la version
      // distante est sauvegardée, la synchronisation de CE manuscrit est mise
      // en pause (sans quoi notre version partirait et écraserait la sienne
      // pendant qu'il réfléchit), et il arbitre quand il le souhaite.
      await persistConflictBackup(key, pulled.data);
      addConflictPausedKey(key);
      if (typeof onSyncConflictDetected === 'function') onSyncConflictDetected(key);
      if (typeof toast === 'function') toast("Synchro : ce manuscrit a été modifié sur les deux appareils. Votre texte est intact — ouvrez « Système » pour comparer et choisir.", 'error');
      return;
    }

    setLastSyncStatus(resp.ok);
    if (resp.ok) {
      const v = readVersionHeader(resp);
      if (v !== null) setSyncVersion(key, v);
      setKnownRemoteHash(key, newHash);
      // v9.3.0 — Ce qui vient d'être accepté par le serveur devient la base
      // commune des deux appareils : c'est à elle qu'on comparera pour savoir,
      // au prochain refus, qui a réellement modifié quoi.
      setKnownRemoteFp(key, await valueFingerprint(payload));
      removePendingSyncKey(key);
    } else {
      // v8.0.2 — Réponse reçue mais pas 2xx (Worker en erreur, quota
      // dépassé...) : jusqu'ici abandonné en silence comme un échec réseau,
      // sans jamais être retenté avant la prochaine écriture ou connexion
      // sur cette même clé (voir file d'attente ci-dessous / ADR-4).
      addPendingSyncKey(key);
      scheduleSyncRetry();
      // v9.3.3 — Le quota d'écriture KV est partagé par tout le compte, donc
      // par tous les utilisateurs : une panne d'écriture ici (503 explicite
      // du Worker, voir sync-worker.js) est par nature un signal commun,
      // pas propre à cette clé ni à cet appareil. On ralentit donc TOUS les
      // envois de CET appareil pendant SYNC_GLOBAL_BACKOFF_MS plutôt que
      // d'insister sans effet — chaque appareil qui écrit pendant la panne
      // recevra la même réponse et fera de même, sans coordination requise.
      if (key.startsWith('doc_')) setGlobalBackoffUntil(Date.now() + SYNC_GLOBAL_BACKOFF_MS);
    }
  } catch(e) {
    setLastSyncStatus(false);
    // v8.0.2 — Hors-ligne ou Worker injoignable : la copie locale suffit
    // pour l'instant, mais on mémorise cette clé pour la retenter nous-mêmes
    // en arrière-plan (voir scheduleSyncRetry ci-dessous), plutôt que
    // d'attendre indéfiniment la prochaine écriture ou connexion sur cette
    // même clé (limite jusqu'ici documentée comme acceptée — voir README).
    addPendingSyncKey(key);
    scheduleSyncRetry();
  }
}
// v8.1.0 — renvoie désormais { data, version } (et non plus la seule donnée) :
// sans le numéro de version, l'appelant n'a aucun moyen de savoir si ce qu'il
// reçoit est plus récent ou plus ancien que ce qu'il détient déjà — c'est
// exactement ce qui a causé la perte de profils du 27/07/2026.
// `version: null` = information indisponible (échec réseau, ou Worker pas
// encore redéployé en v8.1.0) → l'appelant ne doit alors RIEN remplacer.
async function syncPull(key) {
  const syncKey = getSyncKey();
  if (!syncKey) return { data: undefined, version: null };
  try {
    const resp = await fetch(SYNC_WORKER_URL + '?key=' + encodeURIComponent(key), { headers: { 'Authorization': 'Bearer ' + syncKey } });
    if (!resp.ok) { setLastSyncStatus(false); return { data: undefined, version: null }; }
    setLastSyncStatus(true);
    const version = readVersionHeader(resp);
    const data = await resp.json(); // peut être `null` (clé jamais synchronisée) : géré par l'appelant
    // v7.27.0 — on mémorise l'empreinte de ce qu'on vient de lire, pour que la
    // détection de conflit (voir syncPush) sache dès la prochaine écriture
    // locale si quelqu'un d'autre a modifié la donnée entre-temps.
    if (data !== null && data !== undefined) {
      setKnownRemoteHash(key, await sha256Hex(JSON.stringify(data)));
      // v9.3.0 — voir setKnownRemoteFp() : base commune servant à l'arbitrage.
      setKnownRemoteFp(key, await valueFingerprint(data));
    }
    return { data, version };
  } catch(e) { setLastSyncStatus(false); return { data: undefined, version: null }; }
}

// Correction (bug rapporté) : le rafraîchissement du cache local en
// arrière-plan (voir loadData() ci-dessous) pouvait écraser une écriture
// locale plus récente survenue PENDANT l'attente de la réponse du Worker —
// par exemple changer la couverture d'un manuscrit juste après avoir
// ouvert/quitté un autre, ou changer deux couvertures coup sur coup. Le
// symptôme observé : une couverture qui vient d'être changée revient
// silencieusement à son ancienne valeur peu après. _localWriteVersion
// compte les écritures locales par clé ; le rafraîchissement en arrière-
// plan ne s'applique que si aucune écriture locale n'a eu lieu pour cette
// clé depuis son propre lancement — sinon la copie locale est forcément
// plus récente que ce que répond le Worker, et on la laisse intacte.
const _localWriteVersion = {};

// Correction (bug rapporté, persistant) : le garde-fou ci-dessus protège
// contre UNE écriture locale survenue pendant l'attente du Worker, mais pas
// contre deux envois (syncPush) lancés coup sur coup vers LA MÊME clé : ils
// partaient jusqu'ici en parallèle, sans aucune garantie que le serveur les
// reçoive dans l'ordre d'envoi. Si le second (le bon) arrivait avant le
// premier (périmé), celui-ci l'écrasait ensuite silencieusement sur le
// Worker — et le rafraîchissement en arrière-plan de loadData() rapatriait
// alors cette version périmée, puisqu'aucune NOUVELLE écriture locale
// n'avait forcément eu lieu entre-temps pour déclencher le garde-fou
// existant (cas typique : changer 2 couvertures coup sur coup, ou changer
// une couverture puis rouvrir/refermer un manuscrit juste après).
// _pushChains sérialise les envois par clé (chacun attend que le précédent
// soit terminé) ; _pendingPushCount compte les envois encore en cours par
// clé, pour que loadData() n'applique jamais un rafraîchissement pendant
// qu'un envoi est encore en vol pour cette même clé.
const _pushChains = {}, _pendingPushCount = {};
function queueSyncPush(key, payload) {
  _pendingPushCount[key] = (_pendingPushCount[key] || 0) + 1;
  const previous = _pushChains[key] || Promise.resolve();
  const run = previous.then(() => syncPush(key, payload), () => syncPush(key, payload));
  _pushChains[key] = run.then(() => {}, () => {});
  run.then(() => { _pendingPushCount[key] = Math.max(0, (_pendingPushCount[key] || 0) - 1); },
           () => { _pendingPushCount[key] = Math.max(0, (_pendingPushCount[key] || 0) - 1); });
  return run;
}

// ═══════════════════════════════════════════════════════
// FILE D'ATTENTE DE NOUVELLES TENTATIVES (v8.0.2)
// Jusqu'ici, un envoi en échec (hors-ligne, Worker injoignable ou en erreur)
// restait non synchronisé indéfiniment tant qu'aucune connexion ou écriture
// ultérieure ne survenait sur cette clé précise (comportement accepté comme
// contrepartie — voir README, section "Limites connues"). On mémorise ici,
// PERSISTÉ dans localStorage (donc survit à un rechargement/fermeture
// d'onglet), l'ensemble des clés en échec — retentées nous-mêmes en
// arrière-plan avec un délai croissant (10s, 1min, 5min, puis reste à 5min
// tant qu'il en reste). Un seul compteur de délai GLOBAL (pas un par clé) :
// suffisant pour un usage familial où les échecs surviennent par lot
// (coupure réseau) plutôt qu'isolément.
//
// Important : la retentative passe par queueSyncPush() ci-dessus — jamais
// par un appel direct à syncPush() — pour ne jamais court-circuiter la
// sérialisation par clé déjà en place (_pushChains/_pendingPushCount) : un
// envoi de retentative et un envoi déclenché par une nouvelle frappe de
// l'utilisateur sur la MÊME clé pourraient sinon partir en parallèle, avec
// le même risque d'écrasement dans le désordre que celui déjà corrigé une
// fois (voir commentaire _pushChains juste au-dessus).
// ═══════════════════════════════════════════════════════
const PENDING_SYNC_STORAGE_KEY = 'plume_pending_sync_keys';
function getPendingSyncKeys() {
  try { const raw = JSON.parse(localStorage.getItem(PENDING_SYNC_STORAGE_KEY) || '[]'); return Array.isArray(raw) ? raw : []; }
  catch(e) { return []; }
}
function addPendingSyncKey(key) {
  const keys = new Set(getPendingSyncKeys());
  keys.add(key);
  localStorage.setItem(PENDING_SYNC_STORAGE_KEY, JSON.stringify([...keys]));
}
function removePendingSyncKey(key) {
  const keys = new Set(getPendingSyncKeys());
  if (!keys.delete(key)) return;
  localStorage.setItem(PENDING_SYNC_STORAGE_KEY, JSON.stringify([...keys]));
}
// Lecture strictement locale (IndexedDB ou localStorage), sans jamais
// déclencher le rafraîchissement en arrière-plan de loadData() : on veut
// uniquement la version locale la plus récente à repousser, pas relancer
// une lecture distante ici.
async function readLocalOnly(key) {
  if (idbStore) return await idbStore.get('data', key);
  const r = localStorage.getItem('plume_' + key);
  return r ? JSON.parse(r) : undefined;
}
const SYNC_RETRY_DELAYS_MS = [10000, 60000, 300000]; // 10s, 1min, 5min
let _syncRetryTimer = null, _syncRetryStep = 0;
function scheduleSyncRetry() {
  if (_syncRetryTimer) return; // déjà programmé, rien à faire de plus
  const delay = SYNC_RETRY_DELAYS_MS[Math.min(_syncRetryStep, SYNC_RETRY_DELAYS_MS.length - 1)];
  _syncRetryTimer = setTimeout(() => { _syncRetryTimer = null; retryPendingSyncs(); }, delay);
  _syncRetryStep++;
}
async function retryPendingSyncs() {
  const keys = getPendingSyncKeys();
  if (!keys.length) { _syncRetryStep = 0; return; }
  for (const key of keys) {
    try {
      const payload = await readLocalOnly(key);
      // Plus rien en local sous cette clé (élément supprimé entre-temps) :
      // rien à repousser, on l'oublie simplement.
      if (payload === undefined || payload === null) { removePendingSyncKey(key); continue; }
      await queueSyncPush(key, payload);
    } catch(e) { /* on retentera au prochain passage */ }
  }
  if (getPendingSyncKeys().length) scheduleSyncRetry(); // il en reste encore : on reprogramme
  else _syncRetryStep = 0;
}
// Dès que la connexion réseau revient (évènement navigateur fiable,
// contrairement à un simple minuteur), on retente tout de suite plutôt que
// d'attendre le prochain délai de la file — sans réinitialiser le compteur
// de délai : si le réseau est instable (va-et-vient), on garde une
// progression vers des délais plus longs plutôt que de retenter en boucle
// à chaque micro-coupure.
window.addEventListener('online', () => {
  if (_syncRetryTimer) { clearTimeout(_syncRetryTimer); _syncRetryTimer = null; }
  retryPendingSyncs();
});


// ═══════════════════════════════════════════════════════
// PLAFONNEMENT ADAPTATIF DU DÉBIT D'ENVOI (v9.3.1 → v9.3.3)
//
// v9.3.1 : problème rapporté le 31/07/2026 — chaque frappe déclenche, 600ms
// après la pause de frappe, un persistData() → un envoi réseau réel (une
// écriture KV Cloudflare) à CHAQUE pause. De quoi épuiser le quota gratuit
// (1000 écritures/24h) en un peu plus d'une heure, comme mesuré au tableau
// de bord Cloudflare.
//
// v9.3.3 : le logiciel pouvant servir à plusieurs personnes en même temps,
// un plafond fixe ne suffit plus (5 sessions actives en continu peuvent, à
// elles seules, approcher le quota en une heure). Deux mécanismes
// supplémentaires, cumulables :
//
//  • ESPACEMENT ADAPTATIF PAR CLÉ — l'intervalle s'allonge tant qu'un même
//    manuscrit reste écrit sans interruption : 20s au début d'une session
//    d'écriture, 45s après 3 minutes continues, 90s après 10 minutes. Il
//    revient à 20s dès qu'une vraie pause (90s sans la moindre frappe) a eu
//    lieu. Une session d'écriture courante et normale n'est donc jamais
//    ralentie ; seules les sessions très longues et ininterrompues le sont
//    davantage, précisément celles qui pesaient le plus sur le quota.
//
//  • REPLI GLOBAL PARTAGÉ — le quota KV est unique pour TOUT le compte,
//    partagé entre tous les utilisateurs : impossible de le mesurer
//    précisément depuis le navigateur sans consommer des requêtes
//    supplémentaires rien que pour le vérifier (contre-productif). En
//    revanche, si le Worker signale une vraie panne d'écriture (quota
//    épuisé ou autre — voir le 503 explicite ajouté dans sync-worker.js),
//    CE signal est par nature commun à tout le monde : le quota étant
//    partagé, n'importe quel appareil qui écrit à ce moment-là recevra
//    exactement la même réponse. Chaque appareil qui la reçoit ralentit
//    alors ELLE-MÊME ses envois pour tous ses manuscrits pendant
//    SYNC_GLOBAL_BACKOFF_MS, sans throttle prédictif : c'est la réaction
//    coordonnée d'un signal déjà partagé, pas une invention de coordination.
//
// La sauvegarde LOCALE (IndexedDB, à 600ms) n'est touchée par rien de tout
// ceci — toujours aussi rapide, rien n'est jamais perdu. Seule la fréquence
// des envois RÉSEAU change. Les moments qui comptent (perte de focus,
// fermeture de l'onglet, changement de manuscrit, Ctrl+S) continuent de
// forcer un envoi immédiat via flushPendingSyncPushes(), qui ignore
// volontairement ces délais : ce sont des actions explicites et rares,
// jamais la source du problème.
const SYNC_PUSH_BASE_INTERVAL_MS = 20000;         // 20s — début de session d'écriture
const SYNC_PUSH_TIER2_AFTER_MS = 3 * 60 * 1000;   // au-delà de 3 min d'écriture continue…
const SYNC_PUSH_TIER2_INTERVAL_MS = 45000;        // …45s d'espacement
const SYNC_PUSH_TIER3_AFTER_MS = 10 * 60 * 1000;  // au-delà de 10 min d'écriture continue…
const SYNC_PUSH_TIER3_INTERVAL_MS = 90000;        // …90s d'espacement
const SYNC_PUSH_STREAK_RESET_MS = 90000;          // 90s sans la moindre frappe = vraie pause : retour à 20s
const SYNC_GLOBAL_BACKOFF_MS = 15 * 60 * 1000;    // 15 min de répit après une panne d'écriture confirmée par le serveur

let _lastPushAt = {};          // clé → date du dernier envoi réseau réellement déclenché
let _pushDebounceTimers = {};  // clé → minuteur en attente (au plus un par clé)
let _streakStartedAt = {};     // clé → début de la rafale d'écriture continue en cours
let _lastPushAttemptAt = {};   // clé → date du dernier appel (déclenché ou différé), pour détecter une vraie pause

function getGlobalBackoffUntil() { return Number(localStorage.getItem('plume_sync_global_backoff_until') || 0); }
function setGlobalBackoffUntil(ts) { localStorage.setItem('plume_sync_global_backoff_until', String(ts)); }

function currentAdaptiveInterval(key, now) {
  if (!_streakStartedAt[key] || (now - (_lastPushAttemptAt[key] || 0)) >= SYNC_PUSH_STREAK_RESET_MS) {
    _streakStartedAt[key] = now; // nouvelle rafale d'écriture (première fois, ou après une vraie pause)
  }
  _lastPushAttemptAt[key] = now;
  const streakDuration = now - _streakStartedAt[key];
  if (streakDuration >= SYNC_PUSH_TIER3_AFTER_MS) return SYNC_PUSH_TIER3_INTERVAL_MS;
  if (streakDuration >= SYNC_PUSH_TIER2_AFTER_MS) return SYNC_PUSH_TIER2_INTERVAL_MS;
  return SYNC_PUSH_BASE_INTERVAL_MS;
}

function scheduleSyncPush(key, payload) {
  // v9.3.1 — Seules les clés de manuscrit ('doc_<profil>_<id>') sont concernées :
  // ce sont elles qui reçoivent un envoi à chaque frappe (autosave 600ms), donc
  // la source réelle de l'explosion d'écritures. L'index des profils et celui
  // de la bibliothèque ('doclist_<profil>') changent rarement (CRUD explicite,
  // pas à chaque frappe) : les espacer n'apporterait rien et retarderait des
  // opérations que l'utilisateur attend instantanées (créer un profil, etc.).
  if (!key.startsWith('doc_')) { queueSyncPush(key, payload); return; }
  // v9.3.2 — Une clé en pause de conflit (voir isConflictPaused) ne doit
  // JAMAIS faire progresser le compteur d'espacement : sinon, écrire pendant
  // qu'un conflit attend l'arbitrage de l'utilisateur retarderait ensuite,
  // sans raison, l'envoi de la RÉSOLUTION une fois le choix fait — puisque
  // syncPush() bloque de toute façon ces tentatives (rien n'est perdu), il
  // n'y a ici rien de réel à espacer.
  if (isConflictPaused(key)) { queueSyncPush(key, payload); return; }

  const now = Date.now();
  if (_pushDebounceTimers[key]) clearTimeout(_pushDebounceTimers[key]);

  // v9.3.3 — Repli global : une panne d'écriture vient d'être confirmée par
  // le serveur (voir le traitement du 503 dans syncPush) — on n'aggrave pas
  // la situation en insistant, on attend la fin du répit commun.
  const backoffUntil = getGlobalBackoffUntil();
  if (backoffUntil > now) {
    _pushDebounceTimers[key] = setTimeout(() => {
      delete _pushDebounceTimers[key];
      if (!isConflictPaused(key)) _lastPushAt[key] = Date.now();
      queueSyncPush(key, payload);
    }, backoffUntil - now);
    return;
  }

  const interval = currentAdaptiveInterval(key, now);
  const elapsed = now - (_lastPushAt[key] || 0);
  if (elapsed >= interval) {
    _lastPushAt[key] = now;
    queueSyncPush(key, payload);
  } else {
    _pushDebounceTimers[key] = setTimeout(() => {
      delete _pushDebounceTimers[key];
      // Une pause a pu démarrer PENDANT l'attente : dans ce cas, ne pas
      // marquer d'envoi réel non plus (même raisonnement que ci-dessus).
      if (!isConflictPaused(key)) _lastPushAt[key] = Date.now();
      queueSyncPush(key, payload);
    }, interval - elapsed);
  }
}
// Envoie immédiatement tout ce qui est en attente d'espacement — appelé aux
// moments où il ne faut RIEN laisser en suspens : perte de focus, fermeture
// de l'onglet, changement de manuscrit (voir les 3 points d'appel plus bas).
// Bypass volontaire de tout espacement (adaptatif ou repli global) : ce sont
// des actions explicites et rares, jamais la source du problème de quota.
function flushPendingSyncPushes() {
  for (const key of Object.keys(_pushDebounceTimers)) {
    clearTimeout(_pushDebounceTimers[key]);
    delete _pushDebounceTimers[key];
    _lastPushAt[key] = Date.now();
    // On relit la copie locale plutôt que de garder le payload capturé à la
    // planification : persistData() a de toute façon déjà écrit en local
    // avant de programmer ce minuteur, donc cette lecture est à jour et
    // évite tout risque de repousser un contenu périmé.
    readLocalOnly(key).then(payload => { if (payload !== null && payload !== undefined) queueSyncPush(key, payload); });
  }
}

async function persistData(key, payload) {
  _localWriteVersion[key] = (_localWriteVersion[key] || 0) + 1;
  if (idbStore) await idbStore.put('data', payload, key);
  else {
    if (payload === null) localStorage.removeItem('plume_' + key);
    else localStorage.setItem('plume_' + key, JSON.stringify(payload));
  }
  scheduleSyncPush(key, payload);
}
async function loadData(key) {
  let local;
  if (idbStore) local = await idbStore.get('data', key);
  else {
    let r = localStorage.getItem('plume_' + key);
    // Compat : en mode localStorage, l'ancien format mono-profil était stocké
    // sous 'plume_v55'. On le retrouve quand on cherche les données 'main'.
    if (!r && key === 'main') r = localStorage.getItem('plume_v55');
    local = r ? JSON.parse(r) : undefined;
  }
  if (local !== undefined && local !== null) {
    // Trouvé en local : on renvoie tout de suite (rapide, marche hors-ligne),
    // et on rafraîchit le cache local en arrière-plan pour la prochaine fois.
    //
    // Correction (v7.42.2) — le correctif précédent (v7.40.3, _confirmedPush-
    // Version) protégeait bien contre un envoi qui venait d'échouer PENDANT
    // la même session, mais ce compteur n'existait qu'en mémoire : il
    // repartait de zéro à chaque rechargement/réouverture. Résultat exact du
    // nouvel incident rapporté : le lendemain matin, dès le tout premier
    // chargement (aucune écriture locale encore faite dans cette nouvelle
    // session), la vérification devenait vraie par pure coïncidence
    // (0 >= 0) et laissait passer l'écrasement par la version distante
    // restée périmée — recréant exactement le bug initial.
    // Le hash connu (getKnownRemoteHash/setKnownRemoteHash, déjà utilisé
    // pour la détection de conflit) est lui PERSISTÉ dans localStorage et
    // survit à un rechargement : il est mis à jour uniquement après un
    // envoi RÉUSSI (syncPush) ou une lecture réussie (syncPull) — jamais
    // après un échec. On ne rapatrie donc désormais la version distante que
    // si la copie locale actuelle correspond exactement à ce hash connu
    // (capturé AVANT l'appel à syncPull, qui le met lui-même à jour) :
    // c'est la seule façon de savoir, de façon fiable et durable, que rien
    // de local n'est resté non confirmé auprès du Worker.
    //
    // Correction (v8.1.0, incident du 27/07/2026) — toutes les protections
    // ci-dessus répondaient à la question « ma copie locale est-elle bien
    // confirmée auprès du serveur ? ». Aucune ne répondait à la seule qui
    // compte ici : « la version que le serveur me renvoie est-elle plus
    // récente que la mienne ? ». Quand la réponse était non (serveur en
    // retard, ou écrasé par un appareil resté en arrière), la copie locale à
    // jour était remplacée par une version périmée — c'est ainsi que tous
    // les profils sauf un ont disparu. On compare désormais les numéros de
    // version attribués par le serveur : une version qui n'est pas
    // STRICTEMENT plus récente que la nôtre n'est jamais appliquée.
    const versionAtPullStart = _localWriteVersion[key] || 0;
    const knownHashAtPullStart = getKnownRemoteHash(key);
    syncPull(key).then(async ({ data: remote, version: remoteVersion }) => {
      // v8.1.0 — la condition portait aussi sur `idbStore` : sur un navigateur
      // sans IndexedDB (mode privé restrictif, quota refusé), l'appareil
      // n'appliquait donc JAMAIS les mises à jour reçues — il restait périmé
      // en permanence tout en poussant sa version. writeLocalOnly() gère
      // indifféremment IndexedDB et localStorage : la restriction saute.
      if (remote === undefined || remote === null) return;
      // Version indisponible (Worker pas encore redéployé, en-tête masqué) :
      // impossible d'arbitrer → on ne remplace rien, par sécurité.
      if (remoteVersion === null) return;
      // ── LE CONTRÔLE QUI MANQUAIT ──
      if (remoteVersion <= getSyncVersion(key)) return;
      // Une écriture locale a eu lieu pendant l'attente, ou un envoi est
      // encore en vol : on laisse cet envoi arbitrer (il sera refusé par le
      // serveur puis réconcilié sans perte, voir syncPush).
      if ((_localWriteVersion[key] || 0) !== versionAtPullStart) return;
      if (_pendingPushCount[key] > 0) return;
      try {
        // Modifications locales non encore confirmées par le serveur : on ne
        // les écrase pas. Elles seront poussées, refusées, puis réconciliées.
        const localHash = await sha256Hex(JSON.stringify(local));
        if (!knownHashAtPullStart || localHash !== knownHashAtPullStart) return;

        if (key === 'profiles') {
          // Garde-fou : un profil présent en local ne disparaît jamais.
          const merged = mergeProfilesIndex(local, remote);
          await writeLocalOnly(key, merged);
          setSyncVersion(key, remoteVersion);
          // Des profils locaux absents du serveur ? On les y renvoie.
          if (JSON.stringify(merged) !== JSON.stringify(remote)) queueSyncPush(key, merged);
        } else {
          await writeLocalOnly(key, remote);
          setSyncVersion(key, remoteVersion);
        }
      } catch(e) { /* en cas de doute, on ne remplace rien */ }
    });
    return local;
  }
  // Rien en local : premier accès à cette clé depuis cet appareil (ex.
  // nouvel appareil découvrant un profil existant) — on attend le Worker.
  const { data: remote, version: remoteVersion } = await syncPull(key);
  if (remote !== undefined && remote !== null) {
    if (idbStore) await idbStore.put('data', remote, key);
    if (remoteVersion !== null) setSyncVersion(key, remoteVersion);
    return remote;
  }
  return local ?? null;
}

// ═══════════════════════════════════════════════════════
// ÉTAT GLOBAL
// ═══════════════════════════════════════════════════════
let db = DEFAULT_DB(), _cloudToken = '', _encPassword = '';
let cur = 0, tensionChart, sessionChart, dialogChart;
let sprintInterval = null, sprintWordsStart = 0;
let sessionWordsStart = 0, sessionStartTime = Date.now();
let _switching = false;
// v7.0.0 — profil courant : identifiant, métadonnées, et clé de données (DEK)
// qui chiffre/déchiffre les données de CE profil uniquement.
let _currentProfileId = null, _currentProfile = null, _dataKey = null;
// v7.5.0 — des modifications sont-elles en attente de sauvegarde ? Utilisé
// par la confirmation de fermeture d'onglet ci-dessous (wireAppEventListenersOnce).
let _unsavedChanges = false;

const tabLabels = {
  'tab-univers':'🌍 Univers ▾','tab-ia-memoire':'🤖 IA & Mémoire ▾',
  'tab-analysegroup':'📊 Analyse ▾','tab-systeme':'🗄️ Système ▾',
  'tab-config':'⚙️ Config ▾'
};
// Descriptifs affichés en infobulle sur chaque onglet (neophytes).
const tabDescriptions = {
  'tab-univers':'Personnages, lieux, quêtes, chronologie et relations',
  'tab-ia-memoire':'Assistance IA et mémoire narrative du roman',
  'tab-analysegroup':'Statistiques, mots-clés, structure et analyse détaillée du texte',
  'tab-systeme':'Versions et plugins',
  'tab-config':'Apparence, sprint, objectifs d\'écriture, profil'
};

// ═══════════════════════════════════════════════════════
// UTILITAIRES
// ═══════════════════════════════════════════════════════
function debounce(fn, delay) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), delay); }; }
function getTodayKey() { return new Date().toISOString().slice(0,10); }
function getWordCount(t) { const m=(t||'').replace(/<[^>]*>/g,' ').match(/[a-zA-Z0-9À-ÿ]+/g); return m?m.length:0; }
function getPlainText(html) { return (html||'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/p>/gi,'\n').replace(/<[^>]*>/g,'').trim(); }

const save = async () => {
  if (!_currentProfileId || !_dataKey || !_currentDocumentId) return;
  // v9.4.2 — Incident du 14/08/2026 : une erreur ici (persistData,
  // makeEncryptedEnvelope, JSON.stringify...) restait invisible et
  // empêchait silencieusement toute sauvegarde ultérieure sur le manuscrit
  // concerné — ET bloquait "Ma bibliothèque" (backToLibrary, library.js,
  // fait "await save()" avant de naviguer : une erreur ici l'arrêtait net).
  // On affiche désormais l'erreur réelle et on laisse la fonction se
  // terminer normalement, pour ne plus jamais bloquer l'interface — même si
  // la sauvegarde, elle, a échoué.
  try {
    const payload = { ...db }; delete payload.cloudToken;
    await persistData(docDataKey(_currentProfileId, _currentDocumentId), await makeEncryptedEnvelope(JSON.stringify(payload)));
    await touchDocumentMeta();
    flashSave(); updateDailyStats();
    _unsavedChanges = false;
  } catch(e) {
    console.error('Échec de sauvegarde :', e);
    if (typeof toast === 'function') toast('⚠️ Échec de la sauvegarde : ' + (e && e.message ? e.message : e) + '. Vos derniers mots ne sont peut-être pas enregistrés — copiez votre texte par précaution.', 'error');
  }
};
// v7.5.0 : debouncedSave marque _unsavedChanges=true immédiatement (avant les
// 600ms d'attente), pour que la confirmation de fermeture d'onglet sache
// qu'une frappe récente n'est pas encore persistée.
const debouncedSave = (() => {
  const inner = debounce(save, 600);
  return () => { _unsavedChanges = true; inner(); };
})();

// ═══════════════════════════════════════════════════════
// INIT APP — câblage de tous les événements
// ═══════════════════════════════════════════════════════
function initApp(){
  if(db.darkMode)document.body.classList.add('dark-mode'); else document.body.classList.remove('dark-mode');
  // v7.7.0 — Apparence : thème papier, palette de couleurs, police d'écriture.
  document.body.classList.toggle('paper-mode', !!db.paperMode);
  applyAccentPalette(db.accentPalette);
  applyEditorFont(db.editorFont);
  const dt = document.getElementById('document-title'); if (dt) dt.innerText = db.title || '';
  sessionWordsStart=db.chapters.reduce((s,c)=>s+getWordCount(c.content),0);
  sessionStartTime=Date.now();
  // v7.6.0 : piles Annuler/Rétablir remises à zéro à chaque manuscrit ouvert
  // (elles sont propres à un document, pas à partager entre deux romans).
  _undoStacks = {}; _pendingUndoFlush = false; clearTimeout(_undoPushTimer);
  // v7.34.0 — l'historique du chat IA est propre à un manuscrit (voir ai.js) :
  // remis à zéro ici, rechargé (déchiffré) seulement à la prochaine ouverture
  // du panneau, pour ne jamais mélanger deux conversations différentes.
  resetAiChatForDocument();
  // v7.10.0 : la vue Chapitres (Liste/Fiches) revient toujours sur Liste à
  // l'ouverture d'un manuscrit — ce n'est pas une préférence mémorisée.
  setChapterViewMode('list');
  // v7.36.0 (ergonomie) — même principe pour la vue Personnages/Lieux.
  setUniverseViewMode('list');
  // v9.4.0 — Reprise à la dernière position d'écriture : on ouvre le
  // manuscrit sur le chapitre où on a tapé pour la dernière fois (au lieu
  // du chapitre 1 systématiquement). db.lastPosition est sauvegardé à
  // chaque frappe par saveCursorForResume() (editor.js).
  if (db.lastPosition && db.lastPosition.chapterId) {
    const lastIdx = db.chapters.findIndex(c => c.id === db.lastPosition.chapterId);
    if (lastIdx !== -1) cur = lastIdx;
  }
  renderTabs();renderChapterList();loadChapter(cur);updateDailyStats();
  restoreLastCursorPosition();
  renderLibrary('chars');renderLibrary('places');renderQuests();renderWeakWords();initGoalUI();
  resumeSprintIfNeeded();
  purgeOldTrash();
  updateTrashBadge();
  renderAppearanceUI();
  applyProjectTypeTerminology();
  renderSyncDot();
  updateEstimatedFinishDate();
  maybeStartOnboardingTour();

  const ctx=document.getElementById('tensionChart').getContext('2d');
  if (tensionChart) { tensionChart.destroy(); tensionChart = null; }
  tensionChart=new Chart(ctx,{type:'line',data:{labels:db.chapters.map((_,i)=>i+1),datasets:[{label:'Tension',data:db.chapters.map(c=>c.tension),borderColor:'#c0392b',backgroundColor:'rgba(192,57,43,.08)',tension:.3,fill:true}]},options:{maintainAspectRatio:false,plugins:{legend:{display:false}}}});

  const mgi=document.getElementById('manuscript-goal-input');if(mgi)mgi.value=db.wordGoal||'';

  if(db.chapters.some(c=>c.content)) { takeSnapshot(cur, 'Ouverture — '+new Date().toLocaleString('fr')); }

  // Câblage des événements : une seule fois par session (voir plus bas), pas
  // à chaque ouverture de manuscrit — sinon les écouteurs s'empileraient à
  // chaque passage par la bibliothèque (v7.4.0, correctif).
  wireAppEventListenersOnce();
}

// ═══════════════════════════════════════════════════════
// CÂBLAGE DES ÉVÉNEMENTS — une seule fois par session (v7.4.0)
// Auparavant fait dans initApp(), rappelée à chaque ouverture de manuscrit
// depuis la bibliothèque : les écouteurs s'empilaient à chaque changement de
// manuscrit (un clic déclenchait l'action 2 fois, 3 fois...). Tout ce qui ne
// dépend pas du manuscrit ouvert (juste des éléments DOM statiques) vit
// désormais ici, protégé par _appWired.
// ═══════════════════════════════════════════════════════
let _appWired = false;
function wireAppEventListenersOnce(){
  if (_appWired) return;
  _appWired = true;

  document.getElementById('add-chapter-btn').addEventListener('click',addChapter);
  document.getElementById('document-title').addEventListener('blur',e=>updateDocumentTitle(e.target.innerText.trim()));
  document.getElementById('back-to-library-btn').addEventListener('click',backToLibrary);
  document.getElementById('editor-home-btn').addEventListener('click',goHome);
  // v9.0.0 — Bouton "retour bibliothèque" toujours visible sur mobile (voir
  // index.html) : même fonction que #back-to-library-btn, pas de nouvelle
  // logique.
  document.getElementById('chapter-quick-library-btn').addEventListener('click',backToLibrary);
  document.getElementById('toolbar-library-btn').addEventListener('click',backToLibrary);
  // v7.42.1 — Tiroir repliable du panneau chapitres (mobile uniquement,
  // voir style.css) : n'a aucun effet visuel sur desktop, où ce bouton est
  // masqué (u-d-none) et #chapter-sidebar-body toujours visible.
  // drawer-collapsed posé dès le départ : filet de sécurité qui plafonne
  // #chapter-sidebar tant que le tiroir n'est pas ouvert (voir style.css).
  document.getElementById('chapter-sidebar').classList.add('drawer-collapsed');
  document.getElementById('chapter-sidebar-toggle-btn').addEventListener('click', () => {
    const body = document.getElementById('chapter-sidebar-body');
    const btn = document.getElementById('chapter-sidebar-toggle-btn');
    const sidebar = document.getElementById('chapter-sidebar');
    const nowOpen = !body.classList.contains('open');
    body.classList.toggle('open', nowOpen);
    sidebar.classList.toggle('drawer-collapsed', !nowOpen);
    btn.setAttribute('aria-expanded', String(nowOpen));
  });
  // Mise en forme riche (nouveau V56)
  document.getElementById('fmt-bold-btn').addEventListener('click',()=>formatText('bold'));
  document.getElementById('fmt-italic-btn').addEventListener('click',()=>formatText('italic'));
  document.getElementById('fmt-underline-btn').addEventListener('click',()=>formatText('underline'));
  document.getElementById('undo-btn').addEventListener('click',undoEdit);
  document.getElementById('redo-btn').addEventListener('click',redoEdit);
  document.getElementById('fmt-title-btn').addEventListener('click',()=>formatParagraph('h3'));
  document.getElementById('fmt-para-btn').addEventListener('click',()=>formatParagraph('p'));
  // v9.5.0 — Surlignage manuel (8 couleurs + "Aucun" pour retirer). Les
  // fonctions highlightSelection()/removeHighlight() sont définies dans
  // editor.js, juste après formatParagraph().
  document.querySelectorAll('.hl-swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.hl;
      if (color === 'none') removeHighlight(); else highlightSelection(color);
    });
  });
  document.getElementById('analyze-btn').addEventListener('click',analyzeStyle);
  document.getElementById('clear-btn').addEventListener('click',clearStyle);
  document.getElementById('search-btn').addEventListener('click', handleSearch);
  document.getElementById('lex-panel-close').addEventListener('click', () => document.getElementById('lex-panel').classList.remove('active'));
  document.getElementById('writer').addEventListener('mouseup', saveCursorPosition);
  document.getElementById('writer').addEventListener('keyup', saveCursorPosition);
  document.getElementById('toggle-dark-btn').addEventListener('click',toggleMode);
  document.querySelectorAll('#palette-picker .palette-swatch').forEach(btn=>btn.addEventListener('click',()=>selectPalette(btn.dataset.palette)));
  document.querySelectorAll('#theme-picker .mode-indicator').forEach(btn=>btn.addEventListener('click',()=>selectTheme(btn.dataset.theme)));
  // Menu ⋮ des chapitres — élément unique, câblé une seule fois (v7.8.1)
  document.getElementById('cctx-rename').addEventListener('click',()=>{const i=_ctxMenuChapterIdx;closeAllChapterMenus();if(i!==null)renameChapterInline(i);});
  document.getElementById('cctx-tags').addEventListener('click',()=>{const i=_ctxMenuChapterIdx;closeAllChapterMenus();if(i!==null)editChapterTags(i);});
  document.getElementById('cctx-dup').addEventListener('click',()=>{const i=_ctxMenuChapterIdx;closeAllChapterMenus();if(i!==null)duplicateChapter(i);});
  document.getElementById('cctx-del').addEventListener('click',()=>{const i=_ctxMenuChapterIdx;closeAllChapterMenus();if(i!==null)deleteChapter(i);});
  document.getElementById('chapter-list').addEventListener('scroll',closeAllChapterMenus);
  window.addEventListener('resize',closeAllChapterMenus);
  // Bascule Liste / Fiches (corkboard) — nouveau v7.10.0 (Lot 6).
  document.getElementById('view-list-btn').addEventListener('click',()=>setChapterViewMode('list'));
  document.getElementById('view-cork-btn').addEventListener('click',()=>setChapterViewMode('cork'));
  document.querySelectorAll('#font-picker .font-option').forEach(el=>{
    el.addEventListener('click',()=>selectFont(el.dataset.font));
    el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectFont(el.dataset.font);}});
  });
  document.getElementById('add-weak-word-btn').addEventListener('click',addWeakWord);
  document.getElementById('add-quest-btn').addEventListener('click',addQuest);
  document.getElementById('add-char-btn').addEventListener('click',()=>addItem('chars'));
  document.getElementById('add-place-btn').addEventListener('click',()=>addItem('places'));
  document.querySelectorAll('.uni-view-list-btn').forEach(b=>b.addEventListener('click',()=>setUniverseViewMode('list')));
  document.querySelectorAll('.uni-view-cards-btn').forEach(b=>b.addEventListener('click',()=>setUniverseViewMode('cards')));
  document.getElementById('open-trash-btn').addEventListener('click',openTrash);
  document.getElementById('trash-close-btn').addEventListener('click',closeTrash);
  document.getElementById('reading-mode-btn').addEventListener('click',enterReadingMode);
  document.getElementById('reading-close-btn').addEventListener('click',exitReadingMode);
  document.getElementById('sprint-start-btn').addEventListener('click',startSprint);
  document.getElementById('sprint-reset-btn').addEventListener('click',resetSprint);

  document.getElementById('focus-btn').addEventListener('click',enterFocus);
  document.getElementById('focus-close-btn').addEventListener('click',exitFocus);
  document.getElementById('focus-writer').addEventListener('input',updateFocusCount);

  document.getElementById('ai-summary-btn').addEventListener('click',generateAISummary);
  document.getElementById('ai-panel-close').addEventListener('click',()=>document.getElementById('ai-summary-panel').classList.remove('active'));
  document.getElementById('ai-summary-copy').addEventListener('click',copyAISummaryToChapter);
  document.getElementById('ai-continue-btn').addEventListener('click',aiContinueSuggestions);
  document.getElementById('ai-check-btn').addEventListener('click',aiCheckInconsistencies);
  document.getElementById('ai-names-btn').addEventListener('click',aiGenerateNames);

  document.getElementById('ai-chat-btn').addEventListener('click',toggleAiChat);
  document.getElementById('ai-chat-close-btn').addEventListener('click',closeAiChat);
  document.getElementById('ai-chat-reset-btn').addEventListener('click',resetAiChatConversation);
  document.getElementById('ai-chat-send-btn').addEventListener('click',sendAiChatMessage);
  document.getElementById('ai-chat-input').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();sendAiChatMessage();}});
  document.getElementById('ai-selection-to-chat-btn').addEventListener('click',sendManuscriptSelectionToChat);

  document.getElementById('wc-gen-btn').addEventListener('click',renderWordCloud);
  document.getElementById('tl-add-btn').addEventListener('click',addTimelineEvent);

  document.getElementById('snapshot-btn').addEventListener('click',()=>{flushCurrentChapter();takeSnapshot(cur,'Manuel — '+new Date().toLocaleString('fr'));save();renderHistoryTab();toast('Snapshot sauvegardé','success');});
  document.getElementById('open-diff-btn').addEventListener('click',()=>openDiffViewer());
  document.getElementById('history-close-btn').addEventListener('click',()=>document.getElementById('history-overlay').classList.remove('active'));

  document.getElementById('graph-rebuild-btn').addEventListener('click',renderGraph);

  document.getElementById('voice-btn').addEventListener('click',()=>document.getElementById('tts-panel').classList.toggle('active'));
  document.getElementById('tts-close-btn').addEventListener('click',()=>document.getElementById('tts-panel').classList.remove('active'));
  document.getElementById('tts-play-btn').addEventListener('click',ttsPlay);
  document.getElementById('tts-pause-btn').addEventListener('click',ttsPause);
  document.getElementById('tts-stop-btn').addEventListener('click',ttsStop);
  document.getElementById('dictate-btn').addEventListener('click',toggleDictation);
  document.getElementById('tts-rate').addEventListener('input',e=>{document.getElementById('tts-rate-val').textContent=parseFloat(e.target.value).toFixed(1)+'×';});
  initTTS(); initDictation();

  document.getElementById('writer').addEventListener('input',liveCounter);
  document.getElementById('chapter-title').addEventListener('blur',e=>updateTitle(e.target.innerText.trim()));
  document.getElementById('tension-slider').addEventListener('input',e=>updateTension(e.target.value));
  document.getElementById('chapter-status-sel').addEventListener('change',e=>{db.chapters[cur].status=e.target.value;renderChapterList();debouncedSave();});
  document.getElementById('find-replace-btn').addEventListener('click',openFindReplace);
  document.getElementById('fr-panel-close').addEventListener('click',closeFindReplace);
  document.getElementById('fr-find-input').addEventListener('input',doFind);
  document.getElementById('fr-next-btn').addEventListener('click',frNext);
  document.getElementById('fr-replace-btn').addEventListener('click',frReplaceOne);
  document.getElementById('fr-replace-all-btn').addEventListener('click',frReplaceAll);
  document.getElementById('daily-goal-input').addEventListener('input',e=>{db.dailyGoal=parseInt(e.target.value)||500;debouncedSave();updateDailyStats();});
  document.getElementById('weekly-goal-input').addEventListener('input',e=>{db.weeklyGoal=parseInt(e.target.value)||3000;debouncedSave();updateGoalsUI();});
  document.getElementById('monthly-goal-input').addEventListener('input',e=>{db.monthlyGoal=parseInt(e.target.value)||12000;debouncedSave();updateGoalsUI();});
  document.getElementById('manuscript-goal-input').addEventListener('input',e=>{db.wordGoal=parseInt(e.target.value)||0;debouncedSave();updateEstimatedFinishDate();});
  document.getElementById('project-type-sel').addEventListener('change',e=>selectProjectType(e.target.value));
  document.getElementById('chapter-notes-toggle-btn').addEventListener('click',()=>{
    document.getElementById('chapter-notes-panel').classList.toggle('u-d-none');
  });
  document.getElementById('chapter-word-goal-input').addEventListener('input',e=>{
    db.chapters[cur].wordGoal=parseInt(e.target.value)||0;debouncedSave();updateChapterWordGoalProgress();
  });
  document.getElementById('chapter-research-notes').addEventListener('input',e=>{
    db.chapters[cur].researchNotes=e.target.value;debouncedSave();
  });
  document.getElementById('onboarding-tour-skip-btn').addEventListener('click',endOnboardingTour);
  document.getElementById('onboarding-tour-next-btn').addEventListener('click',onboardingNext);
  // v7.0.0 — profils
  document.getElementById('my-profile-btn').addEventListener('click',openMyProfile);
  document.getElementById('logout-btn').addEventListener('click',logout);
  const manageBtn = document.getElementById('manage-profiles-btn');
  if (_currentProfile && _currentProfile.role === 'admin') { manageBtn.style.display=''; manageBtn.addEventListener('click',openManageProfiles); }
  else { manageBtn.style.display='none'; }
  document.getElementById('mp-save-name-btn').addEventListener('click',saveMyName);
  document.getElementById('mp-save-pwd-btn').addEventListener('click',saveMyPassword);
  document.getElementById('mp-save-question-btn').addEventListener('click',saveMyQuestion);
  document.getElementById('my-profile-close-btn').addEventListener('click',closeMyProfile);
  document.getElementById('manage-profiles-close-btn').addEventListener('click',closeManageProfiles);
  document.getElementById('manage-add-profile-btn').addEventListener('click',adminAddProfile);

  document.getElementById('global-search-btn').addEventListener('click',openGlobalSearch);
  document.getElementById('search-input').addEventListener('input',e=>debouncedSearch(e.target.value));
  document.getElementById('search-overlay').addEventListener('click',e=>{if(e.target===e.currentTarget)closeGlobalSearch();});

  document.getElementById('new-weak-word').addEventListener('keydown',e=>{if(e.key==='Enter')addWeakWord();});
  document.getElementById('q-in').addEventListener('keydown',e=>{if(e.key==='Enter')addQuest();});
  document.getElementById('tl-event-text').addEventListener('keydown',e=>{if(e.key==='Enter')addTimelineEvent();});
  document.getElementById('lex-in').addEventListener('keydown',e=>{if(e.key==='Enter')handleSearch();});

  // Filtres de recherche dans les listes Personnages / Lieux / Quêtes (v7.5.0)
  document.getElementById('char-filter').addEventListener('input',e=>filterChars(e.target.value));
  document.getElementById('place-filter').addEventListener('input',e=>filterPlaces(e.target.value));
  document.getElementById('quest-filter').addEventListener('input',e=>filterQuests(e.target.value));

  // Aide-mémoire des raccourcis clavier (v7.5.0)
  document.getElementById('shortcuts-close-btn').addEventListener('click',closeShortcutsHelp);
  document.getElementById('shortcuts-hint-btn').addEventListener('click',openShortcutsHelp);

  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key==='f'){e.preventDefault();openGlobalSearch();}
    if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();flushCurrentChapter();save();flushPendingSyncPushes();}
    // v7.6.0 : Annuler/Rétablir — exclu des autres champs de saisie (voir
    // isTypingTarget dans editor.js) pour ne pas gêner le undo natif ailleurs
    // (ex. mode Focus, titres) ni un vrai Ctrl+Z dans un champ de recherche.
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!isTypingTarget(e.target)&&!document.getElementById('focus-overlay').classList.contains('active')){
      e.preventDefault(); if(e.shiftKey) redoEdit(); else undoEdit();
    }
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'&&!isTypingTarget(e.target)&&!document.getElementById('focus-overlay').classList.contains('active')){
      e.preventDefault(); redoEdit();
    }
    // v7.5.0 : "?" ouvre l'aide-mémoire, sauf si l'utilisateur est en train de
    // taper (sinon impossible d'écrire un vrai "?" dans le texte du roman).
    if(e.key==='?' && e.target.tagName!=='INPUT' && e.target.tagName!=='TEXTAREA' && !e.target.isContentEditable){
      e.preventDefault();openShortcutsHelp();
    }
    if(e.key==='Escape'){
      if(document.getElementById('focus-overlay').classList.contains('active'))exitFocus();
      if(document.getElementById('search-overlay').classList.contains('active'))closeGlobalSearch();
      if(document.getElementById('history-overlay').classList.contains('active'))document.getElementById('history-overlay').classList.remove('active');
      if(document.getElementById('ai-summary-panel').classList.contains('active'))document.getElementById('ai-summary-panel').classList.remove('active');
      if(document.getElementById('tts-panel').classList.contains('active'))document.getElementById('tts-panel').classList.remove('active');
      if(document.getElementById('lex-panel').classList.contains('active'))document.getElementById('lex-panel').classList.remove('active');
      if(document.getElementById('fr-panel').classList.contains('active'))closeFindReplace();
      if(document.getElementById('gist-history-overlay').classList.contains('active'))closeGistHistory();
      if(document.getElementById('trash-overlay').classList.contains('active'))closeTrash();
      if(document.getElementById('reading-overlay').classList.contains('active'))exitReadingMode();
      if(document.getElementById('export-select-overlay').classList.contains('active'))closeExportSelect();
      if(document.getElementById('shortcuts-overlay').classList.contains('active'))closeShortcutsHelp();
      if(document.getElementById('docx-import-overlay').classList.contains('active'))closeDocxImportModal();
      if(document.getElementById('chapter-ctx-menu').classList.contains('open'))closeAllChapterMenus();
      // v9.1.1 — Bug d'accessibilité rapporté (test clavier) : Échap ne
      // fermait ni les menus déroulants de la barre d'outils, ni 6 fenêtres
      // (Mon profil, Gérer les profils, Système bibliothèque, chat IA,
      // notes de chapitre, confirmation) — simplement absentes de cette
      // liste jusqu'ici.
      document.querySelectorAll('.toolbar-menu.open').forEach(m=>m.classList.remove('open'));
      if(document.getElementById('my-profile-overlay').classList.contains('active'))closeMyProfile();
      if(document.getElementById('manage-profiles-overlay').classList.contains('active'))closeManageProfiles();
      if(document.getElementById('library-system-overlay').classList.contains('active'))closeLibrarySystemPanel();
      if(document.getElementById('ai-chat-panel').classList.contains('active'))closeAiChat();
      if(!document.getElementById('chapter-notes-panel').classList.contains('u-d-none'))document.getElementById('chapter-notes-panel').classList.add('u-d-none');
      // La modale de confirmation a besoin de résoudre sa promesse comme un
      // vrai clic sur "Annuler" (showConfirmModal(), notifications.js) —
      // simuler ce clic plutôt que retirer la classe directement.
      if(document.getElementById('confirm-modal-overlay').classList.contains('active'))document.getElementById('confirm-modal-cancel-btn').click();
    }
    // v9.1.1 — Bug d'accessibilité rapporté (test clavier) : rien n'empêchait
    // Tab de faire sortir le focus d'une fenêtre ouverte vers la page
    // derrière. Générique : s'applique à toute fenêtre role="dialog"
    // actuellement visible (couvre déjà toutes les fenêtres existantes,
    // et les futures sans rien à modifier ailleurs), boucle Tab/Maj+Tab à
    // l'intérieur de ses éléments focusables.
    if(e.key==='Tab'){
      const openDialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
        .filter(d => d.offsetWidth > 0 || d.offsetHeight > 0 || d.getClientRects().length > 0);
      if(openDialogs.length){
        const dialog = openDialogs.find(d => d.contains(document.activeElement)) || openDialogs[openDialogs.length-1];
        const focusable = Array.from(dialog.querySelectorAll(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
        )).filter(el => el.offsetWidth>0||el.offsetHeight>0||el.getClientRects().length>0);
        if(focusable.length){
          const first = focusable[0], last = focusable[focusable.length-1];
          if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
          else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
          else if(!dialog.contains(document.activeElement)){ e.preventDefault(); first.focus(); }
        }
      }
    }
  });

  // v7.5.0 : confirmation avant de fermer/recharger l'onglet s'il reste des
  // modifications non encore persistées (frappe des 600 dernières ms).
  window.addEventListener('beforeunload', e => {
    // v9.3.1 — Idem visibilitychange : ne rien laisser en suspens à la
    // fermeture (best-effort, sans attendre — le navigateur ne garantit
    // pas qu'une requête réseau ait le temps de se terminer ici).
    flushPendingSyncPushes();
    if (_unsavedChanges) { e.preventDefault(); e.returnValue = ''; }
  });

  document.getElementById('memory-index-btn').addEventListener('click', indexNarrative);
  document.getElementById('memory-query-btn').addEventListener('click', queryNarrativeMemory);
  document.getElementById('memory-query-input').addEventListener('keydown', e => { if(e.key==='Enter') queryNarrativeMemory(); });

  // Menus déroulants de la toolbar + sous-navigation des onglets groupés (v7.4.0)
  relocateLexToolsForMobile();
  initToolbarDropdowns();
  initToolbarPin();
  initSubtabNavs();
}

// Menus déroulants de la barre d'outils (¶ Paragraphe / 🛠️ Outils / 🔎 Rechercher).
// v9.2.3 — Demande explicite de l'utilisateur : sur PC, Synonymes/Antonymes
// reste dans la barre d'outils (inchangé). Sur mobile, faute de place, ce
// bloc rejoint IA & Mémoire → IA (voir #ia-lex-tools-mount, index.html).
// Fait une seule fois au chargement (comme le reste de l'app, qui ne réagit
// pas à un redimensionnement en direct) — rouvrir/recharger l'app suffit si
// l'appareil change.
function relocateLexToolsForMobile() {
  const wrapper = document.getElementById('lex-tools-wrapper');
  const mount = document.getElementById('ia-lex-tools-mount');
  if (!wrapper || !mount) return;
  if (window.innerWidth <= 768) {
    // Une fois dans l'onglet IA, plus besoin du repli derrière ✨▾ : la
    // place ne manque pas comme dans la barre d'outils.
    const toggleBtn = document.getElementById('lex-tools-toggle-btn');
    const group = document.getElementById('lex-tools-group');
    if (toggleBtn) toggleBtn.classList.add('u-d-none');
    if (group) { group.classList.remove('open'); group.classList.add('u-d-flex'); group.style.display = 'flex'; }
    mount.appendChild(wrapper);
    mount.classList.remove('u-d-none');
  }
}

// v9.2.3 — Nouveau bouton du menu "Outils" : insère la date et l'heure
// actuelles à l'endroit du curseur dans le texte (même mécanisme que
// l'insertion d'un synonyme, voir insertWordAtCursor()/saveCursorPosition()
// dans panels.js).
function insertDateTimeAtCursor() {
  saveCursorPosition();
  const now = new Date();
  const formatted = now.toLocaleDateString('fr-FR') + ' ' + now.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
  insertWordAtCursor(formatted);
}

// v9.5.4 — Épinglage de la barre d'outils au défilement (mobile uniquement,
// voir .toolbar-fixed dans style.css). Demande précise : la barre reste à
// sa place normale tant qu'on est en haut de l'écran ; dès qu'on défile
// assez pour qu'elle sortirait de l'écran, elle se fixe en haut pour rester
// accessible ; en remontant jusqu'à son emplacement d'origine, elle
// redevient normale — exactement le comportement de position:sticky, mais
// recréé ici en JavaScript car sticky s'est révélé peu fiable dans cette
// mise en page (grid + flex imbriqués). #toolbar-sentinel (index.html) est
// un repère invisible placé exactement à l'emplacement naturel de la barre :
// IntersectionObserver nous dit en temps réel, et sans la moindre ambiguïté
// d'ancêtre CSS, quand ce repère quitte l'écran par le haut (son
// boundingClientRect.top devient négatif) — c'est le seul signal fiable
// utilisé ici. threshold:0 suffit, on n'a besoin de savoir que "visible ou
// pas", pas d'un pourcentage de visibilité.
function initToolbarPin(){
  const sentinel = document.getElementById('toolbar-sentinel');
  const toolbar = document.querySelector('.toolbar');
  const wrapper = document.getElementById('editor-wrapper');
  if (!sentinel || !toolbar || !wrapper || typeof IntersectionObserver === 'undefined') return;
  new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const pinned = entry.boundingClientRect.top < 0;
      toolbar.classList.toggle('toolbar-fixed', pinned);
      wrapper.classList.toggle('toolbar-fixed-active', pinned);
    });
  }, { threshold: 0 }).observe(sentinel);
}
function initToolbarDropdowns(){
  document.querySelectorAll('.toolbar-dropdown').forEach(dd=>{
    const trigger=dd.querySelector('.toolbar-dropdown-btn');
    const menu=dd.querySelector('.toolbar-menu');
    trigger.addEventListener('click',e=>{
      e.stopPropagation();
      const wasOpen=menu.classList.contains('open');
      document.querySelectorAll('.toolbar-menu.open').forEach(m=>m.classList.remove('open'));
      if(!wasOpen)menu.classList.add('open');
    });
    menu.querySelectorAll('button').forEach(item=>{
      item.addEventListener('click',()=>menu.classList.remove('open'));
    });
  });
  // v7.42.1 — Bascule Synonymes/Antonymes (mobile uniquement, voir
  // style.css) : même principe que les menus ci-dessus, sans réutiliser
  // .toolbar-dropdown/.toolbar-menu (qui sont masqués par défaut même sur
  // desktop) car ce bloc doit, lui, rester visible en permanence sur
  // desktop — seul son comportement mobile change.
  const lexBtn = document.getElementById('lex-tools-toggle-btn');
  const lexGroup = document.getElementById('lex-tools-group');
  lexBtn.addEventListener('click', e => {
    e.stopPropagation();
    const wasOpen = lexGroup.classList.contains('open');
    document.querySelectorAll('.toolbar-menu.open').forEach(m=>m.classList.remove('open'));
    lexGroup.classList.toggle('open', !wasOpen);
    lexBtn.setAttribute('aria-expanded', String(!wasOpen));
  });
  document.getElementById('search-btn').addEventListener('click', () => {
    lexGroup.classList.remove('open');
    lexBtn.setAttribute('aria-expanded', 'false');
  });
  document.getElementById('insert-datetime-btn').addEventListener('click', insertDateTimeAtCursor);
  document.addEventListener('click', e => {
    // v7.43.2 — Bug bloquant rapporté : ce gestionnaire refermait le
    // panneau Synonymes/Antonymes (et les menus déroulants) même quand le
    // clic avait lieu À L'INTÉRIEUR d'eux (choisir "Antonymes" dans la
    // liste, ou toucher le champ texte) — un clic sur un <select> ou un
    // <input> remonte normalement jusqu'à document. Sur mobile, ça rendait
    // la fonction Synonymes totalement inutilisable : impossible de choisir
    // le type ou de taper un mot sans que le panneau se referme aussitôt.
    if (!e.target.closest('.toolbar-dropdown')) {
      document.querySelectorAll('.toolbar-menu.open').forEach(m=>m.classList.remove('open'));
    }
    if (!e.target.closest('#lex-tools-group') && e.target !== lexBtn && !lexBtn.contains(e.target)) {
      lexGroup.classList.remove('open');
      lexBtn.setAttribute('aria-expanded', 'false');
    }
    closeAllChapterMenus();
  });
}

// ═══════════════════════════════════════════════════════
// SAUVEGARDE AUTO À LA PERTE DE FOCUS (nouveau v7.13.0, Lot 10)
// Alternative fiable à un dialogue "sauvegarder avant de fermer" : les
// navigateurs n'autorisent plus de texte personnalisé sur ce dialogue, et ne
// garantissent pas qu'une requête réseau ait le temps de se terminer avant
// la fermeture réelle de l'onglet. Ici, la page reste vivante assez
// longtemps après avoir perdu le focus pour que l'envoi se termine.
// ═══════════════════════════════════════════════════════
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    // v9.3.1 — Rien ne doit rester en suspens plus longtemps que nécessaire
    // quand l'onglet passe en arrière-plan (voir SYNC_PUSH_MIN_INTERVAL_MS).
    flushPendingSyncPushes();
    if (typeof syncAllLibraryManuscripts === 'function') syncAllLibraryManuscripts('focus-loss');
  }
});

// ═══════════════════════════════════════════════════════
// BOOTSTRAP — v7.0.0 : passe par le système de profils (voir profiles.js)
// v7.22.0 : si cet appareil ne connaît pas encore la clé de synchronisation
// (et n'a jamais choisi de s'en passer), on demande d'abord cette clé — voir
// renderSyncKeyGate() dans profiles.js — avant même l'écran de connexion.
// ═══════════════════════════════════════════════════════
window.onload = async () => {
  document.title = 'Plume · v' + APP_VERSION;
  const verEl = document.getElementById('app-version-label');
  if (verEl) verEl.textContent = 'Plume · v' + APP_VERSION;
  const libVerEl = document.getElementById('library-version-label');
  if (libVerEl) libVerEl.textContent = 'Plume · v' + APP_VERSION;
  await initIDB();
  // v8.0.2 — Si des clés étaient restées en échec lors de la dernière
  // session (fermeture de l'onglet avant la fin du backoff), on reprend
  // tout de suite, sans attendre la prochaine connexion ou écriture.
  if (getPendingSyncKeys().length) scheduleSyncRetry();
  // v7.40.0 — bascule afficher/masquer sur les champs statiques (présents
  // dans index.html dès le chargement, contrairement aux écrans gate qui se
  // reconstruisent à chaque rendu — voir profiles.js pour ceux-là).
  // lib-sync-key-input a déjà son propre bouton de révélation dédié
  // (lib-sync-key-reveal-btn, library.js) — pas de bascule ajoutée dessus,
  // pour éviter un doublon d'icône.
  initPasswordToggle('mp-old-pwd');
  initPasswordToggle('mp-new-pwd');
  initPasswordToggle('mp-new-pwd2');
  initPasswordToggle('lib-gh-token');
  if (needsSyncKeySetup()) renderSyncKeyGate();
  else await bootProfiles();
};
