'use strict';
// Changez ce numéro de version à chaque mise à jour majeure des fichiers
// pour forcer les navigateurs à récupérer la nouvelle version.
const CACHE = 'plume-epique-v9.76.0';

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './icons/plume.svg','./icons/icon-32.png','./icons/icon-180.png','./icons/icon-192.png','./icons/icon-512.png','./icons/icon-512-maskable.png',
  './vendor/fonts/literata-5.3.0-latin-wght-normal.woff2','./vendor/fonts/literata-5.3.0-latin-wght-italic.woff2','./vendor/fonts/inter-5.3.0-latin-wght-normal.woff2',
  './vendor/fonts/atkinson-hyperlegible-5.3.0-latin-400-normal.woff2','./vendor/fonts/atkinson-hyperlegible-5.3.0-latin-400-italic.woff2','./vendor/fonts/atkinson-hyperlegible-5.3.0-latin-700-normal.woff2','./vendor/fonts/atkinson-hyperlegible-5.3.0-latin-700-italic.woff2',
  './js/icons.js','./js/schema.js','./js/images.js','./js/graphicnovel.js','./js/pwa.js','./js/notifications.js','./js/crypto.js','./js/router.js','./js/profiles.js','./js/library.js','./js/editor.js',
  './js/tabs.js','./js/panels.js','./js/findreplace.js','./js/ai.js','./js/snapshots.js','./js/diff.js','./js/stats.js',
  './js/readability.js','./js/relations.js','./js/timeline.js','./js/fulltour.js','./js/tts.js','./js/wordcloud.js',
  './js/pluginSystem.js','./js/export-format-utils.js','./js/database.js','./js/memory.js','./js/odf-loader.js',
  './vendor/dompurify-3.4.16.min.js','./vendor/chart-4.5.1.umd.min.js','./vendor/idb-8.0.3.umd.js','./vendor/docx-9.8.1.js','./vendor/file-saver-2.0.5.min.js','./vendor/d3-7.9.0.min.js','./vendor/jszip-3.10.1.min.js','./vendor/jspdf-4.2.1.umd.min.js','./vendor/html2canvas-1.4.1.min.js','./vendor/mammoth-1.11.0.browser.min.js',
  './vendor/odf-kit-0.14.3.esm.js','./vendor/odf-kit-reader-0.14.3.esm.js','./vendor/odf-kit-document-0.14.3.esm.js','./vendor/fflate-0.8.3.esm.js','./vendor/marked-18.0.14.esm.js'
];

// v9.27.0 : plus aucune librairie externe — elles sont toutes dans vendor/ (CORE_ASSETS).

// v9.76.0 (audit AUD-07-006) — PRÉCACHE TOLÉRANT. cache.addAll() est tout-ou-rien : un seul fichier en échec (coupure,
// 404 passager, stockage plein) annulait l'ajout de TOUS les autres, l'erreur était avalée et l'installation « réussissait »
// : l'application se croyait disponible hors ligne sans l'être. Chaque fichier est maintenant ajouté séparément ; la liste
// de ceux qui manquent est mémorisée (precache-status.json, dans ce même cache), lue par la page (Système → « Hors ligne »)
// et retentée dès que la connexion revient (message RETRY_PRECACHE, voir pwa.js). Un fichier manquant est de toute façon
// mis en cache dès qu'il est demandé une fois (gestionnaire fetch ci-dessous).
const PRECACHE_STATUS_URL = new URL('./precache-status.json', self.location).href;
async function writePrecacheStatus(cache, missing) {
  await cache.put(PRECACHE_STATUS_URL, new Response(JSON.stringify({ cache: CACHE, total: CORE_ASSETS.length, missing, ts: Date.now() }), { headers: { 'Content-Type': 'application/json' } }));
}
async function precacheAll() {
  const cache = await caches.open(CACHE);
  const results = await Promise.allSettled(CORE_ASSETS.map(u => cache.add(u)));
  const missing = CORE_ASSETS.filter((u, i) => results[i].status === 'rejected');
  await writePrecacheStatus(cache, missing);
  return missing;
}
async function retryPrecache() {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(PRECACHE_STATUS_URL);
  const status = hit ? await hit.json() : null;
  if (!status || !status.missing || !status.missing.length) return;
  const results = await Promise.allSettled(status.missing.map(u => cache.add(u)));
  const still = status.missing.filter((u, i) => results[i].status === 'rejected');
  await writePrecacheStatus(cache, still);
}

self.addEventListener('install', event => {
  event.waitUntil(precacheAll().catch(() => {}));
  // Correction v6.0.0 : on ne saute plus l'attente automatiquement.
  // Le nouveau Service Worker reste "waiting" tant que l'utilisateur n'a
  // pas cliqué sur "Mettre à jour" dans la bannière (voir pwa.js) — ça
  // évite d'activer une nouvelle version en silence pendant qu'une page
  // encore ouverte utilise les anciens fichiers.
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'RETRY_PRECACHE') event.waitUntil(retryPrecache().catch(() => {}));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Prépare une réponse avant mise en cache : neutralise le flag "redirected"
// (sinon Chrome refuse de reservir cette réponse en cache pour une navigation).
async function cacheableResponse(res) {
  if (!res || !(res.ok || res.type === 'opaque')) return null;
  if (res.redirected) {
    const body = await res.clone().blob();
    return new Response(body, { headers: res.headers, status: res.status, statusText: res.statusText });
  }
  return res.clone();
}

// Le cache hors-ligne ne doit contenir QUE les fichiers de l'application
// (les nôtres + les librairies CDN listées plus haut). Correction v7.22.4,
// bug rencontré à l'introduction de la synchronisation multi-appareils :
// sans ce filtre, le Service Worker interceptait aussi les appels d'API
// (Worker de synchronisation, Worker IA, GitHub, LanguageTool...) avec deux
// conséquences graves —
//   1. Chrome tuait la page (RESULT_CODE_KILLED_BAD_MESSAGE) dès que la
//      synchronisation s'activait : l'app devenait inaccessible, et comme le
//      plantage survenait avant tout affichage, impossible d'installer la
//      correction sans passer par les outils de développement.
//   2. Même sans plantage, la première réponse de l'API était mise en cache
//      puis resservie indéfiniment : la synchronisation aurait renvoyé de
//      vieilles données au lieu de l'état réel du serveur.
// Une réponse d'API est vivante par nature : elle ne se met jamais en cache.
function isAppAsset(url) {
  return url.origin === self.location.origin;
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  // Ignore les requêtes non-http (ex : chrome-extension://) — non cachables et hors sujet.
  if (!event.request.url.startsWith('http')) return;
  // Tout ce qui n'est pas un fichier de l'app part directement sur le réseau,
  // sans interception ni mise en cache (voir la note ci-dessus).
  if (!isAppAsset(new URL(event.request.url))) return;

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    // v9.76.0 (audit AUD-07-005) : les librairies de vendor/ portent leur version dans leur nom (d3-7.9.0…) et ne changent
    // jamais sous le même nom : servies depuis le cache SANS revalidation (avant : une requête réseau par fichier à chaque
    // ouverture, et un fichier pouvait être remplacé dans le cache avant que l'application ne passe à la nouvelle version).
    if (cached && new URL(event.request.url).pathname.indexOf('/vendor/') !== -1) return cached;
    if (cached) {
      event.waitUntil(
        fetch(event.request).then(res => cacheableResponse(res)).then(toCache => {
          if (toCache) return caches.open(CACHE).then(c => c.put(event.request, toCache));
        }).catch(() => {})
      );
      return cached;
    }
    try {
      const res = await fetch(event.request);
      if (res.redirected) {
        // Chrome refuse qu'une réponse "redirected" serve une navigation :
        // on la reconstruit à l'identique, sans ce flag, avant de la renvoyer.
        const body = await res.blob();
        const finalRes = new Response(body, { headers: res.headers, status: res.status, statusText: res.statusText });
        if (res.ok || res.type === 'opaque') {
          event.waitUntil(caches.open(CACHE).then(c => c.put(event.request, finalRes.clone())));
        }
        return finalRes;
      }
      const toCache = await cacheableResponse(res);
      if (toCache) {
        event.waitUntil(caches.open(CACHE).then(c => c.put(event.request, toCache)));
      }
      return res;
    } catch (e) {
      return new Response('Hors ligne', { status: 503, statusText: 'Offline' });
    }
  })());
});
