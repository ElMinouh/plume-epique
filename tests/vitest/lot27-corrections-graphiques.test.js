// ═══════════════════════════════════════════════════════
// LOT 1 « corrections graphiques ciblées » (v9.49.0, audit AUD-04-004, 008, 009, 010, 021)
// Les contrastes sont CALCULÉS (formule WCAG) sur les valeurs réelles du CSS et des palettes : un futur changement
// qui repasse sous 4,5:1 fait échouer ce test.
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const css = read('css/style.css');
const html = read('index.html');
const lib = read('js/library.js');
const dbjs = read('js/database.js');

const lum = hex => {
  const h = hex.replace('#', ''); const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const WHITE = '#ffffff', PAPER = '#f4ecd8', DARK = '#161623';
const evalConst = (src, name) => vm.runInNewContext(src.match(new RegExp('const ' + name + ' = \\{[\\s\\S]*?\\n\\};'))[0].replace('const ' + name, name) + '; ' + name);

describe('AUD-04-004 — vue Fiches : le fond de statut ne vaut que pour la pastille', () => {
  it('aucune règle .ch-status-* ne pose de fond sur autre chose que .ch-status-dot', () => {
    const bad = css.split('\n').filter(l => /^\.ch-status-(draft|review|final)\{[^}]*background:/.test(l));
    expect(bad).toEqual([]);
    expect(css).toContain('.ch-status-dot.ch-status-draft{background:');
    expect(css).toContain('.card.ch-status-draft{border-top-color:');
  });
  it('texte des cartes ≥ 4,5:1 sur le fond crème', () => {
    expect(ratio('#6b6b5e', '#fffceb')).toBeGreaterThanOrEqual(4.5);
    expect(ratio('#5c5c52', '#fffceb')).toBeGreaterThanOrEqual(4.5);
    expect(css).toContain('.card-num{font-size:var(--fs-xs);color:#6b6b5e;');
  });
});

describe('AUD-04-008 — textes colorés', () => {
  it('les textes d\'accent utilisent --accent-text, pas --accent', () => {
    for (const sel of ['#writer h3,#focus-writer h3', '.stat-card .stat-val', '.search-result-item .sr-chapter', '#lex-panel-title',
      '.reading-chapter h2', '.tl-card strong', '.analytics-card .av', '.flesch-score', '.library-new-icon']) {
      const line = css.split('\n').find(l => l.startsWith(sel));
      expect(line, sel).toBeTruthy();
      expect(line, sel).toContain('color:var(--accent-text)');
    }
  });
  it('jetons de texte de succès / danger ≥ 4,5:1 sur clair, papier et sombre', () => {
    const v = (scope, name) => css.match(new RegExp(scope + '[^}]*--' + name + ':(#[0-9a-f]{6})'))[1];
    for (const n of ['success-text', 'danger-text']) {
      expect(ratio(v(':root', n), WHITE), n).toBeGreaterThanOrEqual(4.5);
      expect(ratio(v(':root', n), PAPER), n + ' papier').toBeGreaterThanOrEqual(4.5);
      expect(ratio(v('body.dark-mode', n), DARK), n + ' sombre').toBeGreaterThanOrEqual(4.5);
    }
  });
  it('gris de métadonnées du roman graphique et de la connexion ≥ 4,5:1', () => {
    expect(ratio('#6f6044', PAPER)).toBeGreaterThanOrEqual(4.5);
    expect(ratio('#8a8598', '#12121f')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('AUD-04-009 — palettes d\'accent', () => {
  const P = evalConst(dbjs, 'ACCENT_PALETTES');
  it('chaque palette : boutons, second accent et texte d\'accent ≥ 4,5:1 sur les trois thèmes', () => {
    expect(Object.keys(P).length).toBe(5);
    for (const [k, p] of Object.entries(P)) {
      expect(ratio(WHITE, p.a), k + ' a').toBeGreaterThanOrEqual(4.5);
      expect(ratio(WHITE, p.b), k + ' b').toBeGreaterThanOrEqual(4.5);
      expect(ratio(p.tl, WHITE), k + ' texte clair').toBeGreaterThanOrEqual(4.5);
      expect(ratio(p.tl, PAPER), k + ' texte papier').toBeGreaterThanOrEqual(4.5);
      expect(ratio(p.td, DARK), k + ' texte sombre').toBeGreaterThanOrEqual(4.5);
    }
  });
  it('les pastilles du sélecteur montrent exactement les couleurs appliquées', () => {
    for (const [k, p] of Object.entries(P)) {
      expect(css, k).toContain(`.palette-swatch[data-palette="${k}"] span:first-child{background:${p.a};}`);
      expect(css, k).toContain(`.palette-swatch[data-palette="${k}"] span:last-child{background:${p.b};}`);
    }
  });
  it('applyAccentPalette pose les variables de texte d\'accent par thème', () => {
    expect(dbjs).toContain("--accent-text-light', p.tl");
    expect(dbjs).toContain("--accent-text-dark', p.td");
    expect(css).toContain('--accent-text:var(--accent-text-dark,#ec6a58)');
  });
});

describe('AUD-04-010 — couvertures', () => {
  it('chaque arrêt de dégradé des 20 couvertures atteint 4,5:1 avec le texte blanc', () => {
    const C = evalConst(lib, 'COVER_PALETTES');
    expect(Object.keys(C).length).toBe(20);
    for (const [k, c] of Object.entries(C)) {
      expect(ratio(WHITE, c.a), k + ' a').toBeGreaterThanOrEqual(4.5);
      expect(ratio(WHITE, c.b), k + ' b').toBeGreaterThanOrEqual(4.5);
    }
  });
  it('le CSS des couvertures (grille, étagère, pastilles, cartes Univers) n\'utilise plus aucun arrêt trop clair', () => {
    const lines = css.split('\n').filter(l => /cover-|uni-card-c\d|u-bg-linear-gradient-135deg-h/.test(l) && l.includes('gradient'));
    expect(lines.length).toBeGreaterThan(40);
    for (const l of lines) for (const h of l.match(/#[0-9a-f]{6}/g) || []) expect(ratio(WHITE, h), l.slice(0, 50) + ' ' + h).toBeGreaterThanOrEqual(4.5);
  });
});

describe('AUD-04-021 — bouton Bibliothèque de la barre mobile', () => {
  it('le bouton porte les classes de bouton de l\'application (plus de bouton natif)', () => {
    const tag = html.match(/<button[^>]*id="toolbar-library-btn"[^>]*>/)[0];
    expect(tag).toContain('action-btn');
  });
  it('l\'ascenseur de la barre d\'outils défilante est masqué', () => {
    expect(css).toMatch(/@media \(max-width:768px\)\{\s*\.toolbar\{scrollbar-width:none;\}/);
  });
});

describe('version', () => {
  it('APP_VERSION et le cache du service worker sont identiques (9.49.0)', () => {
    const v = read('js/router.js').match(/const APP_VERSION = '([^']+)'/)[1];
    expect(v).toBe('9.49.0');
    expect(read('sw.js')).toContain("'plume-epique-v" + v + "'");
  });
});
