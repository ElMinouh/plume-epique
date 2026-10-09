// ═══════════════════════════════════════════════════════
// LOT 2 « jetons, rôles de couleur, boutons, états » (v9.50.0, audit AUD-04-029, 012, 005, 013, 006, 014)
// Garde-fous : un futur ajout qui sort de l'échelle (rayon, ombre, durée), qui réintroduit une couleur de bouton posée
// à la main ou une classe inexistante fait échouer ce test.
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const css = read('css/style.css');
const html = read('index.html');
const jsFiles = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'));
const js = Object.fromEntries(jsFiles.map(f => [f, read('js/' + f)]));
const allSources = html + '\n' + Object.values(js).join('\n');

const lum = hex => {
  const h = hex.replace('#', ''); const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const rootVar = (scope, name) => { const m = css.match(new RegExp(scope + '[^}]*?--' + name + ':\\s*(#[0-9a-fA-F]{6})')); if (!m) throw new Error(scope + ' --' + name); return m[1]; };

describe('AUD-04-012 — échelles de rayons, d\'ombres, de voiles et de durées', () => {
  it('chaque border-radius utilise l\'échelle (--r-1/2/3, pastille) ou une dérogation connue', () => {
    const bad = [];
    for (const m of css.matchAll(/border-radius:([^;}\n]+)[;}]/g)) {
      const v = m[1].trim();
      const ok = v.split(/\s+/).every(p => /^var\(--(r-[123]|radius-pill)\)$/.test(p) || ['0', '50%', 'inherit', '22px'].includes(p));
      if (!ok) bad.push(v);
    }
    expect(bad).toEqual([]);
  });
  it('chaque box-shadow est un niveau --elev-*, un anneau/halo/relief décoratif connu, ou « none »', () => {
    const bad = [];
    for (const m of css.matchAll(/box-shadow:([^;}\n]+)[;}]/g)) {
      const v = m[1].trim();
      const ok = /^var\(--elev-[1-4]\)$/.test(v) || v === 'none' || /^inset /.test(v) || /^0 0 0 (\d+|9999)px/.test(v) || /^0 0 8px /.test(v) || /^0 0 0 0 /.test(v) || /^0 -4px 14px /.test(v)
        || /^0 1px 2px /.test(v) || /^0 16px 36px /.test(v) || /^0 2px 6px rgba\(0,0,0,\.18\)$/.test(v) || /^0 0 0 \d+px/.test(v);
      if (!ok) bad.push(v);
    }
    expect(bad).toEqual([]);
  });
  it('un seul voile de modale (--scrim), plus de rgba(0,0,0,.5/.6/.7) devant un flou d\'arrière-plan', () => {
    expect(css).not.toMatch(/background:rgba\(0,0,0,\.[567]\);\s*backdrop-filter/);
    expect((css.match(/background:var\(--scrim\)/g) || []).length).toBeGreaterThanOrEqual(6);
  });
  it('toutes les durées de transition et d\'animation passent par --t-fast/base/slow (boucles d\'indicateur exceptées)', () => {
    const bad = [];
    for (const m of css.matchAll(/(transition|animation):([^;}\n]+)[;}]/g)) {
      const body = m[2].replace(/@media[\s\S]*/, '');
      if (/(?<![\w.-])\.?\d+(\.\d+)?m?s\b/.test(body.replace(/ease-in-out|infinite/g, '')) && !/^(bounce|pulse)/.test(body.trim())) bad.push(m[0]);
    }
    expect(bad).toEqual([]);
    for (const t of ['t-fast', 't-base', 't-slow']) expect(css).toContain('--' + t + ':');
  });
});

describe('AUD-04-029 — jetons qui disent vrai', () => {
  const defined = new Set([...css.matchAll(/(?:^|[\s,{>~+])\.((?:u|btn|legend)-[\w-]+)/gm)].map(m => m[1]));
  it('toute classe u-* utilisée dans le HTML ou les JS existe dans le CSS', () => {
    const used = new Set([...allSources.matchAll(/(?<![\w-])(u-[a-z0-9][\w-]*)/g)].map(m => m[1]));
    const missing = [...used].filter(c => !defined.has(c) && !css.includes('.' + c));
    expect(missing).toEqual([]);
  });
  it('plus de noms d\'utilitaires qui mentent (opacité, tailles, couleurs de fond par valeur hexadécimale, ombres par valeur)', () => {
    for (const bad of ['u-op-_35', 'u-op-_4', 'u-op-_5', 'u-op-_55', 'u-fs-_68rem', 'u-fs-_82rem', 'u-fs-12px', 'u-bg-h2980b9', 'u-bg-h7f8c8d', 'u-bg-h34495e', 'u-br-10px', 'u-shadow-0-'])
      expect(allSources + css, bad).not.toContain(bad);
    expect(css).not.toMatch(/--fs-12px|--radius-8px|--radius-10px|--radius-16px|--radius-20px/);
  });
  it('un seul jeu de couleurs de bouton : plus de --btn-*, --info, --confirm, --ghost, --warn-strong', () => {
    expect(css).not.toMatch(/--btn-(ghost|info|confirm|success|danger|warn|warn-strong):/);
    expect(css).not.toMatch(/--(info|confirm|ghost|warn-strong):/);
  });
});

describe('AUD-04-013 — système de boutons', () => {
  it('variantes de rôle définies : primaire (défaut), secondaire, discret, danger, alerte', () => {
    for (const v of ['.btn-secondary', '.btn-ghost', '.btn-danger', '.btn-warn']) expect(css).toContain(v + '{');
    expect(css).toMatch(/\.action-btn\{background:var\(--accent\);color:#fff;border:1px solid transparent;/);
  });
  it('plus de saut de 1 px au survol', () => {
    expect(css).not.toMatch(/\.action-btn:hover\{[^}]*translateY/);
  });
  it('aucun bouton .action-btn ne porte une couleur de fond posée à la main (HTML et gabarits JS)', () => {
    const tags = [...allSources.matchAll(/<button\b[^>]*>/g)].map(m => m[0]).filter(t => t.includes('action-btn'));
    expect(tags.length).toBeGreaterThan(80);
    expect(tags.filter(t => /u-bg-h[0-9a-f]{6}|u-bg-v-danger/.test(t))).toEqual([]);
  });
  it('au plus une couleur « action principale » par groupe de variantes : suppressions et restaurations ne partagent pas la teinte', () => {
    expect(js['library.js']).toMatch(/btn-danger btn-sm" data-conflict-delete=/);
    expect(js['notifications.js']).toContain("classList.toggle('btn-danger', !!danger)");
    expect(html).toMatch(/btn-danger btn-sm" id="history-restore-btn"/);
  });
});

describe('AUD-04-005 — rôles de couleur', () => {
  it('le danger a son propre jeton plein (≥ 4,5:1 avec du texte blanc) distinct de l\'accent', () => {
    expect(ratio('#ffffff', rootVar(':root', 'danger-solid'))).toBeGreaterThanOrEqual(4.5);
    expect(rootVar(':root', 'danger-solid').toLowerCase()).not.toBe(rootVar(':root', 'accent').toLowerCase());
  });
  it('--title (titres) ≥ 4,5:1 sur clair, papier et crème ; clair-sur-sombre ≥ 4,5:1 sur sombre et sur les modes immersifs', () => {
    const t = rootVar(':root', 'title');
    for (const bg of ['#ffffff', '#f4ecd8', '#fffceb']) expect(ratio(t, bg), bg).toBeGreaterThanOrEqual(4.5);
    expect(ratio(rootVar('body\\.dark-mode', 'title'), '#161623')).toBeGreaterThanOrEqual(4.5);
    expect(ratio(rootVar(':root', 'title-on-dark'), '#0a0a0f')).toBeGreaterThanOrEqual(4.5);
  });
  it('titre du manuscrit et du chapitre en couleur de titre, plus en accent', () => {
    expect(css).toContain('#document-title{font-size:1.02rem;font-weight:700;color:var(--title);');
    expect(html).toMatch(/u-c-title[^"]*" id="chapter-title"/);
  });
  it('état actif = fond teinté + contour (onglets, sous-onglets, filtres), plus d\'aplat plein d\'accent', () => {
    for (const sel of ['.tab-btn.active', '.subtab-btn.active', '.mode-indicator.active']) {
      const line = css.split('\n').find(l => l.startsWith(sel + '{'));
      expect(line, sel).toContain('color-mix(in srgb,var(--accent) 16%,var(--glass))');
      expect(line, sel).not.toMatch(/background:var\(--accent\)/);
    }
  });
});

describe('AUD-04-006 — barre d\'outils neutre', () => {
  it('aucun bouton de la barre d\'outils ne porte une couleur de fond propre', () => {
    const bar = html.slice(html.indexOf('<div class="toolbar" role="toolbar">'), html.indexOf('id="lex-tools-group"'));
    const btns = bar.match(/<button[^>]*>/g) || [];
    expect(btns.length).toBeGreaterThan(8);
    expect(btns.filter(b => /u-bg-/.test(b))).toEqual([]);
    expect(css).toContain('.toolbar .action-btn{background:transparent;');
  });
});

describe('AUD-04-014 — états d\'interaction', () => {
  it('anneau de focus clavier commun, sélection, texte indicatif, barres fines, color-scheme par thème, accent-color', () => {
    expect(css).toContain(':focus-visible{outline:2px solid var(--focus);outline-offset:2px;}');
    expect(css).toContain('::selection{');
    expect(css).toContain('::placeholder{');
    expect(css).toMatch(/\*\{scrollbar-width:thin;scrollbar-color:/);
    expect(css).toMatch(/body\.dark-mode \{[^}]*color-scheme:dark;/);
    expect(css).toMatch(/:root \{[\s\S]*?color-scheme:light;/);
    expect(css).toMatch(/accent-color:var\(--accent\)/);
    expect(css).toContain('.field:focus-visible{outline:2px solid var(--focus)');
  });
  it('l\'anneau de focus (--focus = --accent-text) est ≥ 3:1 sur fond clair, papier et sombre pour les 5 palettes', () => {
    const P = JSON.parse(JSON.stringify(eval('(' + read('js/database.js').match(/const ACCENT_PALETTES = (\{[\s\S]*?\n\});/)[1] + ')')));
    for (const [k, p] of Object.entries(P)) {
      expect(ratio(p.tl, '#ffffff'), k).toBeGreaterThanOrEqual(3);
      expect(ratio(p.td, '#161623'), k).toBeGreaterThanOrEqual(3);
    }
  });
  it('désactivé lisible (≥ .4), état :active défini pour boutons et cartes', () => {
    expect(css).toContain('.action-btn:disabled{opacity:.4;');
    expect(css).toContain('.action-btn:active{filter:brightness(.92);}');
    expect(css).toContain('.library-card:active');
  });
});

describe('version', () => {
  it('APP_VERSION et cache du service worker sont identiques', () => {
    const v = read('js/router.js').match(/const APP_VERSION = '([^']+)'/)[1];
    expect(read('sw.js')).toContain("'plume-epique-v" + v + "'");
  });
});
