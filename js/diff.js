'use strict';
function computeDiff(oldText, newText) {
  const oldW = oldText.split(/\s+/), newW = newText.split(/\s+/);
  const oldSet = new Set(oldW), newSet = new Set(newW);
  const added = newW.filter(w => !oldSet.has(w)), removed = oldW.filter(w => !newSet.has(w));
  let html = `<div style="margin-bottom:8px;font-size:.75rem;opacity:.7;">
    <span class="diff-add">+${added.length} mots ajoutés</span> &nbsp; <span class="diff-del">-${removed.length} mots supprimés</span>
  </div>`;
  html += newW.slice(0, 200).map(w => added.includes(w) ? `<span class="diff-add">${DOMPurify.sanitize(w)}</span>` : DOMPurify.sanitize(w)).join(' ');
  return html;
}
