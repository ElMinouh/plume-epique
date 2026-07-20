'use strict';
// Changez ce numéro de version à chaque mise à jour majeure des fichiers
// pour forcer les navigateurs à récupérer la nouvelle version.
const CACHE = 'plume-epique-v1';

const CORE_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/pwa.js','./js/notifications.js','./js/crypto.js','./js/router.js','./js/editor.js',
  './js/tabs.js','./js/panels.js','./js/ai.js','./js/snapshots.js','./js/diff.js','./js/stats.js',
  './js/readability.js','./js/relations.js','./js/timeline.js','./js/tts.js','./js/wordcloud.js',
  './js/pluginSystem.js','./js/sync.js','./js/database.js','./js/memory.js'
];

const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/idb@8/build/umd.js',
  'https://unpkg.com/docx@7.1.0/build/index.js',
  'https://cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js',
  'https://d3js.org/d3.v7.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE_ASSETS).catch(() => {});
    // Requêtes cross-origin en no-cors (réponses "opaques", mais ça suffit pour le cache hors-ligne)
    await Promise.allSettled(
      CDN_ASSETS.map(url => cache.add(new Request(url, { mode: 'no-cors' })).catch(() => {}))
    );
  })());
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) {
      // Ressource déjà en cache : on la sert tout de suite, et on met à jour
      // le cache en arrière-plan pour la prochaine visite (sans bloquer ni cloner).
      event.waitUntil(
        fetch(event.request).then(res => {
          if (res && (res.ok || res.type === 'opaque')) {
            return caches.open(CACHE).then(c => c.put(event.request, res));
          }
        }).catch(() => {})
      );
      return cached;
    }
    // Pas encore en cache : on récupère la ressource, on clone AVANT de la
    // renvoyer (cloner après lecture provoque l'erreur "body is already used"),
    // et on stocke la copie sans bloquer la réponse.
    try {
      const res = await fetch(event.request);
      if (res && (res.ok || res.type === 'opaque')) {
        const resClone = res.clone();
        event.waitUntil(caches.open(CACHE).then(c => c.put(event.request, resClone)));
      }
      return res;
    } catch (e) {
      return new Response('Hors ligne', { status: 503, statusText: 'Offline' });
    }
  })());
});
