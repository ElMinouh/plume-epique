'use strict';
// ═══════════════════════════════════════════════════════
// RECHERCHER / REMPLACER dans l'éditeur (v6.1.0, corrigé v7.1.0)
// Fonctionne au niveau des nœuds texte du contenteditable. Correction :
// une occurrence est désormais retrouvée même si elle chevauche une limite
// de mise en forme (ex. un mot moitié en gras, moitié non, donc réparti sur
// deux nœuds texte adjacents) — la recherche se fait sur un texte "à plat"
// reconstitué à partir de tous les nœuds, avec une correspondance
// caractère → (nœud, position) pour retrouver l'emplacement exact ensuite.
// Le remplacement utilise l'API Range du navigateur, qui gère nativement
// la coupure/fusion des nœuds concernés, y compris à cheval sur plusieurs.
// ═══════════════════════════════════════════════════════
let _frMatches = [], _frIndex = -1;

function collectTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  return nodes;
}

// Reconstitue le texte complet du writer en une seule chaîne, avec pour
// chaque caractère la référence exacte (nœud, position dans ce nœud).
function buildFlatIndex(root) {
  const nodes = collectTextNodes(root);
  let flat = '';
  const map = [];
  nodes.forEach(node => {
    const text = node.textContent;
    for (let i = 0; i < text.length; i++) map.push({ node, offset: i });
    flat += text;
  });
  return { flat, map };
}

function findAllMatches(root, query) {
  const { flat, map } = buildFlatIndex(root);
  const lowerFlat = flat.toLowerCase(), lowerQ = query.toLowerCase();
  const matches = [];
  let idx = 0;
  while ((idx = lowerFlat.indexOf(lowerQ, idx)) !== -1) {
    const startPos = map[idx], endPos = map[idx + query.length - 1];
    if (startPos && endPos) {
      matches.push({ startNode: startPos.node, startOffset: startPos.offset, endNode: endPos.node, endOffset: endPos.offset + 1 });
    }
    idx += query.length;
  }
  return matches;
}

function doFind() {
  const query = document.getElementById('fr-find-input').value;
  const writer = document.getElementById('writer');
  _frMatches = [];
  if (!query) { _frIndex = -1; updateFrStatus(); return; }
  _frMatches = findAllMatches(writer, query);
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

function frReplaceAll() {
  const query = document.getElementById('fr-find-input').value;
  const replacement = document.getElementById('fr-replace-input').value;
  if (!query) { toast('Entrez un texte à rechercher.', 'error'); return; }
  const writer = document.getElementById('writer');
  const matches = findAllMatches(writer, query);
  let count = 0;
  // Remplacement en partant de la fin du document vers le début : ainsi,
  // modifier une occurrence n'invalide jamais la position des occurrences
  // précédentes qu'il reste à traiter.
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
