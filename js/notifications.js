'use strict';
// v9.42.0 (AUD-03-019) : avant, durée fixe de 3,2 s pour tout, minuteur jamais annulé (un message
// récent était coupé par le minuteur du précédent), pas de fermeture manuelle — y compris pour
// « Échec de la sauvegarde ». Désormais : info 4 s, succès 3 s, erreur 8 s ; ✕ pour les erreurs ;
// pause au survol ; minuteur annulé à chaque nouveau message ; opts.sticky = reste jusqu'au ✕
// (échec d'enregistrement, conflit de synchro, stockage plein) ; opts.kind identifie le message
// (l'échec d'enregistrement est retiré tout seul au premier enregistrement réussi).
// ═══════════════════════════════════════════════════════
// TAILLE DE L'INTERFACE (v9.43.0, audit AUD-03-004)
// Normale / Grande / Très grande = 100 / 112 / 125 % de la taille racine (tout ce qui est en rem suit).
// Stocké dans localStorage (préférence d'affichage de CET appareil ; le lot « thème au niveau du profil »
// la déplacera avec le thème) et appliqué dès le chargement, avant toute connexion.
// ═══════════════════════════════════════════════════════
const UI_SCALES = { normal: 100, grand: 112, 'tres-grand': 125 };
function loadUiScale() { try { const k = localStorage.getItem('plume_ui_scale'); return UI_SCALES[k] ? k : 'normal'; } catch (e) { return 'normal'; } }
function applyUiScale(key) { const pct = UI_SCALES[key] || 100; document.documentElement.style.fontSize = pct === 100 ? '' : pct + '%'; }
function renderUiScaleUI() {
  renderComfortUI();
  const cur = loadUiScale(); document.querySelectorAll('#uiscale-picker .mode-indicator').forEach(b => b.classList.toggle('active', b.dataset.scale === cur));
  const w = loadTextWidth(); document.querySelectorAll('#textwidth-picker .mode-indicator').forEach(b => b.classList.toggle('active', b.dataset.width === w));
}
// v9.47.0 (AUD-03-012) : largeur du texte (étroite 36 rem / normale 44 rem ≈ 72 caractères / large 56 rem / pleine) ; par appareil.
const TEXT_WIDTHS = { etroite: 1, normale: 1, large: 1, pleine: 1 };
function loadTextWidth() { try { const k = localStorage.getItem('plume_text_width'); return TEXT_WIDTHS[k] ? k : 'normale'; } catch (e) { return 'normale'; } }
function applyTextWidth(key) { document.documentElement.dataset.textWidth = TEXT_WIDTHS[key] ? key : 'normale'; }
function selectTextWidth(key) { try { localStorage.setItem('plume_text_width', key); } catch (e) { /* réglage valable pour cette session seulement */ } applyTextWidth(key); renderUiScaleUI(); }
applyTextWidth(loadTextWidth());
function selectUiScale(key) { try { localStorage.setItem('plume_ui_scale', key); } catch (e) { /* stockage indisponible : réglage valable pour cette session seulement */ } applyUiScale(key); renderUiScaleUI(); }
applyUiScale(loadUiScale());

// v9.63.0 (AUD-05-014) — confort de lecture, par appareil (comme la taille et la largeur) : interligne, espacement lettres/mots,
// correction orthographique du navigateur (désactivée par défaut : elle souligne les noms propres d'un roman ; un auteur dyslexique
// peut la réactiver — le texte reste dans le navigateur, rien n'est envoyé à un service externe).
const COMFORT = {
  lineheight: { key: 'plume_line_height', vals: ['normal', 'confortable', 'large'], def: 'normal', picker: '#lineheight-picker' },
  spacing:    { key: 'plume_spacing',     vals: ['normal', 'large'],                 def: 'normal', picker: '#spacing-picker' },
  spell:      { key: 'plume_spellcheck',  vals: ['off', 'on'],                       def: 'off',    picker: '#spellcheck-picker' }
};
function loadComfort(name) { const c = COMFORT[name]; try { const v = localStorage.getItem(c.key); return c.vals.includes(v) ? v : c.def; } catch (e) { return c.def; } }
function applyComfort(name, v) {
  if (name === 'spell') {
    ['writer', 'focus-writer', 'chapter-title'].forEach(id => { const el = document.getElementById(id); if (el) el.spellcheck = v === 'on'; });
    document.documentElement.dataset.spell = v;
  } else document.documentElement.dataset[name] = v;
}
function renderComfortUI() {
  Object.keys(COMFORT).forEach(name => { const cur = loadComfort(name); document.querySelectorAll(COMFORT[name].picker + ' .mode-indicator').forEach(b => b.classList.toggle('active', b.dataset.value === cur)); });
}
function selectComfort(name, v) {
  if (!COMFORT[name] || !COMFORT[name].vals.includes(v)) return;
  try { localStorage.setItem(COMFORT[name].key, v); } catch (e) { /* réglage valable pour cette session seulement */ }
  applyComfort(name, v); renderComfortUI();
}
Object.keys(COMFORT).forEach(name => applyComfort(name, loadComfort(name)));

let _toastTimer = null;
function hideToast() {
  const el = document.getElementById('toast');
  clearTimeout(_toastTimer); _toastTimer = null;
  el.classList.remove('show', 'has-close'); delete el.dataset.kind;
}
function toast(msg, type='info', opts={}) {
  const el = document.getElementById('toast');
  clearTimeout(_toastTimer); _toastTimer = null;
  el.textContent = msg;
  // v9.52.0 : une icône par type de message (succès / erreur / information) — le texte (textContent) reste celui du message.
  el.insertAdjacentHTML('afterbegin', icon(type === 'success' ? 'circle-check' : type === 'error' ? 'circle-alert' : 'info', 'toast-icon'));
  // v9.56.0 (AUD-04-025) : la couleur du liseré vient du CSS (#toast[data-type]) — jetons, plus de teinte figée.
  el.dataset.type = type;
  const closable = type === 'error' || !!opts.sticky;
  el.classList.toggle('has-close', closable);
  if (opts.kind) el.dataset.kind = opts.kind; else delete el.dataset.kind;
  if (closable) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'toast-close'; btn.innerHTML = icon('x');
    btn.setAttribute('aria-label', 'Fermer ce message'); btn.title = 'Fermer ce message';
    btn.addEventListener('click', hideToast);
    el.appendChild(btn);
  }
  el.classList.add('show');
  if (opts.sticky) { el.onmouseenter = el.onmouseleave = el.onfocusin = el.onfocusout = null; return; }
  const ms = type === 'error' ? 8000 : type === 'success' ? 3000 : 4000;
  const arm = () => { clearTimeout(_toastTimer); _toastTimer = setTimeout(hideToast, ms); };
  // v9.58.0 (AUD-05-016) : pause aussi quand le focus clavier est dans le message (le temps de le lire).
  el.onmouseenter = () => { clearTimeout(_toastTimer); };
  el.onmouseleave = arm;
  el.onfocusin = () => { clearTimeout(_toastTimer); };
  el.onfocusout = arm;
  arm();
}
// v9.42.0 (AUD-03-019) : état d'échec d'enregistrement PERMANENT dans le pied de page, jusqu'au
// prochain enregistrement réussi (avant : « Enregistré à 10:18 » restait affiché après l'échec).
let _saveFailedSince = null;
function markSaveFailed() {
  const lbl = document.getElementById('autosave-label');
  if (!_saveFailedSince) _saveFailedSince = new Date();
  if (lbl) {
    lbl.textContent = 'Non enregistré depuis ' + _saveFailedSince.toLocaleTimeString('fr',{hour:'2-digit',minute:'2-digit'});
    lbl.classList.add('save-failed');
  }
}
function flashSave() {
  const ind = document.getElementById('save-indicator'), lbl = document.getElementById('autosave-label');
  if (ind) { ind.style.opacity=1; setTimeout(()=>ind.style.opacity=0, 700); }
  if (lbl) { lbl.classList.remove('save-failed'); lbl.textContent = 'Enregistré à ' + new Date().toLocaleTimeString('fr',{hour:'2-digit',minute:'2-digit'}); }
  if (_saveFailedSince) {
    _saveFailedSince = null;
    if (document.getElementById('toast').dataset.kind === 'save') hideToast();
  }
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
  btn.innerHTML = icon('eye');
  btn.title = 'Afficher';
  btn.setAttribute('aria-label', 'Afficher le mot de passe');
  btn.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.innerHTML = show ? icon('eye-off') : icon('eye');
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
// v9.68.0 (audit AUD-06-015) — page « Confidentialité » (texte dans index.html, #privacy-overlay).
function openPrivacyPolicy() { closeShortcutsHelp(); document.getElementById('privacy-overlay').classList.add('active'); }
function closePrivacyPolicy() { document.getElementById('privacy-overlay').classList.remove('active'); }

// ═══════════════════════════════════════════════════════
// PARCOURS "PREMIERS PAS" (nouveau v7.36.0, ergonomie)
// 4 bulles pointant sidebar chapitres / barre d'outils / bandeau du bas /
// onglets — montrées une seule fois par profil (profil.onboardingDone),
// à la première ouverture d'un manuscrit. "Passer" disponible à tout moment.
// ═══════════════════════════════════════════════════════
const ONBOARDING_STEPS = [
  { target:'#chapter-sidebar', text:'Vos chapitres apparaissent ici. Glissez-les pour les réordonner, ou passez en vue Fiches.' },
  { target:'.toolbar', text:'La barre d\'outils : mise en forme, structure, mode Focus, recherche et dictionnaire. L\'assistant IA est dans le bandeau du bas (« IA »).' },
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
function showConfirmModal({ title, message, confirmLabel, cancelLabel, danger, requireText } = {}) {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirm-modal-overlay');
    document.getElementById('confirm-modal-title').textContent = title || 'Confirmer';
    document.getElementById('confirm-modal-message').textContent = message || '';
    const confirmBtn = document.getElementById('confirm-modal-confirm-btn');
    confirmBtn.textContent = confirmLabel || 'Confirmer';
    confirmBtn.classList.toggle('btn-danger', !!danger);
    const inputWrap = document.getElementById('confirm-modal-input-wrap');
    const input = document.getElementById('confirm-modal-input');
    input.value = ''; input.onkeydown = null;
    document.getElementById('confirm-modal-cancel-btn').classList.remove('u-d-none');
    document.getElementById('confirm-modal-cancel-btn').textContent = cancelLabel || 'Annuler'; // v9.68.0 : « Refuser » pour un consentement
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
    // v9.42.0 (AUD-03-018) : pour une action destructrice, le focus va sur « Annuler » (Entrée ne supprime plus).
    (requireText ? input : (danger ? document.getElementById('confirm-modal-cancel-btn') : confirmBtn)).focus();
  });
}


// ═══════════════════════════════════════════════════════
// SAISIE ET NOTICE DANS LA MÊME FENÊTRE QUE LES CONFIRMATIONS (v9.44.0, audit AUD-03-017)
// Remplacent prompt() et alert() du navigateur (boîte grise, boutons « OK/Annuler », texte non relisible).
//   const txt = await showPromptModal({ title, message, label, value, confirmLabel }); // string, ou null si annulé
//   await showInfoModal({ title, message, confirmLabel });                              // notice, un seul bouton
// Échap (escapeArbiter, router.js) clique sur « Annuler » : la promesse se résout dans les deux cas.
// ═══════════════════════════════════════════════════════
function showPromptModal({ title, message, label, value, confirmLabel } = {}) {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirm-modal-overlay');
    const input = document.getElementById('confirm-modal-input');
    const confirmBtn = document.getElementById('confirm-modal-confirm-btn');
    const cancelBtn = document.getElementById('confirm-modal-cancel-btn');
    document.getElementById('confirm-modal-title').textContent = title || 'Saisie';
    document.getElementById('confirm-modal-message').textContent = message || '';
    document.getElementById('confirm-modal-input-wrap').classList.remove('u-d-none');
    document.getElementById('confirm-modal-input-label').textContent = label || '';
    input.oninput = null; input.value = value || '';
    confirmBtn.textContent = confirmLabel || 'Enregistrer';
    confirmBtn.classList.remove('btn-danger'); confirmBtn.disabled = false;
    cancelBtn.classList.remove('u-d-none'); cancelBtn.textContent = 'Annuler';
    const cleanup = r => { overlay.classList.remove('active'); input.onkeydown = null; resolve(r); };
    cancelBtn.onclick = () => cleanup(null);
    confirmBtn.onclick = () => cleanup(input.value);
    input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); cleanup(input.value); } };
    overlay.onclick = e => { if (e.target === overlay) cleanup(null); };
    overlay.classList.add('active');
    input.focus(); input.select();
  });
}
function showInfoModal({ title, message, confirmLabel } = {}) {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirm-modal-overlay');
    const confirmBtn = document.getElementById('confirm-modal-confirm-btn');
    const cancelBtn = document.getElementById('confirm-modal-cancel-btn');
    const input = document.getElementById('confirm-modal-input');
    document.getElementById('confirm-modal-title').textContent = title || 'Information';
    document.getElementById('confirm-modal-message').textContent = message || '';
    document.getElementById('confirm-modal-input-wrap').classList.add('u-d-none');
    input.oninput = null; input.onkeydown = null;
    confirmBtn.textContent = confirmLabel || 'J\'ai compris';
    confirmBtn.classList.remove('btn-danger'); confirmBtn.disabled = false;
    cancelBtn.classList.add('u-d-none');
    const cleanup = () => { overlay.classList.remove('active'); cancelBtn.classList.remove('u-d-none'); resolve(true); };
    confirmBtn.onclick = cleanup; cancelBtn.onclick = cleanup;
    overlay.onclick = e => { if (e.target === overlay) cleanup(); };
    overlay.classList.add('active');
    confirmBtn.focus();
  });
}


// ═══════════════════════════════════════════════════════
// APPARENCE PAR PROFIL ET PAR APPAREIL (v9.48.0, audit AUD-03-022)
// Avant : thème, palette et police étaient stockés DANS chaque manuscrit — la bibliothèque prenait l'apparence du dernier
// manuscrit chargé, un nouveau manuscrit repartait d'un défaut, le réglage clair/sombre du système était ignoré.
// Désormais : préférences locales (localStorage, clé par profil), appliquées dès la connexion. Volontairement NON
// synchronisées : ne pas toucher au format de l'index des profils (incident du 27/07/2026).
// Sans préférence : réglage clair/sombre du système ; à la première ouverture d'un manuscrit existant, ses réglages
// actuels sont repris et mémorisés (aucun changement visible, aucune perte).
// ═══════════════════════════════════════════════════════
function appearancePrefsKey() { return 'plume_prefs_' + (typeof _currentProfileId !== 'undefined' && _currentProfileId ? _currentProfileId : ''); }
function loadAppearancePrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(appearancePrefsKey()) || 'null');
    if (!p || typeof p !== 'object') return null;
    // v9.53.0 (AUD-04-001) : « Rouge & Violet » était la palette PAR DÉFAUT ; la nouvelle (« Marine & Or », couleurs du logo) la remplace
    // une seule fois. On ne peut pas distinguer « jamais changé » de « choisi », d'où le drapeau : après cette bascule, un choix
    // explicite de « Rouge & Violet » est respecté.
    if (p.palette === 'rouge-violet' && !p.paletteDefault953) {
      p.palette = 'marine-or'; p.paletteDefault953 = 1;
      try { localStorage.setItem(appearancePrefsKey(), JSON.stringify(p)); } catch (e) { /* appliqué pour cette session */ }
    }
    // v9.54.0 (AUD-04-016) : même principe pour la police d'écriture (Palatino était le défaut, Literata le remplace une fois).
    if (p.font === 'palatino' && !p.fontDefault954) {
      p.font = 'literata'; p.fontDefault954 = 1;
      try { localStorage.setItem(appearancePrefsKey(), JSON.stringify(p)); } catch (e) { /* appliqué pour cette session */ }
    }
    return p;
  }
  catch (e) { return null; }
}
function rememberAppearance(part) {
  try { const p = loadAppearancePrefs() || {}; Object.assign(p, part); localStorage.setItem(appearancePrefsKey(), JSON.stringify(p)); }
  catch (e) { /* préférence valable pour cette session seulement */ }
}
function systemThemeKey() {
  try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (e) { return 'light'; }
}
// v9.54.0 (AUD-04-015) : un changement de thème suspend toutes les transitions pendant une image (classe .theme-switching), pour que
// fonds, textes et bordures basculent ensemble au lieu de laisser des libellés pâles à mi-chemin.
function runThemeSwitch(fn) {
  const b = document.body;
  b.classList.add('theme-switching');
  try { fn(); }
  finally {
    if (typeof updateThemeToggleLabel === 'function') updateThemeToggleLabel(); // v9.81.0 (AUD-08-011)
    void b.offsetWidth;
    const done = () => b.classList.remove('theme-switching');
    // deux images (les changements de style sont alors appliqués), avec un filet de sécurité si l'onglet est en arrière-plan (rAF suspendu)
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(done));
    setTimeout(done, 150);
  }
}
function applyThemeKey(k) {
  runThemeSwitch(() => {
    document.body.classList.toggle('dark-mode', k === 'dark');
    document.body.classList.toggle('paper-mode', k === 'paper');
  });
}
// Connexion / bibliothèque : appliquer les préférences du profil (ou le système).
function applyProfileAppearance() {
  const p = loadAppearancePrefs();
  applyThemeKey((p && p.theme) || systemThemeKey());
  if (p && p.palette && typeof applyAccentPalette === 'function') applyAccentPalette(p.palette);
  if (p && p.font && typeof applyEditorFont === 'function') applyEditorFont(p.font);
}
// Ouverture d'un manuscrit : les préférences du profil l'emportent sur ce qui est stocké dans le manuscrit.
function syncDbAppearanceFromPrefs() {
  const p = loadAppearancePrefs();
  if (p && p.theme) {
    db.darkMode = p.theme === 'dark'; db.paperMode = p.theme === 'paper';
    if (p.palette) db.accentPalette = p.palette;
    if (p.font) db.editorFont = p.font;
    return;
  }
  rememberAppearance({ theme: db.paperMode ? 'paper' : (db.darkMode ? 'dark' : 'light'), palette: db.accentPalette || 'marine-or', font: db.editorFont || 'literata' });
}

// v9.53.0 (AUD-04-001) — la couleur de la barre d'état / du navigateur suit le thème actif (ivoire en clair, papier, marine nuit).
function syncThemeColorMeta() {
  const m = document.querySelector('meta[name="theme-color"]');
  if (!m || !document.body) return;
  const c = document.body.classList.contains('dark-mode') ? '#141b26' : document.body.classList.contains('paper-mode') ? '#e9dfc6' : '#efe9dc';
  m.setAttribute('content', c);
}
if (typeof MutationObserver === 'function' && document.body) {
  new MutationObserver(syncThemeColorMeta).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  syncThemeColorMeta();
}

// ── FENÊTRES MODALES (début) ───────────────────────────────────────────
// v9.58.0 (AUD-05-003 / 004) — gestion CENTRALE de toutes les fenêtres role="dialog" aria-modal="true" :
//  · à la fermeture, le focus revient à l'élément qui avait déclenché l'ouverture (avant : il retombait sur <body>,
//    l'utilisateur clavier ou lecteur d'écran repartait du début de la page) ;
//  · tant qu'une fenêtre est ouverte, le reste de la page est inerte (`inert`) : ni Tab, ni lecteur d'écran n'y accèdent.
// Pourquoi central : une vingtaine de fenêtres s'ouvrent/ferment chacune par leur propre code (classe .active, style.display) ;
// les observer d'un seul endroit couvre les existantes ET les futures sans les modifier. Les fenêtres du roman graphique
// (.gn-modal-overlay) gèrent déjà leur focus (gnWireModalA11y) et sont ignorées ici.
// Piège évité : au moment où l'observateur s'exécute, le focus est DÉJÀ dans la fenêtre (et les événements « focus » ne
// partent pas si la page n'a pas le focus système) ; l'ouvreur est donc la dernière cible d'une action de l'utilisateur
// (touche ou clic, en capture), pas document.activeElement.
const _modalOpeners = new Map();   // fenêtre → élément déclencheur
const _modalStack = [];            // ordre d'ouverture : la dernière est au premier plan
let _modalTrigger = null, _modalTriggerAt = 0;
const _MODAL_TRIGGER_SEL = 'button,a[href],input,select,textarea,summary,[tabindex],[role="button"],[role="menuitem"],[role="tab"]';
function _modalMark(e) {
  const t = e.target;
  if (!t || t.nodeType !== 1) return;
  _modalTrigger = t.closest(_MODAL_TRIGGER_SEL) || t; _modalTriggerAt = Date.now();
}
function _modalVisible(d) { return d.getClientRects().length > 0; }
function _modalApplyInert() {
  document.querySelectorAll('[data-modal-inert]').forEach(el => { el.inert = false; el.removeAttribute('data-modal-inert'); });
  const top = _modalStack[_modalStack.length - 1];
  if (!top) return;
  // on rend inertes les frères de chaque ancêtre de la fenêtre au premier plan (sauf le message temporaire, qui a un bouton ✕)
  for (let node = top; node && node !== document.body && node.parentElement; node = node.parentElement) {
    Array.from(node.parentElement.children).forEach(sib => {
      if (sib === node || sib.id === 'toast' || sib.tagName === 'SCRIPT') return;
      // un élément non affiché (autre fenêtre fermée, menu…) reste actif : s'il s'ouvre par-dessus (confirmation depuis une fenêtre),
      // il doit pouvoir recevoir le focus AU MOMENT de son ouverture, avant que l'observateur ne recalcule l'inertie.
      if (!sib.getClientRects().length) return;
      sib.inert = true; sib.setAttribute('data-modal-inert', '1');
    });
  }
}
function _modalSync() {
  document.querySelectorAll('[role="dialog"][aria-modal="true"]').forEach(d => {
    if (d.closest('.gn-modal-overlay')) return;
    const vis = _modalVisible(d), known = _modalOpeners.has(d);
    if (vis && !known) {
      let opener = (_modalTrigger && _modalTrigger.isConnected && Date.now() - _modalTriggerAt < 30000) ? _modalTrigger : document.activeElement;
      if (!opener || opener === document.body || d.contains(opener)) opener = null;
      _modalOpeners.set(d, opener); _modalStack.push(d);
    } else if (!vis && known) {
      const opener = _modalOpeners.get(d);
      _modalOpeners.delete(d);
      const i = _modalStack.indexOf(d); if (i !== -1) _modalStack.splice(i, 1);
      _modalApplyInert();   // l'inertie doit être levée AVANT de refocaliser
      const ae = document.activeElement;
      const perdu = !ae || ae === document.body || d.contains(ae) || !ae.getClientRects().length;
      if (opener && opener.isConnected && perdu && opener.getClientRects().length) opener.focus();
    }
  });
  _modalApplyInert();
}
function _initModalWatch() {
  if (typeof MutationObserver === 'undefined' || !document.body) return;
  ['keydown', 'mousedown'].forEach(n => document.addEventListener(n, _modalMark, true));
  let queued = false;
  new MutationObserver(muts => {
    // seules les fenêtres modales comptent : on ignore le reste (frappe, classes de la page…)
    if (queued || !muts.some(m => m.target.matches && m.target.matches('[role="dialog"][aria-modal="true"]'))) return;
    queued = true;
    Promise.resolve().then(() => { queued = false; _modalSync(); });
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
  _modalSync();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _initModalWatch); else _initModalWatch();
// ── FENÊTRES MODALES (fin) ─────────────────────────────────────────────

// ── ÉTATS ARIA ET LIEN D'ÉVITEMENT (début) ─────────────────────────────
// v9.59.0 (AUD-05-005) — l'état choisi d'un sélecteur de réglage (thème, palette, police, taille, vues) n'était porté que par
// la classe CSS `.active` : invisible pour un lecteur d'écran. Un observateur central recopie `.active` dans aria-pressed
// (boutons à bascule) ou aria-checked (police, role="radio") : couvre les sélecteurs actuels sans toucher à chacun
// des ~10 endroits qui basculent la classe, et les futurs placés dans les mêmes conteneurs.
const _ARIA_PRESSED_SEL = '#palette-picker .palette-swatch, #theme-picker .mode-indicator, #uiscale-picker .mode-indicator, #textwidth-picker .mode-indicator, #lineheight-picker .mode-indicator, #spacing-picker .mode-indicator, #spellcheck-picker .mode-indicator, .ch-view-toggle button';
const _ARIA_CHECKED_SEL = '#font-picker .font-option';
function _ariaMirror(el) {
  const on = el.classList.contains('active') ? 'true' : 'false';
  if (el.matches(_ARIA_CHECKED_SEL)) el.setAttribute('aria-checked', on); else el.setAttribute('aria-pressed', on);
}
// v9.59.0 (AUD-05-006) : « Aller au contenu » donne le focus au titre de niveau 1 de l'écran affiché.
function _skipToContent(e) {
  e.preventDefault();
  const cible = ['#graphicnovel-screen h1', '#library-screen [aria-level="1"]', 'main h1'].map(s => document.querySelector(s)).find(el => el && el.getClientRects().length);
  if (cible) { cible.tabIndex = -1; cible.focus(); }
}
function _initAriaState() {
  if (typeof MutationObserver === 'undefined' || !document.body) return;
  const sel = _ARIA_PRESSED_SEL + ', ' + _ARIA_CHECKED_SEL;
  document.querySelectorAll(sel).forEach(_ariaMirror);
  new MutationObserver(muts => muts.forEach(m => { if (m.target.matches && m.target.matches(sel)) _ariaMirror(m.target); }))
    .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  const skip = document.getElementById('skip-link');
  if (skip) skip.addEventListener('click', _skipToContent);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _initAriaState); else _initAriaState();
// ── ÉTATS ARIA ET LIEN D'ÉVITEMENT (fin) ───────────────────────────────

// ── ALTERNATIVE TEXTUELLE DES GRAPHIQUES (début) ───────────────────────
// v9.62.0 (AUD-05-008) — un <canvas> est une image muette pour un lecteur d'écran. On lui donne un rôle img + un nom qui
// RÉSUME les données, et un tableau « Afficher les données » (<details>) équivalent pour tous (lecteur d'écran, loupe, clavier).
// Contenu fabriqué en DOM (textContent) : jamais de HTML concaténé.
function setChartAlt(canvasId, title, headers, rows) {
  const c = document.getElementById(canvasId); if (!c) return;
  c.setAttribute('role', 'img');
  c.setAttribute('aria-label', (title + ' — ' + rows.map(r => r.join(' : ')).join(' ; ')).slice(0, 700));
  const id = 'chart-data-' + canvasId;
  let det = document.getElementById(id);
  if (!det) {
    det = document.createElement('details'); det.id = id; det.className = 'chart-data';
    const sum = document.createElement('summary'); sum.textContent = 'Afficher les données'; det.appendChild(sum);
    (c.closest('.u-h-140px, .u-h-280px, .u-minh-120px') || c).insertAdjacentElement('afterend', det);
  }
  det.querySelectorAll('table').forEach(t => t.remove());
  const t = document.createElement('table');
  const cap = document.createElement('caption'); cap.textContent = title; t.appendChild(cap);
  const hr = document.createElement('tr'); headers.forEach(h => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = h; hr.appendChild(th); }); t.appendChild(hr);
  rows.forEach(r => { const tr = document.createElement('tr'); r.forEach(v => { const td = document.createElement('td'); td.textContent = String(v); tr.appendChild(td); }); t.appendChild(tr); });
  det.appendChild(t);
}
// ── ALTERNATIVE TEXTUELLE DES GRAPHIQUES (fin) ─────────────────────────
