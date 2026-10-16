// ═══════════════════════════════════════════════════════
// AUD-07 LOT 9 (v9.79.0) — BUDGETS DE PERFORMANCE EN CI (AUD-07-019) ET PLAFOND TOTAL DE L'HISTORIQUE (AUD-07-001)
// Ces tests échouent quand une dérive lente dépasse un budget : poids du premier chargement, taille d'un manuscrit avec
// historique, requêtes D1 par écriture, durée de la chaîne de sauvegarde. Relever un budget est une décision à prendre
// EN CONNAISSANCE DE CAUSE : modifier la valeur ici ET le tableau « Budgets de performance » de docs/DECISIONS.md.
// ═══════════════════════════════════════════════════════
import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeD1 } from './fake-d1.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ───────────── BUDGET 1 : premier chargement ─────────────
describe('019 — budget du chargement initial (index.html, CSS, scripts)', () => {
  const html = read('index.html');
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]);
  const fichiers = ['index.html', 'css/style.css', ...scripts];
  const tailles = fichiers.map(f => {
    const b = fs.readFileSync(path.join(ROOT, f));
    return { f, dec: b.length, br: zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length };
  });
  const somme = k => tailles.reduce((s, t) => s + t[k], 0);
  // Mesuré le 16/10/2026 (v9.78.0) : 34 fichiers, 1 148 Ko décodés, 294 Ko Brotli ; JS seul 869 Ko / 238 Ko.
  it('au plus 1 330 Ko décodés et 340 Ko en Brotli pour tout ce qui charge au démarrage', () => {
    expect(somme('dec') / 1024, 'décodé (Ko)').toBeLessThanOrEqual(1330);
    expect(somme('br') / 1024, 'Brotli (Ko)').toBeLessThanOrEqual(340);
  });
  it('au plus 1 000 Ko de JavaScript décodé et 40 fichiers au démarrage', () => {
    const js = tailles.filter(t => t.f.endsWith('.js')).reduce((s, t) => s + t.dec, 0);
    expect(js / 1024, 'JS décodé (Ko)').toBeLessThanOrEqual(1000);
    expect(fichiers.length).toBeLessThanOrEqual(40);
  });
  it('aucune librairie lourde (> 100 Ko) dans le chargement initial : elles passent par ensureLib', () => {
    const lourdes = tailles.filter(t => t.f.startsWith('vendor/') && t.dec > 100 * 1024).map(t => t.f);
    expect(lourdes).toEqual([]);
  });
});

// ───────────── BUDGET 2 : manuscrit avec historique ─────────────
describe('001/019 — plafond total de l\'historique et taille d\'un manuscrit', () => {
  const ctx = vm.createContext({ console, Date, Math, JSON, WeakMap, Map, Set });
  vm.runInContext(read('js/schema.js'), ctx);
  const MIN = 60000, H = 3600000, D = 86400000;
  const AGES = [0, 1, 2, 3].map(i => (i * 15 + 1) * MIN).concat([0, 1, 2, 3, 4, 5, 6].map(i => (i + 1) * 3 * H + MIN), [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => (i + 1) * 2 * D + H)); // 20 tranches distinctes
  const mots = ['le', 'la', 'chat', 'maison', 'lumière', 'nuit', 'voyage', 'cœur'];
  const chap = w => '<p>' + Array.from({ length: w }, (_, i) => mots[i % 8]).join(' ') + '.</p>';
  function roman(nChap, motsParChap, label) {
    const now = Date.now();
    const chapters = Array.from({ length: nChap }, (_, i) => ({ id: 'c' + i, title: 'C' + i, content: chap(motsParChap) }));
    const history = {};
    for (const c of chapters) history[c.id] = ctx.thinSnapshots(AGES.map(a => ({ ts: now - a, label: label || 'auto', content: c.content, title: c.title })), now, 20);
    return { title: 'T', chapters, history };
  }
  const clair = db => JSON.stringify(db).length;

  it('sans plafond total, 150 000 mots avec 20 copies par chapitre dépasseraient la limite d\'envoi (le budget est donc réel)', () => {
    const db = roman(60, 2500);
    expect(clair(db) * 1.4 / 1048576).toBeGreaterThan(20); // ≈ 22,6 Mo chiffrés : refus 413
  });
  it('avec le plafond total : texte + historique ≤ 9,5 Mo en clair et ≤ 15 Mo chiffrés (limite du serveur : 20 Mio)', () => {
    const db = roman(60, 2500);
    expect(ctx.trimHistoryTotal(db.history)).toBe(true);
    expect(clair(db) / 1e6, 'clair (Mo)').toBeLessThanOrEqual(9.5);
    expect(clair(db) * 1.4 / 1048576, 'chiffré (Mio)').toBeLessThanOrEqual(15);
  });
  it('un roman de 400 000 mots avec ses 20 copies par chapitre reste lui aussi sous la limite', () => {
    const db = roman(150, 2700);
    ctx.trimHistoryTotal(db.history);
    expect(clair(db) * 1.4 / 1048576).toBeLessThanOrEqual(20);
  });
  it('retire les plus anciennes copies d\'abord (tous chapitres confondus), garde la plus récente de chaque chapitre', () => {
    const db = roman(60, 2500);
    ctx.trimHistoryTotal(db.history);
    for (const c of db.chapters) {
      const l = db.history[c.id];
      expect(l.length, c.id).toBeGreaterThanOrEqual(1);
      expect(l[0].ts, 'la copie la plus récente est conservée').toBeGreaterThan(Date.now() - 20 * MIN);
    }
    const total = Object.values(db.history).flat().reduce((s, x) => s + x.content.length, 0);
    expect(total).toBeLessThanOrEqual(8 * 1000 * 1000);
    // les copies conservées sont les plus récentes : la plus ancienne conservée est plus récente que la plus ancienne possible
    const plusAncienne = Math.min(...Object.values(db.history).flat().map(x => x.ts));
    expect(plusAncienne).toBeGreaterThan(Date.now() - 18 * D);
  });
  it('ne touche jamais aux copies manuelles, même au-dessus du plafond', () => {
    const db = roman(60, 2500);
    const now = Date.now();
    for (const c of db.chapters.slice(0, 10)) db.history[c.id].push({ ts: now - 20 * D, label: 'Manuel — avant réécriture', content: c.content, title: c.title });
    ctx.trimHistoryTotal(db.history);
    const manuelles = Object.values(db.history).flat().filter(x => /^Manuel/.test(x.label));
    expect(manuelles).toHaveLength(10);
  });
  it('un historique léger n\'est pas modifié ; l\'opération est idempotente ; entrées invalides ignorées', () => {
    const leger = roman(5, 2500);
    const avant = JSON.stringify(leger.history);
    expect(ctx.trimHistoryTotal(leger.history)).toBe(false);
    expect(JSON.stringify(leger.history)).toBe(avant);
    const lourd = roman(60, 2500);
    ctx.trimHistoryTotal(lourd.history);
    const apres = JSON.stringify(lourd.history);
    expect(ctx.trimHistoryTotal(lourd.history)).toBe(false);
    expect(JSON.stringify(lourd.history)).toBe(apres);
    expect(ctx.trimHistoryTotal(null)).toBe(false);
    expect(ctx.trimHistoryTotal({ a: 'pas un tableau', b: [null] })).toBe(false);
  });
  it('thinAllHistory (ouverture d\'un manuscrit déjà alourdi) applique le plafond et demande une sauvegarde', () => {
    const c2 = vm.createContext({ console, Date, Math, JSON, WeakMap, Map, Set, db: roman(60, 2500), HISTORY_MAX_AUTO: 20 });
    vm.runInContext(read('js/schema.js'), c2);
    vm.runInContext(read('js/snapshots.js').replace(/setInterval\([\s\S]*?\}, 5 \* 60 \* 1000\);/, ''), c2, { filename: 'snapshots.js' });
    expect(vm.runInContext('thinAllHistory()', c2)).toBe(true);
    const total = vm.runInContext('Object.values(db.history).flat().reduce((s, x) => s + x.content.length, 0)', c2);
    expect(total).toBeLessThanOrEqual(8 * 1000 * 1000);
  });
  it('le plafond est appliqué à chaque nouvelle copie (texte et roman graphique) et à l\'ouverture', () => {
    expect(read('js/snapshots.js')).toMatch(/trimHistoryTotal\(db\.history\)/g);
    expect((read('js/snapshots.js').match(/trimHistoryTotal\(db\.history\)/g) || []).length).toBe(2);
    expect(read('js/graphicnovel.js')).toMatch(/trimHistoryTotal\(db\.history\)/);
  });
});

// ───────────── BUDGET 3 : chaîne de sauvegarde ─────────────
describe('019 — durée de la chaîne de sauvegarde (sérialisation + chiffrement + empreintes)', () => {
  function chargerRouter() {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
    const w = dom.window;
    vm.createContext(w);
    Object.defineProperty(w, 'crypto', { value: globalThis.crypto, configurable: true });
    w.Request = globalThis.Request; w.Response = globalThis.Response; w.fetch = async () => new Response('{}');
    w.toast = vi.fn(); w.DOMPurify = { sanitize: x => x };
    for (const f of ['schema.js', 'crypto.js', 'router.js']) vm.runInContext(read('js/' + f), w, { filename: f });
    w.onload = null;
    return w;
  }
  it('150 000 mots (≈ 0,8 Mo, 60 chapitres) : moins de 400 ms (mesuré : 10 à 25 ms ; seuil large contre les faux échecs)', async () => {
    const w = chargerRouter();
    vm.runInContext("_dataKey = 'cle-de-donnees-de-test';", w);
    const mots = ['le', 'la', 'chat', 'maison', 'lumière', 'nuit', 'voyage', 'cœur'];
    const chap = n => '<p>' + Array.from({ length: n }, (_, i) => mots[i % 8]).join(' ') + '.</p>';
    const db = { title: 'T', chapters: Array.from({ length: 60 }, (_, i) => ({ id: 'c' + i, title: 'C' + i, content: chap(2500) })), history: {} };
    await w.makeEncryptedEnvelope(JSON.stringify(db)); // échauffement
    const t0 = performance.now();
    const env = await w.makeEncryptedEnvelope(JSON.stringify(db));
    const ms = performance.now() - t0;
    expect(env._enc).toBe(true);
    expect(ms, 'durée (ms)').toBeLessThan(400);
  });
  it('la somme des mots d\'un gros manuscrit déjà compté coûte moins de 5 ms (cache par chapitre)', () => {
    const c = vm.createContext({ console, Date, Math, JSON, WeakMap });
    vm.runInContext(read('js/schema.js'), c);
    const chapters = Array.from({ length: 150 }, (_, i) => ({ id: 'c' + i, content: '<p>' + 'mot '.repeat(2700) + '</p>' }));
    c.chaptersTotalWords(chapters);
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) c.chaptersTotalWords(chapters);
    expect((performance.now() - t0) / 50, 'ms par somme').toBeLessThan(5);
  });
});

// ───────────── BUDGET 4 : requêtes D1 par écriture ─────────────
describe('019 — requêtes D1 par écriture : peu nombreuses et indépendantes du volume stocké', () => {
  function serveur(d1) {
    const env = { SYNC_KEY: 'cle-budget', DB: d1 };
    const worker = new Function(read('worker/sync-worker.js').replace('export default', 'return'))();
    let n = 0;
    return (key, body, base) => worker.fetch(new Request('https://s.test/?key=' + key, {
      method: 'PUT', body, headers: { Authorization: 'Bearer cle-budget', 'CF-Connecting-IP': '10.9.9.' + (++n % 250), 'X-Plume-Base-Version': String(base) }
    }), env);
  }
  async function requetesPourUneEcriture(fillers) {
    const d1 = new FakeD1();
    const put = serveur(d1);
    await put('doc_bb_m0', '"x"', 0); // initialise la migration et les compteurs
    if (fillers) {
      const ins = d1.db.prepare("INSERT INTO sync_meta (k, version, wid, chunks, updated_at, bytes) VALUES (?, 1, ?, 1, 0, 1000)");
      const chk = d1.db.prepare("INSERT INTO sync_chunks (k, wid, idx, data) VALUES (?, ?, 0, ?)");
      for (let i = 0; i < fillers; i++) { ins.run('doc_zz_' + i, 'w' + i); chk.run('doc_zz_' + i, 'w' + i, 'x'.repeat(1000)); }
      d1.db.exec("UPDATE sync_totals SET bytes = bytes + " + (fillers * 1000) + ", keys = keys + " + fillers + " WHERE scope = 'global'");
    }
    const vus = [];
    const prepare = d1.prepare.bind(d1);
    d1.prepare = sql => { vus.push(sql); return prepare(sql); };
    const r = await put('doc_bb_m1', '"nouveau manuscrit"', 0);
    expect(r.status).toBe(200);
    return vus;
  }
  it('au plus 12 requêtes pour une écriture, dont aucune ne balaie les morceaux', async () => {
    const vus = await requetesPourUneEcriture(0);
    expect(vus.length).toBeLessThanOrEqual(12);
    expect(vus.filter(q => /SUM\(LENGTH\(/.test(q))).toHaveLength(0);
  });
  it('le nombre de requêtes ne dépend pas du volume déjà stocké (0 ou 1 500 clés)', async () => {
    const vide = await requetesPourUneEcriture(0);
    const plein = await requetesPourUneEcriture(1500);
    expect(plein.length).toBe(vide.length);
  });
});
