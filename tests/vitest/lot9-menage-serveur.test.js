// ═══════════════════════════════════════════════════════
// LOT 9 (v9.30.0) — MÉNAGE SERVEUR DES MANUSCRITS SUPPRIMÉS
// Le contenu chiffré d'un manuscrit supprimé (et son historique de chat IA) est effacé du serveur, mais
// UNIQUEMENT si l'index de bibliothèque porte la pierre tombale : un manuscrit vivant ne peut pas être effacé.
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
const KEY = 'cle-synchro-lot9';
const PID = 'p1';
let seq = 0;

function makeServer() {
  const d1 = new FakeD1();
  const worker = new Function(fs.readFileSync(path.join(ROOT, 'worker', 'sync-worker.js'), 'utf8').replace('export default', 'return'))();
  const env = { SYNC_KEY: KEY, DB: d1 };
  const serverFetch = (url, opts = {}) => worker.fetch(new Request(url, { method: (opts && opts.method) || 'GET', headers: { 'CF-Connecting-IP': '3.3.3.3', ...((opts && opts.headers) || {}) }, body: (opts && opts.body) || undefined }), env);
  const call = (key, method = 'GET', body, base = '0') => serverFetch('https://s/?key=' + key, { method, body, headers: { Authorization: 'Bearer ' + KEY, 'X-Plume-Base-Version': base } });
  return { d1, serverFetch, call };
}
const index = (docs, deleted) => JSON.stringify({ version: 1, documents: docs.map(id => ({ id, title: id, lastModified: 1 })), deleted: deleted.map(id => ({ id, at: Date.now() })) });

describe('Worker : DELETE d\'un manuscrit ou d\'un historique IA', () => {
  it('refusé (403) sans pierre tombale : un manuscrit vivant ne peut pas être effacé', async () => {
    const s = makeServer();
    await s.call('doclist_p1', 'PUT', index(['m1'], []));
    await s.call('doc_p1_m1', 'PUT', '"contenu"');
    expect((await s.call('doc_p1_m1', 'DELETE')).status).toBe(403);
    expect(await (await s.call('doc_p1_m1')).text()).toBe('"contenu"');
  });
  it('refusé (403) si l\'index du profil n\'existe pas ou ne mentionne pas CE manuscrit', async () => {
    const s = makeServer();
    await s.call('doc_p1_m1', 'PUT', '"x"');
    expect((await s.call('doc_p1_m1', 'DELETE')).status).toBe(403);           // pas d'index
    await s.call('doclist_p1', 'PUT', index([], ['autre']));
    expect((await s.call('doc_p1_m1', 'DELETE')).status).toBe(403);           // tombale d'un autre manuscrit
    await s.call('doclist_q9', 'PUT', index([], ['m1']));
    expect((await s.call('doc_p1_m1', 'DELETE')).status).toBe(403);           // tombale dans l'index d'un AUTRE profil
  });
  it('accepté avec la pierre tombale : le manuscrit ET son historique IA disparaissent, rien d\'autre', async () => {
    const s = makeServer();
    await s.call('doclist_p1', 'PUT', index(['m2'], ['m1']));
    for (const k of ['doc_p1_m1', 'aichat_p1_m1', 'doc_p1_m2']) await s.call(k, 'PUT', '"x"');
    expect((await s.call('doc_p1_m1', 'DELETE')).status).toBe(200);
    expect((await s.call('aichat_p1_m1', 'DELETE')).status).toBe(200);
    expect(await (await s.call('doc_p1_m1')).text()).toBe('null');
    expect(await (await s.call('aichat_p1_m1')).text()).toBe('null');
    expect(await (await s.call('doc_p1_m2')).text()).toBe('"x"');             // l'autre manuscrit est intact
    expect(s.d1.count('sync_chunks')).toBe(s.d1.count('sync_meta'));          // aucun morceau orphelin
    expect((await s.call('doc_p1_m1', 'DELETE')).status).toBe(200);           // idempotent
  });
  it('un manuscrit découpé en plusieurs morceaux est entièrement effacé', async () => {
    const s = makeServer();
    await s.call('doclist_p1', 'PUT', index([], ['gros']));
    await s.call('doc_p1_gros', 'PUT', 'x'.repeat(1_800_000));
    expect(s.d1.count('sync_chunks')).toBeGreaterThan(3);
    expect((await s.call('doc_p1_gros', 'DELETE')).status).toBe(200);
    expect(s.d1.count('sync_meta')).toBe(1);                                  // il ne reste que l'index
  });
  it('profils, index, réglages et données : toujours 405 ; format invalide : 405 ; sans clé : 401', async () => {
    const s = makeServer();
    for (const k of ['profiles', 'doclist_p1', 'libsettings_p1', 'data_p1', 'main']) expect((await s.call(k, 'DELETE')).status, k).toBe(405);
    expect((await s.call('doc_p1_m_1_x', 'DELETE')).status).toBe(405);
    expect((await s.serverFetch('https://s/?key=doc_p1_m1', { method: 'DELETE' })).status).toBe(401);
  });
});

describe('Client : suppression d\'un manuscrit = effacement serveur (deux appareils)', () => {
  function makeDevice(serverFetch) {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
    const ctx = dom.window; vm.createContext(ctx);
    Object.defineProperty(ctx, 'crypto', { value: globalThis.crypto, configurable: true });
    ctx.Request = globalThis.Request; ctx.Response = globalThis.Response; ctx.fetch = (u, o) => serverFetch(u, o);
    ctx.toast = vi.fn(); ctx.DOMPurify = { sanitize: x => x };
    ctx.indexedDB = globalThis.indexedDB; ctx.IDBKeyRange = globalThis.IDBKeyRange; ctx.idb = idb;
    for (const f of ['schema.js', 'crypto.js', 'images.js', 'router.js', 'library.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8').replace("'plume_epique_images'", "'plume_epique_images_lot9_" + (++seq) + "'"), ctx, { filename: f });
    ctx.onload = null; ctx.setSyncKey(KEY);
    vm.runInContext(`_dataKey = 'cle-donnees'; _currentProfileId = '${PID}';`, ctx);
    ctx.showConfirmModal = async () => true; ctx.renderLibraryScreen = async () => {};
    return ctx;
  }
  const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 0)); };
  const docKey = id => 'doc_' + PID + '_' + id;
  async function creer(ctx, id) {
    await ctx.persistData(docKey(id), await ctx.makeEncryptedEnvelope(JSON.stringify({ _schemaVersion: 1, title: id, chapters: [] })));
    await ctx.persistData('aichat_' + PID + '_' + id, { _enc: true, data: 'historique-ia' });
    await ctx.mutateDocList(l => { l.documents.push({ id, title: id, lastModified: Date.now() }); });
    ctx.flushPendingSyncPushes(); await settle();
  }

  it('deleteDocument : la pierre tombale part d\'abord, puis le contenu chiffré et le chat IA sont effacés du serveur', async () => {
    const s = makeServer(); const a = makeDevice(s.serverFetch);
    await creer(a, 'm1'); await creer(a, 'm2');
    expect(await (await s.call(docKey('m1'))).text()).not.toBe('null');
    await a.deleteDocument('m1'); await settle();
    expect(await (await s.call(docKey('m1'))).text()).toBe('null');
    expect(await (await s.call('aichat_p1_m1')).text()).toBe('null');
    expect(await (await s.call(docKey('m2'))).text()).not.toBe('null');       // l'autre manuscrit reste
    const idx = JSON.parse(await (await s.call('doclist_p1')).text());
    expect(idx.deleted.map(t => t.id)).toEqual(['m1']);
    expect(a.pendingImageDeletes()).toEqual([]);                               // rien en attente
  });

  it('un second appareil ne ressuscite pas le manuscrit et ne le renvoie pas au serveur', async () => {
    const s = makeServer(); const a = makeDevice(s.serverFetch), b = makeDevice(s.serverFetch);
    await creer(a, 'm1');
    await b.syncReconcileKey('doclist_p1'); await b.syncReconcileKey(docKey('m1')); await settle();
    await a.deleteDocument('m1'); await settle();
    await b.syncReconcileKey('doclist_p1'); await settle();
    expect(await b.readLocalOnly(docKey('m1'))).toBeFalsy();
    b.flushPendingSyncPushes(); await settle();
    expect(await (await s.call(docKey('m1'))).text()).toBe('null');
  });

  it('balayage au démarrage : un manuscrit supprimé avant la v9.30.0 (tombale déjà là, contenu resté) est effacé, une seule fois', async () => {
    const s = makeServer(); const a = makeDevice(s.serverFetch);
    await s.call('doclist_p1', 'PUT', index(['m2'], ['ancien']));
    await s.call(docKey('ancien'), 'PUT', '"vieux contenu chiffré"');
    await s.call(docKey('m2'), 'PUT', '"vivant"');
    await a.syncReconcileKey('doclist_p1'); await settle();
    expect(await a.sweepRemoteTombstones()).toBe(1);
    expect(await (await s.call(docKey('ancien'))).text()).toBe('null');
    expect(await (await s.call(docKey('m2'))).text()).toBe('"vivant"');
    expect(await a.sweepRemoteTombstones()).toBe(0);                           // déjà balayé : aucune requête de plus
  });

  it('serveur injoignable pendant la suppression : retenté au démarrage suivant, sans rien perdre', async () => {
    const s = makeServer();
    let enPanne = false;
    const a = makeDevice((u, o) => { if (enPanne && o && o.method === 'DELETE') throw new Error('hors-ligne'); return s.serverFetch(u, o); });
    await creer(a, 'm1');
    enPanne = true;
    await a.deleteDocument('m1'); await settle();
    expect(await (await s.call(docKey('m1'))).text()).not.toBe('null');        // contenu encore là
    expect(a.pendingImageDeletes().length).toBe(2);                            // doc + chat IA en attente
    enPanne = false;
    await a.retryPendingImageDeletes(); await settle();
    expect(await (await s.call(docKey('m1'))).text()).toBe('null');
    expect(a.pendingImageDeletes()).toEqual([]);
  });

  it('refus 403 répétés (tombale jamais arrivée) : abandon après 5 essais, pas de boucle sans fin', async () => {
    const s = makeServer(); const a = makeDevice(s.serverFetch);
    await s.call(docKey('x'), 'PUT', '"x"');                                   // aucune pierre tombale côté serveur
    await a.deleteRemoteKey(docKey('x'));                                      // 1er refus : mis en attente
    expect(a.pendingImageDeletes()).toEqual([docKey('x')]);
    for (let i = 0; i < 6; i++) await a.retryPendingImageDeletes();            // démarrages suivants
    expect(a.pendingImageDeletes()).toEqual([]);                               // abandonné après 5 refus au total
    expect(await (await s.call(docKey('x'))).text()).toBe('"x"');              // et rien n'a été effacé
  });
});
