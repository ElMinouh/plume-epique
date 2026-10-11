// ═══════════════════════════════════════════════════════
// LOT 5 « contours des champs » (v9.61.0, audit AUD-05-007) — WCAG 1.4.11 : contour d'un composant ≥ 3:1
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const css = read('css/style.css');

const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lum = h => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; const [r, g, b] = rgb(h); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (fg, bg, al) => '#' + rgb(fg).map((v, i) => Math.round(al * v + (1 - al) * rgb(bg)[i]).toString(16).padStart(2, '0')).join('');
const block = sel => css.match(new RegExp('(?:^|\\n)' + sel + ' \\{([\\s\\S]*?)\\n\\}'))[1];
const root = block(':root'), dark = block('body\\.dark-mode'), paper = block('body\\.paper-mode');
const hex = (b, n) => { const m = b.match(new RegExp('--' + n + ':\\s*(#[0-9a-fA-F]{6})\\b')); return m && m[1]; };
const val = (b, n) => hex(b, n) || hex(root, n);

describe('AUD-05-007 — --border-strong ≥ 3:1', () => {
  const themes = {
    clair: { b: root, ink: '#463820', al: 0.055, surf: ['#fbf8f1', '#ffffff', '#ebe4d5', '#f3eee3'] },
    papier: { b: paper, ink: '#3b2f1e', al: 0.06, surf: ['#faf5e8', '#fffbf0', '#e9dfc6', '#efe6d0'] },
    sombre: { b: dark, ink: '#ffffff', al: 0.07, surf: ['#1a2330', '#222d3d', '#0f151e', '#141b26'] },
  };
  for (const [nom, t] of Object.entries(themes)) {
    it(`thème ${nom} : contour des champs ≥ 3:1 sur chaque surface et sur le remplissage du champ`, () => {
      const c = hex(t.b, 'border-strong'); expect(c, 'jeton absent').toBeTruthy();
      for (const s of t.surf) {
        expect(ratio(c, s), `${c} sur ${s}`).toBeGreaterThanOrEqual(3);
        expect(ratio(c, mix(t.ink, s, t.al)), `${c} sur remplissage de ${s}`).toBeGreaterThanOrEqual(3);
      }
    });
  }
  it('les surfaces testées sont bien celles du CSS (garde contre une dérive des jetons)', () => {
    expect(val(root, 'glass')).toBe('#fbf8f1'); expect(val(dark, 'glass')).toBe('#1a2330'); expect(val(paper, 'glass')).toBe('#faf5e8');
    expect(val(dark, 'surface-2')).toBe('#222d3d');
  });
  it('les champs utilisent --border-strong ; --border reste aux séparateurs', () => {
    expect(css).toMatch(/\.field\{background:var\(--item-bg\);color:var\(--text\);border:1px solid var\(--border-strong\);/);
    expect(css).toMatch(/\.edit-box select\{[^}]*border:1px solid var\(--border-strong\)/);
    expect(css).toMatch(/\.gn-txtprops select\{[^}]*border:1\.5px solid var\(--border-strong\)/);
  });
  it('écran de connexion (toujours sombre) : contour #808c9c ≥ 3:1 sur son fond et sur le champ', () => {
    expect(css).toMatch(/\.gate-field\{[^}]*border:1px solid #808c9c/);
    for (const bg of ['#0f151e', '#141b26']) {
      expect(ratio('#808c9c', bg)).toBeGreaterThanOrEqual(3);
      expect(ratio('#808c9c', mix('#ffffff', bg, 0.07))).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('Version', () => {
  it('v9.61.0 ou plus : APP_VERSION et cache du service worker identiques', () => {
    const v = read('js/router.js').match(/const APP_VERSION = '([\d.]+)'/)[1];
    const c = read('sw.js').match(/const CACHE = 'plume-epique-v([\d.]+)'/)[1];
    expect(c).toBe(v);
    const [a, b] = v.split('.').map(Number);
    expect(a > 9 || (a === 9 && b >= 61)).toBe(true);
  });
});
