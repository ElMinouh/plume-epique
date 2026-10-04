// ═══════════════════════════════════════════════════════
// LOT 5 (v9.26.0) — INTÉGRITÉ DE LA SYNCHRONISATION (AUD-01-007 / 008 / 018)
//  • suppressions propagées (pierres tombales), plus de manuscrit fantôme ;
//  • la sauvegarde Gist n'écrase plus les derniers mots tapés ;
//  • un manuscrit d'une version plus récente n'est ni ouvert ni rabaissé.
// Vrai worker sur vraie base SQLite (FakeD1), vrais clients (router.js, library.js).
// ═══════════════════════════════════════════════════════
import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeD1 } from './fake-d1.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const KEY = 'cle-de-synchro-de-test';
const DEK = 'cle-donnees';
const PID = 'p1';
const LIST_KEY = 'doclist_' + PID;
const docKey = id => 'doc_' + PID + '_' + id;

function makeServer() {
  const d1 = new FakeD1();
  const env = { SYNC_KEY: KEY, DB: d1 };
  const worker = new Function(fs.readFileSync(path.join(ROOT, 'worker', 'sync-worker.js'), 'utf8').replace('export default', 'return'))();
  const serverFetch = (url, opts = {}) => worker.fetch(new Request(url, { method: (opts && opts.method) || 'GET', headers: (opts && opts.headers) || {}, body: (opts && opts.body) || undefined }), env);
  return { d1, serverFetch };
}
function makeDevice(serverFetch, extraFetch) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
  const ctx = dom.window;
  vm.createContext(ctx);
  Object.defineProperty(ctx, 'crypto', { value: globalThis.crypto, configurable: true });
  ctx.Request = globalThis.Request; ctx.Response = globalThis.Response;
  ctx.fetch = (url, opts) => (extraFetch && /api\.github\.com/.test(String(url))) ? extraFetch(url, opts) : serverFetch(url, opts);
  ctx.toast = vi.fn(); ctx.DOMPurify = { sanitize: x => x };
  for (const f of ['schema.js', 'crypto.js', 'router.js', 'library.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), ctx, { filename: f });
  ctx.onload = null;
  ctx.setSyncKey(KEY);
  vm.runInContext(`_dataKey = '${DEK}'; _currentProfileId = '${PID}';`, ctx);
  ctx.showConfirmModal = async () => true;
  ctx.renderLibraryScreen = async () => {};
  return ctx;
}
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r, 0)); };
const manuscrit = t => ({ _schemaVersion: 1, title: 'T', chapters: [{ id: 'c1', title: 'C', content: t }] });
async function creer(ctx, id, t) {
  await ctx.persistData(docKey(id), await ctx.makeEncryptedEnvelope(JSON.stringify(manuscrit(t))));
  await ctx.mutateDocList(l => { l.documents.push({ id, title: 'T', lastModified: Date.now() }); });
  ctx.flushPendingSyncPushes(); await settle();
}

describe('mergeDocList — pierres tombales (AUD-01-008)', () => {
  const ctx = makeDevice(makeServer().serverFetch);
  const now = Date.now();
  it('une pierre tombale retire l\'entrée des deux côtés et l\'emporte même sur une entrée plus récente', () => {
    const local = { documents: [{ id: 'a', lastModified: 5 }, { id: 'b', lastModified: 9 }], deleted: [] };
    const remote = { documents: [{ id: 'a', lastModified: 1 }], deleted: [{ id: 'b', at: now }] };
    const m = ctx.mergeDocList(local, remote);
    expect(m.documents.map(d => d.id)).toEqual(['a']);
    expect(m.deleted.map(t => t.id)).toEqual(['b']);
  });
  it('les pierres tombales des deux côtés sont réunies ; les plus vieilles que 90 jours sont oubliées', () => {
    const m = ctx.mergeDocList(
      { documents: [], deleted: [{ id: 'x', at: now }, { id: 'vieux', at: now - 91 * 24 * 3600 * 1000 }] },
      { documents: [], deleted: [{ id: 'y', at: now }] });
    expect(m.deleted.map(t => t.id).sort()).toEqual(['x', 'y']);
  });
  it('sans pierre tombale, le comportement d\'avant est inchangé (union, la plus récente l\'emporte)', () => {
    const m = ctx.mergeDocList({ documents: [{ id: 'a', lastModified: 5, t: 'L' }] }, { documents: [{ id: 'a', lastModified: 1, t: 'R' }, { id: 'c', lastModified: 2 }] });
    expect(m.documents.find(d => d.id === 'a').t).toBe('L');
    expect(m.documents.map(d => d.id).sort()).toEqual(['a', 'c']);
  });
});

describe('Suppression propagée entre deux appareils (AUD-01-008)', () => {
  it('A supprime : B retire l\'entrée ET sa copie locale, sans que l\'entrée revienne', async () => {
    const s = makeServer();
    const a = makeDevice(s.serverFetch), b = makeDevice(s.serverFetch);
    await creer(a, 'm1', 'texte');
    await creer(a, 'm2', 'autre');
    await b.syncReconcileKey(LIST_KEY); await b.syncReconcileKey(docKey('m1')); await b.syncReconcileKey(docKey('m2')); await settle();
    expect((await b.loadDocList()).documents.map(d => d.id).sort()).toEqual(['m1', 'm2']);
    expect(await b.readLocalOnly(docKey('m1'))).toBeTruthy();

    await a.deleteDocument('m1'); await settle();
    expect((await a.loadDocList()).documents.map(d => d.id)).toEqual(['m2']);

    await b.syncReconcileKey(LIST_KEY); await settle();
    expect((await b.loadDocList()).documents.map(d => d.id)).toEqual(['m2']);
    expect(await b.readLocalOnly(docKey('m1'))).toBeFalsy(); // copie locale effacée
    expect(await b.readLocalOnly(docKey('m2'))).toBeTruthy(); // l'autre manuscrit est intact

    // rien ne revient, ni chez A ni chez B, après d'autres rapprochements
    await a.syncReconcileKey(LIST_KEY); await b.syncReconcileKey(LIST_KEY); await settle();
    expect((await a.loadDocList()).documents.map(d => d.id)).toEqual(['m2']);
    expect((await b.loadDocList()).documents.map(d => d.id)).toEqual(['m2']);
  });

  it('un appareil resté en arrière (liste périmée) qui pousse sa liste ne ressuscite pas le manuscrit supprimé', async () => {
    const s = makeServer();
    const a = makeDevice(s.serverFetch), b = makeDevice(s.serverFetch);
    await creer(a, 'm1', 'texte');
    await b.syncReconcileKey(LIST_KEY); await settle(); // B connaît m1, puis reste « hors ligne »
    await a.deleteDocument('m1'); await settle();

    // B, en retard, modifie sa liste (nouveau manuscrit) et pousse : le serveur refuse (409), B fusionne.
    await b.mutateDocList(l => { l.documents.push({ id: 'm3', title: 'Nouveau', lastModified: Date.now() }); });
    b.flushPendingSyncPushes(); await settle();

    expect((await b.loadDocList()).documents.map(d => d.id)).toEqual(['m3']);
    const serveur = JSON.parse(await (await s.serverFetch('https://s/?key=' + LIST_KEY, { headers: { Authorization: 'Bearer ' + KEY } })).text());
    expect(serveur.documents.map(d => d.id)).toEqual(['m3']);
    expect(serveur.deleted.map(t => t.id)).toEqual(['m1']);
  });

  it('supprimer un manuscrit ne laisse aucune clé fantôme dans la file de reprise', async () => {
    const s = makeServer();
    const a = makeDevice(s.serverFetch);
    await creer(a, 'm1', 'texte');
    await a.deleteDocument('m1'); await settle();
    expect(a.getPendingSyncKeys()).toEqual([]);
  });

  it('le manuscrit actuellement ouvert n\'est pas effacé sous les pieds de l\'utilisateur', async () => {
    const s = makeServer();
    const a = makeDevice(s.serverFetch), b = makeDevice(s.serverFetch);
    await creer(a, 'm1', 'texte');
    await b.syncReconcileKey(LIST_KEY); await b.syncReconcileKey(docKey('m1')); await settle();
    vm.runInContext("_currentDocumentId = 'm1';", b);
    await a.deleteDocument('m1'); await settle();
    await b.syncReconcileKey(LIST_KEY); await settle();
    expect(await b.readLocalOnly(docKey('m1'))).toBeTruthy(); // encore là : ouvert à l'écran
    vm.runInContext("_currentDocumentId = null;", b);
    await b.syncReconcileKey(LIST_KEY); await settle();
    expect(await b.readLocalOnly(docKey('m1'))).toBeFalsy(); // purgé dès qu'il n'est plus ouvert
  });
});

describe('Sauvegarde Gist : n\'écrase pas les derniers mots (AUD-01-007)', () => {
  it('du texte enregistré PENDANT l\'envoi à GitHub est conservé ; le Gist est bien mémorisé', async () => {
    const s = makeServer();
    let dev;
    const github = async () => {
      // pendant l'envoi réseau : l'éditeur enregistre de nouveaux mots
      await dev.persistManuscriptData('m1', manuscrit('texte tape pendant l\'envoi'));
      return new Response(JSON.stringify({ id: 'gist-123' }), { status: 200 });
    };
    dev = makeDevice(s.serverFetch, github);
    vm.runInContext("_cloudToken = 'ghp_test';", dev);
    await dev.persistManuscriptData('m1', manuscrit('texte avant l\'envoi'));
    await dev.mutateDocList(l => { l.documents.push({ id: 'm1', title: 'T', lastModified: 1 }); });
    const ok = await dev.libSyncManuscript('m1', { silent: true });
    expect(ok).toBe(true);
    const apres = await dev.loadManuscriptData('m1');
    expect(apres.chapters[0].content).toBe('texte tape pendant l\'envoi');
    expect(apres.gistId).toBe('gist-123');
  });

  it('le manuscrit ouvert dans l\'éditeur reçoit le gistId en mémoire (sinon son prochain enregistrement l\'effacerait)', async () => {
    const s = makeServer();
    const dev = makeDevice(s.serverFetch, async () => new Response(JSON.stringify({ id: 'gist-9' }), { status: 200 }));
    vm.runInContext("_cloudToken = 'ghp_test'; _currentDocumentId = 'm1'; db = { title: 'T', chapters: [], gistId: '' };", dev);
    await dev.persistManuscriptData('m1', manuscrit('x'));
    await dev.mutateDocList(l => { l.documents.push({ id: 'm1', title: 'T', lastModified: 1 }); });
    await dev.libSyncManuscript('m1', { silent: true });
    expect(vm.runInContext('db.gistId', dev)).toBe('gist-9');
  });
});

describe('Manuscrit d\'une version plus récente (AUD-01-018)', () => {
  const ctx = makeDevice(makeServer().serverFetch);

  it('migrateDb refuse un schéma plus récent avec un message clair, et ne rabaisse jamais le numéro', () => {
    const v = vm.runInContext('SCHEMA_VERSION', ctx);
    expect(() => ctx.migrateDb({ _schemaVersion: v + 1, chapters: [] })).toThrow(/version plus récente de Plume/);
    expect(ctx.migrateDb({ _schemaVersion: v, chapters: [] })._schemaVersion).toBe(v);
    expect(ctx.migrateDb({ chapters: [] })._schemaVersion).toBe(v); // ancien manuscrit : migré normalement
  });

  it('ouvrir un tel manuscrit : message à l\'utilisateur, aucun changement d\'état, recherche de mise à jour relancée', async () => {
    const v = vm.runInContext('SCHEMA_VERSION', ctx);
    await ctx.persistData(docKey('futur'), await ctx.makeEncryptedEnvelope(JSON.stringify({ _schemaVersion: v + 5, title: 'Du futur', chapters: [] })));
    vm.runInContext("db = { title: 'avant' }; _currentDocumentId = null;", ctx);
    ctx.checkForAppUpdate = vi.fn();
    ctx.toast.mockClear();
    await ctx.openDocument('futur');
    expect(ctx.toast).toHaveBeenCalledWith(expect.stringMatching(/version plus récente de Plume/), 'error');
    expect(vm.runInContext('db.title', ctx)).toBe('avant');
    expect(vm.runInContext('_currentDocumentId', ctx)).toBe(null);
    expect(ctx.checkForAppUpdate).toHaveBeenCalled();
  });

  it('chargement par identifiant (export, import, Gist) : même refus, sans réécriture', async () => {
    await expect(ctx.loadManuscriptData('futur')).rejects.toThrow(/version plus récente/);
  });
});
