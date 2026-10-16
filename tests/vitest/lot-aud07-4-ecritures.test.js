// ═══════════════════════════════════════════════════════
// AUD-07 LOT 4 (v9.73.0) — ÉCRITURES ÉVITABLES (AUD-07-009, 010)
//  • sauvegarde GitHub automatique : plus d'envoi sans modification, date de sauvegarde hors de l'index synchronisé ;
//  • index de la bibliothèque : écriture différée (ouverture, donnée d'auteur, 5 min, sortie).
// Vrai Worker sur vraie base SQLite (FakeD1), vrais clients (router.js, library.js).
// ═══════════════════════════════════════════════════════
import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeD1 } from './fake-d1.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEY = 'cle-test-aud07-4';
const DEK = 'cle-donnees';
const PID = 'p1';
const docKey = id => 'doc_' + PID + '_' + id;

function makeServer() {
  const d1 = new FakeD1();
  const env = { SYNC_KEY: KEY, DB: d1 };
  const worker = new Function(fs.readFileSync(path.join(ROOT, 'worker', 'sync-worker.js'), 'utf8').replace('export default', 'return'))();
  return { serverFetch: (url, opts = {}) => worker.fetch(new Request(url, { method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body }), env) };
}
function makeDevice(serverFetch, githubFetch) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
  const ctx = dom.window;
  vm.createContext(ctx);
  Object.defineProperty(ctx, 'crypto', { value: globalThis.crypto, configurable: true });
  ctx.Request = globalThis.Request; ctx.Response = globalThis.Response;
  ctx.fetch = (url, opts) => /api\.github\.com/.test(String(url)) ? githubFetch(url, opts) : serverFetch(url, opts);
  ctx.toast = vi.fn(); ctx.DOMPurify = { sanitize: x => x };
  for (const f of ['schema.js', 'crypto.js', 'router.js', 'library.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), ctx, { filename: f });
  ctx.onload = null;
  ctx.setSyncKey(KEY);
  vm.runInContext(`_dataKey = '${DEK}'; _currentProfileId = '${PID}'; _cloudToken = 'ghp_test';`, ctx);
  ctx.renderLibraryScreen = async () => {};
  return ctx;
}
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r, 0)); };
const manuscrit = (t, extra) => ({ _schemaVersion: 1, title: 'T', chapters: [{ id: 'c1', title: 'C', content: t }], ...(extra || {}) });
async function creer(ctx, id, t) {
  await ctx.persistData(docKey(id), await ctx.makeEncryptedEnvelope(JSON.stringify(manuscrit(t))));
  await ctx.mutateDocList(l => { l.documents.push({ id, title: 'T', lastModified: 1, chapterCount: 1, wordCount: 0, wordGoal: 0 }); });
  ctx.flushPendingSyncPushes(); await settle();
}
const entree = async (ctx, id) => (await ctx.loadDocList()).documents.find(d => d.id === id);

describe('009 — sauvegarde GitHub automatique sans modification', () => {
  function github() {
    const appels = [];
    const f = async (url, opts) => { appels.push({ url, method: opts && opts.method }); return new Response(JSON.stringify({ id: 'gist-1' }), { status: 200 }); };
    return { appels, f };
  }
  it('envoie une première fois, puis plus rien tant que le manuscrit ne change pas', async () => {
    const g = github();
    const dev = makeDevice(makeServer().serverFetch, g.f);
    await creer(dev, 'm1', 'bonjour');
    expect(await dev.libSyncManuscript('m1', { silent: true })).toBe(true);
    expect(g.appels).toHaveLength(1);
    expect(await dev.libSyncManuscript('m1', { silent: true })).toBe(true);
    expect(await dev.libSyncManuscript('m1', { silent: true })).toBe(true);
    expect(g.appels).toHaveLength(1); // aucun nouvel envoi
  });
  it('repart dès que le texte change', async () => {
    const g = github();
    const dev = makeDevice(makeServer().serverFetch, g.f);
    await creer(dev, 'm1', 'bonjour');
    await dev.libSyncManuscript('m1', { silent: true });
    await dev.persistData(docKey('m1'), await dev.makeEncryptedEnvelope(JSON.stringify(manuscrit('bonjour à tous', { gistId: 'gist-1' }))));
    await dev.libSyncManuscript('m1', { silent: true });
    expect(g.appels).toHaveLength(2);
    expect(g.appels[1].method).toBe('PATCH');
  });
  it('le bouton manuel envoie toujours, même sans modification', async () => {
    const g = github();
    const dev = makeDevice(makeServer().serverFetch, g.f);
    await creer(dev, 'm1', 'bonjour');
    await dev.libSyncManuscript('m1', { silent: true });
    await dev.libSyncManuscript('m1', { silent: false });
    expect(g.appels).toHaveLength(2);
  });
  it('ne change plus l\'index synchronisé (date de sauvegarde conservée sur l\'appareil)', async () => {
    const g = github();
    const dev = makeDevice(makeServer().serverFetch, g.f);
    await creer(dev, 'm1', 'bonjour');
    const save = vi.spyOn(dev, 'saveDocList');
    await dev.libSyncManuscript('m1', { silent: true });
    expect(save).not.toHaveBeenCalled();
    const e = await entree(dev, 'm1');
    expect(e.lastGistSync).toBeUndefined();
    expect(Number(dev.localStorage.getItem('plume_gistsync_m1'))).toBeGreaterThan(0);
    expect(dev.gistSyncStamp('m1', e)).toBeGreaterThan(0);
  });
  it('lit encore l\'ancienne date stockée dans l\'index (manuscrits déjà sauvegardés avant la 9.73.0)', () => {
    const dev = makeDevice(makeServer().serverFetch, github().f);
    expect(dev.gistSyncStamp('m9', { lastGistSync: 12345 })).toBe(12345);
    expect(dev.gistSyncStamp('m9', {})).toBe(0);
  });
  it('un échec d\'envoi ne mémorise pas l\'empreinte : la tentative suivante repart', async () => {
    let n = 0;
    const f = async () => (++n === 1 ? new Response('{"message":"x"}', { status: 500 }) : new Response(JSON.stringify({ id: 'g' }), { status: 200 }));
    const dev = makeDevice(makeServer().serverFetch, f);
    await creer(dev, 'm1', 'bonjour');
    expect(await dev.libSyncManuscript('m1', { silent: true })).toBe(false);
    expect(await dev.libSyncManuscript('m1', { silent: true })).toBe(true);
    expect(n).toBe(2);
  });
});

describe('010 — index de la bibliothèque écrit en différé', () => {
  async function ouvert() {
    const dev = makeDevice(makeServer().serverFetch, async () => new Response('{}'));
    await creer(dev, 'm1', 'bonjour');
    vm.runInContext("_currentDocumentId = 'm1'; db = { title: 'T', wordGoal: 0, chapters: [{ id: 'c1', content: 'un deux' }] };", dev);
    return dev;
  }
  const ecritures = dev => vi.spyOn(dev, 'saveDocList');

  it('écrit au premier enregistrement, puis plus pendant les 5 minutes suivantes', async () => {
    const dev = await ouvert();
    const w = ecritures(dev);
    await dev.touchDocumentMeta();
    expect(w).toHaveBeenCalledTimes(1);
    vm.runInContext("db.chapters[0].content = 'un deux trois quatre';", dev);
    await dev.touchDocumentMeta(); await dev.touchDocumentMeta(); await dev.touchDocumentMeta();
    expect(w).toHaveBeenCalledTimes(1);
    expect((await entree(dev, 'm1')).wordCount).toBe(2); // pas encore à jour : différé
  });
  it('flushDocumentMeta (sortie du manuscrit) met l\'index à jour', async () => {
    const dev = await ouvert();
    await dev.touchDocumentMeta();
    vm.runInContext("db.chapters[0].content = 'un deux trois quatre';", dev);
    await dev.touchDocumentMeta();
    const w = ecritures(dev);
    await dev.flushDocumentMeta();
    expect(w).toHaveBeenCalledTimes(1);
    expect((await entree(dev, 'm1')).wordCount).toBe(4);
    await dev.flushDocumentMeta(); // plus rien en attente
    expect(w).toHaveBeenCalledTimes(1);
  });
  it('un changement de titre ou d\'objectif (donnée d\'auteur) est écrit tout de suite', async () => {
    const dev = await ouvert();
    await dev.touchDocumentMeta();
    const w = ecritures(dev);
    vm.runInContext("db.title = 'Nouveau titre';", dev);
    await dev.touchDocumentMeta();
    expect(w).toHaveBeenCalledTimes(1);
    expect((await entree(dev, 'm1')).title).toBe('Nouveau titre');
    vm.runInContext("db.wordGoal = 50000;", dev);
    await dev.touchDocumentMeta();
    expect(w).toHaveBeenCalledTimes(2);
    expect((await entree(dev, 'm1')).wordGoal).toBe(50000);
  });
  it('au bout de 5 minutes d\'écriture, l\'index est mis à jour', async () => {
    const dev = await ouvert();
    await dev.touchDocumentMeta();
    const w = ecritures(dev);
    const reel = dev.Date.now; // l'horloge du contexte de test est celle de la fenêtre simulée, pas celle de Node
    dev.Date.now = () => reel() + 5 * 60 * 1000 + 1000;
    vm.runInContext("db.chapters[0].content = 'un deux trois';", dev);
    try { await dev.touchDocumentMeta(); } finally { dev.Date.now = reel; }
    expect(w).toHaveBeenCalledTimes(1);
    expect((await entree(dev, 'm1')).wordCount).toBe(3);
  });
  it("l'écriture en attente d'un manuscrit n'est jamais appliquée à un autre", async () => {
    const dev = await ouvert();
    await dev.touchDocumentMeta();
    vm.runInContext("db.chapters[0].content = 'un deux trois quatre';", dev);
    await dev.touchDocumentMeta(); // en attente pour m1
    vm.runInContext("_currentDocumentId = 'm2';", dev); // on a changé de manuscrit sans passer par la sortie
    const w = ecritures(dev);
    await dev.flushDocumentMeta();
    expect(w).not.toHaveBeenCalled();
  });
  it('les points de sortie vident bien l\'index (bibliothèque, déconnexion, masquage de la page, roman graphique)', () => {
    const lib = fs.readFileSync(path.join(ROOT, 'js', 'library.js'), 'utf8');
    expect(lib).toMatch(/await save\(\);\s*\n\s*await flushDocumentMeta\(\)/);
    expect(fs.readFileSync(path.join(ROOT, 'js', 'profiles.js'), 'utf8')).toMatch(/flushDocumentMeta/);
    expect(fs.readFileSync(path.join(ROOT, 'js', 'router.js'), 'utf8')).toMatch(/await flushDocumentMeta\(\)/);
    const gn = fs.readFileSync(path.join(ROOT, 'js', 'graphicnovel.js'), 'utf8');
    expect(gn).toMatch(/docMetaDue\(gnId, gnSig, immediate === true\)/);
    expect(gn).toMatch(/deferDocMeta\(gnId, writeGnMeta\)/);
  });
});
