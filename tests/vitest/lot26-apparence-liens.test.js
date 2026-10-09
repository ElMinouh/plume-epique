// ════════════════════════════════════════════════════════════════════
// LOT H « apparence du profil, en-tête, roman graphique, liens » (v9.48.0, audit AUD-03-022, 028, 029, 030)
// ════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const html = read('index.html');

describe('AUD-03-022 — apparence par profil et par appareil', () => {
  function app({ systemDark = false, profile = 'p1', stored = null } = {}) {
    const dom = new JSDOM('<body></body>', { runScripts: 'outside-only', url: 'http://localhost/' });
    const win = dom.window;
    win.matchMedia = q => ({ matches: q.includes('dark') ? systemDark : false });
    if (stored) win.localStorage.setItem('plume_prefs_' + profile, JSON.stringify(stored));
    const c = dom.getInternalVMContext();
    new vm.Script(`var _currentProfileId = '${profile}'; var db = { darkMode: true, paperMode: false, accentPalette: 'ardoise', editorFont: 'times' };
      var palettes = []; var fonts = []; function applyAccentPalette(k){ palettes.push(k); } function applyEditorFont(k){ fonts.push(k); }`).runInContext(c);
    new vm.Script(read('js/notifications.js')).runInContext(c);
    return { win, d: win.document, run: s => new vm.Script(s).runInContext(c) };
  }
  const theme = d => d.body.classList.contains('paper-mode') ? 'paper' : d.body.classList.contains('dark-mode') ? 'dark' : 'light';

  it('sans préférence : le réglage clair/sombre du système ; avec préférence : celle du profil', () => {
    let a = app({ systemDark: true }); a.run('applyProfileAppearance()'); expect(theme(a.d)).toBe('dark');
    a = app({ systemDark: false }); a.run('applyProfileAppearance()'); expect(theme(a.d)).toBe('light');
    a = app({ systemDark: true, stored: { theme: 'paper', palette: 'emeraude', font: 'courier' } }); a.run('applyProfileAppearance()');
    expect(theme(a.d)).toBe('paper');
    expect(a.run('palettes')).toEqual(['emeraude']); expect(a.run('fonts')).toEqual(['courier']);
  });
  it('préférences propres à chaque profil, fusionnées sans rien perdre', () => {
    const a = app({ profile: 'p1' });
    a.run("rememberAppearance({ theme: 'dark' }); rememberAppearance({ font: 'verdana' });");
    expect(JSON.parse(a.win.localStorage.getItem('plume_prefs_p1'))).toEqual({ theme: 'dark', font: 'verdana' });
    expect(a.win.localStorage.getItem('plume_prefs_p2')).toBeNull();
  });
  it('ouverture d\'un manuscrit : les préférences du profil l\'emportent ; sinon on reprend celles du manuscrit et on les mémorise', () => {
    let a = app({ stored: { theme: 'light', palette: 'emeraude' } });
    a.run('syncDbAppearanceFromPrefs()');
    expect(a.run('[db.darkMode, db.paperMode, db.accentPalette, db.editorFont].join()')).toBe('false,false,emeraude,times');
    a = app();
    a.run('syncDbAppearanceFromPrefs()');
    expect(JSON.parse(a.win.localStorage.getItem('plume_prefs_p1'))).toEqual({ theme: 'dark', palette: 'ardoise', font: 'times' });
    expect(a.run('db.darkMode')).toBe(true); // rien ne change pour un manuscrit existant
  });
  it('un stockage corrompu ou indisponible ne casse rien', () => {
    const a = app({ stored: null }); a.win.localStorage.setItem('plume_prefs_p1', '{pas du json');
    expect(a.run('loadAppearancePrefs()')).toBeNull();
    a.run('applyProfileAppearance()');
  });
  it('câblage : bibliothèque, ouverture d\'un manuscrit (texte et roman graphique), sélecteurs, création', () => {
    expect(read('js/library.js')).toMatch(/async function enterLibrary\(\) \{\s*applyProfileAppearance\(\);/);
    expect(read('js/router.js')).toMatch(/function initApp\(\)\{\s*syncDbAppearanceFromPrefs\(\);/);
    const gn = read('js/graphicnovel.js');
    expect(gn).toContain('syncDbAppearanceFromPrefs(); // v9.48.0');
    const db = read('js/database.js');
    for (const k of ['rememberAppearance({ palette: key })', 'rememberAppearance({ font: key })', 'rememberAppearance({ theme: mode })', "rememberAppearance({ theme: db.paperMode ? 'paper' : (db.darkMode ? 'dark' : 'light') })"])
      expect(db).toContain(k);
    for (const f of ['js/library.js', 'js/graphicnovel.js']) {
      const s = read(f);
      expect(s).toContain("dbData.darkMode = document.body.classList.contains('dark-mode')");
      expect(s).not.toMatch(/dbData\.darkMode = true;/);
    }
  });
});

describe('AUD-03-028 — en-tête de la bibliothèque', () => {
  const bar = html.slice(html.indexOf('id="library-topbar-actions"'), html.indexOf('id="library-topbar-more-btn"'));
  it('trois éléments (Système, Compte ▾, Aide ▾), tous neutres, avec leurs menus', () => {
    expect(bar).toContain('id="library-system-btn"');
    expect(bar).toContain('id="library-account-btn"');
    expect(bar).toContain('id="library-help-btn"');
    expect(bar).not.toMatch(/u-bg-h[0-9a-f]{6}/);
    const account = bar.slice(bar.indexOf('library-account-btn'), bar.indexOf('library-help-btn'));
    for (const id of ['library-my-profile-btn', 'library-manage-profiles-btn', 'library-logout-btn']) expect(account).toContain(id);
    const help = bar.slice(bar.indexOf('library-help-btn'));
    for (const id of ['library-tour-btn', 'library-full-tour-btn']) expect(help).toContain(id);
    expect(html).toContain('id="library-topbar-more-btn"');
    expect(html).toMatch(/<button class="mode-indicator u-d-none" id="library-topbar-more-btn"/);
  });
  it('menus : un seul ouvert à la fois, fermés par clic extérieur et Échap', () => {
    const lib = read('js/library.js');
    expect(lib).toContain('function closeLibDropdowns()');
    expect(lib).toContain("document.addEventListener('click', closeLibDropdowns);");
    expect(read('js/router.js')).toContain("'closeLibDropdowns'");
  });
  it('la visite guidée ouvre le menu Compte pour « Gérer les profils »', () => {
    const f = read('js/fulltour.js');
    expect(f).toContain('function ensureLibraryMenuOpen(step)');
    expect(f).toContain("target.closest('.lib-dropdown')");
    expect(f).toContain('step.ensureVisible(step)');
  });
});

describe('AUD-03-029 — roman graphique', () => {
  const gn = read('js/graphicnovel.js');
  it('chaque bouton d\'icône a un nom accessible ; libellés visibles sur écran large ; grille avec aria-pressed', () => {
    for (const id of ['gn-undo-btn', 'gn-redo-btn', 'gn-add-image-btn', 'gn-add-text-btn', 'gn-grid-toggle', 'gn-trash-btn'])
      expect(gn).toMatch(new RegExp(`id="${id}"[^>]*aria-label="[^"]+"`));
    expect(gn).toContain('aria-pressed="true"');
    expect(gn).toContain("e.currentTarget.setAttribute('aria-pressed', String(_gnSnapGrid));");
    expect(read('css/style.css')).toMatch(/@media \(min-width:900px\)\{\s*\.gn-icon-btn\.gn-labeled\{width:auto;/);
  });
  it('un seul bouton principal « Exporter ▾ » ; historique et gabarit neutres', () => {
    expect(gn).toContain('id="gn-export-menu-btn"');
    expect(gn).toMatch(/id="gn-export-menu"[\s\S]*id="gn-export-btn"[\s\S]*id="gn-export-book-btn"/);
    expect(gn).not.toContain('>Exporter le PDF<');
    expect(gn).toContain('class="action-btn btn-sm u-bg-h7f8c8d gn-mt-sm" id="gn-page-history-btn"');
    expect(gn).toContain('class="action-btn btn-sm u-bg-h7f8c8d gn-mt-sm" id="gn-save-gabarit-btn"');
  });
  it('texte d\'information des images : court, sans jargon, détail en infobulle', () => {
    expect(gn).toContain('🖼️ Images : ${size} Mo · ${where}');
    expect(gn).not.toContain('sauvegarde GitHub pour les déplacer)');
    expect(gn).toContain('el.title = detail;');
  });
});

describe('AUD-03-030 — liens avec relation nommée', () => {
  const src = read('js/database.js');
  const code = src.slice(src.indexOf('function addLink'), src.indexOf('function removeLink'));
  function ctx() {
    const c = vm.createContext({});
    new vm.Script(`var db = { chars: [{ id: 'a', name: 'Léa' }, { id: 'b', name: 'Marc' }], places: [], quests: [] }; var saves = 0;
      function save(){ saves++; } function showEditById(){} ${code}`).runInContext(c);
    return { run: s => new vm.Script(s).runInContext(c) };
  }
  it('la relation est facultative, rognée à 40 caractères, et un lien déjà présent n\'est pas dupliqué', () => {
    const { run } = ctx();
    run("addLink('chars','b','chars','a','  frère de  ')");
    expect(run('db.chars[1].links')).toEqual([{ type: 'chars', id: 'a', label: 'frère de' }]);
    run("addLink('chars','b','chars','a','autre')");
    expect(run('db.chars[1].links.length')).toBe(1);
    run("addLink('chars','a','chars','b','')");
    expect(run('db.chars[0].links')).toEqual([{ type: 'chars', id: 'b' }]); // pas de champ label vide
    run("db.chars[0].links = []; addLink('chars','a','chars','b','x'.repeat(100))");
    expect(run('db.chars[0].links[0].label.length')).toBe(40);
  });
  it('le graphe porte la relation, affichée au milieu du lien ; le formulaire propose un champ « Relation »', () => {
    const rel = read('js/relations.js');
    const c = vm.createContext({});
    new vm.Script(`var db = { chars: [{ id: 'a', name: 'Léa', links: [{ type:'chars', id:'b', label:'sœur de' }] }, { id: 'b', name: 'Marc', links: [{ type:'chars', id:'a' }] }], places: [], quests: [], chapters: [] };
      ${rel.slice(rel.indexOf('function buildGraphData'), rel.indexOf('function renderGraph'))}`).runInContext(c);
    expect(new vm.Script('buildGraphData().links.map(l => l.label)').runInContext(c)).toEqual(['sœur de', '']);
    expect(rel).toContain(".attr('class','graph-link-label')");
    expect(src).toContain('id="link-label-input"');
    expect(src).toContain('<em class="link-rel">');
  });
});
