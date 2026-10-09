// ════════════════════════════════════════════════════════════════════
// LOT G « barre d'outils, aide, confort d'écriture » (v9.47.0, audit AUD-03-015, 024, 011, 012, 033, 031, 036)
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
const css = read('css/style.css');
const editor = read('js/editor.js');

describe('AUD-03-015 — barre d\'outils regroupée', () => {
  it('Structure, Focus direct, Outils réduit, Rechercher, ✨ Mots ; plus de menu « Paragraphe »', () => {
    expect(html).toContain('id="tb-structure-btn"');
    expect(html).not.toMatch(/Mettre en forme le paragraphe/);
    expect(html).toMatch(/<button class="action-btn btn-sm" id="focus-btn"/);
    for (const id of ['fmt-title-btn', 'fmt-para-btn', 'split-chapter-btn', 'insert-datetime-btn']) {
      const i = html.indexOf(`id="${id}"`);
      expect(html.lastIndexOf('id="tb-structure-btn"', i), id).toBeGreaterThan(html.lastIndexOf('id="tb-tools-btn"', i));
    }
    const tools = html.slice(html.indexOf('id="tb-tools-btn"'), html.indexOf('id="tb-search-btn"'));
    for (const id of ['analyze-btn', 'clear-btn', 'reading-mode-btn', 'voice-btn', 'sprint-start-menu-btn', 'export-chapter-btn', 'export-doc-btn'])
      expect(tools, id).toContain(`id="${id}"`);
    expect(tools).not.toContain('id="focus-btn"');
    expect(html).toMatch(/id="lex-tools-toggle-btn"[^>]*><svg[^>]*><use href="#i-sparkles"><\/use><\/svg><span class="tb-label"> Mots<\/span> <svg[^>]*icon-caret/);
  });
  it('le dictionnaire se replie aussi sur ordinateur (règle min-width:769px)', () => {
    expect(css).toMatch(/@media \(min-width:769px\)\{\s*#lex-tools-wrapper\{position:relative;\}\s*#lex-tools-toggle-btn\{display:inline-flex;flex-shrink:0;\}\s*#lex-tools-group\{display:none;\}/);
  });
});

describe('AUD-03-024 — une seule aide', () => {
  it('le centre d\'aide propose premiers pas, visite et confidentialité ; la version y figure', () => {
    for (const id of ['help-onboarding-btn', 'help-tour-btn', 'help-privacy-btn']) {
      expect(html).toContain(`id="${id}"`);
      expect(read('js/router.js')).toContain(`'${id}'`);
    }
    expect(html).toMatch(/<strong><svg[^>]*><use href="#i-circle-help"><\/use><\/svg> Aide et raccourcis<\/strong>/);
    const overlay = html.slice(html.indexOf('id="shortcuts-overlay"'), html.indexOf('<!-- EXPORT SELECT OVERLAY'));
    expect(overlay).toContain('id="app-version-label"');
    expect(html.slice(html.indexOf('id="mode-bar"'), html.indexOf('<!-- FOCUS')).includes('app-version-label')).toBe(false);
  });
  it('la notice IA est relisible (showAiPrivacyNotice) et réutilisée au premier usage', () => {
    const p = read('js/profiles.js');
    expect(p).toContain('function showAiPrivacyNotice()');
    expect(p).toMatch(/async function notifyThirdPartyDataUseOnce\(\) \{[\s\S]*?await showAiPrivacyNotice\(\);/);
  });
  it('⓵ seulement 5 icônes ⓘ possibles ; texte d\'aide corrigé (plus de « menu 🤖 IA » dans la barre)', () => {
    const f = read('js/fulltour.js');
    const set = f.match(/const HELP_ICON_TITLES = new Set\(\[([^\]]*)\]\)/)[1].split(',').filter(s => s.trim());
    expect(set.length).toBe(5);
    expect(f).toContain('if (!HELP_ICON_TITLES.has(step.title)) return;');
    expect(read('js/notifications.js')).not.toContain('(menu 🤖 IA)');
    expect(read('js/notifications.js')).toContain('bandeau du bas (« IA »)');
  });
  it('les étapes de la visite guidée visent les nouveaux identifiants', () => {
    const f = read('js/fulltour.js');
    for (const id of ['#tb-structure-btn', '#focus-btn', '#tb-tools-btn', '#tb-search-btn']) expect(f).toContain(`target:'${id}'`);
    expect(f).not.toContain("clickFirst:'.toolbar-dropdown-btn.u-bg-h34495e'");
  });
});

describe('AUD-03-011 — invite d\'écriture', () => {
  const code = editor.slice(editor.indexOf('function updateWriterEmpty'), editor.indexOf('// v9.47.0 (AUD-03-036)'));
  function ctx({ fine = true, bodyClass = '', active = null } = {}) {
    const dom = new JSDOM(`<body class="${bodyClass}"><input id="autre"><div id="writer" contenteditable="true"></div></body>`, { runScripts: 'outside-only' });
    const win = dom.window;
    win.matchMedia = q => ({ matches: q.includes('fine') ? fine : !fine });
    const c = dom.getInternalVMContext(); new vm.Script(code).runInContext(c);
    if (active) win.document.getElementById(active).focus();
    return { win, d: win.document, run: s => new vm.Script(s).runInContext(c) };
  }
  it('is-empty tant qu\'il n\'y a ni texte ni image ; retiré dès qu\'il y a du contenu', () => {
    const { d, run } = ctx(); const w = d.getElementById('writer');
    run('updateWriterEmpty()'); expect(w.classList.contains('is-empty')).toBe(true);
    w.innerHTML = '<p>​</p>'; run('updateWriterEmpty()'); expect(w.classList.contains('is-empty')).toBe(true);
    w.innerHTML = '<p>Bonjour</p>'; run('updateWriterEmpty()'); expect(w.classList.contains('is-empty')).toBe(false);
    w.innerHTML = '<p><img src="x"></p>'; run('updateWriterEmpty()'); expect(w.classList.contains('is-empty')).toBe(false);
  });
  it('focus automatique : chapitre vide, souris/trackpad seulement, jamais depuis un champ de saisie, jamais en bibliothèque', () => {
    let c = ctx(); c.run('updateWriterEmpty(); focusWriterIfEmpty()'); expect(c.d.activeElement.id).toBe('writer');
    c = ctx({ fine: false }); c.run('updateWriterEmpty(); focusWriterIfEmpty()'); expect(c.d.activeElement.id).not.toBe('writer');
    c = ctx({ active: 'autre' }); c.run('updateWriterEmpty(); focusWriterIfEmpty()'); expect(c.d.activeElement.id).toBe('autre');
    c = ctx({ bodyClass: 'library-mode' }); c.run('updateWriterEmpty(); focusWriterIfEmpty()'); expect(c.d.activeElement.id).not.toBe('writer');
  });
  it('invite affichée par le CSS et appelée à chaque frappe et à chaque chargement de chapitre', () => {
    expect(html).toContain('data-placeholder="Commencez à écrire ici… (touche ? pour l\'aide)"');
    expect(css).toContain('#writer.is-empty::before{content:attr(data-placeholder);');
    expect(editor).toMatch(/function liveCounter\(\) \{\s*if \(_switching\) return;\s*updateWriterEmpty\(\);/);
    expect(editor).toContain('updateWriterEmpty(); focusWriterIfEmpty();');
  });
});

describe('AUD-03-036 — filtre des chapitres', () => {
  const code = editor.slice(editor.indexOf('function chapterFilterValue'), editor.indexOf('\n}', editor.indexOf('function applyChapterFilter')) + 2);
  function ctx(n) {
    const items = Array.from({ length: n }, (_, i) => `<div class="chapter-item" data-idx="${i}"></div>`).join('');
    const dom = new JSDOM(`<body><div id="chapter-filter-wrap" hidden><input id="chapter-filter"><span id="chapter-filter-count"></span></div><div id="chapter-list">${items}</div><div id="corkboard-view"></div></body>`, { runScripts: 'outside-only' });
    const c = dom.getInternalVMContext(); const d = dom.window.document;
    new vm.Script(`var db = { chapters: [${Array.from({ length: n }, (_, i) => `{ title: 'Chapitre ${i + 1}', tags: [] }`).join(',')}] };
      db.chapters[2].title = 'La bataille du pont'; db.chapters[4].tags = ['Flashback']; ${code}`).runInContext(c);
    const run = s => new vm.Script(s).runInContext(c);
    const setQ = v => { d.getElementById('chapter-filter').value = v; run('applyChapterFilter()'); };
    const visible = () => [...d.querySelectorAll('.chapter-item')].filter(e => !e.hidden).map(e => e.dataset.idx);
    return { d, run, setQ, visible };
  }
  it('le champ n\'apparaît qu\'à partir de 8 chapitres', () => {
    let c = ctx(7); c.run('applyChapterFilter()'); expect(c.d.getElementById('chapter-filter-wrap').hidden).toBe(true);
    c = ctx(9); c.run('applyChapterFilter()'); expect(c.d.getElementById('chapter-filter-wrap').hidden).toBe(false);
  });
  it('filtre par titre ou par étiquette, sans tenir compte de la casse, avec compteur « x/N »', () => {
    const c = ctx(9);
    c.setQ('BATAILLE'); expect(c.visible()).toEqual(['2']); expect(c.d.getElementById('chapter-filter-count').textContent).toBe('1/9');
    c.setQ('flash'); expect(c.visible()).toEqual(['4']);
    c.setQ('chapitre'); expect(c.visible().length).toBe(8); // tous sauf « La bataille du pont »
    c.setQ(''); expect(c.visible().length).toBe(9); expect(c.d.getElementById('chapter-filter-count').textContent).toBe('');
  });
  it('un filtre actif reste visible même avec moins de 8 chapitres ; glisser-déposer et Alt+↑/↓ sont désactivés', () => {
    const c = ctx(5); c.setQ('bataille'); expect(c.d.getElementById('chapter-filter-wrap').hidden).toBe(false);
    expect(editor).toContain("if (e.target.closest('.ch-rename-input') || chapterFilterValue()) { e.preventDefault(); return; }");
    expect(editor).toContain("if(e.altKey && !chapterFilterValue() && (e.key==='ArrowUp'");
  });
});

describe('AUD-03-031 — tension expliquée', () => {
  it('libellé « Tension du chapitre : n/100 » avec infobulle, valeur tenue à jour', () => {
    expect(html).toMatch(/<label for="tension-slider" title="Intensité dramatique[^"]*">Tension du chapitre : <strong id="tension-value">20<\/strong>\/100<\/label>/);
    expect(editor).toContain("const tv = document.getElementById('tension-value'); if (tv) tv.textContent = String(parseInt(v));");
    expect(editor).toContain("const tv = document.getElementById('tension-value'); if (tv) tv.textContent = s.value;");
  });
});

describe('AUD-03-012 — largeur du texte', () => {
  const dom = () => {
    const d = new JSDOM('<body><div id="textwidth-picker"><button class="mode-indicator" data-width="normale"></button><button class="mode-indicator" data-width="large"></button></div></body>', { runScripts: 'outside-only', url: 'http://localhost/' });
    const c = d.getInternalVMContext(); new vm.Script(read('js/notifications.js')).runInContext(c);
    return { win: d.window, run: s => new vm.Script(s).runInContext(c) };
  };
  it('défaut « normale », choix mémorisé, valeur inconnue ignorée', () => {
    const { win, run } = dom();
    expect(win.document.documentElement.dataset.textWidth).toBe('normale');
    run("selectTextWidth('large')");
    expect(win.document.documentElement.dataset.textWidth).toBe('large');
    expect(win.localStorage.getItem('plume_text_width')).toBe('large');
    expect(win.document.querySelector('[data-width=large]').classList.contains('active')).toBe(true);
    win.localStorage.setItem('plume_text_width', 'zzz');
    expect(run('loadTextWidth()')).toBe('normale');
  });
  it('le CSS centre le texte et borne la largeur (44 rem ≈ 72 caractères par défaut)', () => {
    expect(css).toContain('html{--text-w:44rem;}');
    expect(css).toContain('html[data-text-width="pleine"]{--text-w:none;}');
    expect(css).toContain('#writer,#chapter-title-row,#chapter-notes-panel{max-width:var(--text-w);margin-left:auto;margin-right:auto;width:100%;}');
    for (const w of ['etroite', 'normale', 'large', 'pleine']) expect(html).toContain(`data-width="${w}"`);
  });
});

describe('AUD-03-033 — pied de page', () => {
  it('état d\'enregistrement et de synchro regroupés à gauche ; plus de « Prêt » ni de version dans le bandeau', () => {
    const bar = html.slice(html.indexOf('id="mode-bar"'), html.indexOf('<!-- FOCUS'));
    expect(bar.indexOf('id="sync-status-dot-wrap"')).toBeLessThan(bar.indexOf('id="toggle-dark-btn"'));
    expect(bar.indexOf('id="autosave-label"')).toBeLessThan(bar.indexOf('id="sync-status-dot-wrap"'));
    expect(bar).toContain('id="dictate-status"></span>');
    expect(bar).not.toContain('Prêt');
    expect(css).toContain('#dictate-status:empty{display:none;}');
    expect(read('js/tts.js')).toContain("getElementById('dictate-status').textContent = '';");
  });
  it('libellés de synchro explicites', () => {
    const r = read('js/router.js');
    expect(r).toContain("label.textContent = 'Local seulement'");
    expect(r).toContain("label.innerHTML = icon('cloud') + ' Synchronisé'");
    expect(r).toContain("label.innerHTML = icon('triangle-alert') + ' Échec de synchro'");
  });
});
