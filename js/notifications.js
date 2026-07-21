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
  if (lbl) lbl.textContent = 'Enregistré à ' + new Date().toLocaleTimeString('fr',{hour:'2-digit',minute:'2-digit'});
}
function showAiLoader(id) { document.getElementById(id).innerHTML = '<div class="ai-loader"><div class="ai-dot"></div><div class="ai-dot"></div><div class="ai-dot"></div></div>'; }

// ═══════════════════════════════════════════════════════
// CORBEILLE — badge du nombre de chapitres en attente (v7.5.0)
// Appelée depuis initApp() et depuis chaque mutation de db.trash (editor.js).
// ═══════════════════════════════════════════════════════
function updateTrashBadge() {
  const b = document.getElementById('trash-badge');
  if (!b) return;
  const n = (db.trash || []).length;
  b.textContent = n > 99 ? '99+' : (n || '');
  b.style.display = n > 0 ? 'flex' : 'none';
}

// ═══════════════════════════════════════════════════════
// AIDE-MÉMOIRE DES RACCOURCIS CLAVIER (v7.5.0)
// Ouverture via la touche "?" (voir router.js) ou le petit bouton ❔ du
// bandeau du bas.
// ═══════════════════════════════════════════════════════
function openShortcutsHelp() { document.getElementById('shortcuts-overlay').classList.add('active'); }
function closeShortcutsHelp() { document.getElementById('shortcuts-overlay').classList.remove('active'); }
