// ═══════════════════════════════════════════════════════
// LOT 3 (v9.35.0) — EXPORTS FIDÈLES (AUD-02-003 / 013 / 016 / 017)
//  • DOCX : gras, italique, souligné, titres conservés ; PDF : mise en page Times, styles mélangés ;
//  • titre de chapitre sans doublon, nom de fichier = titre du manuscrit ;
//  • un seul message si un composant d'export manque.
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import * as docxLib from 'docx';
import JSZip from 'jszip';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

function makeContext() {
  const dom = new JSDOM('<body></body>', { runScripts: 'outside-only' });
  const win = dom.window;
  win.DOMPurify = createDOMPurify(win);
  win.docx = docxLib;
  win.toast = () => {};
  win.saved = null;
  win.saveAs = (blob, name) => { win.saved = { blob, name }; };
  const ctx = dom.getInternalVMContext();
  for (const f of ['js/editor.js', 'js/export-format-utils.js']) new vm.Script(read(f), { filename: f }).runInContext(ctx);
  return { win, run: code => new vm.Script(code).runInContext(ctx) };
}

describe('Titres et noms de fichier (AUD-02-013)', () => {
  const { run } = makeContext();
  it('le préfixe « Chapitre N : » n\'est pas ajouté à un titre qui commence déjà par « Chapitre »', () => {
    expect(run(`exportChapterTitle({ title: 'Chapitre 1' }, 0)`)).toBe('Chapitre 1');
    expect(run(`exportChapterTitle({ title: 'Le départ' }, 2)`)).toBe('Chapitre 3 : Le départ');
    expect(run(`exportChapterTitle({ title: '' }, 4)`)).toBe('Chapitre 5');
  });
  it('le nom de fichier vient du titre du manuscrit, nettoyé', () => {
    expect(run(`exportFileName('Mon roman', 'docx')`)).toBe('Mon roman.docx');
    expect(run(`exportFileName('Qui ? Moi : « non » / jamais', 'pdf')`)).toBe('Qui Moi « non » jamais.pdf');
    expect(run(`exportFileName('', 'epub')`)).toBe('manuscrit.epub');
    expect(run(`exportFileName('Fin...', 'odt')`)).toBe('Fin.odt');
  });
});

describe('Découpage du HTML en blocs (AUD-02-003)', () => {
  const { run } = makeContext();
  it('paragraphes, titres, gras, italique, souligné et retours à la ligne', () => {
    const blocks = JSON.parse(run(`JSON.stringify(htmlToExportBlocks('<h3>Titre</h3><p>Un <strong>gras</strong>, un <em>italique</em> et <u>souligné</u>.<br>Suite <b><i>les deux</i></b></p>'))`));
    expect(blocks).toHaveLength(2);
    expect(blocks[0].heading).toBe(3);
    const runs = blocks[1].runs;
    expect(runs.find(r => r.text === 'gras').bold).toBe(true);
    expect(runs.find(r => r.text === 'italique').italic).toBe(true);
    expect(runs.find(r => r.text === 'souligné').underline).toBe(true);
    expect(runs.some(r => r.br)).toBe(true);
    const both = runs.find(r => r.text === 'les deux');
    expect(both.bold && both.italic).toBe(true);
  });
  it('les surlignages d\'analyse (<mark>) ne sont pas exportés', () => {
    const blocks = JSON.parse(run(`JSON.stringify(htmlToExportBlocks('<p>un <mark>très</mark> mot</p>'))`));
    expect(blocks[0].runs.map(r => r.text).join('')).toBe('un très mot');
  });
});

describe('Export DOCX avec mise en forme (AUD-02-003)', () => {
  it('le fichier Word contient gras, italique, souligné et titre, sans « Chapitre 1 : Chapitre 1 »', async () => {
    const { win, run } = makeContext();
    await run(`exportDocx([{ title: 'Chapitre 1', content: '<p>Il dit <em>jamais</em> et <strong>toujours</strong> <u>vraiment</u>.</p><h3>Sous-titre</h3>' }], 'Mon roman')`);
    expect(win.saved.name).toBe('Mon roman.docx');
    const zip = await JSZip.loadAsync(await win.saved.blob.arrayBuffer());
    const xml = await zip.file('word/document.xml').async('string');
    expect(xml).toMatch(/<w:i\/>/);
    expect(xml).toMatch(/<w:b\/>/);
    expect(xml).toMatch(/<w:u /);
    expect(xml).toContain('Sous-titre');
    expect(xml).not.toContain('Chapitre 1 : Chapitre 1');
  });
});

describe('Mise en page PDF (AUD-02-003)', () => {
  // Faux document jsPDF : 2 mm par caractère, enregistre les appels.
  function fakeDoc() {
    const calls = { text: [], lines: [], pages: 0, fonts: [] };
    let font = 'normal';
    return {
      calls,
      internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
      setFont: (_f, style) => { font = style; calls.fonts.push(style); },
      setFontSize: () => {},
      getTextWidth: t => String(t).length * 2,
      text: (t, x, y) => calls.text.push({ t, x, y, font }),
      line: (...a) => calls.lines.push(a),
      addPage: () => { calls.pages++; }
    };
  }
  const L = () => makeContext().run('PDF_LAYOUT');
  it('chaque mot garde son style, les mêmes styles voisins sont regroupés', () => {
    const { run } = makeContext();
    const doc = fakeDoc(); const win = makeContext().win;
    const blocks = [{ heading: 0, runs: [{ text: 'un ' }, { text: 'mot', italic: true }, { text: ' et ' }, { text: 'gras', bold: true }] }];
    const fn = run('pdfWriteBlocks');
    fn(doc, blocks, 40, run('PDF_LAYOUT'));
    const styles = doc.calls.text.map(c => c.font + ':' + c.t);
    expect(styles).toEqual(['normal:un', 'italic:mot', 'normal:et', 'bold:gras']);
  });
  it('un mot souligné est souligné', () => {
    const { run } = makeContext(); const doc = fakeDoc();
    run('pdfWriteBlocks')(doc, [{ heading: 0, runs: [{ text: 'sous', underline: true }] }], 40, run('PDF_LAYOUT'));
    expect(doc.calls.lines).toHaveLength(1);
  });
  it('les lignes longues sont coupées avant la marge droite et le texte change de page en bas', () => {
    const { run } = makeContext(); const doc = fakeDoc();
    const layout = run('PDF_LAYOUT');
    const longText = Array.from({ length: 400 }, () => 'motmot').join(' ');
    run('pdfWriteBlocks')(doc, [{ heading: 0, runs: [{ text: longText }] }], 40, layout);
    const maxX = 210 - layout.margin;
    for (const c of doc.calls.text) expect(c.x + c.t.length * 2).toBeLessThanOrEqual(maxX + 0.001);
    expect(doc.calls.pages).toBeGreaterThan(0);
    for (const c of doc.calls.text) expect(c.y).toBeLessThanOrEqual(297 - layout.bottom + 0.001);
  });
  it('un retour à la ligne force une nouvelle ligne ; un paragraphe vide laisse une ligne blanche', () => {
    const { run } = makeContext(); const doc = fakeDoc();
    const y = run('pdfWriteBlocks')(doc, [{ heading: 0, runs: [{ text: 'a' }, { br: true }, { text: 'b' }] }, { heading: 0, runs: [] }], 40, run('PDF_LAYOUT'));
    const ys = doc.calls.text.map(c => c.y);
    expect(ys[1]).toBeGreaterThan(ys[0]);
    expect(y).toBeGreaterThan(ys[1] + 6);
  });
});

describe('Messages et roman graphique (AUD-02-016 / 017)', () => {
  it('plus aucun message « vérifiez la connexion » dans les exports', () => {
    for (const f of ['js/export-format-utils.js', 'js/graphicnovel.js']) expect(read(f), f).not.toMatch(/vérifiez la connexion/);
  });
  it('le message de composant manquant demande de recharger la page', () => {
    expect(makeContext().run('EXPORT_LIB_MISSING')).toMatch(/rechargez la page/);
  });
  it('l\'import dans un manuscrit existant ne propose pas les romans graphiques', () => {
    expect(read('js/export-format-utils.js')).toContain("filter(d => d.docType !== 'roman_graphique')");
  });
  it('l\'export de la fenêtre Système refuse proprement un roman graphique', () => {
    expect(read('js/library.js')).toMatch(/docType === 'roman_graphique' \|\| !Array\.isArray\(mData\.chapters\)/);
  });
});
