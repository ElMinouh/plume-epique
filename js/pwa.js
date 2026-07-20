'use strict';
(function setupPWA() {
  const manifest = {
    name: 'Plume Épique Studio',
    short_name: 'Plume',
    description: 'Outil d\'écriture créative tout-en-un',
    start_url: '.',
    display: 'standalone',
    background_color: '#2c3e50',
    theme_color: '#2c3e50',
    icons: [{ src: 'https://via.placeholder.com/192/c0392b/ffffff?text=P', sizes: '192x192', type: 'image/png' },
            { src: 'https://via.placeholder.com/512/c0392b/ffffff?text=P', sizes: '512x512', type: 'image/png' }]
  };
  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  document.getElementById('pwa-manifest').href = URL.createObjectURL(blob);

  if ('serviceWorker' in navigator) {
    const swCode = `
const CACHE = 'plume-v56';
const ASSETS = [self.location.href];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))));
self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
    const clone = res.clone();
    caches.open(CACHE).then(c => c.put(e.request, clone));
    return res;
  }).catch(() => r)));
});
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
));`;
    const swBlob = new Blob([swCode], { type: 'text/javascript' });
    navigator.serviceWorker.register(URL.createObjectURL(swBlob)).catch(() => {});
  }
})();

let _pwaPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); _pwaPrompt = e;
  document.getElementById('pwa-banner').classList.add('show');
});
