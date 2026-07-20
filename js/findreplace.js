'use strict';
// ═══════════════════════════════════════════════════════
// RECHERCHER / REMPLACER dans l'éditeur (nouveau v6.1.0)
// Fonctionne au niveau des nœuds texte du contenteditable : couvre le cas
// standard (mot/expression à l'intérieur d'un même passage de mise en
// forme). Une occurrence qui chevauche une limite gras/italique n'est pas
// remplacée automatiquement — cas rare, à corriger manuellement.
// ═══════════════════════════════════════════════════════
let _frMatches = [], _frIndex = -1;

function collectTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  return nodes;
}

function doFind() {
  const query = document.getElementById('fr-find-input').value;
  const writer = document.getElementById('writer');
  _frMatches = [];
  if (!query) { _frIndex = -1; updateFrStatus(); return; }
  const nodes = collectTextNodes(writer);
  const lowerQ = query.toLowerCase();
  nodes.forEach(node => {
    const text = node.textContent.toLowerCase();
    let idx = 0;
    while ((idx = text.indexOf(lowerQ, idx)) !== -1) {
      _frMatches.push({ node, start: idx, end: idx + query.length });
      idx += query.length;
    }
  });
  _frIndex = _frMatches.length ? 0 : -1;
  highlightCurrentMatch();
  updateFrStatus();
}

function highlightCurrentMatch() {
  if (_frIndex < 0 || !_frMatches[_frIndex]) return;
  const m = _frMatches[_frIndex];
  try {
    const range = document.createRange();
    range.setStart(m.node, m.start);
    range.setEnd(m.node, m.end);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const el = m.node.parentElement;
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
  const text = m.node.textContent;
  m.node.textContent = text.slice(0, m.start) + replacement + text.slice(m.end);
  liveCounter();
  doFind();
}

function frReplaceAll() {
  const query = document.getElementById('fr-find-input').value;
  const replacement = document.getElementById('fr-replace-input').value;
  if (!query) { toast('Entrez un texte à rechercher.', 'error'); return; }
  const writer = document.getElementById('writer');
  const nodes = collectTextNodes(writer);
  const lowerQ = query.toLowerCase();
  let count = 0;
  nodes.forEach(node => {
    const text = node.textContent, lower = text.toLowerCase();
    let out = '', i = 0, changed = false;
    while (true) {
      const idx = lower.indexOf(lowerQ, i);
      if (idx === -1) { out += text.slice(i); break; }
      out += text.slice(i, idx) + replacement;
      i = idx + query.length; changed = true; count++;
    }
    if (changed) node.textContent = out;
  });
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
