// ═══════════════════════════════════════════════════════
// LOT « docx 9.8.1 » (v9.40.0) — bibliothèque chargée à la demande, ImageRun avec `type`
//  • docx n'est plus chargé au démarrage (index.html) mais à la première demande d'export (ensureDocx) ;
//  • le fichier est précaché par le service worker (export possible hors ligne) ;
//  • l'export du roman graphique donne un vrai DOCX avec ses images (docx 9 exige le champ `type`).
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

function makeContext(withDocx) {
  const dom = new JSDOM('<body></body>', { runScripts: 'outside-only' });
  const win = dom.window;
  win.DOMPurify = createDOMPurify(win);
  if (withDocx) win.docx = docxLib;
  win.toasts = []; win.toast = (m, t) => win.toasts.push(t + ':' + m);
  win.saved = null; win.saveAs = (blob, name) => { win.saved = { blob, name }; };
  const ctx = dom.getInternalVMContext();
  for (const f of ['js/schema.js', 'js/editor.js', 'js/export-format-utils.js', 'js/graphicnovel.js']) {
    try { new vm.Script(read(f), { filename: f }).runInContext(ctx); } catch (e) { throw new Error(f + ' : ' + e.message); }
  }
  return { win, run: code => new vm.Script(code).runInContext(ctx) };
}

describe('Fichiers : docx 9.8.1 hors du démarrage, précaché', () => {
  it('index.html ne charge plus docx au démarrage ; le fichier existe et le service worker le précache', () => {
    expect(read('index.html')).not.toMatch(/vendor\/docx-/);
    expect(fs.existsSync(path.join(ROOT, 'vendor', 'docx-9.8.1.js'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'vendor', 'docx-7.1.0.js'))).toBe(false);
    expect(read('sw.js')).toContain("'./vendor/docx-9.8.1.js'");
    expect(JSON.parse(read('package.json')).dependencies.docx).toBe('9.8.1');
  });
  it('le fichier servi est le build navigateur (variable globale docx) de docx 9.8.1', () => {
    const src = read('vendor/docx-9.8.1.js');
    expect(src.startsWith('var docx = ')).toBe(true);
    const sandbox = {}; vm.createContext(sandbox);
    vm.runInContext(src + '\nthis.__ok = typeof docx.Packer.toBlob === "function" && typeof docx.ImageRun === "function";', sandbox);
    expect(sandbox.__ok).toBe(true);
  });
});

describe('Chargement à la demande (ensureDocx)', () => {
  it('déjà chargé : aucune balise ajoutée', async () => {
    const { win, run } = makeContext(true);
    const before = win.document.head.querySelectorAll('script').length;
    expect(await run('ensureDocx()')).toBe(true);
    expect(win.document.head.querySelectorAll('script').length).toBe(before);
  });
  it('absent : une seule balise vers le fichier local, partagée par les appels simultanés, puis docx est disponible', async () => {
    const { win, run } = makeContext(false);
    const added = [];
    win.document.head.appendChild = s => { added.push(s); setTimeout(() => { win.docx = docxLib; s.onload(); }, 0); return s; };
    const [a, b] = await Promise.all([run('ensureDocx()'), run('ensureDocx()')]);
    expect(a && b).toBe(true);
    expect(added.length).toBe(1);
    expect(added[0].src).toMatch(/vendor\/docx-9\.8\.1\.js$/);
    expect(await run('ensureDocx()')).toBe(true);                                       // plus de chargement ensuite
    expect(added.length).toBe(1);
  });
  it('échec de chargement : « composant introuvable » et nouvelle tentative possible', async () => {
    const { win, run } = makeContext(false);
    let tries = 0;
    win.document.head.appendChild = s => { tries++; setTimeout(() => s.onerror(), 0); return s; };
    await run('exportDocx([{ title: "A", content: "<p>x</p>" }], "T")');
    expect(win.toasts.some(t => /rechargez la page/.test(t))).toBe(true);
    expect(win.saved).toBe(null);
    await run('exportDocx([{ title: "A", content: "<p>x</p>" }], "T")');
    expect(tries).toBe(2);
  });
  it('l\'export DOCX déclenche le chargement puis produit le fichier', async () => {
    const { win, run } = makeContext(false);
    win.document.head.appendChild = s => { setTimeout(() => { win.docx = docxLib; s.onload(); }, 0); return s; };
    await run('exportDocx([{ title: "Un", content: "<p>Il dit <em>jamais</em>.</p>" }], "Mon livre")');
    expect(win.saved.name).toBe('Mon livre.docx');
    const xml = await (await JSZip.loadAsync(await win.saved.blob.arrayBuffer())).file('word/document.xml').async('string');
    expect(xml).toMatch(/<w:i\/>/);
  });
});

describe('Export DOCX du roman graphique avec docx 9 (ImageRun type)', () => {
  it('chaque page devient une image JPEG dans le fichier Word, avec saut de page entre les pages', async () => {
    const { win, run } = makeContext(true);
    // Faux canevas : toBlob rend des octets JPEG minimaux ; la page est passée à l'export par gnExportPagesToCanvases.
    const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
    // Deux pages différentes (octets différents) : docx dédoublonne les images identiques en un seul fichier.
    win.__canvases = [0, 1].map(i => ({ width: 800, height: 600, toBlob: (cb) => cb(new globalThis.Blob([Uint8Array.from([...JPEG.slice(0, 20), i + 1, ...JPEG.slice(20)])], { type: 'image/jpeg' })) }));
    run('gnExportPagesToCanvases = async cb => { for (let i = 0; i < __canvases.length; i++) await cb(__canvases[i], i, __canvases.length); return true; }; gnExportFilename = () => "Livre graphique";');
    await run('gnExportBookDocx()');
    expect(win.toasts.some(t => /^error:/.test(t))).toBe(false);
    expect(win.saved.name).toBe('Livre graphique.docx');
    const zip = await JSZip.loadAsync(await win.saved.blob.arrayBuffer());
    const media = Object.keys(zip.files).filter(f => f.startsWith('word/media/') && !zip.files[f].dir);
    expect(media.length).toBe(2);
    expect(media.every(f => /\.jpe?g$/.test(f))).toBe(true);
    const xml = await zip.file('word/document.xml').async('string');
    expect((xml.match(/<w:drawing>/g) || []).length).toBe(2);
    expect((xml.match(/w:type="page"/g) || []).length).toBe(1);
  });
});
