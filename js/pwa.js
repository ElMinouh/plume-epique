'use strict';
// Enregistrement du vrai Service Worker (sw.js à la racine) — le manifeste est
// désormais un fichier statique (manifest.json), lié directement dans index.html.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

let _pwaPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); _pwaPrompt = e;
  document.getElementById('pwa-banner').classList.add('show');
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
