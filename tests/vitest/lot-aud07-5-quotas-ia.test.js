// ═══════════════════════════════════════════════════════
// AUD-07 LOT 5 (v9.74.0) — COMPTEURS DE QUOTA D1 (AUD-07-007) ET PLAFOND / DÉLAIS DU RELAIS IA (AUD-07-015)
// Vrais Workers, vraie base SQLite (FakeD1).
// ═══════════════════════════════════════════════════════
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeD1 } from './fake-d1.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const loadWorker = file => new Function(read(file).replace('export default', 'return'))();
const KEY = 'cle-test-aud07-5';

// ───────────── 007 : compteurs ─────────────
function makeSync(d1 = new FakeD1()) {
  const env = { SYNC_KEY: KEY, DB: d1 };
  const worker = loadWorker('worker/sync-worker.js');
  let n = 0;
  const call = (key, { method = 'GET', body, base } = {}) => worker.fetch(new Request('https://s.test/?key=' + key, {
    method, body, headers: {
      Authorization: 'Bearer ' + KEY, 'CF-Connecting-IP': '10.5.0.' + (++n % 250),
      ...(base !== undefined ? { 'X-Plume-Base-Version': String(base) } : {})
    }
  }), env);
  const totals = () => Object.fromEntries(d1.db.prepare('SELECT scope, bytes, keys FROM sync_totals').all().map(r => [r.scope, [r.bytes, r.keys]]));
  return { d1, call, totals };
}
const bytesReels = d1 => d1.db.prepare('SELECT COALESCE(SUM(LENGTH(c.data)),0) AS n FROM sync_meta m JOIN sync_chunks c ON c.k = m.k AND c.wid = m.wid').get().n;

describe('007 — compteurs d\'occupation tenus dans la transaction d\'écriture', () => {
  it('suivent les écritures, les remplacements et les suppressions (global, profil, images)', async () => {
    const s = makeSync();
    await s.call('doc_pp_m1', { method: 'PUT', body: '"' + 'a'.repeat(1000) + '"', base: 0 });
    await s.call('img_pp_m1_i1', { method: 'PUT', body: '"' + 'b'.repeat(500) + '"', base: 0 });
    expect(s.totals()).toEqual({ global: [1002 + 502, 2], 'p:pp': [1002 + 502, 2], img: [502, 1] });
    await s.call('doc_pp_m1', { method: 'PUT', body: '"' + 'c'.repeat(300) + '"', base: 1 }); // remplacement plus court
    expect(s.totals().global).toEqual([302 + 502, 2]);
    // suppression d'une image
    expect((await s.call('img_pp_m1_i1', { method: 'DELETE' })).status).toBe(200);
    expect(s.totals()).toEqual({ global: [302, 1], 'p:pp': [302, 1], img: [0, 0] });
    expect(s.totals().global[0]).toBe(bytesReels(s.d1));
  });
  it('un refus par conflit (409) ne laisse aucune trace dans les compteurs', async () => {
    const s = makeSync();
    await s.call('doc_pp_m1', { method: 'PUT', body: '"v1"', base: 0 });
    await s.call('doc_pp_m1', { method: 'PUT', body: '"v2-plus-long"', base: 1 });
    const avant = s.totals();
    expect((await s.call('doc_pp_m1', { method: 'PUT', body: '"périmé"', base: 1 })).status).toBe(409);
    expect(s.totals()).toEqual(avant);
  });
  it('une écriture ne balaie plus les morceaux (aucun SUM(LENGTH(data)) sur le chemin d\'écriture)', async () => {
    const s = makeSync();
    await s.call('doc_pp_m1', { method: 'PUT', body: '"x"', base: 0 }); // initialisation des compteurs
    const vus = [];
    const prepare = s.d1.prepare.bind(s.d1);
    s.d1.prepare = sql => { vus.push(sql); return prepare(sql); };
    const r = await s.call('doc_pp_m2', { method: 'PUT', body: '"y"', base: 0 });
    expect(r.status).toBe(200);
    expect(vus.filter(q => /SUM\(LENGTH\(/.test(q))).toHaveLength(0);
    expect(vus.length).toBeLessThanOrEqual(12);
  });
  it('migration automatique d\'une base ancienne (sans colonne bytes ni table de compteurs)', async () => {
    const d1 = new FakeD1();
    d1.db.exec('DROP TABLE sync_totals; ALTER TABLE sync_meta DROP COLUMN bytes;');
    const ins = (k, wid, data) => {
      d1.db.prepare('INSERT INTO sync_meta (k, version, wid, chunks, updated_at) VALUES (?, 1, ?, 1, 0)').run(k, wid);
      d1.db.prepare('INSERT INTO sync_chunks (k, wid, idx, data) VALUES (?, ?, 0, ?)').run(k, wid, data);
    };
    ins('doc_pp_a', 'w1', 'x'.repeat(700)); ins('img_pp_b_c', 'w2', 'y'.repeat(300)); ins('doc_qq_a', 'w3', 'z'.repeat(50));
    const s = makeSync(d1);
    expect((await s.call('doc_pp_nouveau', { method: 'PUT', body: '"12345"', base: 0 })).status).toBe(200);
    expect(s.totals()).toEqual({ global: [1050 + 7, 4], img: [300, 1], 'p:pp': [1000 + 7, 3], 'p:qq': [50, 1] });
    expect(s.totals().global[0]).toBe(bytesReels(d1));
    expect(d1.db.prepare("SELECT bytes FROM sync_meta WHERE k = 'doc_pp_a'").get().bytes).toBe(700);
  });
  it('un compteur gonflé ne bloque jamais : le recomptage le corrige avant tout refus', async () => {
    const s = makeSync();
    await s.call('doc_pp_m1', { method: 'PUT', body: '"x"', base: 0 });
    s.d1.db.exec("UPDATE sync_totals SET keys = 5000 WHERE scope = 'p:pp'; UPDATE sync_totals SET bytes = 999999999 WHERE scope = 'global'");
    const r = await s.call('doc_pp_m2', { method: 'PUT', body: '"y"', base: 0 });
    expect(r.status).toBe(200);
    expect(s.totals()['p:pp'][1]).toBe(2);
    expect(s.totals().global[0]).toBe(bytesReels(s.d1));
  });
  it('un vrai dépassement reste refusé (507) après vérification', async () => {
    const s = makeSync();
    await s.call('doc_pp_m1', { method: 'PUT', body: '"x"', base: 0 });
    // 2 000 clés réelles pour ce profil (plafond), compteurs cohérents
    const ins = s.d1.db.prepare("INSERT INTO sync_meta (k, version, wid, chunks, updated_at, bytes) VALUES (?, 1, ?, 1, 0, 0)");
    const chk = s.d1.db.prepare("INSERT INTO sync_chunks (k, wid, idx, data) VALUES (?, ?, 0, '')");
    for (let i = 0; i < 1999; i++) { ins.run('aichat_pp_' + i, 'w' + i); chk.run('aichat_pp_' + i, 'w' + i); }
    s.d1.db.exec("UPDATE sync_totals SET keys = 2000 WHERE scope = 'p:pp'");
    const r = await s.call('doc_pp_nouvelle', { method: 'PUT', body: '"y"', base: 0 });
    expect(r.status).toBe(507);
    expect((await r.json()).quota).toBe('keys');
    // réécrire une clé existante reste possible
    expect((await s.call('doc_pp_m1', { method: 'PUT', body: '"z"', base: 1 })).status).toBe(200);
  });
  it('__usage__ expose le compteur à côté du balayage (repérer une dérive)', async () => {
    const s = makeSync();
    await s.call('doc_pp_m1', { method: 'PUT', body: '"abcdef"', base: 0 });
    const u = await (await s.call('__usage__')).json();
    expect(u.totalBytes).toBe(8);
    expect(u.counterBytes).toBe(8);
  });
  it('la base neuve (sync-schema.sql) porte déjà la colonne et la table', () => {
    const sql = read('worker/sync-schema.sql');
    expect(sql).toMatch(/bytes\s+INTEGER NOT NULL DEFAULT 0/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS sync_totals/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS ai_usage/);
  });
});

// ───────────── 015 : relais IA ─────────────
const SSE_OK = () => new Response('data: {"candidates":[{"content":{"parts":[{"text":"bonjour"}]}}]}\n\n', { status: 200 });
function makeAi(extraEnv) {
  const d1 = new FakeD1();
  const env = { SYNC_KEY: KEY, GEMINI_API_KEY: 'g', DB: d1, ...(extraEnv || {}) };
  const worker = loadWorker('worker/worker.js');
  const call = (pid) => worker.fetch(new Request('https://ai.test/', {
    method: 'POST', body: JSON.stringify({ prompt: 'Bonjour', maxTokens: 50 }),
    headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', ...(pid ? { 'X-Plume-Profile-Id': pid } : {}) }
  }), env);
  const compteur = pid => (d1.db.prepare('SELECT n FROM ai_usage WHERE pid = ?').get(pid) || { n: 0 }).n;
  return { d1, call, compteur };
}

describe('015 — plafond quotidien par profil', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; vi.useRealTimers(); });
  it('refuse au-delà du plafond (429 « daily-limit »), sans appeler Gemini, et par profil', async () => {
    const f = vi.fn(async () => SSE_OK()); globalThis.fetch = f;
    const s = makeAi({ AI_DAILY_LIMIT: '2' });
    expect((await s.call('aaaa-1')).status).toBe(200);
    expect((await s.call('aaaa-1')).status).toBe(200);
    const r = await s.call('aaaa-1');
    expect(r.status).toBe(429);
    expect((await r.json()).error.code).toBe('daily-limit');
    expect(f).toHaveBeenCalledTimes(2);
    expect((await s.call('bbbb-2')).status).toBe(200); // un autre profil n'est pas touché
    expect(s.compteur('aaaa-1')).toBe(2); // le refus n'a pas gonflé le compteur
  });
  it('un en-tête absent ou invalide compte sous « anon » ; plafond par défaut 200', async () => {
    globalThis.fetch = vi.fn(async () => SSE_OK());
    const s = makeAi();
    await s.call(); await s.call('<script>');
    expect(s.compteur('anon')).toBe(2);
    expect(read('worker/worker.js')).toMatch(/DEFAULT_DAILY_LIMIT = 200/);
  });
  it('un appel refusé par le fournisseur est rendu (ne compte pas)', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 500 }));
    const s = makeAi();
    expect((await s.call('aaaa-1')).status).toBe(500);
    expect(s.compteur('aaaa-1')).toBe(0);
  });
  it('sans liaison D1, aucun plafond (comportement d\'avant)', async () => {
    globalThis.fetch = vi.fn(async () => SSE_OK());
    const worker = loadWorker('worker/worker.js');
    const r = await worker.fetch(new Request('https://ai.test/', { method: 'POST', body: '{"prompt":"x"}', headers: { Authorization: 'Bearer ' + KEY } }), { SYNC_KEY: KEY, GEMINI_API_KEY: 'g' });
    expect(r.status).toBe(200);
  });
  it('la pré-vérification CORS accepte l\'en-tête d\'identifiant de profil', async () => {
    const worker = loadWorker('worker/worker.js');
    const r = await worker.fetch(new Request('https://ai.test/', { method: 'OPTIONS' }), { SYNC_KEY: KEY });
    expect(r.headers.get('Access-Control-Allow-Headers')).toContain('X-Plume-Profile-Id');
  });
  it('le client envoie l\'identifiant du profil, et le Worker IA est lié à la base', () => {
    expect(read('js/ai.js')).toMatch(/'X-Plume-Profile-Id': _currentProfileId/);
    expect(read('worker/wrangler-ai.toml')).toMatch(/binding = "DB"[\s\S]*database_id = "f6c1beed-fcc1-4bed-9a59-e06d603a0e93"/);
  });
});

describe('015 — délai et nouvelle tentative vers Gemini', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; vi.useRealTimers(); });
  it('une seule nouvelle tentative après 2 s sur un 429, puis la réponse passe', async () => {
    vi.useFakeTimers();
    let n = 0;
    globalThis.fetch = vi.fn(async () => (++n === 1 ? new Response('{}', { status: 429 }) : SSE_OK()));
    const s = makeAi();
    const p = s.call('aaaa-1');
    await vi.advanceTimersByTimeAsync(2100);
    const r = await p;
    expect(r.status).toBe(200);
    expect(n).toBe(2);
    expect(s.compteur('aaaa-1')).toBe(1);
  });
  it('deux 429 de suite : le 429 est relayé (message « saturé »), et rendu au compteur', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 429 }));
    const s = makeAi();
    const p = s.call('aaaa-1');
    await vi.advanceTimersByTimeAsync(2100);
    const r = await p;
    expect(r.status).toBe(429);
    expect((await r.json()).error.message).toMatch(/saturé/);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(s.compteur('aaaa-1')).toBe(0);
  });
  it('un fournisseur qui ne répond pas est coupé au bout de 25 s : 504 propre, compteur rendu', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn((url, opts) => new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(new DOMException('annulé', 'AbortError')))));
    const s = makeAi();
    const p = s.call('aaaa-1');
    await vi.advanceTimersByTimeAsync(25100);
    const r = await p;
    expect(r.status).toBe(504);
    expect((await r.json()).error.message).toMatch(/ne répond pas/);
    expect(s.compteur('aaaa-1')).toBe(0);
  });
  it('une autre erreur réseau reste un 500 générique (jamais le texte de l\'exception)', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('secret-interne-xyz'); });
    const s = makeAi();
    const r = await s.call('aaaa-1');
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain('secret-interne-xyz');
  });
});
