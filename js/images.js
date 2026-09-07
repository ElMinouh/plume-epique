'use strict';
// ═══════════════════════════════════════════════════════
// IMAGES DU ROMAN GRAPHIQUE — stockage local séparé (nouveau)
// Les images des pages illustrées ne vivent JAMAIS dans db.pages (qui est
// chiffré, stringifié et poussé vers l'API Gist à chaque synchro) : à cette
// taille, elles feraient exploser le payload et la limite de localStorage.
// Elles vivent dans leur propre base IndexedDB, compressées à l'import, et
// db.pages ne garde qu'un imageId qui pointe dessus. Ce fichier ne dépend
// d'aucun autre script de l'app (hors la lib "idb" déjà chargée par
// index.html) — il peut être testé/relu isolément.
// ═══════════════════════════════════════════════════════
const PLUME_IMAGES_DB = 'plume_epique_images';
const PLUME_IMAGES_MAX_DIMENSION = 2000; // px, côté le plus long
const PLUME_IMAGES_QUALITY = 0.85;

let _plumeImagesDb = null;
async function plumeImagesDb() {
  if (_plumeImagesDb) return _plumeImagesDb;
  _plumeImagesDb = await idb.openDB(PLUME_IMAGES_DB, 1, {
    upgrade(db) {
      const store = db.createObjectStore('images', { keyPath:'id' });
      store.createIndex('docId', 'docId');
    }
  });
  return _plumeImagesDb;
}

// Redimensionne/compresse un fichier image importé (photo appareil, PNG
// lourd...) en WebP, taille max PLUME_IMAGES_MAX_DIMENSION sur le plus grand
// côté. Renvoie { blob, width, height } — les dimensions FINALES (après
// redimensionnement), utilisées pour l'alerte "résolution trop basse".
async function compressImageFile(file) {
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  const longest = Math.max(width, height);
  if (longest > PLUME_IMAGES_MAX_DIMENSION) {
    const scale = PLUME_IMAGES_MAX_DIMENSION / longest;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close && bitmap.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', PLUME_IMAGES_QUALITY));
  return { blob: blob || file, width, height };
}

// Importe un fichier, le compresse, le stocke, renvoie la référence à écrire
// dans l'élément image de la page (imageId/imageW/imageH).
async function storeGraphicImage(file, docId) {
  const { blob, width, height } = await compressImageFile(file);
  const id = genElementId();
  const db = await plumeImagesDb();
  await db.put('images', { id, docId, blob, width, height, createdAt: Date.now() });
  return { imageId:id, imageW:width, imageH:height };
}

// Cache mémoire des URL objet déjà créées, pour ne pas relire l'IndexedDB à
// chaque re-rendu du canvas (l'éditeur redessine souvent pendant un
// glisser-déposer).
const _plumeImageUrlCache = new Map();
async function graphicImageUrl(imageId) {
  if (!imageId) return null;
  if (_plumeImageUrlCache.has(imageId)) return _plumeImageUrlCache.get(imageId);
  const db = await plumeImagesDb();
  const rec = await db.get('images', imageId);
  if (!rec) return null;
  const url = URL.createObjectURL(rec.blob);
  _plumeImageUrlCache.set(imageId, url);
  return url;
}

async function deleteGraphicImage(imageId) {
  if (!imageId) return;
  const cached = _plumeImageUrlCache.get(imageId);
  if (cached) { URL.revokeObjectURL(cached); _plumeImageUrlCache.delete(imageId); }
  try { const db = await plumeImagesDb(); await db.delete('images', imageId); } catch(e) { /* best effort */ }
}

// Nettoyage complet à la suppression d'un manuscrit roman graphique (appelé
// depuis library.js/cleanupDocumentSideData) — évite d'accumuler des images
// orphelines indéfiniment, même principe que le nettoyage déjà en place pour
// l'historique du chat IA et les sauvegardes de conflit.
async function deleteAllGraphicImagesForDocument(docId) {
  try {
    const db = await plumeImagesDb();
    const keys = await db.getAllKeysFromIndex('images', 'docId', docId);
    for (const id of keys) await deleteGraphicImage(id);
  } catch(e) { /* best effort */ }
}
