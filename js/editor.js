'use strict';
// ═══════════════════════════════════════════════════════
// ANNULER / RÉTABLIR — nouveau v7.6.0
// Une pile de versions du texte par chapitre (indexée par l'id stable du
// chapitre, pas sa position — cohérent avec ADR-4). Les frappes de clavier
// sont regroupées par rafale (800ms de pause = 1 étape), les actions de
// mise en forme (Gras/Italique/…) et le mode Focus créent chacune leur
// propre étape immédiate.
// ═══════════════════════════════════════════════════════
const UNDO_LIMIT = 100;
let _undoStacks = {};
let _pendingUndoFlush = false;
let _undoPushTimer = null;

function getUndoStack(chId) {
  if (!_undoStacks[chId]) _undoStacks[chId] = { stack: [''], index: 0 };
  return _undoStacks[chId];
}
function ensureUndoStack(ch) {
  if (ch && !_undoStacks[ch.id]) _undoStacks[ch.id] = { stack: [ch.content || ''], index: 0 };
}
// Une frappe vient d'avoir lieu : programme une étape dans 800ms si rien
// d'autre n'est tapé entre-temps (regroupe une rafale de frappe en 1 étape).
function scheduleUndoSnapshot() {
  _pendingUndoFlush = true;
  updateUndoRedoButtons();
  clearTimeout(_undoPushTimer);
  _undoPushTimer = setTimeout(commitUndoSnapshot, 800);
}
// Force l'enregistrement immédiat (utilisé avant/après une action discrète
// comme Gras/Italique, pour qu'elle forme sa propre étape d'annulation).
function checkpointNow() { _pendingUndoFlush = true; commitUndoSnapshot(); }
function commitUndoSnapshot() {
  clearTimeout(_undoPushTimer);
  if (!_pendingUndoFlush) return;
  _pendingUndoFlush = false;
  const ch = db.chapters[cur]; if (!ch) return;
  const st = getUndoStack(ch.id);
  const html = document.getElementById('writer').innerHTML;
  if (st.stack[st.index] === html) { updateUndoRedoButtons(); return; }
  st.stack = st.stack.slice(0, st.index + 1);
  st.stack.push(html);
  st.index = st.stack.length - 1;
  if (st.stack.length > UNDO_LIMIT) { st.stack.shift(); st.index--; }
  updateUndoRedoButtons();
}
function undoEdit() {
  const ch = db.chapters[cur]; if (!ch) return;
  const st = getUndoStack(ch.id);
  if (_pendingUndoFlush) {
    // Une rafale de frappe pas encore "actée" : on l'annule d'un coup,
    // comme dans un traitement de texte classique.
    clearTimeout(_undoPushTimer);
    _pendingUndoFlush = false;
    applyUndoState(st);
    return;
  }
  if (st.index <= 0) { toast('Rien à annuler.', 'info'); return; }
  st.index--;
  applyUndoState(st);
}
function redoEdit() {
  const ch = db.chapters[cur]; if (!ch) return;
  const st = getUndoStack(ch.id);
  if (st.index >= st.stack.length - 1) { toast('Rien à rétablir.', 'info'); return; }
  st.index++;
  applyUndoState(st);
}
function applyUndoState(st) {
  const w = document.getElementById('writer');
  w.innerHTML = st.stack[st.index];
  db.chapters[cur].content = w.innerHTML;
  updateDailyStats(); debouncedSave();
  updateUndoRedoButtons();
}
function updateUndoRedoButtons() {
  const ub = document.getElementById('undo-btn'), rb = document.getElementById('redo-btn');
  const ch = db.chapters[cur];
  if (!ch) { if (ub) ub.disabled = true; if (rb) rb.disabled = true; return; }
  const st = getUndoStack(ch.id);
  if (ub) ub.disabled = !(_pendingUndoFlush || st.index > 0);
  if (rb) rb.disabled = _pendingUndoFlush || st.index >= st.stack.length - 1;
}
// Exclut les autres champs de saisie (titre, recherche...) du raccourci
// clavier global Ctrl+Z/Ctrl+Y — #writer reste seul concerné.
function isTypingTarget(el) {
  if (!el || el.id === 'writer') return false;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true;
  if (el.isContentEditable) return true;
  return false;
}

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
  ensureUndoStack(ch); updateUndoRedoButtons();
}
function liveCounter() {
  if (_switching) return;
  db.chapters[cur].content = document.getElementById('writer').innerHTML;
  updateDailyStats(); debouncedSave();
  scheduleUndoSnapshot();
}
const CH_STATUS_META = {
  draft: { color:'#7f8c8d', label:'Brouillon' },
  review: { color:'#f39c12', label:'À revoir' },
  final: { color:'#27ae60', label:'Final' }
};
// Glisser-déposer des chapitres (remplace les flèches ↑/↓, nouveau v7.8.0) —
// Alt+↑/↓ au clavier reste disponible via moveChapter() pour l'accessibilité.
let _dragChapterIdx = null;
// Vue Chapitres : liste (par défaut) ou tableau de fiches façon corkboard —
// nouveau v7.10.0 (Lot 6). Jamais mémorisé : revient à 'list' à chaque
// ouverture de manuscrit (voir initApp(), router.js).
let _chapterViewMode = 'list';
// Menu ⋮ du chapitre — nouveau v7.8.1 : UN SEUL élément partagé (#chapter-ctx-menu,
// défini hors de la sidebar dans index.html), positionné en fixed et déplacé au
// bon endroit à l'ouverture. Corrige le rognage par le overflow:hidden de la
// sidebar/liste (l'ancien menu était imbriqué dans chaque ligne de chapitre).
let _ctxMenuChapterIdx = null;
function closeAllChapterMenus() {
  const menu = document.getElementById('chapter-ctx-menu');
  menu.classList.remove('open');
  _ctxMenuChapterIdx = null;
  document.querySelectorAll('#chapter-list .chapter-item.menu-open, #corkboard-view .card.menu-open').forEach(ci => ci.classList.remove('menu-open'));
}
function openChapterCtxMenu(i, btn) {
  const menu = document.getElementById('chapter-ctx-menu');
  const alreadyOpenForThis = menu.classList.contains('open') && _ctxMenuChapterIdx === i;
  closeAllChapterMenus();
  if (alreadyOpenForThis) return; // un second clic sur le même ⋮ referme le menu
  _ctxMenuChapterIdx = i;
  const rect = btn.getBoundingClientRect();
  menu.style.visibility = 'hidden';
  menu.classList.add('open');
  const menuWidth = menu.offsetWidth || 190;
  let left = rect.right - menuWidth;
  if (left < 8) left = 8;
  const maxLeft = window.innerWidth - menuWidth - 8;
  if (left > maxLeft) left = maxLeft;
  menu.style.left = left + 'px';
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.style.visibility = 'visible';
  const item = btn.closest('.chapter-item, .card');
  if (item) item.classList.add('menu-open');
}
function reorderChapter(from, to) {
  if (from === to) return;
  commitUndoSnapshot();
  _switching = true;
  flushCurrentChapter();
  const activeId = db.chapters[cur].id;
  const [moved] = db.chapters.splice(from, 1);
  db.chapters.splice(to, 0, moved);
  cur = db.chapters.findIndex(c => c.id === activeId);
  renderChapterList(); loadChapter(cur);
  _switching = false; save();
}
// Tags libres sur un chapitre (en plus du statut fixe), nouveau v7.8.0.
function editChapterTags(i) {
  const current = (db.chapters[i].tags || []).join(', ');
  const input = prompt('Tags de ce chapitre, séparés par des virgules :\nEx. POV Marie, Flashback', current);
  if (input === null) return;
  const seen = new Set(); const clean = [];
  input.split(',').map(t => t.trim()).filter(Boolean).forEach(t => {
    const k = t.toLowerCase();
    if (!seen.has(k)) { seen.add(k); clean.push(t); }
  });
  db.chapters[i].tags = clean;
  renderChapterList();
  debouncedSave();
}
function renderChapterList() {
  const list = document.getElementById('chapter-list');
  list.innerHTML = db.chapters.map((ch,i) => {
    const sm = CH_STATUS_META[ch.status] || CH_STATUS_META.draft;
    const tags = ch.tags || [];
    return `<div class="chapter-item ${i===cur?'active':''}" data-idx="${i}" role="listitem" tabindex="0" aria-current="${i===cur}" draggable="true">
      <div class="ch-row">
        <span class="ch-drag-handle" aria-hidden="true" title="Glisser pour réordonner (ou Alt+↑/↓)">⠿</span>
        <span class="ch-status-dot ch-status-${ch.status||'draft'}" title="${sm.label}"></span>
        <span class="ch-num">${i+1}.</span>
        <span class="ch-title-text u-fg-1 u-ov-hidden u-tovf-ellipsis u-ws-nowrap">${DOMPurify.sanitize(ch.title||'')}</span>
        <span class="ch-wordcount" title="Nombre de mots">${getWordCount(ch.content)}</span>
        <button class="ch-kebab-btn" data-idx="${i}" title="Actions du chapitre" aria-label="Actions du chapitre">⋮</button>
      </div>
      ${tags.length ? `<div class="ch-tags">${tags.map(t=>`<span class="ch-tag">#${DOMPurify.sanitize(t)}</span>`).join('')}</div>` : ''}
    </div>`;
  }).join('');
  list.querySelectorAll('.chapter-item').forEach(el => {
    el.addEventListener('click', (e) => { if(e.target.closest('.ch-kebab-btn')||e.target.closest('.ch-rename-input')) return; changeCh(parseInt(el.dataset.idx)); });
    el.addEventListener('keydown', e => {
      if((e.key==='Enter'||e.key===' ')&&!e.target.closest('.ch-kebab-btn')) changeCh(parseInt(el.dataset.idx));
      if(e.altKey && (e.key==='ArrowUp'||e.key==='ArrowDown')) { e.preventDefault(); moveChapter(parseInt(el.dataset.idx), e.key==='ArrowUp'?'up':'down'); }
    });
    el.addEventListener('dragstart', e => {
      if (e.target.closest('.ch-rename-input')) { e.preventDefault(); return; }
      _dragChapterIdx = parseInt(el.dataset.idx);
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', ''); } catch(err) {}
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      list.querySelectorAll('.chapter-item').forEach(x => x.classList.remove('drag-over'));
      _dragChapterIdx = null;
    });
    el.addEventListener('dragover', e => { e.preventDefault(); if (_dragChapterIdx===null) return; el.classList.add('drag-over'); });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', e => {
      e.preventDefault(); el.classList.remove('drag-over');
      const targetIdx = parseInt(el.dataset.idx);
      if (_dragChapterIdx===null || _dragChapterIdx===targetIdx) return;
      reorderChapter(_dragChapterIdx, targetIdx);
    });
  });
  list.querySelectorAll('.ch-kebab-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openChapterCtxMenu(parseInt(btn.dataset.idx), btn); });
  });
  // v7.10.0 : si la vue Fiches est active, la garder synchronisée avec la
  // liste à chaque mutation (ajout/suppression/réordonnancement/tags/statut...)
  // sans avoir à toucher chacun de ces points d'appel individuellement.
  if (_chapterViewMode === 'cork') renderCorkboard();
}
// ═══════════════════════════════════════════════════════
// VUE CORKBOARD — tableau de fiches (nouveau v7.10.0, Lot 6)
// Bascule Liste/Fiches câblée dans wireAppEventListenersOnce() (router.js) ;
// jamais mémorisée, remise à 'list' à chaque ouverture de manuscrit.
// Réutilise reorderChapter() (Lot 4) pour le glisser-déposer et le menu ⋮
// partagé existant (ADR-17) pour les actions — voir closeAllChapterMenus()/
// openChapterCtxMenu() ci-dessus, étendus pour reconnaître aussi .card.
// ═══════════════════════════════════════════════════════
function setChapterViewMode(mode) {
  _chapterViewMode = mode;
  const isCork = mode === 'cork';
  document.getElementById('view-list-btn').classList.toggle('active', !isCork);
  document.getElementById('view-cork-btn').classList.toggle('active', isCork);
  document.querySelector('#editor-wrapper .toolbar').style.display = isCork ? 'none' : 'flex';
  document.getElementById('chapter-title-row').style.display = isCork ? 'none' : 'flex';
  document.getElementById('writer').style.display = isCork ? 'none' : '';
  document.getElementById('corkboard-view').style.display = isCork ? 'grid' : 'none';
  if (isCork) renderCorkboard();
}
function renderCorkboard() {
  const cont = document.getElementById('corkboard-view');
  if (!cont) return;
  cont.innerHTML = db.chapters.map((ch,i) => {
    const sm = CH_STATUS_META[ch.status] || CH_STATUS_META.draft;
    const tags = ch.tags || [];
    const excerpt = ch.summary || getPlainText(ch.content).slice(0,90) || '(chapitre vide)';
    return `<div class="card ch-status-${ch.status||'draft'} ${i===cur?'active':''}" data-idx="${i}" draggable="true" role="listitem" tabindex="0" title="${sm.label}">
      <div class="card-num">${i+1}</div>
      <div class="card-title">${DOMPurify.sanitize(ch.title||'')}</div>
      <div class="card-excerpt">${DOMPurify.sanitize(excerpt)}</div>
      ${tags.length ? `<div class="ch-tags">${tags.map(t=>`<span class="ch-tag">#${DOMPurify.sanitize(t)}</span>`).join('')}</div>` : ''}
      <div class="card-foot"><span>${getWordCount(ch.content)} mots</span><button class="ch-kebab-btn" data-idx="${i}" title="Actions du chapitre" aria-label="Actions du chapitre">⋮</button></div>
    </div>`;
  }).join('');
  cont.querySelectorAll('.card').forEach(el => {
    el.addEventListener('click', e => { if (e.target.closest('.ch-kebab-btn')) return; setChapterViewMode('list'); changeCh(parseInt(el.dataset.idx)); });
    el.addEventListener('keydown', e => {
      if (e.target.closest('.ch-kebab-btn')) return;
      if (e.key==='Enter'||e.key===' ') { e.preventDefault(); setChapterViewMode('list'); changeCh(parseInt(el.dataset.idx)); }
    });
    el.addEventListener('dragstart', e => {
      _dragChapterIdx = parseInt(el.dataset.idx);
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', ''); } catch(err) {}
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      cont.querySelectorAll('.card').forEach(x => x.classList.remove('drag-over'));
      _dragChapterIdx = null;
    });
    el.addEventListener('dragover', e => { e.preventDefault(); if (_dragChapterIdx===null) return; el.classList.add('drag-over'); });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', e => {
      e.preventDefault(); el.classList.remove('drag-over');
      const targetIdx = parseInt(el.dataset.idx);
      if (_dragChapterIdx===null || _dragChapterIdx===targetIdx) return;
      reorderChapter(_dragChapterIdx, targetIdx);
    });
  });
  cont.querySelectorAll('.ch-kebab-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openChapterCtxMenu(parseInt(btn.dataset.idx), btn); });
  });
}
function duplicateChapter(i) {
  commitUndoSnapshot();
  _switching = true;
  flushCurrentChapter();
  const orig = db.chapters[i];
  const copy = { id: genChapterId(), title: (orig.title||'Chapitre') + ' (copie)', content: orig.content, tension: orig.tension, summary: orig.summary, status: 'draft', tags: [...(orig.tags||[])] };
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
  commitUndoSnapshot();
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
  renderChapterList(); loadChapter(cur); updateDailyStats(); updateTrashBadge();
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
  updateTrashBadge();
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
    listEl.innerHTML = '<div class="u-op-_5 u-p-16px u-ta-center u-fs-_82rem">La corbeille est vide.</div>';
    return;
  }
  listEl.innerHTML = db.trash.map((t,i) => {
    const daysLeft = Math.max(0, 30 - Math.floor((Date.now()-t.deletedAt)/86400000));
    return `<div class="history-item u-cur-default">
      <span>${DOMPurify.sanitize(t.chapter.title||'Sans titre')}<br><span class="u-op-_5 u-fs-_68rem">Supprimé le ${new Date(t.deletedAt).toLocaleDateString('fr')} — purge auto dans ${daysLeft}j</span></span>
      <span class="u-d-flex u-gap-4px u-fsh-0">
        <button class="action-btn btn-sm" data-restore="${i}">↩ Restaurer</button>
        <button class="action-btn btn-sm u-bg-v-danger" data-purge="${i}">✕ Définitif</button>
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
  renderChapterList(); renderTrashList(); updateTrashBadge(); save();
  toast('Chapitre restauré','success');
}
function permanentlyPurge(i) {
  if (!confirm('Supprimer définitivement ce chapitre ? Cette action est irréversible.')) return;
  db.trash.splice(i,1);
  renderTrashList(); updateTrashBadge(); save();
}
function moveChapter(i, dir) {
  const j = dir==='up' ? i-1 : i+1;
  if (j<0 || j>=db.chapters.length) return;
  commitUndoSnapshot();
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
  commitUndoSnapshot();
  _switching = true;
  flushCurrentChapter(); cur = i; renderChapterList(); loadChapter(cur); updateDailyStats();
  _switching = false;
}
function addChapter() {
  commitUndoSnapshot();
  _switching = true;
  flushCurrentChapter();
  db.chapters.push({ id: genChapterId(), title:`Chapitre ${db.chapters.length+1}`, content:'', tension:20, summary:'', status:'draft', tags:[] });
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
  checkpointNow();
  document.getElementById('writer').focus();
  document.execCommand(cmd, false, null);
  liveCounter();
  checkpointNow();
}
function formatParagraph(tag) {
  checkpointNow();
  document.getElementById('writer').focus();
  document.execCommand('formatBlock', false, tag);
  liveCounter();
  checkpointNow();
}

// ═══════════════════════════════════════════════════════
// STYLE ANALYSIS (mots faibles surlignés)
// ═══════════════════════════════════════════════════════
function analyzeStyle() {
  checkpointNow();
  const writer = document.getElementById('writer');
  let txt = writer.innerHTML;
  db.weakWords.forEach(w => { txt = txt.replace(new RegExp(`\\b(${w})\\b`,'gi'),'<mark>$1</mark>'); });
  writer.innerHTML = DOMPurify.sanitize(txt);
  checkpointNow();
}
function clearStyle() {
  // Correction v6.0.0 : confirmation demandée avant de supprimer les surlignages.
  if (!confirm('Supprimer tous les surlignages de style (mots faibles) ? Le texte lui-même ne sera pas modifié.')) return;
  checkpointNow();
  const writer = document.getElementById('writer');
  writer.innerHTML = DOMPurify.sanitize(writer.innerHTML.replace(/<mark[^>]*>|<\/mark>/g,''));
  liveCounter();
  checkpointNow();
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
  commitUndoSnapshot();
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
  // Toute la session Focus devient une seule étape d'annulation.
  checkpointNow();
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
