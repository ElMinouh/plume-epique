'use strict';
// Correction v6.0.0 : le Service Worker n'active plus automatiquement une
// nouvelle version (voir sw.js). On détecte ici quand une mise à jour est
// prête et on affiche une bannière pour laisser l'utilisateur décider du
// moment du rechargement.
let _swRegistration = null;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      _swRegistration = reg;
      if (reg.waiting) showUpdateBanner();
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner();
          }
        });
      });
    }).catch(() => {});
  });

  let _reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (_reloadingForUpdate) return;
    _reloadingForUpdate = true;
    location.reload();
  });
}

function showUpdateBanner() {
  const el = document.getElementById('sw-update-banner');
  if (el) el.classList.add('show');
}
function applyUpdate() {
  if (_swRegistration && _swRegistration.waiting) {
    _swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
  }
  const el = document.getElementById('sw-update-banner');
  if (el) el.classList.remove('show');
}

const _swUpdateBtn = document.getElementById('sw-update-btn');
if (_swUpdateBtn) _swUpdateBtn.addEventListener('click', applyUpdate);
const _swDismissBtn = document.getElementById('sw-update-dismiss-btn');
if (_swDismissBtn) _swDismissBtn.addEventListener('click', () => {
  const el = document.getElementById('sw-update-banner');
  if (el) el.classList.remove('show');
});

let _pwaPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); _pwaPrompt = e;
  // L'app est installable : on révèle le bouton du bandeau bas et la bannière.
  document.getElementById('pwa-banner').classList.add('show');
  const btn = document.getElementById('install-app-btn');
  if (btn) btn.style.display = '';
});

// L'app vient d'être installée (ou l'est déjà) : on masque le bouton permanent
// et la bannière — il n'y a plus rien à installer.
window.addEventListener('appinstalled', () => {
  const btn = document.getElementById('install-app-btn');
  if (btn) btn.style.display = 'none';
  const banner = document.getElementById('pwa-banner');
  if (banner) banner.classList.remove('show');
  _pwaPrompt = null;
});

// Au chargement : si l'app tourne déjà en mode installé (fenêtre autonome),
// le bouton d'installation n'a aucun sens, on le masque d'emblée.
window.addEventListener('load', () => {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone) {
    const btn = document.getElementById('install-app-btn');
    if (btn) btn.style.display = 'none';
  }
});

async function installPWA() {
  if (_pwaPrompt) {
    _pwaPrompt.prompt();
    const choice = await _pwaPrompt.userChoice;
    document.getElementById('pwa-banner').classList.remove('show');
    _pwaPrompt = null;
    if (choice.outcome === 'accepted') toast('Application installée sur le bureau !', 'success');
  } else {
    toast('Installation indisponible : déjà installée, ou non supportée par ce navigateur.', 'error');
  }
}
