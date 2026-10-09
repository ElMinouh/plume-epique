// ═══════════════════════════════════════════════════════
// LOT 1 (v9.20.0) — SÉCURITÉ URGENTE (audit AUD-01-002/004/010/012)
//   • Worker IA : refus sans clé, bornes de taille, origine contrôlée ;
//   • Worker de synchro : liste de clés autorisées, taille, frein des essais,
//     distinction quota / autre erreur ;
//   • DOMPurify : le VRAI assainisseur (la suite principale utilise un stub
//     qui ne filtre rien) + cohérence de version avec index.html et sw.js ;
//   • callClaude : n'appelle pas le réseau sans clé de synchronisation.
// ═══════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const loadWorker = file => new Function(read(file).replace('export default', 'return'))();

const KEY = 'cle-de-test-lot1';
const ORIGIN = 'https://plume-epique.pages.dev';

// ── Worker IA ────────────────────────────────────────────
describe('Worker IA — authentification et bornes (AUD-01-004)', () => {
  const worker = loadWorker('worker/worker.js');
  const env = { SYNC_KEY: KEY, GEMINI_API_KEY: 'g-test' };
  let geminiBodies;

  beforeEach(() => {
    geminiBodies = [];
    globalThis.fetch = vi.fn(async (url, opts) => {
      geminiBodies.push(JSON.parse(opts.body));
      return new Response('data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n', { status: 200 });
    });
  });
  const call = (body, headers = {}, e = env) => worker.fetch(new Request('https://ai.test/', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body)
  }), e);

  it('refuse un appel sans Authorization (401) et ne contacte pas Gemini', async () => {
    const r = await call({ prompt: 'bonjour' });
    expect(r.status).toBe(401);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('refuse une mauvaise clé (401)', async () => {
    expect((await call({ prompt: 'x' }, { Authorization: 'Bearer autre' })).status).toBe(401);
  });
  it('refuse tout si le secret SYNC_KEY n\'est pas configuré sur le Worker (fail-closed)', async () => {
    expect((await call({ prompt: 'x' }, { Authorization: 'Bearer ' + KEY }, { GEMINI_API_KEY: 'g' })).status).toBe(401);
  });
  it('refuse une origine étrangère (403) même avec la bonne clé', async () => {
    expect((await call({ prompt: 'x' }, { Authorization: 'Bearer ' + KEY, Origin: 'https://evil.example' })).status).toBe(403);
  });
  it('accepte l\'origine de l\'application et ses prévisualisations', async () => {
    expect((await call({ prompt: 'x' }, { Authorization: 'Bearer ' + KEY, Origin: ORIGIN })).status).toBe(200);
    expect((await call({ prompt: 'x' }, { Authorization: 'Bearer ' + KEY, Origin: 'https://abc123.plume-epique.pages.dev' })).status).toBe(200);
  });
  it('refuse un prompt trop long (413)', async () => {
    const r = await call({ prompt: 'a'.repeat(30001) }, { Authorization: 'Bearer ' + KEY });
    expect(r.status).toBe(413);
  });
  it('plafonne maxTokens à 4000 et applique 1000 par défaut', async () => {
    await call({ prompt: 'x', maxTokens: 999999 }, { Authorization: 'Bearer ' + KEY });
    await call({ prompt: 'x' }, { Authorization: 'Bearer ' + KEY });
    await call({ prompt: 'x', maxTokens: 'abc' }, { Authorization: 'Bearer ' + KEY });
    expect(geminiBodies.map(b => b.generationConfig.maxOutputTokens)).toEqual([4000, 1000, 1000]);
  });
  it('relaie la réponse en flux au format attendu par ai.js avec une demande valide', async () => {
    const r = await call({ prompt: 'x', maxTokens: 200 }, { Authorization: 'Bearer ' + KEY });
    expect(await r.text()).toContain('"content":"ok"');
  });
});

// ── Worker de synchronisation ───────────────────────────
describe('Worker de synchro — durcissement (AUD-01-010)', () => {
  const worker = loadWorker('worker/sync-worker.js');
  function makeEnv(putImpl) {
    const kv = new Map();
    return {
      kv,
      SYNC_KEY: KEY,
      PLUME_SYNC: {
        async getWithMetadata(k) { return kv.get(k) || { value: null, metadata: null }; },
        put: putImpl || (async (k, v, o) => { kv.set(k, { value: v, metadata: o.metadata }); })
      }
    };
  }
  const req = (key, { method = 'GET', body, auth = KEY, ip = '1.1.1.1', base = '0' } = {}) => new Request('https://sync.test/?key=' + encodeURIComponent(key), {
    method, body,
    headers: { Authorization: 'Bearer ' + auth, 'CF-Connecting-IP': ip, 'X-Plume-Base-Version': base }
  });

  it('accepte toutes les clés réellement utilisées par l\'application', async () => {
    const env = makeEnv();
    for (const k of ['profiles', '__ping__', 'main', 'doclist_abc-123', 'data_abc', 'libsettings_abc', 'doc_abc_def', 'aichat_abc_def']) {
      expect((await worker.fetch(req(k), env)).status, k).toBe(200);
    }
  });
  it('refuse les clés hors liste (400)', async () => {
    const env = makeEnv();
    for (const k of ['autre', 'doc_abc', '../profiles', 'doc_', 'conflict_doc_a_b_1', 'x'.repeat(300)]) {
      expect((await worker.fetch(req(k), env)).status, k).toBe(400);
    }
  });
  it('refuse une valeur trop volumineuse (413)', async () => {
    const env = makeEnv();
    const r = await worker.fetch(req('doc_a_b', { method: 'PUT', body: 'x'.repeat(20 * 1024 * 1024 + 1) }), env);
    expect(r.status).toBe(413);
    expect(env.kv.size).toBe(0);
  });
  it('freine les essais de clé ratés : 429 après 10 échecs, puis même une bonne clé est refusée depuis cette adresse', async () => {
    const env = makeEnv();
    for (let i = 0; i < 10; i++) expect((await worker.fetch(req('profiles', { auth: 'faux', ip: '9.9.9.9' }), env)).status).toBe(401);
    expect((await worker.fetch(req('profiles', { auth: 'faux', ip: '9.9.9.9' }), env)).status).toBe(429);
    expect((await worker.fetch(req('profiles', { ip: '9.9.9.9' }), env)).status).toBe(429);
    expect((await worker.fetch(req('profiles', { ip: '8.8.8.8' }), env)).status).toBe(200); // autre adresse : non touchée
  });
  it('une erreur de quota KV donne 503 + Retry-After, une autre erreur donne 500', async () => {
    const quota = makeEnv(async () => { throw new Error('KV PUT failed: 429 Too Many Requests'); });
    const r1 = await worker.fetch(req('doc_a_b', { method: 'PUT', body: '{}', ip: '2.2.2.2' }), quota);
    expect(r1.status).toBe(503);
    expect(r1.headers.get('Retry-After')).toBe('900');
    const autre = makeEnv(async () => { throw new Error('boom'); });
    const r2 = await worker.fetch(req('doc_a_b', { method: 'PUT', body: '{}', ip: '3.3.3.3' }), autre);
    expect(r2.status).toBe(500);
  });
});

// ── DOMPurify réel ───────────────────────────────────────
describe('DOMPurify réel (AUD-01-002) — la suite principale le remplace par un stub', () => {
  const window = new JSDOM('').window;
  const DOMPurify = createDOMPurify(window);

  it('la version testée est celle chargée par index.html ET par sw.js', () => {
    const fromHtml = read('index.html').match(/vendor\/dompurify-([\d.]+)\.min\.js/)[1];
    const fromSw = read('sw.js').match(/vendor\/dompurify-([\d.]+)\.min\.js/)[1];
    expect(fromHtml).toBe(fromSw);
    expect(DOMPurify.version).toBe(fromHtml);
  });
  it('jsPDF : même version dans index.html et sw.js', () => {
    expect(read('index.html').match(/vendor\/jspdf-([\d.]+)\.umd/)[1]).toBe(read('sw.js').match(/vendor\/jspdf-([\d.]+)\.umd/)[1]);
  });
  it.each([
    ['<img src=x onerror=alert(1)>', 'onerror'],
    ['<script>alert(1)</script>texte', '<script'],
    ['<a href="javascript:alert(1)">x</a>', 'javascript:'],
    ['<svg><script>alert(1)</script></svg>', '<script'],
    ['<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;">', 'onerror=alert(1)>'],
    ['<iframe src="https://evil.example"></iframe>', '<iframe']
  ])('neutralise %s', (payload, forbidden) => {
    expect(DOMPurify.sanitize(payload)).not.toContain(forbidden);
  });
  it('conserve la mise en forme légitime d\'un chapitre', () => {
    const html = '<p>Un <strong>mot</strong> et <em>un autre</em><br>ligne</p><h3>Titre</h3>';
    expect(DOMPurify.sanitize(html)).toBe(html);
  });
});

// ── callClaude côté client ───────────────────────────────
describe('callClaude — clé de synchronisation requise (AUD-01-004)', () => {
  function makeCtx(syncKey) {
    const ctx = vm.createContext({ console, TextDecoder, setTimeout, clearTimeout, Promise });
    ctx.AbortController = AbortController;
    ctx.getSyncKey = () => syncKey;
    ctx.fetch = vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"salut"}}]}\n\ndata: [DONE]\n\n', { status: 200 }));
    const rt = read('js/router.js');
    vm.runInContext(rt.slice(rt.indexOf('const DEFAULT_FETCH_TIMEOUT_MS'), rt.indexOf('function getSyncKey()')) + '\nthis.fetchWithTimeout = fetchWithTimeout;', ctx, { filename: 'fetchWithTimeout' });
    vm.runInContext(read('js/ai.js') + '\nthis.__callClaude = callClaude;', ctx, { filename: 'ai.js' });
    return ctx;
  }
  it('sans clé : erreur explicite, aucun appel réseau', async () => {
    const ctx = makeCtx('');
    await expect(ctx.__callClaude('x')).rejects.toThrow(/clé de synchronisation/i);
    expect(ctx.fetch).not.toHaveBeenCalled();
  });
  it('avec clé : envoie Authorization: Bearer et renvoie le texte', async () => {
    const ctx = makeCtx('ma-cle');
    expect(await ctx.__callClaude('x')).toBe('salut');
    expect(ctx.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer ma-cle');
  });
});

describe('Notice de confidentialité (AUD-01-012)', () => {
  it('ne cite plus Mistral et nomme Google', () => {
    const src = read('js/profiles.js');
    const start = src.indexOf('function showAiPrivacyNotice'); const notice = src.slice(src.indexOf('showInfoModal(', start), src.indexOf('async function notifyThirdPartyDataUseOnce', start));
    expect(notice).not.toMatch(/Mistral/);
    expect(notice).toMatch(/Google/);
    expect(src).toMatch(/seenThirdPartyNoticeV2/);
  });
});
