'use strict';
// ═══════════════════════════════════════════════════════════════════════
// BIBLIOTHÈQUE MULTI-MANUSCRITS (v7.2.0)
//
// Chaque profil peut désormais contenir PLUSIEURS manuscrits distincts,
// plutôt qu'un seul comme avant. Après connexion, l'utilisateur arrive sur
// cette bibliothèque, choisit un manuscrit existant ou en crée un nouveau,
// et se retrouve dans l'éditeur habituel.
//
// Stockage :
//   'doclist_<profileId>' → index en clair { version, documents:[{id,title,
//      lastModified,chapterCount,wordCount}] } — pas de contenu sensible.
//   'doc_<profileId>_<docId>' → { _enc:true, data:<cipher> }, contenu
//      toujours chiffré par la DEK du profil, exactement comme avant.
//
// Migration : les profils créés avant cette fonctionnalité (v7.0/v7.1)
// stockaient leur unique roman sous 'data_<profileId>'. Au premier passage
// par la bibliothèque, ce roman devient automatiquement le premier
// manuscrit — voir migrateLegacyDocumentIfNeeded().
// ═══════════════════════════════════════════════════════════════════════

let _currentDocumentId = null;
// Vue bibliothèque : grille (par défaut) ou étagère façon dos de livres —
// nouveau v7.11.0 (Lot 7). Jamais mémorisée : remise à 'grid' à chaque
// entrée dans la bibliothèque (voir enterLibrary()).
let _libraryViewMode = 'grid';

// Couvertures personnalisables par manuscrit (nouveau v7.9.0) — liste dédiée,
// distincte des palettes d'interface (Config > Apparence) : plus décorative,
// 10 choix + « Automatique » (couleurs actuelles de l'interface).
const COVER_PALETTES = {
  'rouge-violet':   { label:'Rouge & Violet',   a:'#c0392b', b:'#8e44ad' },
  'bleu-ocean':     { label:'Bleu Océan',        a:'#277ab1', b:'#12836d' },
  'emeraude':       { label:'Émeraude',          a:'#1d8448', b:'#2c3e50' },
  'rose-poudre':    { label:'Rose Poudré',       a:'#c2185b', b:'#8b7324' },
  'ardoise':        { label:'Ardoise',           a:'#34495e', b:'#6d7879' },
  'coucher-soleil': { label:'Coucher de Soleil', a:'#a0660b', b:'#cf4435' },
  'nuit-etoilee':   { label:'Nuit Étoilée',      a:'#16213e', b:'#6a3093' },
  'sepia':          { label:'Sépia',             a:'#6d4c41', b:'#3e2723' },
  'corail':         { label:'Corail',            a:'#c74b5d', b:'#a46343' },
  'lavande':        { label:'Lavande',           a:'#7a6aa7', b:'#5b3a8e' },
  // v7.36.0 (ergonomie) — 10 couvertures supplémentaires, avec un motif léger
  // en surimpression (voir classes .cover-motif-* dans style.css) plutôt que
  // des dégradés unis pour certaines d'entre elles.
  'foret-mystique': { label:'Forêt Mystique',      a:'#1b4332', b:'#081c15', motif:'hachures' },
  'or-et-nuit':     { label:'Or et Nuit',          a:'#1a1a3e', b:'#8c711b', motif:'etoiles' },
  'terre-cuite':    { label:'Terre Cuite',         a:'#9c6b49', b:'#7a4a2b', motif:'lin' },
  'glacier':        { label:'Glacier',             a:'#3a7896', b:'#3d7d99', motif:'givre' },
  'vin-profond':    { label:'Vin Profond',         a:'#5e1a33', b:'#2c0a17', motif:'grain' },
  'encre-de-chine': { label:'Encre de Chine',      a:'#2b2b2b', b:'#0a0a0a', motif:'pinceau' },
  'aurore':         { label:'Aurore',              a:'#aa5c78', b:'#5b2a86', motif:'vagues' },
  'bronze-antique': { label:'Bronze Antique',      a:'#9e6a3e', b:'#4a3220', motif:'croisillons' },
  'jade':           { label:'Jade',                a:'#0b6e4f', b:'#093824' },
  'poussiere-etoiles': { label:'Poussière d\'étoiles', a:'#241654', b:'#4b2e83', motif:'etoiles' }
};
let _coverPickerDocId = null;
function closeCoverPicker() {
  const menu = document.getElementById('cover-picker-menu');
  if (menu) menu.classList.remove('open');
  _coverPickerDocId = null;
}
function openCoverPicker(docId, btn) {
  const menu = document.getElementById('cover-picker-menu');
  const alreadyOpenForThis = menu.classList.contains('open') && _coverPickerDocId === docId;
  closeCoverPicker();
  if (alreadyOpenForThis) return; // un second clic sur le même 🎨 referme le menu
  _coverPickerDocId = docId;
  const rect = btn.getBoundingClientRect();
  menu.style.visibility = 'hidden';
  menu.classList.add('open');
  const w = menu.offsetWidth || 140;
  let left = rect.left;
  const maxLeft = window.innerWidth - w - 8;
  if (left > maxLeft) left = maxLeft;
  if (left < 8) left = 8;
  menu.style.left = left + 'px';
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.style.visibility = 'visible';
}
async function selectCover(key) {
  const docId = _coverPickerDocId;
  closeCoverPicker();
  if (!docId) return;
  await mutateDocList(list => {
    const entry = list.documents.find(d => d.id === docId);
    if (entry) entry.cover = key; // 'auto' ou une clé de COVER_PALETTES
  });
  await renderLibraryScreen();
}

// ═══════════════════════════════════════════════════════
// MENU ⋮ DES MANUSCRITS (nouveau v7.13.0, Lot 10)
// Un seul menu partagé (position:fixed, ADR-17 — même patron que le menu ⋮
// des chapitres, editor.js), utilisé en vue Grille ET Étagère. Regroupe ce
// qui était avant 2 boutons séparés (🎨/🗑️) + un nouveau raccourci Export.
// ═══════════════════════════════════════════════════════
let _libraryCtxMenuDocId = null, _libraryCtxMenuBtn = null;
function closeLibraryCtxMenu() {
  const menu = document.getElementById('library-ctx-menu');
  if (menu) menu.classList.remove('open');
  document.querySelectorAll('.library-card.menu-open, .lib-book.menu-open').forEach(el => el.classList.remove('menu-open'));
  _libraryCtxMenuDocId = null;
  _libraryCtxMenuBtn = null;
}
function openLibraryCtxMenu(docId, btn) {
  const menu = document.getElementById('library-ctx-menu');
  const alreadyOpenForThis = menu.classList.contains('open') && _libraryCtxMenuDocId === docId;
  closeLibraryCtxMenu();
  if (alreadyOpenForThis) return;
  _libraryCtxMenuDocId = docId;
  _libraryCtxMenuBtn = btn;
  const item = btn.closest('.library-card, .lib-book');
  if (item) item.classList.add('menu-open');
  const rect = btn.getBoundingClientRect();
  menu.style.visibility = 'hidden';
  menu.classList.add('open');
  const w = menu.offsetWidth || 180;
  let left = rect.right - w;
  if (left < 8) left = 8;
  const maxLeft = window.innerWidth - w - 8;
  if (left > maxLeft) left = maxLeft;
  menu.style.left = left + 'px';
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.style.visibility = 'visible';
}

function docListKey(profileId) { return 'doclist_' + profileId; }
function docDataKey(profileId, docId) { return 'doc_' + profileId + '_' + docId; }

// v7.40.2 — Menu "Plus d'actions" de la topbar bibliothèque (mobile
// uniquement, voir style.css) : même patron fixed-position que
// openLibraryCtxMenu()/closeLibraryCtxMenu() ci-dessus, mais ancré sous un
// bouton fixe plutôt qu'un bouton par carte.
function closeLibDropdowns() {
  document.querySelectorAll('#library-topbar .lib-dropdown').forEach(dd => {
    const m = dd.querySelector('.toolbar-menu'), t = dd.querySelector('button');
    if (m) m.classList.remove('open');
    if (t) t.setAttribute('aria-expanded', 'false');
  });
}
function closeLibraryTopbarMenu() {
  const menu = document.getElementById('library-topbar-overflow-menu');
  if (menu) menu.classList.remove('open');
}
function openLibraryTopbarMenu() {
  const menu = document.getElementById('library-topbar-overflow-menu');
  const btn = document.getElementById('library-topbar-more-btn');
  const alreadyOpen = menu.classList.contains('open');
  closeLibraryTopbarMenu();
  if (alreadyOpen) return;
  const rect = btn.getBoundingClientRect();
  menu.style.visibility = 'hidden';
  menu.classList.add('open');
  const w = menu.offsetWidth || 200;
  let left = rect.right - w;
  if (left < 8) left = 8;
  const maxLeft = window.innerWidth - w - 8;
  if (left > maxLeft) left = maxLeft;
  menu.style.left = left + 'px';
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.style.visibility = 'visible';
}
function toggleLibraryTopbarMenu() {
  document.getElementById('library-topbar-overflow-menu').classList.contains('open')
    ? closeLibraryTopbarMenu() : openLibraryTopbarMenu();
}

// v7.22.0 — Après une connexion réussie, si une clé de synchronisation est
// configurée sur cet appareil (voir router.js), on pousse tout de suite
// l'ensemble de la bibliothèque de ce profil vers le Worker (arrière-plan,
// non bloquant) : ça garantit qu'un AUTRE appareil configuré avec la même
// clé retrouvera la totalité des manuscrits dès sa première connexion,
// sans attendre que chacun soit rouvert/modifié individuellement d'abord.
async function syncPushEntireLibrary() {
  if (!getSyncKey()) return;
  // v7.27.0 — Auparavant, un seul document en échec (réseau, Worker
  // temporairement injoignable...) faisait échouer TOUT le `try/catch`
  // englobant : les documents suivants de la boucle n'étaient alors jamais
  // poussés, silencieusement. Chaque document a désormais son propre
  // `try/catch` : un échec isolé n'empêche plus les autres d'être
  // synchronisés (chacun sera de toute façon retenté à sa prochaine
  // modification locale si celui-ci échoue encore).
  try {
    const idx = await loadProfilesIndex();
    if (idx) await persistData('profiles', idx);
  } catch(e) { /* meilleure tentative uniquement */ }
  try {
    // v9.3.0 — Cette boucle repoussait auparavant TOUTE la bibliothèque locale
    // à chaque connexion, y compris depuis un appareil resté en arrière : sa
    // copie périmée écrasait alors le travail fait ailleurs (cause principale
    // du bug rapporté le 29/07/2026 — un manuscrit qui revenait sans cesse à
    // une version plus courte). On réconcilie désormais dans le bon sens :
    // on récupère d'abord ce que détient le serveur, on adopte ce qui est plus
    // récent, et on ne pousse que ce qui est réellement en attente localement
    // (file d'attente, voir retryPendingSyncs dans router.js).
    await syncReconcileKey(docListKey(_currentProfileId));
    const list = await loadDocList();
    for (const entry of list.documents) {
      try { await syncReconcileKey(docDataKey(_currentProfileId, entry.id)); }
      catch(e) { /* ce manuscrit sera réconcilié plus tard, on continue */ }
    }
  } catch(e) { /* meilleure tentative uniquement */ }
  try { retryPendingSyncs(); } catch(e) { /* meilleure tentative uniquement */ }
  // v9.28.0 : suppressions d'images restées en attente (serveur injoignable lors de la suppression).
  try { if (typeof retryPendingImageDeletes === 'function') await retryPendingImageDeletes(); } catch(e) { /* meilleure tentative uniquement */ }
  // v9.30.0 : contenu des manuscrits déjà supprimés encore présent sur le serveur.
  try { await sweepRemoteTombstones(); } catch(e) { /* meilleure tentative uniquement */ }
}

// v9.3.0 — Réconciliation explicite d'une clé : récupère la version du
// serveur et décide quoi en faire, SANS jamais repousser aveuglément la copie
// locale. Utilisé à la connexion (ci-dessus), là où l'ancien code se
// contentait de tout réécrire.
//
// Volontairement silencieux dans tous les cas sauf le conflit réel : c'est le
// chemin normal, il ne doit rien afficher.
async function syncReconcileKey(key) {
  if (!getSyncKey()) return;
  if (isConflictPaused(key)) return; // en attente d'arbitrage : on n'y touche pas
  // Voir syncPush() : l'empreinte de la base commune se lit AVANT syncPull(),
  // qui la remplace par celle de ce qu'il vient de recevoir.
  const baseFp = getKnownRemoteFp(key);
  const baseCoreFp = getKnownRemoteCoreFp(key);
  const { data: remote, version } = await syncPull(key);
  if (version === null || remote === null || remote === undefined) return;
  const local = await readLocalOnly(key);
  if (local === null || local === undefined) {
    // Rien en local (nouvel appareil, ou manuscrit encore jamais ouvert ici) :
    // la version du serveur est la seule qui existe.
    await writeLocalOnly(key, remote);
    setSyncVersion(key, version);
    await markRemoteAdopted(key, remote); // v9.53.1 : adoption réelle → base commune posée ici (plus dans syncPull)
    return;
  }
  if (key === 'profiles' || isDocListKey(key)) {
    const merged = key === 'profiles' ? mergeProfilesIndex(local, remote) : mergeDocList(local, remote);
    await writeLocalOnly(key, merged);
    setSyncVersion(key, version);
    if (isDocListKey(key)) await purgeTombstonedDocs(key, merged);
    // La fusion apporte-t-elle quelque chose que le serveur n'a pas ? Si oui,
    // on le lui renvoie ; sinon on n'écrit rien (pas de version inutile).
    if (JSON.stringify(merged) !== JSON.stringify(remote)) queueSyncPush(key, merged);
    return;
  }
  let verdict = await classifySyncDivergence(local, remote, baseFp, baseCoreFp);
  // v9.53.1 — manuscrit ouvert avec des frappes non enregistrées : pas d'adoption
  // silencieuse (voir isOpenDocumentProtected, router.js) → arbitrage par l'utilisateur.
  if (verdict === 'remote-only' && await isOpenDocumentProtected(key)) verdict = 'both';
  if (verdict === 'identical' || verdict === 'remote-only') {
    // Rien de neuf chez nous : on adopte la version du serveur.
    await writeLocalOnly(key, remote);
    setSyncVersion(key, version);
    await markRemoteAdopted(key, remote);
    cancelScheduledPush(key); // v9.53.2 : un envoi différé de l'ancienne copie ne doit pas repartir
    // v9.53.1 — si ce manuscrit est ouvert dans l'éditeur, il recharge la version adoptée.
    if (verdict === 'remote-only' && isOpenDocumentKey(key)) await onRemoteVersionAdopted(key);
    return;
  }
  if (verdict === 'local-only') {
    // Nos modifications sont les seules nouvelles : on les envoie.
    setSyncVersion(key, version);
    queueSyncPush(key, local);
    return;
  }
  // Vrai conflit : on sauvegarde la version distante, on met cette clé en
  // pause, et l'utilisateur arbitre quand il veut (aucune donnée n'est
  // écrasée d'ici là, ni ici ni sur l'autre appareil).
  setSyncVersion(key, version);
  await persistConflictBackup(key, remote);
  addConflictPausedKey(key);
  if (typeof toast === 'function') toast("Synchro : un manuscrit a été modifié sur les deux appareils. Ouvrez « Système » pour comparer et choisir.", 'error', { sticky: true, kind: 'conflict' });
}

// v9.3.0 — Points d'accroche appelés par router.js pour rafraîchir l'écran
// quand la synchronisation a changé quelque chose en arrière-plan.
async function onRemoteVersionAdopted(key) {
  try {
    if (document.getElementById('library-screen') && !document.getElementById('library-screen').classList.contains('u-d-none')) {
      await renderLibraryScreen();
    }
  } catch(e) { /* rafraîchissement cosmétique : ne doit jamais faire échouer la synchro */ }
  // v9.53.1 — la version adoptée est celle du manuscrit OUVERT : l'éditeur doit la recharger.
  try { if (key && isOpenDocumentKey(key)) await reloadOpenDocumentFromLocal(key); }
  catch(e) { /* en cas d'échec, la copie locale est à jour : le prochain envoi sera arbitré par le serveur */ }
}

// v9.53.1 — PERTE SILENCIEUSE CORRIGÉE (constatée en test réel le 2026-10-10).
// Quand une version plus récente d'un autre appareil était adoptée (rafraîchissement
// d'arrière-plan de loadData, envoi refusé puis arbitré, réconciliation) alors que le
// manuscrit était DÉJÀ ouvert, la copie locale (IndexedDB) était remplacée mais
// `db`, en mémoire, gardait l'ancien texte : la frappe suivante s'enregistrait
// puis partait avec un numéro de version à jour, et le serveur l'acceptait —
// la phrase de l'autre appareil disparaissait sans conflit ni sauvegarde.
// Remède : l'éditeur recharge la version adoptée. Si des frappes ont eu lieu entre-temps
// (les `await` ci-dessous), on ne remplace rien : conflit arbitré, sauvegarde de l'autre version.
async function reloadOpenDocumentFromLocal(key) {
  const env = await readLocalOnly(key);
  if (!env || !env._enc || !_dataKey) return false;
  const dec = await Crypto.decrypt(env.data, _dataKey);
  if (!dec) return false;
  let fresh;
  try { fresh = migrateDb(JSON.parse(dec)); } catch(e) { return false; }
  if (!isOpenDocumentKey(key)) return false; // l'utilisateur a quitté le manuscrit entre-temps
  if (await isOpenDocumentProtected(key)) {
    // Frappes arrivées pendant le déchiffrement : on garde le texte de l'éditeur (copie locale
    // réécrite), la version de l'autre appareil est sauvegardée, la synchro de ce manuscrit
    // est mise en pause et l'utilisateur arbitre (rien n'est perdu ni écrasé).
    await persistConflictBackup(key, env);
    addConflictPausedKey(key);
    try { if (typeof flushCurrentChapter === 'function') flushCurrentChapter(); await save(); } catch(e) { /* meilleure tentative */ }
    if (typeof onSyncConflictDetected === 'function') onSyncConflictDetected(key);
    if (typeof toast === 'function') toast("Synchro : ce manuscrit a été modifié sur les deux appareils. Votre texte est intact — ouvrez « Système » pour comparer et choisir.", 'error', { sticky: true, kind: 'conflict' });
    return false;
  }
  db = fresh;
  if (!Array.isArray(db.chapters) || cur >= db.chapters.length) cur = 0;
  refreshEditorFromDb();
  markOpenDocumentBaseline(); // nouvelle référence : « rien tapé depuis ce chargement »
  if (typeof toast === 'function') toast('Ce manuscrit vient d\'être modifié sur un autre appareil : sa version la plus récente est chargée.', 'info');
  return true;
}
// Réaffiche l'éditeur depuis `db` sans repasser par initApp() (qui relance parcours guidé,
// instantané d'ouverture, câblages…). Roman graphique : jamais adopté en arrière-plan (voir
// isOpenDocumentProtected), donc rien à faire ici.
function refreshEditorFromDb() {
  if (db.docType === 'roman_graphique') return;
  const call = (name, ...a) => { try { if (typeof globalThis[name] === 'function') globalThis[name](...a); } catch(e) { /* affichage seulement */ } };
  const dt = document.getElementById('document-title'); if (dt) dt.innerText = db.title || '';
  try { _undoStacks = {}; _pendingUndoFlush = false; } catch(e) { /* pas d'éditeur chargé */ }
  call('renderChapterList'); call('loadChapter', cur);
  call('renderLibrary', 'chars'); call('renderLibrary', 'places'); call('renderQuests');
  call('updateDailyStats'); call('updateEstimatedFinishDate');
}
async function onSyncConflictDetected() {
  try { await renderLibrarySyncBadge(); } catch(e) { /* idem */ }
}

async function loadDocList() {
  const list = await loadData(docListKey(_currentProfileId));
  return (list && Array.isArray(list.documents)) ? list : { version:1, documents:[] };
}
async function saveDocList(list) { await persistData(docListKey(_currentProfileId), list); }

// ═══════════════════════════════════════════════════════
// CORRECTIF (bug rapporté) : verrou sur l'index de la bibliothèque
// De nombreuses opérations indépendantes (changer une couverture, la
// sauvegarde Gist auto qui parcourt TOUS les manuscrits l'un après l'autre,
// ouvrir/fermer un manuscrit, importer...) font toutes le même geste :
// charger l'index complet, modifier UNE entrée, réenregistrer l'index
// complet. Si deux de ces opérations s'entrelacent — l'une démarre avant
// que l'autre ait fini d'enregistrer — la seconde écrase silencieusement le
// changement de la première (elle a chargé sa copie AVANT que ce changement
// soit enregistré). C'est la vraie cause du bug : une couleur de couverture
// tout juste changée "revient en arrière" peu après, en particulier
// déclenché par la sauvegarde Gist automatique au clic hors de la page
// (voir syncAllLibraryManuscripts, qui boucle sur chaque manuscrit).
// mutateDocList() sérialise ces opérations : chacune attend que la
// précédente soit ENTIÈREMENT terminée (chargement + modification +
// écriture) avant de commencer la sienne, ce qui élimine ce genre de
// "dernier arrivé écrase tout", quelle que soit la fonction à l'origine.
// ═══════════════════════════════════════════════════════
let _docListLock = Promise.resolve();
async function mutateDocList(mutator) {
  const run = _docListLock.then(async () => {
    const list = await loadDocList();
    const result = await mutator(list);
    await saveDocList(list);
    return result;
  });
  _docListLock = run.then(() => {}, () => {}); // la chaîne continue même si `mutator` échoue
  return run;
}

function libraryScreenEl() { return document.getElementById('library-screen'); }
function showLibraryScreen() { document.body.classList.add('library-mode'); }
function hideLibraryScreen() { document.body.classList.remove('library-mode'); }

function formatRelativeDate(ts) {
  if (!ts) return '';
  const diffDays = Math.floor((Date.now() - ts) / 86400000);
  if (diffDays <= 0) return "Modifié aujourd'hui";
  if (diffDays === 1) return 'Modifié hier';
  if (diffDays < 7) return `Modifié il y a ${diffDays} jours`;
  if (diffDays < 30) return `Modifié il y a ${Math.floor(diffDays/7)} semaine(s)`;
  return `Modifié il y a ${Math.floor(diffDays/30)} mois`;
}

// ── Point d'entrée après connexion/création/récupération/migration ──────
async function enterLibrary() {
  applyProfileAppearance(); // v9.48.0 (AUD-03-022) : thème, palette et police du profil dès la bibliothèque
  await migrateLegacyDocumentIfNeeded();
  wireLibraryStaticUI();
  await loadLibSettings();
  scheduleLibraryAutoBackup();
  setLibraryViewMode('grid');
  await renderLibraryScreen();
  showLibraryScreen();
  await renderLibrarySyncBadge();
  await maybeStartSetupTour();
}

// v9.2.3 — Demande explicite de l'utilisateur : un indicateur visible dès
// l'entrée dans la bibliothèque (sans avoir à ouvrir Système), pour repérer
// une éventuelle anomalie de synchro au premier coup d'œil. Masqué si aucune
// clé de synchro n'est configurée sur cet appareil (rien à signaler).
// v9.41.0 (AUD-03-001) : rappel discret, remplace la bulle bloquante.
function renderGithubReminder() {
  const btn = document.getElementById('library-github-reminder');
  if (btn) btn.hidden = !!_cloudToken;
}
async function renderLibrarySyncBadge() {
  const badge = document.getElementById('library-sync-status-badge');
  if (!badge) return;
  renderGithubReminder();
  // v9.41.0 (AUD-03-010) : attribut hidden (la règle par id #library-sync-status-badge
  // l'emportait sur .u-d-none : une pastille vide restait affichée sans clé de synchro).
  if (!getSyncKey()) { badge.hidden = true; return; }
  badge.hidden = false;
  const iconEl = document.getElementById('library-sync-status-icon');
  const text = document.getElementById('library-sync-status-text');
  let count = 0;
  try { count = (await getActiveConflictBackups()).length; } catch(e) { count = 0; }
  if (count > 0) {
    badge.classList.add('sync-warn');
    iconEl.innerHTML = icon('triangle-alert');
    text.textContent = count + (count > 1 ? ' conflits à vérifier' : ' conflit à vérifier');
  } else if (getPendingSyncKeys().filter(k => !isConflictPaused(k)).length > 0) {
    // v9.53.1 — « à jour » seulement si plus rien n'attend d'être envoyé (voir renderSyncDot).
    badge.classList.remove('sync-warn');
    iconEl.innerHTML = icon('clock');
    text.textContent = 'Envoi en attente';
  } else {
    badge.classList.remove('sync-warn');
    iconEl.innerHTML = icon('circle-check');
    text.textContent = 'Sauvegardes à jour';
  }
  if (!badge.dataset.wired) {
    badge.dataset.wired = '1';
    badge.addEventListener('click', () => openLibrarySystemPanel(undefined, 'sync'));
  }
}

// ═══════════════════════════════════════════════════════
// PARCOURS "CONFIGURATION INITIALE" — étape 3/3 (nouveau v7.37.0)
// Fait suite aux écrans clé de synchro (étape 1/3, gate dédiée existante,
// voir renderSyncKeyGate() dans profiles.js) et code de récupération
// (étape 2/3, showRecoveryCode()). Cette étape guide vers le token GitHub,
// jusqu'ici le seul réglage de sauvegarde sans aucune guidance (le panneau
// Système n'était découvert que si l'utilisateur cliquait dessus de
// lui-même). Montrée une seule fois par profil (profil.setupTourDone), à
// l'arrivée dans la bibliothèque. Contrairement au tour "premiers pas"
// (voir notifications.js) : v9.41.0 (AUD-03-001) — l'étape est désormais
// FACULTATIVE : bouton « Plus tard » dans la bulle, panneau Système toujours
// fermable (✕, Échap), fermer le panneau = « plus tard ». Avant, le panneau
// n'avait plus de ✕ et la bulle revenait à chaque connexion tant qu'aucun
// token n'était vérifié (piège au toucher). Un rappel discret
// (#library-github-reminder) reste dans la bibliothèque tant qu'il n'y a pas de token.
// ═══════════════════════════════════════════════════════
let _setupTourActive = false;

async function maybeStartSetupTour() {
  try {
    const idx = await loadProfilesIndex();
    const profil = idx && idx.profiles && idx.profiles.find(p => p.id === _currentProfileId);
    if (profil && !profil.setupTourDone) startSetupTour();
  } catch(e) { /* ne bloque jamais l'entrée dans la bibliothèque */ }
}

function startSetupTour() {
  _setupTourActive = true;
  // v7.43.1 — Bug d'ergonomie rapporté : le compteur "Étape 3/3" faisait
  // penser à un néophyte que cette fenêtre appartenait à la visite guidée
  // de la bibliothèque (fulltour.js) — alors qu'il s'agit d'une fenêtre
  // totalement distincte et sans lien avec elle. Fenêtre détachée : plus de
  // numérotation, juste ce qu'il faut faire et à quoi ça sert.
  showSetupBubble('#library-system-btn', "Avant d'écrire, configurons la sauvegarde automatique de vos manuscrits sur GitHub — cliquez ici pour l'ouvrir.", 'Sauvegarde automatique');
}

function showSetupBubble(targetSel, text, counter) {
  const bubble = document.getElementById('setup-tour-bubble');
  const target = document.querySelector(targetSel);
  document.getElementById('setup-tour-text').textContent = text;
  document.getElementById('setup-tour-counter').textContent = counter;
  bubble.classList.add('active');
  if (target) {
    const r = target.getBoundingClientRect();
    bubble.style.top = Math.max(10, Math.min(window.innerHeight-160, r.bottom + 12)) + 'px';
    bubble.style.left = Math.max(10, Math.min(window.innerWidth-280, r.left)) + 'px';
  }
}
function hideSetupBubble() { document.getElementById('setup-tour-bubble').classList.remove('active'); }

async function endSetupTour() {
  _setupTourActive = false;
  hideSetupBubble();
  try {
    // Correction (audit v8.1.0) : cette fonction lisait l'index puis le
    // réécrivait ENTIÈREMENT hors du verrou — le patron exact qui a causé les
    // pertes de données ailleurs (couvertures, puis profils). Une écriture
    // concurrente survenue entre la lecture et l'écriture était silencieusement
    // écrasée. mutateProfilesIndex() relit une copie fraîche à l'intérieur du
    // verrou et sérialise l'opération.
    await mutateProfilesIndex(idx => {
      const profil = idx.profiles && idx.profiles.find(p => p.id === _currentProfileId);
      if (profil) profil.setupTourDone = true;
    });
  } catch(e) { /* best effort */ }
}

let _libraryWired = false;
function wireLibraryStaticUI() {
  if (_libraryWired) return;
  _libraryWired = true;
  document.getElementById('library-my-profile-btn').addEventListener('click', openMyProfile);
  document.getElementById('library-manage-profiles-btn').addEventListener('click', openManageProfiles);
  document.getElementById('library-logout-btn').addEventListener('click', logout);
  // v9.48.0 (AUD-03-028) : menus « Compte » et « Aide » de l'en-tête (ordinateur ; sur téléphone, le menu ⋯ prend le relais).
  document.querySelectorAll('#library-topbar .lib-dropdown').forEach(dd => {
    const trigger = dd.querySelector('button'), menu = dd.querySelector('.toolbar-menu');
    trigger.addEventListener('click', e => {
      e.stopPropagation();
      const was = menu.classList.contains('open');
      closeLibDropdowns(); closeLibraryTopbarMenu();
      if (!was) { menu.classList.add('open'); trigger.setAttribute('aria-expanded', 'true'); }
    });
    menu.querySelectorAll('button').forEach(item => item.addEventListener('click', closeLibDropdowns));
  });
  document.addEventListener('click', closeLibDropdowns);
  // Sélecteur de couverture (v7.9.0) — élément unique, câblé une seule fois.
  document.querySelectorAll('#cover-picker-menu .cover-swatch').forEach(btn => {
    btn.addEventListener('click', () => selectCover(btn.dataset.cover));
  });
  document.addEventListener('click', () => closeCoverPicker());
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCoverPicker(); });
  // Bascule Grille / Étagère — nouveau v7.11.0 (Lot 7).
  document.getElementById('view-grid-btn').addEventListener('click', () => setLibraryViewMode('grid'));
  document.getElementById('view-shelf-btn').addEventListener('click', () => setLibraryViewMode('shelf'));

  // Visite guidée complète (nouveau v7.39.0) — voir fulltour.js.
  document.getElementById('library-tour-btn').addEventListener('click', launchLibraryTour);
  document.getElementById('library-full-tour-btn').addEventListener('click', launchEditorFullTour);
  // v9.0.2 — Bug rapporté (Android uniquement) : ces clics remontaient
  // (bubbling) jusqu'à document, où des écouteurs génériques ("fermer tout
  // menu au clic extérieur", voir plus bas et router.js) refermaient
  // aussitôt le menu "⋯"/"✨▾" que ensureLibraryMenuOpen()/ensureLexToolsOpen()
  // (fulltour.js) venaient d'ouvrir dans ce même clic — avant même que la
  // résolution de cible (différée via requestAnimationFrame) ne s'exécute.
  // Sur PC (largeur desktop), ce chemin n'était jamais emprunté (cible déjà
  // visible sans menu), d'où l'absence de bug observée là-bas. Même
  // correctif que celui déjà appliqué à #lctx-cover un peu plus bas.
  document.getElementById('full-tour-prev-btn').addEventListener('click', e => { e.stopPropagation(); fullTourPrev(); });
  document.getElementById('full-tour-next-btn').addEventListener('click', e => { e.stopPropagation(); fullTourNext(); });
  document.getElementById('full-tour-quit-btn').addEventListener('click', e => { e.stopPropagation(); endFullTour(); });

  // v7.40.2 — Menu "Plus d'actions" de la topbar bibliothèque (mobile) :
  // chaque entrée appelle directement le même gestionnaire que le bouton
  // desktop équivalent, aucune logique dupliquée.
  document.getElementById('library-topbar-more-btn').addEventListener('click', e => { e.stopPropagation(); toggleLibraryTopbarMenu(); });
  document.getElementById('ltop-my-profile').addEventListener('click', () => { closeLibraryTopbarMenu(); openMyProfile(); });
  document.getElementById('ltop-manage-profiles').addEventListener('click', () => { closeLibraryTopbarMenu(); openManageProfiles(); });
  document.getElementById('ltop-system').addEventListener('click', () => { closeLibraryTopbarMenu(); openLibrarySystemPanel(); });
  document.getElementById('ltop-tour').addEventListener('click', () => { closeLibraryTopbarMenu(); launchLibraryTour(); });
  document.getElementById('ltop-full-tour').addEventListener('click', () => { closeLibraryTopbarMenu(); launchEditorFullTour(); });
  document.getElementById('ltop-logout').addEventListener('click', () => { closeLibraryTopbarMenu(); logout(); });
  document.addEventListener('click', () => closeLibraryTopbarMenu());
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLibraryTopbarMenu(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && _fullTourActive) endFullTour(); });
  // Icônes d'aide contextuelle ⓘ (nouveau v7.39.0) : un seul appel suffit ici
  // (tous les boutons visés — bibliothèque, sous-onglets, barre d'outils,
  // bandeau du bas — existent déjà statiquement dans index.html dès le
  // chargement de la page, que l'éditeur soit visible ou non).
  wireContextualHelpIcons();
  document.addEventListener('click', e => {
    if (!e.target.closest('.contextual-help-icon') && !e.target.closest('#info-popover')) hideInfoPopover();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hideInfoPopover(); });

  // ── Menu ⋮ des manuscrits (v7.13.0, Lot 10) ──────────────────────────
  document.getElementById('lctx-cover').addEventListener('click', e => {
    // stopPropagation indispensable : sans elle, ce même clic remonte
    // jusqu'au listener document (plus bas) qui referme le sélecteur de
    // couverture juste après l'avoir ouvert (fermeture instantanée).
    e.stopPropagation();
    const docId = _libraryCtxMenuDocId, btn = _libraryCtxMenuBtn;
    closeLibraryCtxMenu();
    if (docId && btn) openCoverPicker(docId, btn);
  });
  document.getElementById('lctx-export').addEventListener('click', () => {
    const docId = _libraryCtxMenuDocId;
    closeLibraryCtxMenu();
    if (docId) libExportDoc(docId);
  });
  document.getElementById('lctx-del').addEventListener('click', () => {
    const docId = _libraryCtxMenuDocId;
    closeLibraryCtxMenu();
    if (docId) trashDocument(docId);
  });
  document.getElementById('library-trash-btn').addEventListener('click', openDocTrash);
  document.getElementById('doc-trash-close-btn').addEventListener('click', closeDocTrash);
  document.addEventListener('click', () => closeLibraryCtxMenu());
  // v9.42.0 (AUD-03-020) : Échap est arbitré par escapeArbiter() (router.js), une couche à la fois.

  // ── Panneau Système : bibliothèque entière (v7.13.0, Lot 10) ─────────
  document.getElementById('library-system-btn').addEventListener('click', () => openLibrarySystemPanel());
  document.getElementById('library-github-reminder').addEventListener('click', () => openLibrarySystemPanel(undefined, 'github'));
  document.querySelectorAll('#library-system-overlay .lib-systab').forEach((b, i, all) => {
    b.addEventListener('click', () => showSystemTab(b.dataset.systab));
    b.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const nxt = all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
      showSystemTab(nxt.dataset.systab); nxt.focus();
    });
  });
  document.getElementById('setup-tour-later-btn').addEventListener('click', () => { if (_setupTourActive) endSetupTour(); });
  document.getElementById('library-system-close-btn').addEventListener('click', closeLibrarySystemPanel);
  document.getElementById('conflict-diff-close-btn').addEventListener('click', closeConflictDiff);
  document.getElementById('lib-conflict-delete-all').addEventListener('click', deleteAllConflictBackups);
  document.getElementById('lib-gh-token').addEventListener('change', e => { _cloudToken = e.target.value.trim(); saveLibSettings(); scheduleLibraryAutoBackup(); });
  document.getElementById('lib-verify-token-btn').addEventListener('click', async () => {
    _cloudToken = document.getElementById('lib-gh-token').value.trim();
    const statusEl = document.getElementById('lib-token-status');
    if (!_cloudToken) { statusEl.style.color = 'var(--danger)'; statusEl.textContent = 'Collez d\'abord votre jeton d\'accès.'; return; }
    statusEl.style.color = 'var(--text-muted)'; statusEl.textContent = 'Vérification…';
    const ok = await libVerifyToken();
    if (ok) {
      statusEl.style.color = 'var(--success)'; statusEl.textContent = `Jeton valide (connecté en tant que @${ok}).`; saveLibSettings();
      renderGithubReminder();
      if (_setupTourActive) await endSetupTour();
    }
    else { statusEl.style.color = 'var(--danger)'; statusEl.textContent = 'Jeton invalide ou refusé par GitHub.'; }
  });
  document.getElementById('lib-auto-gist-interval').addEventListener('change', e => { _libSettings.autoGistInterval = parseInt(e.target.value)||0; saveLibSettings(); scheduleLibraryAutoBackup(); });
  document.getElementById('lib-system-doc-select').addEventListener('change', e => refreshLibSystemDocStatus(e.target.value));
  document.getElementById('lib-export-btn').addEventListener('click', libExportCurrent);
  document.getElementById('lib-import-doc-trigger-btn').addEventListener('click', () => document.getElementById('lib-import-doc-file').click());
  document.getElementById('lib-import-doc-file').addEventListener('change', e => importManuscriptFile(e.target));
  document.getElementById('lib-sync-cloud-btn').addEventListener('click', async () => {
    const docId = document.getElementById('lib-system-doc-select').value;
    if (!docId) return;
    document.getElementById('lib-cloud-status').textContent = 'Sauvegarde en cours…';
    const ok = await libSyncManuscript(docId);
    document.getElementById('lib-cloud-status').textContent = ok ? 'Sauvegardé sur Gist' : 'Échec de la sauvegarde';
    refreshLibSystemDocStatus(docId);
  });
  document.getElementById('lib-load-cloud-btn').addEventListener('click', () => {
    const docId = document.getElementById('lib-system-doc-select').value;
    if (docId) libLoadManuscript(docId);
  });
  document.getElementById('lib-gist-history-btn').addEventListener('click', () => {
    const docId = document.getElementById('lib-system-doc-select').value;
    if (docId) libOpenGistHistory(docId);
  });
  document.getElementById('lib-export-json-btn').addEventListener('click', megaExportLibrary);
  document.getElementById('lib-import-json-trigger-btn').addEventListener('click', () => document.getElementById('lib-import-json-file').click());
  document.getElementById('lib-import-json-file').addEventListener('change', e => importProjectLibrary(e.target));

  // ── Bloc "Clé de synchronisation" du panneau Système (nouveau) ───────
  // Réutilise getSyncKey()/setSyncKey()/verifySyncKey() de router.js — la
  // même clé que celle demandée une fois par appareil à l'écran de démarrage.
  document.getElementById('lib-sync-key-reveal-btn').addEventListener('click', () => {
    const input = document.getElementById('lib-sync-key-input');
    input.type = input.type === 'password' ? 'text' : 'password';
  });
  document.getElementById('lib-sync-key-verify-btn').addEventListener('click', async () => {
    const key = document.getElementById('lib-sync-key-input').value;
    const statusEl = document.getElementById('lib-sync-key-status');
    if (!key) { statusEl.style.color = 'var(--danger)'; statusEl.textContent = 'Aucune clé enregistrée sur cet appareil.'; return; }
    statusEl.style.color = 'var(--text-muted)'; statusEl.textContent = 'Vérification…';
    const ok = await verifySyncKey(key);
    statusEl.style.color = ok ? 'var(--success)' : 'var(--danger)';
    statusEl.textContent = ok ? 'Clé valide.' : 'Clé invalide, ou Worker injoignable.';
  });
  document.getElementById('lib-sync-key-change-btn').addEventListener('click', () => {
    const input = document.getElementById('lib-sync-key-input');
    const btn = document.getElementById('lib-sync-key-change-btn');
    const statusEl = document.getElementById('lib-sync-key-status');
    if (input.readOnly) {
      // Passe en mode édition
      input.readOnly = false;
      input.type = 'text';
      input.value = '';
      input.placeholder = 'Nouvelle clé de synchronisation';
      input.focus();
      btn.innerHTML = icon('save') + ' Enregistrer';
      statusEl.textContent = '';
    } else {
      // Enregistre la nouvelle clé
      const newKey = input.value.trim();
      if (!newKey) { statusEl.style.color = 'var(--danger)'; statusEl.textContent = 'Entrez une clé, ou laissez le champ tel quel pour annuler.'; return; }
      setSyncKey(newKey);
      input.readOnly = true;
      input.type = 'password';
      btn.innerHTML = icon('pencil') + ' Changer la clé';
      statusEl.style.color = 'var(--success)'; statusEl.textContent = 'Nouvelle clé enregistrée sur cet appareil.';
    }
  });

  // ── Import DOCX/ODT — modale (v7.12.0, généralisée v7.13.0) ──────────
  document.getElementById('docx-import-close-btn').addEventListener('click', closeDocxImportModal);
  document.getElementById('docx-mode-new-btn').addEventListener('click', () => setDocxImportMode('new'));
  document.getElementById('docx-mode-existing-btn').addEventListener('click', () => setDocxImportMode('existing'));
  document.getElementById('docx-import-confirm-btn').addEventListener('click', confirmDocxImport);

  // ── Export — sélection des chapitres puis choix du format ────────────
  document.getElementById('export-select-close-btn').addEventListener('click', closeExportSelect);
  document.getElementById('export-select-toggle-btn').addEventListener('click', toggleAllExportSelect);
  document.getElementById('export-select-docx-btn').addEventListener('click', () => { exportDocx(getSelectedExportChapters(), _exportSelectTitle); closeExportSelect(); });
  document.getElementById('export-select-odt-btn').addEventListener('click', () => { exportOdt(getSelectedExportChapters(), _exportSelectTitle); closeExportSelect(); });
  document.getElementById('export-select-pdf-btn').addEventListener('click', () => { exportPdf(getSelectedExportChapters(), _exportSelectTitle); closeExportSelect(); });
  document.getElementById('export-select-epub-btn').addEventListener('click', () => { exportEpub(getSelectedExportChapters(), _exportSelectTitle); closeExportSelect(); });

  // ── Historique Gist — fermeture (déclenché depuis le panneau Système) ─
  document.getElementById('gist-history-close-btn').addEventListener('click', closeGistHistory);
}

// Migration silencieuse : un profil v7.0/v7.1 a son roman unique sous
// 'data_<profileId>'. On le transforme en premier manuscrit de la
// bibliothèque, sans avoir à changer son chiffrement (même DEK, même
// enveloppe) — sauf si aucun titre n'existait encore, auquel cas on lui en
// attribue un et on réenregistre l'enveloppe avec ce titre inclus.
async function migrateLegacyDocumentIfNeeded() {
  const list = await loadDocList();
  if (list.documents.length) return;
  const legacy = await loadData('data_' + _currentProfileId);
  if (!legacy || !legacy._enc) return;

  const docId = genChapterId();
  let title = 'Mon manuscrit', chapterCount = 0, wordCount = 0, storedBlob = legacy;
  try {
    const dec = await Crypto.decrypt(legacy.data, _dataKey);
    if (dec) {
      const parsed = JSON.parse(dec);
      chapterCount = (parsed.chapters||[]).length;
      wordCount = (parsed.chapters||[]).reduce((s,c) => s + getWordCount(c.content), 0);
      if (parsed.title) {
        title = parsed.title;
      } else {
        parsed.title = title;
        storedBlob = await makeEncryptedEnvelope(JSON.stringify(parsed));
      }
    }
  } catch(e) { /* migration au mieux : on garde les valeurs par défaut ci-dessus */ }

  await persistData(docDataKey(_currentProfileId, docId), storedBlob);
  await mutateDocList(list2 => {
    list2.documents.push({ id:docId, title, lastModified:Date.now(), chapterCount, wordCount, wordGoal:0, cover:'auto' });
  });
  await persistData('data_' + _currentProfileId, null);
}

async function renderLibraryScreen() {
  let list = await loadDocList();
  // v9.39.0 : les manuscrits dont les 30 jours de corbeille sont écoulés sont supprimés définitivement.
  if (expiredTrashedDocuments(list).length) { await purgeExpiredDocTrash(list); list = await loadDocList(); }
  const sorted = liveDocuments(list).sort((a,b) => b.lastModified - a.lastModified);
  const nTrash = trashedDocuments(list).length;
  const trashBtn = document.getElementById('library-trash-btn');
  if (trashBtn) { trashBtn.classList.toggle('u-d-none', !nTrash); trashBtn.innerHTML = icon('trash-2') + ' Corbeille (' + nTrash + ')'; }

  document.getElementById('library-profile-name').textContent = 'Bonjour, ' + (_currentProfile ? _currentProfile.name : '');
  document.getElementById('library-manage-profiles-btn').style.display = (_currentProfile && _currentProfile.role === 'admin') ? '' : 'none';
  document.getElementById('ltop-manage-profiles').style.display = (_currentProfile && _currentProfile.role === 'admin') ? '' : 'none';
  document.getElementById('library-count').textContent = sorted.length + ' manuscrit' + (sorted.length > 1 ? 's' : '');

  const container = document.getElementById('library-grid');
  container.innerHTML = `<div class="library-card library-new" id="library-new-btn" role="button" tabindex="0" aria-label="Nouveau projet" title="Créer un nouveau manuscrit vierge">
      <span class="library-new-icon">+</span><span>Nouveau projet</span>
    </div>` + sorted.map(d => {
      const cover = d.cover && d.cover !== 'auto' ? COVER_PALETTES[d.cover] : null;
      const coverClass = cover ? ` cover-${d.cover}` : '';
      const goal = d.wordGoal || 0;
      const pct = goal > 0 ? Math.min(100, Math.round((d.wordCount||0) / goal * 100)) : 0;
      // v9.1.0 — Cartes compactées en 3 colonnes sur mobile (voir style.css) :
      // le texte complet "X chapitre(s) · Y mots" ne tient plus dans la
      // largeur restante, abrégé en "X ch · Y mots" en dessous de 480px.
      const isGraphic = d.docType === 'roman_graphique';
      const metaText = isGraphic
        ? `${d.chapterCount||0} page(s) · ${d.wordCount||0} mots`
        : (window.innerWidth <= 480
          ? `${d.chapterCount||0} ch · ${d.wordCount||0} mots`
          : `${d.chapterCount||0} chapitre(s) · ${d.wordCount||0} mots`);
      // Vignette schématique (Lot 6, audit #23) : géométrie de la page 1
      // (voir saveGraphicNovel, graphicnovel.js) plutôt qu'une icône
      // générique — reprend gnMiniIconHtml telle quelle (même rendu que les
      // vignettes de page dans l'éditeur). Repli sur l'icône générique si
      // le manuscrit n'a encore jamais été sauvegardé avec cette version.
      const hasShapes = isGraphic && Array.isArray(d.gnCoverShapes) && d.gnCoverShapes.length && typeof gnMiniIconHtml === 'function';
      const coverInner = hasShapes ? `<div class="gn-cover-preview">${gnMiniIconHtml(d.gnCoverShapes)}</div>` : (isGraphic ? icon('palette', 'icon-xl') : icon('book-open', 'icon-xl'));
      return `
    <div class="library-card" data-doc-id="${d.id}" role="button" tabindex="0" title="Ouvrir « ${DOMPurify.sanitize(d.title || 'Sans titre')} »">
      <button class="library-kebab-btn" data-kebab-doc="${d.id}" title="Actions du manuscrit" aria-label="Actions du manuscrit">${icon('ellipsis-vertical')}</button>
      <div class="library-cover${coverClass}">${coverInner}</div>
      <div class="library-card-body">
        <p class="library-card-title">${DOMPurify.sanitize(d.title || 'Sans titre')}</p>
        <p class="library-card-meta">${metaText}</p>
        ${goal>0 ? `<div class="library-progress" title="${d.wordCount||0} / ${goal} mots"><div class="library-progress-bar" data-pct="${pct}"></div></div><p class="library-progress-label">${d.wordCount||0} / ${goal} mots · ${pct}%</p>` : ''}
        <p class="library-card-date">${formatRelativeDate(d.lastModified)}${d.lastGistSync ? ' · '+icon('cloud')+' '+formatRelativeDate(d.lastGistSync).replace('Modifié ','') : ''}</p>
      </div>
    </div>`;
    }).join('');
  // Vignettes schématiques (Lot 6, audit #23) : positions en % via JS,
  // jamais style="" en ligne (interdit par la CSP style-src 'self') — même
  // fonctions que l'éditeur roman graphique (graphicnovel.js).
  if (typeof gnApplyMiniIconStyles === 'function') gnApplyMiniIconStyles(container);

  const newBtn = document.getElementById('library-new-btn');
  newBtn.addEventListener('click', createNewDocument);
  newBtn.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); createNewDocument(); } });
  container.querySelectorAll('[data-doc-id]').forEach(card => {
    card.addEventListener('click', (e) => { if (e.target.closest('.library-kebab-btn')) return; openDocument(card.dataset.docId); });
    // v9.45.0 (AUD-03-016) : clic droit = même menu que le ⋮.
    card.addEventListener('contextmenu', e => { const k = card.querySelector('.library-kebab-btn'); if (k) { e.preventDefault(); k.click(); } });
    card.addEventListener('keydown', e => { if ((e.key==='Enter'||e.key===' ')&&!e.target.closest('.library-kebab-btn')) { e.preventDefault(); openDocument(card.dataset.docId); } });
  });
  container.querySelectorAll('[data-kebab-doc]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openLibraryCtxMenu(btn.dataset.kebabDoc, btn); });
  });
  // v7.18.0 : largeur de la barre de progression posée via la propriété CSSOM
  // (autorisée par la CSP style-src même sans 'unsafe-inline'), plutôt qu'un
  // style="width:...' textuel dans le HTML généré ci-dessus (bloqué, lui).
  container.querySelectorAll('.library-progress-bar[data-pct]').forEach(el => {
    el.style.width = el.dataset.pct + '%';
  });
  // v7.11.0 : garder l'étagère synchronisée si c'est la vue active (même
  // principe que la corkboard des chapitres — Lot 6, editor.js).
  if (_libraryViewMode === 'shelf') renderLibraryShelf(sorted);
}

// ═══════════════════════════════════════════════════════
// VUE ÉTAGÈRE — dos de livres colorés (nouveau v7.11.0, Lot 7)
// Réutilise la couleur de couverture (Lot 5) et le sélecteur de couverture
// existant (openCoverPicker). Hauteur du dos proportionnelle au nombre de
// mots. Jamais mémorisée : remise à 'grid' à chaque entrée en bibliothèque.
// ═══════════════════════════════════════════════════════
function setLibraryViewMode(mode) {
  _libraryViewMode = mode;
  const isShelf = mode === 'shelf';
  document.getElementById('view-grid-btn').classList.toggle('active', !isShelf);
  document.getElementById('view-shelf-btn').classList.toggle('active', isShelf);
  document.getElementById('library-grid').style.display = isShelf ? 'none' : 'grid';
  document.getElementById('library-shelf').style.display = isShelf ? 'block' : 'none';
  if (isShelf) renderLibraryShelf();
}
// v7.28.0 — Refonte visuelle de la vue étagère (voir style.css pour les
// classes .lib-book-band / .lib-book-recent-dot / #library-shelf) :
//   - la carte "+ Nouveau manuscrit" est désormais EN PREMIER (elle était
//     en dernier), suivie des manuscrits du plus récent au plus ancien
//     (tri déjà existant, inchangé).
//   - un point vert signale uniquement le manuscrit le plus récemment
//     modifié (sorted[0]).
//   - deux filets dorés encadrent le titre sur chaque tranche. Leur
//     position n'est PAS fixe : on les pose d'abord à leur position par
//     défaut (proche du centre), puis on mesure le rendu RÉEL du titre
//     (scrollHeight vs hauteur allouée, pas une estimation de largeur de
//     caractères) ; si le titre déborde, les filets sont écartés vers les
//     bords de la tranche pour lui laisser plus de place. Le titre ne
//     déborde alors JAMAIS sur un filet : sa hauteur allouée est toujours
//     exactement l'espace entre les deux filets, et le CSS
//     (text-overflow:ellipsis) tronque proprement si, malgré l'écart
//     maximal, le titre ne tient toujours pas. Le titre complet reste
//     accessible via l'infobulle native (title="Ouvrir « ... »").
async function renderLibraryShelf(sorted) {
  const cont = document.getElementById('library-shelf');
  if (!cont) return;
  if (!sorted) {
    const list = await loadDocList();
    sorted = liveDocuments(list).sort((a,b) => b.lastModified - a.lastModified);
  }
  const PER_ROW = 7;
  const items = [{ isNew:true }].concat(sorted.map((d, idx) => ({ d, isRecent: idx === 0 })));
  let html = '';
  for (let i = 0; i < items.length; i += PER_ROW) {
    html += `<div class="lib-shelf-row"><div class="lib-shelf-plank"></div>` + items.slice(i, i + PER_ROW).map(it => {
      if (it.isNew) return `<div class="lib-book lib-book-new u-h-110px" id="library-new-btn-shelf" role="button" tabindex="0" aria-label="Nouveau projet" title="Créer un nouveau manuscrit vierge"><span>+</span><span class="lib-book-new-label">Nouveau<br>manuscrit</span></div>`;
      const d = it.d;
      const cover = d.cover && d.cover !== 'auto' ? COVER_PALETTES[d.cover] : null;
      const shelfCoverClass = cover ? ` shelf-cover-${d.cover}` : '';
      const h = Math.max(110, Math.min(190, 110 + Math.round((d.wordCount||0) / 700)));
      const safeTitle = DOMPurify.sanitize(d.title || 'Sans titre');
      return `<div class="lib-book${shelfCoverClass}" data-doc-id="${d.id}" data-h="${h}" data-band-margin-default="${Math.round(h*0.16)}" data-band-margin-max="6" role="button" tabindex="0" title="Ouvrir « ${safeTitle} »">
        <button class="lib-book-kebab" data-kebab-doc="${d.id}" title="Actions du manuscrit" aria-label="Actions du manuscrit">${icon('ellipsis-vertical')}</button>
        ${it.isRecent ? '<span class="lib-book-recent-dot" title="Modifié le plus récemment" aria-hidden="true"></span>' : ''}
        <span class="lib-book-band lib-book-band-top" aria-hidden="true"></span>
        <span class="lib-book-title">${safeTitle}</span>
        <span class="lib-book-band lib-book-band-bottom" aria-hidden="true"></span>
      </div>`;
    }).join('') + `</div>`;
  }
  cont.innerHTML = html;
  // Hauteur du dos posée via CSSOM (autorisé par la CSP même sans
  // 'unsafe-inline'), comme le reste du projet.
  // v7.33.0 — Repasse en 3 étapes groupées (tous les réglages par défaut,
  // PUIS toutes les mesures, PUIS les réajustements) au lieu d'un
  // réglage+mesure+réajustement livre par livre : avant, chaque lecture de
  // scrollHeight/clientHeight forçait le navigateur à recalculer tout de
  // suite la mise en page à cause de l'écriture juste précédente sur le
  // MÊME livre — un recalcul complet par livre affiché. En séparant
  // clairement les écritures des lectures, le navigateur ne fait plus
  // qu'un seul recalcul pour toute la rangée. Résultat visuel identique.
  const items2 = [];
  cont.querySelectorAll('.lib-book[data-h]').forEach(el => {
    const h = parseInt(el.dataset.h, 10);
    el.style.height = h + 'px';
    const marginDefault = parseInt(el.dataset.bandMarginDefault, 10);
    const marginMax = parseInt(el.dataset.bandMarginMax, 10);
    const bandTop = el.querySelector('.lib-book-band-top');
    const bandBottom = el.querySelector('.lib-book-band-bottom');
    const titleEl = el.querySelector('.lib-book-title');
    if (!bandTop || !bandBottom || !titleEl) return;
    const applyMargin = m => {
      bandTop.style.top = m + 'px';
      bandBottom.style.bottom = m + 'px';
      // v7.30.0 — max-height (et non height) : un titre court garde sa
      // hauteur naturelle (le flex le centre alors correctement dans toute
      // la hauteur du livre) ; un titre trop long reste plafonné à l'espace
      // disponible, ce qui déclenche l'ellipsis CSS sans jamais déborder
      // sur les filets.
      titleEl.style.maxHeight = Math.max(14, h - 2*m - 12) + 'px';
    };
    applyMargin(marginDefault); // 1er passage : écritures seulement
    items2.push({ titleEl, applyMargin, marginMax });
  });
  // 2e passage : lectures seulement (regroupées, un seul recalcul global).
  items2.forEach(it => { it.overflow = it.titleEl.scrollHeight > it.titleEl.clientHeight + 1; });
  // 3e passage : écritures de réajustement seulement, pour les titres qui
  // débordaient réellement de l'espace par défaut.
  items2.forEach(it => { if (it.overflow) it.applyMargin(it.marginMax); });

  cont.querySelectorAll('[data-doc-id]').forEach(book => {
    book.addEventListener('click', e => { if (e.target.closest('.lib-book-kebab')) return; openDocument(book.dataset.docId); });
    book.addEventListener('contextmenu', e => { const k = book.querySelector('.lib-book-kebab'); if (k) { e.preventDefault(); k.click(); } });
    book.addEventListener('keydown', e => { if ((e.key==='Enter'||e.key===' ')&&!e.target.closest('.lib-book-kebab')) { e.preventDefault(); openDocument(book.dataset.docId); } });
  });
  cont.querySelectorAll('[data-kebab-doc]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openLibraryCtxMenu(btn.dataset.kebabDoc, btn); });
  });
  const newBtn = document.getElementById('library-new-btn-shelf');
  if (newBtn) {
    newBtn.addEventListener('click', createNewDocument);
    newBtn.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); createNewDocument(); } });
  }
}

async function openDocument(docId) {
  const dataKey = docDataKey(_currentProfileId, docId);
  const lireVersion = () => (typeof getSyncVersion === 'function' ? getSyncVersion(dataKey) : 0);
  const versionAvantLecture = lireVersion();
  let stored = await loadData(dataKey);
  if (!stored || !stored._enc) { toast('Manuscrit introuvable.', 'error'); return; }
  let dec = await Crypto.decrypt(stored.data, _dataKey);
  if (!dec) { toast('Impossible de déchiffrer ce manuscrit.', 'error'); return; }
  // v9.53.1 — loadData() renvoie la copie locale tout de suite et rafraîchit en arrière-plan : si ce
  // rafraîchissement a adopté une version plus récente PENDANT le déchiffrement (avant que le
  // manuscrit soit marqué ouvert, donc avant que onRemoteVersionAdopted puisse recharger l'éditeur),
  // on relit la copie locale à jour plutôt que d'ouvrir l'ancienne.
  if (lireVersion() !== versionAvantLecture) {
    const frais = await readLocalOnly(dataKey);
    if (frais && frais._enc && frais._fp !== stored._fp) {
      const d2 = await Crypto.decrypt(frais.data, _dataKey);
      if (d2) { stored = frais; dec = d2; }
    }
  }
  let opened;
  try { opened = migrateDb(JSON.parse(dec)); }
  catch (e) {
    // v9.26.0 (AUD-01-018) — manuscrit d'une version plus récente de Plume :
    // on n'y touche pas, et on relance la recherche de mise à jour.
    toast(e && e.message ? e.message : 'Impossible d\'ouvrir ce manuscrit.', 'error');
    if (typeof checkForAppUpdate === 'function') checkForAppUpdate();
    return;
  }
  db = opened;
  _currentDocumentId = docId;
  cur = 0;
  hideLibraryScreen();
  // Module Roman graphique (nouveau) : éditeur dédié, distinct de l'éditeur
  // chapitre par chapitre (db.pages au lieu de db.chapters — voir schema.js).
  if (db.docType === 'roman_graphique') { openGraphicNovelScreen(); return; }
  initApp();
  // v9.53.1 — référence « rien tapé depuis ce chargement » (voir isOpenDocumentProtected, router.js).
  if (typeof markOpenDocumentBaseline === 'function') markOpenDocumentBaseline();
}

// Au clic sur "Nouveau projet" : fenêtre de choix du type de document
// (texte seul / roman graphique / bande dessinée à venir — voir
// js/graphicnovel.js), plutôt qu'une création directe.
function createNewDocument() { openNewDocumentTypeModal(); }

async function createNewTextDocument() {
  const docId = genChapterId();
  const dbData = DEFAULT_DB();
  dbData.title = 'Nouveau manuscrit';
  // v9.48.0 (AUD-03-022) : un nouveau manuscrit prend l'apparence en cours (préférences du profil, sinon le système) ;
  // avant, il restait sombre par défaut même sur un système clair.
  dbData.darkMode = document.body.classList.contains('dark-mode'); dbData.paperMode = document.body.classList.contains('paper-mode');
  await persistData(docDataKey(_currentProfileId, docId), await makeEncryptedEnvelope(JSON.stringify(dbData)));
  await mutateDocList(list => {
    list.documents.push({ id:docId, title:dbData.title, docType:'texte', lastModified:Date.now(), chapterCount:1, wordCount:0, wordGoal:0, cover:'auto' });
  });
  db = dbData;
  _currentDocumentId = docId;
  cur = 0;
  hideLibraryScreen();
  initApp();
  // v9.53.1 — référence « rien tapé depuis ce chargement » (voir isOpenDocumentProtected, router.js).
  if (typeof markOpenDocumentBaseline === 'function') markOpenDocumentBaseline();
}

// Suppression définitive d'un manuscrit depuis la bibliothèque — confirmation
// forte (retaper le titre exact), même principe que la suppression de profil.
// Correction (audit) : les sauvegardes de conflit (conflict_doc_<profil>_
// <docId>_<ts>, voir router.js/library.js) et l'historique du chat IA
// (aichat_<profil>_<docId>, voir ai.js) sont des données annexes à un
// manuscrit, stockées sous des clés séparées — jusqu'ici jamais nettoyées
// à la suppression de ce manuscrit (ou de tout le profil), laissant des
// blobs chiffrés orphelins s'accumuler indéfiniment. Nettoyage explicite ici.
async function cleanupDocumentSideData(profileId, docId, opts) {
  try { await persistData(aiChatDataKey(profileId, docId), null); } catch(e) { /* best effort */ }
  // Module Roman graphique : les images (IndexedDB séparée, voir images.js)
  // ne sont jamais nettoyées automatiquement ailleurs — sans appel ici, un
  // manuscrit illustré supprimé laisserait ses images orphelines.
  // v9.28.0 : `opts.localOnly` (suppression venue d'un autre appareil) ne touche pas aux images du serveur.
  try { await deleteAllGraphicImagesForDocument(docId, { localOnly: !!(opts && opts.localOnly), profileId }); } catch(e) { /* best effort */ }
  try {
    const prefix = 'conflict_doc_' + profileId + '_' + docId + '_';
    let keys = [];
    if (idbStore) keys = (await idbStore.getAllKeys('data')).filter(k => typeof k === 'string' && k.startsWith(prefix));
    else keys = Object.keys(localStorage).filter(k => k.startsWith('plume_' + prefix)).map(k => k.slice('plume_'.length));
    for (const k of keys) await persistData(k, null);
  } catch(e) { /* best effort */ }
}

// v9.30.0 — Efface du serveur le contenu chiffré d'un manuscrit supprimé et son historique de chat IA. Le Worker
// ne l'accepte que si l'index de bibliothèque qu'il détient porte la pierre tombale : on attend donc que la
// suppression soit arrivée sur le serveur (voir deleteDocument). Renvoie true quand les deux clés sont parties.
async function deleteRemoteManuscript(profileId, docId) {
  const a = await deleteRemoteKey('doc_' + profileId + '_' + docId);
  const b = await deleteRemoteKey('aichat_' + profileId + '_' + docId);
  return a && b;
}
// Balayage au démarrage : manuscrits déjà supprimés (pierres tombales) dont le contenu serait resté sur le
// serveur (suppression faite avant la v9.30.0, ou serveur injoignable à ce moment-là). Idempotent.
const TOMBSTONE_SWEPT_KEY = 'plume_tombstones_swept';
async function sweepRemoteTombstones() {
  if (!getSyncKey() || !_currentProfileId) return 0;
  let swept; try { swept = new Set(JSON.parse(localStorage.getItem(TOMBSTONE_SWEPT_KEY) || '[]')); } catch (e) { swept = new Set(); }
  const list = await loadDocList();
  let done = 0;
  for (const t of (list.deleted || []).slice(0, 20)) {
    const mark = _currentProfileId + ':' + t.id;
    if (swept.has(mark)) continue;
    if (await deleteRemoteManuscript(_currentProfileId, t.id)) { swept.add(mark); done++; }
  }
  if (done) { try { localStorage.setItem(TOMBSTONE_SWEPT_KEY, JSON.stringify([...swept])); } catch (e) { /* stockage plein */ } }
  return done;
}

// Suppression DÉFINITIVE d'un manuscrit (v9.39.0 : seule la corbeille y mène, ou l'expiration de ses 30 jours).
// Efface le contenu local, pose la pierre tombale dans l'index (les autres appareils retirent l'entrée et leur
// copie), puis efface le contenu chiffré du serveur dès que la pierre tombale y est arrivée.
async function performDocumentDeletion(docId) {
  await persistData(docDataKey(_currentProfileId, docId), null);
  await cleanupDocumentSideData(_currentProfileId, docId);
  // Copie rechargée à l'intérieur du verrou (pas celle lue plus haut, qui a
  // pu devenir périmée pendant l'attente de la confirmation ci-dessus).
  await mutateDocList(freshList => {
    freshList.documents = freshList.documents.filter(d => d.id !== docId);
    // v9.26.0 (AUD-01-008) — pierre tombale : les autres appareils retirent
    // l'entrée et leur copie, et ne la ressuscitent plus à la fusion.
    freshList.deleted = mergeTombstones(freshList.deleted, [{ id: docId, at: Date.now() }], Date.now());
  });
  // La suppression doit partir tout de suite (l'index est sinon différé de 2 min) :
  // un appareil qui se synchroniserait entre-temps ressusciterait l'entrée.
  if (typeof flushPendingSyncPushes === 'function') flushPendingSyncPushes(true);
  // v9.30.0 — une fois la pierre tombale arrivée sur le serveur, on y efface aussi le contenu chiffré (en arrière-plan ;
  // en cas d'échec, la suppression est retentée au prochain démarrage).
  const pid = _currentProfileId;
  (async () => {
    try { await (_pushChains[docListKey(pid)] || Promise.resolve()); } catch (e) { /* sans effet */ }
    await deleteRemoteManuscript(pid, docId);
  })().catch(() => {});
}
// Suppression définitive depuis la corbeille — confirmation forte (retaper le titre exact), même principe que la
// suppression de profil.
async function deleteDocument(docId) {
  const list = await loadDocList();
  const entry = list.documents.find(d => d.id === docId);
  if (!entry) return;
  const title = entry.title || 'Sans titre';
  const ok = await showConfirmModal({
    title: 'Supprimer définitivement ce manuscrit ?',
    message: `« ${title} » et tous ses chapitres seront effacés définitivement, sur tous vos appareils, sans possibilité de récupération.`,
    confirmLabel: 'Supprimer définitivement',
    danger: true,
    requireText: title
  });
  if (!ok) return;
  await performDocumentDeletion(docId);
  await renderLibraryScreen();
  const trashOverlay = document.getElementById('doc-trash-overlay');
  if (trashOverlay && trashOverlay.classList.contains('active')) await renderDocTrash();
  toast('Manuscrit supprimé définitivement (sur tous vos appareils)', 'success');
}
// v9.39.0 (AUD-02-014) — « Supprimer » met à la corbeille 30 jours (réversible : pas de retape du titre).
async function trashDocument(docId) {
  const list = await loadDocList();
  const entry = list.documents.find(d => d.id === docId);
  if (!entry) return;
  const ok = await showConfirmModal({
    title: 'Mettre ce manuscrit à la corbeille ?',
    message: `« ${entry.title || 'Sans titre'} » ira à la corbeille pendant 30 jours : vous pourrez le restaurer depuis la bibliothèque, sur tous vos appareils. Passé ce délai, il sera supprimé définitivement.`,
    confirmLabel: 'Mettre à la corbeille'
  });
  if (!ok) return;
  await mutateDocList(l => {
    const e = l.documents.find(d => d.id === docId);
    if (e) { e.trashedAt = Date.now(); e.lastModified = Date.now(); }
  });
  if (typeof flushPendingSyncPushes === 'function') flushPendingSyncPushes(true);
  await renderLibraryScreen();
  toast('Manuscrit mis à la corbeille (30 jours)', 'success');
}
async function restoreDocumentFromTrash(docId) {
  await mutateDocList(l => {
    const e = l.documents.find(d => d.id === docId);
    if (e) { delete e.trashedAt; e.lastModified = Date.now(); }
  });
  if (typeof flushPendingSyncPushes === 'function') flushPendingSyncPushes(true);
  await renderLibraryScreen();
  await renderDocTrash();
  toast('Manuscrit restauré', 'success');
}
// Suppression définitive automatique des manuscrits dont les 30 jours sont écoulés. Renvoie leur nombre.
async function purgeExpiredDocTrash(list) {
  const expired = expiredTrashedDocuments(list || await loadDocList());
  for (const d of expired) await performDocumentDeletion(d.id);
  if (expired.length) toast(expired.length + ' manuscrit(s) supprimé(s) définitivement (30 jours écoulés)', 'info');
  return expired.length;
}
function closeDocTrash() { document.getElementById('doc-trash-overlay').classList.remove('active'); }
async function openDocTrash() {
  await renderDocTrash();
  document.getElementById('doc-trash-overlay').classList.add('active');
}
async function renderDocTrash() {
  const listEl = document.getElementById('doc-trash-list');
  const trashed = trashedDocuments(await loadDocList()).sort((a, b) => b.trashedAt - a.trashedAt);
  if (!trashed.length) { listEl.innerHTML = '<div class="u-op-72 u-p-16px u-ta-center u-fs-base">La corbeille est vide.</div>'; return; }
  listEl.innerHTML = trashed.map(d => `<div class="history-item u-cur-default">
      <span>${escapeHtml(d.title || 'Sans titre')}<br><span class="u-op-72 u-fs-xs">${d.docType === 'roman_graphique' ? (d.chapterCount || 0) + ' page(s)' : (d.chapterCount || 0) + ' chapitre(s)'} · ${d.wordCount || 0} mots — supprimé définitivement dans ${docTrashDaysLeft(d)} j</span></span>
      <span class="u-d-flex u-gap-4px u-fsh-0">
        <button class="action-btn btn-sm" data-doc-restore="${escapeHtml(d.id)}">${icon('undo-2')} Restaurer</button>
        <button class="action-btn btn-danger btn-sm" data-doc-purge="${escapeHtml(d.id)}">${icon('x')} Définitif</button>
      </span>
    </div>`).join('');
  listEl.querySelectorAll('[data-doc-restore]').forEach(b => b.addEventListener('click', () => restoreDocumentFromTrash(b.dataset.docRestore)));
  listEl.querySelectorAll('[data-doc-purge]').forEach(b => b.addEventListener('click', () => deleteDocument(b.dataset.docPurge)));
}

async function backToLibrary() {
  flushCurrentChapter();
  await save();
  // v9.3.1 — Ne pas attendre le prochain espacement (SYNC_PUSH_MIN_INTERVAL_MS,
  // router.js) pour ce manuscrit qu'on quitte : on force l'envoi tout de suite.
  if (typeof flushPendingSyncPushes === 'function') flushPendingSyncPushes();
  await renderLibraryScreen();
  showLibraryScreen();
  // v7.13.0 (Lot 10) : déclencheur "changement de manuscrit / retour à la
  // bibliothèque" — en plus des 15 min et de la perte de focus de l'onglet.
  syncAllLibraryManuscripts('leave');
}

// Tient à jour titre / dates / compteurs dans l'index de la bibliothèque —
// appelé depuis save() à chaque sauvegarde du manuscrit ouvert.
async function touchDocumentMeta() {
  if (!_currentDocumentId) return;
  await mutateDocList(list => {
    const entry = list.documents.find(d => d.id === _currentDocumentId);
    if (!entry) return;
    entry.title = db.title || 'Sans titre';
    entry.lastModified = Date.now();
    entry.chapterCount = db.chapters.length;
    entry.wordCount = db.chapters.reduce((s,c) => s + getWordCount(c.content), 0);
    entry.wordGoal = db.wordGoal || 0;
  });
}

function updateDocumentTitle(t) {
  db.title = t.trim();
  const dt = document.getElementById('document-title');
  if (dt && dt.innerText !== db.title) dt.innerText = db.title;
  debouncedSave();
}

// ═══════════════════════════════════════════════════════
// RÉGLAGES BIBLIOTHÈQUE — Token GitHub + intervalle auto (v7.13.0, Lot 10)
// Un seul token par profil (compte), mémorisé (chiffré avec la DEK du
// profil, comme les manuscrits) — contrairement à l'ancien _cloudToken
// (Lot 9), qui n'était jamais persisté. Compromis sécurité assumé sur
// demande explicite : plus pratique, le token reste stocké sur l'appareil.
// ═══════════════════════════════════════════════════════
let _libSettings = { autoGistInterval: 15 };
function libSettingsKey(profileId) { return 'libsettings_' + profileId; }
async function loadLibSettings() {
  const raw = await loadData(libSettingsKey(_currentProfileId));
  _libSettings = { autoGistInterval: 15 };
  if (raw && typeof raw.autoGistInterval === 'number') _libSettings.autoGistInterval = raw.autoGistInterval;
  if (raw && raw.token && raw.token._enc) {
    try {
      const dec = await Crypto.decrypt(raw.token.data, _dataKey);
      if (dec) _cloudToken = dec;
    } catch(e) { /* token illisible : on repart sans, l'utilisateur le recollera */ }
  }
}
async function saveLibSettings() {
  const payload = { autoGistInterval: _libSettings.autoGistInterval };
  if (_cloudToken) payload.token = { _enc:true, data: await Crypto.encryptData(_cloudToken, _dataKey) };
  await persistData(libSettingsKey(_currentProfileId), payload);
}

// Vérifie le token GitHub auprès de l'API (endpoint /user, en lecture
// seule) — nouveau v7.14.0, suite à un retour utilisateur : aucun moyen de
// confirmer qu'un token collé est valide avant de tenter une vraie
// sauvegarde. Retourne le login GitHub si valide, sinon null.
async function libVerifyToken() {
  if (!_cloudToken) return null;
  try {
    const resp = await fetchWithTimeout('https://api.github.com/user', { headers: { 'Authorization': `token ${_cloudToken}` }, timeoutMs: 15000 });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.login || 'compte GitHub';
  } catch(e) { return null; }
}

// ═══════════════════════════════════════════════════════
// HELPERS PARTAGÉS — charger/persister un manuscrit par id, indépendamment
// de ce qui est actuellement ouvert dans l'éditeur (`db`). Utilisés ici et
// dans export-format-utils.js (import DOCX/ODT vers un autre manuscrit, export, etc.)
// ═══════════════════════════════════════════════════════
async function loadManuscriptData(docId) {
  const stored = await loadData(docDataKey(_currentProfileId, docId));
  if (!stored || !stored._enc) throw new Error('Manuscrit introuvable.');
  const dec = await Crypto.decrypt(stored.data, _dataKey);
  if (!dec) throw new Error('Déchiffrement impossible.');
  return migrateDb(JSON.parse(dec));
}
async function persistManuscriptData(docId, mData) {
  await persistData(docDataKey(_currentProfileId, docId), await makeEncryptedEnvelope(JSON.stringify(mData)));
}
async function touchDocListEntry(docId, mData) {
  await mutateDocList(list => {
    const entry = list.documents.find(d => d.id === docId);
    if (!entry) return;
    entry.title = mData.title || entry.title;
    entry.chapterCount = mData.chapters.length;
    entry.wordCount = mData.chapters.reduce((s,c) => s + getWordCount(c.content), 0);
    entry.wordGoal = mData.wordGoal || 0;
    entry.lastModified = Date.now();
  });
}

// ═══════════════════════════════════════════════════════
// GIST — PAR MANUSCRIT, ORCHESTRÉ PAR LA BIBLIOTHÈQUE (v7.13.0, Lot 10)
// Chaque manuscrit garde SON PROPRE Gist (mData.gistId) — pas un Gist unique
// pour toute la bibliothèque, pour que l'historique GitHub par manuscrit
// reste lisible (voir l'échange précédent sur la cohérence de cette
// approche). Ces fonctions travaillent toujours à partir du stockage local
// (jamais de `db` en mémoire), donc sûres à appeler même si le manuscrit
// visé n'est pas celui ouvert dans l'éditeur.
// ═══════════════════════════════════════════════════════
// Correction (audit v7.35.0) : lit un contenu de fichier Gist, qu'il soit au
// nouveau format chiffré ({_enc:true,data:<cipher>}) ou à l'ancien format en
// clair (Gists créés avant ce correctif) — compatibilité ascendante requise
// pour ne pas rendre illisibles les sauvegardes déjà existantes.
async function decryptGistContent(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch(e) { throw new Error('Contenu de la sauvegarde GitHub illisible.'); }
  if (parsed && parsed._enc && parsed.data) {
    const dec = await Crypto.decrypt(parsed.data, _dataKey);
    if (!dec) throw new Error('Déchiffrement impossible (profil différent de celui qui a créé cette sauvegarde ?).');
    return JSON.parse(dec);
  }
  return parsed; // ancien format en clair
}

const GIST_BATCH_CHARS = 8000000; // ~8 Mo par requête : prudent vis-à-vis des limites de l'API GitHub
// Message d'erreur précis d'une réponse GitHub (code HTTP + message renvoyé), au lieu d'un « HTTP 422 » nu.
async function gistErrorMessage(resp) {
  let detail = '';
  try { const j = await resp.json(); if (j && j.message) detail = ' — ' + j.message; } catch (e) { /* corps non JSON */ }
  const hint = resp.status === 401 ? ' (jeton GitHub invalide ou expiré)' : resp.status === 403 ? ' (limite de l\'API ou droits insuffisants)' : resp.status === 413 || resp.status === 422 ? ' (envoi trop volumineux ?)' : '';
  return `HTTP ${resp.status}${detail}${hint}`;
}
// Retient gistId et images déjà envoyées sur la copie À JOUR du manuscrit (même principe que la fin de libSyncManuscript).
async function persistGistProgress(docId, gistId, imageIds) {
  try {
    const fresh = await loadManuscriptData(docId);
    fresh.gistId = gistId;
    if (imageIds.length) fresh.gistSyncedImageIds = Array.from(new Set([...(fresh.gistSyncedImageIds || []), ...imageIds]));
    if (_currentDocumentId === docId && db) { db.gistId = gistId; if (imageIds.length) db.gistSyncedImageIds = fresh.gistSyncedImageIds; }
    await persistManuscriptData(docId, fresh);
  } catch (e) { /* meilleur effort */ }
}
async function libSyncManuscript(docId, opts) {
  opts = opts || {};
  if (!_cloudToken) { if (!opts.silent) toast('Token GitHub requis.', 'error'); return false; }
  try {
    const mData = await loadManuscriptData(docId);
    const files = {};
    // Images du roman graphique (Lot 7, audit #25) : chaque image devient un
    // fichier séparé DANS LE MÊME Gist (chiffré comme le reste), jamais un
    // seul gros blob — seules les images nouvelles depuis la dernière
    // synchro sont envoyées (mData.gistSyncedImageIds mémorise ce qui l'a
    // déjà été), pour ne pas retransmettre tout le lot à chaque sauvegarde.
    // v9.28.0 (audit AUD-01-026) — Les images sont DÉJÀ chiffrées au repos : on envoie leurs octets
    // chiffrés tels quels (base64, préfixe « v2: ») au lieu de les rechiffrer (ancien format : ×1,8 en
    // poids et un PBKDF2 par image). Envoi PAR PAQUETS d'au plus GIST_BATCH_CHARS caractères : un
    // livre de plusieurs dizaines de pages ne tient pas dans une seule requête.
    const imageFiles = []; // { id, name, content }
    if (mData.docType === 'roman_graphique' && typeof getAllGraphicImagesForDocument === 'function') {
      const referenced = new Set();
      (mData.pages || []).forEach(p => (p.elements || []).forEach(el => { if (el.type === 'image' && el.imageId) referenced.add(el.imageId); }));
      const synced = new Set(mData.gistSyncedImageIds || []);
      const localImages = await getAllGraphicImagesForDocument(docId);
      const toUpload = localImages.filter(r => referenced.has(r.id) && !synced.has(r.id));
      if (toUpload.length && typeof notifyGistImageSyncOnce === 'function') await notifyGistImageSyncOnce();
      for (const rec of toUpload) {
        try {
          const cipher = await graphicImageCipher(rec);
          if (!cipher) continue;
          imageFiles.push({ id: rec.id, name: `img_${rec.id}.txt`, content: 'v2:' + imgBytesToBase64(cipher) + ':' + (rec.mime || 'image/webp') });
        } catch(e) { /* une image illisible localement ne doit pas bloquer la synchro du reste */ }
      }
    }
    const batches = [];
    { let cur = [], size = 0;
      for (const f of imageFiles) {
        if (cur.length && size + f.content.length > GIST_BATCH_CHARS) { batches.push(cur); cur = []; size = 0; }
        cur.push(f); size += f.content.length;
      }
      if (cur.length) batches.push(cur); }
    const method = mData.gistId ? 'PATCH' : 'POST';
    const url = mData.gistId ? `https://api.github.com/gists/${mData.gistId}` : 'https://api.github.com/gists';
    // Correction (audit v7.35.0) : le contenu était jusqu'ici envoyé à GitHub
    // EN CLAIR — contredisant le chiffrement "zero-knowledge" annoncé par
    // ailleurs dans le projet. Chiffré ici avec la même DEK que le stockage
    // local (exactement comme persistManuscriptData()) ; GitHub ne reçoit
    // désormais plus qu'un blob illisible sans le mot de passe du profil.
    const cipher = await Crypto.encryptData(JSON.stringify(mData), _dataKey);
    files["plume.json"] = { content: JSON.stringify({ _enc:true, data:cipher }) };
    // Première requête : le manuscrit + le 1er paquet d'images ; puis un PATCH par paquet restant.
    // Les identifiants d'images réellement envoyés sont retenus au fur et à mesure : un échec au
    // milieu d'un gros livre ne fait pas tout recommencer.
    const newImageIds = [];
    const first = batches.shift() || [];
    first.forEach(f => { files[f.name] = { content: f.content }; });
    let resp = await fetchWithTimeout(url, { timeoutMs: 120000, method, headers:{'Authorization':`token ${_cloudToken}`,'Content-Type':'application/json'}, body: JSON.stringify({ public:false, files }) });
    if (!resp.ok) throw new Error(await gistErrorMessage(resp));
    let data = await resp.json();
    if (data.id && data.id !== mData.gistId) mData.gistId = data.id;
    first.forEach(f => newImageIds.push(f.id));
    const totalBatches = batches.length + 1;
    for (let i = 0; i < batches.length; i++) {
      if (!opts.silent) toast(`Sauvegarde GitHub : images ${i + 2}/${totalBatches}…`, 'info');
      const extra = {}; batches[i].forEach(f => { extra[f.name] = { content: f.content }; });
      try {
        const r2 = await fetchWithTimeout(`https://api.github.com/gists/${mData.gistId}`, { timeoutMs: 120000, method: 'PATCH', headers:{'Authorization':`token ${_cloudToken}`,'Content-Type':'application/json'}, body: JSON.stringify({ files: extra }) });
        if (!r2.ok) throw new Error(await gistErrorMessage(r2));
        batches[i].forEach(f => newImageIds.push(f.id));
      } catch (e) {
        await persistGistProgress(docId, mData.gistId, newImageIds); // ce qui est déjà parti est retenu
        throw new Error(`images ${i + 2}/${totalBatches} : ${e.message}`);
      }
    }
    // Persisté à chaque appel désormais (plus seulement au premier envoi) :
    // gistSyncedImageIds doit rester à jour localement pour éviter de
    // renvoyer les mêmes images indéfiniment.
    // v9.26.0 (audit AUD-01-007) — NE PAS réécrire la copie lue AVANT l'envoi
    // réseau : pendant ces secondes l'éditeur a pu enregistrer de nouveaux
    // mots, que cette réécriture aurait écrasés. On relit le manuscrit tel
    // qu'il est MAINTENANT et on n'y ajoute que les deux informations de la
    // sauvegarde ; l'éditeur ouvert sur ce manuscrit les reçoit aussi en
    // mémoire (sinon son prochain enregistrement les effacerait).
    const fresh = await loadManuscriptData(docId);
    fresh.gistId = mData.gistId;
    if (newImageIds.length) fresh.gistSyncedImageIds = Array.from(new Set([...(fresh.gistSyncedImageIds || []), ...newImageIds]));
    if (_currentDocumentId === docId && db) {
      db.gistId = fresh.gistId;
      if (newImageIds.length) db.gistSyncedImageIds = fresh.gistSyncedImageIds;
    }
    await persistManuscriptData(docId, fresh);
    await mutateDocList(list => {
      const entry = list.documents.find(d => d.id === docId);
      if (entry) entry.lastGistSync = Date.now();
    });
    return true;
  } catch(e) {
    if (!opts.silent) toast('Erreur de sauvegarde GitHub : ' + e.message, 'error');
    return false;
  }
}
async function libLoadManuscript(docId) {
  try {
    const mData = await loadManuscriptData(docId);
    if (!mData.gistId) { toast("Ce manuscrit n'a pas encore de Gist.", 'error'); return; }
    const resp = await fetchWithTimeout(`https://api.github.com/gists/${mData.gistId}`, { headers: _cloudToken ? {'Authorization':`token ${_cloudToken}`} : {} });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const raw = data.files && data.files["plume.json"] && data.files["plume.json"].content;
    if (!raw) throw new Error('Fichier introuvable dans cette sauvegarde GitHub.');
    const restored = migrateDb(await decryptGistContent(raw));
    restored.gistId = mData.gistId;
    // Images (Lot 7, audit #25) : réhydrate la base locale d'images à partir
    // des fichiers "img_*" présents dans ce Gist — sans ça, un manuscrit
    // restauré sur un nouvel appareil garderait des cadres vides.
    if (restored.docType === 'roman_graphique' && typeof putGraphicImageRecord === 'function') {
      const imageFiles = Object.keys(data.files || {}).filter(name => /^img_.+\.txt$/.test(name));
      for (const fname of imageFiles) {
        const imgId = fname.slice(4, -4);
        try {
          const file = data.files[fname];
          let content = file.content;
          if (file.truncated && file.raw_url) {
            const rawResp = await fetchWithTimeout(file.raw_url, { headers: _cloudToken ? {'Authorization':`token ${_cloudToken}`} : {} });
            content = await rawResp.text();
          }
          let rec = null;
          if (content.startsWith('v2:')) {
            // v9.28.0 : octets chiffrés tels quels (« v2:<base64>:<mime> »)
            const [, b64, mime] = content.split(':');
            rec = await restoreGraphicImage({ id: imgId, docId, cipherBytes: imgBase64ToBytes(b64), mime: mime || 'image/webp', refCount: 1 });
          } else {
            // ancien format : base64 de l'image, chiffré comme un texte
            const b64 = await Crypto.decrypt(content, _dataKey);
            if (!b64) continue; // sauvegarde d'un autre profil, illisible — ignorée sans bloquer le reste
            rec = await restoreGraphicImage({ id: imgId, docId, plainBytes: imgBase64ToBytes(b64), mime: 'image/webp', refCount: 1 });
          }
          if (rec && typeof createImageBitmap === 'function') {
            // dimensions : relues sur l'image elle-même (non critiques)
            try {
              const bytes = await graphicImageBytes(rec);
              const bmp = await createImageBitmap(new Blob([bytes], { type: rec.mime || 'image/webp' }));
              const db2 = await plumeImagesDb(); const cur2 = await db2.get('images', imgId);
              if (cur2) { cur2.width = bmp.width; cur2.height = bmp.height; await db2.put('images', cur2); }
              bmp.close && bmp.close();
            } catch (e) { /* dimensions non critiques */ }
          }
        } catch(e) { /* une image corrompue ne doit pas bloquer la restauration du reste */ }
      }
      restored.gistSyncedImageIds = imageFiles.map(f => f.slice(4, -4));
    }
    await persistManuscriptData(docId, restored);
    await touchDocListEntry(docId, restored);
    toast('Manuscrit restauré depuis la sauvegarde GitHub.', 'success');
    await renderLibraryScreen();
    refreshLibSystemDocStatus(docId);
  } catch(e) { toast('Erreur : ' + e.message, 'error'); }
}
function closeGistHistory() { document.getElementById('gist-history-overlay').classList.remove('active'); }
async function libOpenGistHistory(docId) {
  let mData;
  try { mData = await loadManuscriptData(docId); } catch(e) { toast(e.message, 'error'); return; }
  if (!mData.gistId) { toast("Ce manuscrit n'a pas encore de Gist.", 'error'); return; }
  const listEl = document.getElementById('gist-history-list');
  listEl.innerHTML = '<div class="u-p-10px u-op-75">Chargement…</div>';
  document.getElementById('gist-history-overlay').classList.add('active');
  try {
    const resp = await fetchWithTimeout(`https://api.github.com/gists/${mData.gistId}/commits`, { headers: _cloudToken ? {'Authorization':`token ${_cloudToken}`} : {} });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const commits = await resp.json();
    if (!commits.length) { listEl.innerHTML = '<div class="u-p-10px u-op-75">Aucun historique.</div>'; return; }
    listEl.innerHTML = '';
    commits.slice().reverse().forEach((c, i) => {
      const date = new Date(c.committed_at).toLocaleString('fr');
      const el = document.createElement('div');
      el.className = 'history-item';
      el.innerHTML = `<span>${i===0?'Version actuelle':'Version'} — ${date}</span>`;
      el.addEventListener('click', () => libLoadGistRevision(docId, mData.gistId, c.version));
      listEl.appendChild(el);
    });
  } catch(e) { listEl.innerHTML = `<div class="u-p-10px u-c-v-danger">${icon('circle-alert')} ${escapeHtml(e.message)}</div>`; }
}
async function libLoadGistRevision(docId, gistId, sha) {
  if (!(await showConfirmModal({ title: 'Charger cette version ?', message: 'Cette version remplacera le contenu de ce manuscrit.', confirmLabel: 'Charger cette version', danger: true }))) return;
  try {
    const resp = await fetchWithTimeout(`https://api.github.com/gists/${gistId}/${sha}`, { headers: _cloudToken ? {'Authorization':`token ${_cloudToken}`} : {} });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const raw = data.files && data.files["plume.json"] && data.files["plume.json"].content;
    if (!raw) throw new Error('Fichier introuvable dans cette version');
    const restored = migrateDb(await decryptGistContent(raw));
    restored.gistId = gistId;
    await persistManuscriptData(docId, restored);
    await touchDocListEntry(docId, restored);
    closeGistHistory();
    toast('Version restaurée.', 'success');
    await renderLibraryScreen();
    refreshLibSystemDocStatus(docId);
  } catch(e) { toast('Erreur : ' + e.message, 'error'); }
}

// ═══════════════════════════════════════════════════════
// SAUVEGARDE AUTO — TOUTE LA BIBLIOTHÈQUE (v7.13.0, Lot 10)
// 3 déclencheurs : toutes les 15 min (par défaut), au retour à la
// bibliothèque (backToLibrary), et à la perte de focus de l'onglet
// (voir router.js). Si des échecs surviennent (token expiré, réseau...),
// un avertissement s'affiche une fois — pas de spam à chaque cycle.
// ═══════════════════════════════════════════════════════
let _libSyncing = false, _libBackupWarned = false;
async function syncAllLibraryManuscripts(reason) {
  if (_libSyncing || !_currentProfileId || !_dataKey || !_cloudToken) return;
  const interval = (_libSettings && _libSettings.autoGistInterval) || 0;
  if (interval <= 0 && reason !== 'manual') return;
  _libSyncing = true;
  try {
    if (_currentDocumentId && !document.body.classList.contains('library-mode')) { flushCurrentChapter(); await save(); }
    const list = await loadDocList();
    let failures = 0;
    for (const entry of list.documents) { if (!(await libSyncManuscript(entry.id, { silent:true }))) failures++; }
    if (failures > 0 && !_libBackupWarned) { _libBackupWarned = true; toast('Sauvegarde GitHub auto : '+failures+' manuscrit(s) en échec (jeton expiré ?).', 'error'); }
    else if (failures === 0) _libBackupWarned = false;
    if (document.body.classList.contains('library-mode')) await renderLibraryScreen();
  } finally { _libSyncing = false; }
}
let _libAutoTimer = null;
function scheduleLibraryAutoBackup() {
  clearInterval(_libAutoTimer); _libAutoTimer = null;
  const minutes = (_libSettings && _libSettings.autoGistInterval) || 0;
  if (minutes <= 0) return;
  _libAutoTimer = setInterval(() => syncAllLibraryManuscripts('interval'), minutes * 60 * 1000);
}

// ═══════════════════════════════════════════════════════
// PANNEAU SYSTÈME — bibliothèque entière (v7.13.0, Lot 10)
// Remplace l'ancien onglet "📦 Backup" de l'éditeur (retiré). Regroupe :
// GitHub Gist (token + intervalle, pour toute la bibliothèque), actions sur
// UN manuscrit choisi (export, import DOCX/ODT, Gist manuel/historique), et
// export/import JSON de toute la bibliothèque.
// ═══════════════════════════════════════════════════════
// v9.45.0 (AUD-03-026) : trois onglets (files / github / sync). Une seule liste de manuscrits, utile aux deux
// premiers ; elle est masquée dans l'onglet Synchronisation (qui concerne tous les manuscrits).
function showSystemTab(name) {
  document.querySelectorAll('#library-system-overlay .lib-systab').forEach(b => {
    const on = b.dataset.systab === name;
    b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll('#library-system-overlay .lib-sys-pane').forEach(p => p.classList.toggle('active', p.id === 'lib-sys-' + name));
  document.getElementById('lib-sys-doc-zone').classList.toggle('u-d-none', name === 'sync');
}
async function openLibrarySystemPanel(preselectDocId, tab) {
  document.getElementById('lib-gh-token').value = _cloudToken || '';
  document.getElementById('lib-auto-gist-interval').value = String(_libSettings.autoGistInterval ?? 15);
  document.getElementById('lib-cloud-status').textContent = '';
  const list = await loadDocList();
  const sorted = liveDocuments(list).sort((a,b)=>b.lastModified-a.lastModified);
  const optionsHtml = sorted.map(d => `<option value="${d.id}">${DOMPurify.sanitize(d.title || 'Sans titre')}</option>`).join('');
  const sel = document.getElementById('lib-system-doc-select');
  sel.innerHTML = optionsHtml;
  if (preselectDocId) sel.value = preselectDocId;
  await refreshLibSystemDocStatus(sel.value);

  // Bloc "Clé de synchronisation" : toujours réaffiché en lecture seule
  const syncKeyInput = document.getElementById('lib-sync-key-input');
  syncKeyInput.readOnly = true;
  syncKeyInput.type = 'password';
  syncKeyInput.value = getSyncKey() || '';
  syncKeyInput.placeholder = getSyncKey() ? '' : 'Aucune clé enregistrée sur cet appareil';
  document.getElementById('lib-sync-key-change-btn').innerHTML = icon('pencil') + ' Changer la clé';
  document.getElementById('lib-sync-key-status').textContent = '';
  renderLastSyncStatus();
    renderSyncUsage();
  await renderConflictBackups();

  showSystemTab(tab || (_setupTourActive ? 'github' : 'files'));
  document.getElementById('library-system-overlay').classList.add('active');

  if (_setupTourActive) {
    showSetupBubble('#lib-gh-token', 'Collez ici votre jeton d\'accès GitHub personnel, puis vérifiez-le : vos manuscrits seront alors sauvegardés automatiquement, à l\'abri d\'une panne ou d\'une perte d\'appareil.', 'Sauvegarde automatique');
  }
}

// v7.33.0 — Bloc "Sauvegardes de conflit" du panneau Système : donne enfin
// accès aux sauvegardes créées automatiquement par la détection de conflit
// multi-appareils (voir persistConflictBackup() dans router.js, v7.27.0).
// Jusqu'ici ces sauvegardes existaient (rien n'est jamais perdu) mais rien
// ne permettait de les consulter ou de les restaurer soi-même.
// v7.40.0 — Rétention 7 jours : au-delà, une sauvegarde de conflit non
// consultée est purgée automatiquement (silencieux, pas de tâche de fond
// séparée — la vérification à chaque ouverture du panneau suffit vu la
// fréquence de consultation attendue). Demande explicite de l'utilisateur.
const CONFLICT_BACKUP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
async function listConflictBackups() {
  const prefix = 'conflict_doc_' + _currentProfileId + '_';
  let keys = [];
  if (idbStore) keys = (await idbStore.getAllKeys('data')).filter(k => typeof k === 'string' && k.startsWith(prefix));
  else keys = Object.keys(localStorage).filter(k => k.startsWith('plume_' + prefix)).map(k => k.slice('plume_'.length));
  const list = await loadDocList();
  const now = Date.now();
  const kept = [];
  for (const key of keys) {
    const rest = key.slice(prefix.length);
    const lastUnderscore = rest.lastIndexOf('_');
    const docId = rest.slice(0, lastUnderscore);
    const ts = parseInt(rest.slice(lastUnderscore + 1), 10);
    if (now - ts > CONFLICT_BACKUP_MAX_AGE_MS) { await removeConflictBackup(key); continue; }
    const entry = list.documents.find(d => d.id === docId);
    kept.push({ key, docId, ts, title: entry ? entry.title : 'Manuscrit supprimé depuis' });
  }
  return kept.sort((a, b) => b.ts - a.ts);
}
async function getConflictBackupPayload(key) {
  if (idbStore) return await idbStore.get('data', key);
  const r = localStorage.getItem('plume_' + key);
  return r ? JSON.parse(r) : undefined;
}
async function removeConflictBackup(key) {
  if (idbStore) await idbStore.delete('data', key);
  else localStorage.removeItem('plume_' + key);
}
// v9.3.0 — Remplace la purge automatique introduite en v9.2.4, qui était
// FAUSSE et supprimait en réalité toutes les sauvegardes : après une
// réconciliation, c'est toujours la version locale qui finissait sur le
// serveur, donc la version distante sauvegardée ne correspondait jamais au
// serveur et était considérée à tort comme « déjà résolue ». Résultat : le
// message d'alerte s'affichait, mais la liste était vide et le badge vert.
//
// Le nettoyage repose désormais sur un critère sûr : une sauvegarde n'est
// supprimée que si son contenu est identique au contenu local actuel — elle
// n'apporte alors réellement plus rien. Tout le reste est conservé (rétention
// 7 jours) et reste arbitrable.
async function getActiveConflictBackups() {
  const backups = await listConflictBackups();
  if (!backups.length) return [];
  const kept = [];
  for (const b of backups) {
    let payload;
    try { payload = await getConflictBackupPayload(b.key); } catch(e) { payload = undefined; }
    if (payload === undefined) continue;
    let redundant = false;
    try {
      const local = await readLocalOnly(docDataKey(_currentProfileId, b.docId));
      const backupFp = await valueFingerprint(payload);
      const localFp = await valueFingerprint(local);
      redundant = !!(backupFp && localFp && backupFp === localFp);
    } catch(e) { redundant = false; }
    if (redundant) { await removeConflictBackup(b.key); continue; }
    kept.push({ ...b, awaiting: isConflictPaused(docDataKey(_currentProfileId, b.docId)) });
  }
  return kept;
}

async function renderConflictBackups() {
  const cont = document.getElementById('lib-conflict-list');
  const badge = document.getElementById('lib-conflict-count');
  if (!cont || !badge) return;
  const rows = await getActiveConflictBackups();
  badge.textContent = String(rows.length);
  badge.classList.toggle('u-d-none', rows.length === 0);
  const tabBadge = document.getElementById('lib-systab-conflict-count');
  if (tabBadge) { tabBadge.textContent = String(rows.length); tabBadge.classList.toggle('u-d-none', rows.length === 0); }
  const deleteAllBtn = document.getElementById('lib-conflict-delete-all');
  if (deleteAllBtn) deleteAllBtn.classList.toggle('u-d-none', rows.length === 0);
  if (!rows.length) {
    cont.innerHTML = `<p class="u-fs-xs u-c-v-text-muted u-m-0">Aucune sauvegarde de conflit en attente.</p>`;
    return;
  }

  cont.innerHTML = rows.map(b => `
    <div class="u-d-flex u-ai-center u-gap-8px u-p-10px u-br-2 u-bd-1px-solid-v-border${b.awaiting ? ' conflict-row-awaiting' : ''}">
      <div class="u-flex-1 u-minw-0">
        <p class="u-fs-base u-m-0">${DOMPurify.sanitize(b.title || 'Sans titre')}
          ${b.awaiting ? '<span class="mp-badge conflict-badge-awaiting">En attente de votre choix</span>' : ''}
        </p>
        <p class="u-fs-xs u-c-v-text-muted u-m-4px-0-0">Détectée le ${new Date(b.ts).toLocaleString('fr')}</p>
        ${b.awaiting ? '<p class="u-fs-xs u-c-v-text-muted u-m-2px-0-0">Synchro de ce manuscrit en pause jusqu\'à votre décision.</p>' : ''}
      </div>
      <button class="action-btn btn-sm" data-conflict-compare="${b.key}" data-conflict-docid="${b.docId}" title="Comparer les deux versions avant de choisir">${icon('search')} Comparer</button>
      <button class="action-btn btn-danger btn-sm" data-conflict-delete="${b.key}" data-conflict-docid="${b.docId}" title="Supprimer cette sauvegarde">${icon('trash-2')}</button>
    </div>`).join('');
  cont.querySelectorAll('[data-conflict-delete]').forEach(btn => {
    btn.addEventListener('click', () => deleteConflictBackup(btn.dataset.conflictDelete, btn.dataset.conflictDocid));
  });
  cont.querySelectorAll('[data-conflict-compare]').forEach(btn => {
    btn.addEventListener('click', () => compareConflictBackup(btn.dataset.conflictCompare, btn.dataset.conflictDocid));
  });
}

// v9.3.0 — Déchiffre une enveloppe de manuscrit pour l'inspecter (comparaison
// de conflit). Correction d'un bug de la v9.2.0 : la comparaison lisait
// directement `.chapters` sur l'enveloppe CHIFFRÉE, où ce champ n'existe pas —
// les deux textes comparés étaient donc toujours vides, d'où le « 0 mot
// ajouté » affiché même après avoir écrit des pages (remonté le 29/07/2026).
async function decryptEnvelopeForCompare(env) {
  if (!env) return null;
  if (!env._enc) return env; // ancien format en clair
  if (!_dataKey || !env.data) return null;
  try {
    const plain = await Crypto.decrypt(env.data, _dataKey);
    return plain === null ? null : JSON.parse(plain);
  } catch(e) { return null; }
}
function manuscriptPlainText(data) {
  return ((data && data.chapters) || []).map(c => getPlainText(c.content)).join('\n');
}
function manuscriptWordCount(data) {
  return ((data && data.chapters) || []).reduce((s, c) => s + getWordCount(c.content), 0);
}

async function compareConflictBackup(key, docId) {
  const backupEnv = await getConflictBackupPayload(key);
  if (backupEnv === undefined) { toast('Sauvegarde introuvable.', 'error'); return; }
  const localEnv = await readLocalOnly(docDataKey(_currentProfileId, docId));
  const backupData = await decryptEnvelopeForCompare(backupEnv);
  const localData = await decryptEnvelopeForCompare(localEnv);
  if (!backupData || !localData) {
    toast('Impossible de lire ces versions (profil différent ?).', 'error');
    return;
  }

  const fmt = ts => ts ? new Date(ts).toLocaleString('fr') : 'date inconnue';
  document.getElementById('conflict-diff-local-words').textContent = manuscriptWordCount(localData) + ' mots';
  document.getElementById('conflict-diff-local-date').textContent = fmt(localEnv && localEnv._ts);
  document.getElementById('conflict-diff-remote-words').textContent = manuscriptWordCount(backupData) + ' mots';
  document.getElementById('conflict-diff-remote-date').textContent = fmt(backupEnv && backupEnv._ts);
  document.getElementById('conflict-diff-title').textContent = localData.title || backupData.title || 'Ce manuscrit';
  document.getElementById('conflict-diff-content').innerHTML =
    computeDiff(manuscriptPlainText(localData), manuscriptPlainText(backupData));

  document.getElementById('conflict-diff-keep-local-btn').onclick = () => resolveConflictKeepLocal(key, docId);
  document.getElementById('conflict-diff-keep-backup-btn').onclick = () => resolveConflictKeepBackup(key, docId);
  document.getElementById('conflict-diff-overlay').classList.add('active');
}

// v9.3.0 — Fermeture sans trancher : demande explicite de l'utilisateur.
// La synchro de ce manuscrit reste en pause et la sauvegarde est conservée :
// on peut y revenir plus tard sans que rien n'ait été écrasé entre-temps.
function closeConflictDiff() {
  document.getElementById('conflict-diff-overlay').classList.remove('active');
}

// ── Résolution : on garde la version de CET appareil ──
async function resolveConflictKeepLocal(key, docId) {
  const dataKey = docDataKey(_currentProfileId, docId);
  await removeConflictBackup(key);
  removeConflictPausedKey(dataKey);
  // La version locale devient la référence : on la renvoie au serveur, qui
  // l'imposera à l'autre appareil à sa prochaine synchronisation.
  const local = await readLocalOnly(dataKey);
  if (local) queueSyncPush(dataKey, local);
  closeConflictDiff();
  await renderConflictBackups();
  await renderLibrarySyncBadge();
  toast('Version de cet appareil conservée et synchronisée.', 'success');
}

// ── Résolution : on garde la version de l'autre appareil ──
async function resolveConflictKeepBackup(key, docId) {
  const dataKey = docDataKey(_currentProfileId, docId);
  const payload = await getConflictBackupPayload(key);
  if (payload === undefined) { toast('Sauvegarde introuvable (déjà supprimée ?).', 'error'); await renderConflictBackups(); return; }
  await writeLocalOnly(dataKey, payload);
  await markRemoteAdopted(dataKey, payload);
  cancelScheduledPush(dataKey); // v9.53.2
  await removeConflictBackup(key);
  removeConflictPausedKey(dataKey);
  closeConflictDiff();
  await renderConflictBackups();
  await renderLibrarySyncBadge();
  await renderLibraryScreen();
  toast('Version de l\'autre appareil adoptée.', 'success');
}

async function deleteConflictBackup(key, docId) {
  if (!(await showConfirmModal({ title: 'Supprimer cette sauvegarde de conflit ?', message: 'La version de cet appareil sera conservée et synchronisée.', confirmLabel: 'Supprimer la sauvegarde', danger: true }))) return;
  await removeConflictBackup(key);
  // v9.3.0 — Supprimer la sauvegarde revient à trancher en faveur de cet
  // appareil : la synchro de ce manuscrit doit donc reprendre, sinon elle
  // resterait bloquée en attente d'un arbitrage devenu sans objet.
  if (docId) {
    const dataKey = docDataKey(_currentProfileId, docId);
    removeConflictPausedKey(dataKey);
    const local = await readLocalOnly(dataKey);
    if (local) queueSyncPush(dataKey, local);
  }
  await renderConflictBackups();
  await renderLibrarySyncBadge();
  toast('Sauvegarde supprimée.', 'success');
}
// v7.40.0 — Demande explicite de l'utilisateur : vider le bloc en un clic
// plutôt que de supprimer chaque sauvegarde une par une.
async function deleteAllConflictBackups() {
  const backups = await listConflictBackups();
  if (!backups.length) return;
  const ok = await showConfirmModal({
    title: 'Supprimer toutes les sauvegardes de conflit ?',
    message: `${backups.length} sauvegarde(s) seront supprimées définitivement, sans possibilité de récupération.`,
    confirmLabel: 'Tout supprimer',
    danger: true
  });
  if (!ok) return;
  for (const b of backups) {
    await removeConflictBackup(b.key);
    // v9.3.0 — Idem deleteConflictBackup() : lever la pause, sinon la synchro
    // de ces manuscrits resterait bloquée indéfiniment.
    const dataKey = docDataKey(_currentProfileId, b.docId);
    removeConflictPausedKey(dataKey);
    const local = await readLocalOnly(dataKey);
    if (local) queueSyncPush(dataKey, local);
  }
  await renderConflictBackups();
  await renderLibrarySyncBadge();
  toast('Sauvegardes de conflit supprimées.', 'success');
}

// v7.25.0 — Rend visible le résultat de la dernière tentative de
// synchronisation multi-appareils (voir _lastSyncStatus dans router.js) :
// un échec silencieux (Worker injoignable, hors-ligne...) était auparavant
// invisible pour l'utilisateur, alors que "ça n'a pas l'air de synchroniser"
// est justement le genre de souci qu'on veut pouvoir diagnostiquer soi-même.
function renderLastSyncStatus() {
  const el = document.getElementById('lib-last-sync-status');
  if (!el) return;
  if (!getSyncKey()) { el.textContent = ''; return; }
  const status = getLastSyncStatus();
  if (status.ok === null) { el.textContent = 'Aucune synchronisation tentée depuis l\'ouverture de la page.'; el.style.color = 'var(--text-muted)'; return; }
  const when = formatRelativeDate(status.ts).replace('Modifié ', '');
  if (status.ok) { el.textContent = 'Dernière synchro réussie : ' + when; el.style.color = 'var(--success)'; }
  else { el.textContent = 'Dernière tentative de synchro échouée (' + when + ') — l\'app continue de fonctionner en local, réessai automatique à la prochaine sauvegarde.'; el.style.color = 'var(--danger)'; }
}
// v9.29.0 (audit AUD-01-016) — occupation du stockage de synchronisation, lue auprès du Worker
// (nombres et octets seulement) : de quoi voir venir un dépassement avant qu'il ne bloque la synchro.
function formatMo(octets) {
  if (octets > 0 && octets < 0.05 * 1024 * 1024) return '< 0,1 Mo';
  return (octets / (1024 * 1024)).toFixed(octets < 10 * 1024 * 1024 ? 1 : 0).replace('.', ',') + ' Mo';
}
async function renderSyncUsage() {
  const el = document.getElementById('lib-sync-usage');
  if (!el) return;
  el.textContent = '';
  if (!getSyncKey()) return;
  try {
    const resp = await fetchWithTimeout(SYNC_WORKER_URL + '?key=__usage__', { headers: { 'Authorization': 'Bearer ' + getSyncKey() }, timeoutMs: 8000 });
    if (!resp.ok) return;
    const u = await resp.json();
    if (u.storage !== 'd1') { el.textContent = 'Stockage de synchronisation : ancien mode (KV).'; return; }
    el.textContent = `Serveur : ${u.manuscripts} manuscrit(s), images ${formatMo(u.imagesBytes)} sur ${formatMo(u.imagesBudget)} de budget, ${formatMo(u.totalBytes)} au total (limite gratuite de la base : ${formatMo(u.dbLimit)}).`;
  } catch (e) { /* mesure purement informative */ }
}
function closeLibrarySystemPanel() {
  document.getElementById('library-system-overlay').classList.remove('active');
  // Fermer le panneau sans token = « plus tard » : plus de bulle orpheline (AUD-03-001).
  if (_setupTourActive) endSetupTour();
  renderGithubReminder();
}
async function refreshLibSystemDocStatus(docId) {
  const statusEl = document.getElementById('lib-doc-gist-status');
  if (!docId) { statusEl.textContent = ''; return; }
  try {
    const mData = await loadManuscriptData(docId);
    const list = await loadDocList();
    const entry = list.documents.find(d => d.id === docId);
    statusEl.textContent = mData.gistId
      ? `Gist : ${mData.gistId}${entry && entry.lastGistSync ? ' · dernière sauvegarde ' + formatRelativeDate(entry.lastGistSync).replace('Modifié ','') : ''}`
      : 'Pas encore de sauvegarde GitHub pour ce manuscrit (créée au premier « Sauver »).';
  } catch(e) { statusEl.textContent = ''; }
}
async function libExportCurrent() { return libExportDoc(document.getElementById('lib-system-doc-select').value); }
// v9.45.0 (AUD-03-014) : le ⋮ de la carte ouvre directement la fenêtre d'export (avant : le panneau Système, puis « Exporter »).
async function libExportDoc(docId) {
  if (!docId) { toast('Aucun manuscrit sélectionné.', 'error'); return; }
  try {
    const mData = await loadManuscriptData(docId);
    // v9.35.0 (AUD-02-016) : un roman graphique n'a pas de chapitres, son export est dans son propre écran.
    if (mData.docType === 'roman_graphique' || !Array.isArray(mData.chapters)) { toast("Ce manuscrit est un roman graphique : utilisez l'export de son écran (bouton Exporter).", 'info'); return; }
    openExportSelect(mData.chapters, mData.title);
  } catch(e) { toast('Erreur : ' + e.message, 'error'); }
}
