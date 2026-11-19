// ═══════════════════════════════════════════════════════
// LOT 7 de l'audit AUD-10 (v9.96.0) : aide à la planification (AUD-10-013) — modèle de plan facultatif sur la courbe de tension,
// repères d'échelle du curseur, fiche de scène (but, obstacle, enjeu).
// (AUD-10-001, -016 et -020 : refusés par le propriétaire le 19/11/2026, non traités.)
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

function app(chapters, stockage = {}) {
  const dom = new JSDOM(`<body><select id="plan-model-sel"><option value="aucun"></option><option value="actes"></option><option value="heros"></option></select>
    <input id="scene-but"><input id="scene-obstacle"><input id="scene-enjeu"><canvas id="tensionChart"></canvas><div id="chart-data-tensionChart"></div></body>`, { runScripts: 'outside-only' });
  const win = dom.window; win.saves = 0; win.alts = []; win.updates = 0;
  Object.defineProperty(win, 'localStorage', { configurable: true, value: { getItem: k => (k in stockage ? stockage[k] : null), setItem: (k, v) => { stockage[k] = String(v); } } });
  const ctx = dom.getInternalVMContext(), run = c => new vm.Script(c).runInContext(ctx);
  run(`
    var db = { chapters: ${JSON.stringify(chapters)} }, cur = 0;
    function debouncedSave() { saves++; } function chartPalette() { return ['#111111', '#222222']; }
    function setChartAlt(id, title, headers, rows) { alts.push({ id, title, headers, rows }); }
    var tensionChart = { data: { labels: [], datasets: [{ data: [] }] }, options: { plugins: { legend: { display: false } } }, update() { updates++; } };
  `);
  const dbj = read('js/database.js');
  run(dbj.slice(dbj.indexOf('const PLAN_MODELS'), dbj.indexOf('function updateChart()')) + '\n' + dbj.slice(dbj.indexOf('function updateChart()'), dbj.indexOf('\n', dbj.indexOf('function updateChart()'))));
  const ed = read('js/editor.js');
  run(ed.slice(ed.indexOf('const SCENE_FIELDS'), ed.indexOf('function onPassToggle')));
  return { win, d: win.document, run, store: stockage };
}
const CH = n => Array.from({ length: n }, (_, i) => ({ id: 'c' + i, title: 'Ch ' + (i + 1), tension: 20 }));

describe('AUD-10-013 : modèles de plan, repère visuel facultatif', () => {
  it('par défaut « Aucun » : aucune courbe de modèle, légende masquée', () => {
    const { run } = app(CH(5));
    expect(run('planModel()')).toBe('aucun');
    expect(run("planModelCurve('aucun', 5)")).toBeNull();
    run('applyPlanModelToChart()');
    expect(run('tensionChart.data.datasets.length')).toBe(1);
    expect(run('tensionChart.options.plugins.legend.display')).toBe(false);
  });
  it('la courbe s\'adapte au nombre de chapitres : mêmes extrémités, sommet vers 90 %, valeurs entre 0 et 100', () => {
    const { run } = app(CH(3));
    for (const id of ['actes', 'heros']) for (const n of [1, 2, 3, 10, 40]) {
      const c = JSON.parse(run(`JSON.stringify(planModelCurve('${id}', ${n}))`));
      expect(c).toHaveLength(n);
      for (const v of c) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
    }
    const c = JSON.parse(run("JSON.stringify(planModelCurve('actes', 21))"));
    expect(c[0]).toBe(15); expect(c[20]).toBe(35);
    expect(c.indexOf(Math.max(...c))).toBe(18); // 0,9 × 20
    expect(Math.max(...c)).toBe(100);
  });
  it('choisir un modèle le mémorise sur l\'appareil, trace la courbe en pointillés et affiche la légende', () => {
    const { run, d, store, win } = app(CH(6));
    run("setPlanModel('heros')");
    expect(store.plume_plan_model).toBe('heros');
    expect(d.getElementById('plan-model-sel').value).toBe('heros');
    const ds = JSON.parse(run('JSON.stringify(tensionChart.data.datasets[1])'));
    expect(ds.label).toBe('Modèle : Arc du héros');
    expect(ds.borderDash).toEqual([6, 4]);
    expect(ds.data).toHaveLength(6);
    expect(run('tensionChart.options.plugins.legend.display')).toBe(true);
    expect(win.updates).toBeGreaterThan(0);
    run("setPlanModel('aucun')");
    expect(run('tensionChart.data.datasets.length')).toBe(1);
    expect(run('tensionChart.options.plugins.legend.display')).toBe(false);
  });
  it('un modèle inconnu est refusé ; un stockage indisponible ne casse rien', () => {
    const { win, run } = app(CH(3));
    run("setPlanModel('nimporte')");
    expect(run('planModel()')).toBe('aucun');
    Object.defineProperty(win, 'localStorage', { configurable: true, value: { getItem() { throw new Error('bloqué'); }, setItem() { throw new Error('bloqué'); } } });
    expect(() => run("setPlanModel('actes')")).not.toThrow();
    expect(run('planModel()')).toBe('actes');
  });
  it('l\'équivalent textuel de la courbe (accessibilité) ajoute la colonne « Modèle » quand un modèle est choisi', () => {
    const { win, run } = app(CH(4));
    run('setTensionAlt()');
    expect(win.alts.at(-1).headers).toEqual(['Chapitre', 'Tension']);
    run("setPlanModel('actes')");
    const a = win.alts.at(-1);
    expect(a.headers).toEqual(['Chapitre', 'Tension', 'Modèle']);
    expect(a.rows).toHaveLength(4);
    expect(a.rows[0]).toHaveLength(3);
    expect(a.title).toContain('Trois actes');
  });
});

describe('AUD-10-013 : fiche de scène', () => {
  it('lecture défensive : champs absents, mal typés ou trop longs sont normalisés', () => {
    const { run } = app([{ id: 'a', scene: { but: 5, obstacle: 'x'.repeat(400) } }]);
    run('normalizeChapterScene(db.chapters[0])');
    expect(JSON.parse(run('JSON.stringify(db.chapters[0].scene)'))).toEqual({ but: '', obstacle: 'x'.repeat(200), enjeu: '' });
  });
  it('saisie : enregistrée dans le chapitre courant, plafonnée à 200 caractères, avec enregistrement différé', () => {
    const { run, win } = app(CH(2));
    run("onSceneInput('but', 'Ouvrir la porte')");
    run("onSceneInput('enjeu', 'y'.repeat(300))");
    expect(run('db.chapters[0].scene.but')).toBe('Ouvrir la porte');
    expect(run('db.chapters[0].scene.enjeu.length')).toBe(200);
    expect(run('db.chapters[1].scene')).toBeUndefined();
    expect(win.saves).toBe(2);
  });
  it('affichage : les trois champs reprennent la fiche du chapitre courant, et sont vides pour un chapitre sans fiche', () => {
    const { run, d } = app([{ id: 'a', scene: { but: 'B1', obstacle: 'O1', enjeu: 'E1' } }, { id: 'b' }]);
    run('renderChapterScene()');
    expect(d.getElementById('scene-but').value).toBe('B1');
    expect(d.getElementById('scene-obstacle').value).toBe('O1');
    run('cur = 1; renderChapterScene()');
    expect(d.getElementById('scene-but').value).toBe('');
    expect(d.getElementById('scene-enjeu').value).toBe('');
  });
});

describe('AUD-10-013 : branchement, exports', () => {
  const h = read('index.html'), r = read('js/router.js'), ed = read('js/editor.js');
  it('repères d\'échelle sous le curseur, sélecteur de modèle étiqueté avec son aide, trois champs de scène étiquetés', () => {
    expect(h).toContain('id="tension-anchors">0 calme · 50 tendu · 100 paroxysme</div>');
    expect(h).toContain('aria-describedby="tension-value tension-anchors"');
    expect(h).toContain('<label for="plan-model-sel"');
    expect(h).toContain('C\'est un repère visuel, pas une règle');
    for (const k of ['but', 'obstacle', 'enjeu']) expect(h).toMatch(new RegExp('<input type="text" id="scene-' + k + '"[^>]*aria-label='));
  });
  it('le sélecteur et la fiche sont branchés ; la fiche se charge avec le chapitre ; le graphique applique le modèle à sa création', () => {
    expect(r).toContain("getElementById('plan-model-sel').addEventListener('change',e=>setPlanModel(e.target.value))");
    expect(r).toContain("SCENE_FIELDS.forEach(([k])=>document.getElementById('scene-'+k).addEventListener('input',e=>onSceneInput(k,e.target.value)))");
    expect(r).toContain('applyPlanModelToChart(); tensionChart.update();');
    expect(ed).toContain('renderChapterScene(); // v9.96.0');
  });
  it('un chapitre copié garde sa fiche de scène ; elle n\'est écrite dans aucun export de texte ; le modèle est propre à l\'appareil', () => {
    expect(ed).toContain("researchNotes: orig.researchNotes || '', scene: { ...(orig.scene || {}) } };");
    expect(read('js/export-format-utils.js')).not.toMatch(/\.scene\b/);
    expect(read('js/schema.js')).not.toMatch(/plume_plan_model|planModel/);
  });
  it('la couleur de la courbe de modèle suit le thème', () => {
    expect(read('js/stats.js')).toContain('tensionChart.data.datasets[1].borderColor = chartPalette()[1]');
  });
});
