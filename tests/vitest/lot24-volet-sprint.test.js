// ════════════════════════════════════════════════════════════════════
// LOT F « volet latéral et sprint » (v9.46.0, audit AUD-03-003, 013)
//  • le panneau de 500 px au-dessus du texte devient un volet à droite (3e colonne de <main>) ;
//  • le sprint s'affiche en pied de page et sa fin est annoncée.
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

describe('AUD-03-003 — structure du volet', () => {
  it('le conteneur des onglets est dans <main> (3e colonne), plus dans <header>', () => {
    const iMain = html.indexOf('<main'), iEnd = html.indexOf('</main>'), iHeader = html.indexOf('</header>');
    const iTab = html.indexOf('id="tab-container"');
    expect(iTab).toBeGreaterThan(iMain);
    expect(iTab).toBeLessThan(iEnd);
    expect(iHeader).toBeLessThan(iMain);
    expect(html).toContain('id="panel-resizer"');
    expect(html).toContain('id="panel-close-btn"');
    expect(html).toContain('← Retour au texte');
  });
  it('plus de panneau de 500 px qui repousse le texte ; grille à trois colonnes ; plein écran sur téléphone', () => {
    expect(css).not.toContain('height:500px');
    expect(css).toMatch(/main\.has-panel\{grid-template-columns:270px minmax\(0,1fr\) var\(--panel-w,clamp\(320px,32vw,420px\)\);\}/);
    expect(css).toMatch(/@media \(max-width:768px\)\{\s*main\.has-panel\{grid-template-columns:minmax\(0,1fr\);\}\s*#tab-container\.open\{position:fixed;inset:0;/);
    expect(css).toContain('#tab-container .db-grid{grid-template-columns:1fr;height:auto;overflow:visible;}');
  });
});

describe('AUD-03-003 — comportement du volet (tabs.js)', () => {
  function app() {
    const dom = new JSDOM(`<body><main><div id="editor"></div>
      <div id="tab-container"><div id="panel-resizer" tabindex="0"></div><strong id="panel-title"></strong><button id="panel-close-btn"></button>
        <div id="tab-univers" class="tab-content"></div><div id="tab-config" class="tab-content"></div></div></main>
      <nav id="tab-menu"><button class="tab-btn" id="b1" data-tab-id="tab-univers">Univers</button><button class="tab-btn" id="b2" data-tab-id="tab-config">Config</button></nav></body>`,
      { runScripts: 'outside-only', url: 'http://localhost/' });
    const ctx = dom.getInternalVMContext();
    new vm.Script(`
      var db = {}; var tabLabels = {}; var tabDescriptions = {}; var _indexBuilt = false;
      function renderWeakWords(){} function updateGoalsUI(){} function renderLibrary(){} function renderQuests(){} function populateTimelineChapterSel(){}
      function renderTimeline(){} function renderGraph(){} function renderStats(){} function renderWordCloud(){} function renderAnalytics(){} function updateChart(){}
      function renderHistoryTab(){} function renderPlugins(){} function debouncedSave(){}
    `).runInContext(ctx);
    new vm.Script(read('js/icons.js')).runInContext(ctx);
    new vm.Script(read('js/tabs.js')).runInContext(ctx);
    return { win: dom.window, d: dom.window.document, run: s => new vm.Script(s).runInContext(ctx) };
  }
  const state = d => ({ open: d.getElementById('tab-container').classList.contains('open'), main: d.querySelector('main').classList.contains('has-panel'), body: d.body.classList.contains('panel-open') });

  it('ouvrir un onglet ouvre le volet (titre, aria-expanded) ; recliquer le ferme ; un autre onglet le garde ouvert', () => {
    const { d, run } = app();
    run("toggleTab('tab-univers', document.getElementById('b1'))");
    expect(state(d)).toEqual({ open: true, main: true, body: true });
    expect(d.getElementById('panel-title').textContent).toBe('Univers');
    expect(d.getElementById('b1').getAttribute('aria-expanded')).toBe('true');
    run("toggleTab('tab-config', document.getElementById('b2'))");
    expect(state(d).open).toBe(true);
    expect(d.getElementById('b1').getAttribute('aria-expanded')).toBe('false');
    expect(d.getElementById('panel-title').textContent).toBe('Config');
    run("toggleTab('tab-config', document.getElementById('b2'))");
    expect(state(d)).toEqual({ open: false, main: false, body: false });
  });
  it('closeSidePanel : referme tout et rend le focus à l\'onglet qui l\'avait ouvert', () => {
    const { d, run } = app();
    run("toggleTab('tab-univers', document.getElementById('b1'))");
    run('closeSidePanel(true)');
    expect(state(d).open).toBe(false);
    expect(d.activeElement.id).toBe('b1');
    expect(d.querySelectorAll('.tab-btn.active, .tab-content.active').length).toBe(0);
  });
  it('largeur : bornée (320 px au minimum, 60 % de l\'écran au maximum), mémorisée, relue', () => {
    const { win, d, run } = app();
    Object.defineProperty(win, 'innerWidth', { value: 1000, configurable: true });
    expect(run('setPanelWidth(100, true)')).toBe(320);
    expect(run('setPanelWidth(5000, true)')).toBe(600);
    expect(run('setPanelWidth(450, true)')).toBe(450);
    expect(win.localStorage.getItem('plume_panel_w')).toBe('450');
    expect(d.querySelector('main').style.getPropertyValue('--panel-w')).toBe('450px');
    run('initSidePanel()'); // relit la valeur mémorisée
    expect(d.querySelector('main').style.getPropertyValue('--panel-w')).toBe('450px');
  });
  it('la poignée se règle aussi au clavier (flèches) et le bouton ✕ ferme le volet', () => {
    const { win, d, run } = app();
    Object.defineProperty(win, 'innerWidth', { value: 1400, configurable: true });
    run("toggleTab('tab-univers', document.getElementById('b1')); initSidePanel();");
    const cont = d.getElementById('tab-container');
    cont.getBoundingClientRect = () => ({ width: 400, right: 1000, left: 600 });
    d.getElementById('panel-resizer').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    expect(d.getElementById('panel-resizer').getAttribute('aria-valuenow')).toBe('424');
    d.getElementById('panel-close-btn').click();
    expect(state(d).open).toBe(false);
  });
});

describe('AUD-03-003 — Échap ferme le volet en dernier', () => {
  const src = read('js/router.js');
  const code = src.slice(src.indexOf('function _isOn('), src.indexOf("document.addEventListener('keydown', escapeArbiter, true);"));
  it('avec le volet et le chat IA ouverts : un Échap ferme le chat, le suivant le volet', () => {
    const dom = new JSDOM('<body><div id="ai-chat-panel" class="active"></div><div id="tab-container" class="open"></div></body>', { runScripts: 'outside-only' });
    const ctx = dom.getInternalVMContext(); const win = dom.window; win.closed = [];
    new vm.Script(`
      function closeAiChat(){ closed.push('chat'); document.getElementById('ai-chat-panel').classList.remove('active'); }
      function closeSidePanel(f){ closed.push('volet' + (f ? '+focus' : '')); document.getElementById('tab-container').classList.remove('open'); }
      function closeFindReplace(){} function closeLibrarySystemPanel(){} function closeShortcutsHelp(){} function exitFocus(){} function exitReadingMode(){}
      function closeGlobalSearch(){} function closeTrash(){} function closeDocTrash(){} function closeMyProfile(){} function closeManageProfiles(){}
      function closeGistHistory(){} function closeExportSelect(){} function closeDocxImportModal(){} function closeConflictDiff(){}
      ${code}
      document.addEventListener('keydown', escapeArbiter, true);
    `).runInContext(ctx);
    const esc = () => win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    esc(); expect(win.closed).toEqual(['chat']);
    esc(); expect(win.closed).toEqual(['chat', 'volet+focus']);
  });
  it('la fin d\'une visite guidée referme le volet via closeSidePanel', () => {
    expect(read('js/fulltour.js')).toContain('else { closeSidePanel(false); }');
  });
});

describe('AUD-03-013 — sprint visible et fin annoncée (stats.js)', () => {
  function sprintApp() {
    const dom = new JSDOM(`<body><div id="writer"></div><div id="sprint-timer"></div><div id="sprint-progress"></div>
      <button hidden id="sprint-chip"><span id="sprint-chip-time"></span><span id="sprint-chip-words"></span></button></body>`, { runScripts: 'outside-only' });
    const ctx = dom.getInternalVMContext(); const win = dom.window;
    win.toasts = []; win.ticks = [];
    win.setInterval = fn => { win.ticks.push(fn); return win.ticks.length; };
    win.clearInterval = () => {};
    new vm.Script(`
      var db = { sprint: null, chapters: [] }; var sprintInterval = null, sprintWordsStart = 0; var saves = 0;
      function save(){ saves++; } function getWordCount(t){ return (t || '').trim() ? t.trim().split(/\\s+/).length : 0; }
      function toast(m, t, o){ toasts.push({ m, t, o }); }
    `).runInContext(ctx);
    new vm.Script(read('js/stats.js')).runInContext(ctx);
    return { win, d: win.document, run: s => new vm.Script(s).runInContext(ctx) };
  }
  it('démarrer un sprint affiche la pastille « mm:ss · +mots » dans le pied de page', () => {
    const { win, d, run } = sprintApp();
    d.getElementById('writer').innerText = 'un deux trois';
    run('startSprint()');
    const chip = d.getElementById('sprint-chip');
    expect(chip.hidden).toBe(false);
    expect(d.getElementById('sprint-chip-time').textContent).toBe('25:00');
    expect(d.getElementById('sprint-chip-words').textContent).toBe('+0');
    d.getElementById('writer').innerText = 'un deux trois quatre cinq';
    win.ticks.at(-1)();
    expect(d.getElementById('sprint-chip-words').textContent).toBe('+2');
  });
  it('à l\'échéance : annonce « Sprint terminé : +N mots » qui reste affichée, et masque la pastille', () => {
    const { win, d, run } = sprintApp();
    d.getElementById('writer').innerText = 'un deux';
    run('startSprint()');
    d.getElementById('writer').innerText = 'un deux trois quatre cinq six';
    run('db.sprint.endTime = Date.now() - 1000');
    win.ticks.at(-1)();
    const last = win.toasts.at(-1);
    expect(last.m).toMatch(/^Sprint terminé : \+4 mots en 25 minutes/);
    expect(last.o).toEqual({ sticky: true, kind: 'sprint' });
    expect(d.getElementById('sprint-chip').hidden).toBe(true);
    expect(run('db.sprint')).toBeNull();
  });
  it('un sprint expiré pendant une absence est annoncé à la reprise', () => {
    const { win, d, run } = sprintApp();
    run('db.sprint = { endTime: Date.now() - 5000, wordsStart: 0 }; resumeSprintIfNeeded();');
    expect(win.toasts.at(-1).m).toMatch(/sprint d'écriture est terminé/);
    expect(d.getElementById('sprint-chip').hidden).toBe(true);
  });
  it('lancement depuis le menu Outils et ouverture de Config → Sprint par la pastille', () => {
    const r = read('js/router.js');
    expect(html).toContain('id="sprint-start-menu-btn"');
    expect(r).toContain("startSprint(); });");
    expect(r).toContain("openTabOrSubtab('tab-sprint')");
  });
});
