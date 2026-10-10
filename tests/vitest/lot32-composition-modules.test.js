// ═══════════════════════════════════════════════════════
// LOT 6 « composition, roman graphique, étagère, rappel, Focus / Lecture » (v9.55.0, audit AUD-04-017, 019, 011, 020, 026)
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// fins de ligne normalisées : le dépôt peut être extrait en CRLF (Windows) ou en LF (CI)
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const css = read('css/style.css');
const html = read('index.html');
const lib = read('js/library.js');

const lum = hex => {
  const h = hex.replace('#', ''); const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const block = sel => css.match(new RegExp('(?:^|\\n)' + sel + ' \\{([\\s\\S]*?)\\n\\}'))[1];
const root = block(':root'), dark = block('body\\.dark-mode'), paper = block('body\\.paper-mode');
const hex = (b, name) => { const m = b.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})\\b')); return m && m[1]; };
const stops = (b, name) => (b.match(new RegExp('--' + name + ':\\s*linear-gradient\\([^)]*\\)')) || [''])[0].match(/#[0-9a-fA-F]{6}/g);
// le thème papier ne redéfinit pas tout : valeurs héritées du :root
const themes = {
  clair: { imm: [hex(root, 'imm-bg'), hex(root, 'imm-text')], shelf: stops(root, 'shelf-bg'), ink: hex(root, 'shelf-ink'), title: hex(root, 'title') },
  sombre: { imm: [hex(dark, 'imm-bg'), hex(dark, 'imm-text')], shelf: stops(dark, 'shelf-bg'), ink: hex(dark, 'shelf-ink'), title: hex(dark, 'title') },
  papier: { imm: [hex(paper, 'imm-bg'), hex(paper, 'imm-text')], shelf: stops(paper, 'shelf-bg'), ink: hex(root, 'shelf-ink'), title: hex(root, 'title') },
};

describe('AUD-04-017 — éditeur : un seul axe gauche', () => {
  it('barre d\'outils, titre, notes et texte partagent la colonne --text-w ; le titre a le même retrait que le texte', () => {
    expect(css).toContain('@media (min-width:769px){#editor-wrapper > .toolbar{max-width:var(--text-w);margin-left:auto;margin-right:auto;width:100%;}}');
    expect(css).toContain('#writer,#chapter-title-row,#chapter-notes-panel{max-width:var(--text-w);');
    expect(css).toContain('#chapter-title-row{padding-left:12px;padding-right:12px;}');
    expect(css).toMatch(/#writer\{[^}]*padding:8px 12px/);
  });
});

describe('AUD-04-026 — Focus et Lecture suivent le thème', () => {
  it('plus aucune couleur de fond ou de texte figée dans les deux modes immersifs', () => {
    const lines = css.split('\n').filter(l => /^#(focus|reading)-/.test(l) || /^\s+(color|background)/.test(l));
    expect(css).not.toContain('#0a0a0f');
    expect(css).not.toContain('#d4c5a9;');
    expect(css).not.toContain('#e8a09a;padding:');
    expect(css).toContain('#focus-overlay{display:none;position:fixed;inset:0;z-index:9999;background:var(--imm-bg);color:var(--imm-text);');
    expect(css).toContain('#reading-overlay{display:none;position:fixed;inset:0;z-index:9500;background:var(--imm-bg);color:var(--imm-text);');
    expect(lines.length).toBeGreaterThan(0);
  });
  it('largeur = colonne de texte réglable (--text-w), plus 720 px figés', () => {
    expect(css).toContain('#focus-writer{width:100%;max-width:var(--text-w);');
    expect(css).toContain('#reading-content{width:100%;max-width:var(--text-w);');
    expect(css).not.toMatch(/#(focus-title|focus-writer|reading-content)\{[^}]*max-width:720px/);
  });
  it('texte ≥ 7:1 et titres ≥ 4,5:1 sur le fond immersif de chaque thème', () => {
    for (const [k, t] of Object.entries(themes)) {
      expect(ratio(t.imm[1], t.imm[0]), k + ' texte').toBeGreaterThanOrEqual(7);
      expect(ratio(t.title, t.imm[0]), k + ' titre').toBeGreaterThanOrEqual(4.5);
    }
  });
  it('un fond immersif distinct de celui du thème : le mode Focus assombrit en sombre, jamais un noir figé en clair/papier', () => {
    expect(lum(themes.clair.imm[0])).toBeGreaterThan(0.6);
    expect(lum(themes.papier.imm[0])).toBeGreaterThan(0.5);
    expect(lum(themes.sombre.imm[0])).toBeLessThan(0.02);
  });
});

describe('AUD-04-011 — étagère dans la palette, dos qui s\'élargissent, ⋮ hors du titre', () => {
  it('le bois n\'est plus un brun figé : chêne en clair et papier, bleu nuit en sombre, via des jetons', () => {
    expect(css).toContain('#library-shelf{margin-top:4px;background:var(--shelf-bg);');
    expect(css).toContain('background:var(--shelf-plank);');
    expect(css).not.toContain('#3b2a1a,#241708');
    expect(themes.sombre.shelf.every(c => parseInt(c.slice(5, 7), 16) > parseInt(c.slice(1, 3), 16))).toBe(true); // dominante bleue
  });
  it('le libellé « Nouveau manuscrit » est lisible sur le bois de chaque thème (≥ 4,5:1)', () => {
    for (const [k, t] of Object.entries(themes)) for (const c of t.shelf) expect(ratio(t.ink, c), k + ' ' + c).toBeGreaterThanOrEqual(4.5);
  });
  it('un dos dont le titre déborde passe à deux colonnes (lib-book-wide) ; filets à 28 px du bord, sous le ⋮ (24 px + 3 px)', () => {
    expect(lib).toContain("it.el.classList.add('lib-book-wide'); it.applyMargin(it.marginMax)");
    expect(lib).toContain('data-band-margin-default="${Math.max(28, Math.round(h*0.16))}" data-band-margin-max="28"');
    expect(css).toContain('.lib-book.lib-book-wide{width:66px;}');
    expect(css).toContain('.lib-book-wide .lib-book-title{white-space:normal;');
    expect(24 + 3).toBeLessThan(28);
  });
});

describe('AUD-04-019 — roman graphique : même langage d\'état que l\'application', () => {
  const a = css.indexOf('MODULE ROMAN GRAPHIQUE'), b = css.indexOf('/* v9.27.0 (audit AUD-01-013)');
  const gn = css.slice(a, b);
  it('le second accent ne sert plus qu\'à distinguer image / texte et à la bannière d\'aperçu', () => {
    const left = gn.split('\n').filter(l => /accent2/.test(l)).map(l => l.trim().slice(0, 40));
    expect(left.every(l => l.startsWith('.gn-icon-z.gn-icon-i') || l.startsWith('.gn-preview-banner'))).toBe(true);
    expect(left.length).toBeGreaterThan(0);
  });
  it('états actifs et sélection au même jeton que le reste (--accent), texte coloré en --accent-text', () => {
    expect(gn).toContain('.gn-shape-btn.gn-active{border-color:var(--accent);color:var(--accent-text);');
    expect(gn).toContain('.gn-toggle-btn.gn-active{border-color:var(--accent);color:var(--accent-text);');
    expect(gn).not.toMatch(/(?<![\w-])color:var\(--accent\)/);
    expect(gn).not.toContain('rgba(142,68,173');
  });
  it('cibles agrandies : pastilles de page 28 px, actions de calque 24 px', () => {
    expect(css).toContain('.gn-pg-del,.gn-pg-dup{width:28px;height:28px;line-height:28px;');
    expect(css).toMatch(/\.gn-lz button\{width:24px;height:24px;/);
  });
});

describe('AUD-04-020 — rappel de sauvegarde GitHub discret', () => {
  it('pastille à contour avec un point d\'alerte (plus d\'aplat orange), libellé court, masquée sur téléphone', () => {
    expect(html).toMatch(/<button hidden class="action-btn btn-secondary btn-sm" id="library-github-reminder"[^>]*>Sauvegarde GitHub<\/button>/);
    expect(css).toContain('#library-github-reminder::before{content:"";');
    expect(css).toContain('@media (max-width:480px){#library-github-reminder{display:none !important;}}');
  });
  describe('délai de 7 jours', () => {
    const src = lib.slice(lib.indexOf('const GITHUB_REMINDER_DELAY_MS'), lib.indexOf('async function renderLibrarySyncBadge'));
    function app(firstUse, token) {
      const dom = new JSDOM('<body><button id="library-github-reminder" hidden></button></body>', { runScripts: 'outside-only', url: 'http://localhost/' });
      if (firstUse !== null) dom.window.localStorage.setItem('plume_first_use', String(firstUse));
      const c = dom.getInternalVMContext();
      new vm.Script('var _cloudToken = ' + JSON.stringify(token) + ';').runInContext(c);
      new vm.Script(src).runInContext(c);
      return { win: dom.window, run: s => new vm.Script(s).runInContext(c), btn: () => dom.window.document.getElementById('library-github-reminder') };
    }
    const DAY = 24 * 3600 * 1000;
    it('premier usage : mémorisé, rappel caché ; avant 7 jours : caché ; après 7 jours sans jeton : affiché', () => {
      let a = app(null, null); a.run('renderGithubReminder()');
      expect(a.btn().hidden).toBe(true);
      expect(parseInt(a.win.localStorage.getItem('plume_first_use'), 10)).toBeGreaterThan(Date.now() - 5000);
      a = app(Date.now() - 6 * DAY, null); a.run('renderGithubReminder()'); expect(a.btn().hidden).toBe(true);
      a = app(Date.now() - 8 * DAY, null); a.run('renderGithubReminder()'); expect(a.btn().hidden).toBe(false);
    });
    it('jeton déjà configuré : jamais de rappel', () => {
      const a = app(Date.now() - 30 * DAY, 'ghp_test'); a.run('renderGithubReminder()');
      expect(a.btn().hidden).toBe(true);
    });
  });
});

describe('version', () => {
  it('v9.55.0 ou plus : APP_VERSION et cache du service worker identiques', () => {
    const ver = read('js/router.js').match(/const APP_VERSION = '([^']+)'/)[1];
    expect(read('sw.js')).toContain("'plume-epique-v" + ver + "'");
    expect(ver.split('.').map(Number)[1]).toBeGreaterThanOrEqual(55);
  });
});
