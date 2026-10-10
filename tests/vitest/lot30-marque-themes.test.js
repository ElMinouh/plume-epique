// ═══════════════════════════════════════════════════════
// LOT 4 « marque, thèmes, surfaces, connexion, logo » (v9.53.0, audit AUD-04-001, 007, 018, 022, 030)
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
const html = read('index.html');

const lum = hex => {
  const h = hex.replace('#', ''); const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// bloc de variables d'un thème : « :root { … } », « body.dark-mode { … } », « body.paper-mode { … } »
const block = sel => css.match(new RegExp('(?:^|\\n)' + sel + ' \\{([\\s\\S]*?)\\n\\}'))[1];
const v = (b, name) => { const m = b.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})\\b')); return m && m[1]; };
const root = block(':root'), dark = block('body\\.dark-mode'), paper = block('body\\.paper-mode');
const gradStops = b => b.match(/--grad:linear-gradient\([^)]*\)/)[0].match(/#[0-9a-fA-F]{6}/g);

describe('AUD-04-007 — thème clair : ivoire chaud, plus de dégradé bleu', () => {
  it('le fond clair n\'a aucune teinte bleue saturée', () => {
    for (const c of gradStops(root)) {
      const [r, g, b] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
      expect(b, c).toBeLessThanOrEqual(r); // ivoire : le bleu ne dépasse jamais le rouge
    }
    expect(root).not.toContain('#3498db');
  });
  it('plus de contournement « titre de la bibliothèque forcé en blanc sur le dégradé bleu »', () => {
    expect(css).not.toContain('body:not(.dark-mode):not(.paper-mode) #library-screen > h2');
  });
});

describe('AUD-04-018 — surfaces à trois niveaux, textes lisibles sur chacune', () => {
  const themes = {
    clair: { b: root, page: gradStops(root)[1] },
    sombre: { b: dark, page: gradStops(dark)[1] },
    papier: { b: paper, page: gradStops(paper)[1] },
  };
  it('chaque thème définit fond de page < carte (--glass) < menu (--surface-2), tous distincts', () => {
    for (const [k, t] of Object.entries(themes)) {
      const card = v(t.b, 'glass'), menu = v(t.b, 'surface-2');
      expect(card, k + ' glass').toBeTruthy(); expect(menu, k + ' surface-2').toBeTruthy();
      expect(new Set([t.page.toLowerCase(), card.toLowerCase(), menu.toLowerCase()]).size, k).toBe(3);
    }
  });
  it('le texte courant (≥ 7:1) et le texte secondaire (≥ 4,5:1) tiennent sur les trois niveaux de chaque thème', () => {
    for (const [k, t] of Object.entries(themes)) {
      const text = v(t.b, 'text'), muted = v(t.b, 'text-muted');
      for (const bg of [t.page, v(t.b, 'glass'), v(t.b, 'surface-2')]) {
        expect(ratio(text, bg), `${k} texte sur ${bg}`).toBeGreaterThanOrEqual(7);
        expect(ratio(muted, bg), `${k} secondaire sur ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('les titres (--title) tiennent sur les trois niveaux de chaque thème', () => {
    const titles = { clair: v(root, 'title'), sombre: v(dark, 'title'), papier: v(root, 'title') };
    for (const [k, t] of Object.entries(themes))
      for (const bg of [t.page, v(t.b, 'glass'), v(t.b, 'surface-2')]) expect(ratio(titles[k], bg), `${k} ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
  it('menus, fenêtres, bulles et panneaux flottants utilisent --surface-2 ; cartes et panneaux fixes restent en --glass', () => {
    for (const sel of ['#search-box{', '#history-box{', '.toolbar-menu{', '.gn-modal{', '#lex-panel{', '#ai-chat-panel{'])
      expect(css.split('\n').find(l => l.startsWith(sel)), sel).toContain('var(--surface-2)');
    expect(css.split('\n').find(l => l.startsWith('#chapter-sidebar{'))).toContain('var(--glass)');
    expect(css).toContain('.u-bg-v-glass.u-bg-v-glass.u-bg-v-glass{background:var(--surface-2)}');
  });
  it('bordures des cartes ≥ 1,15:1 contre le fond de page (clair, papier) — lisibles sans ombre', () => {
    // la bordure est une couleur translucide : on la compose sur la carte
    const over = (rgba, bg) => {
      const m = rgba.match(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/); const a = parseFloat(m[4]);
      const b = [1, 3, 5].map(i => parseInt(bg.slice(i, i + 2), 16));
      return '#' + [1, 2, 3].map((j, i) => Math.round(parseInt(m[j]) * a + b[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
    };
    for (const [b, card] of [[root, v(root, 'glass')], [paper, v(paper, 'glass')]]) {
      const border = b.match(/--border:\s*(rgba\([^)]*\))/)[1];
      expect(ratio(over(border, card), card)).toBeGreaterThanOrEqual(1.15);
    }
  });
});

describe('AUD-04-001 — marque : palette « Marine & Or » par défaut, logo et nom dans l\'éditeur', () => {
  const db = read('js/database.js');
  it('la palette par défaut du CSS et du schéma est celle du logo (marine #1d3a5c, or #8a6414)', () => {
    expect(v(root, 'accent').toLowerCase()).toBe('#1d3a5c');
    expect(v(root, 'accent2').toLowerCase()).toBe('#8a6414');
    expect(db).toMatch(/'marine-or':\s*\{[^}]*a:'#1d3a5c'/);
    expect(read('js/schema.js')).not.toContain("'rouge-violet'");
    expect(read('js/schema.js')).toContain("accentPalette:'marine-or'");
  });
  it('en thème sombre le bouton principal passe à un bleu plus clair (--accent-dark) pour rester visible', () => {
    expect(dark).toContain('--accent:var(--accent-dark);');
    expect(ratio('#ffffff', v(root, 'accent-dark'))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(v(root, 'accent-dark'), v(dark, 'glass'))).toBeGreaterThanOrEqual(2.5);
  });
  it('l\'en-tête de l\'éditeur porte la marque (plume + nom), masquée côté nom sur téléphone', () => {
    expect(html).toMatch(/<header role="banner">\s*<div class="brand" aria-label="Plume"><svg[^>]*><use href="#i-feather"><\/use><\/svg><span class="brand-name">Plume<\/span><\/div>/);
    expect(css).toContain('@media (max-width:768px){.brand-name{display:none;}');
    expect(html).toContain('id="i-feather"');
  });
  it('le sélecteur propose « Marine & Or » en premier', () => {
    const i = html.indexOf('data-palette="marine-or"');
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(html.indexOf('data-palette="rouge-violet"'));
  });
  describe('migration de la palette par défaut et couleur de thème du navigateur', () => {
    function app(stored) {
      const dom = new JSDOM('<head><meta name="theme-color" content="#142a43"></head><body></body>', { runScripts: 'outside-only', url: 'http://localhost/' });
      const win = dom.window;
      if (stored) win.localStorage.setItem('plume_prefs_p1', JSON.stringify(stored));
      const c = dom.getInternalVMContext();
      new vm.Script("var _currentProfileId = 'p1'; var db = {};").runInContext(c);
      new vm.Script(read('js/notifications.js')).runInContext(c);
      return { win, run: s => new vm.Script(s).runInContext(c) };
    }
    it('« Rouge & Violet » (ancien défaut) bascule une seule fois sur « Marine & Or » ; un choix ultérieur est respecté', () => {
      const a = app({ theme: 'light', palette: 'rouge-violet' });
      expect(a.run('loadAppearancePrefs().palette')).toBe('marine-or');
      expect(JSON.parse(a.win.localStorage.getItem('plume_prefs_p1')).paletteDefault953).toBe(1);
      a.run("rememberAppearance({ palette: 'rouge-violet' })"); // l'auteur le choisit explicitement ensuite
      expect(a.run('loadAppearancePrefs().palette')).toBe('rouge-violet');
    });
    it('les autres palettes ne sont pas touchées', () => {
      expect(app({ theme: 'dark', palette: 'emeraude' }).run('loadAppearancePrefs().palette')).toBe('emeraude');
    });
    it('theme-color suit le thème : ivoire (clair), papier, marine nuit (sombre)', async () => {
      const a = app(null);
      const meta = () => a.win.document.querySelector('meta[name="theme-color"]').getAttribute('content');
      a.run('syncThemeColorMeta()'); expect(meta()).toBe('#efe9dc');
      a.win.document.body.classList.add('dark-mode'); a.run('syncThemeColorMeta()'); expect(meta()).toBe('#141b26');
      a.win.document.body.classList.remove('dark-mode'); a.win.document.body.classList.add('paper-mode'); a.run('syncThemeColorMeta()'); expect(meta()).toBe('#e9dfc6');
    });
  });
});

describe('AUD-04-022 — connexion : code de récupération en blocs, un seul bouton plein', () => {
  const profiles = read('js/profiles.js');
  it('le code s\'affiche en blocs de 4 sur une grille (plus de coupure en milieu de bloc)', () => {
    expect(profiles).toContain("String(code).split('-').map(g => `<span>${DOMPurify.sanitize(g)}</span>`)");
    expect(css).toMatch(/\.gate-code\{display:grid;grid-template-columns:repeat\(3,auto\)/);
    expect(css).not.toMatch(/\.gate-code\{[^}]*break-all/);
  });
  it('« Télécharger en PDF » est un bouton discret (plus de violet isolé) ; titres de la connexion en or', () => {
    expect(profiles).toContain('id="rc-pdf" class="gate-btn gate-btn-ghost"');
    expect(css).toContain('.gate-title{color:#dcb866;');
    expect(ratio('#dcb866', '#141b26')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('AUD-04-030 — logo vectoriel', () => {
  const svg = read('icons/plume.svg');
  it('icons/plume.svg existe, aux couleurs du logo, avec un nom accessible', () => {
    expect(svg).toContain('viewBox="0 0 512 512"');
    expect(svg).toContain('aria-label="Plume"');
    expect(svg).toContain('#142a43');
    expect(svg).toMatch(/#e0b866/);
  });
  it('la connexion et la bibliothèque l\'utilisent ; il est précaché hors-ligne ; les PNG d\'installation restent', () => {
    expect(read('js/profiles.js')).toContain('src="icons/plume.svg" class="gate-logo"');
    expect(html).toContain('src="icons/plume.svg" class="topbar-logo"');
    expect(read('sw.js')).toContain("'./icons/plume.svg'");
    for (const f of ['icon-192.png', 'icon-512.png', 'icon-512-maskable.png', 'icon-180.png', 'icon-32.png']) expect(fs.existsSync(path.join(ROOT, 'icons', f)), f).toBe(true);
    expect(read('manifest.json')).toContain('icons/icon-512-maskable.png');
  });
});

describe('version', () => {
  it('v9.53.0 ou plus : APP_VERSION et cache du service worker identiques', () => {
    const ver = read('js/router.js').match(/const APP_VERSION = '([^']+)'/)[1];
    expect(read('sw.js')).toContain("'plume-epique-v" + ver + "'");
    expect(ver.split('.').map(Number)[1]).toBeGreaterThanOrEqual(53);
  });
});
