// ═══════════════════════════════════════════════════════
// LOT 3 « états ARIA, annonces, structure » (v9.59.0, audit AUD-05-005, 012, 006)
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html'), css = read('css/style.css'), notif = read('js/notifications.js');
const bloc = notif.slice(notif.indexOf('// ── ÉTATS ARIA ET LIEN D\'ÉVITEMENT (début)'), notif.indexOf('// ── ÉTATS ARIA ET LIEN D\'ÉVITEMENT (fin)'));

describe('AUD-05-005 — état des sélecteurs de réglages', () => {
  it('conteneurs nommés : police en radiogroup, palette et thème en group', () => {
    expect(html).toMatch(/id="font-picker" role="radiogroup" aria-label="/);
    expect(html).toMatch(/id="palette-picker" role="group" aria-label="/);
    expect(html).toMatch(/id="theme-picker" role="group" aria-label="/);
  });
  it('la classe .active est recopiée dans aria-pressed / aria-checked (jsdom)', async () => {
    const dom = new JSDOM(`<body><div id="font-picker"><div class="font-option active" role="radio"></div><div class="font-option" role="radio"></div></div>
      <div id="theme-picker"><button class="mode-indicator active"></button><button class="mode-indicator"></button></div>
      <div class="ch-view-toggle"><button class="mode-indicator active"></button><button class="mode-indicator"></button></div>
      <button class="mode-indicator" id="autre"></button></body>`, { runScripts: 'outside-only' });
    const w = dom.window, d = w.document; w.eval(bloc);
    await new Promise(r => w.setTimeout(r, 20));
    const [f1, f2] = d.querySelectorAll('.font-option'), [t1, t2] = d.querySelectorAll('#theme-picker button');
    expect(f1.getAttribute('aria-checked')).toBe('true'); expect(f2.getAttribute('aria-checked')).toBe('false');
    expect(t1.getAttribute('aria-pressed')).toBe('true'); expect(t2.getAttribute('aria-pressed')).toBe('false');
    t1.classList.remove('active'); t2.classList.add('active'); f2.classList.add('active'); f1.classList.remove('active');
    await new Promise(r => w.setTimeout(r, 20));
    expect(t1.getAttribute('aria-pressed')).toBe('false'); expect(t2.getAttribute('aria-pressed')).toBe('true');
    expect(f2.getAttribute('aria-checked')).toBe('true'); expect(f1.getAttribute('aria-checked')).toBe('false');
    expect(d.getElementById('autre').hasAttribute('aria-pressed')).toBe(false);   // un bouton ordinaire n'est pas une bascule
  });
});

describe('AUD-05-012 — annonces', () => {
  it('nombre de résultats de recherche et état de synchro sont des régions role="status"', () => {
    expect(html).toMatch(/id="search-count" role="status"/);
    expect(html).toMatch(/id="sync-status-label" role="status"/);
  });
});

describe('AUD-05-006 — structure et lien d\'évitement', () => {
  it('lien « Aller au contenu » en tête de page, style masqué hors focus', () => {
    expect(html).toMatch(/<body>\s*<a href="#" id="skip-link" class="skip-link">Aller au contenu<\/a>/);
    expect(css).toMatch(/\.skip-link:focus\{transform:none;\}/);
    expect(css).toMatch(/\.u-sr-only\{position:absolute;/);
  });
  it('un titre de niveau 1 par écran : connexion, bibliothèque, éditeur, roman graphique', () => {
    expect((read('js/profiles.js').match(/class="gate-title" role="heading" aria-level="1"/g) || []).length).toBe(7);
    expect(html).toMatch(/<h2 class="u-m-18px-0-2px" aria-level="1">/);
    expect(html).toMatch(/<main role="main">\n  <h1 class="u-sr-only">/);
    expect(read('js/graphicnovel.js')).toMatch(/<h1 class="u-sr-only">Roman graphique<\/h1>/);
  });
  it('sections de l\'éditeur titrées (h2) : chapitres, texte, volet latéral', () => {
    for (const t of ['Chapitres', 'Texte du chapitre', 'Volet latéral']) expect(html).toContain(`<h2 class="u-sr-only">${t}</h2>`);
  });
  it('le lien d\'évitement donne le focus au h1 de l\'écran affiché (jsdom)', async () => {
    const dom = new JSDOM(`<body><a href="#" id="skip-link">Aller</a><div id="library-screen"><h2 aria-level="1" id="b">Biblio</h2></div><main><h1 id="m">Main</h1></main></body>`, { runScripts: 'outside-only' });
    const w = dom.window; w.Element.prototype.getClientRects = function () { return this.closest('main') ? [] : [1]; };   // bibliothèque affichée, éditeur masqué
    w.eval(bloc); await new Promise(r => w.setTimeout(r, 20));
    w.document.getElementById('skip-link').click();
    expect(w.document.activeElement.id).toBe('b');
  });
});

describe('Version', () => {
  it('v9.59.0 ou plus : APP_VERSION et cache du service worker identiques', () => {
    const v = read('js/router.js').match(/const APP_VERSION = '([\d.]+)'/)[1];
    const c = read('sw.js').match(/const CACHE = 'plume-epique-v([\d.]+)'/)[1];
    expect(c).toBe(v);
    const [a, b] = v.split('.').map(Number);
    expect(a > 9 || (a === 9 && b >= 59)).toBe(true);
  });
});
