// ═══════════════════════════════════════════════════════
// v9.63.1 (hors lot, signalé par l'utilisateur) — barre d'outils épinglée sur mobile : plus de saut, fond opaque
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const css = read('css/style.css'), router = read('js/router.js');

describe('Barre d\'outils épinglée (mobile)', () => {
  it('la place de la barre est réservée par une marge de la sentinelle, jamais par un padding de #editor-wrapper', () => {
    // un padding-top sur le conteneur poussait la sentinelle de 64 px : désépinglage, remontée, nouvel épinglage… (boucle)
    expect(css).not.toMatch(/#editor-wrapper\.toolbar-fixed-active\s*\{[^}]*padding-top/);
    expect(css).toMatch(/#editor-wrapper\.toolbar-fixed-active #toolbar-sentinel\{margin-bottom:var\(--toolbar-h,64px\);\}/);
  });
  it('la hauteur réservée est mesurée avant de sortir la barre du flux', () => {
    const i = router.indexOf('function initToolbarPin()');
    const bloc = router.slice(i, router.indexOf('function initToolbarDropdowns()'));
    expect(bloc).toContain("wrapper.style.setProperty('--toolbar-h'");
    expect(bloc.indexOf("setProperty('--toolbar-h'")).toBeLessThan(bloc.indexOf("toolbar.classList.toggle('toolbar-fixed', pinned)"));
  });
  it('épinglée, la barre a un fond opaque (le texte ne doit pas se voir à travers)', () => {
    expect(css).toMatch(/\.toolbar\.toolbar-fixed\{background:var\(--surface-2\);\}/);
    // --surface-2 est opaque dans chaque thème
    for (const m of css.matchAll(/--surface-2:\s*([^;]+);/g)) expect(m[1].trim()).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

describe('Version', () => {
  it('v9.63.1 ou plus : APP_VERSION et cache du service worker identiques', () => {
    const v = router.match(/const APP_VERSION = '([\d.]+)'/)[1];
    const c = read('sw.js').match(/const CACHE = 'plume-epique-v([\d.]+)'/)[1];
    expect(c).toBe(v);
    const [a, b, p] = v.split('.').map(Number);
    expect(a > 9 || (a === 9 && (b > 63 || (b === 63 && p >= 1)))).toBe(true);
  });
});
