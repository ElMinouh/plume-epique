// ═══════════════════════════════════════════════════════
// LOT 3-D1 (v9.23.0) — WORKER DE SYNCHRO SUR D1
// Le VRAI worker tourne sur une VRAIE base SQLite (FakeD1 → node:sqlite). On
// vérifie : même contrat HTTP que KV, découpage des gros manuscrits (> 2 Mo),
// transition KV → D1, écritures concurrentes (jamais d'écrasement), erreurs
// de quota, et deux appareils réels (router.js) qui se synchronisent via D1.
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
const DOC = 'doc_p1_m1';

function makeServer({ withKv = false } = {}) {
  const d1 = new FakeD1();
  const kv = new Map();
  const env = { SYNC_KEY: KEY, DB: d1 };
  if (withKv) env.PLUME_SYNC = {
    async getWithMetadata(k) { return kv.has(k) ? kv.get(k) : { value: null, metadata: null }; },
    async put(k, v, o) { kv.set(k, { value: v, metadata: (o && o.metadata) || null }); }
  };
  const worker = new Function(fs.readFileSync(path.join(ROOT, 'worker', 'sync-worker.js'), 'utf8').replace('export default', 'return'))();
  const call = (key, { method = 'GET', body, base = '0', ip = '1.1.1.1' } = {}) => worker.fetch(new Request('https://sync.test/?key=' + key, {
    method, body, headers: { Authorization: 'Bearer ' + KEY, 'X-Plume-Base-Version': base, 'CF-Connecting-IP': ip }
  }), env);
  async function serverFetch(url, opts = {}) {
    return worker.fetch(new Request(url, { method: (opts && opts.method) || 'GET', headers: (opts && opts.headers) || {}, body: (opts && opts.body) || undefined }), env);
  }
  return { d1, kv, env, call, serverFetch };
}

describe('Worker sur D1 — même contrat que KV', () => {
  it('clé inconnue : null, version 0 ; écriture : version 1 ; relecture identique ; en-tête de stockage', async () => {
    const s = makeServer();
    const g0 = await s.call(DOC);
    expect(await g0.text()).toBe('null');
    expect(g0.headers.get('X-Plume-Version')).toBe('0');
    expect(g0.headers.get('X-Plume-Storage')).toBe('d1');
    const p = await s.call(DOC, { method: 'PUT', body: '{"a":1}', base: '0' });
    expect(p.status).toBe(200);
    expect(p.headers.get('X-Plume-Version')).toBe('1');
    const g1 = await s.call(DOC);
    expect(await g1.text()).toBe('{"a":1}');
    expect(g1.headers.get('X-Plume-Version')).toBe('1');
  });

  it('une écriture qui ne se base pas sur la version courante est refusée (409) et ne change rien', async () => {
    const s = makeServer();
    await s.call(DOC, { method: 'PUT', body: '"v1"', base: '0' });
    const r = await s.call(DOC, { method: 'PUT', body: '"intrus"', base: '0' });
    expect(r.status).toBe(409);
    expect((await r.json()).serverVersion).toBe(1);
    expect(await (await s.call(DOC)).text()).toBe('"v1"');
  });

  it('le stockage D1 mémorise null comme valeur (suppression logique) sans la confondre avec « absent »', async () => {
    const s = makeServer();
    await s.call(DOC, { method: 'PUT', body: 'null', base: '0' });
    const g = await s.call(DOC);
    expect(g.headers.get('X-Plume-Version')).toBe('1');
    expect(await g.text()).toBe('null');
  });
});

describe('Gros manuscrits : découpage en morceaux (limite D1 de 2 Mo)', () => {
  it('un manuscrit de 2,9 Mo est découpé, relu à l\'identique, et ses anciens morceaux sont nettoyés à chaque version', async () => {
    const s = makeServer();
    const gros = JSON.stringify({ data: 'é'.repeat(2900000) }); // caractères non ASCII : pire cas en octets
    const r1 = await s.call(DOC, { method: 'PUT', body: gros, base: '0' });
    expect(r1.status).toBe(200);
    const maxLen = s.d1.db.prepare('SELECT MAX(LENGTH(data)) AS m FROM sync_chunks').get().m;
    expect(maxLen).toBeLessThanOrEqual(600000);
    const nChunks = s.d1.count('sync_chunks');
    expect(nChunks).toBeGreaterThanOrEqual(5);
    expect(await (await s.call(DOC)).text()).toBe(gros);
    // deuxième version : toujours le même nombre de morceaux en base (anciens effacés)
    await s.call(DOC, { method: 'PUT', body: gros + ' ', base: '1' });
    expect(s.d1.count('sync_chunks')).toBeGreaterThanOrEqual(5);
    expect(s.d1.count('sync_chunks')).toBeLessThanOrEqual(nChunks + 1);
    expect(s.d1.count('sync_meta')).toBe(1);
  });

  it('des morceaux manquants (lecture au milieu d\'un remplacement impossible à résoudre) donnent une erreur explicite, jamais une valeur tronquée', async () => {
    const s = makeServer();
    await s.call(DOC, { method: 'PUT', body: 'x'.repeat(1300000), base: '0' });
    s.d1.db.exec("DELETE FROM sync_chunks WHERE idx = 1");
    const r = await s.call(DOC);
    expect(r.status).toBe(500);
  });
});

describe('Transition KV → D1 (aucune copie en masse)', () => {
  it('une clé qui n\'existe que dans KV est lue depuis KV ; son 1er envoi migre dans D1 sans toucher à KV', async () => {
    const s = makeServer({ withKv: true });
    s.kv.set(DOC, { value: '{"ancien":true}', metadata: { v: 7 } });
    const g = await s.call(DOC);
    expect(await g.text()).toBe('{"ancien":true}');
    expect(g.headers.get('X-Plume-Version')).toBe('7');
    // base périmée → refus
    expect((await s.call(DOC, { method: 'PUT', body: '"x"', base: '6' })).status).toBe(409);
    const p = await s.call(DOC, { method: 'PUT', body: '{"nouveau":true}', base: '7' });
    expect(p.status).toBe(200);
    expect(p.headers.get('X-Plume-Version')).toBe('8');
    // lu désormais dans D1, KV intact (retour arrière possible)
    const g2 = await s.call(DOC);
    expect(await g2.text()).toBe('{"nouveau":true}');
    expect(g2.headers.get('X-Plume-Version')).toBe('8');
    expect(s.kv.get(DOC)).toEqual({ value: '{"ancien":true}', metadata: { v: 7 } });
    expect((await s.call(DOC, { method: 'PUT', body: '"re"', base: '7' })).status).toBe(409);
  });
});

describe('Écritures concurrentes : une seule gagne, aucun écrasement', () => {
  it('deux premières écritures simultanées (base 0) : un 200 et un 409', async () => {
    const s = makeServer();
    const [a, b] = await Promise.all([
      s.call(DOC, { method: 'PUT', body: '"A"', base: '0', ip: '1.1.1.1' }),
      s.call(DOC, { method: 'PUT', body: '"B"', base: '0', ip: '2.2.2.2' })
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const gagnant = a.status === 200 ? '"A"' : '"B"';
    expect(await (await s.call(DOC)).text()).toBe(gagnant);
    expect(s.d1.count('sync_chunks')).toBe(1); // pas de morceau orphelin du perdant
  });

  it('deux mises à jour simultanées (base 1) : un 200 et un 409, nettoyage des morceaux du perdant', async () => {
    const s = makeServer();
    await s.call(DOC, { method: 'PUT', body: '"base"', base: '0' });
    const [a, b] = await Promise.all([
      s.call(DOC, { method: 'PUT', body: '"A"', base: '1', ip: '1.1.1.1' }),
      s.call(DOC, { method: 'PUT', body: '"B"', base: '1', ip: '2.2.2.2' })
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(s.d1.count('sync_chunks')).toBe(1);
    expect(s.d1.count('sync_meta')).toBe(1);
    const g = await s.call(DOC);
    expect(g.headers.get('X-Plume-Version')).toBe('2');
  });
});

describe('Pannes et quota D1', () => {
  it('quota D1 épuisé → 503 + Retry-After (le client se met en pause 15 min) ; autre panne → 500 ; rien n\'est écrit', async () => {
    const s = makeServer();
    s.d1.failNextBatch = new Error('D1_ERROR: exceeded rows written limit for the day');
    const r1 = await s.call(DOC, { method: 'PUT', body: '"x"', base: '0' });
    expect(r1.status).toBe(503);
    expect(r1.headers.get('Retry-After')).toBe('900');
    s.d1.failNextBatch = new Error('boom');
    expect((await s.call(DOC, { method: 'PUT', body: '"x"', base: '0' })).status).toBe(500);
    expect(s.d1.count('sync_meta')).toBe(0);
    expect((await s.call(DOC, { method: 'PUT', body: '"ok"', base: '0' })).status).toBe(200);
  });
});

describe('Deux appareils réels (router.js) synchronisés via D1', () => {
  function makeDevice(serverFetch) {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
    const ctx = dom.window;
    vm.createContext(ctx);
    Object.defineProperty(ctx, 'crypto', { value: globalThis.crypto, configurable: true });
    ctx.Request = globalThis.Request; ctx.Response = globalThis.Response;
    ctx.fetch = (url, opts) => serverFetch(url, opts);
    ctx.toast = vi.fn(); ctx.DOMPurify = { sanitize: x => x };
    for (const f of ['schema.js', 'crypto.js', 'router.js', 'library.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), ctx, { filename: f });
    ctx.onload = null;
    ctx.setSyncKey(KEY);
    vm.runInContext("_dataKey = 'cle-donnees'; _currentProfileId = 'p1';", ctx);
    return ctx;
  }
  const settle = async () => { for (let i = 0; i < 25; i++) await new Promise(r => setTimeout(r, 0)); };
  const texte = t => JSON.stringify({ _schemaVersion: 1, title: 'T', chapters: [{ id: 'c1', title: 'C', content: t }] });
  async function ecrire(ctx, t) { await ctx.persistData(DOC, await ctx.makeEncryptedEnvelope(texte(t))); ctx.flushPendingSyncPushes(); await settle(); }
  async function lire(ctx) {
    const env = await ctx.readLocalOnly(DOC);
    return JSON.parse(await vm.runInContext(`Crypto.decrypt(${JSON.stringify(env.data)}, 'cle-donnees')`, ctx)).chapters[0].content;
  }

  it('A écrit, B se recale sur la version de A (numéros de version cohérents)', async () => {
    const s = makeServer();
    const a = makeDevice(s.serverFetch), b = makeDevice(s.serverFetch);
    await ecrire(a, 'texte de A');
    await b.syncReconcileKey(DOC); await settle();
    expect(await lire(b)).toBe('texte de A');
    expect(b.getSyncVersion(DOC)).toBe(1);
  });

  it('un vrai conflit (A et B modifient après la même base) est détecté : rien n\'est écrasé, B est mis en pause', async () => {
    const s = makeServer();
    const a = makeDevice(s.serverFetch), b = makeDevice(s.serverFetch);
    await ecrire(a, 'base');
    await b.syncReconcileKey(DOC); await settle();
    await ecrire(a, 'A modifie');
    await ecrire(b, 'B modifie');
    expect(b.isConflictPaused(DOC)).toBe(true);
    expect(await lire(b)).toBe('B modifie');                       // le texte local de B est intact
    const serveur = JSON.parse(await vm.runInContext(`Crypto.decrypt(${JSON.stringify(JSON.parse(await (await s.call(DOC)).text()).data)}, 'cle-donnees')`, a));
    expect(serveur.chapters[0].content).toBe('A modifie');          // le serveur n'est pas écrasé non plus
  });

  it('un appareil en retard ne fait que recevoir : pas de conflit, il adopte la version plus récente', async () => {
    const s = makeServer();
    const a = makeDevice(s.serverFetch), b = makeDevice(s.serverFetch);
    await ecrire(a, 'v1');
    await b.syncReconcileKey(DOC); await settle();
    await ecrire(a, 'v2 plus complete');
    await b.syncReconcileKey(DOC); await settle();
    expect(await lire(b)).toBe('v2 plus complete');
    expect(b.isConflictPaused(DOC)).toBe(false);
  });
});
