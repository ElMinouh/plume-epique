'use strict';
// ═══════════════════════════════════════════════════════
// SCHÉMA & VERSIONING
// Fichier isolé, sans dépendance au DOM, extrait de router.js en v6.1.0
// pour pouvoir être testé indépendamment de l'application
// (voir tests/test-runner.html).
// ═══════════════════════════════════════════════════════
const SCHEMA_VERSION = 6;

function genChapterId() {
  return (crypto.randomUUID ? crypto.randomUUID() : 'ch_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8));
}

function migrateDb(data) {
  const v = data._schemaVersion || 1;
  if (v < 2) {
    if (!data.timeline) data.timeline = [];
    if (!data.tabOrder) data.tabOrder = [];
    if (!data.weakWords) data.weakWords = ['juste','très'];
  }
  if (v < 3) {
    if (!data.history) data.history = {};
    if (!data.plugins) data.plugins = {};
    if (!data.sessionStats) data.sessionStats = {};
  }
  if (v < 4) {
    // Attribution d'un identifiant stable à chaque chapitre + migration de l'historique
    // (auparavant indexé par position, ce qui cassait tout en cas de suppression/réorganisation)
    const oldHistory = data.history || {};
    const newHistory = {};
    (data.chapters||[]).forEach((ch, idx) => {
      if (!ch.id) ch.id = genChapterId();
      if (oldHistory[String(idx)]) newHistory[ch.id] = oldHistory[String(idx)];
    });
    data.history = newHistory;
  }
  if (v < 5) {
    // Ajout du statut par chapitre (brouillon / à revoir / final)
    (data.chapters||[]).forEach(ch => { if (!ch.status) ch.status = 'draft'; });
  }
  if (v < 6) {
    // Corbeille des chapitres supprimés + objectifs hebdomadaire/mensuel
    if (!data.trash) data.trash = [];
    if (typeof data.weeklyGoal !== 'number') data.weeklyGoal = 3000;
    if (typeof data.monthlyGoal !== 'number') data.monthlyGoal = 12000;
  }
  data._schemaVersion = SCHEMA_VERSION;
  return data;
}

const DEFAULT_DB = () => ({
  _schemaVersion: SCHEMA_VERSION,
  chapters: [{ id: genChapterId(), title:'Chapitre 1', content:'', tension:20, summary:'', status:'draft' }],
  chars:[], places:[], quests:[], timeline:[], history:{}, plugins:{},
  weakWords:['juste','très'],
  tabOrder:['tab-map','tab-sprint','tab-config','tab-quests','tab-chars','tab-places','tab-snaps','tab-wordcloud','tab-timeline','tab-stats','tab-ai','tab-history','tab-graph','tab-analytics','tab-plugins','tab-memory'],
  darkMode:false, gistId:'', dailyGoal:500, weeklyGoal:3000, monthlyGoal:12000, sessionStats:{}, sprint:null, trash:[]
});
