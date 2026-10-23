'use strict';
// v9.34.0 (AUD-02-020) — champ d'objectif vidé ou invalide : on ne change rien (avant, 500/3000/12000
// étaient enregistrés dès qu'on effaçait le champ pour retaper une valeur).
function readGoalInput(el) {
  const n = parseInt(el.value, 10);
  return n >= 1 ? n : null;
}
// v9.80.0 (AUD-08-003) : « aujourd'hui » = total actuel − total à la PREMIÈRE ouverture du jour (db.dayStart).
// Avant, la base était le total à l'ouverture du manuscrit (sessionWordsStart) : fermer puis rouvrir
// remettait « aujourd'hui » et l'objectif journalier à 0. sessionWordsStart reste la base de « Cette séance ».
function dayStartWords(totalW) {
  const today = getTodayKey();
  if (!db.dayStart || db.dayStart.k !== today) db.dayStart = { k: today, w: totalW };
  return db.dayStart.w;
}
function wordsToday(totalW) { return Math.max(0, totalW - dayStartWords(totalW)); }
// v9.80.0 (AUD-08-004) : db.sessionStats[jour] est un TOTAL cumulé ; le graphique « mots par jour » doit tracer
// l'écart avec le dernier total connu avant ce jour (0 si le jour n'a pas d'entrée), et « aujourd'hui » via dayStart.
function dailyWordsSeries(n, totalW) {
  const stats = db.sessionStats || {}, keys = Object.keys(stats).sort(), out = [], today = getTodayKey();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); const key = dateKey(d);
    if (key === today && db.dayStart && db.dayStart.k === today && typeof totalW === 'number') { out.push(Math.max(0, totalW - db.dayStart.w)); continue; }
    if (typeof stats[key] !== 'number') { out.push(0); continue; }
    const prev = keys.filter(k => k < key).pop();
    out.push(Math.max(0, stats[key] - (prev !== undefined ? stats[prev] : 0)));
  }
  return out;
}
// v9.83.0 (AUD-08-017) : au changement de thème, les graphiques déjà tracés reprennent les couleurs du thème.
function refreshThemedCharts() {
  const c = chartPalette()[0];
  try {
    if (typeof sessionChart !== 'undefined' && sessionChart) { const d = sessionChart.data.datasets[0]; d.borderColor = c; d.backgroundColor = withAlpha(c, .5); sessionChart.update('none'); }
    if (typeof tensionChart !== 'undefined' && tensionChart) { const d = tensionChart.data.datasets[0]; d.borderColor = c; d.backgroundColor = withAlpha(c, .08); tensionChart.update('none'); }
  } catch (e) { /* purement cosmétique */ }
}
// v9.90.0 (AUD-10-014) : temps de saisie effectif de la séance (en mémoire, jamais enregistré). À chaque appel
// (chaque frappe), on ajoute l'écart avec l'appel précédent s'il est inférieur à 60 s ; une pause plus longue
// ne compte pas. Repart de zéro quand la séance change (sessionStartTime est réinitialisé à l'ouverture).
const ACTIVE_GAP_MAX_MS = 60000;
let _activeMs = 0, _activeLastTs = 0, _activeForStart = null;
function trackActiveTime(now) {
  if (_activeForStart !== sessionStartTime) { _activeForStart = sessionStartTime; _activeMs = 0; _activeLastTs = 0; }
  if (_activeLastTs && now - _activeLastTs < ACTIVE_GAP_MAX_MS) { const d = now - _activeLastTs; _activeMs += d; recordActiveSeconds(d); }
  _activeLastTs = now;
}
// v9.91.0 (AUD-10-004) : db.activeDays[jour] = secondes de saisie effective ce jour-là. Un jour passé à couper et
// reformuler (total de mots en baisse) est un vrai jour d'écriture : la série ne doit plus dépendre du gain net.
// Champ DÉRIVÉ (comme sessionStats) : exclu de l'arbitrage de synchro et de l'empreinte du Gist.
function recordActiveSeconds(deltaMs) {
  if (!db || !db.chapters) return;
  if (!db.activeDays) db.activeDays = {};
  const k = getTodayKey();
  db.activeDays[k] = Math.round(((db.activeDays[k] || 0) + deltaMs / 1000) * 10) / 10;
}
const ACTIVE_DAY_MIN_SECONDS = 60; // un jour compte comme « jour d'écriture » à partir d'une minute de saisie
function activeTypingMs() {
  if (_activeForStart !== sessionStartTime) return 0;
  return _activeMs;
}
function updateDailyStats() {
  // Garde db.chapters (v9.15.0) : undefined pour un roman graphique — cette
  // fonction est spécifique aux manuscrits texte, gnUpdateDailyStats()
  // (graphicnovel.js) est son équivalent pour l'autre docType.
  if (!db.chapters) return;
  const today = getTodayKey();
  const totalW = chaptersTotalWords(db.chapters);
  if (!db.sessionStats) db.sessionStats = {};
  db.sessionStats[today] = totalW;
  // v7.12.0 (Lot 9) : accumulation de l'activité par heure de la journée,
  // pour la statistique « meilleur moment d'écriture ». On compare au total
  // connu lors du dernier appel de CETTE session (pas au total d'une session
  // précédente) pour ne jamais attribuer les mots déjà écrits avant à
  // l'heure actuelle — voir trackHourlyActivity() ci-dessous.
  trackHourlyActivity(totalW);
  const todayW = wordsToday(totalW);
  const el_total = document.getElementById('total-words'), el_today = document.getElementById('today-words');
  if (el_total) el_total.innerText = totalW;
  if (el_today) el_today.innerText = todayW;
  const goal = db.dailyGoal || 500, pct = Math.min(100, Math.round(todayW/goal*100));
  ['goal-bar','sidebar-goal-bar'].forEach(id => { const el=document.getElementById(id); if(el) el.style.width=pct+'%'; });
  const lbl = document.getElementById('goal-label'); if (lbl) lbl.textContent = pct + ' %';
  // Correction (audit) : updateDailyStats() est appelée à CHAQUE frappe
  // (via liveCounter()) — sans ce garde-fou, le toast de célébration se
  // redéclenchait à chaque caractère tapé tant que l'objectif restait
  // dépassé. On ne félicite qu'une fois par jour (_goalCelebratedDay
  // mémorise la date, remis à zéro naturellement dès que le jour change).
  if (pct >= 100 && todayW > 0 && _goalCelebratedDay !== today) {
    _goalCelebratedDay = today;
    // v9.91.0 (AUD-10-005) : message factuel (ce qui est accompli, où en est la révision) au lieu d'un éloge vide.
    toast('Objectif atteint : ' + todayW + ' ' + plur(todayW, 'mot', 'mots') + ' aujourd\'hui.' + revisionSentence(),'success');
  }
  updateGoalsUI(totalW);
  updateEstimatedFinishDate();
}
let _goalCelebratedDay = null;

// ═══════════════════════════════════════════════════════
// OBJECTIFS HEBDOMADAIRE & MENSUEL (nouveau v6.2.0)
// db.sessionStats stocke le total cumulé de mots par jour ; on retrouve le
// nombre de mots écrits sur les N derniers jours en soustrayant le total
// enregistré juste avant le début de la période.
// ═══════════════════════════════════════════════════════
function getWordsInLastNDays(n, totalW) {
  // Correction v7.16.0 : le `cutoff.setHours(0,0,0,0)` (minuit LOCAL) suivi
  // d'un `.toISOString()` (qui convertit en UTC) décalait la clé d'un jour
  // pour tout fuseau horaire en avance sur UTC (Europe, Asie...), puisque
  // minuit local devient 22h/23h la veille en UTC. `getTodayKey()` et
  // `db.sessionStats` n'ont eux jamais zéro l'heure — cutoffKey doit rester
  // sur la même convention (voir aussi computeWritingStreak() ci-dessous).
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-n);
  const cutoffKey = dateKey(cutoff);
  const before = Object.entries(db.sessionStats||{}).filter(([k]) => k < cutoffKey).sort((a,b)=>b[0].localeCompare(a[0]));
  const baseline = before.length ? before[0][1] : 0;
  return Math.max(0, totalW - baseline);
}
function updateGoalsUI(totalW) {
  // Garde db.chapters (v9.15.0) : appelée sans argument (tabs.js), le repli
  // ci-dessous lisait db.chapters sans condition — undefined pour un roman
  // graphique.
  totalW = totalW ?? (db.chapters ? chaptersTotalWords(db.chapters) : 0);
  const weekW = getWordsInLastNDays(7, totalW), monthW = getWordsInLastNDays(30, totalW);
  const wGoal = db.weeklyGoal || 3000, mGoal = db.monthlyGoal || 12000;  const wPct = Math.min(100, Math.round(weekW/wGoal*100)), mPct = Math.min(100, Math.round(monthW/mGoal*100));
  const wBar = document.getElementById('week-goal-bar'); if (wBar) wBar.style.width = wPct+'%';
  const wLbl = document.getElementById('week-goal-label'); if (wLbl) wLbl.textContent = `${weekW} / ${wGoal} mots (${wPct}%)`;
  const mBar = document.getElementById('month-goal-bar'); if (mBar) mBar.style.width = mPct+'%';
  const mLbl = document.getElementById('month-goal-label'); if (mLbl) mLbl.textContent = `${monthW} / ${mGoal} mots (${mPct}%)`;
  renderGoalSuggestion(totalW);
  renderRevisionSummary();
}

// v9.91.0 (AUD-10-005) — objectifs calibrés sur le rythme réel, sans rien changer automatiquement.
// Médiane des mots écrits les jours d'écriture des 14 derniers jours (aujourd'hui exclu, journée incomplète), + 15 %,
// arrondie à 50. Moins de 3 jours d'écriture : pas de suggestion.
function median(arr) {
  const a = arr.slice().sort((x, y) => x - y), n = a.length;
  return n ? (n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : 0;
}
function suggestedDailyGoal(totalW) {
  const jours = dailyWordsSeries(15, totalW).slice(0, 14).filter(w => w > 0);
  if (jours.length < 3) return null;
  return Math.max(100, Math.round(median(jours) * 1.15 / 50) * 50);
}
function renderGoalSuggestion(totalW) {
  const row = document.getElementById('goal-suggestion');
  if (!row) return;
  const s = suggestedDailyGoal(totalW);
  const txt = document.getElementById('goal-suggestion-text'), btn = document.getElementById('goal-suggestion-apply');
  if (s === null || s === (db.dailyGoal || 500)) { row.hidden = true; return; }
  row.hidden = false;
  if (txt) txt.textContent = `Suggestion d'après vos 14 derniers jours : ${s} mots par jour.`;
  if (btn) btn.dataset.goal = String(s);
}
function applyGoalSuggestion() {
  const btn = document.getElementById('goal-suggestion-apply');
  const v = btn ? parseInt(btn.dataset.goal, 10) : NaN;
  if (!(v >= 1)) return;
  db.dailyGoal = v;
  const input = document.getElementById('daily-goal-input'); if (input) input.value = v;
  debouncedSave(); updateDailyStats();
}
// Avancement de la révision, calculé à partir des statuts existants (aucune donnée de plus).
function revisionCounts() {
  const chs = db.chapters || [];
  const c = { draft: 0, review: 0, final: 0, total: chs.length };
  chs.forEach(ch => { const s = ch.status === 'final' || ch.status === 'review' ? ch.status : 'draft'; c[s]++; });
  return c;
}
function revisionSentence() {
  const c = revisionCounts();
  if (c.total < 2) return '';
  return ` Révision : ${c.final} ${plur(c.final, 'chapitre', 'chapitres')} sur ${c.total} en Final.`;
}
function renderRevisionSummary() {
  const el = document.getElementById('revision-summary');
  if (!el || !db.chapters) return;
  const c = revisionCounts();
  el.textContent = `Révision : ${c.final} Final, ${c.review} À revoir, ${c.draft} Brouillon (${c.total} ${plur(c.total, 'chapitre', 'chapitres')}).`;
}

// v7.36.0 (ergonomie) — À partir de l'objectif de mots du manuscrit et du
// rythme réel des 7 derniers jours (déjà calculé par getWordsInLastNDays,
// utilisé par ailleurs pour l'objectif hebdomadaire), estime une date de
// fin réaliste. Purement indicatif : aucune donnée persistée.
function updateEstimatedFinishDate() {
  const el = document.getElementById('finish-date-estimate');
  if (!el) return;
  const goal = db.wordGoal || 0;
  if (!goal) { el.textContent = ''; return; }
  const totalW = chaptersTotalWords(db.chapters);
  const remaining = goal - totalW;
  if (remaining <= 0) { el.textContent = 'Objectif de mots déjà atteint !'; return; }
  // v9.91.0 (AUD-10-015) : une date unique tirée d'UNE semaine est trop optimiste (biais de planification). Fourchette
  // fondée sur les 30 derniers jours : quartiles des mots écrits les jours d'écriture, ramenés au rythme par jour
  // calendaire (part de jours d'écriture). Moins de 5 jours d'écriture : pas d'estimation.
  const jours = dailyWordsSeries(31, totalW).slice(0, 30).filter(w => w > 0);
  if (jours.length < 5) { el.textContent = `Il reste ${remaining} ${plur(remaining, 'mot', 'mots')} pour atteindre l'objectif (pas assez de jours d'écriture récents pour estimer une date : il en faut au moins 5 sur les 30 derniers).`; return; }
  const tri = jours.slice().sort((a, b) => a - b), part = jours.length / 30;
  const q = p => tri[Math.min(tri.length - 1, Math.floor(p * (tri.length - 1)))];
  const rapide = q(0.75) * part, lent = q(0.25) * part;
  const fmt = d => d.toLocaleDateString('fr', { day: 'numeric', month: 'long', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
  const dans = jr => { const d = new Date(); d.setDate(d.getDate() + Math.ceil(jr)); return d; };
  const tot = remaining / lent;
  if (tot > 1095) { el.textContent = 'À votre rythme récent, l\'objectif de mots dépasse trois ans (écriture seule, révision non incluse).'; return; }
  el.textContent = `Écriture terminée entre le ${fmt(dans(remaining / rapide))} et le ${fmt(dans(tot))} d'après les 30 derniers jours (révision non incluse).`;
}

// ═══════════════════════════════════════════════════════
// STATISTIQUES AVANCÉES (nouveau v7.12.0, Lot 9)
// Deux nouvelles mesures, affichées comme 2 cartes de plus dans le
// #stats-grid existant (même composant .stat-card, aucun nouveau style) :
//   - Série de jours consécutifs d'écriture (« streak »).
//   - Meilleur moment de la journée pour écrire (heure la plus productive).
// ═══════════════════════════════════════════════════════

// Accumule le nombre de mots écrits dans la tranche horaire courante.
// _lastHourlyWordCount n'est PAS persisté : à chaque rechargement de page,
// le premier appel sert uniquement de référence (aucun mot n'est attribué
// à l'heure actuelle), pour ne jamais compter les mots déjà écrits avant
// l'ouverture de cette session comme si l'utilisateur venait de les taper.
let _lastHourlyWordCount = null;
function trackHourlyActivity(totalW) {
  if (_lastHourlyWordCount === null) { _lastHourlyWordCount = totalW; return; }
  const delta = totalW - _lastHourlyWordCount;
  _lastHourlyWordCount = totalW;
  if (delta > 0) {
    if (!Array.isArray(db.hourlyActivity) || db.hourlyActivity.length !== 24) db.hourlyActivity = new Array(24).fill(0);
    db.hourlyActivity[new Date().getHours()] += delta;
  }
}

// Série de jours d'écriture (v9.91.0, AUD-10-004). Un jour compte s'il compte au moins une minute de saisie effective
// (db.activeDays) OU, pour les jours d'avant cette version, si le total de mots a progressé par rapport au jour précédent
// connu (règle historique : la série déjà acquise ne baisse jamais). Avant, SEULE la progression nette comptait : une
// journée à couper et reformuler (total en baisse) cassait la série, donc l'outil décourageait la révision. Un jour de
// répit est toléré : la série ne se rompt qu'après DEUX jours consécutifs sans écriture (Lally et al., 2010 : une
// occasion manquée isolée n'abîme pas une habitude). On part d'aujourd'hui ; un jour d'aujourd'hui encore vide ne
// compte pas comme manqué tant qu'hier est un jour d'écriture.
function isWritingDay(key, stats, active) {
  if ((active[key] || 0) >= ACTIVE_DAY_MIN_SECONDS) return true;
  if (!(key in stats)) return false;
  const prev = new Date(key + 'T12:00:00'); prev.setDate(prev.getDate() - 1);
  const prevKey = dateKey(prev);
  return stats[key] > ((prevKey in stats) ? stats[prevKey] : 0);
}
function computeWritingStreak() {
  const stats = db.sessionStats || {}, active = db.activeDays || {};
  // Correction v7.16.0 : getTodayKey()/dateKey() ne remettent jamais l'heure à zéro (pas de décalage UTC).
  let d = new Date();
  let streak = 0, manques = 0;
  for (let i = 0; i < 3650; i++) {
    if (isWritingDay(dateKey(d), stats, active)) { streak++; manques = 0; }
    else if (++manques >= 2) break;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

// Heure de la journée où le plus de mots ont été accumulés (toutes sessions
// confondues depuis que cette statistique existe). Retourne null tant qu'il
// n'y a pas encore assez de données (évite d'afficher "0h" par défaut).
function computeBestWritingHour() {
  const arr = db.hourlyActivity;
  if (!Array.isArray(arr) || !arr.some(v => v > 0)) return null;
  let bestHour = 0, bestVal = -1;
  arr.forEach((v,h) => { if (v > bestVal) { bestVal = v; bestHour = h; } });
  return bestHour;
}

function renderStats() {
  // Garde db.chapters (v9.15.0) : ce panneau est spécifique aux manuscrits texte.
  if (!db.chapters) return;
  const totalW=chaptersTotalWords(db.chapters);
  const todayW=wordsToday(totalW), sessionW=Math.max(0,totalW-sessionWordsStart), elapsed=Math.round((Date.now()-sessionStartTime)/60000);
  // v9.90.0 (AUD-10-014) : vitesse sur le temps de SAISIE effectif (voir trackActiveTime), plus sur le temps écoulé
  // depuis l'ouverture (pauses, lecture et onglet resté ouvert faussaient la valeur).
  const activeMin = activeTypingMs()/60000;
  // v9.91.0 (AUD-10-004) : « Aujourd'hui » en net SIGNÉ (une journée de coupes n'est plus affichée « 0 ») + minutes de saisie.
  const netToday = totalW - dayStartWords(totalW), minToday = Math.round(((db.activeDays || {})[getTodayKey()] || 0) / 60);
  const netLabel = (netToday > 0 ? '+' : netToday < 0 ? '−' : '') + Math.abs(netToday);
  const wpm=activeMin>=1?Math.round(sessionW/activeMin):0;
  const pct=Math.min(100,Math.round(todayW/(db.dailyGoal||500)*100));
  const streak = computeWritingStreak();
  const bestHour = computeBestWritingHour();
  const bestHourLabel = bestHour === null ? '—' : (bestHour.toString().padStart(2,'0') + 'h');
  document.getElementById('stats-grid').innerHTML=[
    {v:totalW,l:'Mots total'},{v:netLabel,l:"Aujourd'hui, net"+(minToday>0?' ('+minToday+' min de saisie)':'')},{v:wpm||'—',l:'Mots/min (saisie effective)'},
    {v:sessionW,l:'Cette séance ('+elapsed+' min)'},{v:pct+'%',l:'Objectif'},{v:db.chapters.length,l:'Chapitres'},
    {v:streak+(streak>1?' jours':' jour'),l:'Série en cours'},{v:bestHourLabel,l:'Meilleur moment'}
  ].map(s=>`<div class="stat-card"><div class="stat-val">${s.v}</div><div class="stat-label">${s.l}</div></div>`).join('');
  const days=[],counts=dailyWordsSeries(7,totalW);
  for(let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);days.push(d.toLocaleDateString('fr',{weekday:'short'}));}
  setChartAlt('sessionChart','Mots écrits par jour sur les 7 derniers jours',['Jour','Mots'],days.map((d,i)=>[d,counts[i]])); // AUD-05-008
  // v9.76.0 (AUD-07-004) : Chart.js est chargé à la demande.
  ensureLib('chart').then(ok=>{ if(!ok) return;
  if(sessionChart){sessionChart.data.labels=days;sessionChart.data.datasets[0].data=counts;sessionChart.update();}
  else{const ctx=document.getElementById('sessionChart').getContext('2d');sessionChart=new Chart(ctx,{type:'bar',data:{labels:days,datasets:[{label:'Mots',data:counts,backgroundColor:withAlpha(chartPalette()[0],.5),borderColor:chartPalette()[0],borderWidth:1}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}});}
  });
}

// ═══════════════════════════════════════════════════════
// SPRINT (Pomodoro d'écriture) — persistant depuis v6.0.0
// L'état du sprint (heure de fin + mots de départ) est sauvegardé dans `db`,
// ce qui permet de reprendre le compte à rebours après un rechargement de
// page ou une fermeture accidentelle de l'onglet.
// ═══════════════════════════════════════════════════════
// v9.91.0 (AUD-10-017) : durée au choix (15 / 25 / 45 min), préférence propre à l'APPAREIL (localStorage, comme les
// réglages de confort : aucun effet sur les données ni sur la synchro). La durée du sprint en cours est mémorisée
// dans db.sprint.minutes, pour la reprise après rechargement.
const SPRINT_MINUTES_CHOICES = [15, 25, 45];
const SPRINT_MINUTES_DEFAULT = 25;
function sprintMinutesPref() {
  try { const v = parseInt(localStorage.getItem('plume_sprint_min'), 10); if (SPRINT_MINUTES_CHOICES.includes(v)) return v; } catch (e) { /* stockage indisponible */ }
  return SPRINT_MINUTES_DEFAULT;
}
function setSprintMinutesPref(v) {
  v = parseInt(v, 10);
  if (!SPRINT_MINUTES_CHOICES.includes(v)) return;
  try { localStorage.setItem('plume_sprint_min', String(v)); } catch (e) { /* sans conséquence */ }
  applySprintDurationUI();
}
function applySprintDurationUI() {
  const sel = document.getElementById('sprint-duration-sel');
  const m = db.sprint ? (db.sprint.minutes || SPRINT_MINUTES_DEFAULT) : sprintMinutesPref();
  if (sel) { sel.value = String(m); sel.disabled = !!db.sprint; }
  const t = document.getElementById('sprint-timer');
  if (t && !db.sprint) t.innerText = fmtSprintTime(m * 60);
}

// v9.46.0 (AUD-03-013) : pastille « ⏱ 18:42 · +230 mots » dans le pied de page pendant un sprint (avant : le chronomètre
// n'existait que dans Config → Sprint, donc invisible quand on écrit) ; la fin du sprint est annoncée (avant : remise à
// zéro silencieuse).
function fmtSprintTime(remaining) { return Math.floor(remaining/60)+':'+(remaining%60).toString().padStart(2,'0'); }
function updateSprintChip(remaining, words) {
  const chip = document.getElementById('sprint-chip');
  if (!chip) return;
  chip.hidden = false;
  document.getElementById('sprint-chip-time').textContent = fmtSprintTime(remaining);
  document.getElementById('sprint-chip-words').textContent = (words >= 0 ? '+' : '') + words;
}
function hideSprintChip() { const chip = document.getElementById('sprint-chip'); if (chip) chip.hidden = true; }

function startSprint() {
  if (sprintInterval) return;
  sprintWordsStart = getWordCount(document.getElementById('writer').innerText);
  const minutes = sprintMinutesPref();
  db.sprint = { endTime: Date.now() + minutes * 60000, wordsStart: sprintWordsStart, minutes };
  save();
  updateSprintChip(minutes * 60, 0);
  runSprintTick();
  applySprintDurationUI();
  toast('Sprint de ' + minutes + ' minutes lancé.', 'info');
}

function runSprintTick() {
  clearInterval(sprintInterval);
  const tick = () => {
    if (!db.sprint) { resetSprint(); return; }
    const remaining = Math.max(0, Math.round((db.sprint.endTime - Date.now()) / 1000));
    const words = getWordCount(document.getElementById('writer').innerText) - db.sprint.wordsStart;
    document.getElementById('sprint-timer').innerText = fmtSprintTime(remaining);
    document.getElementById('sprint-progress').innerText = words;
    updateSprintChip(remaining, words);
    if (remaining <= 0) {
      const minutes = db.sprint.minutes || SPRINT_MINUTES_DEFAULT;
      resetSprint();
      toast('Sprint terminé : ' + (words >= 0 ? '+' : '') + words + ' mots en ' + minutes + ' minutes.', 'success', { sticky: true, kind: 'sprint' });
    }
  };
  sprintInterval = setInterval(tick, 1000);
  tick();
}

function resetSprint() {
  clearInterval(sprintInterval); sprintInterval = null;
  db.sprint = null; save();
  document.getElementById('sprint-progress').innerText = '0';
  applySprintDurationUI();
  hideSprintChip();
}

// Appelée une fois au démarrage de l'app (voir router.js) : reprend un
// sprint encore en cours, ou nettoie silencieusement un sprint expiré.
function resumeSprintIfNeeded() {
  applySprintDurationUI();
  if (!db.sprint) return;
  if (db.sprint.endTime <= Date.now()) { db.sprint = null; save(); hideSprintChip(); toast('Votre sprint d\'écriture est terminé.', 'info'); return; }
  sprintWordsStart = db.sprint.wordsStart;
  runSprintTick();
  toast('Sprint d\'écriture repris.', 'info');
}
