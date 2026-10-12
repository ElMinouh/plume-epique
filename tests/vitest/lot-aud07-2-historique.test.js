// ═══════════════════════════════════════════════════════
// AUD-07 LOT 2 (v9.71.0) — HISTORIQUE BORNÉ EN OCTETS ET REFUS D'ENVOI VISIBLE (AUD-07-001)
// Code réel de schema.js et router.js.
// ═══════════════════════════════════════════════════════
import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');

function makeCtx(fetchImpl) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
  const ctx = dom.window;
  vm.createContext(ctx);
  Object.defineProperty(ctx, 'crypto', { value: globalThis.crypto, configurable: true });
  ctx.Request = globalThis.Request; ctx.Response = globalThis.Response;
  ctx.fetch = fetchImpl || (async () => new Response('{}', { status: 200 }));
  ctx.toast = vi.fn(); ctx.DOMPurify = { sanitize: x => x };
  for (const f of ['schema.js', 'crypto.js', 'router.js']) vm.runInContext(read(f), ctx, { filename: f });
  ctx.onload = null; // router.js câble window.onload (initialisation de l'écran) : sans objet ici
  return ctx;
}

describe('001 — plafond d\'octets des copies automatiques (schema.js)', () => {
  const ctx = makeCtx();
  const now = Date.now();
  const MIN = 60000, H = 3600000, D = 86400000;
  const snap = (age, taille, label) => ({ ts: now - age, label: label || 'auto', content: 'x'.repeat(taille), title: 't' });
  it('garde les plus récentes dans la limite d\'octets et fait tomber les plus anciennes', () => {
    const list = [snap(1 * MIN, 900000), snap(30 * MIN, 900000), snap(2 * H, 900000), snap(5 * H, 900000)];
    const out = ctx.thinSnapshots(list, now, 20);
    expect(out.length).toBe(2); // 2 × 0,9 Mo ≤ 2 Mo, la troisième dépasserait
    expect(out[0].ts).toBe(list[0].ts);
    expect(out[1].ts).toBe(list[1].ts);
  });
  it('garde toujours la copie la plus récente, même seule au-dessus du plafond', () => {
    const out = ctx.thinSnapshots([snap(1 * MIN, 3000000), snap(40 * MIN, 100)], now, 20);
    expect(out).toHaveLength(1);
    expect(out[0].content.length).toBe(3000000);
  });
  it('ne retire jamais une copie manuelle, quelle que soit sa taille', () => {
    const manual = snap(3 * D, 2500000, 'Manuel — avant réécriture');
    const out = ctx.thinSnapshots([snap(1 * MIN, 1500000), snap(30 * MIN, 1500000), manual], now, 20);
    expect(out.some(s => s.label.startsWith('Manuel'))).toBe(true);
    expect(out.filter(s => s.label === 'auto')).toHaveLength(1);
  });
  it('ne change rien pour un historique léger (comportement d\'avant)', () => {
    const list = [snap(1 * MIN, 5000), snap(30 * MIN, 5000), snap(2 * H, 5000), snap(5 * D, 5000)];
    expect(ctx.thinSnapshots(list, now, 20)).toHaveLength(4);
  });
  it('l\'effet sur un manuscrit : 20 copies de 400 Ko par chapitre ne dépassent plus 2 Mo', () => {
    const list = [];
    for (let i = 0; i < 20; i++) list.push(snap((i + 1) * 20 * MIN, 400000));
    const out = ctx.thinSnapshots(list, now, 20);
    expect(out.reduce((s, x) => s + x.content.length, 0)).toBeLessThanOrEqual(2000000);
    expect(out.length).toBeGreaterThanOrEqual(1);
  });
});

describe('001 — un envoi trop gros n\'est plus abandonné en silence (router.js)', () => {
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0)); };
  const gros = () => ({ _enc: true, data: 'a'.repeat(20 * 1024 * 1024), _fp: 'f', _ts: 1 });

  it('un contenu de plus de 19 Mio n\'est pas téléversé, et l\'utilisateur est prévenu une seule fois', async () => {
    const puts = [];
    const ctx = makeCtx(async (url, opts) => { if (opts && opts.method === 'PUT') puts.push(url); return new Response('{}', { status: 200 }); });
    ctx.setSyncKey('cle');
    await ctx.syncPush('doc_p1_m1', gros());
    await ctx.syncPush('doc_p1_m1', gros());
    expect(puts).toHaveLength(0);
    const avert = ctx.toast.mock.calls.filter(c => c[2] && c[2].kind === 'sync-size');
    expect(avert).toHaveLength(1);
    expect(avert[0][0]).toMatch(/trop volumineux/);
    expect(avert[0][1]).toBe('error');
    expect(ctx.getPendingSyncKeys()).not.toContain('doc_p1_m1');
  });

  it('un refus 413 du serveur est annoncé (avant : console.warn seulement)', async () => {
    const ctx = makeCtx(async (url, opts) => (opts && opts.method === 'PUT')
      ? new Response('{"error":{"message":"Donnée trop volumineuse."}}', { status: 413 })
      : new Response('null', { status: 200 }));
    ctx.setSyncKey('cle');
    await ctx.syncPush('doc_p1_m2', { _enc: true, data: 'abc', _fp: 'f', _ts: 1 });
    await settle();
    const avert = ctx.toast.mock.calls.filter(c => c[2] && c[2].kind === 'sync-size');
    expect(avert).toHaveLength(1);
    expect(ctx.getPendingSyncKeys()).not.toContain('doc_p1_m2');
  });

  it('un contenu normal part comme avant, sans message', async () => {
    const puts = [];
    const ctx = makeCtx(async (url, opts) => {
      if (opts && opts.method === 'PUT') { puts.push(url); return new Response('{"ok":true,"version":1}', { status: 200, headers: { 'X-Plume-Version': '1' } }); }
      return new Response('null', { status: 200 });
    });
    ctx.setSyncKey('cle');
    await ctx.syncPush('doc_p1_m3', { _enc: true, data: 'a'.repeat(100000), _fp: 'f', _ts: 1 });
    expect(puts).toHaveLength(1);
    expect(ctx.toast.mock.calls.filter(c => c[2] && c[2].kind === 'sync-size')).toHaveLength(0);
  });

  it('les clés qui ne sont pas des manuscrits ne déclenchent pas le message « manuscrit »', async () => {
    const ctx = makeCtx();
    ctx.setSyncKey('cle');
    await ctx.syncPush('doclist_p1', { documents: 'x'.repeat(20 * 1024 * 1024) });
    expect(ctx.toast.mock.calls.filter(c => c[2] && c[2].kind === 'sync-size')).toHaveLength(0);
  });
});
