// ═══════════════════════════════════════════════════════
// LOT 7 « états vides, pastilles d'état, impression, contraste forcé, garde-fou transversal » (v9.56.0, audit AUD-04-024, 025, 027, 028)
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// fins de ligne normalisées : le dépôt peut être extrait en CRLF (Windows) ou en LF (CI)
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const css = read('css/style.css');
const jsFiles = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'));

const lum = hex => {
  const h = hex.replace('#', ''); const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const block = sel => css.match(new RegExp('(?:^|\\n)' + sel + ' \\{([\\s\\S]*?)\\n\\}'))[1];
const root = block(':root'), dark = block('body\\.dark-mode'), paper = block('body\\.paper-mode');
const hex = (b, name) => { const m = b.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})\\b')); return m && m[1]; };
// le thème papier (et parfois le sombre) ne redéfinit pas tout : valeur héritée du :root
const val = (b, name) => hex(b, name) || hex(root, name);

describe('AUD-04-024 — états vides accompagnés', () => {
  it('helper emptyState() : icône du sprite, titre, phrase d\'aide', () => {
    const icons = read('js/icons.js');
    expect(icons).toContain('function emptyState(name, title, hint)');
    expect(icons).toContain('class="empty-state"');
    expect(css).toContain('.empty-state{display:flex;flex-direction:column;align-items:center;');
  });
  it('Univers, chronologie, corbeilles, versions et historique l\'utilisent ; les anciens messages nus ont disparu', () => {
    const uses = { 'js/database.js': 3, 'js/editor.js': 1, 'js/library.js': 2, 'js/snapshots.js': 2, 'js/timeline.js': 1 };
    for (const [f, n] of Object.entries(uses)) expect((read(f).match(/emptyState\(/g) || []).length, f).toBeGreaterThanOrEqual(n);
    const all = jsFiles.map(f => read('js/' + f)).join('\n');
    for (const old of ['Aucun élément pour le moment', '>La corbeille est vide.<', '>Aucun historique.<', '>Aucune version.<', '>Aucun événement.<'])
      expect(all, old).not.toContain(old);
  });
  it('les icônes employées existent dans le sprite', () => {
    const html = read('index.html');
    for (const n of ['users', 'castle', 'target', 'trash-2', 'history', 'calendar', 'search']) expect(html, n).toContain('id="i-' + n + '"');
  });
});

describe('AUD-04-025 — pastilles d\'état : jetons de rôle et forme', () => {
  it('statut de chapitre : anneau / demi-disque / disque plein, en jetons', () => {
    expect(css).toContain('.ch-status-dot.ch-status-draft{border:1.5px solid var(--text-muted);background:transparent}');
    expect(css).toContain('linear-gradient(90deg,var(--warn-solid) 50%,transparent 50%)');
    expect(css).toContain('.ch-status-dot.ch-status-final{border:1.5px solid var(--success-solid);background:var(--success-solid)}');
  });
  it('pastille de synchro : rond (ok), losange (en attente), carré (échec)', () => {
    expect(css).toContain('#sync-status-dot.sync-ok{background:var(--success-solid);}');
    expect(css).toMatch(/#sync-status-dot\.sync-warn\{[^}]*transform:rotate\(45deg\)/);
    expect(css).toMatch(/#sync-status-dot\.sync-error\{[^}]*border-radius:var\(--r-1\)/);
  });
  it('toast : liseré par jeton via data-type ; plus de teinte figée dans notifications.js, editor.js ni readability.js', () => {
    expect(css).toContain('#toast[data-type="error"]{border-left-color:var(--danger);}');
    for (const f of ['js/notifications.js', 'js/editor.js', 'js/readability.js'])
      expect(read(f), f).not.toMatch(/#(27ae60|e74c3c|f39c12|e67e22|2ecc71|7f8c8d)/i);
  });
  it('couleurs de texte d\'état ≥ 4,5:1 sur les deux niveaux de surface de chaque thème', () => {
    for (const [k, b] of Object.entries({ clair: root, sombre: dark, papier: paper }))
      for (const t of ['success-text', 'danger-text', 'warn-text'])
        for (const s of ['glass', 'surface-2'])
          expect(ratio(val(b, t), val(b, s)), k + ' ' + t + ' sur ' + s).toBeGreaterThanOrEqual(4.5);
  });
});

describe('AUD-04-027 — impression et contraste forcé', () => {
  const print = css.slice(css.indexOf('@media print'), css.indexOf('@media (forced-colors: active)'));
  it('impression : interface masquée, texte noir sur blanc, mode Lecture imprimable chapitre par chapitre', () => {
    expect(print).toContain('header,#chapter-sidebar,#tab-container,#editor-wrapper > .toolbar');
    expect(print).toContain('background:#fff !important;color:#000 !important');
    expect(print).toContain('#reading-overlay.active{position:static !important;display:block !important');
    expect(print).toContain('.reading-chapter{break-before:page;}');
    expect(print).toContain('@page{margin:18mm;}');
  });
  it('contraste forcé : bordures explicites, focus visible, pastilles conservant leur forme ; contraste renforcé', () => {
    expect(css).toContain('@media (forced-colors: active)');
    expect(css).toMatch(/forced-colors: active\)[\s\S]*outline:2px solid Highlight/);
    expect(css).toContain('.ch-status-dot.ch-status-final{border-color:CanvasText;background:CanvasText;}');
    expect(css).toContain('@media (prefers-contrast: more)');
  });
});

describe('AUD-04-028 — garde-fou transversal des couleurs d\'état', () => {
  // Teintes vives d'état encore autorisées : définitions des jetons, catégories de graphes (relations, nuage de mots),
  // pastilles de surlignage et palettes de couvertures — ce sont des couleurs CHOISIES, pas des états.
  const STATE = /#(27ae60|e74c3c|f39c12|e67e22|2ecc71|7f8c8d)\b/i;
  const ALLOWED_CSS = [/^\s*--item-bg/, /^\s*--danger:/, /^\.legend-dot/, /^\.hl-swatch/];
  const ALLOWED_JS = { 'database.js': /^\s*\{a:'#/, 'relations.js': /colorMap/, 'wordcloud.js': /const colors=/ };
  it('aucune nouvelle teinte d\'état en dur dans le CSS (hors jetons, légende du graphe, surlignage)', () => {
    const bad = css.split('\n').filter(l => STATE.test(l) && !ALLOWED_CSS.some(r => r.test(l)));
    expect(bad).toEqual([]);
  });
  it('aucune nouvelle teinte d\'état en dur dans le JS (hors catégories de graphes et palettes de couverture)', () => {
    const bad = [];
    for (const f of jsFiles) read('js/' + f).split('\n').forEach((l, i) => {
      if (STATE.test(l) && !(ALLOWED_JS[f] && ALLOWED_JS[f].test(l))) bad.push(f + ':' + (i + 1));
    });
    expect(bad).toEqual([]);
  });
});

describe('version', () => {
  it('v9.56.0 ou plus : APP_VERSION et cache du service worker identiques', () => {
    const ver = read('js/router.js').match(/const APP_VERSION = '([^']+)'/)[1];
    expect(read('sw.js')).toContain("'plume-epique-v" + ver + "'");
    expect(ver.split('.').map(Number)[1]).toBeGreaterThanOrEqual(56);
  });
});
