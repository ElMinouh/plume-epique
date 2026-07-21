'use strict';
// ═══════════════════════════════════════════════════════
// SCHÉMA & VERSIONING
// Fichier isolé, sans dépendance au DOM, extrait de router.js en v6.1.0
// pour pouvoir être testé indépendamment de l'application
// (voir tests/test-runner.html).
// ═══════════════════════════════════════════════════════
const SCHEMA_VERSION = 8;

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
  if (v < 7) {
    // Titre du manuscrit (bibliothèque multi-manuscrits, nouveau v7.2.0)
    if (typeof data.title !== 'string') data.title = '';
  }
  if (v < 8) {
    // Regroupement des 16 anciens onglets en 7 catégories (v7.4.0) — l'ordre
    // à plat n'a plus de sens, on le remplace par le nouvel ordre par défaut.
    // Aucune donnée n'est perdue : seul l'ordre d'affichage des onglets est
    // réinitialisé (un éventuel réordonnancement manuel des onglets ne sera
    // pas conservé).
    data.tabOrder = ['tab-map','tab-sprint','tab-univers','tab-ia-memoire','tab-analysegroup','tab-systeme','tab-config'];
  }
  data._schemaVersion = SCHEMA_VERSION;
  return data;
}

const DEFAULT_DB = () => ({
  _schemaVersion: SCHEMA_VERSION,
  title: '',
  chapters: [{ id: genChapterId(), title:'Chapitre 1', content:'', tension:20, summary:'', status:'draft' }],
  chars:[], places:[], quests:[], timeline:[], history:{}, plugins:{},
  weakWords:['juste','très'],
  tabOrder:['tab-map','tab-sprint','tab-univers','tab-ia-memoire','tab-analysegroup','tab-systeme','tab-config'],
  darkMode:false, gistId:'', dailyGoal:500, weeklyGoal:3000, monthlyGoal:12000, sessionStats:{}, sprint:null, trash:[]
});
