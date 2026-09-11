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
  _plumeImagesDb = await idb.openDB(PLUME_IMAGES_DB, 2, {
    upgrade(db, oldVersion, newVersion, transaction) {
      const store = oldVersion < 1
        ? (() => { const s = db.createObjectStore('images', { keyPath:'id' }); s.createIndex('docId', 'docId'); return s; })()
        : transaction.objectStore('images');
      if (oldVersion < 2) {
        // Lot 8, audit #27 — déduplication par contenu : index composé
        // (docId+hash) pour retrouver en une requête une image identique
        // déjà stockée dans le même manuscrit. Les enregistrements créés
        // avant cette version n'ont pas de champ "hash" : IndexedDB les
        // ignore simplement dans cet index (pas d'erreur, juste pas
        // candidats à une déduplication rétroactive — volontaire, pour ne
        // pas toucher aux images déjà en place).
        store.createIndex('docIdHash', ['docId', 'hash']);
      }
    }
  });
  return _plumeImagesDb;
}

// SHA-256 du contenu (déjà compressé) d'une image — sert de clé de
// déduplication (Lot 8, audit #27). API native du navigateur, aucune
// dépendance supplémentaire.
async function computeImageHash(blob) {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
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
// Lot 8, audit #27 — déduplication : si ce manuscrit contient déjà une
// image de contenu identique (même hash), on réutilise son id au lieu d'en
// stocker une copie — refCount compte le nombre d'éléments qui s'en
// servent, pour ne la supprimer réellement que lorsque plus aucun ne la
// référence (voir deleteGraphicImage plus bas).
async function storeGraphicImage(file, docId) {
  const { blob, width, height } = await compressImageFile(file);
  const hash = await computeImageHash(blob);
  const db = await plumeImagesDb();
  const existing = await db.getFromIndex('images', 'docIdHash', [docId, hash]);
  if (existing) {
    existing.refCount = (existing.refCount || 1) + 1;
    await db.put('images', existing);
    return { imageId: existing.id, imageW: existing.width, imageH: existing.height };
  }
  const id = genElementId();
  await db.put('images', { id, docId, blob, width, height, hash, refCount: 1, createdAt: Date.now() });
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

// Utilisée par la duplication de page (Lot 5, audit #15). Avant le
// compteur de références (Lot 8, audit #27), cette fonction copiait le
// blob sous un nouvel id pour garantir que supprimer l'image sur une page
// ne casse pas l'autre. Le refCount offre maintenant la même garantie sans
// dupliquer le stockage : on garde le MÊME id, on incrémente juste son
// compteur — la suppression réelle n'aura lieu que lorsque plus aucun
// élément ne référence l'image (voir deleteGraphicImage).
async function duplicateGraphicImage(imageId, docId) {
  if (!imageId) return null;
  const db = await plumeImagesDb();
  const rec = await db.get('images', imageId);
  if (!rec) return null;
  rec.refCount = (rec.refCount || 1) + 1;
  await db.put('images', rec);
  return { imageId: rec.id, imageW: rec.width, imageH: rec.height };
}

// Décrémente le compteur de références d'une image — ne la supprime pour
// de vrai que lorsque plus aucun élément ne s'en sert (Lot 8, audit #27).
// Les enregistrements créés avant le compteur n'ont pas de champ refCount :
// traité comme 1 (comportement d'origine, une seule référence).
async function deleteGraphicImage(imageId) {
  if (!imageId) return;
  try {
    const db = await plumeImagesDb();
    const rec = await db.get('images', imageId);
    if (!rec) return;
    const newCount = (rec.refCount || 1) - 1;
    if (newCount > 0) {
      rec.refCount = newCount;
      await db.put('images', rec);
      return; // encore référencée ailleurs : le blob ne doit pas bouger
    }
    const cached = _plumeImageUrlCache.get(imageId);
    if (cached) { URL.revokeObjectURL(cached); _plumeImageUrlCache.delete(imageId); }
    await db.delete('images', imageId);
  } catch (e) { /* best effort */ }
}

// Nettoyage complet à la suppression d'un manuscrit roman graphique (appelé
// depuis library.js/cleanupDocumentSideData) — évite d'accumuler des images
// orphelines indéfiniment, même principe que le nettoyage déjà en place pour
// l'historique du chat IA et les sauvegardes de conflit.
// Suppression FORCÉE (pas via deleteGraphicImage) : le manuscrit entier
// disparaît, refCount n'a plus de sens — le décrémenter laisserait des
// images orphelines derrière lui si l'une d'elles était référencée plus
// d'une fois (Lot 8, audit #27).
async function deleteAllGraphicImagesForDocument(docId) {
  try {
    const db = await plumeImagesDb();
    const keys = await db.getAllKeysFromIndex('images', 'docId', docId);
    for (const id of keys) {
      const cached = _plumeImageUrlCache.get(id);
      if (cached) { URL.revokeObjectURL(cached); _plumeImageUrlCache.delete(id); }
      await db.delete('images', id);
    }
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
