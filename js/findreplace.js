'use strict';
// ═══════════════════════════════════════════════════════
// RECHERCHER / REMPLACER dans l'éditeur (v6.1.0, corrigé v7.1.0, étendu v9.36.0)
// Fonctionne au niveau des nœuds texte du contenteditable. Correction :
// une occurrence est désormais retrouvée même si elle chevauche une limite
// de mise en forme (ex. un mot moitié en gras, moitié non, donc réparti sur
// deux nœuds texte adjacents) — la recherche se fait sur un texte "à plat"
// reconstitué à partir de tous les nœuds, avec une correspondance
// caractère → (nœud, position) pour retrouver l'emplacement exact ensuite.
// Le remplacement utilise l'API Range du navigateur, qui gère nativement
// la coupure/fusion des nœuds concernés, y compris à cheval sur plusieurs.
//
// v9.36.0 (audit AUD-02-010) :
//  • options « Respecter la casse » et « Mot entier » (bornes qui comprennent les accents) ;
//  • mode « Tout le manuscrit » pour « Tout remplacer » : décompte et confirmation d'abord,
//    copie « Avant remplacement global » de chaque chapitre modifié ;
//  • une occurrence ne traverse plus deux paragraphes ni un retour à la ligne (le texte à plat reçoit
//    une coupure entre blocs) ;
//  • le texte à plat n'est plus mis en minuscules (le décalage d'indices de certains caractères
//    faussait la position des occurrences).
// ═══════════════════════════════════════════════════════
let _frMatches = [], _frIndex = -1;

function collectTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  return nodes;
}

const FR_BLOCK_TAGS = /^(p|div|h[1-6]|li|blockquote|pre|tr)$/i;

// Texte à plat de `root`, avec pour chaque caractère (nœud, position) ; les coupures entre blocs et
// les <br> sont des caractères « \n » sans nœud (map[i] === null) : aucune occurrence ne les traverse.
function buildFlatIndex(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let flat = '';
  const map = [];
  let lastBlock = null;
  const blockOf = node => {
    for (let el = node.parentNode; el && el !== root; el = el.parentNode) if (el.nodeType === 1 && FR_BLOCK_TAGS.test(el.tagName)) return el;
    return root;
  };
  let n;
  while ((n = walker.nextNode())) {
    if (n.nodeType === 1) {
      if (n.tagName === 'BR') { flat += '\n'; map.push(null); }
      continue;
    }
    const block = blockOf(n);
    if (lastBlock && block !== lastBlock) { flat += '\n'; map.push(null); }
    lastBlock = block;
    const text = n.textContent;
    for (let i = 0; i < text.length; i++) map.push({ node: n, offset: i });
    flat += text;
  }
  return { flat, map };
}

function escapeRegExpFr(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function frRegex(query, opts) {
  const o = opts || {};
  const core = escapeRegExpFr(query);
  const src = o.wholeWord ? '(?<![\\p{L}\\p{N}_])' + core + '(?![\\p{L}\\p{N}_])' : core;
  return new RegExp(src, o.matchCase ? 'gu' : 'giu');
}

function findAllMatches(root, query, opts) {
  const { flat, map } = buildFlatIndex(root);
  const matches = [];
  if (!query) return matches;
  const re = frRegex(query, opts);
  let m;
  while ((m = re.exec(flat)) !== null) {
    if (m[0] === '') { re.lastIndex++; continue; }
    const startPos = map[m.index], endPos = map[m.index + m[0].length - 1];
    if (startPos && endPos) {
      matches.push({ startNode: startPos.node, startOffset: startPos.offset, endNode: endPos.node, endOffset: endPos.offset + 1 });
    }
  }
  return matches;
}

// Options cochées dans le panneau (valeurs par défaut si le panneau est absent).
function frOptions() {
  const on = id => { const el = document.getElementById(id); return !!(el && el.checked); };
  return { matchCase: on('fr-case-cb'), wholeWord: on('fr-word-cb'), allManuscript: on('fr-all-cb') };
}

// Remplace chaque occurrence dans `root` (en partant de la fin : une modification n'invalide jamais
// la position des occurrences précédentes). Renvoie le nombre de remplacements faits.
function replaceAllInRoot(root, query, replacement, opts) {
  const matches = findAllMatches(root, query, opts);
  let count = 0;
  matches.slice().reverse().forEach(m => {
    try {
      const range = document.createRange();
      range.setStart(m.startNode, m.startOffset);
      range.setEnd(m.endNode, m.endOffset);
      range.deleteContents();
      if (replacement) range.insertNode(document.createTextNode(replacement));
      count++;
    } catch(e) { /* occurrence devenue invalide entre-temps, on l'ignore */ }
  });
  return count;
}

function doFind() {
  const query = document.getElementById('fr-find-input').value;
  const writer = document.getElementById('writer');
  _frMatches = [];
  if (!query) { _frIndex = -1; updateFrStatus(); return; }
  _frMatches = findAllMatches(writer, query, frOptions());
  _frIndex = _frMatches.length ? 0 : -1;
  highlightCurrentMatch();
  updateFrStatus();
}

function highlightCurrentMatch() {
  if (_frIndex < 0 || !_frMatches[_frIndex]) return;
  const m = _frMatches[_frIndex];
  try {
    const range = document.createRange();
    range.setStart(m.startNode, m.startOffset);
    range.setEnd(m.endNode, m.endOffset);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const el = m.startNode.parentElement;
    if (el && el.scrollIntoView) el.scrollIntoView({ block:'center', behavior:'smooth' });
  } catch(e) { /* le DOM a changé entre-temps, on ignore */ }
}

function frNext() {
  if (!_frMatches.length) { doFind(); return; }
  _frIndex = (_frIndex + 1) % _frMatches.length;
  highlightCurrentMatch(); updateFrStatus();
}

function frReplaceOne() {
  if (_frIndex < 0 || !_frMatches[_frIndex]) { toast('Aucune occurrence sélectionnée.', 'error'); return; }
  const replacement = document.getElementById('fr-replace-input').value;
  const m = _frMatches[_frIndex];
  try {
    const range = document.createRange();
    range.setStart(m.startNode, m.startOffset);
    range.setEnd(m.endNode, m.endOffset);
    range.deleteContents();
    if (replacement) range.insertNode(document.createTextNode(replacement));
  } catch(e) { toast('Remplacement impossible (le texte a changé entre-temps).', 'error'); return; }
  liveCounter();
  doFind();
}

// Mode « Tout le manuscrit » — première étape : compter, sans rien modifier.
function planGlobalReplace(query, opts) {
  flushCurrentChapter();
  const plan = [];
  let total = 0;
  db.chapters.forEach((ch, i) => {
    const root = document.createElement('div');
    root.innerHTML = sanitizeManuscriptHtml(ch.content || '');
    const n = findAllMatches(root, query, opts).length;
    if (n) { plan.push({ index: i, count: n }); total += n; }
  });
  return { plan, total };
}
// Seconde étape : copie « Avant remplacement global » de chaque chapitre touché, puis remplacement.
function applyGlobalReplace(plan, query, replacement, opts) {
  const stamp = new Date().toLocaleString('fr');
  let done = 0;
  plan.forEach(({ index }) => {
    takeSnapshot(index, 'Manuel — Avant remplacement global — ' + stamp);
    if (index === cur) {
      checkpointNow();
      done += replaceAllInRoot(document.getElementById('writer'), query, replacement, opts);
      liveCounter();
      checkpointNow();
    } else {
      const root = document.createElement('div');
      root.innerHTML = sanitizeManuscriptHtml(db.chapters[index].content || '');
      done += replaceAllInRoot(root, query, replacement, opts);
      db.chapters[index].content = root.innerHTML;
    }
  });
  renderChapterList();
  save();
  return done;
}
async function frReplaceAllManuscript(query, replacement, opts) {
  const { plan, total } = planGlobalReplace(query, opts);
  if (!total) { toast('Aucune occurrence trouvée dans le manuscrit.', 'error'); return; }
  const ok = await showConfirmModal({
    title: 'Remplacer dans tout le manuscrit ?',
    message: `${total} occurrence(s) de « ${query} » dans ${plan.length} chapitre(s) seront remplacées par « ${replacement} ». Une copie « Avant remplacement global » est gardée dans les versions de chaque chapitre modifié.`,
    confirmLabel: 'Remplacer'
  });
  if (!ok) return;
  const done = applyGlobalReplace(plan, query, replacement, opts);
  _frMatches = []; _frIndex = -1;
  toast(`${done} remplacement(s) dans ${plan.length} chapitre(s).`, 'success');
  updateFrStatus();
}

function frReplaceAll() {
  const query = document.getElementById('fr-find-input').value;
  const replacement = document.getElementById('fr-replace-input').value;
  if (!query) { toast('Entrez un texte à rechercher.', 'error'); return; }
  const opts = frOptions();
  if (opts.allManuscript) { frReplaceAllManuscript(query, replacement, opts); return; }
  const writer = document.getElementById('writer');
  const count = replaceAllInRoot(writer, query, replacement, opts);
  liveCounter();
  _frMatches = []; _frIndex = -1;
  toast(count ? `${count} remplacement(s) effectué(s).` : 'Aucune occurrence trouvée.', count ? 'success' : 'error');
  updateFrStatus();
}

function updateFrStatus() {
  const statusEl = document.getElementById('fr-status');
  if (!statusEl) return;
  statusEl.textContent = _frMatches.length ? `${_frIndex+1} / ${_frMatches.length}` : 'Aucun résultat';
}

function openFindReplace() {
  document.getElementById('fr-panel').classList.add('active');
  document.getElementById('fr-find-input').focus();
}
function closeFindReplace() {
  document.getElementById('fr-panel').classList.remove('active');
  _frMatches = []; _frIndex = -1;
}
