// ═══════════════════════════════════════════════════════
// LOT 4 « roman graphique : pages au clavier, texte alternatif » (v9.60.0, audit AUD-05-010, 011)
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const gn = read('js/graphicnovel.js'), css = read('css/style.css');

describe('AUD-05-010 — pages du roman graphique au clavier', () => {
  it('chaque vignette a un bouton de sélection nommé, avec la page courante signalée', () => {
    expect(gn).toMatch(/<button class="gn-pg-num gn-pg-select" data-idx="\$\{i\}" aria-label="Page \$\{i\+1\} sur/);
    expect(gn).toMatch(/aria-current="\$\{i===_gnActivePage\?'page':'false'\}"/);
  });
  it('Alt+↑ / Alt+↓ déplacent la page et le focus suit', () => {
    expect(gn).toMatch(/function gnWirePageKeyboard\(\)/);
    expect(gn).toMatch(/e\.altKey \|\| \(e\.key !== 'ArrowUp' && e\.key !== 'ArrowDown'\)/);
    expect(gn).toMatch(/_gnPendingPageFocus = \{ idx: to, kind: 'gn-pg-select' \}/);
    expect(gn).toMatch(/gnWirePageDragReorder\(\);\n  gnWirePageTouchDragReorder\(\);\n  gnWirePageKeyboard\(\);/);
  });
  it('monter/descendre visibles au survol et au focus, plus seulement au tactile', () => {
    expect(css).toMatch(/\.gn-pg-thumb:hover \.gn-pg-move,\.gn-pg-thumb:focus-within \.gn-pg-move\{display:flex;/);
    expect(css).toMatch(/focus-within \.gn-pg-del,\.gn-pg-thumb:focus-within \.gn-pg-dup\{opacity:1;\}/);
  });
});

describe('AUD-05-011 — texte alternatif des images', () => {
  it('le rendu applique el.alt (par la propriété DOM) et ne force plus alt vide', () => {
    expect(gn).toMatch(/imgEl\.alt = el\.alt \|\| ''/);
  });
  it('gnPageAltText décrit une page exportée : numéro + alts des images + texte des bulles', () => {
    const src = gn.slice(gn.indexOf('function gnPageAltText'), gn.indexOf('async function gnExportBookEpub'));
    const f = vm.runInNewContext(src + '; gnPageAltText');
    expect(f({ elements: [] }, 3)).toBe('Page 3');
    expect(f({ elements: [{ type: 'image', alt: 'Un chat sur un toit' }, { type: 'text', content: ' Miaou ' }, { type: 'image' }] }, 1))
      .toBe('Page 1 : Un chat sur un toit — Miaou');
    expect(f({ elements: [{ type: 'text', content: 'x'.repeat(2000) }] }, 2).length).toBe(1000);
  });
  it('l\'EPUB utilise cette description, échappée', () => {
    expect(gn).toMatch(/alt="\$\{escapeXml\(gnPageAltText\(db\.pages\[i\], num\)\)\}"/);
  });
});

describe('Version', () => {
  it('v9.60.0 ou plus : APP_VERSION et cache du service worker identiques', () => {
    const v = read('js/router.js').match(/const APP_VERSION = '([\d.]+)'/)[1];
    const c = read('sw.js').match(/const CACHE = 'plume-epique-v([\d.]+)'/)[1];
    expect(c).toBe(v);
    const [a, b] = v.split('.').map(Number);
    expect(a > 9 || (a === 9 && b >= 60)).toBe(true);
  });
});
