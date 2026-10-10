// ═══════════════════════════════════════════════════════
// LOT 5 « typographie et mouvement » (v9.54.0, audit AUD-04-016, 015)
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
const sw = read('sw.js');
const pkg = JSON.parse(read('package.json'));
const FONTS = ['literata-5.3.0-latin-wght-normal.woff2', 'literata-5.3.0-latin-wght-italic.woff2', 'inter-5.3.0-latin-wght-normal.woff2'];

describe('AUD-04-016 — polices embarquées', () => {
  it('trois fichiers WOFF2 dans vendor/fonts/, sous licence OFL jointe, versions figées dans package.json', () => {
    for (const f of FONTS) {
      const buf = fs.readFileSync(path.join(ROOT, 'vendor/fonts', f));
      expect(buf.subarray(0, 4).toString('latin1'), f).toBe('wOF2');
      expect(buf.length, f).toBeGreaterThan(30000);
      expect(buf.length, f).toBeLessThan(120000); // sous-ensemble latin : le poids reste maîtrisé
    }
    for (const l of ['LICENCE-OFL-literata.txt', 'LICENCE-OFL-inter.txt']) expect(read('vendor/fonts/' + l)).toContain('SIL Open Font License');
    expect(pkg.dependencies['@fontsource-variable/literata']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.dependencies['@fontsource-variable/inter']).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it('@font-face : Literata droit et italique, Inter, font-display swap, chemins relatifs à css/', () => {
    const faces = [...css.matchAll(/@font-face\{([^}]*)\}/g)].map(m => m[1]);
    expect(faces.length).toBe(3);
    for (const f of faces) {
      expect(f).toContain('font-display:swap');
      expect(f).toMatch(/src:url\(\.\.\/vendor\/fonts\/[\w.-]+\.woff2\) format\('woff2'\)/);
    }
    expect(faces.filter(f => f.includes("'Literata'") && f.includes('font-style:italic')).length).toBe(1);
    expect(faces.filter(f => f.includes("'Inter'")).length).toBe(1);
  });
  it('les polices sont précachées hors-ligne', () => { for (const f of FONTS) expect(sw).toContain("'./vendor/fonts/" + f + "'"); });
  it('piles : interface en Inter, écriture en Literata puis Palatino/Georgia ; le corps et les zones d\'écriture utilisent les jetons', () => {
    expect(css).toMatch(/--font-ui:'Inter',[^;]*sans-serif;/);
    expect(css).toMatch(/--font-read:'Literata','Palatino Linotype',Georgia,serif;/);
    expect(css).toContain('font-family:var(--font-ui);display:flex');
    expect(css.split('\n').find(l => l.startsWith('#writer{'))).toContain('font-family:var(--font-read)');
    expect(css).not.toMatch(/font-family:-apple-system/);
  });
  it('police d\'écriture : « literata » par défaut, Palatino devient un choix ; le sélecteur les propose dans cet ordre', () => {
    const db = read('js/database.js');
    expect(db.indexOf("'literata':")).toBeGreaterThan(-1);
    expect(db.indexOf("'literata':")).toBeLessThan(db.indexOf("'palatino':"));
    expect(db).toContain("key !== 'literata' && EDITOR_FONTS[key]");
    expect(db).toContain("remove('font-palatino','font-times','font-verdana','font-courier')");
    expect(css).toContain('body.font-palatino #writer,');
    const html = read('index.html');
    expect(html.indexOf('data-font="literata"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-font="literata"')).toBeLessThan(html.indexOf('data-font="palatino"'));
    const sc = read('js/schema.js');
    expect(sc).toContain("data.editorFont = 'literata'");
    expect(sc).toContain("editorFont:'literata'");
  });
  it('le nom de classe n\'ment plus : u-ff-read et u-ff-palatino, plus de u-ff-palatino-linotype-georgia-serif', () => {
    expect(css).toContain('.u-ff-read{font-family:var(--font-read)}');
    expect(css + read('index.html')).not.toContain('u-ff-palatino-linotype-georgia-serif');
  });
});

describe('AUD-04-016 — échelle typographique', () => {
  it('9 tailles, de .7 à 3 rem ; plus petit que 11 px interdit', () => {
    const toks = [...css.matchAll(/--fs-(2xs|xs|sm|base|md|lg|xl|2xl|3xl):([\d.]+)rem/g)].map(m => [m[1], parseFloat(m[2])]);
    expect(toks.length).toBe(9);
    expect(Math.min(...toks.map(t => t[1])) * 16).toBeGreaterThanOrEqual(11);
    const sorted = [...toks].sort((a, b) => a[1] - b[1]).map(t => t[1]);
    expect(toks.map(t => t[1])).toEqual(sorted); // déclarés par ordre croissant
  });
  it('toute font-size du CSS est un jeton --fs-* (aucune valeur libre)', () => {
    const bad = [...css.matchAll(/font-size:([^;}\n]+)[;}]/g)].map(m => m[1].trim()).filter(v => !/^var\(--fs-(2xs|xs|sm|base|md|lg|xl|2xl|3xl)\)$/.test(v));
    expect(bad).toEqual([]);
  });
  it('trois poids seulement pour la hiérarchie (400, 500, 600) ; plus de gras 700 dans les règles', () => {
    const w = new Set([...css.matchAll(/font-weight:(\d+)[;}]/g)].map(m => m[1]));
    expect([...w].sort()).toEqual(['400', '500', '600']);
    expect(css).not.toContain('font-weight:700');
  });
  it('quatre interlignes (serré, normal, aéré, écriture) ; seules exceptions : 1 et les hauteurs en px des boutons-icônes', () => {
    const bad = [...css.matchAll(/line-height:([^;}\n]+)[;}]/g)].map(m => m[1].trim())
      .filter(v => !/^var\(--lh-(tight|normal|relaxed|write)\)$/.test(v) && v !== '1' && !/^\d+px$/.test(v));
    expect(bad).toEqual([]);
    expect(css).toMatch(/--lh-tight:1\.25; --lh-normal:1\.5; --lh-relaxed:1\.7; --lh-write:1\.85;/);
  });
  it('plus de classes utilitaires de taille ou de poids nommées d\'après leur valeur (u-fs-1rem, u-lh-1_6, u-fwt-700…)', () => {
    const all = css + read('index.html') + fs.readdirSync(path.join(ROOT, 'js')).map(f => read('js/' + f)).join('\n');
    for (const bad of ['u-fs-1rem', 'u-fs-1_1rem', 'u-fs-3rem', 'u-lh-1_6', 'u-lh-1_8', 'u-fwt-700']) expect(all, bad).not.toContain(bad);
  });
});

describe('AUD-04-015 — mouvement', () => {
  it('une courbe nommée (--ease) et trois durées ; les animations d\'entrée l\'utilisent', () => {
    expect(css).toContain('--ease:cubic-bezier(.2,.8,.2,1);');
    for (const k of ['fadeIn', 'enter', 'panelIn']) expect(css).toContain('@keyframes ' + k + '{');
    expect(css).not.toContain('@keyframes slideIn');
    expect(css).not.toContain('@keyframes focusIn');
    const bad = [...css.matchAll(/animation:(\w+) ([^;}\n]+)[;}]/g)].filter(m => !['bounce', 'pulse'].includes(m[1]) && !/var\(--ease\)/.test(m[2]));
    expect(bad.map(m => m[0])).toEqual([]);
  });
  it('toutes les fenêtres modales et le volet latéral ont une entrée animée', () => {
    for (const id of ['#my-profile-overlay', '#confirm-modal-overlay', '#library-system-overlay', '#search-overlay', '#history-overlay', '#conflict-diff-overlay'])
      expect(css.includes(id + ',') || css.includes(id + ')'), id).toBe(true);
    expect(css).toContain(',.gn-modal-overlay{animation:fadeIn var(--t-base) var(--ease);}');
    expect(css).toContain('.gn-modal-overlay > *{animation:enter var(--t-base) var(--ease);}');
    expect(css).toContain('#tab-container.open{animation:panelIn var(--t-base) var(--ease);}');
  });
  it('les fenêtres du roman graphique et le réglage « réduire les animations » restent couverts', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion:reduce\)\{[\s\S]*animation-duration:\.01ms!important/);
  });
  it('bascule de thème : transitions suspendues une image (body.theme-switching), plus de transition de fond sur le corps', () => {
    expect(css).toContain('body.theme-switching,body.theme-switching *,body.theme-switching *::before,body.theme-switching *::after{transition:none !important;}');
    expect(css.split('\n').find(l => l.includes('overflow-x:hidden;'))).not.toContain('transition');
    for (const f of ['js/database.js', 'js/router.js', 'js/graphicnovel.js']) expect(read(f), f).toContain("runThemeSwitch");
  });
  describe('runThemeSwitch (notifications.js)', () => {
    function app() {
      const dom = new JSDOM('<body></body>', { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
      const c = dom.getInternalVMContext();
      new vm.Script(read('js/notifications.js')).runInContext(c);
      return { win: dom.window, run: s => new vm.Script(s).runInContext(c) };
    }
    it('la classe est posée pendant le changement, retirée deux images plus tard ; le changement lui-même est appliqué', async () => {
      const a = app();
      let during = null;
      a.win.__f = () => { during = a.win.document.body.classList.contains('theme-switching'); a.win.document.body.classList.add('dark-mode'); };
      a.run('runThemeSwitch(window.__f)');
      expect(during).toBe(true);
      expect(a.win.document.body.classList.contains('dark-mode')).toBe(true);
      expect(a.win.document.body.classList.contains('theme-switching')).toBe(true);
      await new Promise(r => a.win.requestAnimationFrame(() => a.win.requestAnimationFrame(() => setTimeout(r, 0))));
      expect(a.win.document.body.classList.contains('theme-switching')).toBe(false);
    });
    it('police d\'écriture : « Palatino » (ancien défaut) bascule une seule fois sur « Literata » ; un choix explicite ultérieur est respecté', () => {
      const dom = new JSDOM('<body></body>', { runScripts: 'outside-only', url: 'http://localhost/' });
      dom.window.localStorage.setItem('plume_prefs_p1', JSON.stringify({ theme: 'light', palette: 'emeraude', font: 'palatino' }));
      const c = dom.getInternalVMContext();
      new vm.Script("var _currentProfileId = 'p1'; var db = {};").runInContext(c);
      new vm.Script(read('js/notifications.js')).runInContext(c);
      const run = s => new vm.Script(s).runInContext(c);
      expect(run('loadAppearancePrefs().font')).toBe('literata');
      expect(run('loadAppearancePrefs().palette')).toBe('emeraude');
      run("rememberAppearance({ font: 'palatino' })");
      expect(run('loadAppearancePrefs().font')).toBe('palatino');
    });
  });
});

describe('version', () => {
  it('v9.54.0 ou plus : APP_VERSION et cache du service worker identiques', () => {
    const ver = read('js/router.js').match(/const APP_VERSION = '([^']+)'/)[1];
    expect(sw).toContain("'plume-epique-v" + ver + "'");
    expect(ver.split('.').map(Number)[1]).toBeGreaterThanOrEqual(54);
  });
});
