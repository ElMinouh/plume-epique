'use strict';
// ═══════════════════════════════════════════════════════
// IMAGES DU ROMAN GRAPHIQUE — stockage local séparé, CHIFFRÉ, synchronisé
// Les images des pages illustrées ne vivent JAMAIS dans db.pages (qui est
// chiffré, stringifié et poussé vers l'API Gist à chaque synchro) : à cette
// taille, elles feraient exploser le payload et la limite de localStorage.
// Elles vivent dans leur propre base IndexedDB, compressées à l'import, et
// db.pages ne garde qu'un imageId qui pointe dessus.
//
// v9.28.0 (audit AUD-01-011) — TROIS CHANGEMENTS :
//  A. CHIFFREMENT AU REPOS : chaque image est chiffrée (AES-GCM, clé dérivée de
//     la clé de données du profil) avant d'être rangée. Avant, elles étaient
//     stockées en clair et lisibles par n'importe qui ayant accès au navigateur,
//     sans aucune séparation entre profils. Les images anciennes (blob en clair)
//     sont converties à la première ouverture du manuscrit
//     (migrateGraphicImagesToEncrypted) et restent lisibles d'ici là.
//  B. L'envoi Gist et l'export réutilisent l'octet chiffré tel quel (voir library.js).
//  C. SYNCHRONISATION ENTRE APPAREILS via le Worker de synchro (clés img_*),
//     chiffrée, une seule fois par image (une image est immuable), et récupérée
//     à la demande quand un appareil ne l'a pas encore.
//
// Format d'un enregistrement :
//   ancien : { id, docId, blob, width, height, hash, refCount, createdAt }
//   chiffré: { id, docId, enc:true, data:<iv(12)+chiffré>, mime, size, width, height,
//              hash (clé), refCount, createdAt, synced:boolean }
// Sans clé de données disponible (tests isolés), on retombe sur l'ancien format.
// ═══════════════════════════════════════════════════════
const PLUME_IMAGES_DB = 'plume_epique_images';
// 2600px (Lot 2, audit #1) : le format d'export 20×25cm + 3mm de fond perdu
// à 300 DPI demande jusqu'à ~2432px pour une image plein cadre plein page
// (voir GN_PDF_TRIM_MM/GN_PDF_BLEED_MM/GN_PDF_DPI dans graphicnovel.js) —
// 2600px laisse une marge de sécurité sans exploser le poids de stockage.
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
        // (docId+hash). Les enregistrements sans "hash" sont ignorés de cet index.
        store.createIndex('docIdHash', ['docId', 'hash']);
      }
    }
  });
  return _plumeImagesDb;
}

// ── Outils octets ↔ base64 (indépendants de crypto.js, chargé après ce fichier) ──
function imgBytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
function imgBase64ToBytes(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }
function imgToBytes(data) { return data instanceof Uint8Array ? data : new Uint8Array(data); }

// ── Chiffrement des images ──
function imagesCanEncrypt() {
  return typeof Crypto !== 'undefined' && typeof Crypto.encryptBytes === 'function' && typeof _dataKey === 'string' && !!_dataKey;
}
// Octets en clair d'un enregistrement (chiffré ou ancien) ; null si illisible.
async function graphicImageBytes(rec) {
  if (!rec) return null;
  if (rec.enc) return imagesCanEncrypt() ? await Crypto.decryptBytes(imgToBytes(rec.data), _dataKey) : null;
  if (rec.blob) return new Uint8Array(await rec.blob.arrayBuffer());
  return null;
}
// Octets CHIFFRÉS d'un enregistrement (chiffre à la volée un ancien enregistrement en clair).
async function graphicImageCipher(rec) {
  if (!rec) return null;
  if (rec.enc) return imgToBytes(rec.data);
  if (!imagesCanEncrypt()) return null;
  const plain = await graphicImageBytes(rec);
  return plain ? await Crypto.encryptBytes(plain, _dataKey) : null;
}

// SHA-256 du contenu (déjà compressé) d'une image — sert de clé de déduplication.
async function computeImageHash(blob) {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}
// Empreinte de déduplication stockée EN CLAIR à côté de l'image chiffrée : liée à la clé du
// profil, pour qu'elle ne permette pas de reconnaître une image connue (attaque par confirmation).
async function keyedImageHash(blob) {
  const plain = await computeImageHash(blob);
  if (!imagesCanEncrypt()) return plain;
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(_dataKey + '\u0000img\u0000' + plain));
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Redimensionne/compresse un fichier image importé en WebP, taille max
// PLUME_IMAGES_MAX_DIMENSION sur le plus grand côté. Renvoie { blob, width, height }.
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

// Fabrique l'enregistrement d'une image à partir de ses octets en clair (chiffré si possible).
async function buildImageRecord({ id, docId, bytes, mime, width, height, hash, refCount, synced, blob }) {
  const base = { id, docId, width, height, hash, refCount: refCount || 1, createdAt: Date.now() };
  if (imagesCanEncrypt()) {
    return { ...base, enc: true, data: await Crypto.encryptBytes(bytes, _dataKey), mime: mime || 'image/webp', size: bytes.length, synced: !!synced };
  }
  return { ...base, blob: blob || new Blob([bytes], { type: mime || 'image/webp' }) };
}

// Importe un fichier, le compresse, le stocke (chiffré), renvoie la référence à écrire
// dans l'élément image de la page (imageId/imageW/imageH).
// Déduplication (Lot 8, audit #27) : si ce manuscrit contient déjà une image de contenu
// identique (même empreinte), on réutilise son id — refCount compte le nombre d'éléments qui
// s'en servent.
async function storeGraphicImage(file, docId) {
  const { blob, width, height } = await compressImageFile(file);
  const hash = await keyedImageHash(blob);
  const db = await plumeImagesDb();
  const existing = await db.getFromIndex('images', 'docIdHash', [docId, hash]);
  if (existing) {
    existing.refCount = (existing.refCount || 1) + 1;
    await db.put('images', existing);
    return { imageId: existing.id, imageW: existing.width, imageH: existing.height };
  }
  const id = genElementId();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const rec = await buildImageRecord({ id, docId, bytes, mime: blob.type, width, height, hash, refCount: 1, blob });
  await db.put('images', rec);
  if (rec.enc && typeof queueGraphicImagePush === 'function') queueGraphicImagePush(id);
  return { imageId: id, imageW: width, imageH: height };
}

// Cache mémoire des URL objet déjà créées (le canvas redessine souvent).
const _plumeImageUrlCache = new Map();
async function graphicImageUrl(imageId) {
  if (!imageId) return null;
  if (_plumeImageUrlCache.has(imageId)) return _plumeImageUrlCache.get(imageId);
  const db = await plumeImagesDb();
  let rec = await db.get('images', imageId);
  // Image inconnue sur cet appareil (créée ailleurs) : on la récupère auprès du serveur de synchro.
  if (!rec && typeof pullGraphicImage === 'function') rec = await pullGraphicImage(imageId);
  if (!rec) return null;
  let blob = rec.blob;
  if (rec.enc) {
    const bytes = await graphicImageBytes(rec);
    if (!bytes) return null;
    blob = new Blob([bytes], { type: rec.mime || 'image/webp' });
  }
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  _plumeImageUrlCache.set(imageId, url);
  return url;
}

// Duplication de page : on garde le MÊME id, on incrémente juste son compteur (refCount).
async function duplicateGraphicImage(imageId, docId) {
  if (!imageId) return null;
  const db = await plumeImagesDb();
  const rec = await db.get('images', imageId);
  if (!rec) return null;
  rec.refCount = (rec.refCount || 1) + 1;
  await db.put('images', rec);
  return { imageId: rec.id, imageW: rec.width, imageH: rec.height };
}

function forgetImageUrl(imageId) {
  const cached = _plumeImageUrlCache.get(imageId);
  if (cached) { URL.revokeObjectURL(cached); _plumeImageUrlCache.delete(imageId); }
}

// Décrémente le compteur de références d'une image — ne la supprime pour de vrai que lorsque
// plus aucun élément ne s'en sert. Les enregistrements anciens sans refCount valent 1.
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
      return;
    }
    forgetImageUrl(imageId);
    await db.delete('images', imageId);
    if (typeof deleteRemoteGraphicImage === 'function') deleteRemoteGraphicImage(rec.docId, imageId);
  } catch (e) { /* best effort */ }
}

// v9.25.0 (audit AUD-01-006) — Ramène le compteur de références au nombre RÉEL d'éléments qui
// utilisent encore l'image. À 0 : supprimée ; sinon CONSERVÉE, quelle que soit la dérive du compteur.
async function reconcileGraphicImageRef(imageId, uses) {
  if (!imageId) return;
  try {
    const db = await plumeImagesDb();
    const rec = await db.get('images', imageId);
    if (!rec) return;
    if (uses > 0) {
      if (rec.refCount !== uses) { rec.refCount = uses; await db.put('images', rec); }
      return;
    }
    forgetImageUrl(imageId);
    await db.delete('images', imageId);
    if (typeof deleteRemoteGraphicImage === 'function') deleteRemoteGraphicImage(rec.docId, imageId);
  } catch (e) { /* best effort */ }
}

// Nettoyage complet à la suppression d'un manuscrit roman graphique. Suppression FORCÉE
// (refCount n'a plus de sens). `opts.localOnly` : ne touche pas au serveur (la suppression a eu
// lieu sur un autre appareil, qui s'en est déjà chargé) ; `opts.profileId` : profil propriétaire.
async function deleteAllGraphicImagesForDocument(docId, opts) {
  opts = opts || {};
  try {
    const db = await plumeImagesDb();
    const keys = await db.getAllKeysFromIndex('images', 'docId', docId);
    for (const id of keys) {
      forgetImageUrl(id);
      await db.delete('images', id);
      if (!opts.localOnly && typeof deleteRemoteGraphicImage === 'function') deleteRemoteGraphicImage(docId, id, opts.profileId);
    }
  } catch(e) { /* best effort */ }
}

// Toutes les images d'un document (enregistrements bruts : chiffrés ou anciens).
async function getAllGraphicImagesForDocument(docId) {
  const db = await plumeImagesDb();
  return db.getAllFromIndex('images', 'docId', docId);
}

// Poids total (octets, en clair) des images d'un document.
async function getGraphicImagesTotalSize(docId) {
  const list = await getAllGraphicImagesForDocument(docId);
  return list.reduce((sum, rec) => sum + (rec.enc ? (rec.size || 0) : (rec.blob ? rec.blob.size : 0)), 0);
}

// Écrit (ou remplace) un enregistrement d'image tel quel.
async function putGraphicImageRecord(rec) {
  const db = await plumeImagesDb();
  await db.put('images', rec);
}

// Restaure une image à partir de ses octets (fichier JSON, Gist, serveur) : `plainBytes` en
// clair, ou `cipherBytes` (déjà chiffrés avec la clé de CE profil — vérifiés avant d'être gardés).
async function restoreGraphicImage({ id, docId, plainBytes, cipherBytes, mime, width, height, refCount, synced }) {
  let plain = plainBytes || null;
  if (!plain && cipherBytes && imagesCanEncrypt()) plain = await Crypto.decryptBytes(imgToBytes(cipherBytes), _dataKey);
  if (!plain) return null; // illisible (autre profil, fichier corrompu)
  const blob = new Blob([plain], { type: mime || 'image/webp' });
  const hash = await keyedImageHash(blob);
  let rec;
  if (cipherBytes && imagesCanEncrypt() && !plainBytes) {
    rec = { id, docId, enc: true, data: imgToBytes(cipherBytes), mime: mime || 'image/webp', size: plain.length, width, height, hash, refCount: refCount || 1, createdAt: Date.now(), synced: !!synced };
  } else {
    rec = await buildImageRecord({ id, docId, bytes: plain, mime, width, height, hash, refCount, synced });
  }
  await putGraphicImageRecord(rec);
  return rec;
}

// Convertit en clair → chiffré toutes les images d'un manuscrit. Sûr : chaque image est
// rechiffrée, RELUE et comparée avant de remplacer l'ancienne ; en cas de doute, l'ancienne reste.
async function migrateGraphicImagesToEncrypted(docId) {
  if (!imagesCanEncrypt()) return 0;
  let converted = 0;
  const db = await plumeImagesDb();
  const recs = await db.getAllFromIndex('images', 'docId', docId);
  for (const rec of recs) {
    if (rec.enc || !rec.blob) continue;
    try {
      const bytes = new Uint8Array(await rec.blob.arrayBuffer());
      const sealed = await Crypto.encryptBytes(bytes, _dataKey);
      const back = await Crypto.decryptBytes(sealed, _dataKey);
      if (!back || back.length !== bytes.length) continue;
      const hash = await keyedImageHash(rec.blob);
      const tx = db.transaction('images', 'readwrite');
      const fresh = await tx.store.get(rec.id);
      if (fresh && !fresh.enc) {
        await tx.store.put({ id: fresh.id, docId: fresh.docId, enc: true, data: sealed, mime: rec.blob.type || 'image/webp', size: bytes.length,
          width: fresh.width, height: fresh.height, hash, refCount: fresh.refCount || 1, createdAt: fresh.createdAt || Date.now(), synced: false });
        converted++;
      }
      await tx.done;
    } catch (e) { /* cette image reste en clair, réessayée à la prochaine ouverture */ }
  }
  return converted;
}

// ═══════════════════════════════════════════════════════
// SYNCHRONISATION DES IMAGES ENTRE APPAREILS (v9.28.0, C)
// Une image est IMMUABLE : on ne l'envoie qu'une fois (version 0 → 1 ; un 409 signifie « déjà
// là »), chiffrée, sous la clé img_<profil>_<manuscrit>_<image>. Un appareil qui ne l'a pas
// la récupère à la demande (graphicImageUrl). Le stockage D1 gratuit étant limité (500 Mo, voir
// worker/sync-worker.js), le serveur refuse au-delà d'un budget (507) : on s'arrête alors une
// heure et on prévient une fois — la sauvegarde GitHub reste disponible.
// ═══════════════════════════════════════════════════════
let _imgSyncBlockedUntil = 0, _imgBudgetWarned = false;
const IMG_SYNC_BLOCK_MS = 60 * 60 * 1000;
function imageRemoteKey(docId, imageId, profileId) {
  return 'img_' + (profileId || (typeof _currentProfileId !== 'undefined' ? _currentProfileId : '')) + '_' + docId + '_' + imageId;
}
function imageSyncReady() {
  return typeof getSyncKey === 'function' && !!getSyncKey() && typeof fetchWithTimeout === 'function' && typeof SYNC_WORKER_URL !== 'undefined';
}
function imageSyncUrl(key) { return SYNC_WORKER_URL + '?key=' + encodeURIComponent(key); }

async function markGraphicImageSynced(imageId) {
  const db = await plumeImagesDb();
  const tx = db.transaction('images', 'readwrite');
  const rec = await tx.store.get(imageId);
  if (rec && !rec.synced) await tx.store.put({ ...rec, synced: true });
  await tx.done;
}

// Envoie une image chiffrée au serveur (une seule fois). Renvoie true si elle y est.
async function pushGraphicImage(imageId) {
  if (!imageSyncReady() || Date.now() < _imgSyncBlockedUntil) return false;
  try {
    const db = await plumeImagesDb();
    const rec = await db.get('images', imageId);
    if (!rec || !rec.enc) return false;
    if (rec.synced) return true;
    const body = JSON.stringify({ v: 1, w: rec.width, h: rec.height, mime: rec.mime, data: imgBytesToBase64(imgToBytes(rec.data)) });
    const resp = await fetchWithTimeout(imageSyncUrl(imageRemoteKey(rec.docId, imageId)), {
      method: 'PUT', timeoutMs: 120000, body,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getSyncKey(), 'X-Plume-Base-Version': '0' }
    });
    if (resp.ok || resp.status === 409) { await markGraphicImageSynced(imageId); return true; }
    if (resp.status === 507) {
      _imgSyncBlockedUntil = Date.now() + IMG_SYNC_BLOCK_MS;
      if (!_imgBudgetWarned && typeof toast === 'function') { _imgBudgetWarned = true; toast("Le stockage de synchronisation des images est plein : elles restent sur cet appareil. Utilisez la sauvegarde GitHub pour les déplacer.", 'error'); }
    }
    return false;
  } catch (e) { return false; }
}
let _imgPushChain = Promise.resolve();
// File d'attente : une image à la fois (pas de rafale de gros envois).
function queueGraphicImagePush(imageId) {
  _imgPushChain = _imgPushChain.then(() => pushGraphicImage(imageId)).catch(() => false);
  return _imgPushChain;
}
// Envoie toutes les images pas encore synchronisées d'un manuscrit (appelée à l'ouverture).
async function syncUpGraphicImages(docId) {
  if (!imageSyncReady()) return 0;
  const recs = await getAllGraphicImagesForDocument(docId);
  let sent = 0;
  for (const rec of recs) if (rec.enc && !rec.synced && await queueGraphicImagePush(rec.id)) sent++;
  return sent;
}
async function countUnsyncedGraphicImages(docId) {
  const recs = await getAllGraphicImagesForDocument(docId);
  return recs.filter(r => !r.synced).length;
}

// Récupère une image absente de cet appareil. Le contexte (manuscrit, profil) est celui du manuscrit ouvert.
async function pullGraphicImage(imageId) {
  if (!imageSyncReady() || typeof _currentDocumentId === 'undefined' || !_currentDocumentId || !imagesCanEncrypt()) return null;
  try {
    const resp = await fetchWithTimeout(imageSyncUrl(imageRemoteKey(_currentDocumentId, imageId)), {
      timeoutMs: 120000, headers: { 'Authorization': 'Bearer ' + getSyncKey() }
    });
    if (!resp.ok) return null;
    const obj = await resp.json();
    if (!obj || !obj.data) return null;
    return await restoreGraphicImage({ id: imageId, docId: _currentDocumentId, cipherBytes: imgBase64ToBytes(obj.data), mime: obj.mime, width: obj.w, height: obj.h, refCount: 1, synced: true });
  } catch (e) { return null; }
}

// Suppression côté serveur (meilleur effort). v9.30.0 : généralisée à toute clé que le Worker accepte de supprimer
// (images, et manuscrits / historiques IA marqués supprimés dans l'index). Un échec réseau est mémorisé et retenté
// au démarrage ; un refus 403 (la pierre tombale n'est pas encore arrivée sur le serveur) est retenté quelques
// fois seulement.
const IMG_DELETES_KEY = 'plume_img_remote_deletes';
const REMOTE_DELETE_MAX_REFUSALS = 5;
// Entrées { k: clé, n: refus déjà reçus } ; les anciennes entrées (simples chaînes) restent lisibles.
function pendingRemoteDeleteEntries() {
  try {
    const v = JSON.parse(localStorage.getItem(IMG_DELETES_KEY) || '[]');
    return (Array.isArray(v) ? v : []).map(e => typeof e === 'string' ? { k: e, n: 0 } : e).filter(e => e && e.k);
  } catch (e) { return []; }
}
function pendingImageDeletes() { return pendingRemoteDeleteEntries().map(e => e.k); }
function savePendingRemoteDeletes(entries) { try { localStorage.setItem(IMG_DELETES_KEY, JSON.stringify(entries)); } catch (e) { /* stockage plein */ } }
function rememberRemoteDelete(key, refused) {
  const list = pendingRemoteDeleteEntries();
  const cur = list.find(e => e.k === key);
  if (cur) { if (refused) cur.n = (cur.n || 0) + 1; } else list.push({ k: key, n: refused ? 1 : 0 });
  savePendingRemoteDeletes(list.filter(e => (e.n || 0) < REMOTE_DELETE_MAX_REFUSALS));
}
function forgetRemoteDelete(key) { savePendingRemoteDeletes(pendingRemoteDeleteEntries().filter(e => e.k !== key)); }
// Renvoie true si la clé n'existe plus sur le serveur (supprimée, ou déjà absente).
async function deleteRemoteKey(key, opts) {
  opts = opts || {};
  if (typeof getSyncKey !== 'function' || !getSyncKey() || typeof fetchWithTimeout !== 'function') return false;
  try {
    const resp = await fetchWithTimeout(imageSyncUrl(key), { method: 'DELETE', timeoutMs: 20000, headers: { 'Authorization': 'Bearer ' + getSyncKey() } });
    if (resp.ok) { forgetRemoteDelete(key); return true; }
    if (resp.status === 400 || resp.status === 405) { forgetRemoteDelete(key); return false; } // ancienne version du Worker : rien à retenter
    if (opts.remember !== false) rememberRemoteDelete(key, resp.status === 403);
    return false;
  } catch (e) { /* hors-ligne : retenté plus tard */ }
  if (opts.remember !== false) rememberRemoteDelete(key, false);
  return false;
}
async function deleteRemoteGraphicImage(docId, imageId, profileId) {
  return deleteRemoteKey(imageRemoteKey(docId, imageId, profileId));
}
async function retryPendingImageDeletes() {
  for (const e of pendingRemoteDeleteEntries()) await deleteRemoteKey(e.k);
}
