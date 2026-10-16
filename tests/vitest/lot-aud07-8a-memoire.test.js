// ═══════════════════════════════════════════════════════
// AUD-07 LOT 8 (v9.77.0) — MÉMOIRE DU ROMAN GRAPHIQUE (AUD-07-013)
//  • cache d'URL d'images borné en octets (LRU) ;
//  • exports PDF et ZIP en parties, canvas libérés.
// Code réel de images.js et de graphicnovel.js (parties pures).
// ═══════════════════════════════════════════════════════
import { describe, it, expect, vi } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');

describe('013 — cache d\'URL d\'images borné (images.js)', () => {
  function charger() {
    const revoque = [];
    const ctx = vm.createContext({ console, Map, Promise, URL: { revokeObjectURL: u => revoque.push(u), createObjectURL: () => 'blob:x' } });
    vm.runInContext(read('images.js'), ctx, { filename: 'images.js' });
    return { ctx, revoque, put: (id, taille) => vm.runInContext(`_plumeImageCachePut(${JSON.stringify(id)}, 'blob:' + ${JSON.stringify(id)}, ${taille})`, ctx),
      cles: () => vm.runInContext('Array.from(_plumeImageUrlCache.keys())', ctx), octets: () => vm.runInContext('_plumeImageCacheBytes', ctx),
      plafond: vm.runInContext('PLUME_IMAGE_CACHE_MAX_BYTES', ctx) };
  }
  const Mo = 1024 * 1024;
  it('le plafond est de 80 Mo', () => { expect(charger().plafond).toBe(80 * Mo); });
  it('libère les images les moins récemment utilisées au-delà du plafond, en révoquant leur URL', () => {
    const c = charger();
    for (let i = 1; i <= 10; i++) c.put('i' + i, 10 * Mo); // 100 Mo au total
    expect(c.octets()).toBeLessThanOrEqual(c.plafond);
    expect(c.cles()).toEqual(['i3', 'i4', 'i5', 'i6', 'i7', 'i8', 'i9', 'i10']);
    expect(c.revoque).toEqual(['blob:i1', 'blob:i2']);
  });
  it('une image relue devient la plus récente (elle est libérée en dernier)', async () => {
    const c = charger();
    for (let i = 1; i <= 8; i++) c.put('i' + i, 10 * Mo); // 80 Mo : plein
    expect(await c.ctx.graphicImageUrl('i1')).toBe('blob:i1'); // i1 relue : passe en queue
    c.put('i9', 10 * Mo);
    expect(c.cles()).not.toContain('i2'); // c'est i2 qui part, pas i1
    expect(c.cles()).toContain('i1');
    expect(c.revoque).toEqual(['blob:i2']);
  });
  it('une image seule plus grosse que le plafond est quand même gardée', () => {
    const c = charger();
    c.put('enorme', 200 * Mo);
    expect(c.cles()).toEqual(['enorme']);
  });
  it('remplacer une image ne compte pas deux fois ses octets, et forgetImageUrl libère', () => {
    const c = charger();
    c.put('a', 5 * Mo); c.put('a', 7 * Mo);
    expect(c.octets()).toBe(7 * Mo);
    vm.runInContext("forgetImageUrl('a')", c.ctx);
    expect(c.octets()).toBe(0);
    expect(c.cles()).toEqual([]);
    expect(c.revoque).toEqual(['blob:a', 'blob:a']);
  });
});

describe('013 — exports en parties (graphicnovel.js)', () => {
  const src = read('graphicnovel.js');
  const bloc = src.slice(src.indexOf('const GN_PDF_PART_BUDGET_BYTES'), src.indexOf('function gnFreeCanvas'));
  const ctx = vm.createContext({ Math });
  vm.runInContext(bloc + '\nfunction gnFreeCanvas(c) { if (c) { c.width = 0; c.height = 0; } }', ctx);
  const mmPx = (mm, dpi) => Math.round(mm / 25.4 * dpi);

  it('300 dpi, 20 × 25 cm + 3 mm de fond perdu : une trentaine de pages par PDF', () => {
    const w = mmPx(200, 300) + mmPx(3, 300) * 2, h = mmPx(250, 300) + mmPx(3, 300) * 2;
    const n = ctx.gnPdfPagesPerPart(w, h);
    expect(n).toBeGreaterThanOrEqual(25);
    expect(n).toBeLessThanOrEqual(40);
  });
  it('une résolution plus faible permet plus de pages par fichier ; bornes 5 et 200', () => {
    const n300 = ctx.gnPdfPagesPerPart(2433, 3024), n150 = ctx.gnPdfPagesPerPart(1217, 1512);
    expect(n150).toBeGreaterThan(n300 * 3);
    expect(ctx.gnPdfPagesPerPart(100000, 100000)).toBe(5);
    expect(ctx.gnPdfPagesPerPart(10, 10)).toBe(200);
  });
  it('un album court reste un seul fichier ; un long est découpé et nommé', () => {
    const par = ctx.gnPdfPagesPerPart(2433, 3024);
    expect(Math.ceil(20 / par)).toBe(1);
    expect(Math.ceil(100 / par)).toBeGreaterThan(1);
    expect(ctx.gnPartSuffix(1, 1)).toBe('');
    expect(ctx.gnPartSuffix(2, 4)).toBe('-partie-2-sur-4');
  });
  it('gnFreeCanvas ramène la taille d\'un canvas à zéro (et ignore null)', () => {
    const c = { width: 2433, height: 3024 };
    ctx.gnFreeCanvas(c);
    expect(c).toEqual({ width: 0, height: 0 });
    expect(() => ctx.gnFreeCanvas(null)).not.toThrow();
  });
  it('le PDF enregistre chaque partie pleine puis la libère ; les canvas de page sont libérés', () => {
    expect(src).toMatch(/if \(inPart === perPart\) \{ savePart\(\); part\+\+; pdf = newPdf\(\); inPart = 0; \}/);
    expect(src).toMatch(/gnFreeCanvas\(trimCanvas\); gnFreeCanvas\(bleedCanvas\)/);
    expect(src).toMatch(/pdf\.save\(baseName \+ gnPartSuffix\(part, parts\) \+ '\.pdf'\)/);
    expect(src).toMatch(/gnFreeCanvas\(canvas\); \/\/ v9\.77\.0/);
  });
  it('le ZIP est découpé en archives de 40 pages au plus, la dernière enregistrée à la fin', () => {
    expect(src).toMatch(/GN_ZIP_PAGES_PER_PART = 40/);
    expect(src).toMatch(/if \(inPart === GN_ZIP_PAGES_PER_PART\) \{ await savePart\(\); part\+\+; zip = new JSZip\(\); inPart = 0; \}/);
    expect(src).toMatch(/gnExportFilename\(\) \+ '-images' \+ gnPartSuffix\(part, parts\) \+ '\.zip'/);
  });
  it('une annulation après des parties enregistrées le dit', () => {
    expect(src).toMatch(/déjà enregistré/);
  });
});
