// ═══════════════════════════════════════════════════════
// AUD-06 LOT 2 (v9.64.0) — DURCISSEMENT DES WORKERS, DES EN-TÊTES ET DU DÉPÔT PUBLIÉ
//   009 jeton IA dérivé, clé aléatoire · 010 CORS, corps en flux, erreurs génériques · 011 chemins 404
//   022 rapports de CSP, CORP · 023 version minimale du client (426)
// Les Workers testés sont les VRAIS fichiers du dépôt (D1 réelle sur SQLite pour la synchro).
// ═══════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeD1 } from './fake-d1.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const loadWorker = f => new Function(read(f).replace('export default', 'return'))();
const KEY = 'cle-de-synchro-de-test';
const APP = 'https://plume-epique.pages.dev';

describe('Worker de synchro — CORS, version minimale, corps, rapports CSP', () => {
  const worker = loadWorker('worker/sync-worker.js');
  let n = 0;
  const call = (key, { method = 'GET', body, headers = {}, env = {} } = {}) => worker.fetch(new Request('https://s.test/?key=' + key, {
    method, body, headers: { Authorization: 'Bearer ' + KEY, 'X-Plume-Base-Version': '0', 'CF-Connecting-IP': '10.0.0.' + (++n % 250), ...headers }
  }), { SYNC_KEY: KEY, DB: new FakeD1(), ...env });

  it('l\'origine de l\'application est autorisée (et renvoyée telle quelle) ; jamais « * »', async () => {
    const r = await call('__ping__', { headers: { Origin: APP } });
    expect(r.status).toBe(200);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(APP);
    expect(r.headers.get('Vary')).toContain('Origin');
  });
  it('une origine étrangère est refusée (403), sans en-tête CORS', async () => {
    const r = await call('__ping__', { headers: { Origin: 'https://evil.example' } });
    expect(r.status).toBe(403);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const pre = await call('profiles', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
  it('appel hors navigateur (sans Origin) : l\'authentification fait foi, pas de CORS', async () => {
    const r = await call('__ping__');
    expect(r.status).toBe(200);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
  it('la pré-requête annonce l\'en-tête de version du client', async () => {
    const r = await call('profiles', { method: 'OPTIONS', headers: { Origin: APP } });
    expect(r.headers.get('Access-Control-Allow-Headers')).toContain('X-Plume-Client-Version');
  });
  it('CORS_EXTRA « http://localhost:* » (tests locaux) autorise un port local, rien d\'autre', async () => {
    const env = { CORS_EXTRA: 'http://localhost:*' };
    expect((await call('__ping__', { headers: { Origin: 'http://localhost:18101' }, env })).status).toBe(200);
    expect((await call('__ping__', { headers: { Origin: 'http://localhost.evil.example' }, env })).status).toBe(403);
    expect((await call('__ping__', { headers: { Origin: 'http://localhost:18101' } })).status).toBe(403); // sans la variable
  });

  it('version minimale : client trop ancien → 426 ; égal, plus récent ou en-tête absent → accepté', async () => {
    const env = { MIN_CLIENT_VERSION: '9.64.0' };
    const vieux = await call('__ping__', { headers: { 'X-Plume-Client-Version': '9.63.3' }, env });
    expect(vieux.status).toBe(426);
    expect((await vieux.json()).minVersion).toBe('9.64.0');
    expect((await call('__ping__', { headers: { 'X-Plume-Client-Version': '9.64.0' }, env })).status).toBe(200);
    expect((await call('__ping__', { headers: { 'X-Plume-Client-Version': '10.0.0' }, env })).status).toBe(200);
    expect((await call('__ping__', { env })).status).toBe(200);
    expect((await call('__ping__', { headers: { 'X-Plume-Client-Version': '9.9.0' }, env: { MIN_CLIENT_VERSION: '9.10.0' } })).status).toBe(426); // comparaison numérique, pas alphabétique
  });
  it('sans clé valide, la version n\'est jamais révélée (401 d\'abord)', async () => {
    const r = await call('__ping__', { headers: { Authorization: 'Bearer faux', 'X-Plume-Client-Version': '1.0.0' }, env: { MIN_CLIENT_VERSION: '9.64.0' } });
    expect(r.status).toBe(401);
  });

  it('corps trop gros : 413 même sans Content-Length (lecture en flux)', async () => {
    const r = await call('doc_p1_m1', { method: 'PUT', body: 'x'.repeat(21 * 1024 * 1024) });
    expect(r.status).toBe(413);
  });
  it('corps normal : toujours accepté', async () => {
    const r = await call('doc_p1_m1', { method: 'PUT', body: '{"a":1}' });
    expect(r.status).toBe(200);
  });

  describe('/csp-report', () => {
    let spy;
    beforeEach(() => { spy = vi.spyOn(console, 'log').mockImplementation(() => {}); });
    afterEach(() => spy.mockRestore());
    const report = (ip, body) => worker.fetch(new Request('https://s.test/csp-report', {
      method: 'POST', body, headers: { Origin: APP, 'Content-Type': 'application/csp-report', 'CF-Connecting-IP': ip }
    }), { SYNC_KEY: KEY, DB: new FakeD1() });
    const cspLines = () => spy.mock.calls.map(c => c[0]).filter(l => typeof l === 'string' && l.includes('"evt":"csp"')).map(l => JSON.parse(l));

    it('accepte un rapport sans clé (204) et journalise directive + origines, sans chemin ni paramètres', async () => {
      const r = await report('20.0.0.1', JSON.stringify({ 'csp-report': { 'violated-directive': 'script-src-elem', 'blocked-uri': 'https://evil.example/x.js?token=SECRET', 'document-uri': APP + '/index.html?a=b' } }));
      expect(r.status).toBe(204);
      const l = cspLines();
      expect(l).toHaveLength(1);
      expect(l[0]).toMatchObject({ dir: 'script-src-elem', blocked: 'https://evil.example', page: APP });
      expect(JSON.stringify(l)).not.toContain('SECRET');
    });
    it('rapport illisible : 204 sans journal ni erreur', async () => {
      expect((await report('20.0.0.2', 'pas du json')).status).toBe(204);
      expect(cspLines()).toHaveLength(0);
    });
    it('plafond : au plus 30 rapports par minute et par adresse', async () => {
      for (let i = 0; i < 40; i++) await report('20.0.0.3', JSON.stringify({ 'csp-report': { 'violated-directive': 'img-src' } }));
      expect(cspLines()).toHaveLength(30);
    });
  });
});

describe('Worker IA — jeton dérivé et erreurs génériques (AUD-06-009 / 010)', () => {
  const worker = loadWorker('worker/worker.js');
  const jeton = crypto.createHash('sha256').update('plume-ai|' + KEY).digest('hex');
  let upstream;
  beforeEach(() => {
    upstream = { status: 200, body: 'data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n' };
    globalThis.fetch = vi.fn(async () => new Response(upstream.body, { status: upstream.status }));
  });
  const call = (auth, env) => worker.fetch(new Request('https://ai.test/', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth, Origin: APP }, body: JSON.stringify({ prompt: 'x' })
  }), { GEMINI_API_KEY: 'g', ...env });

  it('accepte le jeton dérivé quand seul AI_TOKEN est configuré (le relais ne connaît plus la clé de synchro)', async () => {
    expect((await call(jeton, { AI_TOKEN: jeton })).status).toBe(200);
    expect((await call(KEY, { AI_TOKEN: jeton })).status).toBe(401); // la clé brute n'ouvre plus rien
    expect((await call('autre', { AI_TOKEN: jeton })).status).toBe(401);
  });
  it('transition : l\'ancien format (clé brute) reste accepté tant que le secret SYNC_KEY existe encore', async () => {
    expect((await call(KEY, { AI_TOKEN: jeton, SYNC_KEY: KEY })).status).toBe(200);
    expect((await call(jeton, { AI_TOKEN: jeton, SYNC_KEY: KEY })).status).toBe(200);
  });
  it('aucun secret configuré : tout est refusé (fermé par défaut)', async () => {
    expect((await call(jeton, {})).status).toBe(401);
  });
  it('erreur du fournisseur : le détail amont n\'est PAS renvoyé, 429 distingué', async () => {
    upstream = { status: 403, body: JSON.stringify({ error: { message: 'API key not valid: projects/12345/secret-detail', status: 'PERMISSION_DENIED' } }) };
    const r = await call(jeton, { AI_TOKEN: jeton });
    expect(r.status).toBe(403);
    const txt = await r.text();
    expect(txt).not.toMatch(/projects\/12345|API key|PERMISSION_DENIED/);
    expect(txt).toContain('403');
    upstream = { status: 429, body: '{}' };
    expect((await (await call(jeton, { AI_TOKEN: jeton })).json()).error.message).toMatch(/saturé|quota/i);
  });
  it('exception interne : message générique, jamais le texte de l\'exception', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('connexion à 10.1.2.3 refusée'); });
    const r = await call(jeton, { AI_TOKEN: jeton });
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain('10.1.2.3');
  });
});

describe('Scripts d\'exploitation', () => {
  it('generer-cle : 26 caractères, alphabet sans ambiguïté, différente à chaque appel', () => {
    const { genererCle } = require('../../scripts/generer-cle.cjs');
    const a = genererCle(), b = genererCle();
    expect(a).toMatch(/^[A-HJ-NP-Z2-9]{26}$/);
    expect(a).not.toBe(b);
  });
  it('installer-jeton-ia : même jeton que le navigateur (js/ai.js) et le Worker', () => {
    const { jetonIA } = require('../../scripts/installer-jeton-ia.cjs');
    expect(jetonIA(KEY)).toBe(crypto.createHash('sha256').update('plume-ai|' + KEY).digest('hex'));
    expect(read('js/ai.js')).toContain("'plume-ai|' + syncKey");
  });
});

describe('Dépôt publié et en-têtes (AUD-06-011 / 022)', () => {
  const routes = JSON.parse(read('_routes.json'));
  it('_routes.json : n\'envoie à la fonction 404 que les chemins non publics, jamais ceux de l\'application', () => {
    expect(routes.version).toBe(1);
    expect(routes.include.length).toBeLessThanOrEqual(100);
    for (const p of ['/docs/*', '/worker/*', '/tests/*', '/scripts/*', '/CLAUDE.md', '/README.md', '/package.json', '/functions/*']) expect(routes.include).toContain(p);
    const appli = ['/index.html', '/sw.js', '/manifest.json', '/css/style.css', '/js/router.js', '/vendor/dompurify-3.4.16.min.js', '/icons/plume.svg', '/_headers'];
    for (const chemin of appli) {
      const touche = routes.include.some(r => r === chemin || (r.endsWith('/*') && chemin.startsWith(r.slice(0, -1))));
      expect(touche, chemin).toBe(false);
    }
  });
  it('la fonction répond 404 sans cache', async () => {
    const src = read('functions/_middleware.js').replace('export function', 'function') + '\nreturn onRequest();';
    const r = new Function(src)();
    expect(r.status).toBe(404);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
  });
  it('_headers : rapports de CSP vers le Worker de synchro, CORP same-origin, CSP toujours stricte', () => {
    const h = read('_headers');
    const csp = h.match(/Content-Security-Policy:\s*(.+)/)[1];
    expect(csp).toContain('report-uri https://plume-epique-sync.air7841.workers.dev/csp-report');
    expect(csp).toContain('report-to csp');
    expect(h).toMatch(/Reporting-Endpoints: csp="https:\/\/plume-epique-sync\.air7841\.workers\.dev\/csp-report"/);
    expect(h).toContain('Cross-Origin-Resource-Policy: same-origin');
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
  });
  it('la page n\'envoie plus de rapport de CSP depuis un test local (serveur de test)', () => {
    const dev = read('scripts/dev-server.cjs');
    expect(dev).toMatch(/report-uri/);
    expect(dev).toMatch(/report-to/);
  });
});
