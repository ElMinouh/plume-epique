// ═══════════════════════════════════════════════════════
// LOT 7 (v9.39.0) — CORBEILLE DE MANUSCRITS, SUPPRESSION DE PROFIL, RÉIMPORT (AUD-02-014 / 015 / 022)
// Deux appareils (deux contextes jsdom) partagent le VRAI Worker de synchro sur une base D1 simulée.
//  • un manuscrit supprimé va 30 jours à la corbeille, sur tous les appareils, sans rien effacer du serveur ;
//  • passé 30 jours : suppression définitive (pierre tombale + effacement serveur) ;
//  • un profil supprimé ne réapparaît pas quand un autre appareil renvoie sa copie ;
//  • réimporter un fichier de bibliothèque n'ajoute pas les manuscrits déjà présents.
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
const KEY = 'cle-synchro-lot17';
const PID = 'p1';
let seq = 0;

function makeServer() {
  const d1 = new FakeD1();
  const worker = new Function(fs.readFileSync(path.join(ROOT, 'worker', 'sync-worker.js'), 'utf8').replace('export default', 'return'))();
  const env = { SYNC_KEY: KEY, DB: d1 };
  const serverFetch = (url, opts = {}) => worker.fetch(new Request(url, { method: (opts && opts.method) || 'GET', headers: { 'CF-Connecting-IP': '4.4.4.4', ...((opts && opts.headers) || {}) }, body: (opts && opts.body) || undefined }), env);
  const call = (key, method = 'GET', body, base = '0') => serverFetch('https://s/?key=' + key, { method, body, headers: { Authorization: 'Bearer ' + KEY, 'X-Plume-Base-Version': base } });
  return { d1, serverFetch, call };
}
function makeDevice(serverFetch) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="doc-trash-overlay"></div><div id="doc-trash-list"></div></body></html>', { url: 'http://localhost/' });
  const ctx = dom.window; vm.createContext(ctx);
  Object.defineProperty(ctx, 'crypto', { value: globalThis.crypto, configurable: true });
  ctx.Request = globalThis.Request; ctx.Response = globalThis.Response; ctx.fetch = (u, o) => serverFetch(u, o);
  ctx.toast = vi.fn(); ctx.DOMPurify = { sanitize: x => x };
  ctx.indexedDB = globalThis.indexedDB; ctx.IDBKeyRange = globalThis.IDBKeyRange; ctx.idb = idb;
  for (const f of ['schema.js', 'icons.js', 'crypto.js', 'images.js', 'router.js', 'library.js', 'export-format-utils.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8').replace("'plume_epique_images'", "'plume_epique_images_lot17_" + (++seq) + "'"), ctx, { filename: f });
  ctx.onload = null; ctx.setSyncKey(KEY);
  vm.runInContext(`_dataKey = 'cle-donnees'; _currentProfileId = '${PID}';`, ctx);
  ctx.showConfirmModal = async () => true; ctx.renderLibraryScreen = async () => {};
  return ctx;
}
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 0)); };
const docKey = id => 'doc_' + PID + '_' + id;
async function creer(ctx, id) {
  await ctx.persistData(docKey(id), await ctx.makeEncryptedEnvelope(JSON.stringify({ _schemaVersion: 1, title: id, chapters: [] })));
  await ctx.mutateDocList(l => { l.documents.push({ id, title: id, lastModified: Date.now() }); });
  ctx.flushPendingSyncPushes(); await settle();
}

describe('Corbeille de manuscrits (AUD-02-014)', () => {
  it('« supprimer » met à la corbeille : le manuscrit sort de la bibliothèque mais rien n\'est effacé, ni en local ni sur le serveur', async () => {
    const s = makeServer(); const a = makeDevice(s.serverFetch);
    await creer(a, 'm1'); await creer(a, 'm2');
    await a.trashDocument('m1'); await settle();
    const list = await a.loadDocList();
    expect(a.liveDocuments(list).map(d => d.id)).toEqual(['m2']);
    expect(a.trashedDocuments(list).map(d => d.id)).toEqual(['m1']);
    expect(await a.readLocalOnly(docKey('m1'))).toBeTruthy();                          // contenu local intact
    expect(await (await s.call(docKey('m1'))).text()).not.toBe('null');               // contenu serveur intact
    expect((list.deleted || []).length).toBe(0);                                       // aucune pierre tombale
    const idx = JSON.parse(await (await s.call('doclist_p1')).text());
    expect(idx.documents.find(d => d.id === 'm1').trashedAt).toBeGreaterThan(0);       // la corbeille est partie au serveur
  });
  it('la corbeille est la même sur un second appareil, et la restauration aussi', async () => {
    const s = makeServer(); const a = makeDevice(s.serverFetch), b = makeDevice(s.serverFetch);
    await creer(a, 'm1');
    await b.syncReconcileKey('doclist_p1'); await settle();
    await a.trashDocument('m1'); await settle();
    await b.syncReconcileKey('doclist_p1'); await settle();
    expect(b.trashedDocuments(await b.loadDocList()).map(d => d.id)).toEqual(['m1']);
    await b.restoreDocumentFromTrash('m1'); await settle();
    await a.syncReconcileKey('doclist_p1'); await settle();
    const la = await a.loadDocList();
    expect(a.liveDocuments(la).map(d => d.id)).toEqual(['m1']);
    expect(a.trashedDocuments(la)).toEqual([]);
  });
  it('un appareil qui modifie le manuscrit sans connaître la corbeille le fait ressortir de la corbeille (jamais de perte)', async () => {
    const s = makeServer(); const a = makeDevice(s.serverFetch), b = makeDevice(s.serverFetch);
    await creer(a, 'm1');
    await b.syncReconcileKey('doclist_p1'); await settle();
    await a.trashDocument('m1'); await settle();
    await b.mutateDocList(l => { const e = l.documents.find(d => d.id === 'm1'); e.lastModified = Date.now() + 5000; e.wordCount = 99; }); // modification faite plus tard sur B
    await b.syncReconcileKey('doclist_p1'); await settle();
    expect(b.liveDocuments(await b.loadDocList()).map(d => d.id)).toEqual(['m1']);
  });
  it('après 30 jours : suppression définitive automatique (pierre tombale puis effacement serveur) ; avant : rien', async () => {
    const s = makeServer(); const a = makeDevice(s.serverFetch);
    await creer(a, 'm1'); await creer(a, 'm2'); await creer(a, 'm3');
    await a.trashDocument('m1'); await a.trashDocument('m2'); await settle();
    await a.mutateDocList(l => { l.documents.find(d => d.id === 'm1').trashedAt = Date.now() - 31 * 86400000; l.documents.find(d => d.id === 'm2').trashedAt = Date.now() - 5 * 86400000; });
    expect(await a.purgeExpiredDocTrash()).toBe(1);
    await settle();
    const list = await a.loadDocList();
    expect(list.documents.map(d => d.id).sort()).toEqual(['m2', 'm3']);
    expect(list.deleted.map(t => t.id)).toEqual(['m1']);
    expect(await (await s.call(docKey('m1'))).text()).toBe('null');                   // effacé du serveur
    expect(await (await s.call(docKey('m2'))).text()).not.toBe('null');               // m2 : encore 25 jours
  });
  it('jours restants : 30 au départ, arrondis au jour supérieur', async () => {
    const a = makeDevice(makeServer().serverFetch);
    expect(a.docTrashDaysLeft({ trashedAt: Date.now() })).toBe(30);
    expect(a.docTrashDaysLeft({ trashedAt: Date.now() - 29.5 * 86400000 })).toBe(1);
    expect(a.docTrashDaysLeft({ trashedAt: Date.now() - 40 * 86400000 })).toBe(0);
  });
});

describe('Suppression de profil (AUD-02-015)', () => {
  const p = (id, name = id) => ({ id, name, role: 'user' });
  it('un profil supprimé ne réapparaît pas quand l\'autre appareil renvoie sa copie', () => {
    const a = makeDevice(makeServer().serverFetch);
    const apresSuppression = { profiles: [p('admin')], deletedProfiles: [{ id: 'marie', at: Date.now() }] };
    const copieAncienne = { profiles: [p('admin'), p('marie')] };
    const m = a.mergeProfilesIndex(copieAncienne, apresSuppression);
    expect(m.profiles.map(x => x.id)).toEqual(['admin']);
    const m2 = a.mergeProfilesIndex(apresSuppression, copieAncienne);          // sens inverse : la copie ancienne arrive côté serveur
    expect(m2.profiles.map(x => x.id)).toEqual(['admin']);
    expect(m2.deletedProfiles.map(t => t.id)).toEqual(['marie']);
  });
  it('sans pierre tombale, la règle de sécurité reste : un profil local ne disparaît jamais par synchronisation', () => {
    const a = makeDevice(makeServer().serverFetch);
    const m = a.mergeProfilesIndex({ profiles: [p('admin'), p('marie')] }, { profiles: [p('admin')] });
    expect(m.profiles.map(x => x.id).sort()).toEqual(['admin', 'marie']);
  });
  it('une pierre tombale reçue efface la copie locale du profil (liste, manuscrits, réglages), jamais celle du profil ouvert', async () => {
    const s = makeServer(); const a = makeDevice(s.serverFetch);
    await a.writeLocalOnly('doclist_marie', { version: 1, documents: [{ id: 'x1', title: 'x' }] });
    await a.writeLocalOnly('doc_marie_x1', { _enc: true, data: 'c' });
    await a.writeLocalOnly('libsettings_marie', { a: 1 });
    await a.writeLocalOnly('doclist_p1', { version: 1, documents: [] });
    await a.purgeTombstonedProfiles({ deletedProfiles: [{ id: 'marie', at: Date.now() }, { id: 'p1', at: Date.now() }] });
    for (const k of ['doclist_marie', 'doc_marie_x1', 'libsettings_marie']) expect(await a.readLocalOnly(k), k).toBeFalsy();
    expect(await a.readLocalOnly('doclist_p1')).toBeTruthy();                         // profil ouvert : conservé
  });
  it('une pierre tombale trop ancienne (plus de 90 jours) est oubliée', () => {
    const a = makeDevice(makeServer().serverFetch);
    const m = a.mergeProfilesIndex({ profiles: [p('admin'), p('marie')] }, { profiles: [p('admin')], deletedProfiles: [{ id: 'marie', at: Date.now() - 100 * 86400000 }] });
    expect(m.profiles.map(x => x.id).sort()).toEqual(['admin', 'marie']);
  });
});

describe('Réimport d\'un fichier de bibliothèque (AUD-02-022)', () => {
  async function importer(ctx, fichier, reponses) {
    // Remplace la fenêtre de confirmation : renvoie les réponses données, dans l'ordre, et note les questions.
    const questions = []; let i = 0;
    ctx.showConfirmModal = async o => { questions.push(o.title); return reponses[i++]; };
    ctx.renderLibraryScreen = async () => {};
    vm.runInContext('var FileReader = class { readAsText() {} };', ctx);
    ctx.FileReader = class { constructor() { setTimeout(() => this.onload({ target: { result: JSON.stringify(fichier) } }), 0); } readAsText() {} };
    ctx.importProjectLibrary({ files: [{}] });
    await settle();
    return questions;
  }
  const fichier = (ids) => ({ _plumeLibraryExport: true, version: 3, doclist: { documents: ids.map(id => ({ id, title: id, lastModified: 1 })) }, documents: Object.fromEntries(ids.map(id => [id, { _enc: true, data: 'x' }])), images: {} });
  it('les manuscrits déjà présents sont ignorés par défaut, les autres importés', async () => {
    const a = makeDevice(makeServer().serverFetch); vm.runInContext('Crypto.decrypt = async () => null;', a);
    await creer(a, 'm1');
    const q = await importer(a, fichier(['m1', 'm2']), [true]);
    expect(q.length).toBe(1);
    const list = await a.loadDocList();
    expect(list.documents.length).toBe(2);                                              // m1 d'origine + 1 nouveau (m2)
    expect(list.documents.filter(d => d.title === 'm1').length).toBe(1);               // pas de doublon de m1
  });
  it('« Annuler » puis « Importer en copies » : tout est importé, doublons compris', async () => {
    const a = makeDevice(makeServer().serverFetch); vm.runInContext('Crypto.decrypt = async () => null;', a);
    await creer(a, 'm1');
    const q = await importer(a, fichier(['m1']), [false, true]);
    expect(q.length).toBe(2);
    expect((await a.loadDocList()).documents.filter(d => d.title === 'm1').length).toBe(2);
  });
  it('« Annuler » aux deux questions : l\'import est abandonné, rien n\'est ajouté', async () => {
    const a = makeDevice(makeServer().serverFetch); vm.runInContext('Crypto.decrypt = async () => null;', a);
    await creer(a, 'm1');
    await importer(a, fichier(['m1', 'm2']), [false, false]);
    expect((await a.loadDocList()).documents.length).toBe(1);
  });
  it('sans doublon : aucune question posée', async () => {
    const a = makeDevice(makeServer().serverFetch); vm.runInContext('Crypto.decrypt = async () => null;', a);
    const q = await importer(a, fichier(['n1']), []);
    expect(q.length).toBe(0);
    expect((await a.loadDocList()).documents.length).toBe(1);
  });
});
