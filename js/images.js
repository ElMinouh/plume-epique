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
// 2600px (Lot 2, audit #1) : le format d'export 20×25cm + 3mm de fond perdu
// à 300 DPI demande jusqu'à ~2432px pour une image plein cadre plein page
// (voir GN_PDF_TRIM_MM/GN_PDF_BLEED_MM/GN_PDF_DPI dans graphicnovel.js) —
// 2600px laisse une marge de sécurité sans exploser le poids de stockage
// local (cette base n'est ni synchronisée ni chiffrée, donc coût local seul).
const PLUME_IMAGES_MAX_DIMENSION = 2600; // px, côté le plus long
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

// Copie indépendante d'une image déjà stockée — utilisée par la duplication
// de page (Lot 5, audit #15) : sans ça, la page originale et sa copie
// partageraient le même imageId, et supprimer l'image sur l'une finirait
// (après purge de la corbeille, 30 jours) par casser l'autre aussi.
async function duplicateGraphicImage(imageId, docId) {
  if (!imageId) return null;
  const db = await plumeImagesDb();
  const rec = await db.get('images', imageId);
  if (!rec) return null;
  const newId = genElementId();
  await db.put('images', { id: newId, docId, blob: rec.blob, width: rec.width, height: rec.height, createdAt: Date.now() });
  return { imageId: newId, imageW: rec.width, imageH: rec.height };
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

// Toutes les images d'un document (Lot 7, audit #25) — utilisé pour les
// inclure dans la sauvegarde JSON et la synchronisation Gist, qui ne
// touchaient jusqu'ici que db.pages (les images, elles, vivent uniquement
// dans cette base locale — voir la note en tête de fichier).
async function getAllGraphicImagesForDocument(docId) {
  const db = await plumeImagesDb();
  return db.getAllFromIndex('images', 'docId', docId);
}

// Poids total (octets) des images d'un document (Lot 8, audit #26) —
// utilisé pour afficher un repère de taille et avertir avant d'approcher
// du quota de stockage réel du navigateur (voir gnUpdateStorageInfo,
// graphicnovel.js), plutôt que de laisser l'utilisateur découvrir le
// problème via une erreur de quota dépassé en pleine séance.
async function getGraphicImagesTotalSize(docId) {
  const list = await getAllGraphicImagesForDocument(docId);
  return list.reduce((sum, rec) => sum + (rec.blob ? rec.blob.size : 0), 0);
}

// Écrit (ou remplace) un enregistrement d'image tel quel — utilisé à la
// restauration depuis un fichier JSON ou un Gist. Les images ne sont jamais
// modifiées après création (seulement dupliquées avec un nouvel id, ou
// supprimées) : réécrire un id déjà présent avec le même contenu est donc
// sans risque.
async function putGraphicImageRecord(rec) {
  const db = await plumeImagesDb();
  await db.put('images', rec);
}
