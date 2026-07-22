'use strict';
// SCHÉMA & VERSIONING : voir schema.js (extrait en v6.1.0 pour être testable
// indépendamment de l'app — tests/test-runner.html)

// ═══════════════════════════════════════════════════════
// INDEXEDDB
// ═══════════════════════════════════════════════════════
let idbStore = null;
async function initIDB() {
  try { idbStore = await idb.openDB('plume_v55', 1, { upgrade(db) { db.createObjectStore('data'); } }); }
  catch(e) { console.warn('IDB unavailable'); }
}
// v7.0.0 : persistData/loadData prennent désormais une clé de stockage
// explicite ('profiles' pour l'index, 'data_<id>' pour chaque profil,
// 'main' pour les anciennes données mono-profil à migrer).
async function persistData(key, payload) {
  if (idbStore) await idbStore.put('data', payload, key);
  else {
    if (payload === null) localStorage.removeItem('plume_' + key);
    else localStorage.setItem('plume_' + key, JSON.stringify(payload));
  }
}
async function loadData(key) {
  if (idbStore) return idbStore.get('data', key);
  let r = localStorage.getItem('plume_' + key);
  // Compat : en mode localStorage, l'ancien format mono-profil était stocké
  // sous 'plume_v55'. On le retrouve quand on cherche les données 'main'.
  if (!r && key === 'main') r = localStorage.getItem('plume_v55');
  return r ? JSON.parse(r) : null;
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
  'tab-analysegroup':'📊 Analyse ▾','tab-systeme':'💾 Système ▾',
  'tab-config':'⚙️ Config'
};
// Descriptifs affichés en infobulle sur chaque onglet (neophytes).
const tabDescriptions = {
  'tab-map':'Courbe de tension narrative du roman',
  'tab-sprint':'Chronomètre pour une session d\'écriture concentrée',
  'tab-univers':'Personnages, lieux, quêtes, chronologie et relations',
  'tab-ia-memoire':'Assistance IA et mémoire narrative du roman',
  'tab-analysegroup':'Statistiques, mots-clés et analyse détaillée du texte',
  'tab-systeme':'Sauvegarde, export, versions et plugins',
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

  const gi=document.getElementById('gist-id');if(gi)gi.value=db.gistId||'';
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
  document.getElementById('export-btn').addEventListener('click',megaExport);
  document.getElementById('export-docx-btn').addEventListener('click',openExportSelect);
  document.getElementById('export-epub-btn').addEventListener('click',openExportSelect);
  document.getElementById('export-select-close-btn').addEventListener('click',closeExportSelect);
  document.getElementById('export-select-toggle-btn').addEventListener('click',toggleAllExportSelect);
  document.getElementById('export-select-docx-btn').addEventListener('click',()=>{exportDocx(getSelectedExportIndices());closeExportSelect();});
  document.getElementById('export-select-epub-btn').addEventListener('click',()=>{exportEpub(getSelectedExportIndices());closeExportSelect();});
  document.getElementById('import-trigger-btn').addEventListener('click',()=>document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change',e=>importProject(e.target));
  document.getElementById('sync-cloud-btn').addEventListener('click',syncCloud);
  document.getElementById('load-cloud-btn').addEventListener('click',loadCloud);
  document.getElementById('gist-history-btn').addEventListener('click',openGistHistory);
  document.getElementById('gist-history-close-btn').addEventListener('click',closeGistHistory);
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

  document.getElementById('gh-token').addEventListener('input',e=>{_cloudToken=e.target.value;});
  document.getElementById('gist-id').addEventListener('input',e=>{db.gistId=e.target.value;debouncedSave();});
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
// BOOTSTRAP — v7.0.0 : passe par le système de profils (voir profiles.js)
// ═══════════════════════════════════════════════════════
window.onload = async () => {
  await initIDB();
  await bootProfiles();
};
