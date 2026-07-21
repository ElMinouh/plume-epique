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

const tabLabels = {
  'tab-map':'🏗️ Structure','tab-sprint':'⏱️ Sprint',
  'tab-config':'⚙️ Config','tab-quests':'🎯 Quêtes','tab-chars':'👥 Personnages',
  'tab-places':'🏰 Lieux','tab-snaps':'📦 Backup','tab-wordcloud':'☁️ Mots',
  'tab-timeline':'🕐 Chronologie','tab-stats':'📊 Stats','tab-ai':'🤖 IA',
  'tab-history':'🔖 Versions','tab-graph':'🕸️ Relations',
  'tab-analytics':'📈 Analyse','tab-plugins':'🔌 Plugins','tab-memory':'🧠 Mémoire'
};

// ═══════════════════════════════════════════════════════
// UTILITAIRES
// ═══════════════════════════════════════════════════════
function debounce(fn, delay) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), delay); }; }
function getTodayKey() { return new Date().toISOString().slice(0,10); }
function getWordCount(t) { const m=(t||'').replace(/<[^>]*>/g,' ').match(/[a-zA-Z0-9À-ÿ]+/g); return m?m.length:0; }
function getPlainText(html) { return (html||'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/p>/gi,'\n').replace(/<[^>]*>/g,'').trim(); }

// ═══════════════════════════════════════════════════════
// PERSISTANCE
// ═══════════════════════════════════════════════════════
// v7.0.0 : les données du profil courant sont toujours chiffrées par sa clé
// de données (DEK), et stockées sous 'data_<id>'.
const save = async () => {
  if (!_currentProfileId || !_dataKey) return;
  const payload = { ...db }; delete payload.cloudToken;
  const cipher = await Crypto.encrypt(JSON.stringify(payload), _dataKey);
  await persistData('data_' + _currentProfileId, { _enc:true, data:cipher });
  flashSave(); updateDailyStats();
};
const debouncedSave = debounce(save, 600);

// ═══════════════════════════════════════════════════════
// INIT APP — câblage de tous les événements
// ═══════════════════════════════════════════════════════
function initApp(){
  if(db.darkMode)document.body.classList.add('dark-mode');
  sessionWordsStart=db.chapters.reduce((s,c)=>s+getWordCount(c.content),0);
  sessionStartTime=Date.now();
  renderTabs();renderChapterList();loadChapter(0);updateDailyStats();
  renderLibrary('chars');renderLibrary('places');renderQuests();renderWeakWords();initGoalUI();
  resumeSprintIfNeeded();
  purgeOldTrash();

  const ctx=document.getElementById('tensionChart').getContext('2d');
  if (tensionChart) { tensionChart.destroy(); tensionChart = null; }
  tensionChart=new Chart(ctx,{type:'line',data:{labels:db.chapters.map((_,i)=>i+1),datasets:[{label:'Tension',data:db.chapters.map(c=>c.tension),borderColor:'#c0392b',backgroundColor:'rgba(192,57,43,.08)',tension:.3,fill:true}]},options:{maintainAspectRatio:false,plugins:{legend:{display:false}}}});

  const gi=document.getElementById('gist-id');if(gi&&db.gistId)gi.value=db.gistId;

  document.getElementById('add-chapter-btn').addEventListener('click',addChapter);
  // Mise en forme riche (nouveau V56)
  document.getElementById('fmt-bold-btn').addEventListener('click',()=>formatText('bold'));
  document.getElementById('fmt-italic-btn').addEventListener('click',()=>formatText('italic'));
  document.getElementById('fmt-underline-btn').addEventListener('click',()=>formatText('underline'));
  document.getElementById('fmt-title-btn').addEventListener('click',()=>formatParagraph('h3'));
  document.getElementById('fmt-para-btn').addEventListener('click',()=>formatParagraph('p'));
  document.getElementById('analyze-btn').addEventListener('click',analyzeStyle);
  document.getElementById('clear-btn').addEventListener('click',clearStyle);
  document.getElementById('search-btn').addEventListener('click', handleSearch);
  document.getElementById('lex-panel-close').addEventListener('click', () => document.getElementById('lex-panel').classList.remove('active'));
  document.getElementById('writer').addEventListener('mouseup', saveCursorPosition);
  document.getElementById('writer').addEventListener('keyup', saveCursorPosition);
  document.getElementById('toggle-dark-btn').addEventListener('click',toggleMode);
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

  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key==='f'){e.preventDefault();openGlobalSearch();}
    if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();flushCurrentChapter();save();}
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
    }
  });

  if(db.chapters.some(c=>c.content)) { takeSnapshot(cur, 'Ouverture — '+new Date().toLocaleString('fr')); }

  document.getElementById('memory-index-btn').addEventListener('click', indexNarrative);
  document.getElementById('memory-query-btn').addEventListener('click', queryNarrativeMemory);
  document.getElementById('memory-query-input').addEventListener('keydown', e => { if(e.key==='Enter') queryNarrativeMemory(); });
}

// ═══════════════════════════════════════════════════════
// BOOTSTRAP — v7.0.0 : passe par le système de profils (voir profiles.js)
// ═══════════════════════════════════════════════════════
window.onload = async () => {
  await initIDB();
  await bootProfiles();
};
