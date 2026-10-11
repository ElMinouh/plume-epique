// ═══════════════════════════════════════════════════════
// LOT 7 « confort de lecture, langue d'un passage » (v9.63.0, audit AUD-05-014, 015)
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const css = read('css/style.css'), html = read('index.html'), notif = read('js/notifications.js'), editor = read('js/editor.js');
const sw = read('sw.js'), pkg = JSON.parse(read('package.json'));
const FONTS = ['400-normal', '400-italic', '700-normal', '700-italic'].map(v => `atkinson-hyperlegible-5.3.0-latin-${v}.woff2`);

describe('AUD-05-014 — police Atkinson Hyperlegible embarquée', () => {
  it('4 fichiers WOFF2 valides, licence OFL jointe, version figée dans package.json', () => {
    for (const f of FONTS) {
      const buf = fs.readFileSync(path.join(ROOT, 'vendor/fonts', f));
      expect(buf.subarray(0, 4).toString('latin1'), f).toBe('wOF2');
      expect(buf.length, f).toBeGreaterThan(10000);
      expect(buf.length, f).toBeLessThan(60000);
      expect(sw, f).toContain(f);
      expect(css, f).toContain(f);
    }
    expect(read('vendor/fonts/LICENCE-OFL-atkinson.txt')).toContain('Braille Institute');
    expect(pkg.dependencies['@fontsource/atkinson-hyperlegible']).toBe('5.3.0');
    expect(read('vendor/LISEZMOI.md')).toContain('atkinson-hyperlegible');
  });
  it('choisie dans la liste des polices et appliquée à l\'écriture, au Focus et à la Lecture', () => {
    expect(html).toMatch(/data-font="atkinson" tabindex="0" role="radio"/);
    expect(read('js/database.js')).toContain("'atkinson': { css:");
    expect(read('js/database.js')).toContain("'font-verdana','font-atkinson','font-courier'");
    expect(css).toMatch(/body\.font-atkinson #writer,body\.font-atkinson #focus-writer,body\.font-atkinson #reading-content\{font-family:'Atkinson Hyperlegible'/);
  });
});

describe('AUD-05-014 — réglages de confort (jsdom)', () => {
  const a = notif.indexOf('const COMFORT = {'), b = notif.indexOf('Object.keys(COMFORT).forEach(name => applyComfort');
  const code = notif.slice(a, b);
  function monde(stock = {}) {
    const dom = new JSDOM(`<body><div id="writer"></div><div id="focus-writer"></div><div id="chapter-title"></div>
      <div id="lineheight-picker"><button class="mode-indicator" data-value="normal"></button><button class="mode-indicator" data-value="confortable"></button><button class="mode-indicator" data-value="large"></button></div>
      <div id="spacing-picker"><button class="mode-indicator" data-value="normal"></button><button class="mode-indicator" data-value="large"></button></div>
      <div id="spellcheck-picker"><button class="mode-indicator" data-value="off"></button><button class="mode-indicator" data-value="on"></button></div></body>`,
      { runScripts: 'outside-only', url: 'http://localhost/' });
    const w = dom.window; Object.entries(stock).forEach(([k, v]) => w.localStorage.setItem(k, v));
    w.eval(code); return w;
  }
  it('valeurs par défaut sûres ; une valeur inconnue en stockage est ignorée', () => {
    const w = monde({ plume_line_height: 'enorme' });
    expect(w.eval("loadComfort('lineheight')")).toBe('normal');
    expect(w.eval("loadComfort('spacing')")).toBe('normal');
    expect(w.eval("loadComfort('spell')")).toBe('off');
  });
  it('interligne et espacement posés sur <html> ; boutons actifs mis à jour ; persistance', () => {
    const w = monde();
    w.eval("selectComfort('lineheight','large'); selectComfort('spacing','large')");
    expect(w.document.documentElement.dataset.lineheight).toBe('large');
    expect(w.document.documentElement.dataset.spacing).toBe('large');
    expect(w.localStorage.getItem('plume_line_height')).toBe('large');
    expect(w.document.querySelector('#lineheight-picker .active').dataset.value).toBe('large');
    w.eval("selectComfort('lineheight','nimporte')");   // valeur invalide refusée
    expect(w.document.documentElement.dataset.lineheight).toBe('large');
  });
  it('correction orthographique : appliquée à l\'écriture, au Focus et au titre', () => {
    const w = monde();
    w.eval("applyComfort('spell','on')");
    for (const id of ['writer', 'focus-writer', 'chapter-title']) expect(w.document.getElementById(id).spellcheck, id).toBe(true);
    w.eval("applyComfort('spell','off')");
    expect(w.document.getElementById('writer').spellcheck).toBe(false);
  });
  it('CSS : interligne et espacement ciblent l\'écriture, le Focus et la Lecture ; état exposé aux lecteurs d\'écran', () => {
    expect(css).toContain('html[data-lineheight="confortable"]{--lh-write:var(--lh-write-comfort);}');
    expect(css).toMatch(/html\[data-spacing="large"\] #reading-content\{letter-spacing:\.05em;word-spacing:\.16em;\}/);
    expect(notif).toMatch(/#lineheight-picker \.mode-indicator, #spacing-picker \.mode-indicator, #spellcheck-picker \.mode-indicator/);
    expect(read('js/router.js')).toContain('selectComfort(name,btn.dataset.value)');
  });
});

describe('AUD-05-015 — langue d\'un passage (jsdom)', () => {
  const a = editor.indexOf('const LANG_CODE_RE'), b = editor.indexOf('function formatParagraph(tag)');
  const code = editor.slice(a, b);
  function monde(contenu, reponse) {
    const dom = new JSDOM(`<body><div id="writer" contenteditable="true">${contenu}</div></body>`, { runScripts: 'outside-only' });
    const w = dom.window; const msgs = [];
    w.toast = (m, t) => msgs.push([m, t]); w.checkpointNow = () => {}; w.showPromptModal = async () => reponse;
    w.eval(code); return { w, msgs };
  }
  const selectionner = (w, debut, fin) => {
    const t = w.document.getElementById('writer'); const r = w.document.createRange();
    const [n1, o1] = debut(t), [n2, o2] = fin(t); r.setStart(n1, o1); r.setEnd(n2, o2);
    const s = w.getSelection(); s.removeAllRanges(); s.addRange(r);
  };
  it('entoure la sélection d\'un <span lang> dans le paragraphe', async () => {
    const { w } = monde('<p>Il dit hello world puis partit.</p>', ' EN ');
    selectionner(w, t => [t.firstChild.firstChild, 7], t => [t.firstChild.firstChild, 18]);
    await w.markPassageLanguage();
    expect(w.document.getElementById('writer').innerHTML).toBe('<p>Il dit <span lang="en">hello world</span> puis partit.</p>');
  });
  it('refuse un code invalide, une sélection vide ou multi-paragraphes ; annulation sans effet', async () => {
    let m = monde('<p>Un texte</p>', 'zz!!');
    selectionner(m.w, t => [t.firstChild.firstChild, 0], t => [t.firstChild.firstChild, 2]);
    await m.w.markPassageLanguage();
    expect(m.w.document.getElementById('writer').innerHTML).toBe('<p>Un texte</p>');
    expect(m.msgs.at(-1)[1]).toBe('error');
    m = monde('<p>Un</p><p>Deux</p>', 'en');
    selectionner(m.w, t => [t.children[0].firstChild, 0], t => [t.children[1].firstChild, 2]);
    await m.w.markPassageLanguage();
    expect(m.w.document.getElementById('writer').innerHTML).toBe('<p>Un</p><p>Deux</p>');
    m = monde('<p>Un texte</p>', null);
    selectionner(m.w, t => [t.firstChild.firstChild, 0], t => [t.firstChild.firstChild, 2]);
    await m.w.markPassageLanguage();
    expect(m.w.document.getElementById('writer').innerHTML).toBe('<p>Un texte</p>');
  });
  it('retire l\'indication de langue sans perdre le texte', () => {
    const { w } = monde('<p>Il dit <span lang="en">hello world</span> puis.</p>');
    selectionner(w, t => [t.firstChild.firstChild, 2], t => [t.firstChild.lastChild, 3]);
    w.clearPassageLanguage();
    expect(w.document.getElementById('writer').innerHTML.replace(/\s+/g, ' ')).toBe('<p>Il dit hello world puis.</p>');
  });
  it('boutons du menu Structure et conservation à l\'affichage', () => {
    expect(html).toContain('id="fmt-lang-btn"');
    expect(html).toContain('id="fmt-lang-clear-btn"');
    expect(css).toContain('#writer span[lang]');
  });
});

describe('Version', () => {
  it('v9.63.0 ou plus : APP_VERSION et cache du service worker identiques', () => {
    const v = read('js/router.js').match(/const APP_VERSION = '([\d.]+)'/)[1];
    const c = sw.match(/const CACHE = 'plume-epique-v([\d.]+)'/)[1];
    expect(c).toBe(v);
    const [x, y] = v.split('.').map(Number);
    expect(x > 9 || (x === 9 && y >= 63)).toBe(true);
  });
});
