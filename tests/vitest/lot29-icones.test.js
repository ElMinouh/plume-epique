// ═══════════════════════════════════════════════════════
// LOT 3 « icônes vectorielles » (v9.51.0 puis v9.52.0, audit AUD-04-002, 003, 023)
// Garde-fous : le sprite correspond exactement à lucide-static, toute icône utilisée existe, l'interface statique ne contient
// plus d'emoji, le helper icon() survit à DOMPurify.
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import createDOMPurify from 'dompurify';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// fins de ligne normalisées : le dépôt peut être extrait en CRLF (Windows) ou en LF (CI)
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html');
const iconsJs = read('js/icons.js');
const sw = read('sw.js');
const pkg = JSON.parse(read('package.json'));

const names = JSON.parse(iconsJs.match(/const ICON_NAMES = (\[.*?\]);/)[1]);
const sprite = html.slice(html.indexOf('<!-- ICONES:DEBUT'), html.indexOf('<!-- ICONES:FIN -->'));
const symbols = Object.fromEntries([...sprite.matchAll(/<symbol id="i-([\w-]+)" viewBox="0 0 24 24">(.*?)<\/symbol>/g)].map(m => [m[1], m[2]]));

describe('AUD-04-002 — sprite d\'icônes', () => {
  it('lucide-static est figé en version exacte et sous licence ISC', () => {
    expect(pkg.dependencies['lucide-static']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(JSON.parse(read('node_modules/lucide-static/package.json')).license).toBe('ISC');
  });
  it('chaque nom de js/icons.js a son symbole dans index.html, et inversement', () => {
    expect(Object.keys(symbols).sort()).toEqual([...names].sort());
    expect(names.length).toBeGreaterThan(60);
  });
  it('chaque symbole est identique au fichier de lucide-static (aucune retouche à la main)', () => {
    for (const n of names) {
      const svg = read('node_modules/lucide-static/icons/' + n + '.svg');
      const inner = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/<svg[\s\S]*?>/, '').replace(/<\/svg>\s*$/, '').split('\n').map(l => l.trim()).filter(Boolean).join('');
      expect(symbols[n], n).toBe(inner);
    }
  });
  it('le sprite est placé dans index.html, caché, avant tout autre contenu', () => {
    expect(html.indexOf('<svg class="svg-sprite"')).toBeGreaterThan(html.indexOf('<body>'));
    expect(html.indexOf('<svg class="svg-sprite"')).toBeLessThan(html.indexOf('id="library-screen"'));
    expect(read('css/style.css')).toContain('.svg-sprite{position:absolute;width:0;height:0;overflow:hidden;}');
  });
  it('icons.js est chargé avant schema.js et précaché hors-ligne', () => {
    expect(html.indexOf('js/icons.js')).toBeGreaterThan(-1);
    expect(html.indexOf('js/icons.js')).toBeLessThan(html.indexOf('js/schema.js'));
    expect(sw).toContain("'./js/icons.js'");
  });
});

describe('AUD-04-002/003/023 — plus d\'emoji dans l\'interface statique', () => {
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<symbol[\s\S]*?<\/symbol>/g, '');
  const EMOJI = /[\u{1F300}-\u{1FAFF}☀-➿⭐⏳⏰✅❌❔❓↔↩▶⬅↕↶↷▾☰]/u;
  it('index.html n\'en contient plus (hors commentaires)', () => {
    const hits = body.split('\n').filter(l => EMOJI.test(l)).map(l => l.trim().slice(0, 80));
    expect(hits).toEqual([]);
  });
  it('plus de chevron ▾ dans le texte : c\'est une icône (icon-caret)', () => {
    expect(body).not.toContain('▾');
    expect(body).toContain('icon icon-caret');
  });
  it('chaque <use> de index.html pointe un symbole existant', () => {
    const used = new Set([...body.matchAll(/<use href="#i-([\w-]+)">/g)].map(m => m[1]));
    expect(used.size).toBeGreaterThan(40);
    expect([...used].filter(n => !symbols[n])).toEqual([]);
  });
  it('un bouton réduit à une icône a un nom accessible', () => {
    const bad = [...body.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)]
      .filter(m => !m[1].includes('aria-label=') && !m[1].includes('title=') && !m[2].replace(/<svg.*?<\/svg>/gs, '').trim())
      .map(m => m[0].slice(0, 90));
    expect(bad).toEqual([]);
  });
  it('les placeholders et options de liste ne portent plus d\'emoji (un champ de texte ne peut pas afficher un SVG)', () => {
    expect([...body.matchAll(/placeholder="([^"]*)"/g)].filter(m => EMOJI.test(m[1]))).toEqual([]);
    expect([...body.matchAll(/<option[^>]*>([^<]*)</g)].filter(m => EMOJI.test(m[1]))).toEqual([]);
  });
});

describe('AUD-04-002/003/023 — plus d\'emoji dans les gabarits et messages JS (v9.52.0)', () => {
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u2600-\u27BF\u2B50\u2B07\u23F3\u23F0\u2705\u274C\u2754\u2753\u21A9\u25B6\u2B05\u2195\u21B6\u21B7\u25BE\u2630\u2714\u2713\u270E\u25C0\u25B2\u25BC\u21BA]/u;
  const jsFiles = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'));
  const codeLines = f => read('js/' + f).split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => {
    const s = l.trim(); return !(s.startsWith('//') || s.startsWith('*') || s.startsWith('/*'));
  });
  it('aucune ligne de code de js/*.js ne contient d\'emoji (les commentaires peuvent en citer)', () => {
    const hits = [];
    for (const f of jsFiles) for (const [n, l] of codeLines(f)) if (EMOJI.test(l.replace(/\/\/.*$/, ''))) hits.push(f + ':' + n + ' ' + l.trim().slice(0, 70));
    expect(hits).toEqual([]);
  });
  it('toute icône nommée dans les JS existe dans le sprite (icon(\'x\'), tabLabels, questsIcon, glyphes de formes, chronologie)', () => {
    const used = new Set();
    for (const f of jsFiles) {
      const src = read('js/' + f);
      for (const m of src.matchAll(/icon\('([a-z0-9-]+)'/g)) used.add(m[1]);
      for (const m of src.matchAll(/(?:icon|glyph|questsIcon):\s*'([a-z0-9-]+)'/g)) used.add(m[1]);
      for (const m of src.matchAll(/mkBtn\('([a-z0-9-]+)'/g)) used.add(m[1]);
      for (const m of src.matchAll(/addResult\('([a-z0-9-]+)'/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(40);
    expect([...used].filter(n => !symbols[n])).toEqual([]);
  });
  it('les onglets du volet : icône + libellé séparés, sans chevron', () => {
    const r = read('js/router.js');
    expect(r).toContain("'tab-univers':{ icon:'globe', label:'Univers' }");
    expect(r).not.toMatch(/'tab-[a-z-]+':'[^']*▾/);
    expect(read('js/tabs.js')).toContain('btn.innerHTML=icon(tl.icon)');
  });
  it('un message temporaire porte une icône par type, sans changer son texte', () => {
    expect(read('js/notifications.js')).toContain("icon(type === 'success' ? 'circle-check' : type === 'error' ? 'circle-alert' : 'info', 'toast-icon')");
    expect(read('css/style.css')).toContain('.toast-icon{');
  });
});

describe('helper icon() (js/icons.js)', () => {
  const ctx = vm.createContext({});
  vm.runInContext(iconsJs + '; this.icon = icon;', ctx);
  it('produit un SVG décoratif (aria-hidden) qui référence le sprite', () => {
    expect(ctx.icon('search')).toBe('<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-search"></use></svg>');
    expect(ctx.icon('chevron-down', 'icon-caret')).toContain('class="icon icon-caret"');
  });
  it('DOMPurify retire <use> par défaut : icon() ne doit JAMAIS passer dans DOMPurify.sanitize (le texte utilisateur seul y passe)', () => {
    const purify = createDOMPurify(new JSDOM('').window);
    expect(purify.sanitize('<button>' + ctx.icon('x') + ' Fermer</button>')).not.toContain('<use');
    // si un jour un gabarit entier devait être assaini : ADD_TAGS ['use'] conserve la référence interne
    const out = purify.sanitize('<button>' + ctx.icon('x') + '</button>', { ADD_TAGS: ['use'] });
    expect(out).toContain('href="#i-x"');
  });
  it('aucun js/*.js ne passe icon() dans DOMPurify.sanitize', () => {
    const bad = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'))
      .filter(f => /DOMPurify\.sanitize\([^)]*icon\(/.test(read('js/' + f)));
    expect(bad).toEqual([]);
  });
});

describe('version', () => {
  it('v9.52.0 ou plus : APP_VERSION et cache du service worker identiques', () => {
    const v = read('js/router.js').match(/const APP_VERSION = '([^']+)'/)[1];
    expect(sw).toContain("'plume-epique-v" + v + "'");
    expect(v.split('.').map(Number)[1]).toBeGreaterThanOrEqual(52);
  });
});
