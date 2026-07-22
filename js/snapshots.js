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

function renderHistoryTab() {
  const key = db.chapters[cur]?.id, snaps = (key && db.history[key]) || [];
  const list = document.getElementById('snapshot-list');
  list.innerHTML = snaps.length ? '' : '<div style="opacity:.5;font-size:.8rem;padding:10px;">Aucun snapshot pour ce chapitre.</div>';
  snaps.forEach((snap, i) => {
    const el = document.createElement('div');
    el.className = 'history-item';
    el.innerHTML = `<span>${DOMPurify.sanitize(snap.label)}</span><span style="opacity:.5;font-size:.7rem;">${getWordCount(snap.content)} mots</span>`;
    el.addEventListener('click', () => showHistoryPreview(key, i, el));
    list.appendChild(el);
  });
}

let _selectedSnapIdx = -1;
function showHistoryPreview(key, idx, el) {
  _selectedSnapIdx = idx;
  document.querySelectorAll('.history-item').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  const snap = db.history[key][idx];
  const restoreBtn = document.getElementById('history-restore-btn');
  if (restoreBtn) restoreBtn.disabled = false;
  const diffEl = document.getElementById('history-diff');
  if (diffEl) diffEl.textContent = getPlainText(snap.content).substring(0, 1200) + (snap.content.length > 1200 ? '…' : '');
}

function openDiffViewer() {
  flushCurrentChapter();
  const key = db.chapters[cur]?.id, snaps = (key && db.history[key]) || [];
  document.getElementById('history-chapter-name').textContent = db.chapters[cur].title;
  const list = document.getElementById('history-list');
  list.innerHTML = snaps.length ? '' : '<div style="opacity:.5;font-size:.8rem;">Aucun snapshot.</div>';
  snaps.forEach((snap, i) => {
    const el = document.createElement('div');
    el.className = 'history-item';
    el.innerHTML = `<span>${DOMPurify.sanitize(snap.label)}</span><span style="opacity:.5;font-size:.7rem;">${getWordCount(snap.content)} mots</span>`;
    el.addEventListener('click', () => {
      document.querySelectorAll('#history-list .history-item').forEach(e=>e.classList.remove('selected'));
      el.classList.add('selected');
      const current = getPlainText(db.chapters[cur].content);
      const old = getPlainText(snap.content);
      document.getElementById('history-diff').innerHTML = computeDiff(old, current);
      document.getElementById('history-restore-btn').disabled = false;
      document.getElementById('history-restore-btn').onclick = () => restoreSnapshot(key, i);
    });
    list.appendChild(el);
  });
  document.getElementById('history-overlay').classList.add('active');
}

function restoreSnapshot(key, idx) {
  if (!confirm('Restaurer cette version ? Le contenu actuel sera remplacé.')) return;
  const snap = db.history[key][idx];
  db.chapters[cur].content = snap.content;
  db.chapters[cur].title = snap.title;
  loadChapter(cur); save();
  document.getElementById('history-overlay').classList.remove('active');
  toast('Version restaurée', 'success');
}
