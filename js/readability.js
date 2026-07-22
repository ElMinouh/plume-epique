'use strict';
function fleschKincaid(text) {
  const sentences = (text.match(/[.!?]+/g)||[]).length || 1;
  const words = (text.match(/[a-zA-ZÀ-ÿ]+/g)||[]);
  const wordCount = words.length || 1;
  const syllables = words.reduce((s,w) => s + Math.max(1,(w.toLowerCase().match(/[aeiouyàâéèêëîïôùûü]/g)||[]).length), 0);
  const score = Math.max(0, Math.min(100, 206.835 - 1.015*(wordCount/sentences) - 84.6*(syllables/wordCount)));
  return Math.round(score);
}
function fleschLabel(score) {
  if (score>=90) return ['Très facile','#27ae60'];
  if (score>=70) return ['Facile','#2ecc71'];
  if (score>=50) return ['Standard','#f39c12'];
  if (score>=30) return ['Difficile','#e67e22'];
  return ['Très difficile','#e74c3c'];
}
function countDialogLines(text) {
  const lines = text.split('\n');
  let dialog=0, narration=0;
  lines.forEach(l => { const t=l.trim(); if (t.startsWith('—')||t.startsWith('"')||t.startsWith('«')) dialog++; else if(t) narration++; });
  return { dialog, narration };
}
function renderAnalytics() {
  flushCurrentChapter();
  const allText = db.chapters.map(c=>getPlainText(c.content)).join('\n');
  const totalW = db.chapters.reduce((s,c)=>s+getWordCount(c.content),0);
  const avgWC = db.chapters.length ? Math.round(totalW/db.chapters.length) : 0;
  const flesch = fleschKincaid(allText);
  const [flLabel, flColor] = fleschLabel(flesch);
  const sentences = (allText.match(/[.!?]+/g)||[]).length||1;
  const avgSentLen = Math.round(totalW/sentences);
  document.getElementById('analytics-global').innerHTML = [
    { v:totalW, l:'Mots total' },
    { v:db.chapters.length, l:'Chapitres' },
    { v:avgWC, l:'Mots/chapitre' },
    { v:avgSentLen, l:'Mots/phrase' },
    { v:flesch, l:'Score Flesch' },
    { v:sentences, l:'Phrases total' },
  ].map(s=>`<div class="analytics-card"><div class="av">${s.v}</div><div class="al">${s.l}</div></div>`).join('');
  const maxCh = Math.max(...db.chapters.map(c=>getWordCount(c.content)), 1);
  document.getElementById('analytics-bars').innerHTML = db.chapters.map((ch,i) => {
    const wc=getWordCount(ch.content), pct=Math.round(wc/maxCh*100);
    return `<div class="chapter-bar-row"><span class="u-minw-70px u-ovf-hidden u-tovf-ellipsis u-ws-nowrap" title="${DOMPurify.sanitize(ch.title)}">Ch.${i+1}</span>
      <div class="u-fg-1 u-bg-v-item-bg u-br-4px u-h-8px u-ovf-hidden">
        <div class="chapter-bar-fill" data-pct="${pct}"></div></div>
      <span class="u-minw-45px u-ta-right u-fs-_7rem">${wc} m.</span></div>`;
  }).join('');
  // v7.20.0 : la largeur de chaque barre et la couleur du score Flesch sont des
  // valeurs calculées ; elles sont posées via la propriété CSSOM (`.style.x = …`,
  // autorisée par la CSP même sans 'unsafe-inline') juste après le rendu, plutôt
  // que par un attribut de style écrit dans le HTML généré (lui, bloqué).
  document.querySelectorAll('#analytics-bars .chapter-bar-fill').forEach(el => {
    el.style.width = el.dataset.pct + '%';
  });
  document.getElementById('analytics-flesch').innerHTML = `
    <div class="flesch-score">${flesch}</div>
    <div><div class="u-fwt-700 flesch-label">${flLabel}</div>
    <div class="u-fs-_7rem u-op-_7">/100 — Plus élevé = plus lisible</div></div>`;
  document.querySelectorAll('#analytics-flesch .flesch-score, #analytics-flesch .flesch-label')
    .forEach(el => { el.style.color = flColor; });
  let totalDialog=0, totalNarration=0;
  db.chapters.forEach(c=>{ const r=countDialogLines(getPlainText(c.content)); totalDialog+=r.dialog; totalNarration+=r.narration; });
  if (dialogChart) { dialogChart.destroy(); dialogChart=null; }
  const ctx2 = document.getElementById('dialogChart').getContext('2d');
  dialogChart = new Chart(ctx2,{
    type:'doughnut',
    data:{labels:['Dialogue','Narration'],datasets:[{data:[totalDialog,totalNarration],backgroundColor:['#8e44ad','#2980b9'],borderWidth:0}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:11}}}}}
  });
}
