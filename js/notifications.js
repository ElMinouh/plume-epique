'use strict';
function toast(msg, type='info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.borderLeftColor = type==='success'?'#27ae60':type==='error'?'#e74c3c':'#8e44ad';
  el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3200);
}
function flashSave() {
  const ind = document.getElementById('save-indicator'), lbl = document.getElementById('autosave-label');
  if (ind) { ind.style.opacity=1; setTimeout(()=>ind.style.opacity=0, 700); }
  if (lbl) lbl.textContent = 'Sauvegardé ' + new Date().toLocaleTimeString('fr',{hour:'2-digit',minute:'2-digit'});
}
function showAiLoader(id) { document.getElementById(id).innerHTML = '<div class="ai-loader"><div class="ai-dot"></div><div class="ai-dot"></div><div class="ai-dot"></div></div>'; }
