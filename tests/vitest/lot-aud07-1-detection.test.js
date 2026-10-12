// ═══════════════════════════════════════════════════════
// AUD-07 LOT 1 (v9.70.0) — DÉTECTION (AUD-07-016, 008, 017, 018)
// Vrai Worker + vraie base SQLite (FakeD1) ; code réel de js/pwa.js ; script de surveillance du quota.
// ═══════════════════════════════════════════════════════
import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeD1 } from './fake-d1.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const KEY = 'cle-test-aud07-1';

function makeWorker() {
  const d1 = new FakeD1();
  const env = { SYNC_KEY: KEY, DB: d1 };
  const worker = new Function(read('worker/sync-worker.js').replace('export default', 'return'))();
  let n = 0;
  const call = (pathname, { method = 'GET', body, origin, ip, ua } = {}) => worker.fetch(new Request('https://s.test' + pathname, {
    method, body, headers: {
      'CF-Connecting-IP': ip || '10.8.0.' + (++n % 250),
      ...(origin ? { Origin: origin } : {}), ...(ua ? { 'User-Agent': ua } : {})
    }
  }), env);
  const events = () => d1.db.prepare('SELECT * FROM security_events ORDER BY ts, rowid').all();
  return { d1, env, call, events };
}

describe('016 — sonde /health (publique, sans donnée)', () => {
  it('répond 200 sans clé ni en-tête, et ne révèle rien', async () => {
    const s = makeWorker();
    const r = await s.call('/health');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(r.headers.get('Cache-Control')).toBe('no-store');
  });
  it('répond 503 quand la base est indisponible', async () => {
    const s = makeWorker();
    s.env.DB = { prepare() { throw new Error('D1 down'); } };
    const r = await s.call('/health');
    expect(r.status).toBe(503);
    expect((await r.json()).ok).toBe(false);
  });
  it('est plafonnée (429 au-delà de 30 appels par minute et par adresse)', async () => {
    const s = makeWorker();
    let last;
    for (let i = 0; i < 31; i++) last = await s.call('/health', { ip: '198.51.100.9' });
    expect(last.status).toBe(429);
  });
  it('refuse une origine étrangère comme le reste du Worker', async () => {
    const s = makeWorker();
    expect((await s.call('/health', { origin: 'https://evil.example' })).status).toBe(403);
  });
});

describe('016 — route /client-error', () => {
  const body = o => JSON.stringify(o);
  it('enregistre une erreur (version, navigateur, message, fichier) sans adresse IP', async () => {
    const s = makeWorker();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const r = await s.call('/client-error', { method: 'POST', ip: '203.0.113.50', ua: 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36', body: body({ v: '9.70.0', m: 'x is not a function', s: 'editor.js:12' }) });
    expect(r.status).toBe(204);
    const e = s.events();
    expect(e).toHaveLength(1);
    expect(e[0].kind).toBe('client_error');
    expect(e[0].detail).toContain('9.70.0');
    expect(e[0].detail).toContain('Chrome mobile');
    expect(JSON.stringify(e)).not.toContain('203.0.113.50');
    const lignes = log.mock.calls.map(c => c[0]).filter(l => String(l).includes('client_error'));
    expect(lignes.length).toBe(1);
    expect(lignes[0]).not.toContain('203.0.113.50');
    log.mockRestore();
  });
  it('ignore un corps trop gros ou illisible et tronque les champs', async () => {
    const s = makeWorker();
    await s.call('/client-error', { method: 'POST', body: body({ v: '9.70.0', m: 'm'.repeat(5000), s: 'f'.repeat(500) }) });
    expect(s.events()).toHaveLength(0); // plus de 2 Ko : ignoré
    const ok = await s.call('/client-error', { method: 'POST', body: body({ v: '9.70.0', m: 'm'.repeat(400), s: 'f'.repeat(200) }) });
    expect(ok.status).toBe(204);
    expect(s.events()).toHaveLength(1);
    expect(s.events()[0].detail.length).toBeLessThanOrEqual(80);
    expect((await s.call('/client-error', { method: 'POST', body: '{pas du json' })).status).toBe(204);
    expect(s.events()).toHaveLength(1);
  });
  it('plafonne les rapports (20 par minute et par adresse, 10 événements par minute)', async () => {
    const s = makeWorker();
    for (let i = 0; i < 40; i++) await s.call('/client-error', { method: 'POST', ip: '198.51.100.20', body: body({ v: '9', m: 'e' + i, s: 'a:1' }) });
    expect(s.events().length).toBeLessThanOrEqual(10);
  });
  it('refuse une origine étrangère', async () => {
    const s = makeWorker();
    expect((await s.call('/client-error', { method: 'POST', origin: 'https://evil.example', body: body({ m: 'x' }) })).status).toBe(403);
    expect(s.events().filter(e => e.kind === 'client_error')).toHaveLength(0);
  });
});

describe('016 — rapport côté navigateur (js/pwa.js)', () => {
  function chargerPwa({ syncKey = 'cle' } = {}) {
    const ecouteurs = {};
    const envois = [];
    const ctx = vm.createContext({
      navigator: {}, console, setTimeout, Date, Set, JSON, String, document: { addEventListener() {}, getElementById: () => null },
      window: { addEventListener: (t, f) => { ecouteurs[t] = f; } },
      getSyncKey: () => syncKey, SYNC_WORKER_URL: 'https://sync.test', APP_VERSION: '9.70.0',
      fetchWithTimeout: (url, opts) => { envois.push({ url, opts }); return Promise.resolve({}); }
    });
    vm.runInContext(read('js/pwa.js'), ctx);
    return { ecouteurs, envois };
  }
  it("envoie l'erreur au Worker, en text/plain, via fetchWithTimeout, sans contenu de manuscrit", () => {
    const p = chargerPwa();
    p.ecouteurs.error({ message: 'boom', filename: 'https://plume-epique.pages.dev/js/editor.js?v=1', lineno: 42 });
    expect(p.envois).toHaveLength(1);
    expect(p.envois[0].url).toBe('https://sync.test/client-error');
    expect(p.envois[0].opts.headers['Content-Type']).toBe('text/plain');
    expect(JSON.parse(p.envois[0].opts.body)).toEqual({ v: '9.70.0', m: 'boom', s: 'editor.js:42' });
  });
  it("n'envoie rien sans synchronisation activée (écrire sur cet appareil seulement)", () => {
    const p = chargerPwa({ syncKey: '' });
    p.ecouteurs.error({ message: 'boom', filename: 'a.js', lineno: 1 });
    expect(p.envois).toHaveLength(0);
  });
  it('ignore les erreurs de ressources sans message, dédoublonne et plafonne à 5 par page', () => {
    const p = chargerPwa();
    p.ecouteurs.error({ message: '', filename: 'img.png' });
    p.ecouteurs.error({ message: 'même', filename: 'a.js', lineno: 1 });
    p.ecouteurs.error({ message: 'même', filename: 'a.js', lineno: 1 });
    for (let i = 0; i < 10; i++) p.ecouteurs.unhandledrejection({ reason: new Error('r' + i) });
    expect(p.envois).toHaveLength(5);
  });
});

describe('008 — surveillance du quota D1 du compte', () => {
  const { evaluerQuota, extraireJson } = require('../../scripts/surveiller-quota-d1.cjs');
  it("additionne les bases et déclenche l'alerte à 80 % des écritures ou des lectures", () => {
    const ok = evaluerQuota([{ name: 'a', rows_written_24h: 27000, rows_read_24h: 55000 }, { name: 'b', rows_written_24h: 277, rows_read_24h: 7000 }]);
    expect(ok.alerte).toBe(false);
    expect(ok.ecrites).toBe(27277);
    expect(evaluerQuota([{ name: 'a', rows_written_24h: 80000, rows_read_24h: 0 }]).alerte).toBe(true);
    expect(evaluerQuota([{ name: 'a', rows_written_24h: 0, rows_read_24h: 4000000 }]).alerte).toBe(true);
    expect(evaluerQuota([{ name: 'a', rows_written_24h: 79999, rows_read_24h: 0 }]).alerte).toBe(false);
  });
  it("lit le JSON de wrangler même précédé d'un bandeau", () => {
    expect(extraireJson('wrangler 4.149.0\n-----\n[\n  { "name": "x" }\n]\n')).toEqual([{ name: 'x' }]);
    expect(extraireJson('{\n "rows_written_24h": 3\n}')).toEqual({ rows_written_24h: 3 });
  });
  it('le workflow quotidien est planifié, à droits minimaux, avec actions figées', () => {
    const wf = read('.github/workflows/surveillance-quota.yml');
    expect(wf).toMatch(/cron:/);
    expect(wf).toMatch(/permissions:\s*\n\s*contents: read/);
    for (const m of wf.matchAll(/uses:\s*(\S+)/g)) expect(m[1]).toMatch(/@[0-9a-f]{40}$/);
    expect(wf).toContain('surveiller-quota-d1.cjs');
  });
});
