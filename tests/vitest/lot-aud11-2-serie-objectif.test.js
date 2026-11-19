// ═══════════════════════════════════════════════════════
// LOT 2 de l'audit AUD-11 (v9.98.0) : mémoire de la série et mesure de l'objectif au choix.   005 meilleure série · 007 unité d'objectif
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
    updateGoalsUI() {}, updateEstimatedFinishDate() {}, trackHourlyActivity() {}, setChartAlt() {}, ensureLib: () => Promise.resolve(false)
  };
  vm.createContext(ctx);
  const sch = read('js/schema.js');
  const grab = nom => { const i = sch.indexOf('function ' + nom); return sch.slice(i, sch.indexOf('\n}', i) + 2); };
  const one = nom => { const i = sch.indexOf('function ' + nom); return sch.slice(i, sch.indexOf('\n', i) + 1); };
  vm.runInContext(grab('dateKey') + one('plur') + one('getTodayKey'), ctx);
  ctx.db = db;
  vm.runInContext(read('js/stats.js'), ctx);
  ctx.els = els; ctx.store = store;
  ctx.flush = () => { const t = ctx.timers.filter(Boolean); ctx.timers = []; t.forEach(f => f()); };
  return ctx;
}
const dk = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const today = () => dk(0);
const base = (over = {}) => ({ chapters: [{ words: 1000 }], dailyGoal: 500, sessionStats: {}, activeDays: {}, dayStart: { k: today(), w: 1000 }, ...over });
const jours = (...ns) => Object.fromEntries(ns.map(n => [dk(n), 120]));

describe('AUD-11-005 : la série garde une mémoire', () => {
  it('meilleure série : 10 jours puis rupture puis 2 jours', () => {
    const act = jours(20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 1, 0);
    const c = app(base({ activeDays: act }));
    expect(c.computeBestStreak()).toBe(10);
    expect(c.computeWritingStreak()).toBe(2);
  });
  it('un jour de répit ne rompt pas la meilleure série (même règle que la série en cours)', () => {
    const c = app(base({ activeDays: jours(6, 5, 3, 2) }));
    expect(c.computeBestStreak()).toBe(4);
  });
  it('sans aucune donnée : 0 ; la meilleure série n\'est jamais inférieure à la série en cours', () => {
    expect(app(base()).computeBestStreak()).toBe(0);
    const c = app(base({ activeDays: jours(2, 1, 0) }));
    expect(c.computeBestStreak()).toBeGreaterThanOrEqual(c.computeWritingStreak());
  });
  it('jours d\'écriture sur 30 : compte les jours, ne tombe pas à 0 d\'un coup', () => {
    const c = app(base({ activeDays: jours(40, 20, 10, 9, 8, 0) }));
    expect(c.writingDaysIn(30)).toBe(5);
    expect(c.writingDaysIn(1)).toBe(1);
  });
  it('message de reprise neutre : seulement après une série de 7 jours rompue', () => {
    const c = app(base());
    expect(c.streakNote(0, 45)).toContain('Meilleure série : 45 jours');
    expect(c.streakNote(1, 7)).not.toBe('');
    expect(c.streakNote(0, 5)).toBe('');
    expect(c.streakNote(12, 12)).toBe('');
    expect(c.streakNote(3, 45)).toBe('');
    expect(c.streakNote(0, 45)).not.toMatch(/échec|perdu|dommage|manqué/i);
  });
  it('les cartes Statistiques affichent la meilleure série et les jours sur 30', () => {
    const c = app(base({ activeDays: jours(3, 2, 1, 0), chapters: [{ words: 1000 }] }));
    c.els['stats-grid'] = { innerHTML: '' }; c.els['streak-note'] = { textContent: '', hidden: true };
    c.document.getElementById = id => c.els[id] || null; c.renderStats();
    expect(c.els['stats-grid'].innerHTML).toContain('Meilleure série');
    expect(c.els['stats-grid'].innerHTML).toContain("Jours d'écriture (30 derniers)");
  });
});

describe('AUD-11-007 : mesure de l\'objectif au choix', () => {
  it('défaut = mots (comportement de la v9.97.0 conservé)', () => {
    const c = app(base());
    expect(c.goalUnit()).toBe('words');
    expect(c.dayGoalPct(500, 500)).toBe(100);
  });
  it('unité inconnue ou absente : retombe sur « mots »', () => {
    expect(app(base({ goalUnit: 'zz' })).goalUnit()).toBe('words');
  });
  it('minutes : 15 min sur 30 = 50 % ; les mots ne comptent plus', () => {
    const c = app(base({ goalUnit: 'minutes', dailyMinutes: 30, activeDays: { [today()]: 900 } }));
    expect(c.dayGoalPct(9999, 500)).toBe(50);
  });
  it('minutes : 30 min = 100 % et le message cite les minutes, une seule fois', () => {
    const c = app(base({ goalUnit: 'minutes', dailyMinutes: 30, activeDays: { [today()]: 1800 } }));
    c.updateDailyStats(); c.flush();
    expect(c.toasts.length).toBe(1);
    expect(c.toasts[0].m).toContain('Objectif atteint : 30 minutes de saisie');
  });
  it('aucun objectif : 0 %, aucun message, la série n\'est pas touchée', () => {
    const c = app(base({ goalUnit: 'none', chapters: [{ words: 5000 }], activeDays: { [today()]: 5000 } }));
    c.els['sidebar-goal-bar'] = { style: {} };
    c.updateDailyStats(); c.flush();
    expect(c.dayGoalPct(4000, 500)).toBe(0);
    expect(c.els['sidebar-goal-bar'].style.width).toBe('0%');
    expect(c.toasts.length).toBe(0);
    expect(c.computeWritingStreak()).toBeGreaterThanOrEqual(1);
  });
  it('setGoalUnit enregistre le choix, refuse une valeur inconnue et pose la classe goal-none', () => {
    const c = app(base()); c.els['sidebar-goal-bar'] = { style: {} };
    c.setGoalUnit('none'); expect(c.db.goalUnit).toBe('none'); expect(c.bodyClasses['goal-none']).toBe(true);
    c.setGoalUnit('abc'); expect(c.db.goalUnit).toBe('none');
    c.setGoalUnit('minutes'); expect(c.bodyClasses['goal-none']).toBe(false);
  });
  it('index.html, CSS, schéma et branchements', () => {
    const h = read('index.html');
    ['id="goal-unit-sel"', 'id="daily-minutes-input"', 'id="goal-minutes-row"', 'id="streak-note"'].forEach(x => expect(h).toContain(x));
    expect(read('css/style.css')).toContain('body.goal-none .daily-bar-wrap{display:none;}');
    expect(read('js/schema.js')).toContain("goalUnit:'words', dailyMinutes:30");
    expect(read('js/router.js')).toContain("getElementById('goal-unit-sel').addEventListener('change'");
    expect(read('js/tabs.js')).toContain('applyGoalUnitUI()');
  });
});
