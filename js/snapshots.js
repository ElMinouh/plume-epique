'use strict';
const MAX_SNAPSHOTS = 30;
function takeSnapshot(chIdx, label) {
  if (!db.history) db.history = {};
  const ch = db.chapters[chIdx];
  if (!ch || !ch.id) return;
  const key = ch.id;
  if (!db.history[key]) db.history[key] = [];
  const last = db.history[key][0];
  if (last && last.content === ch.content) return;
  db.history[key].unshift({
    ts: Date.now(),
    label: label || new Date().toLocaleString('fr'),
    content: ch.content,
    title: ch.title
  });
  if (db.history[key].length > MAX_SNAPSHOTS) db.history[key] = db.history[key].slice(0, MAX_SNAPSHOTS);
}
setInterval(() => {
  if (db.chapters[cur]) { flushCurrentChapter(); takeSnapshot(cur); debouncedSave(); }
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
  db.chapters[cur].content = snap.content;
  db.chapters[cur].title = snap.title;
  loadChapter(cur);
  checkpointNow();
  save();
  document.getElementById('history-overlay').classList.remove('active');
  toast('Version restaurée', 'success');
}
