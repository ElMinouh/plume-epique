'use strict';
// Correction v6.0.0 : le Service Worker n'active plus automatiquement une
// nouvelle version (voir sw.js). On détecte ici quand une mise à jour est
// prête et on affiche une bannière pour laisser l'utilisateur décider du
// moment du rechargement.
//
// Correction v7.22.3 — piège découvert à l'usage : si la version DÉJÀ en
// cache est cassée au point de faire planter la page, l'utilisateur n'a
// jamais le temps de cliquer sur « Mettre à jour » — la correction déployée
// ne s'installe donc jamais, et l'appareil reste bloqué indéfiniment sur la
// version défectueuse (constaté en v7.22.x : plantage Chrome dès la saisie
// de la clé de synchronisation, impossible à corriger sans passer par les
// outils de développement du navigateur).
// Garde-fou : une mise à jour détectée dans les premières secondes suivant
// le chargement est appliquée AUTOMATIQUEMENT, sans attendre de clic. Ce
// délai vise précisément ce cas (une page qui plante le fait tout de suite),
// tout en préservant l'intention d'origine : passé ce délai, l'utilisateur
// est probablement en train d'écrire, et c'est de nouveau lui qui décide du
// moment du rechargement via la bannière.
const AUTO_UPDATE_WINDOW_MS = 8000;
const _pageLoadedAt = Date.now();
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

// v9.26.0 — Redemande au navigateur de chercher une nouvelle version de
// l'application (appelée quand un manuscrit vient d'une version plus récente).
function checkForAppUpdate() {
  try { if (_swRegistration && _swRegistration.update) _swRegistration.update(); } catch (e) { /* sans effet */ }
}
function showUpdateBanner() {
  // Mise à jour repérée juste après le chargement : on l'applique sans
  // attendre (voir la note en haut de ce fichier) — la page se recharge
  // alors immédiatement sur la nouvelle version.
  if (Date.now() - _pageLoadedAt < AUTO_UPDATE_WINDOW_MS) { applyUpdate(); return; }
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

const _pwaInstallBtn = document.getElementById('pwa-install-btn');
if (_pwaInstallBtn) _pwaInstallBtn.addEventListener('click', installPWA);
const _pwaDismissBtn = document.getElementById('pwa-dismiss-btn');
if (_pwaDismissBtn) _pwaDismissBtn.addEventListener('click', () => document.getElementById('pwa-banner').classList.remove('show'));
const _installAppBtn = document.getElementById('install-app-btn');
if (_installAppBtn) _installAppBtn.addEventListener('click', installPWA);

let _pwaPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); _pwaPrompt = e;
  // L'app est installable : on révèle le bouton du bandeau bas et la bannière.
  document.getElementById('pwa-banner').classList.add('show');
  // v7.17.0 : le bouton est masqué par la classe utilitaire `u-d-none`
  // (et non plus par un attribut style="display:none", retiré avec
  // 'unsafe-inline' de la CSP). On retire donc la classe au lieu de
  // réinitialiser le style inline.
  const btn = document.getElementById('install-app-btn');
  if (btn) btn.classList.remove('u-d-none');
});

// L'app vient d'être installée (ou l'est déjà) : on masque le bouton permanent
// et la bannière — il n'y a plus rien à installer.
window.addEventListener('appinstalled', () => {
  const btn = document.getElementById('install-app-btn');
  if (btn) btn.classList.add('u-d-none');
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
    if (btn) btn.classList.add('u-d-none');
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

// ═══════════════════════════════════════════════════════
// RAPPORT D'ERREURS DU NAVIGATEUR (v9.70.0, audit AUD-07-016)
// Une erreur JavaScript n'était visible que par la personne qui la subissait : les incidents passés (sauvegarde
// du 14/08/2026, scripts bloqués par la CSP pendant trois versions) ont été découverts tardivement. Chaque erreur
// non interceptée est maintenant signalée au Worker de synchronisation (route /client-error) : version, famille de
// navigateur (déduite côté serveur), message tronqué à 160 caractères, fichier:ligne. JAMAIS de texte de manuscrit,
// d'identifiant de profil ni d'adresse. Garde-fous : rien n'est envoyé si la synchronisation n'est pas activée
// (« écrire sur cet appareil seulement » = aucun échange avec le serveur), 5 rapports au plus par chargement de page,
// une même erreur n'est signalée qu'une fois.
// ═══════════════════════════════════════════════════════
const CLIENT_ERROR_MAX_PER_PAGE = 5;
let _clientErrorsSent = 0;
const _clientErrorSeen = new Set();
function reportClientError(message, source) {
  try {
    if (_clientErrorsSent >= CLIENT_ERROR_MAX_PER_PAGE) return false;
    if (typeof SYNC_WORKER_URL === 'undefined' || typeof getSyncKey !== 'function' || typeof fetchWithTimeout !== 'function' || !getSyncKey()) return false;
    const m = String(message == null ? '' : message).slice(0, 160);
    const s = String(source == null ? '' : source).slice(0, 60);
    const sig = m + '|' + s;
    if (!m || _clientErrorSeen.has(sig)) return false;
    _clientErrorSeen.add(sig);
    _clientErrorsSent++;
    fetchWithTimeout(SYNC_WORKER_URL + '/client-error', {
      method: 'POST', keepalive: true, credentials: 'omit', timeoutMs: 8000,
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ v: typeof APP_VERSION !== 'undefined' ? APP_VERSION : '', m, s })
    }).catch(() => { /* le rapport est un plus : son échec ne doit rien déranger */ });
    return true;
  } catch (e) { return false; }
}
window.addEventListener('error', e => {
  // Les erreurs de chargement de ressources (images, scripts) n'ont pas de message : ignorées.
  if (!e || !e.message) return;
  const file = String(e.filename || '').split('/').pop().split('?')[0];
  reportClientError(e.message, file ? file + ':' + (e.lineno || 0) : '');
});
window.addEventListener('unhandledrejection', e => {
  const r = e && e.reason;
  reportClientError((r && r.message) || String(r), 'promesse');
});

// ═══════════════════════════════════════════════════════
// ÉTAT « HORS LIGNE » (v9.76.0, audit AUD-07-006)
// Le service worker mémorise les fichiers qu'il n'a pas pu mettre en cache à l'installation (precache-status.json) : on
// l'affiche dans Système, et on lui demande de réessayer dès que la connexion est là (au chargement et au retour du réseau).
// ═══════════════════════════════════════════════════════
const PRECACHE_STATUS_PATH = 'precache-status.json';
async function readPrecacheStatus() {
  try {
    if (typeof caches === 'undefined') return null;
    const hit = await caches.match(PRECACHE_STATUS_PATH);
    return hit ? await hit.json() : null;
  } catch (e) { return null; }
}
async function renderOfflineStatus() {
  const el = document.getElementById('lib-offline-status');
  if (!el) return;
  const st = await readPrecacheStatus();
  if (!st) { el.textContent = ''; return; }
  const n = (st.missing || []).length;
  el.textContent = n === 0
    ? 'Hors ligne : prêt (' + st.total + ' fichiers en cache).'
    : 'Hors ligne : incomplet — ' + n + ' fichier' + (n > 1 ? 's' : '') + ' manquant' + (n > 1 ? 's' : '') + ' sur ' + st.total + ' ; nouvelle tentative automatique dès que la connexion le permet.';
}
async function retryPrecacheIfNeeded() {
  try {
    const st = await readPrecacheStatus();
    if (!st || !(st.missing || []).length) return false;
    const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!sw) return false;
    sw.postMessage({ type: 'RETRY_PRECACHE' });
    return true;
  } catch (e) { return false; }
}
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('load', () => { setTimeout(retryPrecacheIfNeeded, 4000); });
  window.addEventListener('online', () => { retryPrecacheIfNeeded(); });
}
