// ═══════════════════════════════════════════════════════
// LOT 2 (v9.21.0) — QUOTA D'ÉCRITURE KV ET ATTENTES RÉSEAU (AUD-01-005/017)
// Le quota gratuit de Cloudflare KV (1 000 écritures/jour) est la contrainte
// n°1 du projet. Ces tests verrouillent la règle : « rien n'a changé → rien
// n'est écrit en ligne », et « chaque requête a une durée maximale ».
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const JS_DIR = path.join(ROOT, 'js');
const SYNC_KEY = 'cle-de-synchro-de-test';
const DEK = 'cle-de-donnees-du-profil-de-test';
const PID = 'p1';
const DOC_KEY = 'doc_p1_m1';
const LIST_KEY = 'doclist_p1';

function makeServer() {
  const kv = new Map();
  const calls = { PUT: 0, GET: 0 };
  const env = {
    SYNC_KEY,
    PLUME_SYNC: {
      async getWithMetadata(k) { return kv.has(k) ? kv.get(k) : { value: null, metadata: null }; },
      async put(k, v, o) { kv.set(k, { value: v, metadata: (o && o.metadata) || null }); }
    }
  };
  const worker = new Function(fs.readFileSync(path.join(ROOT, 'worker', 'sync-worker.js'), 'utf8').replace('export default', 'return'))();
  async function serverFetch(url, opts = {}) {
    const method = (opts && opts.method) || 'GET';
    if (method === 'PUT') calls.PUT++; else if (!/__ping__/.test(url)) calls.GET++;
    const req = new Request(url, { method, headers: (opts && opts.headers) || {}, body: (opts && opts.body) || undefined });
    return await worker.fetch(req, env);
  }
  return { kv, calls, serverFetch };
}
function makeDevice(serverFetch) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
  const ctx = dom.window;
  vm.createContext(ctx);
  Object.defineProperty(ctx, 'crypto', { value: globalThis.crypto, configurable: true });
  ctx.Request = globalThis.Request; ctx.Response = globalThis.Response;
  ctx.fetch = (url, opts) => serverFetch(url, opts);
  ctx.toast = () => {};
  ctx.DOMPurify = { sanitize: x => x };
  for (const f of ['schema.js', 'crypto.js', 'router.js', 'library.js']) vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), ctx, { filename: f });
  ctx.onload = null;
  ctx.setSyncKey(SYNC_KEY);
  vm.runInContext(`_dataKey = ${JSON.stringify(DEK)}; _currentProfileId = ${JSON.stringify(PID)};`, ctx);
  return ctx;
}
const settle = async () => { for (let i = 0; i < 25; i++) await new Promise(r => setTimeout(r, 0)); };
const ms = t => ({ _schemaVersion: 1, title: 'T', chapters: [{ id: 'c1', title: 'C', content: t }] });

describe('Écritures en ligne : rien n\'a changé → rien n\'est envoyé (AUD-01-005)', () => {
  it('30 sauvegardes d\'un contenu identique ne produisent qu\'UN seul envoi', async () => {
    const server = makeServer();
    const a = makeDevice(server.serverFetch);
    for (let i = 0; i < 30; i++) {
      await a.persistData(DOC_KEY, await a.makeEncryptedEnvelope(JSON.stringify(ms('même texte'))));
      await settle();
    }
    a.flushPendingSyncPushes(); await settle();
    expect(server.calls.PUT).toBe(1);
  });

  it('un contenu réellement modifié est bien envoyé (pas de perte)', async () => {
    const server = makeServer();
    const a = makeDevice(server.serverFetch);
    await a.persistData(DOC_KEY, await a.makeEncryptedEnvelope(JSON.stringify(ms('v1')))); await settle();
    await a.persistData(DOC_KEY, await a.makeEncryptedEnvelope(JSON.stringify(ms('v2')))); await settle();
    a.flushPendingSyncPushes(); await settle();
    const stored = JSON.parse(server.kv.get(DOC_KEY).value);
    const plain = JSON.parse(await vm.runInContext(`Crypto.decrypt(${JSON.stringify(stored.data)}, ${JSON.stringify(DEK)})`, a));
    expect(plain.chapters[0].content).toBe('v2');
  });

  it('revenir au contenu déjà synchronisé annule l\'envoi d\'un contenu intermédiaire en attente', async () => {
    const server = makeServer();
    const a = makeDevice(server.serverFetch);
    await a.persistData(DOC_KEY, await a.makeEncryptedEnvelope(JSON.stringify(ms('base')))); await settle(); // part tout de suite
    await a.persistData(DOC_KEY, await a.makeEncryptedEnvelope(JSON.stringify(ms('brouillon')))); await settle(); // différé
    await a.persistData(DOC_KEY, await a.makeEncryptedEnvelope(JSON.stringify(ms('base')))); await settle();     // retour à la base
    a.flushPendingSyncPushes(); await settle();
    expect(server.calls.PUT).toBe(1);
  });

  it('l\'index de la bibliothèque est espacé : 30 réécritures rapprochées = 1 envoi immédiat + 1 au moment du flush', async () => {
    const server = makeServer();
    const a = makeDevice(server.serverFetch);
    for (let i = 0; i < 30; i++) {
      await a.persistData(LIST_KEY, { version: 1, documents: [{ id: 'm1', title: 'T', lastModified: 1000 + i, wordCount: i }] });
      await settle();
    }
    expect(server.calls.PUT).toBe(0);
    a.flushPendingSyncPushes(); await settle();
    expect(server.calls.PUT).toBe(1);
    const stored = JSON.parse(server.kv.get(LIST_KEY).value);
    expect(stored.documents[0].wordCount).toBe(29); // la dernière valeur n'est pas perdue
  });

  it('lectures locales répétées : une seule vérification serveur par période de repos', async () => {
    const server = makeServer();
    const a = makeDevice(server.serverFetch);
    await a.persistData(LIST_KEY, { version: 1, documents: [] }); await settle();
    server.calls.GET = 0;
    for (let i = 0; i < 10; i++) { await a.loadData(LIST_KEY); await settle(); }
    expect(server.calls.GET).toBeLessThanOrEqual(1);
  });
});

describe('Durée maximale des requêtes (AUD-01-017)', () => {
  const rt = fs.readFileSync(path.join(JS_DIR, 'router.js'), 'utf8');
  function makeCtx(fetchImpl) {
    const ctx = vm.createContext({ console, setTimeout, clearTimeout, AbortController, Promise });
    ctx.fetch = fetchImpl;
    vm.runInContext(rt.slice(rt.indexOf('const DEFAULT_FETCH_TIMEOUT_MS'), rt.indexOf('function getSyncKey()')) + '\nthis.fetchWithTimeout = fetchWithTimeout;', ctx);
    return ctx;
  }
  it('abandonne avec un message clair quand le serveur ne répond pas', async () => {
    const ctx = makeCtx((url, opts) => new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' })))));
    await expect(ctx.fetchWithTimeout('https://x', { timeoutMs: 40 })).rejects.toThrow(/Délai dépassé/);
  });
  it('laisse passer une réponse normale et n\'envoie pas timeoutMs au réseau', async () => {
    let seen;
    const ctx = makeCtx(async (url, opts) => { seen = opts; return new Response('ok'); });
    const r = await ctx.fetchWithTimeout('https://x', { method: 'POST', timeoutMs: 1000 });
    expect(await r.text()).toBe('ok');
    expect(seen.timeoutMs).toBeUndefined();
    expect(seen.method).toBe('POST');
  });
  it('le démarrage ne consulte plus le serveur pour l\'ancienne clé « main »', () => {
    const src = fs.readFileSync(path.join(JS_DIR, 'profiles.js'), 'utf8');
    const boot = src.slice(src.indexOf('async function bootProfiles'), src.indexOf('renderLoginScreen(idx);'));
    expect(boot).toMatch(/readLocalOnly\('main'\)/);
    expect(boot).not.toMatch(/loadData\('main'\)/);
  });
  it('plus aucun fetch nu dans les modules (hors utilitaire)', () => {
    for (const f of fs.readdirSync(JS_DIR).filter(n => n.endsWith('.js'))) {
      const code = fs.readFileSync(path.join(JS_DIR, f), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
      const bare = (code.match(/(^|[^\w.])fetch\(/g) || []).length;
      // router.js contient l'utilitaire lui-même (2 appels internes autorisés)
      expect(bare, f).toBeLessThanOrEqual(f === 'router.js' ? 2 : 0);
    }
  });
});

describe('Minuteurs de 5 minutes : pas d\'enregistrement à vide (AUD-01-005)', () => {
  it('takeSnapshot indique s\'il a réellement créé un instantané', () => {
    const ctx = vm.createContext({ console, setInterval: () => 0, document: { body: { classList: { contains: () => false } } } });
    vm.runInContext("var db = { chapters: [{ id: 'c1', title: 'T', content: 'abc' }], history: {} }; var cur = 0;", ctx);
    vm.runInContext(fs.readFileSync(path.join(JS_DIR, 'snapshots.js'), 'utf8') + '\nthis.takeSnapshot = takeSnapshot;', ctx);
    expect(ctx.takeSnapshot(0)).toBe(true);
    expect(ctx.takeSnapshot(0)).toBe(false); // même contenu : pas de nouvel instantané
  });
  it('le minuteur ne touche pas au manuscrit quand la bibliothèque est affichée', () => {
    const src = fs.readFileSync(path.join(JS_DIR, 'snapshots.js'), 'utf8');
    expect(src).toMatch(/classList\.contains\('library-mode'\)\) return/);
  });
});
