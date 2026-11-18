// ═══════════════════════════════════════════════════════
// LOT 6 de l'audit AUD-10 (v9.95.0) : accueil par la pratique (011) et niveaux d'usage (012).
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

const TABS = ['tab-univers', 'tab-ia-memoire', 'tab-analysegroup', 'tab-systeme', 'tab-config'];
const SUBS = ['tab-chars', 'tab-places', 'tab-quests', 'tab-timeline', 'tab-graph', 'tab-ai', 'tab-memory', 'tab-stats', 'tab-wordcloud', 'tab-analytics', 'tab-map', 'tab-history', 'tab-plugins', 'tab-config-main', 'tab-sprint'];
function page(stockage = {}) {
  const dom = new JSDOM(`<body>
    <nav id="tab-menu">${TABS.map(t => `<button class="tab-btn" data-tab-id="${t}">${t}</button>`).join('')}</nav>
    <select id="usage-level-sel"><option value="debuter"></option><option value="ecrire"></option><option value="tout"></option></select>
    <aside id="missions-card" hidden><button data-level="debuter"></button><button data-level="ecrire"></button><button data-level="tout"></button>
      <ol id="missions-list"></ol><div id="missions-progress"></div></aside>
  </body>`, { runScripts: 'outside-only' });
  const win = dom.window; win.toasts = []; win.store = stockage; win.saved = 0;
  Object.defineProperty(win, 'localStorage', { configurable: true, value: { getItem: k => (k in stockage ? stockage[k] : null), setItem: (k, v) => { stockage[k] = String(v); } } });
  const ctx = dom.getInternalVMContext(), run = c => new vm.Script(c).runInContext(ctx);
  run(`
    function toast(m, t) { toasts.push({ m, t }); } function icon(n) { return '<svg data-i="' + n + '"></svg>'; }
    function plur(n, s, p) { return Math.abs(n) >= 2 ? p : s; } function chapterWordCount(ch) { return (ch.t || '').split(/\\s+/).filter(Boolean).length; }
    var db = { chapters: [{ t: '' }] }, cur = 0, _currentProfileId = 'p1';
    async function loadProfilesIndex() { return { profiles: [{ id: 'p1', onboardingDone: false }] }; }
    async function saveProfilesIndex(i) { saved++; lastIndex = i; } var lastIndex = null;
    function enterReadingMode() { missionDone('read'); }
    function openTabOrSubtab() {}
  `);
  // Les onglets de premier niveau et les sous-onglets sont posés comme dans index.html.
  const d = win.document;
  const cats = TABS.map(t => { const c = d.createElement('div'); c.className = 'tab-content'; c.id = t; d.body.appendChild(c); return c; });
  SUBS.forEach(s => { const b = d.createElement('button'); b.className = 'subtab-btn'; b.dataset.subtab = s; d.body.appendChild(b); });
  void cats;
  run(read('js/tabs.js').slice(read('js/tabs.js').indexOf('const LEVEL_KEY'), read('js/tabs.js').indexOf('function renderTabs')));
  const nt = read('js/notifications.js');
  run(nt.slice(nt.indexOf('const MISSIONS = ['), nt.indexOf('// ═══════════════════════════════════════════════════════\n// MODALE DE CONFIRMATION STYLÉE')));
  return { win, d, run, store: stockage };
}
const cache = d => ({ tabs: [...d.querySelectorAll('.tab-btn')].filter(b => b.hidden).map(b => b.dataset.tabId), subs: [...d.querySelectorAll('.subtab-btn')].filter(b => b.hidden).map(b => b.dataset.subtab) });

describe('AUD-10-012 : niveaux d\'usage', () => {
  it('par défaut « Tout voir » : rien n\'est masqué (aucun changement sans choix)', () => {
    const { d, run } = page();
    expect(run('usageLevel()')).toBe('tout');
    run('applyUsageLevel()');
    expect(cache(d)).toEqual({ tabs: [], subs: [] });
  });
  it('Débuter : IA & Mémoire et Analyse masqués, et les sous-onglets de périphérie ; l\'essentiel reste', () => {
    const { d, run, store } = page();
    run("setUsageLevel('debuter')");
    expect(store.plume_level).toBe('debuter');
    expect(cache(d).tabs).toEqual(['tab-ia-memoire', 'tab-analysegroup']);
    expect(cache(d).subs.sort()).toEqual(['tab-analytics', 'tab-graph', 'tab-memory', 'tab-plugins', 'tab-timeline', 'tab-wordcloud']);
    for (const t of ['tab-univers', 'tab-systeme', 'tab-config']) expect(cache(d).tabs).not.toContain(t);
    for (const s of ['tab-chars', 'tab-places', 'tab-quests', 'tab-history', 'tab-config-main', 'tab-sprint']) expect(cache(d).subs).not.toContain(s);
  });
  it('Écrire : tous les onglets, mais pas la périphérie ; IA, Stats et Structure restent', () => {
    const { d, run } = page();
    run("setUsageLevel('ecrire')");
    expect(cache(d).tabs).toEqual([]);
    expect(cache(d).subs).not.toContain('tab-ai'); expect(cache(d).subs).not.toContain('tab-stats'); expect(cache(d).subs).not.toContain('tab-map');
    expect(cache(d).subs).toContain('tab-memory');
  });
  it('revenir à « Tout voir » rend tout ; le sélecteur de Config suit ; un niveau inconnu est refusé', () => {
    const { d, run, store } = page();
    run("setUsageLevel('debuter'); setUsageLevel('tout')");
    expect(cache(d)).toEqual({ tabs: [], subs: [] });
    expect(d.getElementById('usage-level-sel').value).toBe('tout');
    run("setUsageLevel('n-importe-quoi')");
    expect(store.plume_level).toBe('tout');
  });
  it('la visite complète traverse TOUTES les sections (niveau forcé), puis le niveau choisi revient', () => {
    const { d, run } = page();
    run("setUsageLevel('debuter')");
    run("setUsageLevelOverride('tout')");
    expect(cache(d)).toEqual({ tabs: [], subs: [] });
    expect(d.getElementById('usage-level-sel').value).toBe('debuter');
    run('setUsageLevelOverride(null)');
    expect(cache(d).tabs.length).toBe(2);
  });
  it('un stockage indisponible ne casse rien : le niveau vaut pour la session', () => {
    const { win, d, run } = page();
    Object.defineProperty(win, 'localStorage', { configurable: true, value: { getItem() { throw new Error('bloqué'); }, setItem() { throw new Error('bloqué'); } } });
    expect(run('usageLevel()')).toBe('tout');
    expect(() => run("setUsageLevel('debuter')")).not.toThrow();
    expect(run('usageLevel()')).toBe('debuter');
    expect(cache(d).tabs.length).toBe(2);
  });
  it('une section masquée qu\'on tente d\'ouvrir est annoncée, jamais ignorée en silence', () => {
    const t = read('js/tabs.js');
    expect(t).toContain("if (hiddenByLevel(topId) || hiddenByLevel(id)) { toast('Cette section est masquée au niveau « '");
    expect(t).toContain('Changez de niveau dans Config → Réglages.');
  });
  it('renderTabs réapplique le niveau ; la visite l\'écarte pendant son déroulement', () => {
    expect(read('js/tabs.js')).toMatch(/nav\.appendChild\(btn\);\n  \}\);\n  applyUsageLevel\(\);/);
    const f = read('js/fulltour.js');
    expect(f).toContain("setUsageLevelOverride('tout')");
    expect(f).toContain('setUsageLevelOverride(null)');
  });
  it('le niveau est propre à l\'appareil : aucun champ de manuscrit', () => {
    expect(read('js/schema.js')).not.toMatch(/plume_level|usageLevel/);
  });
});

describe('AUD-10-011 : missions « Premiers pas »', () => {
  it('trois missions, une carte visible seulement quand elles sont actives', () => {
    const { d, run } = page();
    expect(d.getElementById('missions-card').hidden).toBe(true);
    run('startOnboardingTour()');
    expect(d.getElementById('missions-card').hidden).toBe(false);
    expect(d.querySelectorAll('#missions-list li')).toHaveLength(3);
    expect(d.getElementById('missions-progress').textContent).toBe('0 sur 3');
  });
  it('écrire trois mots valide la mission « écrire » (pas avant)', () => {
    const { d, run } = page();
    run('startOnboardingTour()');
    run("db.chapters[0].t = 'un deux'; missionsOnType()");
    expect(d.getElementById('missions-progress').textContent).toBe('0 sur 3');
    run("db.chapters[0].t = 'un deux trois'; missionsOnType()");
    expect(d.getElementById('missions-progress').textContent).toBe('1 sur 3');
    expect(d.querySelector('#missions-list li.done .mission-text').textContent).toMatch(/\(fait\)/);
  });
  it('les trois missions faites : félicitation factuelle, carte fermée, profil marqué « premiers pas vus »', async () => {
    const { win, d, run } = page();
    run('startOnboardingTour()');
    run("db.chapters[0].t = 'un deux trois'; missionsOnType(); missionDone('char'); enterReadingMode();");
    await new Promise(r => setTimeout(r, 20));
    expect(d.getElementById('missions-card').hidden).toBe(true);
    expect(win.toasts.at(-1).m).toMatch(/Premiers pas terminés/);
    expect(win.saved).toBe(1);
    expect(JSON.parse(run('JSON.stringify(lastIndex)')).profiles[0].onboardingDone).toBe(true);
  });
  it('« Passer » ferme la carte et marque le profil ; une mission validée hors carte active ne fait rien', async () => {
    const { win, d, run } = page();
    run("missionDone('read')");
    expect(win.saved).toBe(0);
    run('startOnboardingTour()');
    run('endOnboardingTour()');
    await new Promise(r => setTimeout(r, 20));
    expect(d.getElementById('missions-card').hidden).toBe(true);
    expect(win.saved).toBe(1);
  });
  it('la progression est mémorisée sur l\'appareil ; « Revoir les premiers pas » repart de zéro', () => {
    const { d, run, store } = page();
    run('startOnboardingTour()');
    run("missionDone('char')");
    expect(JSON.parse(store.plume_missions)).toEqual(['char']);
    run('startOnboardingTour()');
    expect(d.getElementById('missions-progress').textContent).toBe('1 sur 3');
    run('startOnboardingTour(true)');
    expect(d.getElementById('missions-progress').textContent).toBe('0 sur 3');
    expect(JSON.parse(store.plume_missions)).toEqual([]);
  });
  it('le choix du niveau est proposé dans la carte (aria-pressed suit le niveau)', () => {
    const { d, run } = page();
    run('startOnboardingTour()');
    expect(d.querySelector('[data-level="tout"]').getAttribute('aria-pressed')).toBe('true');
    run("setUsageLevel('ecrire')");
    expect(d.querySelector('[data-level="ecrire"]').getAttribute('aria-pressed')).toBe('true');
    expect(d.querySelector('[data-level="tout"]').getAttribute('aria-pressed')).toBe('false');
  });
  it('branchements : mission « personnage » (database.js), « Lecture » (editor.js), frappe (editor.js), aide, anciennes bulles retirées', () => {
    expect(read('js/database.js')).toContain("if(k==='chars')missionDone('char');");
    expect(read('js/editor.js')).toContain("missionDone('read');");
    expect(read('js/editor.js')).toContain('missionsOnType();');
    expect(read('js/router.js')).toContain('startOnboardingTour(true)');
    expect(read('js/router.js')).toContain("getElementById('missions-skip-btn').addEventListener('click',endOnboardingTour)");
    const h = read('index.html');
    expect(h).toContain('<aside id="missions-card" aria-label="Premiers pas" hidden>');
    expect(h).not.toContain('onboarding-tour-bubble');
    expect(read('js/notifications.js')).not.toMatch(/ONBOARDING_STEPS|showOnboardingStep|onboardingNext/);
  });
  it('la carte est masquée hors éditeur de texte et à l\'impression', () => {
    const css = read('css/style.css');
    expect(css).toContain('body.library-mode #missions-card,body.graphicnovel-mode #missions-card{display:none;}');
    expect(css).toMatch(/#missions-card,#chapter-notes-panel,\[id\$="-overlay"\]/);
  });
});

describe('AUD-10-011 : projet d\'exemple', () => {
  const lire = async () => (await import('../../js/exemple.js'));
  it('trois chapitres, deux personnages, deux lieux, une intrigue, une remarque et une passe, tous avec des identifiants distincts', async () => {
    const m = await lire(); let n = 0;
    const e = m.buildExample(() => 'id' + (++n), '2026-11-19');
    expect(e.title).toBe(m.TITRE_EXEMPLE);
    expect(e.chapters).toHaveLength(3); expect(e.chars).toHaveLength(2); expect(e.places).toHaveLength(2); expect(e.quests).toHaveLength(1);
    const ids = [...e.chapters, ...e.chars, ...e.places, ...e.quests].map(x => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(e.chapters[1].remarks[0].q).toBe("lentement jusqu'à la place");
    expect(e.chapters[1].content).toContain("lentement jusqu'à la place");
    expect(e.chapters[1].passes.structure).toBe('2026-11-19');
    expect(e.chapters.every(c => ['draft', 'review', 'final'].includes(c.status))).toBe(true);
  });
  it('le texte de l\'exemple contient de quoi essayer les outils (mots faibles, répétition)', async () => {
    const m = await lire();
    const e = m.buildExample(() => 'x', '2026-11-19');
    const tout = e.chapters.map(c => c.content).join(' ');
    expect(tout).toMatch(/très/); expect(tout).toMatch(/juste/);
    expect((tout.match(/lentement/g) || []).length).toBeGreaterThanOrEqual(3);
  });
  it('création = un projet comme un autre : même fonction que « Nouveau projet », liste de la bibliothèque à jour, chargement à la demande', () => {
    const lib = read('js/library.js');
    expect(lib).toContain('async function createNewTextDocument(preset) {');
    expect(lib).toContain('chapterCount:dbData.chapters.length, wordCount:chaptersTotalWords(dbData.chapters)');
    expect(lib).toContain("await import('./exemple.js')");
    expect(read('js/graphicnovel.js')).toContain('createExampleDocument(); }); // AUD-10-011');
    expect(read('sw.js')).toContain("'./js/exemple.js'");
    expect(read('index.html')).not.toContain('exemple.js'); // jamais un script classique de plus (AUD-09-011)
  });
});
