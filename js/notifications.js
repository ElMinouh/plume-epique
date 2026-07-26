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
// BASCULE AFFICHER/MASQUER MOT DE PASSE (v7.40.0)
// Jusqu'ici aucun champ mot de passe/clé n'était consultable en cours de
// saisie — la moindre faute de frappe (mot de passe, clé de synchro, code
// de récupération...) n'était détectable qu'après coup. Emoji 👁️/🙈 pour
// rester cohérent avec le lexique d'icônes existant (audit v7.38.0), pas de
// nouvelle police d'icônes. Enveloppe l'input existant dans un conteneur
// (.pwd-toggle-wrap, voir style.css) sans toucher à son id ni ses classes —
// donc sans impact sur le code qui lit sa valeur ailleurs. Idempotent via
// dataset.pwdToggleInit : sans effet si l'input a déjà sa bascule (utile
// pour les champs statiques initialisés une seule fois au chargement).
// ═══════════════════════════════════════════════════════
function initPasswordToggle(inputId) {
  const input = document.getElementById(inputId);
  if (!input || input.dataset.pwdToggleInit) return;
  input.dataset.pwdToggleInit = '1';
  const wrap = document.createElement('span');
  wrap.className = 'pwd-toggle-wrap';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pwd-toggle-btn';
  btn.textContent = '👁️';
  btn.title = 'Afficher';
  btn.setAttribute('aria-label', 'Afficher le mot de passe');
  btn.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? '🙈' : '👁️';
    btn.title = show ? 'Masquer' : 'Afficher';
    btn.setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
  });
  wrap.appendChild(btn);
}

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

// ═══════════════════════════════════════════════════════
// PARCOURS "PREMIERS PAS" (nouveau v7.36.0, ergonomie)
// 4 bulles pointant sidebar chapitres / barre d'outils / bandeau du bas /
// onglets — montrées une seule fois par profil (profil.onboardingDone),
// à la première ouverture d'un manuscrit. "Passer" disponible à tout moment.
// ═══════════════════════════════════════════════════════
const ONBOARDING_STEPS = [
  { target:'#chapter-sidebar', text:'Vos chapitres apparaissent ici. Glissez-les pour les réordonner, ou passez en vue Fiches.' },
  { target:'.toolbar', text:'La barre d\'outils : mise en forme, recherche, et l\'assistant IA (menu 🤖 IA).' },
  { target:'#mode-bar', text:'Ce bandeau reste toujours visible : état d\'enregistrement, dictée, chat IA, thème.' },
  { target:'#tab-menu', text:'Tout le reste — personnages, statistiques, réglages — se trouve dans ces onglets.' }
];
let _onboardingStep = 0;
// v7.40.0 — Corrige un bug rapporté : lancer la visite guidée complète
// (launchEditorFullTour(), fulltour.js) ouvre un manuscrit, ce qui déclenche
// aussi ce parcours "premiers pas" s'il n'a jamais été vu (1ère installation)
// — les deux visites tournaient alors en même temps, et l'utilisateur ne
// voyait que ces 4 bulles à la place des 29 étapes attendues. fulltour.js
// arme ce drapeau juste avant d'ouvrir le manuscrit pour SA visite à lui ;
// il ne désactive ce parcours qu'une seule fois (pas onboardingDone, qui
// reste intact pour une prochaine ouverture normale d'un manuscrit).
let _suppressOnboardingOnce = false;
async function maybeStartOnboardingTour() {
  if (_suppressOnboardingOnce) { _suppressOnboardingOnce = false; return; }
  try {
    const idx = await loadProfilesIndex();
    const profil = idx && idx.profiles && idx.profiles.find(p => p.id === _currentProfileId);
    if (profil && !profil.onboardingDone) startOnboardingTour();
  } catch(e) { /* ne bloque jamais l'ouverture du manuscrit */ }
}
function startOnboardingTour() {
  _onboardingStep = 0;
  document.getElementById('onboarding-tour-bubble').classList.add('active');
  showOnboardingStep();
}
function showOnboardingStep() {
  const step = ONBOARDING_STEPS[_onboardingStep];
  const bubble = document.getElementById('onboarding-tour-bubble');
  const target = document.querySelector(step.target);
  document.getElementById('onboarding-tour-text').textContent = step.text;
  document.getElementById('onboarding-tour-counter').textContent = `${_onboardingStep+1} / ${ONBOARDING_STEPS.length}`;
  document.getElementById('onboarding-tour-next-btn').textContent = _onboardingStep === ONBOARDING_STEPS.length-1 ? 'Terminer' : 'Suivant';
  if (target) {
    const r = target.getBoundingClientRect();
    bubble.style.top = Math.max(10, Math.min(window.innerHeight-160, r.top)) + 'px';
    bubble.style.left = Math.max(10, Math.min(window.innerWidth-280, r.right + 12)) + 'px';
  }
}
function onboardingNext() {
  _onboardingStep++;
  if (_onboardingStep >= ONBOARDING_STEPS.length) { endOnboardingTour(); return; }
  showOnboardingStep();
}
async function endOnboardingTour() {
  document.getElementById('onboarding-tour-bubble').classList.remove('active');
  try {
    const idx = await loadProfilesIndex();
    const profil = idx && idx.profiles && idx.profiles.find(p => p.id === _currentProfileId);
    if (profil) { profil.onboardingDone = true; await saveProfilesIndex(idx); }
  } catch(e) { /* best effort */ }
}

// ═══════════════════════════════════════════════════════
// MODALE DE CONFIRMATION STYLÉE (nouveau v7.36.0, ergonomie)
// Remplace confirm()/prompt() natifs du navigateur pour les suppressions
// définitives (manuscrit, profil, personnage/lieu) — cohérent visuellement
// avec le reste de l'app. requireText, si fourni, exige de retaper le texte
// exact avant d'activer le bouton de confirmation (même garde-fou qu'avant,
// juste sans la fenêtre grise du navigateur).
// Usage : const ok = await showConfirmModal({ title, message, confirmLabel,
//   danger:true, requireText:'Nom exact' }); if (!ok) return;
// ═══════════════════════════════════════════════════════
function showConfirmModal({ title, message, confirmLabel, danger, requireText } = {}) {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirm-modal-overlay');
    document.getElementById('confirm-modal-title').textContent = title || 'Confirmer';
    document.getElementById('confirm-modal-message').textContent = message || '';
    const confirmBtn = document.getElementById('confirm-modal-confirm-btn');
    confirmBtn.textContent = confirmLabel || 'Confirmer';
    confirmBtn.classList.toggle('u-bg-v-danger', !!danger);
    const inputWrap = document.getElementById('confirm-modal-input-wrap');
    const input = document.getElementById('confirm-modal-input');
    input.value = '';
    if (requireText) {
      inputWrap.classList.remove('u-d-none');
      document.getElementById('confirm-modal-input-label').textContent = `Tapez « ${requireText} » pour confirmer :`;
      confirmBtn.disabled = true;
      input.oninput = () => { confirmBtn.disabled = input.value.trim().toLowerCase() !== requireText.trim().toLowerCase(); };
    } else {
      inputWrap.classList.add('u-d-none');
      confirmBtn.disabled = false;
      input.oninput = null;
    }
    const cleanup = (result) => { overlay.classList.remove('active'); input.oninput = null; resolve(result); };
    document.getElementById('confirm-modal-cancel-btn').onclick = () => cleanup(false);
    confirmBtn.onclick = () => cleanup(true);
    overlay.onclick = (e) => { if (e.target === overlay) cleanup(false); };
    overlay.classList.add('active');
    (requireText ? input : confirmBtn).focus();
  });
}
