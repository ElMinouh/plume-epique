// ═══════════════════════════════════════════════════════
// AUD-07 LOT 3 (v9.72.0) — FIABILITÉ DE L'ENVOI ET DE LA LECTURE (AUD-07-011, 012, 020)
// Vrai Worker + vraie base SQLite (FakeD1) ; code réel de router.js.
// ═══════════════════════════════════════════════════════
import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeD1 } from './fake-d1.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const KEY = 'cle-test-aud07-3';

function makeWorker() {
  const d1 = new FakeD1();
  const env = { SYNC_KEY: KEY, DB: d1 };
  const worker = new Function(read('worker/sync-worker.js').replace('export default', 'return'))();
  let n = 0;
  const call = (key, { method = 'GET', body, base, known, auth = KEY } = {}) => worker.fetch(new Request('https://s.test/?key=' + key, {
    method, body, headers: {
      Authorization: 'Bearer ' + auth, 'CF-Connecting-IP': '10.9.0.' + (++n % 250),
      ...(base !== undefined ? { 'X-Plume-Base-Version': String(base) } : {}),
      ...(known !== undefined ? { 'X-Plume-Known-Version': String(known) } : {})
    }
  }), env);
  return { call };
}

describe('011 — lecture conditionnelle du Worker (X-Plume-Known-Version)', () => {
  it('répond 304 sans corps quand le client a déjà la version courante', async () => {
    const s = makeWorker();
    await s.call('doc_pp_m1', { method: 'PUT', body: '"contenu-du-manuscrit"', base: 0 });
    const r = await s.call('doc_pp_m1', { known: 1 });
    expect(r.status).toBe(304);
    expect(await r.text()).toBe('');
    expect(r.headers.get('X-Plume-Version')).toBe('1');
  });
  it('renvoie la réponse complète quand la version diffère, est absente ou mal formée', async () => {
    const s = makeWorker();
    await s.call('doc_pp_m1', { method: 'PUT', body: '"v1"', base: 0 });
    await s.call('doc_pp_m1', { method: 'PUT', body: '"v2"', base: 1 });
    for (const known of [1, 3, 0, 'abc', '-1', '01', '99999999999']) {
      const r = await s.call('doc_pp_m1', { known });
      expect(r.status, 'known=' + known).toBe(200);
      expect(await r.json()).toBe('v2');
    }
    const sans = await s.call('doc_pp_m1');
    expect(await sans.json()).toBe('v2');
    expect(sans.headers.get('X-Plume-Version')).toBe('2');
  });
  it('une clé inexistante renvoie « null » (version 0), jamais 304', async () => {
    const s = makeWorker();
    const r = await s.call('doc_pp_absent', { known: 1 });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('null');
  });
  it("l'authentification est contrôlée avant : sans clé valide, 401 même avec l'en-tête", async () => {
    const s = makeWorker();
    await s.call('doc_pp_m1', { method: 'PUT', body: '"x"', base: 0 });
    expect((await s.call('doc_pp_m1', { known: 1, auth: 'mauvaise' })).status).toBe(401);
  });
});

function makeCtx(fetchImpl) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
  const ctx = dom.window;
  vm.createContext(ctx);
  Object.defineProperty(ctx, 'crypto', { value: globalThis.crypto, configurable: true });
  ctx.Request = globalThis.Request; ctx.Response = globalThis.Response;
  ctx.fetch = fetchImpl;
  ctx.toast = vi.fn(); ctx.DOMPurify = { sanitize: x => x };
  for (const f of ['schema.js', 'crypto.js', 'router.js']) vm.runInContext(read('js/' + f), ctx, { filename: f });
  ctx.onload = null;
  return ctx;
}

describe('011 — syncPull : lecture conditionnelle à la demande (router.js)', () => {
  function device(reponse) {
    const vus = [];
    const ctx = makeCtx(async (url, opts) => { vus.push(opts.headers); return reponse(); });
    ctx.setSyncKey('cle');
    return { ctx, vus };
  }
  it("n'envoie la version connue que si l'appelant le demande ET qu'une version existe", async () => {
    const { ctx, vus } = device(() => new Response('"x"', { status: 200, headers: { 'X-Plume-Version': '3' } }));
    ctx.setSyncVersion('doc_p_m', 3);
    await ctx.syncPull('doc_p_m');
    await ctx.syncPull('doc_p_m', { ifVersion: true });
    await ctx.syncPull('doc_p_autre', { ifVersion: true }); // version 0 : rien à annoncer
    expect(vus[0]['X-Plume-Known-Version']).toBeUndefined();
    expect(vus[1]['X-Plume-Known-Version']).toBe('3');
    expect(vus[2]['X-Plume-Known-Version']).toBeUndefined();
  });
  it('un 304 devient « rien de nouveau » (pas de données, pas d\'erreur de synchro)', async () => {
    const { ctx } = device(() => new Response(null, { status: 304, headers: { 'X-Plume-Version': '3' } }));
    ctx.setSyncVersion('doc_p_m', 3);
    const r = await ctx.syncPull('doc_p_m', { ifVersion: true });
    expect(r.data).toBeUndefined();
    expect(r.notModified).toBe(true);
    expect(r.version).toBe(3);
    expect(ctx.getLastSyncStatus().ok).toBe(true);
  });
});

describe('012 — délai d\'envoi proportionnel à la taille', () => {
  const ctx = makeCtx(async () => new Response('{}'));
  it('30 s de base + 10 s par Mo entamé', () => {
    expect(ctx.syncPushTimeoutMs(0)).toBe(30000);
    expect(ctx.syncPushTimeoutMs(1000)).toBe(40000);
    expect(ctx.syncPushTimeoutMs(1048576)).toBe(40000);
    expect(ctx.syncPushTimeoutMs(6.38 * 1048576)).toBe(100000);
    expect(ctx.syncPushTimeoutMs(19 * 1048576)).toBe(220000);
  });
  it("syncPush l'utilise pour le PUT (le délai n'est plus fixe)", () => {
    expect(read('js/router.js')).toMatch(/timeoutMs: syncPushTimeoutMs\(body\.length\)/);
  });
});

describe('020 — délai maximal aussi sur la lecture du corps (opt-in)', () => {
  // Réponse dont le corps ne se termine jamais, mais qui obéit à l'annulation.
  const corpsFige = signal => new Response(new ReadableStream({
    start(c) { signal.addEventListener('abort', () => c.error(new DOMException('annulé', 'AbortError'))); }
  }), { status: 200 });
  const corpsLent = (ms, texte) => new Response(new ReadableStream({
    start(c) { setTimeout(() => { c.enqueue(new TextEncoder().encode(texte)); c.close(); }, ms); }
  }), { status: 200 });

  it('avec bodyTimeout, un corps qui se fige échoue dans le délai prévu', async () => {
    const ctx = makeCtx(async (url, opts) => corpsFige(opts.signal));
    const resp = await ctx.fetchWithTimeout('http://x.test/', { timeoutMs: 1000, bodyTimeout: true, bodyTimeoutMs: 80 });
    const t0 = Date.now();
    await expect(resp.json()).rejects.toThrow(/Délai dépassé/);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  it('avec bodyTimeout, un corps qui arrive à temps est lu normalement', async () => {
    const ctx = makeCtx(async () => corpsLent(30, '{"ok":true}'));
    const resp = await ctx.fetchWithTimeout('http://x.test/', { timeoutMs: 1000, bodyTimeout: true, bodyTimeoutMs: 500 });
    expect(await resp.json()).toEqual({ ok: true });
  });
  it('sans bodyTimeout, rien ne change : un corps plus lent que le délai d\'en-têtes passe (flux IA)', async () => {
    const ctx = makeCtx(async () => corpsLent(150, '{"flux":1}'));
    const resp = await ctx.fetchWithTimeout('http://x.test/', { timeoutMs: 50 });
    expect(await resp.json()).toEqual({ flux: 1 });
  });
  it("syncPull et pullGraphicImage demandent la lecture bornée", () => {
    expect(read('js/router.js')).toMatch(/timeoutMs: 8000, bodyTimeout: true/);
    expect(read('js/images.js')).toMatch(/bodyTimeout: true, bodyTimeoutMs: 120000/);
  });
});
