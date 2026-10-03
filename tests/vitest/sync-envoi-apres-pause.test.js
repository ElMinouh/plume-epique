// ═══════════════════════════════════════════════════════
// LOT 2b (v9.22.0) — ENVOI EN LIGNE « APRÈS UNE PAUSE »
// Remplace les tests de l'espacement adaptatif 20/45/90 s (v9.3.x). Règles :
//  • la sauvegarde locale ne change pas ; l'envoi en ligne attend une pause
//    (1 min) ou l'attente maximale (5 min), ou un flush explicite ;
//  • un envoi dû est inscrit dans la file de reprise (survit à une fermeture) ;
//  • à la fermeture / masquage, le contenu en mémoire part sans relire IndexedDB ;
//  • le repli global (503) est conservé.
// ═══════════════════════════════════════════════════════
import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JS_DIR = path.join(path.resolve(__dirname, '..', '..'), 'js');

function makeRouterContext(fetchImpl) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
  const ctx = dom.window;
  vm.createContext(ctx);
  Object.defineProperty(ctx, 'crypto', { value: globalThis.crypto, configurable: true });
  ctx.Response = globalThis.Response;
  ctx.fetch = fetchImpl;
  ctx.toast = vi.fn();
  const load = f => vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), ctx, { filename: f });
  load('schema.js'); load('crypto.js'); load('router.js'); load('library.js');
  ctx.onload = null;
  ctx.setSyncKey('cle-test');
  return ctx;
}
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 0)); };
function okFetch(counter) {
  return vi.fn(async (url, opts) => {
    if (opts && opts.method === 'PUT') { counter.puts++; counter.bodies.push(opts.body); return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'X-Plume-Version': String(counter.puts) } }); }
    return new Response('null', { status: 200, headers: { 'X-Plume-Version': '0' } });
  });
}

describe('Envoi après une pause (v9.22.0)', () => {
  it('plusieurs sauvegardes rapprochées : aucun envoi tout de suite, puis un seul (le plus récent) au flush', async () => {
    const c = { puts: 0, bodies: [] };
    const ctx = makeRouterContext(okFetch(c));
    for (let i = 1; i <= 5; i++) await ctx.persistData('doc_1', { titre: 'Version ' + i });
    await settle();
    expect(c.puts).toBe(0);
    ctx.flushPendingSyncPushes();
    await settle();
    expect(c.puts).toBe(1);
    expect(JSON.parse(c.bodies[0])).toEqual({ titre: 'Version 5' });
  });

  it('un envoi dû est inscrit dans la file de reprise dès la modification, puis retiré une fois envoyé', async () => {
    const c = { puts: 0, bodies: [] };
    const ctx = makeRouterContext(okFetch(c));
    await ctx.persistData('doc_1', { titre: 'x' });
    expect(ctx.getPendingSyncKeys()).toContain('doc_1'); // survit à une fermeture brutale de l'onglet
    ctx.flushPendingSyncPushes(); await settle();
    expect(ctx.getPendingSyncKeys()).not.toContain('doc_1');
  });

  it('après une fermeture brutale, la file de reprise renvoie le contenu local au démarrage suivant', async () => {
    const c = { puts: 0, bodies: [] };
    const ctx = makeRouterContext(okFetch(c));
    await ctx.persistData('doc_1', { titre: 'dernier etat' });
    // « fermeture » : le minuteur disparaît sans avoir envoyé
    vm.runInContext("clearTimeout(_pushDebounceTimers['doc_1']); delete _pushDebounceTimers['doc_1'];", ctx);
    expect(c.puts).toBe(0);
    // « prochain démarrage » : la file de reprise est rejouée
    await ctx.retryPendingSyncs(); await settle();
    expect(c.puts).toBe(1);
    expect(JSON.parse(c.bodies[0])).toEqual({ titre: 'dernier etat' });
  });

  it('flush urgent (fermeture/masquage) : envoie le contenu en mémoire SANS relire IndexedDB', async () => {
    const c = { puts: 0, bodies: [] };
    const ctx = makeRouterContext(okFetch(c));
    await ctx.persistData('doc_1', { titre: 'en memoire' });
    vm.runInContext("readLocalOnly = async () => { throw new Error('ne doit pas etre appelee'); };", ctx);
    ctx.flushPendingSyncPushes(true);
    await settle();
    expect(c.puts).toBe(1);
    expect(JSON.parse(c.bodies[0])).toEqual({ titre: 'en memoire' });
  });

  it('les profils et réglages restent envoyés tout de suite ; l\'index de bibliothèque attend', async () => {
    const c = { puts: 0, bodies: [] };
    const ctx = makeRouterContext(okFetch(c));
    await ctx.persistData('profiles', { profiles: [{ id: 'p1' }] });
    await ctx.persistData('libsettings_p1', { autoGistInterval: 15 });
    await ctx.persistData('doclist_p1', { documents: [{ id: 'm1' }] });
    await settle();
    expect(c.puts).toBe(2);
    ctx.flushPendingSyncPushes(); await settle();
    expect(c.puts).toBe(3);
  });

  it('calcul du délai : pause de 1 min, attente maximale de 5 min, index plus patient, repli global prioritaire', () => {
    const ctx = makeRouterContext(okFetch({ puts: 0, bodies: [] }));
    const f = (idx, since, now, bo) => vm.runInContext(`computePushDelay(${idx}, ${since}, ${now}, ${bo})`, ctx);
    expect(f(false, 1000, 1000, 0)).toBe(60000);              // début : pause de 60 s
    expect(f(false, 0, 290000, 0)).toBe(10000);               // 4 min 50 d'écriture continue : plus que 10 s avant la limite des 5 min
    expect(f(false, 0, 400000, 0)).toBe(0);                   // limite dépassée : part tout de suite
    expect(f(true, 1000, 1000, 0)).toBe(120000);              // index : 2 min
    expect(f(true, 0, 590000, 0)).toBe(10000);                // index : limite des 10 min
    expect(f(false, 1000, 1000, 1000 + 900000)).toBe(900000); // repli global actif : on attend sa fin
  });
});

describe('Repli global partagé (conservé de la v9.3.3)', () => {
  it("une panne d'écriture confirmée (503) retient TOUS les envois de cet appareil, pas seulement la clé en échec", async () => {
    let puts = 0;
    const fetchMock = vi.fn(async (url, opts) => {
      if (opts && opts.method === 'PUT') {
        puts++;
        if (puts === 1) return new Response(JSON.stringify({ error: { message: 'indisponible' } }), { status: 503, headers: { 'Retry-After': '900' } });
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'X-Plume-Version': String(puts) } });
      }
      return new Response('null', { status: 200, headers: { 'X-Plume-Version': '0' } });
    });
    const ctx = makeRouterContext(fetchMock);
    await ctx.persistData('doc_1', { titre: 'declenche la panne' });
    ctx.flushPendingSyncPushes(); await settle();
    expect(puts).toBe(1);
    expect(ctx.getGlobalBackoffUntil()).toBeGreaterThan(Date.now());

    // Un autre manuscrit : son minuteur est repoussé au-delà du répit.
    await ctx.persistData('doc_2', { titre: 'autre manuscrit' });
    const delay = vm.runInContext("computePushDelay(false, Date.now(), Date.now(), getGlobalBackoffUntil())", ctx);
    expect(delay).toBeGreaterThan(14 * 60 * 1000);

    // Répit écoulé : les envois reprennent.
    vm.runInContext("localStorage.setItem('plume_sync_global_backoff_until', String(Date.now() - 1000));", ctx);
    ctx.flushPendingSyncPushes(); await settle();
    expect(puts).toBe(2);
  });

  it('le repli global n\'affecte pas les clés hors manuscrit (profils)', async () => {
    const c = { puts: 0, bodies: [] };
    const ctx = makeRouterContext(okFetch(c));
    vm.runInContext("localStorage.setItem('plume_sync_global_backoff_until', String(Date.now() + 15 * 60 * 1000));", ctx);
    await ctx.persistData('profiles', { profiles: [{ id: 'p1' }] });
    await settle();
    expect(c.puts).toBe(1);
  });
});

describe('Fermeture / masquage de la page (v9.22.0)', () => {
  it('la dernière frappe non enregistrée est sauvée localement ET envoyée en ligne quand la page est masquée', async () => {
    const c = { puts: 0, bodies: [] };
    const ctx = makeRouterContext(okFetch(c));
    ctx.flushCurrentChapter = () => {}; ctx.flashSave = () => {}; ctx.updateDailyStats = () => {}; // éditeur et stats non chargés dans ce test
    vm.runInContext("_currentProfileId = 'p1'; _currentDocumentId = 'm1'; _dataKey = 'cle'; db = { title: 'T', chapters: [{ id: 'c1', title: 'C', content: 'derniers mots' }] }; _unsavedChanges = true;", ctx);
    ctx.dispatchEvent(new ctx.Event('pagehide'));
    for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 5));
    const local = JSON.parse(ctx.localStorage.getItem('plume_doc_p1_m1'));
    expect(local._enc).toBe(true);        // enregistré localement sans attendre les 600 ms
    expect(c.puts).toBe(2);               // et envoyé en ligne tout de suite : le manuscrit + la fiche de bibliothèque
  });
  it('rien à sauver ni à envoyer : le masquage ne produit aucune écriture', async () => {
    const c = { puts: 0, bodies: [] };
    const ctx = makeRouterContext(okFetch(c));
    vm.runInContext("_currentProfileId = 'p1'; _currentDocumentId = 'm1'; _dataKey = 'cle'; db = { title: 'T', chapters: [] }; _unsavedChanges = false;", ctx);
    ctx.dispatchEvent(new ctx.Event('pagehide'));
    for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 5));
    expect(c.puts).toBe(0);
  });
});
