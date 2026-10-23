// ═══════════════════════════════════════════════════════
// AUD-07 LOT 7 (v9.76.0) — CHARGEMENT ET CACHE (AUD-07-004, 005, 006)
//  • six librairies chargées à la demande (ensureLib) ;
//  • vendor/ servi depuis le cache sans revalidation, en-tête immuable ;
//  • précache du service worker tolérant, état « hors ligne » et nouvelle tentative.
// Code réel de schema.js, sw.js, pwa.js.
// ═══════════════════════════════════════════════════════
import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ───────────── 004 : ensureLib ─────────────
function pageAvecLoader() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { url: 'http://localhost/' });
  const w = dom.window;
  vm.createContext(w);
  vm.runInContext(read('js/schema.js'), w, { filename: 'schema.js' });
  const scripts = [];
  w.document.head.appendChild = el => { scripts.push(el); return el; }; // pas de vrai téléchargement : on pilote onload/onerror
  return { w, scripts };
}

describe('004 — ensureLib : chargement à la demande', () => {
  it('charge une seule fois pour des appels simultanés, et résout true quand la librairie est là', async () => {
    const { w, scripts } = pageAvecLoader();
    const p1 = w.ensureLib('jszip'), p2 = w.ensureLib('jszip');
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src.endsWith('/vendor/jszip-3.10.1.min.js')).toBe(true);
    w.JSZip = function () {}; scripts[0].onload();
    expect(await p1).toBe(true);
    expect(await p2).toBe(true);
    expect(await w.ensureLib('jszip')).toBe(true);
    expect(scripts).toHaveLength(1); // déjà prête : aucun nouveau chargement
  });
  it('résout true tout de suite si la librairie est déjà là (tests, ancien chargement)', async () => {
    const { w, scripts } = pageAvecLoader();
    w.Chart = function () {};
    expect(await w.ensureLib('chart')).toBe(true);
    expect(scripts).toHaveLength(0);
  });
  it('un échec de chargement résout false, puis un nouvel appel réessaie', async () => {
    const { w, scripts } = pageAvecLoader();
    const p = w.ensureLib('d3');
    scripts[0].onerror();
    expect(await p).toBe(false);
    const p2 = w.ensureLib('d3');
    expect(scripts).toHaveLength(2);
    w.d3 = {}; scripts[1].onload();
    expect(await p2).toBe(true);
  });
  it('un script chargé mais qui ne définit pas la librairie attendue est un échec', async () => {
    const { w, scripts } = pageAvecLoader();
    const p = w.ensureLib('mammoth');
    scripts[0].onload();
    expect(await p).toBe(false);
  });
  it('identifiant inconnu : false, sans rien charger', async () => {
    const { w, scripts } = pageAvecLoader();
    expect(await w.ensureLib('inconnue')).toBe(false);
    expect(scripts).toHaveLength(0);
  });
  it('jsPDF est reconnu prêt via window.jspdf.jsPDF', async () => {
    const { w } = pageAvecLoader();
    vm.runInContext('var jspdf = { jsPDF: function () {} };', w);
    expect(await w.ensureLib('jspdf')).toBe(true);
  });
});

describe('004 — cohérence des six librairies (VENDOR_LIBS, sw.js, package.json, index.html)', () => {
  const pageur = pageAvecLoader().w;
  const libs = vm.runInContext('VENDOR_LIBS', pageur);
  const pkg = JSON.parse(read('package.json')).dependencies;
  const sw = read('sw.js'), html = read('index.html');
  const noms = { d3: 'd3', chart: 'chart.js', jszip: 'jszip', jspdf: 'jspdf', html2canvas: 'html2canvas', mammoth: 'mammoth' };
  for (const id of Object.keys(noms)) {
    it(`${id} : fichier présent, précaché hors ligne, version = package.json, absent du chargement initial`, () => {
      const src = libs[id].src;
      expect(fs.existsSync(path.join(ROOT, src)), src).toBe(true);
      expect(sw).toContain("'./" + src + "'");
      const v = src.match(/-(\d+\.\d+\.\d+)/)[1];
      expect(pkg[noms[id]], id).toBe(v);
      expect(html).not.toContain('src="' + src + '"');
    });
  }
  it('le chargement initial garde l\'essentiel : DOMPurify, idb, file-saver', () => {
    for (const f of ['dompurify-3.4.17.min.js', 'idb-8.0.3.umd.js', 'file-saver-2.0.5.min.js']) expect(html).toContain('vendor/' + f);
  });
  it('chaque point d\'usage attend le chargement (exports, import DOCX, graphe, graphiques, PDF de récupération)', () => {
    const attendu = {
      'js/export-format-utils.js': ["ensureLib('jszip')", "ensureLib('jspdf')", "ensureLib('mammoth')"],
      'js/graphicnovel.js': ["ensureLib('html2canvas')", "ensureLib('jspdf')", "ensureLib('jszip')"],
      'js/profiles.js': ["ensureLib('jspdf')"],
      'js/relations.js': ["ensureLib('d3')"],
      'js/stats.js': ["ensureLib('chart')"],
      'js/readability.js': ["ensureLib('chart')"],
      'js/router.js': ["ensureLib('chart')"]
    };
    for (const [f, motifs] of Object.entries(attendu)) for (const m of motifs) expect(read(f), f + ' ' + m).toContain(m);
  });
  it('le refus d\'un fichier trop gros reste AVANT tout chargement de librairie', () => {
    const src = read('js/export-format-utils.js');
    expect(src.indexOf('IMPORT_MAX_DOC_BYTES) {')).toBeLessThan(src.indexOf("ensureLib('mammoth')"));
  });
});

// ───────────── 005 : en-têtes ─────────────
describe('005 — cache HTTP immuable pour vendor/', () => {
  const h = read('_headers');
  it('vendor/* est immuable un an ; le reste du site n\'est pas concerné', () => {
    expect(h).toMatch(/\/vendor\/\*\s*\n\s*Cache-Control: public, max-age=31536000, immutable/);
    expect(h.split('/vendor/*')[0]).not.toMatch(/Cache-Control/);
  });
  it('la CSP et les en-têtes de sécurité de /* sont intacts', () => {
    expect(h).toMatch(/^\/\*\s*\n\s*Content-Security-Policy:/);
    expect(h).toContain("script-src 'self'");
  });
});

// ───────────── 005 / 006 : service worker ─────────────
function chargerSw({ echecs = new Set() } = {}) {
  const magasins = new Map();
  const base = 'https://site.test/';
  const abs = u => new URL(typeof u === 'string' ? u : u.url, base + 'sw.js').href;
  const reseau = vi.fn(async u => {
    const url = abs(u);
    if (echecs.has(url) || [...echecs].some(e => url.endsWith(e))) throw new Error('réseau coupé');
    return new Response('contenu:' + url, { status: 200 });
  });
  const objetCache = nom => {
    if (!magasins.has(nom)) magasins.set(nom, new Map());
    const m = magasins.get(nom);
    return {
      add: async u => { const r = await reseau(u); if (!r.ok) throw new Error('HTTP ' + r.status); m.set(abs(u), r); },
      put: async (req, res) => { m.set(abs(req), res); },
      match: async req => { const r = m.get(abs(req)); return r ? r.clone() : undefined; },
      keys: async () => [...m.keys()]
    };
  };
  const caches = {
    open: async nom => objetCache(nom),
    match: async req => { for (const m of magasins.values()) { const r = m.get(abs(req)); if (r) return r.clone(); } return undefined; },
    keys: async () => [...magasins.keys()],
    delete: async nom => magasins.delete(nom)
  };
  const handlers = {};
  const self = { location: { href: base + 'sw.js', origin: 'https://site.test', toString() { return this.href; } }, addEventListener: (t, f) => { handlers[t] = f; }, clients: { claim: async () => {} }, skipWaiting: () => {} };
  const ctx = vm.createContext({ self, caches, fetch: reseau, Response, Request, URL, Promise, console, setTimeout, JSON, Date });
  vm.runInContext(read('sw.js'), ctx, { filename: 'sw.js' });
  const attendre = async f => { const ps = []; f({ waitUntil: p => ps.push(p) }); await Promise.all(ps); };
  return { ctx, handlers, reseau, magasins, abs, attendre, base };
}
const coreAssets = sw => vm.runInContext('CORE_ASSETS', sw.ctx);
const statut = async sw => { const r = await [...sw.magasins.values()][0].get(sw.abs('./precache-status.json')).clone().json(); return r; };

describe('006 — précache tolérant du service worker', () => {
  it('un fichier en échec n\'empêche plus les autres d\'être mis en cache ; la liste des manquants est mémorisée', async () => {
    const sw = chargerSw({ echecs: new Set(['/js/router.js']) });
    await sw.attendre(e => sw.handlers.install(e));
    const cache = [...sw.magasins.values()][0];
    const assets = coreAssets(sw);
    const manquants = assets.filter(u => !cache.has(sw.abs(u)));
    expect(manquants).toEqual(['./js/router.js']);
    expect(cache.size).toBeGreaterThan(assets.length - 2);
    const st = await statut(sw);
    expect(st.missing).toEqual(['./js/router.js']);
    expect(st.total).toBe(assets.length);
  });
  it('tout est en cache : liste des manquants vide', async () => {
    const sw = chargerSw();
    await sw.attendre(e => sw.handlers.install(e));
    expect((await statut(sw)).missing).toEqual([]);
  });
  it('RETRY_PRECACHE récupère les manquants quand le réseau revient', async () => {
    const echecs = new Set(['/js/router.js', '/css/style.css']);
    const sw = chargerSw({ echecs });
    await sw.attendre(e => sw.handlers.install(e));
    expect((await statut(sw)).missing).toHaveLength(2);
    echecs.delete('/js/router.js'); // un seul revient
    await sw.attendre(e => sw.handlers.message({ data: { type: 'RETRY_PRECACHE' }, waitUntil: e.waitUntil }));
    expect((await statut(sw)).missing).toEqual(['./css/style.css']);
    echecs.clear();
    await sw.attendre(e => sw.handlers.message({ data: { type: 'RETRY_PRECACHE' }, waitUntil: e.waitUntil }));
    expect((await statut(sw)).missing).toEqual([]);
    expect([...sw.magasins.values()][0].has(sw.abs('./css/style.css'))).toBe(true);
  });
  it('sans rien à réessayer, RETRY_PRECACHE ne fait aucune requête', async () => {
    const sw = chargerSw();
    await sw.attendre(e => sw.handlers.install(e));
    sw.reseau.mockClear();
    await sw.attendre(e => sw.handlers.message({ data: { type: 'RETRY_PRECACHE' }, waitUntil: e.waitUntil }));
    expect(sw.reseau).not.toHaveBeenCalled();
  });
});

describe('005 — vendor/ sans revalidation, le reste inchangé', () => {
  async function demander(sw, url) {
    let reponse; const fond = [];
    sw.handlers.fetch({ request: { method: 'GET', url: sw.base + url }, respondWith: p => { reponse = p; }, waitUntil: p => fond.push(p) });
    const r = await reponse; await Promise.all(fond);
    return r;
  }
  it('une librairie de vendor/ déjà en cache est servie SANS requête réseau', async () => {
    const sw = chargerSw();
    await sw.attendre(e => sw.handlers.install(e));
    sw.reseau.mockClear();
    const r = await demander(sw, 'vendor/d3-7.9.0.min.js');
    expect(await r.text()).toContain('vendor/d3-7.9.0.min.js');
    expect(sw.reseau).not.toHaveBeenCalled();
  });
  it('un fichier de l\'application en cache est servi puis revalidé en arrière-plan (comme avant)', async () => {
    const sw = chargerSw();
    await sw.attendre(e => sw.handlers.install(e));
    sw.reseau.mockClear();
    await demander(sw, 'js/router.js');
    expect(sw.reseau).toHaveBeenCalledTimes(1);
  });
  it('une librairie de vendor/ absente du cache est téléchargée puis mise en cache', async () => {
    const sw = chargerSw();
    await sw.attendre(e => sw.handlers.install(e));
    const r = await demander(sw, 'vendor/inconnue-1.0.0.js');
    expect(r.ok).toBe(true);
    expect([...sw.magasins.values()][0].has(sw.base + 'vendor/inconnue-1.0.0.js')).toBe(true);
  });
  it('les appels d\'API (autre origine) ne sont toujours jamais interceptés', async () => {
    const sw = chargerSw();
    let intercepte = false;
    sw.handlers.fetch({ request: { method: 'GET', url: 'https://plume-epique-sync.air7841.workers.dev/health' }, respondWith: () => { intercepte = true; }, waitUntil: () => {} });
    expect(intercepte).toBe(false);
  });
});

// ───────────── 006 : page (pwa.js) ─────────────
function chargerPwa({ statutCache, controleur }) {
  const el = { textContent: '' };
  const envoyes = [];
  const ctx = vm.createContext({
    navigator: { serviceWorker: { addEventListener() {}, register: () => new Promise(() => {}), controller: controleur === false ? null : { postMessage: m => envoyes.push(m) } } },
    caches: { match: async () => (statutCache ? new Response(JSON.stringify(statutCache)) : undefined) },
    document: { getElementById: id => (id === 'lib-offline-status' ? el : null), addEventListener() {} },
    window: { addEventListener() {} }, console, setTimeout, JSON, Response
  });
  vm.runInContext(read('js/pwa.js'), ctx, { filename: 'pwa.js' });
  return { el, envoyes, ctx };
}
describe('006 — état « hors ligne » dans Système (pwa.js)', () => {
  it('tout est en cache : « prêt »', async () => {
    const p = chargerPwa({ statutCache: { total: 56, missing: [] } });
    await p.ctx.renderOfflineStatus();
    expect(p.el.textContent).toBe('Hors ligne : prêt (56 fichiers en cache).');
  });
  it('fichiers manquants : « incomplet » avec leur nombre', async () => {
    const p = chargerPwa({ statutCache: { total: 56, missing: ['./a.js', './b.js'] } });
    await p.ctx.renderOfflineStatus();
    expect(p.el.textContent).toMatch(/incomplet — 2 fichiers manquants sur 56/);
    const un = chargerPwa({ statutCache: { total: 56, missing: ['./a.js'] } });
    await un.ctx.renderOfflineStatus();
    expect(un.el.textContent).toMatch(/1 fichier manquant sur 56/);
  });
  it('pas de service worker ni de statut : rien d\'affiché', async () => {
    const p = chargerPwa({ statutCache: null });
    await p.ctx.renderOfflineStatus();
    expect(p.el.textContent).toBe('');
  });
  it('demande une nouvelle tentative au service worker seulement s\'il manque des fichiers', async () => {
    const a = chargerPwa({ statutCache: { total: 56, missing: ['./a.js'] } });
    expect(await a.ctx.retryPrecacheIfNeeded()).toBe(true);
    expect(a.envoyes).toEqual([{ type: 'RETRY_PRECACHE' }]);
    const b = chargerPwa({ statutCache: { total: 56, missing: [] } });
    expect(await b.ctx.retryPrecacheIfNeeded()).toBe(false);
    const c = chargerPwa({ statutCache: { total: 56, missing: ['./a.js'] }, controleur: false });
    expect(await c.ctx.retryPrecacheIfNeeded()).toBe(false);
  });
  it('l\'état est affiché à l\'ouverture du panneau Système', () => {
    expect(read('js/library.js')).toMatch(/renderOfflineStatus\(\)/);
    expect(read('index.html')).toContain('id="lib-offline-status"');
  });
});
