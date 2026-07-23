// ═══════════════════════════════════════════════════════
// ENVIRONNEMENT MINIMAL SIMULÉ — variables/fonctions normalement définies
// dans router.js (bootstrap complet de l'app, non chargé ici : il déclare
// `let db`/`cur` en conflit avec les stubs de test-runner.js, et son
// `window.onload` démarrerait tout seul le système de profils en parallèle
// des tests). Ce fichier ne reproduit QUE les utilitaires purs et les
// variables d'état dont les fichiers testés ci-dessous ont besoin pour
// s'exécuter sans erreur — voir le README (section "Couverture de tests")
// pour le détail de ce qui est et n'est pas couvert.
// Chargé AVANT les fichiers testés : panels.js appelle debounce() dès son
// chargement (`const debouncedSearch = debounce(...)`), donc debounce()
// doit déjà exister à ce moment précis.
'use strict';
function debounce(fn, delay) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), delay); }; }
function getTodayKey() { return new Date().toISOString().slice(0,10); }
function getPlainText(html) { return (html||'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/p>/gi,'\n').replace(/<[^>]*>/g,'').trim(); }
let _switching = false;
let tensionChart = null, dialogChart = null, sessionChart = null;
let sessionWordsStart = 0, sessionStartTime = Date.now();
let sprintInterval = null, sprintWordsStart = 0;
// debouncedSave référence `save`, défini plus tard dans test-runner.js : sans
// risque, car cette fonction n'est appelée qu'après le chargement complet de
// la page (save() sera alors bien initialisé).
const debouncedSave = () => { save(); };
// v7.22.0 — stub minimal : la vraie fonction vit dans router.js (non chargé
// ici). Renvoyer '' fait que syncPushEntireLibrary() (appelée depuis
// openProfile() dans profiles.js) ne fait rien ici, comme un appareil sans
// synchronisation configurée — cohérent avec le reste de cette suite.
function getSyncKey() { return ''; }
