'use strict';
const MAX_SNAPSHOTS = HISTORY_MAX_AUTO; // v9.25.0 : 20 copies automatiques, mais espacées sur un mois (voir thinSnapshots, schema.js)
function takeSnapshot(chIdx, label) {
  if (!db.history) db.history = {};
  const ch = db.chapters[chIdx];
  if (!ch || !ch.id) return false;
  const key = ch.id;
  if (!db.history[key]) db.history[key] = [];
  const last = db.history[key][0];
  if (last && last.content === ch.content) return false;
  db.history[key].unshift({
    ts: Date.now(),
    label: label || new Date().toLocaleString('fr'),
    content: ch.content,
    title: ch.title
  });
  db.history[key] = thinSnapshots(db.history[key], Date.now(), MAX_SNAPSHOTS);
  return true;
}
// v9.33.0 (AUD-02-008) — instantané du chapitre courant seulement si son texte a changé depuis son
// chargement (ou son dernier instantané de ce type) : consulter un chapitre n'en crée aucun, donc
// aucun gonflement du manuscrit. Appelée en quittant un chapitre et à la fermeture de la page.
function snapshotIfChangedSinceLoad(label) {
  const ch = db.chapters && db.chapters[cur];
  if (!ch || typeof _chapterBaseline !== 'string' || ch.content === _chapterBaseline) return false;
  const made = takeSnapshot(cur, label);
  _chapterBaseline = ch.content;
  return made;
}
// v9.25.0 — amincit en une fois tout l'historique d'un manuscrit (chapitres
// ET pages de roman graphique) : appelée à l'ouverture, pour que les anciens
// manuscrits alourdis par 30 copies serrées retrouvent un poids raisonnable
// sans attendre la prochaine modification de chaque chapitre. Renvoie true si
// quelque chose a été retiré (l'appelant déclenche alors une sauvegarde).
function thinAllHistory() {
  if (!db || !db.history || typeof db.history !== 'object') return false;
  let changed = false;
  const now = Date.now();
  for (const k of Object.keys(db.history)) {
    const before = db.history[k];
    if (!Array.isArray(before)) continue;
    const after = thinSnapshots(before, now, MAX_SNAPSHOTS);
    if (after.length !== before.length) { db.history[k] = after; changed = true; }
  }
  return changed;
}
// v9.21.0 (audit AUD-01-005) — ce minuteur sauvegardait le manuscrit toutes les
// 5 minutes MÊME SANS CHANGEMENT (donc une écriture en ligne gaspillée, quota
// KV gratuit de 1000/jour), et même quand la bibliothèque était affichée :
// il réécrivait alors le manuscrit encore en mémoire, ce qui pouvait écraser
// une restauration (Gist, conflit) faite depuis la bibliothèque. Il n'agit
// désormais que dans l'éditeur, et que s'il y a quelque chose à enregistrer.
setInterval(() => {
  if (document.body.classList.contains('library-mode')) return;
  if (db.chapters && db.chapters[cur]) {
    flushCurrentChapter();
    const created = takeSnapshot(cur);
    if (created || (typeof _unsavedChanges !== 'undefined' && _unsavedChanges)) debouncedSave();
  }
}, 5 * 60 * 1000);

// Construit le contenu (hors câblage des clics) d'une ligne de la liste des
// snapshots — factorisé (audit v7.35.0) : c'était auparavant dupliqué à
// l'identique entre renderHistoryTab() et openDiffViewer().
function snapshotRowHtml(snap) {
  return `<span>${DOMPurify.sanitize(snap.label)}</span><span class="u-op-_5 u-fs-_7rem">${getWordCount(snap.content)} mots</span>`;
}

// Correction (audit v7.35.0) : cet onglet ("🔖 Versions") affichait une liste
// cliquable dont le clic n'avait AUCUN effet visible — showHistoryPreview()
// écrivait dans #history-diff / activait #history-restore-btn, deux éléments
// qui n'existent que dans la fenêtre de comparaison séparée (#history-overlay,
// normalement masquée). Plutôt que dupliquer un second aperçu ici, un clic
// ouvre directement cette fenêtre de comparaison existante, avec le snapshot
// cliqué déjà sélectionné.
function renderHistoryTab() {
  const key = db.chapters[cur]?.id, snaps = (key && db.history[key]) || [];
  const list = document.getElementById('snapshot-list');
  list.innerHTML = snaps.length ? '' : '<div class="u-op-_5 u-fs-_8rem u-p-10px">Aucun snapshot pour ce chapitre.</div>';
  snaps.forEach((snap, i) => {
    const el = document.createElement('div');
    el.className = 'history-item';
    el.title = 'Ouvrir la comparaison et la restauration de cette version';
    el.innerHTML = snapshotRowHtml(snap);
    el.addEventListener('click', () => openDiffViewer(i));
    list.appendChild(el);
  });
}

function openDiffViewer(preselectIdx) {
  // wireAppEventListenersOnce (router.js) appelle openDiffViewer directement
  // comme gestionnaire de clic : l'événement de clic serait alors reçu ici
  // en premier argument. On ignore tout ce qui n'est pas un index numérique.
  if (typeof preselectIdx !== 'number') preselectIdx = undefined;
  flushCurrentChapter();
  const key = db.chapters[cur]?.id, snaps = (key && db.history[key]) || [];
  document.getElementById('history-chapter-name').textContent = db.chapters[cur].title;
  const list = document.getElementById('history-list');
  list.innerHTML = snaps.length ? '' : '<div class="u-op-_5 u-fs-_8rem">Aucun snapshot.</div>';
  const rows = [];
  snaps.forEach((snap, i) => {
    const el = document.createElement('div');
    el.className = 'history-item';
    el.innerHTML = snapshotRowHtml(snap);
    el.addEventListener('click', () => selectDiffSnapshot(key, i, el, rows));
    list.appendChild(el);
    rows.push(el);
  });
  document.getElementById('history-overlay').classList.add('active');
  if (preselectIdx !== undefined && rows[preselectIdx]) rows[preselectIdx].click();
}

function selectDiffSnapshot(key, idx, el, rows) {
  rows.forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  const snap = db.history[key][idx];
  const current = getPlainText(db.chapters[cur].content);
  const old = getPlainText(snap.content);
  document.getElementById('history-diff').innerHTML = computeDiff(old, current);
  document.getElementById('history-restore-btn').disabled = false;
  document.getElementById('history-restore-btn').onclick = () => restoreSnapshot(key, idx);
}

function restoreSnapshot(key, idx) {
  if (!confirm('Restaurer cette version ? Le contenu actuel sera remplacé.')) return;
  const snap = db.history[key][idx];
  // v7.24.0 — checkpointNow() avant ET après (même schéma que formatText()) :
  // l'état d'avant-restauration ET la version restaurée deviennent chacun un
  // point d'annulation distinct, pour pouvoir faire Ctrl+Z si la restauration
  // ne convenait pas finalement — auparavant, seule une réouverture manuelle
  // de l'historique permettait de revenir en arrière.
  checkpointNow();
  // v9.33.0 (AUD-02-009) — l'état qui va être écrasé est gardé comme copie MANUELLE (jamais
  // purgée automatiquement) : la pile d'annulation ne survit pas à un rechargement de page.
  flushCurrentChapter();
  takeSnapshot(cur, 'Manuel — Avant restauration — ' + new Date().toLocaleString('fr'));
  db.chapters[cur].content = snap.content;
  db.chapters[cur].title = snap.title;
  loadChapter(cur);
  checkpointNow();
  save();
  document.getElementById('history-overlay').classList.remove('active');
  toast('Version restaurée', 'success');
}
