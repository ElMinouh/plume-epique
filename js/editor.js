'use strict';
// ═══════════════════════════════════════════════════════
// ÉDITEUR — isolation stricte par chapitre
// ═══════════════════════════════════════════════════════
function flushCurrentChapter() {
  const w = document.getElementById('writer'), t = document.getElementById('chapter-title'), st = document.getElementById('chapter-status-sel');
  if (!w || !db.chapters[cur]) return;
  db.chapters[cur].content = w.innerHTML;
  if (t) db.chapters[cur].title = t.innerText.trim() || db.chapters[cur].title;
  if (st) db.chapters[cur].status = st.value;
}
function loadChapter(i) {
  const w = document.getElementById('writer'), t = document.getElementById('chapter-title'), s = document.getElementById('tension-slider'), st = document.getElementById('chapter-status-sel');
  const ch = db.chapters[i];
  if (!ch || !w) return;
  w.innerHTML = ch.content || '';
  if (t) t.innerText = ch.title || '';
  if (s) s.value = ch.tension ?? 20;
  if (st) st.value = ch.status || 'draft';
}
function liveCounter() {
  if (_switching) return;
  db.chapters[cur].content = document.getElementById('writer').innerHTML;
  updateDailyStats(); debouncedSave();
}
const CH_STATUS_META = {
  draft: { color:'#7f8c8d', label:'Brouillon' },
  review: { color:'#f39c12', label:'À revoir' },
  final: { color:'#27ae60', label:'Final' }
};
function renderChapterList() {
  const list = document.getElementById('chapter-list');
  list.innerHTML = db.chapters.map((ch,i) => {
    const sm = CH_STATUS_META[ch.status] || CH_STATUS_META.draft;
    return `<div class="chapter-item ${i===cur?'active':''}" data-idx="${i}" role="listitem" tabindex="0" aria-current="${i===cur}">
      <span class="ch-status-dot" style="background:${sm.color};" title="${sm.label}"></span>
      <span class="ch-num">${i+1}.</span>
      <span class="ch-title-text" style="flex-grow:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${DOMPurify.sanitize(ch.title||'')}</span>
      <span class="ch-wordcount" title="Nombre de mots">${getWordCount(ch.content)}</span>
      <span class="ch-actions" style="display:flex;gap:2px;flex-shrink:0;">
        <button class="ch-action-btn" data-rename="${i}" title="Renommer">✏️</button>
        <button class="ch-action-btn" data-move="up" data-idx="${i}" title="Monter" ${i===0?'disabled':''}>↑</button>
        <button class="ch-action-btn" data-move="down" data-idx="${i}" title="Descendre" ${i===db.chapters.length-1?'disabled':''}>↓</button>
        <button class="ch-action-btn" data-dup="${i}" title="Dupliquer">⧉</button>
        <button class="ch-action-btn ch-del-btn" data-del="${i}" title="Supprimer">✕</button>
      </span>
    </div>`;
  }).join('');
  list.querySelectorAll('.chapter-item').forEach(el => {
    el.addEventListener('click', (e) => { if(e.target.closest('.ch-actions')||e.target.closest('.ch-rename-input')) return; changeCh(parseInt(el.dataset.idx)); });
    el.addEventListener('keydown', e => { if((e.key==='Enter'||e.key===' ')&&!e.target.closest('.ch-actions')) changeCh(parseInt(el.dataset.idx)); });
  });
  list.querySelectorAll('[data-rename]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); renameChapterInline(parseInt(btn.dataset.rename)); });
  });
  list.querySelectorAll('[data-move]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); moveChapter(parseInt(btn.dataset.idx), btn.dataset.move); });
  });
  list.querySelectorAll('[data-dup]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); duplicateChapter(parseInt(btn.dataset.dup)); });
  });
  list.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); deleteChapter(parseInt(btn.dataset.del)); });
  });
}
function duplicateChapter(i) {
  _switching = true;
  flushCurrentChapter();
  const orig = db.chapters[i];
  const copy = { id: genChapterId(), title: (orig.title||'Chapitre') + ' (copie)', content: orig.content, tension: orig.tension, summary: orig.summary, status: 'draft' };
  db.chapters.splice(i+1, 0, copy);
  if (cur > i) cur++;
  renderChapterList(); loadChapter(cur);
  _switching = false; save();
  toast('Chapitre dupliqué', 'success');
}
function deleteChapter(i) {
  if (db.chapters.length <= 1) { toast('Impossible de supprimer le dernier chapitre.','error'); return; }
  const ch = db.chapters[i];
  if (!confirm(`Déplacer « ${ch.title||'ce chapitre'} » vers la corbeille ? Il restera récupérable 30 jours.`)) return;
  _switching = true;
  flushCurrentChapter();
  const history = (db.history && ch.id) ? db.history[ch.id] : null;
  if (!db.trash) db.trash = [];
  db.trash.push({
    chapter: JSON.parse(JSON.stringify(ch)),
    history: history ? JSON.parse(JSON.stringify(history)) : null,
    deletedAt: Date.now()
  });
  db.chapters.splice(i,1);
  if (db.history && ch.id) delete db.history[ch.id];
  if (cur >= db.chapters.length) cur = db.chapters.length - 1;
  else if (i < cur) cur--;
  renderChapterList(); loadChapter(cur); updateDailyStats();
  _switching = false; save();
  toast('Chapitre déplacé vers la corbeille','success');
}

// ═══════════════════════════════════════════════════════
// CORBEILLE — chapitres supprimés (nouveau v6.2.0)
// Purge automatique après 30 jours ; restauration manuelle sinon.
// ═══════════════════════════════════════════════════════
function purgeOldTrash() {
  const THIRTY_DAYS = 30*24*60*60*1000, now = Date.now();
  db.trash = (db.trash||[]).filter(t => (now - t.deletedAt) < THIRTY_DAYS);
}
function openTrash() {
  purgeOldTrash();
  renderTrashList();
  document.getElementById('trash-overlay').classList.add('active');
}
function closeTrash() { document.getElementById('trash-overlay').classList.remove('active'); }
function renderTrashList() {
  const listEl = document.getElementById('trash-list');
  if (!db.trash || !db.trash.length) {
    listEl.innerHTML = '<div style="opacity:.5;padding:16px;text-align:center;font-size:.82rem;">La corbeille est vide.</div>';
    return;
  }
  listEl.innerHTML = db.trash.map((t,i) => {
    const daysLeft = Math.max(0, 30 - Math.floor((Date.now()-t.deletedAt)/86400000));
    return `<div class="history-item" style="cursor:default;">
      <span>${DOMPurify.sanitize(t.chapter.title||'Sans titre')}<br><span style="opacity:.5;font-size:.68rem;">Supprimé le ${new Date(t.deletedAt).toLocaleDateString('fr')} — purge auto dans ${daysLeft}j</span></span>
      <span style="display:flex;gap:4px;flex-shrink:0;">
        <button class="action-btn btn-sm" data-restore="${i}">↩ Restaurer</button>
        <button class="action-btn btn-sm" style="background:var(--danger);" data-purge="${i}">✕ Définitif</button>
      </span>
    </div>`;
  }).join('');
  listEl.querySelectorAll('[data-restore]').forEach(btn => btn.addEventListener('click', () => restoreFromTrash(parseInt(btn.dataset.restore))));
  listEl.querySelectorAll('[data-purge]').forEach(btn => btn.addEventListener('click', () => permanentlyPurge(parseInt(btn.dataset.purge))));
}
function restoreFromTrash(i) {
  const item = db.trash[i];
  if (!item) return;
  db.chapters.push(item.chapter);
  if (item.history) { if (!db.history) db.history = {}; db.history[item.chapter.id] = item.history; }
  db.trash.splice(i,1);
  renderChapterList(); renderTrashList(); save();
  toast('Chapitre restauré','success');
}
function permanentlyPurge(i) {
  if (!confirm('Supprimer définitivement ce chapitre ? Cette action est irréversible.')) return;
  db.trash.splice(i,1);
  renderTrashList(); save();
}
function moveChapter(i, dir) {
  const j = dir==='up' ? i-1 : i+1;
  if (j<0 || j>=db.chapters.length) return;
  _switching = true;
  flushCurrentChapter();
  const activeId = db.chapters[cur].id;
  [db.chapters[i], db.chapters[j]] = [db.chapters[j], db.chapters[i]];
  cur = db.chapters.findIndex(c => c.id === activeId);
  renderChapterList(); loadChapter(cur);
  _switching = false; save();
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
  db.chapters.push({ id: genChapterId(), title:`Chapitre ${db.chapters.length+1}`, content:'', tension:20, summary:'', status:'draft' });
  cur = db.chapters.length - 1;
  renderChapterList(); loadChapter(cur); updateDailyStats();
  _switching = false; save();
}
function updateTitle(t) {
  db.chapters[cur].title = t; debouncedSave();
  const titleEl = document.querySelectorAll('#chapter-list .ch-title-text')[cur];
  if (titleEl) titleEl.textContent = t;
}

// Renommage d'un chapitre directement depuis le panneau de gauche, sans
// avoir à ouvrir ce chapitre dans l'éditeur principal.
function renameChapterInline(i) {
  const item = document.querySelector(`#chapter-list .chapter-item[data-idx="${i}"]`);
  const span = item && item.querySelector('.ch-title-text');
  if (!span) return;
  const current = db.chapters[i].title || '';
  const input = document.createElement('input');
  input.className = 'ch-rename-input';
  input.value = current;
  input.setAttribute('aria-label', 'Renommer le chapitre');
  span.replaceWith(input);
  input.focus(); input.select();
  const commit = () => {
    const val = input.value.trim() || current;
    db.chapters[i].title = val;
    if (i === cur) { const t = document.getElementById('chapter-title'); if (t) t.innerText = val; }
    debouncedSave();
    renderChapterList();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); input.value = current; input.blur(); }
  });
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
  // Correction v6.0.0 : confirmation demandée avant de supprimer les surlignages.
  if (!confirm('Supprimer tous les surlignages de style (mots faibles) ? Le texte lui-même ne sera pas modifié.')) return;
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

// ═══════════════════════════════════════════════════════
// MODE LECTURE LINÉAIRE (nouveau v6.2.0)
// Concatène tous les chapitres à la suite, en lecture seule, pour relire
// le roman comme un lecteur plutôt que de naviguer chapitre par chapitre.
// ═══════════════════════════════════════════════════════
function enterReadingMode() {
  flushCurrentChapter();
  const container = document.getElementById('reading-content');
  container.innerHTML = db.chapters.map((ch,i) =>
    `<div class="reading-chapter"><h2>${DOMPurify.sanitize(ch.title||('Chapitre '+(i+1)))}</h2>${DOMPurify.sanitize(ch.content||'<p><em>(chapitre vide)</em></p>')}</div>`
  ).join('<hr class="reading-divider">');
  document.getElementById('reading-overlay').classList.add('active');
  container.scrollTop = 0;
}
function exitReadingMode() {
  document.getElementById('reading-overlay').classList.remove('active');
}
