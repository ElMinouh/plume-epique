'use strict';
// ═══════════════════════════════════════════════════════
// ÉDITEUR — isolation stricte par chapitre
// ═══════════════════════════════════════════════════════
function flushCurrentChapter() {
  const w = document.getElementById('writer'), t = document.getElementById('chapter-title');
  if (!w || !db.chapters[cur]) return;
  db.chapters[cur].content = w.innerHTML;
  if (t) db.chapters[cur].title = t.innerText.trim() || db.chapters[cur].title;
}
function loadChapter(i) {
  const w = document.getElementById('writer'), t = document.getElementById('chapter-title'), s = document.getElementById('tension-slider');
  const ch = db.chapters[i];
  if (!ch || !w) return;
  w.innerHTML = ch.content || '';
  if (t) t.innerText = ch.title || '';
  if (s) s.value = ch.tension ?? 20;
}
function liveCounter() {
  if (_switching) return;
  db.chapters[cur].content = document.getElementById('writer').innerHTML;
  updateDailyStats(); debouncedSave();
}
function renderChapterList() {
  const list = document.getElementById('chapter-list');
  list.innerHTML = db.chapters.map((ch,i) =>
    `<div class="chapter-item ${i===cur?'active':''}" data-idx="${i}" role="listitem" tabindex="0" aria-current="${i===cur}">
      <span class="ch-num">${i+1}.</span> ${DOMPurify.sanitize(ch.title||'')}
    </div>`
  ).join('');
  list.querySelectorAll('.chapter-item').forEach(el => {
    el.addEventListener('click', () => changeCh(parseInt(el.dataset.idx)));
    el.addEventListener('keydown', e => { if(e.key==='Enter'||e.key===' ') changeCh(parseInt(el.dataset.idx)); });
  });
}
function renderChapters() {
  _switching = true;
  flushCurrentChapter(); renderChapterList(); loadChapter(cur); updateDailyStats();
  _switching = false;
}
function changeCh(i) {
  if (i === cur) return;
  _switching = true;
  flushCurrentChapter(); cur = i; renderChapterList(); loadChapter(cur); updateDailyStats();
  _switching = false;
}
function addChapter() {
  _switching = true;
  flushCurrentChapter();
  db.chapters.push({ title:`Chapitre ${db.chapters.length+1}`, content:'', tension:20, summary:'' });
  cur = db.chapters.length - 1;
  renderChapterList(); loadChapter(cur); updateDailyStats();
  _switching = false; save();
}
function updateTitle(t) {
  db.chapters[cur].title = t; debouncedSave();
  const items = document.querySelectorAll('#chapter-list .chapter-item');
  if (items[cur]) items[cur].innerHTML = `<span class="ch-num">${cur+1}.</span> ${DOMPurify.sanitize(t)}`;
}
function updateTension(v) { db.chapters[cur].tension = parseInt(v); debouncedSave(); if (tensionChart) updateChart(); }

// ═══════════════════════════════════════════════════════
// MISE EN FORME RICHE — CORRECTION V56
// (nouveaux boutons Gras / Italique / Souligné / Titre dans la toolbar)
// ═══════════════════════════════════════════════════════
function formatText(cmd) {
  document.getElementById('writer').focus();
  document.execCommand(cmd, false, null);
  liveCounter();
}
function formatParagraph(tag) {
  document.getElementById('writer').focus();
  document.execCommand('formatBlock', false, tag);
  liveCounter();
}

// ═══════════════════════════════════════════════════════
// STYLE ANALYSIS (mots faibles surlignés)
// ═══════════════════════════════════════════════════════
function analyzeStyle() {
  const writer = document.getElementById('writer');
  let txt = writer.innerHTML;
  db.weakWords.forEach(w => { txt = txt.replace(new RegExp(`\\b(${w})\\b`,'gi'),'<mark>$1</mark>'); });
  writer.innerHTML = DOMPurify.sanitize(txt);
}
function clearStyle() {
  const writer = document.getElementById('writer');
  writer.innerHTML = DOMPurify.sanitize(writer.innerHTML.replace(/<mark[^>]*>|<\/mark>/g,''));
  liveCounter();
}

// ═══════════════════════════════════════════════════════
// MODE FOCUS — CORRECTION V56
// L'ancienne version convertissait le texte en texte brut puis le
// reconstruisait en <p>, ce qui effaçait tout le gras/italique/souligné.
// #focus-writer est maintenant une zone contenteditable (comme #writer),
// donc le contenu HTML est préservé intégralement.
// ═══════════════════════════════════════════════════════
function enterFocus() {
  flushCurrentChapter();
  const fw = document.getElementById('focus-writer');
  document.getElementById('focus-title').value = db.chapters[cur].title || '';
  fw.innerHTML = db.chapters[cur].content || '';
  document.getElementById('focus-chapter-label').innerText = `Chapitre ${cur+1}`;
  document.getElementById('focus-overlay').classList.add('active');
  fw.focus(); updateFocusCount();
}
function exitFocus() {
  _switching = true;
  const fw = document.getElementById('focus-writer'), ft = document.getElementById('focus-title');
  db.chapters[cur].content = DOMPurify.sanitize(fw.innerHTML);
  db.chapters[cur].title = ft.value.trim() || db.chapters[cur].title;
  loadChapter(cur); renderChapterList();
  document.getElementById('focus-overlay').classList.remove('active');
  _switching = false; save();
}
function updateFocusCount() {
  const fw = document.getElementById('focus-writer');
  if (fw) document.getElementById('focus-wordcount').innerText = getWordCount(fw.innerHTML);
}
