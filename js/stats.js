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
  updateGoalsUI(totalW);
}

// ═══════════════════════════════════════════════════════
// OBJECTIFS HEBDOMADAIRE & MENSUEL (nouveau v6.2.0)
// db.sessionStats stocke le total cumulé de mots par jour ; on retrouve le
// nombre de mots écrits sur les N derniers jours en soustrayant le total
// enregistré juste avant le début de la période.
// ═══════════════════════════════════════════════════════
function getWordsInLastNDays(n, totalW) {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-n); cutoff.setHours(0,0,0,0);
  const cutoffKey = cutoff.toISOString().slice(0,10);
  const before = Object.entries(db.sessionStats||{}).filter(([k]) => k < cutoffKey).sort((a,b)=>b[0].localeCompare(a[0]));
  const baseline = before.length ? before[0][1] : 0;
  return Math.max(0, totalW - baseline);
}
function updateGoalsUI(totalW) {
  totalW = totalW ?? db.chapters.reduce((s,c) => s + getWordCount(c.content), 0);
  const weekW = getWordsInLastNDays(7, totalW), monthW = getWordsInLastNDays(30, totalW);
  const wGoal = db.weeklyGoal || 3000, mGoal = db.monthlyGoal || 12000;
  const wPct = Math.min(100, Math.round(weekW/wGoal*100)), mPct = Math.min(100, Math.round(monthW/mGoal*100));
  const wBar = document.getElementById('week-goal-bar'); if (wBar) wBar.style.width = wPct+'%';
  const wLbl = document.getElementById('week-goal-label'); if (wLbl) wLbl.textContent = `${weekW} / ${wGoal} mots (${wPct}%)`;
  const mBar = document.getElementById('month-goal-bar'); if (mBar) mBar.style.width = mPct+'%';
  const mLbl = document.getElementById('month-goal-label'); if (mLbl) mLbl.textContent = `${monthW} / ${mGoal} mots (${mPct}%)`;
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
// SPRINT (Pomodoro d'écriture) — persistant depuis v6.0.0
// L'état du sprint (heure de fin + mots de départ) est sauvegardé dans `db`,
// ce qui permet de reprendre le compte à rebours après un rechargement de
// page ou une fermeture accidentelle de l'onglet.
// ═══════════════════════════════════════════════════════
const SPRINT_DURATION = 1500; // 25 minutes en secondes

function startSprint() {
  if (sprintInterval) return;
  sprintWordsStart = getWordCount(document.getElementById('writer').innerText);
  db.sprint = { endTime: Date.now() + SPRINT_DURATION * 1000, wordsStart: sprintWordsStart };
  save();
  runSprintTick();
}

function runSprintTick() {
  clearInterval(sprintInterval);
  sprintInterval = setInterval(() => {
    if (!db.sprint) { resetSprint(); return; }
    const remaining = Math.max(0, Math.round((db.sprint.endTime - Date.now()) / 1000));
    document.getElementById('sprint-timer').innerText = Math.floor(remaining/60)+':'+(remaining%60).toString().padStart(2,'0');
    document.getElementById('sprint-progress').innerText = getWordCount(document.getElementById('writer').innerText) - db.sprint.wordsStart;
    if (remaining <= 0) resetSprint();
  }, 1000);
}

function resetSprint() {
  clearInterval(sprintInterval); sprintInterval = null;
  db.sprint = null; save();
  document.getElementById('sprint-timer').innerText = '25:00';
  document.getElementById('sprint-progress').innerText = '0';
}

// Appelée une fois au démarrage de l'app (voir router.js) : reprend un
// sprint encore en cours, ou nettoie silencieusement un sprint expiré.
function resumeSprintIfNeeded() {
  if (!db.sprint) return;
  if (db.sprint.endTime <= Date.now()) { db.sprint = null; save(); return; }
  sprintWordsStart = db.sprint.wordsStart;
  runSprintTick();
  toast('Sprint d\'écriture repris.', 'info');
}
