// ════════════════════════════════════════════════════════════════════
// LOT C « lisibilité et mobile » (v9.43.0, audit AUD-03-002, 004, 005, 006, 032)
// Les contrastes sont CALCULÉS (formule WCAG) sur les valeurs réelles du CSS : un futur changement de
// couleur qui repasse sous 4,5:1 fait échouer ce test.
// ════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const css = read('css/style.css');

const lum = hex => {
  const h = hex.replace('#', ''); const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const cssVar = name => { const m = css.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})')); if (!m) throw new Error('variable absente : ' + name); return m[1]; };

describe('AUD-03-006 — contrastes', () => {
  it('chaque remplissage de bouton à texte blanc atteint 4,5:1', () => {
    for (const v of ['btn-ghost', 'btn-info', 'btn-confirm', 'btn-success', 'btn-danger', 'btn-warn-strong'])
      expect(ratio('#ffffff', cssVar(v)), v).toBeGreaterThanOrEqual(4.5);
    expect(ratio('#ffffff', cssVar('accent')), 'accent').toBeGreaterThanOrEqual(4.5);
    expect(ratio('#ffffff', cssVar('accent2')), 'accent2').toBeGreaterThanOrEqual(4.5);
  });
  it('les classes de fond utilisent ces remplissages (et plus les couleurs de texte claires)', () => {
    const map = { h16a085: 'btn-confirm', h27ae60: 'btn-success', h2980b9: 'btn-info', h7f8c8d: 'btn-ghost', hd35400: 'btn-warn-strong', he67e22: 'btn-warn-strong' };
    for (const [cls, v] of Object.entries(map))
      expect(css).toContain(`.u-bg-${cls}.u-bg-${cls}.u-bg-${cls}{background:var(--${v})}`);
    expect(css).toContain('.u-bg-v-danger.u-bg-v-danger.u-bg-v-danger{background:var(--btn-danger)}');
  });
  it('le rouge d\'accent en texte sur le thème sombre atteint 4,5:1 (fond #161623)', () => {
    const m = css.match(/body\.dark-mode \{\s*--accent-text:(#[0-9a-fA-F]{6})/);
    expect(m).not.toBeNull();
    expect(ratio(m[1], '#161623')).toBeGreaterThanOrEqual(4.5);
  });
  it('le texte secondaire (--text-muted) atteint 4,5:1 sur le fond de chaque thème, y compris sous la pastille', () => {
    const muted = sel => { const m = css.match(new RegExp(sel + ' \{[^}]*--text-muted:(#[0-9a-fA-F]{3,6})')); if (!m) return null; const h = m[1].slice(1); return '#' + (h.length === 3 ? [...h].map(c => c + c).join('') : h); };
    expect(ratio(muted('body\.paper-mode'), '#f4ecd8')).toBeGreaterThanOrEqual(4.5);
    // pastille ⓘ du thème papier : fond = papier assombri de 6 % (rgba(59,47,30,.06)) ≈ #e9e1ce
    expect(ratio(muted('body\.paper-mode'), '#e9e1ce')).toBeGreaterThanOrEqual(4.5);
    expect(ratio(muted('body\.dark-mode'), '#161623')).toBeGreaterThanOrEqual(4.5);
    expect(ratio(cssVar('text-muted'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
  it('les textes grisés par opacité restent lisibles (≥ .72), sauf le séparateur décoratif .u-op-_3', () => {
    for (const k of ['_35', '_4', '_45', '_5', '_55', '_6']) {
      const m = css.match(new RegExp('\\.u-op-' + k + '\\{opacity:(\\.?[0-9.]+)\\}'));
      expect(parseFloat(m[1]), k).toBeGreaterThanOrEqual(0.72);
    }
  });
});

describe('AUD-03-004 — taille du texte', () => {
  it('plancher typographique relevé (≥ 12,4 px à 16 px de base)', () => {
    const val = n => parseFloat(css.match(new RegExp('--fs-' + n + ':\\s*(\\.[0-9]+)rem'))[1]) * 16;
    expect(val('xs')).toBeGreaterThanOrEqual(12.4);
    expect(val('sm')).toBeGreaterThanOrEqual(13);
    expect(val('base')).toBeGreaterThanOrEqual(14);
  });
  it('le réglage « Taille de l\'interface » existe (Config) et agit sur la taille racine', () => {
    const html = read('index.html');
    expect(html).toContain('id="uiscale-picker"');
    for (const k of ['normal', 'grand', 'tres-grand']) expect(html).toContain(`data-scale="${k}"`);
    const dom = new JSDOM('<body><div id="uiscale-picker"><button class="mode-indicator" data-scale="normal"></button><button class="mode-indicator" data-scale="grand"></button></div></body>', { runScripts: 'outside-only', url: 'http://localhost/' });
    const win = dom.window; const ctx = dom.getInternalVMContext();
    new vm.Script(read('js/notifications.js')).runInContext(ctx);
    const run = c => new vm.Script(c).runInContext(ctx);
    expect(win.document.documentElement.style.fontSize).toBe('');
    run("selectUiScale('grand')");
    expect(win.document.documentElement.style.fontSize).toBe('112%');
    expect(win.localStorage.getItem('plume_ui_scale')).toBe('grand');
    expect(win.document.querySelector('[data-scale=grand]').classList.contains('active')).toBe(true);
    run("selectUiScale('tres-grand')");
    expect(win.document.documentElement.style.fontSize).toBe('125%');
    run("selectUiScale('normal')");
    expect(win.document.documentElement.style.fontSize).toBe('');
    // valeur inconnue en stockage : retombe sur « normal »
    win.localStorage.setItem('plume_ui_scale', 'n_importe_quoi');
    expect(run('loadUiScale()')).toBe('normal');
  });
});

describe('AUD-03-005 — cibles de clic', () => {
  it('plancher 24 px à la souris, 44 px au toucher, ⓘ agrandis, boutons de page écartés', () => {
    expect(css).toContain('.action-btn,.mode-indicator,.subtab-btn,.tab-btn,.toolbar-dropdown-btn,#toolbar-library-btn,#shortcuts-hint-btn{min-height:24px;min-width:24px;}');
    expect(css).toMatch(/@media \(pointer:coarse\)\{\s*\.action-btn,\.mode-indicator,\.subtab-btn,\.tab-btn,\.toolbar-dropdown-btn,#toolbar-library-btn,#shortcuts-hint-btn,#chapter-status-sel\{min-height:44px;min-width:44px;\}/);
    expect(css).toContain('.contextual-help-icon{width:24px;height:24px;');
    expect(css).toContain('.gn-pg-dup{top:2px;right:32px;}');
  });
});

describe('AUD-03-002 — débordement horizontal mobile', () => {
  it('la grille mobile est minmax(0,1fr) et l\'éditeur peut rétrécir', () => {
    expect(css).toContain('main{grid-template-columns:minmax(0,1fr);height:auto;align-content:start;}');
    expect(css).toContain('#editor-wrapper,#chapter-sidebar{min-width:0;max-width:100%;}');
  });
});

describe('AUD-03-032 — animations réduites', () => {
  it('le réglage système coupe animations et transitions', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion:reduce\)\{[\s\S]*animation-duration:\.01ms!important[\s\S]*transition-duration:\.01ms!important/);
  });
});
