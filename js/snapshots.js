'use strict';
function openDiffViewer() {
  flushCurrentChapter();
  const key = db.chapters[cur]?.id, snaps = (key && db.history[key]) || [];
  document.getElementById('history-chapter-name').textContent = db.chapters[cur].title;
  const list = document.getElementById('history-list');
  list.innerHTML = snaps.length ? '' : '<div class="u-op-_5 u-fs-_8rem">Aucun snapshot.</div>';
  snaps.forEach((snap, i) => {
    const el = document.createElement('div');
    el.className = 'history-item';
    el.innerHTML = `<span>${DOMPurify.sanitize(snap.label)}</span><span class="u-op-_5 u-fs-_7rem">${getWordCount(snap.content)} mots</span>`;
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
