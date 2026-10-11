// ═══════════════════════════════════════════════════════
// LOT 6 « graphiques et graphe de relations accessibles » (v9.62.0, audit AUD-05-008, 009)
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const notif = read('js/notifications.js'), rel = read('js/relations.js'), html = read('index.html');
const bloc = notif.slice(notif.indexOf('// ── ALTERNATIVE TEXTUELLE DES GRAPHIQUES (début)'), notif.indexOf('// ── ALTERNATIVE TEXTUELLE DES GRAPHIQUES (fin)'));

describe('AUD-05-008 — équivalent textuel des graphiques', () => {
  it('setChartAlt : nom résumant les données, tableau dans un <details>, mise à jour sans doublon (jsdom)', () => {
    const dom = new JSDOM('<body><div class="u-h-140px"><canvas id="dialogChart"></canvas></div></body>', { runScripts: 'outside-only' });
    const w = dom.window; w.eval(bloc);
    w.setChartAlt('dialogChart', 'Densité dialogue et narration', ['Type', 'Lignes'], [['Dialogue', 12], ['Narration', 30]]);
    const c = w.document.getElementById('dialogChart');
    expect(c.getAttribute('role')).toBe('img');
    expect(c.getAttribute('aria-label')).toBe('Densité dialogue et narration — Dialogue : 12 ; Narration : 30');
    const det = w.document.getElementById('chart-data-dialogChart');
    expect(det.tagName).toBe('DETAILS');
    expect(det.previousElementSibling.className).toBe('u-h-140px');   // juste après le conteneur du canvas
    expect(det.querySelectorAll('tr').length).toBe(3);
    w.setChartAlt('dialogChart', 'Densité', ['Type', 'Lignes'], [['Dialogue', 1]]);
    expect(w.document.querySelectorAll('details.chart-data').length).toBe(1);
    expect(det.querySelectorAll('tr').length).toBe(2);
  });
  it('contenu fabriqué en texte : une valeur HTML reste inerte', () => {
    const dom = new JSDOM('<body><canvas id="c"></canvas></body>', { runScripts: 'outside-only' });
    const w = dom.window; w.eval(bloc);
    w.setChartAlt('c', 'T', ['A'], [['<img src=x onerror=alert(1)>']]);
    expect(w.document.querySelector('#chart-data-c img')).toBeNull();
    expect(w.document.querySelector('#chart-data-c td').textContent).toBe('<img src=x onerror=alert(1)>');
  });
  it('les quatre graphiques sont décrits : session, dialogue, tension, nuage de mots', () => {
    expect(read('js/stats.js')).toContain("setChartAlt('sessionChart'");
    expect(read('js/readability.js')).toContain("setChartAlt('dialogChart'");
    expect(read('js/database.js')).toContain("setChartAlt('tensionChart'");
    expect(read('js/router.js')).toContain('setTensionAlt();');
    expect(read('js/wordcloud.js')).toMatch(/canvas\.setAttribute\('role', 'img'\)/);
  });
});

describe('AUD-05-009 — graphe des relations', () => {
  it('liste textuelle équivalente et conteneur nommé', () => {
    expect(html).toMatch(/<svg id="graph-svg" role="group" aria-label="Graphe des relations/);
    expect(html).toContain('<ul id="graph-list">');
    expect(rel).toContain('renderGraphList(nodes, links);');
  });
  it('renderGraphList décrit chaque élément avec ses relations (jsdom)', () => {
    const src = rel.slice(rel.indexOf('const GRAPH_TYPE_LABEL'), rel.indexOf('function renderGraph() {'));
    const dom = new JSDOM('<body><ul id="graph-list"></ul></body>', { runScripts: 'outside-only' });
    const w = dom.window; w.eval(src);
    const nodes = [{ id: 'chars-1', label: 'Léa', type: 'chars' }, { id: 'places-1', label: 'Le port', type: 'places' }, { id: 'chars-2', label: 'Solo', type: 'chars' }];
    w.renderGraphList(nodes, [{ source: 'chars-1', target: 'places-1', label: 'habite' }, { source: 'chars-1', target: 'inconnu-9', label: '' }]);
    const li = [...w.document.querySelectorAll('#graph-list li')].map(l => l.textContent);
    expect(li[0]).toBe('Léa — Personnage : en relation avec Le port (habite)');
    expect(li[1]).toBe('Le port — Lieu : en relation avec Léa (habite)');
    expect(li[2]).toBe('Solo — Personnage : aucune relation');
  });
  it('nœuds focalisables, nommés, et nom affiché au focus', () => {
    expect(rel).toMatch(/\.attr\('tabindex', 0\)\.attr\('role', 'img'\)\.attr\('aria-label'/);
    expect(rel).toMatch(/node\.on\('focus'/);
    expect(read('css/style.css')).toContain('.graph-node:focus-visible circle');
  });
});

describe('Version', () => {
  it('v9.62.0 ou plus : APP_VERSION et cache du service worker identiques', () => {
    const v = read('js/router.js').match(/const APP_VERSION = '([\d.]+)'/)[1];
    const c = read('sw.js').match(/const CACHE = 'plume-epique-v([\d.]+)'/)[1];
    expect(c).toBe(v);
    const [a, b] = v.split('.').map(Number);
    expect(a > 9 || (a === 9 && b >= 62)).toBe(true);
  });
});
