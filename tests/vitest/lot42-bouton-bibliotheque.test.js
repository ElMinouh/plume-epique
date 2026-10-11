// ═══════════════════════════════════════════════════════
// v9.63.2 (hors lot, demandé par l'utilisateur) — bouton « Bibliothèque » de la barre d'outils mobile : icône centrée, or discret
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

describe('Bouton Bibliothèque (barre d\'outils mobile)', () => {
  it('icône centrée dans le carré tactile', () => {
    expect(css).toMatch(/\.toolbar #toolbar-library-btn\{align-items:center;justify-content:center;color:var\(--title\);/);
  });
  it('or de repère discret : fond et contour mélangés à la surface, survol un peu plus marqué', () => {
    expect(css).toContain('background:color-mix(in srgb,var(--title) 14%,var(--glass));border-color:color-mix(in srgb,var(--title) 50%,transparent);');
    expect(css).toContain('.toolbar #toolbar-library-btn:hover{background:color-mix(in srgb,var(--title) 22%,var(--glass));border-color:var(--title);}');
  });
  for (const [nom, b] of [['clair', root], ['sombre', dark], ['papier', paper]]) {
    it(`thème ${nom} : l'icône en or reste ≥ 4,5:1 au repos et ≥ 3:1 au survol sur son fond teinté ; contour discret mais perceptible`, () => {
      const t = val(b, 'title'), glass = val(b, 'glass');
      expect(ratio(t, mix(t, glass, 0.14)), 'repos').toBeGreaterThanOrEqual(4.5);
      expect(ratio(t, mix(t, glass, 0.22)), 'survol (icône = composant non textuel : 3:1 exigé)').toBeGreaterThanOrEqual(3);
      // contour à 50 % de la couleur or sur la surface de la barre
      expect(ratio(mix(t, glass, 0.5), glass)).toBeGreaterThanOrEqual(1.8);   // discret par choix : le bouton se repère par son fond et son icône
    });
  }
});

describe('Version', () => {
  it('v9.63.2 ou plus : APP_VERSION et cache du service worker identiques', () => {
    const v = read('js/router.js').match(/const APP_VERSION = '([\d.]+)'/)[1];
    const c = read('sw.js').match(/const CACHE = 'plume-epique-v([\d.]+)'/)[1];
    expect(c).toBe(v);
    const [a, b, p] = v.split('.').map(Number);
    expect(a > 9 || (a === 9 && (b > 63 || (b === 63 && p >= 2)))).toBe(true);
  });
});
