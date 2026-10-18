// ═══════════════════════════════════════════════════════
// LOT 3 de l'audit AUD-09 (v9.85.0) : registre des types de document (AUD-09-002) et Ctrl+F sur le roman graphique (AUD-09-003).
// Le registre vit dans schema.js (DOC_TYPES, docTypeOf, isGraphicDoc) ; les gestionnaires globaux l'interrogent.
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const schema = read('js/schema.js');

// Évalue le bloc du registre avec des fonctions d'application factices qui enregistrent leurs appels.
function chargerRegistre() {
  const debut = schema.indexOf('function _docPlainText');
  const fin = schema.indexOf('function isGraphicDoc');
  const bloc = schema.slice(debut, schema.indexOf('\n', fin) + 1);
  const appels = [];
  const ctx = { db: {}, appels };
  for (const n of ['flushCurrentChapter', 'save', 'undoEdit', 'redoEdit', 'initApp', 'saveGraphicNovel', 'gnUndo', 'gnRedo', 'openGraphicNovelScreen', 'gnOpenBookExportModal', 'flushDocumentMeta']) ctx[n] = (...a) => { appels.push(n + (a.length ? '(' + a.join(',') + ')' : '')); };
  ctx.exportFromEditor = s => appels.push('exportFromEditor(' + s + ')');
  ctx.changeCh = i => appels.push('changeCh(' + i + ')');
  ctx.gnSetActivePage = i => appels.push('gnSetActivePage(' + i + ')');
  vm.createContext(ctx);
  vm.runInContext(bloc + '\nthis.DOC_TYPES = DOC_TYPES; this.docTypeOf = docTypeOf; this.isGraphicDoc = isGraphicDoc;', ctx);
  return ctx;
}

describe('AUD-09-002 : registre des types de document', () => {
  it('chaque type fournit la même interface', () => {
    const { DOC_TYPES } = chargerRegistre();
    expect(Object.keys(DOC_TYPES).sort()).toEqual(['roman_graphique', 'texte']);
    for (const t of Object.values(DOC_TYPES)) {
      for (const f of ['saveNow', 'saveForClose', 'undo', 'redo', 'exportShortcut', 'open', 'search']) expect(typeof t[f], f).toBe('function');
      expect(typeof t.refreshView).toBe('boolean');
      expect(typeof t.protectedFromHotReload).toBe('boolean');
    }
  });
  it('docTypeOf : un type absent ou inconnu se comporte comme « texte »', () => {
    const c = chargerRegistre();
    expect(c.docTypeOf({ docType: 'roman_graphique' })).toBe(c.DOC_TYPES.roman_graphique);
    expect(c.docTypeOf({ docType: 'bande_dessinee' })).toBe(c.DOC_TYPES.texte);
    expect(c.docTypeOf({})).toBe(c.DOC_TYPES.texte);
    expect(c.docTypeOf(null)).toBe(c.DOC_TYPES.texte);
    expect(c.isGraphicDoc({ docType: 'roman_graphique' })).toBe(true);
    expect(c.isGraphicDoc({ docType: 'texte' })).toBe(false);
    expect(c.isGraphicDoc(undefined)).toBe(false);
  });
  it('les actions aboutissent aux bonnes fonctions de chaque type', () => {
    const c = chargerRegistre();
    const t = c.DOC_TYPES.texte, g = c.DOC_TYPES.roman_graphique;
    t.saveNow(); t.undo(); t.redo(); t.exportShortcut(); t.open();
    expect(c.appels).toEqual(['flushCurrentChapter', 'save', 'undoEdit', 'redoEdit', 'exportFromEditor(doc)', 'initApp']);
    c.appels.length = 0;
    g.saveNow(); g.undo(); g.redo(); g.exportShortcut(); g.open();
    expect(c.appels).toEqual(['saveGraphicNovel(true)', 'gnUndo', 'gnRedo', 'gnOpenBookExportModal', 'openGraphicNovelScreen']);
  });
  it('la fermeture enregistre selon le type (texte : chapitre + métadonnées ; roman graphique : écran dédié)', async () => {
    const c = chargerRegistre();
    await c.DOC_TYPES.texte.saveForClose();
    expect(c.appels).toEqual(['flushCurrentChapter', 'save', 'flushDocumentMeta']);
    c.appels.length = 0;
    await c.DOC_TYPES.roman_graphique.saveForClose();
    expect(c.appels).toEqual(['saveGraphicNovel(true)']);
  });
  it('un nouveau type s\'ajoute dans le registre sans toucher aux gestionnaires', () => {
    const c = chargerRegistre();
    c.DOC_TYPES.bande_dessinee = { ...c.DOC_TYPES.texte, label: 'BD' };
    expect(c.docTypeOf({ docType: 'bande_dessinee' }).label).toBe('BD');
  });
});

describe('AUD-09-003 : recherche globale par type', () => {
  it('texte : retrouve les occurrences dans les chapitres (sans les balises) et mène au chapitre', () => {
    const c = chargerRegistre();
    c.db.chapters = [{ title: 'A', content: '<p>Il pleut sur la <b>Lune</b>.</p>' }, { title: 'B', content: '<p>Rien</p>' }, { title: 'C', content: 'lune, lune' }];
    const hits = c.DOC_TYPES.texte.search('lune');
    expect(hits.map(h => [h.label, h.total])).toEqual([['A', 1], ['C', 2]]);
    hits[1].go();
    expect(c.appels).toEqual(['changeCh(2)']);
  });
  it('roman graphique : retrouve le texte des pages, sans lire db.chapters (inexistant), et mène à la page', () => {
    const c = chargerRegistre();
    c.db.pages = [{ elements: [{ type: 'image' }] }, { elements: [{ type: 'text', content: '<p>Le <i>dragon</i> dort</p>' }, { type: 'text', content: 'un autre dragon' }] }];
    expect('chapters' in c.db).toBe(false);
    const hits = c.DOC_TYPES.roman_graphique.search('dragon');
    expect(hits.map(h => [h.label, h.total])).toEqual([['Page 2', 2]]);
    hits[0].go();
    expect(c.appels).toEqual(['gnSetActivePage(1)']);
  });
  it('roman graphique sans page ni chapitre : aucun résultat, aucune exception', () => {
    const c = chargerRegistre();
    expect(c.DOC_TYPES.roman_graphique.search('x')).toEqual([]);
    expect(c.DOC_TYPES.texte.search('x')).toEqual([]);
  });
  it('panels.js ne lit plus db.chapters sans garde et interroge le registre', () => {
    const p = read('js/panels.js');
    expect(p).toContain('docTypeOf(db).search(q)');
    expect(p).not.toMatch(/db\.chapters\.forEach/);
    for (const k of ['chars', 'places', 'quests']) expect(p).toContain('(db.' + k + ' || []).forEach(');
  });
});

describe('AUD-09-002 : plus de comparaison de type hors du registre', () => {
  it('aucun fichier (sauf schema.js et graphicnovel.js) ne compare docType à \'roman_graphique\'', () => {
    const re = /docType\s*[!=]==?\s*'roman_graphique'/;
    const fautifs = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js') && !['schema.js', 'graphicnovel.js'].includes(f))
      .filter(f => re.test(read('js/' + f)));
    expect(fautifs).toEqual([]);
  });
  it('les gestionnaires de raccourcis passent par le registre', () => {
    const r = read('js/router.js');
    expect(r).toContain('docTypeOf(db).saveNow()');
    expect(r).toContain('docTypeOf(db).undo()');
    expect(r).toContain('docTypeOf(db).redo()');
    expect(read('js/export-format-utils.js')).toContain('docTypeOf(db).exportShortcut()');
    expect(read('js/profiles.js')).toContain('docTypeOf(db).saveForClose()');
  });
});
