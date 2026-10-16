// ═══════════════════════════════════════════════════════
// AUD-08 LOT 3 (v9.82.0) — COMPOSITION ET MOBILE (AUD-08-007, 020, 021, 022)
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const css = read('css/style.css'), html = read('index.html'), lib = read('js/library.js');
function grab(file, name) {
  const src = read(file), i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error(name + ' introuvable');
  let d = 0; const j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}

describe('AUD-08-007 — barre d\'outils sur une rangée, pied de page compact volet ouvert', () => {
  it('« Rechercher » et « Mots » passent en icône seule sur ordinateur, avec nom accessible', () => {
    expect(css).toMatch(/@media \(min-width:769px\)\{\s*#tb-search-btn \.tb-label,#lex-tools-toggle-btn \.tb-label\{display:none;\}/);
    expect(html).toMatch(/id="tb-search-btn"[^>]*aria-label="Rechercher du texte"/);
    expect(html).toMatch(/id="lex-tools-toggle-btn"[^>]*aria-label="Synonymes et antonymes"/);
  });
  it('volet ouvert, les boutons du pied de page n\'affichent plus que leur icône', () => {
    expect(css).toContain('body:has(main.has-panel) #mode-bar .mb-label{display:none;}');
  });
  it('l\'alignement de colonne (barre = largeur du texte) est conservé', () => {
    expect(css).toContain('#editor-wrapper > .toolbar{max-width:var(--text-w);');
  });
});

describe('AUD-08-020 — bibliothèque sur téléphone', () => {
  it('2 colonnes, couverture plus haute, titre sur deux lignes', () => {
    expect(css).toMatch(/#library-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:10px;\}/);
    expect(css).toMatch(/\.library-cover\{height:64px;/);
    expect(css).toMatch(/\.library-card-title\{[^}]*-webkit-line-clamp:2/);
  });
  it('le ⋮ garde 44×44 px de zone tactile mais n\'affiche qu\'un disque de 28 px', () => {
    expect(css).toMatch(/\.library-kebab-btn\{top:0;right:0;width:44px;height:44px;background:none;/);
    expect(css).toMatch(/\.library-kebab-btn::before\{content:'';position:absolute;width:28px;height:28px;border-radius:50%;/);
  });
});

describe('AUD-08-021 — éditeur sur téléphone', () => {
  it('le bouton bibliothèque de l\'en-tête est masqué sauf en vue Fiches', () => {
    expect(css).toContain('body:not(.cork-view) #chapter-quick-library-btn{display:none;}');
    expect(grab('js/editor.js', 'setChapterViewMode')).toContain("classList.toggle('cork-view', isCork)");
  });
  it('« IA & Mémoire » a une forme courte « IA » sous 480 px, les autres onglets restent inchangés', () => {
    expect(read('js/router.js')).toContain("'tab-ia-memoire':{ icon:'bot', label:'IA & Mémoire', short:'IA' }");
    const dom = new JSDOM('<nav id="tab-menu"></nav>', { runScripts: 'outside-only' });
    const ctx = dom.getInternalVMContext();
    ctx.db = { tabOrder: ['tab-ia-memoire', 'tab-config'] };
    ctx.tabLabels = { 'tab-ia-memoire': { icon: 'bot', label: 'IA & Mémoire', short: 'IA' }, 'tab-config': { icon: 'settings', label: 'Config' } };
    ctx.tabDescriptions = {}; ctx.icon = n => '<i>' + n + '</i>'; ctx.escapeHtml = s => s.replace(/&/g, '&amp;'); ctx.toggleTab = () => {};
    dom.window.document.body.insertAdjacentHTML('beforeend', '<div id="tab-ia-memoire"></div><div id="tab-config"></div>');
    new vm.Script(grab('js/tabs.js', 'renderTabs')).runInContext(ctx);
    vm.runInContext('try { renderTabs(); } catch (e) { globalThis.__err = String(e); }', ctx);
    const b = dom.window.document.querySelectorAll('#tab-menu .tab-btn');
    expect(b[0].querySelector('.tab-label-long').textContent).toBe('IA & Mémoire');
    expect(b[0].querySelector('.tab-label-short').textContent).toBe('IA');
    expect(b[1].querySelector('.tab-label-long')).toBeNull();
    expect(css).toContain('@media(max-width:480px){.tab-label-short{display:inline;}}');
    expect(css).toContain('.tab-label-long{display:none;}');
  });
  it('un dégradé signale que la barre d\'outils défile quand elle déborde', () => {
    expect(read('js/router.js')).toContain('function updateToolbarScrollHint()');
    expect(css).toContain('.toolbar.toolbar-more{-webkit-mask-image:linear-gradient(to right');
  });
});

describe('AUD-08-022 — couvertures automatiques variées et stables', () => {
  const ctx = vm.createContext({ COVER_PALETTES: { 'or-et-nuit': {}, 'bleu-ocean': {}, ardoise: {}, emeraude: {}, sepia: {}, 'nuit-etoilee': {}, jade: {} } });
  new vm.Script("const AUTO_COVER_KEYS = ['or-et-nuit', 'bleu-ocean', 'ardoise', 'emeraude', 'sepia', 'nuit-etoilee'];\n" + grab('js/library.js', 'coverKeyOf')).runInContext(ctx);
  const k = d => vm.runInContext('coverKeyOf(' + JSON.stringify(d) + ')', ctx);
  it('un choix manuel l\'emporte', () => { expect(k({ id: 'a', cover: 'jade' })).toBe('jade'); });
  it('« auto » donne toujours la même teinte pour le même manuscrit', () => {
    expect(k({ id: 'abc123', cover: 'auto' })).toBe(k({ id: 'abc123', cover: 'auto' }));
    expect(k({ id: 'abc123' })).toBe(k({ id: 'abc123', cover: 'auto' }));
  });
  it('dix manuscrits ne partagent pas tous la même couverture, et chaque clé existe', () => {
    const ids = Array.from({ length: 10 }, (_, i) => 'doc-' + i + '-xyz');
    const keys = ids.map(id => k({ id, cover: 'auto' }));
    expect(new Set(keys).size).toBeGreaterThan(2);
    for (const key of keys) expect(['or-et-nuit', 'bleu-ocean', 'ardoise', 'emeraude', 'sepia', 'nuit-etoilee']).toContain(key);
  });
  it('la grille et l\'étagère utilisent cette fonction, et le choix « Automatique » reste « auto » dans les données', () => {
    expect((lib.match(/const ck = coverKeyOf\(d\);/g) || []).length).toBe(2);
    expect(lib).toContain("if (entry) entry.cover = key; // 'auto' ou une clé de COVER_PALETTES");
  });
});
