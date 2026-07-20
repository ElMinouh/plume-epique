'use strict';
function updateDailyStats() {
  const today = getTodayKey();
  const totalW = db.chapters.reduce((s,c) => s + getWordCount(c.content), 0);
  if (!db.sessionStats) db.sessionStats = {};
  db.sessionStats[today] = totalW;
  const todayW = Math.max(0, totalW - sessionWordsStart);
  const el_total = document.getElementById('total-words'), el_today = document.getElementById('today-words');
  if (el_total) el_total.innerText = totalW;
  if (el_today) el_today.innerText = todayW;
  const goal = db.dailyGoal || 500, pct = Math.min(100, Math.round(todayW/goal*100));
  ['goal-bar','sidebar-goal-bar'].forEach(id => { const el=document.getElementById(id); if(el) el.style.width=pct+'%'; });
  const lbl = document.getElementById('goal-label'); if (lbl) lbl.textContent = pct + ' %';
  if (pct >= 100 && todayW > 0) toast('🎉 Objectif journalier atteint !','success');
}

function renderStats() {
  const totalW=db.chapters.reduce((s,c)=>s+getWordCount(c.content),0);
  const todayW=Math.max(0,totalW-sessionWordsStart), elapsed=Math.round((Date.now()-sessionStartTime)/60000);
  const wpm=elapsed>0?Math.round(todayW/elapsed):0;
  const pct=Math.min(100,Math.round(todayW/(db.dailyGoal||500)*100));
  document.getElementById('stats-grid').innerHTML=[
    {v:totalW,l:'Mots total'},{v:todayW,l:"Aujourd'hui"},{v:wpm,l:'Mots/min'},
    {v:elapsed+' min',l:'Session'},{v:pct+'%',l:'Objectif'},{v:db.chapters.length,l:'Chapitres'}
  ].map(s=>`<div class="stat-card"><div class="stat-val">${s.v}</div><div class="stat-label">${s.l}</div></div>`).join('');
  const days=[],counts=[];
  for(let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const key=d.toISOString().slice(0,10);days.push(d.toLocaleDateString('fr',{weekday:'short'}));counts.push(db.sessionStats?.[key]||0);}
  if(sessionChart){sessionChart.data.labels=days;sessionChart.data.datasets[0].data=counts;sessionChart.update();}
  else{const ctx=document.getElementById('sessionChart').getContext('2d');sessionChart=new Chart(ctx,{type:'bar',data:{labels:days,datasets:[{label:'Mots',data:counts,backgroundColor:'rgba(192,57,43,.5)',borderColor:'#c0392b',borderWidth:1}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}});}
}

// ═══════════════════════════════════════════════════════
// SPRINT (Pomodoro d'écriture)
// ═══════════════════════════════════════════════════════
function startSprint() {
  if(sprintInterval) return;
  sprintWordsStart=getWordCount(document.getElementById('writer').innerText);
  let time=1500;
  sprintInterval=setInterval(()=>{
    time--; document.getElementById('sprint-timer').innerText=Math.floor(time/60)+':'+(time%60).toString().padStart(2,'0');
    document.getElementById('sprint-progress').innerText=getWordCount(document.getElementById('writer').innerText)-sprintWordsStart;
    if(time<=0)resetSprint();
  },1000);
}
function resetSprint(){clearInterval(sprintInterval);sprintInterval=null;document.getElementById('sprint-timer').innerText='25:00';document.getElementById('sprint-progress').innerText='0';}
