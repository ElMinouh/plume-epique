// ═══════════════════════════════════════════════════════
// AUD-08 LOT 2 (v9.81.0) — VOCABULAIRE ET COMPOSANTS (AUD-08-008, 009, 010, 011, 012, 019)
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html'), css = read('css/style.css'), lib = read('js/library.js');
function grab(file, name) {
  const src = read(file), i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error(name + ' introuvable');
  let d = 0; const j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const iconOf = id => (html.match(new RegExp('id="' + id + '"[^>]*><svg[^>]*><use href="#i-([a-z0-9-]+)"')) || [])[1];

describe('AUD-08-008 — sélecteur de vue de la bibliothèque', () => {
  it('boutons en ligne (flex, sans retour à la ligne) : « Étagère » ne passe plus sous son icône', () => {
    expect(css).toMatch(/\.ch-view-toggle \.mode-indicator\{[^}]*display:inline-flex[^}]*white-space:nowrap/);
  });
});

describe('AUD-08-009 — un seul libellé de création, titres par défaut numérotés', () => {
  it('l\'étagère dit « Nouveau projet » comme la grille', () => {
    expect(lib).toContain('Nouveau<br>projet</span>');
    expect(lib).not.toContain('Nouveau<br>manuscrit');
  });
  const ctx = vm.createContext({}); new vm.Script(grab('js/library.js', 'uniqueDefaultTitle')).runInContext(ctx);
  const u = (b, t) => vm.runInContext(`uniqueDefaultTitle(${JSON.stringify(b)}, ${JSON.stringify(t)})`, ctx);
  it('le premier titre reste tel quel, les suivants sont numérotés', () => {
    expect(u('Nouveau projet', [])).toBe('Nouveau projet');
    expect(u('Nouveau projet', ['Nouveau projet'])).toBe('Nouveau projet 2');
    expect(u('Nouveau projet', ['Nouveau projet', 'Nouveau projet 2'])).toBe('Nouveau projet 3');
    expect(u('Nouveau projet', ['Le Phare'])).toBe('Nouveau projet');
  });
  it('les deux créations (texte, roman graphique) passent par cette numérotation', () => {
    expect(lib).toContain("uniqueDefaultTitle('Nouveau projet'");
    expect(read('js/graphicnovel.js')).toContain("uniqueDefaultTitle('Nouveau roman graphique'");
  });
});

describe('AUD-08-010 — une icône, un sens', () => {
  it('Étagère n\'utilise plus l\'icône bibliothèque ; le sprite contient rows-3', () => {
    expect(html).toContain('<use href="#i-rows-3"></use></svg> Étagère');
    expect(html).toContain('id="i-rows-3"');
  });
  it('« Visite de la bibliothèque » et « Visite complète » ont deux icônes différentes, dans les deux menus', () => {
    for (const [a, b] of [['library-tour-btn', 'library-full-tour-btn'], ['ltop-tour', 'ltop-full-tour']]) {
      expect(iconOf(a)).toBeTruthy(); expect(iconOf(b)).toBeTruthy();
      expect(iconOf(a)).not.toBe(iconOf(b));
    }
  });
});

describe('AUD-08-011 — bouton de thème : libellé = cible du clic', () => {
  function app(dark) {
    const dom = new JSDOM(`<body class="${dark ? 'dark-mode' : ''}"><button id="toggle-dark-btn"><span><svg><use href="#i-moon"></use></svg></span><span class="mb-label"> Sombre</span></button></body>`, { runScripts: 'outside-only' });
    const ctx = dom.getInternalVMContext(); new vm.Script(grab('js/database.js', 'updateThemeToggleLabel')).runInContext(ctx);
    return { d: dom.window.document, run: s => new vm.Script(s).runInContext(ctx) };
  }
  it('thème sombre : « Clair » avec un soleil ; thème clair ou papier : « Sombre » avec une lune', () => {
    let a = app(true); a.run('updateThemeToggleLabel()');
    expect(a.d.querySelector('.mb-label').textContent.trim()).toBe('Clair');
    expect(a.d.querySelector('use').getAttribute('href')).toBe('#i-sun');
    a = app(false); a.run('updateThemeToggleLabel()');
    expect(a.d.querySelector('.mb-label').textContent.trim()).toBe('Sombre');
    expect(a.d.querySelector('use').getAttribute('href')).toBe('#i-moon');
  });
  it('le libellé se met à jour à chaque changement de thème (runThemeSwitch) et plus aucun « Nuit » n\'est affiché', () => {
    expect(grab('js/notifications.js', 'runThemeSwitch')).toContain('updateThemeToggleLabel');
    expect(html).not.toMatch(/mb-label"> Nuit/);
  });
});

describe('AUD-08-012 — « Système » ne désigne plus qu\'un seul écran', () => {
  it('l\'onglet de l\'éditeur s\'appelle « Versions » (libellé, description, régions)', () => {
    const r = read('js/router.js');
    expect(r).toContain("'tab-systeme':{ icon:'archive', label:'Versions' }");
    expect(r).toContain("'tab-systeme':'Versions du chapitre et plugins'");
    expect(html).toContain('<div id="tab-systeme" class="tab-content" role="region" aria-label="Versions">');
  });
  it('« Système » reste le nom de la fenêtre de la bibliothèque', () => {
    expect(html).toContain('Système & Sauvegardes');
    expect(html).toContain('id="library-system-btn"');
  });
});

describe('AUD-08-019 — titre de l\'onglet du navigateur', () => {
  const ctx = vm.createContext({}); new vm.Script(grab('js/library.js', 'pageTitleFor')).runInContext(ctx);
  const t = (l, titre) => vm.runInContext(`pageTitleFor(${l}, ${JSON.stringify(titre)})`, ctx);
  it('bibliothèque, manuscrit ouvert, sans titre', () => {
    expect(t(true, 'Le Phare')).toBe('Ma bibliothèque — Plume');
    expect(t(false, 'Le Phare')).toBe('Le Phare — Plume');
    expect(t(false, '  ')).toBe('Plume');
  });
  it('plus aucun numéro de version dans le titre ; le titre suit l\'ouverture, le renommage et l\'écran', () => {
    expect(read('js/router.js')).not.toMatch(/document\.title\s*=\s*'Plume · v'/);
    expect(lib).toMatch(/function showLibraryScreen\(\) \{[^}]*refreshPageTitle/);
    expect(lib).toMatch(/function hideLibraryScreen\(\) \{[^}]*refreshPageTitle/);
    expect(grab('js/library.js', 'updateDocumentTitle')).toContain('refreshPageTitle()');
  });
});
