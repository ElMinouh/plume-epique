// ═══════════════════════════════════════════════════════
// LOT 2 « fenêtres : retour du focus, noms, arrière-plan inerte, messages » (v9.58.0, audit AUD-05-003, 004, 016)
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html');
const notif = read('js/notifications.js');
const bloc = notif.slice(notif.indexOf('// ── FENÊTRES MODALES (début)'), notif.indexOf('// ── FENÊTRES MODALES (fin)'));

describe('AUD-05-004 — toute fenêtre modale a un nom', () => {
  it('index.html : chaque role="dialog" aria-modal="true" porte aria-label ou aria-labelledby', () => {
    const sans = [...html.matchAll(/<div id="([^"]+)"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*>/g)]
      .filter(m => !/aria-label(ledby)?=/.test(m[0])).map(m => m[1]);
    expect(sans).toEqual([]);
  });
});

describe('AUD-05-003 / 004 — comportement du gestionnaire central (jsdom)', () => {
  async function monde() {
    const dom = new JSDOM(`<body><header><button id="op">Ouvrir</button></header><main><button id="op2">Autre</button></main>
      <div id="dlg" role="dialog" aria-modal="true"><button id="in">Dans</button></div>
      <div id="dlg2" role="dialog" aria-modal="true"><button id="in2">Dans 2</button></div><div id="toast"></div></body>`,
      { runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    // jsdom ne fait pas de mise en page : une fenêtre est « visible » quand elle porte .active
    w.Element.prototype.getClientRects = function () { const d = this.closest('[role=dialog]'); return !d || d.classList.contains('active') ? [1] : []; };
    w.eval(bloc);
    await new Promise(r => w.setTimeout(r, 20));   // le gestionnaire s'initialise à DOMContentLoaded
    return w;
  }
  const attendre = w => new Promise(r => w.setTimeout(r, 20));
  const ouvrir = async (w, id, focusId, declencheur) => { if (declencheur) w.document.getElementById(declencheur).dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true })); const d = w.document.getElementById(id); d.classList.add('active'); w.document.getElementById(focusId).focus(); await attendre(w); };
  const fermer = async (w, id) => { w.document.getElementById(id).classList.remove('active'); await attendre(w); };

  it('le focus revient au déclencheur à la fermeture', async () => {
    const w = await monde(); const op = w.document.getElementById('op'); op.focus(); await attendre(w);
    await ouvrir(w, 'dlg', 'in', 'op');
    expect(w.document.activeElement.id).toBe('in');
    await fermer(w, 'dlg');
    expect(w.document.activeElement.id).toBe('op');
  });
  it('arrière-plan inerte pendant l\'ouverture, levé à la fermeture, message temporaire épargné', async () => {
    const w = await monde(); w.document.getElementById('op').focus(); await attendre(w);
    await ouvrir(w, 'dlg', 'in', 'op');
    const d = w.document;
    expect(d.querySelector('header').inert).toBe(true);
    expect(d.querySelector('main').inert).toBe(true);
    expect(d.getElementById('toast').inert).toBeFalsy();
    expect(d.getElementById('dlg').inert).toBeFalsy();
    await fermer(w, 'dlg');
    expect(d.querySelector('header').inert).toBeFalsy();
    expect(d.querySelector('main').inert).toBeFalsy();
  });
  it('fenêtres imbriquées : le focus revient d\'abord dans la première, puis au déclencheur', async () => {
    const w = await monde(); w.document.getElementById('op').focus(); await attendre(w);
    await ouvrir(w, 'dlg', 'in', 'op');
    await ouvrir(w, 'dlg2', 'in2', 'in');
    expect(w.document.getElementById('dlg').inert).toBe(true);
    await fermer(w, 'dlg2');
    expect(w.document.activeElement.id).toBe('in');
    expect(w.document.getElementById('dlg').inert).toBeFalsy();
    await fermer(w, 'dlg');
    expect(w.document.activeElement.id).toBe('op');
  });
});

describe('AUD-05-016 — messages temporaires', () => {
  it('le minuteur est suspendu aussi au focus clavier, et remis à zéro pour un message permanent', () => {
    expect(notif).toMatch(/el\.onfocusin = \(\) => \{ clearTimeout\(_toastTimer\); \}/);
    expect(notif).toMatch(/el\.onfocusout = arm/);
    expect(notif).toMatch(/if \(opts\.sticky\) \{ el\.onmouseenter = el\.onmouseleave = el\.onfocusin = el\.onfocusout = null; return; \}/);
  });
});

describe('Version', () => {
  it('v9.58.0 ou plus : APP_VERSION et cache du service worker identiques', () => {
    const v = read('js/router.js').match(/const APP_VERSION = '([\d.]+)'/)[1];
    const c = read('sw.js').match(/const CACHE = 'plume-epique-v([\d.]+)'/)[1];
    expect(c).toBe(v);
    const [a, b] = v.split('.').map(Number);
    expect(a > 9 || (a === 9 && b >= 58)).toBe(true);
  });
});
