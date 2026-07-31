// ═══════════════════════════════════════════════════════
// v9.3.3 — Face au risque qu'un usage à plusieurs personnes (jusqu'à 5)
// épuise quand même le quota gratuit malgré le plafonnement fixe de la
// v9.3.1, deux mécanismes supplémentaires sont vérifiés ici :
//
//  B. Espacement ADAPTATIF : l'intervalle s'allonge (20s → 45s → 90s) tant
//     qu'un manuscrit reste écrit en continu, et revient à 20s après une
//     vraie pause.
//  C. Repli GLOBAL PARTAGÉ : une panne d'écriture confirmée par le serveur
//     (503, quota épuisé ou autre) ralentit tous les envois de CET appareil
//     pendant un répit commun — signal naturellement partagé entre tous les
//     utilisateurs puisque le quota KV est unique pour tout le compte.
// ═══════════════════════════════════════════════════════
import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const JS_DIR = path.join(REPO_ROOT, 'js');

function makeRouterContext(fetchImpl) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
  const ctx = dom.window;
  vm.createContext(ctx);
  Object.defineProperty(ctx, 'crypto', { value: globalThis.crypto, configurable: true });
  ctx.Response = globalThis.Response;
  ctx.fetch = fetchImpl;
  ctx.toast = vi.fn();
  const load = f => vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), ctx, { filename: f });
  load('schema.js');
  load('router.js');
  ctx.onload = null;
  return ctx;
}

async function settle() { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)); }

describe('v9.3.3 — Espacement adaptatif (B)', () => {
  it("l'intervalle s'allonge (20s → 45s → 90s) tant que l'écriture continue sans vraie pause", async () => {
    let puts = 0;
    const fetchMock = vi.fn(async (url, opts) => {
      if (opts && opts.method === 'PUT') { puts++; return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'X-Plume-Version': String(puts) } }); }
      return new Response('null', { status: 200, headers: { 'X-Plume-Version': '0' } });
    });
    const ctx = makeRouterContext(fetchMock);
    ctx.setSyncKey('cle-test');

    await ctx.persistData('doc_1', { titre: 'v1' });
    await settle();
    expect(puts).toBe(1); // premier envoi, toujours immédiat

    // Rafale continue : moins de 20s d'écart entre chaque appel (simulé),
    // toujours dans la même « rafale » d'écriture.
    await ctx.persistData('doc_1', { titre: 'v2' });
    expect(puts).toBe(1); // différé, l'intervalle de base (20s) n'est pas écoulé

    // Avance artificiellement l'horloge de 21s (streak toujours < 3 min) :
    // l'intervalle reste au premier palier (20s), donc part tout de suite.
    vm.runInContext("_lastPushAt['doc_1'] = Date.now() - 21000;", ctx);
    await ctx.persistData('doc_1', { titre: 'v3' });
    await settle();
    expect(puts).toBe(2);

    // Simule que la rafale dure depuis plus de 3 minutes (mais moins de 10) :
    // l'intervalle attendu passe à 45s. Un écart de 21s (suffisant au palier 1)
    // ne doit PLUS déclencher d'envoi immédiat à ce palier.
    vm.runInContext("_streakStartedAt['doc_1'] = Date.now() - 4 * 60 * 1000;", ctx);
    vm.runInContext("_lastPushAt['doc_1'] = Date.now() - 21000;", ctx);
    await ctx.persistData('doc_1', { titre: 'v4' });
    await settle();
    expect(puts).toBe(2); // toujours différé : 21s < 45s du palier 2

    // En revanche, un écart de 46s suffit au palier 2.
    vm.runInContext("_lastPushAt['doc_1'] = Date.now() - 46000;", ctx);
    await ctx.persistData('doc_1', { titre: 'v5' });
    await settle();
    expect(puts).toBe(3);
  });

  it('une vraie pause (90s sans écrire) remet l’intervalle à 20s, même après une longue rafale', async () => {
    let puts = 0;
    const fetchMock = vi.fn(async (url, opts) => {
      if (opts && opts.method === 'PUT') { puts++; return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'X-Plume-Version': String(puts) } }); }
      return new Response('null', { status: 200, headers: { 'X-Plume-Version': '0' } });
    });
    const ctx = makeRouterContext(fetchMock);
    ctx.setSyncKey('cle-test');

    await ctx.persistData('doc_1', { titre: 'v1' });
    await settle();
    expect(puts).toBe(1);

    // Simule une rafale déjà longue (12 minutes → palier 3, 90s) ET une
    // vraie pause depuis (plus de 90s sans la moindre frappe).
    vm.runInContext("_streakStartedAt['doc_1'] = Date.now() - 12 * 60 * 1000;", ctx);
    vm.runInContext("_lastPushAttemptAt['doc_1'] = Date.now() - 91000;", ctx);
    vm.runInContext("_lastPushAt['doc_1'] = Date.now() - 25000;", ctx); // 25s : insuffisant au palier 3 (90s), mais suffisant si la pause a bien remis au palier 1 (20s)

    await ctx.persistData('doc_1', { titre: 'v2 apres une pause' });
    await settle();
    expect(puts).toBe(2); // reparti tout de suite : la pause a bien réinitialisé l'intervalle à 20s
  });
});

describe('v9.3.3 — Repli global partagé (C)', () => {
  it("une panne d'écriture confirmée par le serveur (503) ralentit TOUS les envois de cet appareil, pas seulement la clé en échec", async () => {
    let puts = 0;
    const fetchMock = vi.fn(async (url, opts) => {
      if (opts && opts.method === 'PUT') {
        puts++;
        // Le tout premier envoi (sur doc_1) tombe sur une panne serveur —
        // le 503 explicite ajouté dans sync-worker.js pour ce cas.
        if (puts === 1) return new Response(JSON.stringify({ error: { message: 'indisponible' } }), { status: 503, headers: { 'Retry-After': '900' } });
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'X-Plume-Version': String(puts) } });
      }
      return new Response('null', { status: 200, headers: { 'X-Plume-Version': '0' } });
    });
    const ctx = makeRouterContext(fetchMock);
    ctx.setSyncKey('cle-test');

    await ctx.persistData('doc_1', { titre: 'declenche la panne' });
    await settle();
    expect(puts).toBe(1);
    expect(ctx.getGlobalBackoffUntil()).toBeGreaterThan(Date.now()); // le repli global est bien armé

    // UN AUTRE manuscrit, jamais touché par l'échec, doit lui aussi patienter :
    // le quota est partagé pour tout le compte, pas propre à doc_1.
    await ctx.persistData('doc_2', { titre: 'autre manuscrit, jamais en echec' });
    await settle();
    expect(puts).toBe(1); // toujours 1 : aucun nouvel envoi tenté pendant le répit

    // Une fois le répit écoulé, les envois reprennent normalement.
    vm.runInContext("localStorage.setItem('plume_sync_global_backoff_until', String(Date.now() - 1000));", ctx);
    await ctx.persistData('doc_2', { titre: 'apres le repit' });
    await settle();
    expect(puts).toBe(2);
  });

  it("le repli global n'affecte pas les clés hors manuscrit (profils, index bibliothèque)", async () => {
    let puts = 0;
    const fetchMock = vi.fn(async (url, opts) => {
      if (opts && opts.method === 'PUT') { puts++; return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'X-Plume-Version': String(puts) } }); }
      return new Response('null', { status: 200, headers: { 'X-Plume-Version': '0' } });
    });
    const ctx = makeRouterContext(fetchMock);
    ctx.setSyncKey('cle-test');
    vm.runInContext("localStorage.setItem('plume_sync_global_backoff_until', String(Date.now() + 15 * 60 * 1000));", ctx);

    await ctx.persistData('profiles', { profiles: [{ id: 'p1' }] });
    await settle();
    expect(puts).toBe(1); // les actions explicites et rares restent instantanées, même en plein répit
  });
});
