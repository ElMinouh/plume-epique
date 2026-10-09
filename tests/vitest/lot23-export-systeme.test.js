// ════════════════════════════════════════════════════════════════════
// LOT E « export et panneau Système » (v9.45.0, audit AUD-03-014, 026, 016)
// ════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const html = read('index.html');
const lib = read('js/library.js');

describe('AUD-03-014 — export depuis l\'éditeur', () => {
  const src = read('js/export-format-utils.js');
  const code = src.slice(src.indexOf('let _exportSelectChapters'), src.indexOf('function getSelectedExportChapters'));
  function ctx(libraryMode = false) {
    const dom = new JSDOM(`<body class="${libraryMode ? 'library-mode' : ''}"><div id="export-select-overlay"></div><div id="export-select-list"></div></body>`, { runScripts: 'outside-only' });
    const c = dom.getInternalVMContext(); const win = dom.window;
    new vm.Script(`
      var DOMPurify = { sanitize: x => x };
      var db = { title: 'Mon roman', docType: 'texte', chapters: [{ title: 'Un' }, { title: 'Deux' }, { title: 'Trois' }] };
      var cur = 1; var _currentDocumentId = 'd1'; var flushed = 0;
      function flushCurrentChapter(){ flushed++; }
      var gnCalls = 0; function gnOpenBookExportModal(){ gnCalls++; }
      ${code}
    `).runInContext(c);
    return { win, run: s => new vm.Script(s).runInContext(c) };
  }
  const checks = win => [...win.document.querySelectorAll('.export-select-cb')].map(b => b.checked);
  it('« Exporter ce chapitre » ne coche que le chapitre ouvert ; « le manuscrit » les coche tous ; le chapitre est enregistré avant', () => {
    const { win, run } = ctx();
    run("exportFromEditor('chapter')");
    expect(checks(win)).toEqual([false, true, false]);
    expect(win.document.getElementById('export-select-overlay').classList.contains('active')).toBe(true);
    expect(run('flushed')).toBe(1);
    run("exportFromEditor('doc')");
    expect(checks(win)).toEqual([true, true, true]);
  });
  it('Ctrl+E (exportShortcut) : ouvre l\'export en éditeur, ne fait rien en bibliothèque, ouvre l\'export du livre en roman graphique', () => {
    let c = ctx(); c.run('exportShortcut()');
    expect(c.win.document.getElementById('export-select-overlay').classList.contains('active')).toBe(true);
    c = ctx(true); c.run('exportShortcut()');
    expect(c.win.document.getElementById('export-select-overlay').classList.contains('active')).toBe(false);
    c = ctx(); c.run("db.docType = 'roman_graphique'; exportShortcut()");
    expect(c.run('gnCalls')).toBe(1);
  });
  it('ouvertures : entrées du menu Outils, raccourci, aide des raccourcis, carte de la bibliothèque', () => {
    expect(html).toContain('id="export-chapter-btn"');
    expect(html).toContain('id="export-doc-btn"');
    expect(html).toMatch(/<span>Exporter le manuscrit<\/span><span class="shortcut-key">Ctrl\+E<\/span>/);
    const r = read('js/router.js');
    expect(r).toContain("e.key.toLowerCase()==='e'");
    expect(r).toContain("exportFromEditor('chapter')");
    // le ⋮ d'une carte ouvre directement la fenêtre d'export, plus le panneau Système
    expect(lib).toMatch(/lctx-export'\)\.addEventListener\('click', \(\) => \{[\s\S]*?libExportDoc\(docId\)/);
  });
});

describe('AUD-03-026 — panneau Système en trois onglets', () => {
  it('trois onglets accessibles, une seule liste de manuscrits', () => {
    for (const t of ['files', 'github', 'sync']) {
      expect(html).toContain(`id="lib-systab-${t}" data-systab="${t}"`);
      expect(html).toContain(`role="tabpanel" id="lib-sys-${t}"`);
    }
    expect(html).not.toContain('lib-gist-doc-select');
    expect((html.match(/id="lib-system-doc-select"/g) || []).length).toBe(1);
    expect(lib).not.toContain('lib-gist-doc-select');
  });
  it('chaque fonction reste dans le bon onglet', () => {
    const pane = id => { const i = html.indexOf(`id="lib-sys-${id}"`); const j = html.indexOf('<div class="lib-sys-pane', i + 10); return html.slice(i, j > 0 ? j : html.indexOf('<!-- IMPORT MANUSCRIT', i)); };
    expect(pane('files')).toMatch(/id="lib-export-btn"[\s\S]*id="lib-export-json-btn"/);
    expect(pane('github')).toMatch(/id="lib-gh-token"[\s\S]*id="lib-sync-cloud-btn"[\s\S]*id="lib-gist-history-btn"/);
    expect(pane('sync')).toMatch(/id="lib-conflict-list"[\s\S]*id="lib-sync-key-input"/);
  });
  it('le bon onglet s\'ouvre selon la provenance (jeton, rappel, badge de synchro)', () => {
    expect(lib).toContain("showSystemTab(tab || (_setupTourActive ? 'github' : 'files'))");
    expect(lib).toContain("openLibrarySystemPanel(undefined, 'sync')");
    expect(lib).toContain("openLibrarySystemPanel(undefined, 'github')");
    expect(lib).toContain("const tabBadge = document.getElementById('lib-systab-conflict-count')");
  });
  it('showSystemTab : un onglet actif à la fois, aria-selected tenu à jour, liste masquée pour la synchronisation', () => {
    const fn = lib.slice(lib.indexOf('function showSystemTab'), lib.indexOf('async function openLibrarySystemPanel'));
    const dom = new JSDOM(`<body><div id="library-system-overlay"><button class="lib-systab" data-systab="files"></button><button class="lib-systab" data-systab="github"></button><button class="lib-systab" data-systab="sync"></button>
      <div id="lib-sys-doc-zone"></div><div class="lib-sys-pane" id="lib-sys-files"></div><div class="lib-sys-pane" id="lib-sys-github"></div><div class="lib-sys-pane" id="lib-sys-sync"></div></div></body>`, { runScripts: 'outside-only' });
    const c = dom.getInternalVMContext(); const d = dom.window.document;
    new vm.Script(fn).runInContext(c);
    new vm.Script("showSystemTab('sync')").runInContext(c);
    expect([...d.querySelectorAll('.lib-systab')].map(b => b.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true']);
    expect([...d.querySelectorAll('.lib-sys-pane')].map(p => p.classList.contains('active'))).toEqual([false, false, true]);
    expect(d.getElementById('lib-sys-doc-zone').classList.contains('u-d-none')).toBe(true);
    new vm.Script("showSystemTab('github')").runInContext(c);
    expect(d.getElementById('lib-sys-doc-zone').classList.contains('u-d-none')).toBe(false);
  });
});

describe('AUD-03-016 — ⋮ visible et clic droit', () => {
  it('opacité de repos lisible (pas 0) pour les chapitres et les manuscrits', () => {
    expect(read('css/style.css')).toContain('.ch-kebab-btn,.library-kebab-btn,.lib-book-kebab{opacity:.7;}');
  });
  it('le clic droit ouvre le même menu que le ⋮', () => {
    expect(read('js/editor.js')).toContain("row.addEventListener('contextmenu', e => { e.preventDefault(); btn.click(); })");
    expect(lib).toContain("card.addEventListener('contextmenu'");
    expect(lib).toContain("book.addEventListener('contextmenu'");
  });
});
