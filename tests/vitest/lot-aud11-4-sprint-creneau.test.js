// ═══════════════════════════════════════════════════════
// LOT 4 de l'audit AUD-11 (v9.99.0) : sprint avec mémoire et créneau récent.   008 historique des sprints, départ en 5 min · 011 créneau sur 90 jours
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

function app(db, { store = {}, active = [] } = {}) {
  const els = {};
  const ctx = {
    document: { body: { classList: { toggle(c, on) { ctx.bodyClasses[c] = on; } } },
      getElementById: id => els[id] || (['focus-overlay', 'reading-overlay'].includes(id) ? { classList: { contains: c => active.includes(id) } } : null) },
    bodyClasses: {}, toasts: [], timers: [],
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    setTimeout: fn => { ctx.timers.push(fn); return ctx.timers.length; }, clearTimeout: n => { if (n) ctx.timers[n - 1] = null; },
    toast: (m, t) => ctx.toasts.push({ m, t }), save() {}, debouncedSave() {}, sessionStartTime: Date.now(), sessionWordsStart: 0,
    chaptersTotalWords: chs => (chs || []).reduce((n, c) => n + (c.words || 0), 0), getWordCount: () => 0,
    updateGoalsUI() {}, updateEstimatedFinishDate() {}, setChartAlt() {}, ensureLib: () => Promise.resolve(false)
  };
  vm.createContext(ctx);
  const sch = read('js/schema.js');
  const grab = nom => { const i = sch.indexOf('function ' + nom); return sch.slice(i, sch.indexOf('\n}', i) + 2); };
  const one = nom => { const i = sch.indexOf('function ' + nom); return sch.slice(i, sch.indexOf('\n', i) + 1); };
  vm.runInContext(grab('dateKey') + one('plur') + one('getTodayKey'), ctx);
  ctx.db = db;
  vm.runInContext(read('js/stats.js').replace('let _lastHourlyWordCount = null;', 'var _lastHourlyWordCount = null;'), ctx);
  ctx.els = els; ctx.store = store;
  ctx.flush = () => { const t = ctx.timers.filter(Boolean); ctx.timers = []; t.forEach(f => f()); };
  return ctx;
}
const dk = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const h24 = (h, v) => { const a = new Array(24).fill(0); a[h] = v; return a; };

describe('AUD-11-011 : créneau le plus productif sur 90 jours', () => {
  it('trackHourlyActivity alimente le cumul ET le détail par jour ; le premier appel sert de référence', () => {
    const c = app({ chapters: [], hourlyActivity: new Array(24).fill(0) });
    c.trackHourlyActivity(100);
    expect(c.db.hourlyDays).toBeUndefined();
    c.trackHourlyActivity(140);
    const h = new Date().getHours();
    expect(c.db.hourlyActivity[h]).toBe(40);
    expect(c.db.hourlyDays[dk(0)][h]).toBe(40);
  });
  it('un recul de mots (coupes) n\'est pas compté comme activité', () => {
    const c = app({ chapters: [] }); c.trackHourlyActivity(100); c.trackHourlyActivity(60);
    expect(c.db.hourlyDays).toBeUndefined();
  });
  it('le créneau récent l\'emporte sur le vieux cumul : horaires changés', () => {
    const c = app({ hourlyActivity: h24(7, 99999), hourlyDays: { [dk(3)]: h24(21, 300), [dk(10)]: h24(21, 200), [dk(120)]: h24(7, 50000) } });
    expect(c.bestWritingSlot()).toEqual({ hour: 21, recent: true });
  });
  it('sans donnée récente : repli sur le cumul historique ; sans rien : null', () => {
    expect(app({ hourlyActivity: h24(9, 200), hourlyDays: { [dk(200)]: h24(14, 5) } }).bestWritingSlot()).toEqual({ hour: 9, recent: false });
    expect(app({ hourlyActivity: new Array(24).fill(0) }).bestWritingSlot()).toBeNull();
  });
  it('les jours de plus de 90 jours sont purgés', () => {
    const days = {}; for (let i = 0; i < 130; i++) days[dk(i)] = h24(10, 1);
    const c = app({ chapters: [], hourlyDays: days }); c.pruneHourlyDays();
    expect(Object.keys(c.db.hourlyDays).length).toBeLessThanOrEqual(92);
    expect(c.db.hourlyDays[dk(0)]).toBeDefined();
    expect(c.db.hourlyDays[dk(125)]).toBeUndefined();
  });
  it('hourlyDays est un champ dérivé : exclu de l\'arbitrage de synchro et de l\'empreinte du Gist', () => {
    expect(read('js/router.js')).toMatch(/SYNC_DERIVED_FIELDS = \[[^\]]*'hourlyDays'/);
    expect(read('js/library.js')).toMatch(/GIST_FP_EXCLUDED = \[[^\]]*'hourlyDays'/);
  });
  it('la carte Statistiques porte le libellé « 3 mois » quand le créneau est récent', () => {
    const c = app({ chapters: [{ words: 10 }], sessionStats: {}, activeDays: {}, dayStart: { k: dk(0), w: 10 }, hourlyDays: { [dk(1)]: h24(21, 30) } });
    c.els['stats-grid'] = { innerHTML: '' }; c.document.getElementById = id => c.els[id] || null; c.renderStats();
    expect(c.els['stats-grid'].innerHTML).toContain('Créneau le plus productif (3 mois)');
    expect(c.els['stats-grid'].innerHTML).toContain('21h');
  });
});

describe('AUD-11-008 : sprint avec mémoire', () => {
  it('une durée de 5 minutes est proposée (code et liste déroulante)', () => {
    expect(read('js/stats.js')).toContain('const SPRINT_MINUTES_CHOICES = [5, 15, 25, 45];');
    expect(read('index.html')).toContain('<option value="5">5 min</option>');
  });
  it('premier sprint : message simple, sans comparaison', () => {
    expect(app({}).sprintSummary(25, 230)).toBe('Sprint terminé : +230 mots en 25 minutes.');
  });
  it('compare au précédent et au meilleur, à durée égale seulement', () => {
    const c = app({});
    c.sprintHistoryAdd(25, 190); c.sprintHistoryAdd(25, 410); c.sprintHistoryAdd(15, 999); c.sprintHistoryAdd(25, 120);
    expect(c.sprintSummary(25, 230)).toBe('Sprint terminé : +230 mots en 25 minutes. Précédent : +120. Meilleur : +410.');
    expect(c.sprintSummary(45, 10)).toBe('Sprint terminé : +10 mots en 45 minutes.');
  });
  it('net négatif signé ; l\'historique est borné à 20 et filtre les entrées invalides', () => {
    const c = app({});
    for (let i = 0; i < 30; i++) c.sprintHistoryAdd(25, i);
    expect(c.sprintHistoryLoad().length).toBe(20);
    expect(c.sprintHistoryLoad()[19].w).toBe(29);
    c.store.plume_sprint_hist = JSON.stringify([{ m: 25, w: 'x' }, null, { m: 7, w: 3 }, { m: 25, w: 5 }]);
    expect(c.sprintHistoryLoad()).toEqual([{ m: 25, w: 5 }]);
    expect(c.sprintSummary(25, -40)).toContain('\u221240 mots');
  });
  it('stockage indisponible : aucun plantage', () => {
    const c = app({}); c.localStorage.getItem = () => { throw new Error('x'); }; c.localStorage.setItem = () => { throw new Error('x'); };
    expect(() => { c.sprintHistoryAdd(25, 1); c.sprintSummary(25, 1); }).not.toThrow();
  });
  it('la fin du sprint utilise le résumé puis enregistre le résultat', () => {
    const s = read('js/stats.js');
    expect(s).toContain('const resume = sprintSummary(minutes, words); sprintHistoryAdd(minutes, words);');
  });
});
