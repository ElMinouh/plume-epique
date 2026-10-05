// ═══════════════════════════════════════════════════════
// LOT 7 (v9.28.0) — IMAGES DU ROMAN GRAPHIQUE (AUD-01-011 / 026)
//  A. chiffrement au repos + conversion des images en clair ;
//  B. Gist : octets chiffrés tels quels, envoi par paquets, erreurs précises ;
//  C. synchronisation entre appareils via le Worker (D1) : envoi unique, récupération à la
//     demande, suppression, budget.
// ═══════════════════════════════════════════════════════
import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as idb from 'idb';
import 'fake-indexeddb/auto';
import { FakeD1 } from './fake-d1.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const JS = f => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
const SYNC_KEY = 'cle-synchro-test';
let seq = 0;

function makeServer({ imgBudget } = {}) {
  const d1 = new FakeD1();
  let src = fs.readFileSync(path.join(ROOT, 'worker', 'sync-worker.js'), 'utf8').replace('export default', 'return');
  if (imgBudget) src = src.replace('350 * 1024 * 1024', String(imgBudget));
  const worker = new Function(src)();
  const env = { SYNC_KEY, DB: d1 };
  const serverFetch = (url, opts = {}) => worker.fetch(new Request(url, { method: (opts && opts.method) || 'GET', headers: { 'CF-Connecting-IP': '9.9.9.9', ...((opts && opts.headers) || {}) }, body: (opts && opts.body) || undefined }), env);
  return { d1, serverFetch, worker, env };
}

// Un « appareil » : contexte jsdom + base d'images propre + clé de données `dek`.
function makeDevice({ dek = 'cle-donnees-A', serverFetch, github, profile = 'p1', docId = 'doc1' } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
  const ctx = dom.window;
  vm.createContext(ctx);
  Object.defineProperty(ctx, 'crypto', { value: globalThis.crypto, configurable: true });
  ctx.indexedDB = globalThis.indexedDB; ctx.IDBKeyRange = globalThis.IDBKeyRange; ctx.idb = idb;
  ctx.Request = globalThis.Request; ctx.Response = globalThis.Response;
  ctx.fetch = (url, opts) => (github && /api\.github\.com/.test(String(url))) ? github(url, opts) : serverFetch(url, opts);
  ctx.toast = vi.fn(); ctx.DOMPurify = { sanitize: x => x };
  ctx.URL.createObjectURL = () => 'blob:test-' + (++seq); ctx.URL.revokeObjectURL = () => {};
  for (const f of ['schema.js', 'crypto.js']) vm.runInContext(JS(f), ctx, { filename: f });
  vm.runInContext(JS('images.js').replace("'plume_epique_images'", `'plume_epique_images_lot7_${++seq}'`), ctx, { filename: 'images.js' });
  vm.runInContext(JS('router.js'), ctx, { filename: 'router.js' });
  vm.runInContext(JS('library.js'), ctx, { filename: 'library.js' });
  ctx.onload = null;
  ctx.Crypto = vm.runInContext('Crypto', ctx); // const de niveau supérieur : pas une propriété du contexte
  vm.runInContext(`_dataKey = ${JSON.stringify(dek)}; _currentProfileId = ${JSON.stringify(profile)}; _currentDocumentId = ${JSON.stringify(docId)};`, ctx);
  if (serverFetch) ctx.setSyncKey(SYNC_KEY);
  // compression simulée : le « fichier » EST déjà l'image finale
  ctx.compressImageFile = async file => ({ blob: file, width: 640, height: 480 });
  return ctx;
}
const png = (marker, extra = 0) => new Blob([new Uint8Array([137, 80, 78, 71]), new TextEncoder().encode('SECRET-PIXELS-' + marker), new Uint8Array(extra).fill(7)], { type: 'image/webp' });
const contains = (haystack, needle) => { const h = Buffer.from(haystack), n = Buffer.from(needle); return h.includes(n); };
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r, 0)); };

describe('A. Chiffrement au repos', () => {
  it('une image importée est stockée chiffrée : les octets en clair n\'apparaissent nulle part dans l\'enregistrement', async () => {
    const dev = makeDevice();
    const { imageId } = await dev.storeGraphicImage(png('A'), 'doc1');
    const rec = (await dev.getAllGraphicImagesForDocument('doc1'))[0];
    expect(rec.enc).toBe(true);
    expect(rec.blob).toBeUndefined();
    expect(contains(new Uint8Array(rec.data), 'SECRET-PIXELS-A')).toBe(false);
    const clair = await dev.graphicImageBytes(rec);
    expect(contains(clair, 'SECRET-PIXELS-A')).toBe(true);
    expect(rec.size).toBe(clair.length);
    expect(await dev.graphicImageUrl(imageId)).toMatch(/^blob:/);
  });

  it('une autre clé de données (autre profil) ne peut pas lire l\'image ; une altération est détectée', async () => {
    const dev = makeDevice();
    await dev.storeGraphicImage(png('B'), 'doc1');
    const rec = (await dev.getAllGraphicImagesForDocument('doc1'))[0];
    expect(await dev.Crypto.decryptBytes(new Uint8Array(rec.data), 'autre-cle')).toBeNull();
    const abime = new Uint8Array(rec.data); abime[abime.length - 1] ^= 1;
    expect(await dev.Crypto.decryptBytes(abime, 'cle-donnees-A')).toBeNull();
  });

  it('l\'empreinte de déduplication dépend de la clé du profil (deux profils : empreintes différentes) mais déduplique dans un même profil', async () => {
    const a = makeDevice({ dek: 'cle-1' }), b = makeDevice({ dek: 'cle-2' });
    await a.storeGraphicImage(png('X'), 'doc1'); await a.storeGraphicImage(png('X'), 'doc1');
    await b.storeGraphicImage(png('X'), 'doc1');
    const ra = await a.getAllGraphicImagesForDocument('doc1'), rb = await b.getAllGraphicImagesForDocument('doc1');
    expect(ra.length).toBe(1); expect(ra[0].refCount).toBe(2);
    expect(ra[0].hash).not.toBe(rb[0].hash);
  });

  it('conversion des images d\'avant (en clair) : chiffrées, identiques à la relecture, refCount conservé, sans doublon', async () => {
    const dev = makeDevice();
    const database = await dev.plumeImagesDb();
    await database.put('images', { id: 'old1', docId: 'doc1', blob: png('ANCIEN'), width: 10, height: 20, hash: 'h', refCount: 3, createdAt: 5 });
    expect(await dev.migrateGraphicImagesToEncrypted('doc1')).toBe(1);
    const rec = await database.get('images', 'old1');
    expect(rec.enc).toBe(true); expect(rec.blob).toBeUndefined();
    expect(rec.refCount).toBe(3); expect(rec.width).toBe(10); expect(rec.createdAt).toBe(5);
    expect(contains(new Uint8Array(rec.data), 'SECRET-PIXELS-ANCIEN')).toBe(false);
    expect(contains(await dev.graphicImageBytes(rec), 'SECRET-PIXELS-ANCIEN')).toBe(true);
    expect(await dev.migrateGraphicImagesToEncrypted('doc1')).toBe(0); // idempotent
    expect(await dev.graphicImageUrl('old1')).toMatch(/^blob:/);       // et toujours affichable
  });

  it('une image ancienne reste lisible tant qu\'elle n\'est pas convertie', async () => {
    const dev = makeDevice();
    await (await dev.plumeImagesDb()).put('images', { id: 'old2', docId: 'doc1', blob: png('LEGACY'), width: 1, height: 1, refCount: 1 });
    expect(await dev.graphicImageUrl('old2')).toMatch(/^blob:/);
  });

  it('restoreGraphicImage : octets chiffrés d\'un autre profil refusés (null) ; octets en clair chiffrés au repos', async () => {
    const a = makeDevice({ dek: 'cle-1' }), b = makeDevice({ dek: 'cle-2' });
    const cipherA = await a.Crypto.encryptBytes(new TextEncoder().encode('image-de-A'), 'cle-1');
    expect(await b.restoreGraphicImage({ id: 'i', docId: 'doc1', cipherBytes: cipherA })).toBeNull();
    const rec = await b.restoreGraphicImage({ id: 'j', docId: 'doc1', plainBytes: new TextEncoder().encode('image-en-clair') });
    expect(rec.enc).toBe(true);
    expect(contains(new Uint8Array(rec.data), 'image-en-clair')).toBe(false);
  });
});

describe('B. Sauvegarde Gist : octets chiffrés, paquets, erreurs précises (AUD-01-026)', () => {
  async function livre(dev, nbImages, taille) {
    const pages = [];
    for (let i = 0; i < nbImages; i++) {
      const { imageId } = await dev.storeGraphicImage(png('P' + i, taille), 'doc1');
      pages.push({ id: 'pg' + i, elements: [{ id: 'e' + i, type: 'image', imageId }] });
    }
    await dev.persistManuscriptData('doc1', { _schemaVersion: dev.SCHEMA_VERSION || 17, docType: 'roman_graphique', title: 'Livre', pages, trash: [], history: {} });
    await dev.mutateDocList(l => { l.documents.push({ id: 'doc1', title: 'Livre', docType: 'roman_graphique', lastModified: 1 }); });
  }

  it('3 images de ~2 Mo : plusieurs requêtes (paquets ≤ 8 Mo), contenu « v2: », aucun octet en clair, ids retenus', async () => {
    const calls = [];
    const github = async (url, opts) => { calls.push({ method: opts.method, files: Object.keys(JSON.parse(opts.body).files), bodyLen: opts.body.length, body: opts.body }); return new Response(JSON.stringify({ id: 'gist-1' }), { status: 200 }); };
    const dev = makeDevice({ serverFetch: makeServer().serverFetch, github });
    dev.setSyncKey = undefined; // pas de synchro réseau d'images dans ce test
    vm.runInContext("_cloudToken = 'ghp_x'; getSyncKey = () => '';", dev);
    await livre(dev, 3, 2_000_000);
    expect(await dev.libSyncManuscript('doc1', { silent: true })).toBe(true);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0].method).toBe('POST');
    expect(calls.slice(1).every(c => c.method === 'PATCH')).toBe(true);
    for (const c of calls) expect(c.bodyLen).toBeLessThan(9_500_000);
    const imgFiles = calls.flatMap(c => c.files.filter(f => f.startsWith('img_')));
    expect(imgFiles.length).toBe(3);
    expect(calls.every(c => !c.body.includes('SECRET-PIXELS'))).toBe(true);
    expect(calls[0].body).toContain('v2:');
    const m = await dev.loadManuscriptData('doc1');
    expect(m.gistId).toBe('gist-1');
    expect(m.gistSyncedImageIds.length).toBe(3);
  });

  it('échec au 2e paquet : message précis (HTTP 422 + détail), mais gistId et images déjà parties sont retenus', async () => {
    let n = 0;
    const github = async () => (++n === 1)
      ? new Response(JSON.stringify({ id: 'gist-2' }), { status: 200 })
      : new Response(JSON.stringify({ message: 'Payload too large' }), { status: 422 });
    const dev = makeDevice({ serverFetch: makeServer().serverFetch, github });
    vm.runInContext("_cloudToken = 'ghp_x'; getSyncKey = () => '';", dev);
    await livre(dev, 3, 2_000_000);
    expect(await dev.libSyncManuscript('doc1', { silent: false })).toBe(false);
    expect(dev.toast).toHaveBeenCalledWith(expect.stringMatching(/HTTP 422.*Payload too large/), 'error');
    const m = await dev.loadManuscriptData('doc1');
    expect(m.gistId).toBe('gist-2');                       // le Gist créé est mémorisé (pas de doublon au prochain essai)
    expect(m.gistSyncedImageIds.length).toBeGreaterThanOrEqual(1);
    expect(m.gistSyncedImageIds.length).toBeLessThan(3);   // et seulement ce qui est réellement parti
  });

  it('restauration depuis le nouveau format ET depuis l\'ancien format (base64 chiffré comme un texte)', async () => {
    const dev = makeDevice();
    const octets = new TextEncoder().encode('SECRET-PIXELS-GIST');
    const cipher = await dev.Crypto.encryptBytes(octets, 'cle-donnees-A');
    const v2 = await dev.restoreGraphicImage({ id: 'n1', docId: 'doc1', cipherBytes: cipher, mime: 'image/webp' });
    expect(contains(await dev.graphicImageBytes(v2), 'SECRET-PIXELS-GIST')).toBe(true);
    const ancien = await dev.Crypto.encrypt(dev.imgBytesToBase64(octets), 'cle-donnees-A');
    const b64 = await dev.Crypto.decrypt(ancien, 'cle-donnees-A');
    const v1 = await dev.restoreGraphicImage({ id: 'n2', docId: 'doc1', plainBytes: dev.imgBase64ToBytes(b64) });
    expect(v1.enc).toBe(true);
    expect(contains(await dev.graphicImageBytes(v1), 'SECRET-PIXELS-GIST')).toBe(true);
  });
});

describe('C. Synchronisation des images entre appareils (D1)', () => {
  it('A envoie l\'image une seule fois ; B la récupère à la demande, chiffrée, et l\'affiche', async () => {
    const s = makeServer();
    const a = makeDevice({ serverFetch: s.serverFetch }), b = makeDevice({ serverFetch: s.serverFetch });
    const { imageId } = await a.storeGraphicImage(png('SYNC'), 'doc1');
    await a.queueGraphicImagePush(imageId); await settle();
    const recA = (await a.getAllGraphicImagesForDocument('doc1'))[0];
    expect(recA.synced).toBe(true);
    expect(s.d1.count('sync_meta')).toBe(1);
    // le serveur ne contient jamais les octets en clair
    const brut = s.d1.db.prepare('SELECT data FROM sync_chunks').all().map(r => r.data).join('');
    expect(brut).not.toContain('SECRET-PIXELS');
    expect(brut).not.toContain(Buffer.from('SECRET-PIXELS-SYNC').toString('base64'));
    // B ne connaît pas l'image : elle est tirée du serveur
    expect(await b.getAllGraphicImagesForDocument('doc1')).toHaveLength(0);
    expect(await b.graphicImageUrl(imageId)).toMatch(/^blob:/);
    const recB = (await b.getAllGraphicImagesForDocument('doc1'))[0];
    expect(recB.enc).toBe(true); expect(recB.synced).toBe(true);
    expect(contains(await b.graphicImageBytes(recB), 'SECRET-PIXELS-SYNC')).toBe(true);
    // un second envoi est ignoré (déjà synchronisée) : aucune écriture de plus
    const avant = s.d1.count('sync_chunks');
    await a.queueGraphicImagePush(imageId); await settle();
    expect(s.d1.count('sync_chunks')).toBe(avant);
  });

  it('un autre profil (autre clé de données) ne peut pas lire l\'image récupérée du serveur', async () => {
    const s = makeServer();
    const a = makeDevice({ serverFetch: s.serverFetch, dek: 'cle-1' }), intrus = makeDevice({ serverFetch: s.serverFetch, dek: 'cle-2' });
    const { imageId } = await a.storeGraphicImage(png('PRIVE'), 'doc1');
    await a.queueGraphicImagePush(imageId); await settle();
    expect(await intrus.graphicImageUrl(imageId)).toBeNull();
    expect(await intrus.getAllGraphicImagesForDocument('doc1')).toHaveLength(0); // rien d'illisible n'est gardé
  });

  it('images d\'avant la synchro : envoyées à l\'ouverture (syncUpGraphicImages) après conversion', async () => {
    const s = makeServer();
    const a = makeDevice({ serverFetch: s.serverFetch });
    await (await a.plumeImagesDb()).put('images', { id: 'ancienne', docId: 'doc1', blob: png('VIEILLE'), width: 4, height: 4, refCount: 1 });
    await a.migrateGraphicImagesToEncrypted('doc1');
    expect(await a.countUnsyncedGraphicImages('doc1')).toBe(1);
    expect(await a.syncUpGraphicImages('doc1')).toBe(1);
    expect(await a.countUnsyncedGraphicImages('doc1')).toBe(0);
  });

  it('supprimer l\'image (compteur à 0) ou tout le manuscrit la retire aussi du serveur', async () => {
    const s = makeServer();
    const a = makeDevice({ serverFetch: s.serverFetch });
    const i1 = (await a.storeGraphicImage(png('D1'), 'doc1')).imageId, i2 = (await a.storeGraphicImage(png('D2'), 'doc1')).imageId;
    await a.queueGraphicImagePush(i1); await a.queueGraphicImagePush(i2); await settle();
    expect(s.d1.count('sync_meta')).toBe(2);
    await a.reconcileGraphicImageRef(i1, 0); await settle();
    expect(s.d1.count('sync_meta')).toBe(1);
    await a.deleteAllGraphicImagesForDocument('doc1', { profileId: 'p1' }); await settle();
    expect(s.d1.count('sync_meta')).toBe(0);
    expect(s.d1.count('sync_chunks')).toBe(0);
  });

  it('suppression venue d\'un autre appareil (localOnly) : la copie locale part, pas celle du serveur', async () => {
    const s = makeServer();
    const a = makeDevice({ serverFetch: s.serverFetch });
    const { imageId } = await a.storeGraphicImage(png('L'), 'doc1');
    await a.queueGraphicImagePush(imageId); await settle();
    await a.deleteAllGraphicImagesForDocument('doc1', { localOnly: true }); await settle();
    expect(await a.getAllGraphicImagesForDocument('doc1')).toHaveLength(0);
    expect(s.d1.count('sync_meta')).toBe(1);
  });

  it('budget d\'images dépassé : refus 507, l\'image reste locale (non synchronisée), l\'utilisateur est prévenu une fois', async () => {
    const s = makeServer({ imgBudget: 500 });
    const a = makeDevice({ serverFetch: s.serverFetch });
    const { imageId } = await a.storeGraphicImage(png('GROS', 5000), 'doc1');
    expect(await a.pushGraphicImage(imageId)).toBe(false);
    const rec = (await a.getAllGraphicImagesForDocument('doc1'))[0];
    expect(rec.synced).toBe(false);
    expect(s.d1.count('sync_meta')).toBe(0);
    expect(a.toast).toHaveBeenCalledWith(expect.stringMatching(/stockage de synchronisation des images est plein/), 'error');
    a.toast.mockClear();
    await a.pushGraphicImage(imageId);          // bloqué 1 h : pas de nouvelle tentative ni de nouveau message
    expect(a.toast).not.toHaveBeenCalled();
  });

  it('sans clé de synchronisation : aucune requête, l\'image reste locale', async () => {
    const s = makeServer();
    const spy = vi.fn(s.serverFetch);
    const a = makeDevice({ serverFetch: spy });
    vm.runInContext("localStorage.removeItem('plume_sync_key')", a);
    const { imageId } = await a.storeGraphicImage(png('LOCAL'), 'doc1');
    await settle();
    expect(spy).not.toHaveBeenCalled();
    expect((await a.getAllGraphicImagesForDocument('doc1'))[0].synced).toBe(false);
  });
});

describe('Worker : clés img_* et suppression', () => {
  const call = (s, key, { method = 'GET', body, base = '0' } = {}) => s.serverFetch(`https://s/?key=${key}`, { method, body, headers: { Authorization: 'Bearer ' + SYNC_KEY, 'X-Plume-Base-Version': base } });
  it('img_<profil>_<manuscrit>_<image> accepté ; DELETE refusé pour les clés protégées', async () => {
    const s = makeServer();
    expect((await call(s, 'img_p1_d1_i1', { method: 'PUT', body: '{"v":1}' })).status).toBe(200);
    expect((await call(s, 'doc_p1_d1', { method: 'DELETE' })).status).toBe(403); // v9.30.0 : permis seulement avec pierre tombale (voir lot9)
    expect((await call(s, 'profiles', { method: 'DELETE' })).status).toBe(405);
    expect((await call(s, 'img_p1_d1_i1', { method: 'DELETE' })).status).toBe(200);
    expect(await (await call(s, 'img_p1_d1_i1')).text()).toBe('null');
    expect((await call(s, 'img_trop_court', { method: 'PUT', body: 'x' })).status).toBe(400);
  });
  it('mode KV (sans D1) : même contrat, suppression comprise', async () => {
    const kv = new Map();
    const env = { SYNC_KEY, PLUME_SYNC: { async getWithMetadata(k) { return kv.get(k) || { value: null, metadata: null }; }, async put(k, v, o) { kv.set(k, { value: v, metadata: o.metadata }); }, async delete(k) { kv.delete(k); } } };
    const worker = new Function(fs.readFileSync(path.join(ROOT, 'worker', 'sync-worker.js'), 'utf8').replace('export default', 'return'))();
    const r = m => worker.fetch(new Request('https://s/?key=img_p_d_i', { method: m, body: m === 'PUT' ? 'x' : undefined, headers: { Authorization: 'Bearer ' + SYNC_KEY, 'X-Plume-Base-Version': '0', 'CF-Connecting-IP': '8.8.8.8' } }), env);
    expect((await r('PUT')).status).toBe(200);
    expect((await r('DELETE')).status).toBe(200);
    expect(kv.size).toBe(0);
  });
});
