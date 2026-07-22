'use strict';
// Correction v6.0.0 : remplacement du diff naïf (présence/absence de mots
// dans deux ensembles, qui ne détectait ni l'ordre ni les répétitions
// correctement) par un vrai diff mot-à-mot basé sur le LCS (Longest Common
// Subsequence). Les totaux +ajoutés/-supprimés restent calculés sur le texte
// entier (rapide), l'affichage détaillé est borné à MAX_WORDS mots par
// version pour rester performant sur de longs chapitres.
function computeDiff(oldText, newText) {
  const oldWFull = oldText.split(/\s+/).filter(Boolean);
  const newWFull = newText.split(/\s+/).filter(Boolean);
  const oldSet = new Set(oldWFull), newSet = new Set(newWFull);
  const added = newWFull.filter(w => !oldSet.has(w)).length;
  const removed = oldWFull.filter(w => !newSet.has(w)).length;

  const MAX_WORDS = 600;
  const truncated = oldWFull.length > MAX_WORDS || newWFull.length > MAX_WORDS;
  const oldW = truncated ? oldWFull.slice(0, MAX_WORDS) : oldWFull;
  const newW = truncated ? newWFull.slice(0, MAX_WORDS) : newWFull;

  const n = oldW.length, m = newW.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = oldW[i] === newW[j] ? dp[i+1][j+1] + 1 : Math.max(dp[i+1][j], dp[i][j+1]);
    }
  }

  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (oldW[i] === newW[j]) { ops.push({ type:'eq', word:newW[j] }); i++; j++; }
    else if (dp[i+1][j] >= dp[i][j+1]) { ops.push({ type:'del', word:oldW[i] }); i++; }
    else { ops.push({ type:'add', word:newW[j] }); j++; }
  }
  while (i < n) { ops.push({ type:'del', word:oldW[i] }); i++; }
  while (j < m) { ops.push({ type:'add', word:newW[j] }); j++; }

  let html = `<div class="u-mb-8px u-fs-_75rem u-op-_7">
    <span class="diff-add">+${added} mots ajoutés</span> &nbsp; <span class="diff-del">-${removed} mots supprimés</span>
    ${truncated ? '<br><span class="u-op-_6">(aperçu détaillé limité aux '+MAX_WORDS+' premiers mots de chaque version)</span>' : ''}
  </div>`;

  html += ops.map(o => {
    const safe = DOMPurify.sanitize(o.word);
    if (o.type === 'add') return `<span class="diff-add">${safe}</span>`;
    if (o.type === 'del') return `<span class="diff-del">${safe}</span>`;
    return safe;
  }).join(' ');

  return html;
}
