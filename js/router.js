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
const APP_VERSION = '7.28.0';

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
// Sauvegarde locale uniquement (ne relance pas syncPush, sans quoi on
// boucle) — utilisée pour ne jamais perdre la version distante écrasée.
async function persistConflictBackup(key, payload) {
  try {
    const backupKey = 'conflict_' + key + '_' + Date.now();
    if (idbStore) await idbStore.put('data', payload, backupKey);
    else localStorage.setItem('plume_' + backupKey, JSON.stringify(payload));
  } catch(e) { /* la sauvegarde de secours elle-même ne doit jamais faire planter la sync normale */ }
}

async function syncPush(key, payload) {
  const syncKey = getSyncKey();
  if (!syncKey) return;
  try {
    const body = JSON.stringify(payload);
    const newHash = await sha256Hex(body);

    // --- Détection de conflit (v7.27.0), voir commentaire ci-dessus ---
    const known = getKnownRemoteHash(key);
    if (known) {
      try {
        const resp = await fetch(SYNC_WORKER_URL + '?key=' + encodeURIComponent(key), { headers: { 'Authorization': 'Bearer ' + syncKey } });
        if (resp.ok) {
          const remote = await resp.json();
          if (remote !== null && remote !== undefined) {
            const remoteHash = await sha256Hex(JSON.stringify(remote));
            if (remoteHash !== known && remoteHash !== newHash) {
              await persistConflictBackup(key, remote);
              if (typeof toast === 'function') toast("Synchro : une version différente de cet élément a été détectée sur un autre appareil et sauvegardée avant remplacement.", 'error');
            }
          }
        }
      } catch(e) { /* vérif de conflit best-effort : si elle échoue, on pousse quand même normalement */ }
    }
    // --- fin détection de conflit ---

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
      headers: { 'Content-Type':'application/json', 'Authorization':'Bearer ' + syncKey },
      body
    };
    if (body.length < 60000) opts.keepalive = true;
    const resp = await fetch(SYNC_WORKER_URL + '?key=' + encodeURIComponent(key), opts);
    _lastSyncStatus = { ok: resp.ok, ts: Date.now() };
    if (resp.ok) setKnownRemoteHash(key, newHash);
  } catch(e) {
    _lastSyncStatus = { ok: false, ts: Date.now() };
    /* hors-ligne ou Worker injoignable : la copie locale suffit, on retentera à la prochaine écriture */
  }
}
async function syncPull(key) {
  const syncKey = getSyncKey();
  if (!syncKey) return undefined;
  try {
    const resp = await fetch(SYNC_WORKER_URL + '?key=' + encodeURIComponent(key), { headers: { 'Authorization': 'Bearer ' + syncKey } });
    if (!resp.ok) { _lastSyncStatus = { ok: false, ts: Date.now() }; return undefined; }
    _lastSyncStatus = { ok: true, ts: Date.now() };
    const data = await resp.json(); // peut être `null` (clé jamais synchronisée) : géré par l'appelant
    // v7.27.0 — on mémorise l'empreinte de ce qu'on vient de lire, pour que la
    // détection de conflit (voir syncPush) sache dès la prochaine écriture
    // locale si quelqu'un d'autre a modifié la donnée entre-temps.
    if (data !== null && data !== undefined) setKnownRemoteHash(key, await sha256Hex(JSON.stringify(data)));
    return data;
  } catch(e) { _lastSyncStatus = { ok: false, ts: Date.now() }; return undefined; }
}

async function persistData(key, payload) {
  if (idbStore) await idbStore.put('data', payload, key);
  else {
    if (payload === null) localStorage.removeItem('plume_' + key);
    else localStorage.setItem('plume_' + key, JSON.stringify(payload));
  }
  syncPush(key, payload);
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
    syncPull(key).then(remote => { if (remote !== undefined && remote !== null && idbStore) idbStore.put('data', remote, key); });
    return local;
  }
  // Rien en local : premier accès à cette clé depuis cet appareil (ex.
  // nouvel appareil découvrant un profil existant) — on attend le Worker.
  const remote = await syncPull(key);
  if (remote !== undefined && remote !== null) {
    if (idbStore) await idbStore.put('data', remote, key);
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
  'tab-map':'🏗️ Structure','tab-sprint':'⏱️ Sprint',
  'tab-univers':'🌍 Univers ▾','tab-ia-memoire':'🤖 IA & Mémoire ▾',
  'tab-analysegroup':'📊 Analyse ▾','tab-systeme':'🗄️ Système ▾',
  'tab-config':'⚙️ Config'
};
// Descriptifs affichés en infobulle sur chaque onglet (neophytes).
const tabDescriptions = {
  'tab-map':'Courbe de tension narrative du roman',
  'tab-sprint':'Chronomètre pour une session d\'écriture concentrée',
  'tab-univers':'Personnages, lieux, quêtes, chronologie et relations',
  'tab-ia-memoire':'Assistance IA et mémoire narrative du roman',
  'tab-analysegroup':'Statistiques, mots-clés et analyse détaillée du texte',
  'tab-systeme':'Versions et plugins',
  'tab-config':'Mots faibles, objectifs d\'écriture, profil'
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
  const payload = { ...db }; delete payload.cloudToken;
  const cipher = await Crypto.encrypt(JSON.stringify(payload), _dataKey);
  await persistData(docDataKey(_currentProfileId, _currentDocumentId), { _enc:true, data:cipher });
  await touchDocumentMeta();
  flashSave(); updateDailyStats();
  _unsavedChanges = false;
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
  // v7.10.0 : la vue Chapitres (Liste/Fiches) revient toujours sur Liste à
  // l'ouverture d'un manuscrit — ce n'est pas une préférence mémorisée.
  setChapterViewMode('list');
  renderTabs();renderChapterList();loadChapter(0);updateDailyStats();
  renderLibrary('chars');renderLibrary('places');renderQuests();renderWeakWords();initGoalUI();
  resumeSprintIfNeeded();
  purgeOldTrash();
  updateTrashBadge();
  renderAppearanceUI();

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
  // Mise en forme riche (nouveau V56)
  document.getElementById('fmt-bold-btn').addEventListener('click',()=>formatText('bold'));
  document.getElementById('fmt-italic-btn').addEventListener('click',()=>formatText('italic'));
  document.getElementById('fmt-underline-btn').addEventListener('click',()=>formatText('underline'));
  document.getElementById('undo-btn').addEventListener('click',undoEdit);
  document.getElementById('redo-btn').addEventListener('click',redoEdit);
  document.getElementById('fmt-title-btn').addEventListener('click',()=>formatParagraph('h3'));
  document.getElementById('fmt-para-btn').addEventListener('click',()=>formatParagraph('p'));
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

  document.getElementById('wc-gen-btn').addEventListener('click',renderWordCloud);
  document.getElementById('tl-add-btn').addEventListener('click',addTimelineEvent);

  document.getElementById('snapshot-btn').addEventListener('click',()=>{flushCurrentChapter();takeSnapshot(cur,'Manuel — '+new Date().toLocaleString('fr'));save();renderHistoryTab();toast('Snapshot sauvegardé','success');});
  document.getElementById('open-diff-btn').addEventListener('click',openDiffViewer);
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
  document.getElementById('manuscript-goal-input').addEventListener('input',e=>{db.wordGoal=parseInt(e.target.value)||0;debouncedSave();});
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

  document.getElementById('pwa-install-btn').addEventListener('click',installPWA);
  document.getElementById('pwa-dismiss-btn').addEventListener('click',()=>document.getElementById('pwa-banner').classList.remove('show'));
  document.getElementById('install-app-btn').addEventListener('click',installPWA);

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
    if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();flushCurrentChapter();save();}
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
    }
  });

  // v7.5.0 : confirmation avant de fermer/recharger l'onglet s'il reste des
  // modifications non encore persistées (frappe des 600 dernières ms).
  window.addEventListener('beforeunload', e => {
    if (_unsavedChanges) { e.preventDefault(); e.returnValue = ''; }
  });

  document.getElementById('memory-index-btn').addEventListener('click', indexNarrative);
  document.getElementById('memory-query-btn').addEventListener('click', queryNarrativeMemory);
  document.getElementById('memory-query-input').addEventListener('keydown', e => { if(e.key==='Enter') queryNarrativeMemory(); });

  // Menus déroulants de la toolbar + sous-navigation des onglets groupés (v7.4.0)
  initToolbarDropdowns();
  initSubtabNavs();
}

// Menus déroulants de la barre d'outils (¶ Paragraphe / 🛠️ Outils / 🔎 Rechercher).
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
  document.addEventListener('click',()=>{
    document.querySelectorAll('.toolbar-menu.open').forEach(m=>m.classList.remove('open'));
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
  if (document.visibilityState === 'hidden' && typeof syncAllLibraryManuscripts === 'function') {
    syncAllLibraryManuscripts('focus-loss');
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
  if (needsSyncKeySetup()) renderSyncKeyGate();
  else await bootProfiles();
};
