// ═══════════════════════════════════════════════════════
// LOT 4 (v9.25.0) — ROMAN GRAPHIQUE ET HISTORIQUE (AUD-01-006 / 023)
//  • annuler + corbeille : jamais d'image détruite alors qu'elle est affichée ;
//  • compteur de références recalculé sur l'usage réel ;
//  • historique « espacé » (thinSnapshots) : un mois de recul, deux fois moins lourd ;
//  • roman graphique : avertissement de fermeture, pas de jeton dans le manuscrit.
// ═══════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as idb from 'idb';
import 'fake-indexeddb/auto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JS = f => fs.readFileSync(path.join(__dirname, '..', '..', 'js', f), 'utf8');
let dbCounter = 0;

function makeCtx() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
  const ctx = dom.window;
  vm.createContext(ctx);
  Object.defineProperty(ctx, 'crypto', { value: globalThis.crypto, configurable: true });
  ctx.indexedDB = globalThis.indexedDB; ctx.IDBKeyRange = globalThis.IDBKeyRange; ctx.idb = idb;
  ctx.toast = vi.fn();
  vm.runInContext(JS('schema.js'), ctx, { filename: 'schema.js' });
  vm.runInContext(JS('images.js').replace("'plume_epique_images'", `'plume_epique_images_lot4_${++dbCounter}'`), ctx, { filename: 'images.js' });
  vm.runInContext('let _unsavedChanges = false; let _currentProfileId = null, _dataKey = null, _currentDocumentId = null; var db = {}; var cur = 0;', ctx);
  vm.runInContext(JS('graphicnovel.js'), ctx, { filename: 'graphicnovel.js' });
  vm.runInContext(JS('snapshots.js'), ctx, { filename: 'snapshots.js' });
  ctx.renderGraphicNovelScreen = () => {}; // l'écran réel est hors sujet ici (redéfini par graphicnovel.js)
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);
async function putImage(ctx, id, refCount) {
  const database = await ctx.plumeImagesDb();
  await database.put('images', { id, docId: 'd1', blob: new Blob(['x' + id]), width: 10, height: 10, hash: 'h' + id, refCount, createdAt: 1 });
}
const imageExists = async (ctx, id) => !!(await (await ctx.plumeImagesDb()).get('images', id));
const settle = async () => { for (let i = 0; i < 15; i++) await new Promise(r => setTimeout(r, 0)); };

function docAvecImage(ctx) {
  run(ctx, `db = { docType: 'roman_graphique', trash: [], history: {}, pages: [ { id: 'p1', background: '#fff', elements: [
    { id: 'e1', type: 'image', imageId: 'IMG1', x: 0, y: 0, w: 50, h: 50 }, { id: 'e2', type: 'text', content: 'texte', x: 0, y: 60, w: 50, h: 10 } ] } ] }; _gnActivePage = 0;`);
}

describe('Annuler + corbeille : une image affichée n\'est jamais détruite (AUD-01-006)', () => {
  let ctx;
  beforeEach(async () => { ctx = makeCtx(); docAvecImage(ctx); await putImage(ctx, 'IMG1', 1); run(ctx, 'gnResetUndoStack();'); });

  it('supprimer puis annuler remet l\'élément ET vide la corbeille (même état)', () => {
    run(ctx, "gnDeleteElement('e1'); gnCommitUndoSnapshot();");
    expect(run(ctx, 'db.trash.length')).toBe(1);
    expect(run(ctx, 'db.pages[0].elements.length')).toBe(1);
    run(ctx, 'gnUndo();');
    expect(run(ctx, 'db.pages[0].elements.length')).toBe(2);
    expect(run(ctx, 'db.trash.length')).toBe(0);
    run(ctx, 'gnRedo();');
    expect(run(ctx, 'db.trash.length')).toBe(1);
  });

  it('le scénario du constat : supprimer, annuler, 31 jours plus tard, ouverture → l\'image existe toujours', async () => {
    run(ctx, "gnDeleteElement('e1'); gnCommitUndoSnapshot(); gnUndo();");
    run(ctx, 'db.trash.forEach(t => { t.deletedAt = Date.now() - 31 * 24 * 3600 * 1000; }); gnPurgeOldTrash();');
    await settle();
    expect(await imageExists(ctx, 'IMG1')).toBe(true);
  });

  it('même si une ancienne entrée de corbeille périmée subsiste (données déjà touchées par l\'ancien défaut), la purge ne détruit pas l\'image d\'un élément affiché', async () => {
    // état hérité : élément affiché ET entrée de corbeille expirée pour la même image
    run(ctx, `db.trash = [{ kind: 'gn-element', pageId: 'p1', element: { id: 'e1', type: 'image', imageId: 'IMG1' }, deletedAt: Date.now() - 40 * 24 * 3600 * 1000 }]; gnPurgeOldTrash();`);
    await settle();
    expect(await imageExists(ctx, 'IMG1')).toBe(true);
    expect(run(ctx, 'db.trash.length')).toBe(0);
  });

  it('une entrée expirée dont l\'image n\'est plus utilisée nulle part libère bien l\'image', async () => {
    run(ctx, "gnDeleteElement('e1');");
    run(ctx, 'db.trash.forEach(t => { t.deletedAt = Date.now() - 31 * 24 * 3600 * 1000; }); gnPurgeOldTrash();');
    await settle();
    expect(await imageExists(ctx, 'IMG1')).toBe(false);
  });

  it('purge manuelle : l\'image est conservée tant qu\'une autre page l\'utilise (compteur recalé sur l\'usage réel)', async () => {
    await putImage(ctx, 'IMG2', 5); // compteur dérivé : 5 alors qu\'un seul élément l\'utilise
    run(ctx, `db.pages.push({ id: 'p2', background: '#fff', elements: [ { id: 'e9', type: 'image', imageId: 'IMG2' } ] });
      db.trash = [{ kind: 'gn-element', pageId: 'p2', element: { id: 'e8', type: 'image', imageId: 'IMG2' }, deletedAt: Date.now() }];
      window.confirm = () => true; gnPurgeTrashEntry(0);`);
    await settle();
    const rec = await (await ctx.plumeImagesDb()).get('images', 'IMG2');
    expect(rec).toBeTruthy();
    expect(rec.refCount).toBe(1); // recalé : un seul élément l'utilise
  });
});

describe('reconcileGraphicImageRef (images.js)', () => {
  it('0 usage → supprime ; usage > 0 → conserve et recale le compteur', async () => {
    const ctx = makeCtx();
    await putImage(ctx, 'A', 3); await putImage(ctx, 'B', 3);
    await ctx.reconcileGraphicImageRef('A', 0);
    await ctx.reconcileGraphicImageRef('B', 2);
    expect(await imageExists(ctx, 'A')).toBe(false);
    expect((await (await ctx.plumeImagesDb()).get('images', 'B')).refCount).toBe(2);
  });
});

describe('Historique espacé — thinSnapshots (AUD-01-023)', () => {
  const ctx = makeCtx();
  const MIN = 60000, H = 60 * MIN, D = 24 * H;
  const now = Date.now();
  const snap = (ageMs, label) => ({ ts: now - ageMs, label: label || 'Auto', content: 'c' + ageMs });

  it('garde la plus récente de chaque tranche : 12 copies en 1 h → 4 (une par 15 min)', () => {
    const list = Array.from({ length: 12 }, (_, i) => snap(i * 5 * MIN)); // 0, 5, 10 ... 55 min
    const out = ctx.thinSnapshots(list, now);
    expect(out.length).toBe(4);
    expect(out[0].ts).toBe(now); // la plus récente est toujours conservée, en tête
  });

  it('un mois d\'écriture (une copie toutes les 20 min) tient en 20 copies au plus, du plus récent au plus ancien', () => {
    const list = Array.from({ length: 30 * 24 * 3 }, (_, i) => snap(i * 20 * MIN));
    const out = ctx.thinSnapshots(list, now);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.length).toBeGreaterThanOrEqual(15);
    for (let i = 1; i < out.length; i++) expect(out[i - 1].ts).toBeGreaterThan(out[i].ts);
    // le recul atteint plusieurs semaines (et non 2 h 30 comme avant)
    expect(now - out[out.length - 1].ts).toBeGreaterThan(10 * D);
  });

  it('les copies de plus de 30 jours disparaissent', () => {
    const out = ctx.thinSnapshots([snap(10 * MIN), snap(31 * D)], now);
    expect(out.length).toBe(1);
  });

  it('les instantanés manuels sont toujours conservés, même rapprochés ou anciens', () => {
    const list = [snap(1 * MIN, 'Manuel — a'), snap(2 * MIN, 'Manuel — b'), snap(60 * D, 'Manuel — vieux'), snap(3 * MIN)];
    const out = ctx.thinSnapshots(list, now);
    expect(out.filter(s => /^Manuel/.test(s.label)).length).toBe(3);
  });

  it('ne modifie pas la liste d\'origine et tolère les entrées vides', () => {
    const list = [snap(1 * MIN), snap(2 * MIN)];
    const copy = JSON.stringify(list);
    ctx.thinSnapshots(list, now);
    expect(JSON.stringify(list)).toBe(copy);
    expect(ctx.thinSnapshots(undefined, now)).toEqual([]);
    expect(ctx.thinSnapshots([], now)).toEqual([]);
  });

  it('thinAllHistory allège un manuscrit hérité (30 copies serrées) et le signale pour sauvegarde', () => {
    const c2 = makeCtx();
    const hist = Array.from({ length: 30 }, (_, i) => ({ ts: now - i * 5 * MIN, label: 'Auto', content: 'x'.repeat(100), title: 'T' }));
    vm.runInContext(`db = { chapters: [{ id: 'c1' }], history: { c1: ${JSON.stringify(hist)}, vide: [] } };`, c2);
    expect(c2.thinAllHistory()).toBe(true);
    expect(vm.runInContext('db.history.c1.length', c2)).toBeLessThan(10);
    expect(c2.thinAllHistory()).toBe(false); // déjà mince : rien à refaire
  });
});

describe('Roman graphique : fermeture et jeton (AUD-01-023)', () => {
  it('toute modification arme l\'avertissement de fermeture ; l\'enregistrement le désarme, sans jeton dans le manuscrit', async () => {
    const ctx = makeCtx();
    docAvecImage(ctx);
    const saved = [];
    vm.runInContext("_currentProfileId = 'p'; _dataKey = 'k'; _currentDocumentId = 'd';", ctx);
    ctx.persistData = async (key, payload) => { saved.push(payload); };
    ctx.makeEncryptedEnvelope = async txt => ({ txt });
    ctx.docDataKey = (p, d) => 'doc_' + p + '_' + d;
    ctx.mutateDocList = async () => {};
    run(ctx, "db.cloudToken = 'ghp_secret';");
    ctx.saveGraphicNovel(); // différé 600 ms
    expect(run(ctx, '_unsavedChanges')).toBe(true);
    await ctx.saveGraphicNovel(true);
    expect(run(ctx, '_unsavedChanges')).toBe(false);
    expect(saved.length).toBe(1);
    expect(saved[0].txt).not.toContain('ghp_secret');
    expect(saved[0].txt).toContain('"docType":"roman_graphique"');
  });
});
