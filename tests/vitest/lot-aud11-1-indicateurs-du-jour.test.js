// ═══════════════════════════════════════════════════════
// LOT 1 de l'audit AUD-11 (v9.97.0) : indicateurs du jour qui respectent la révision, message qui ne coupe pas la phrase,
// mode « sans chiffres ».   001 barre du jour · 015 message différé · 017 compteurs masquables
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
    updateGoalsUI() {}, updateEstimatedFinishDate() {}, trackHourlyActivity() {}
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
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const base = (over = {}) => ({ chapters: [{ words: 1000 }], dailyGoal: 500, sessionStats: {}, activeDays: {}, dayStart: { k: today(), w: 1000 }, ...over });
const el = () => ({ style: {}, textContent: '', innerText: '' });

describe('AUD-11-001 : la barre du jour compte la révision', () => {
  it('sans saisie ni mot : 0 %', () => { expect(app(base()).dayGoalPct(0, 500)).toBe(0); });
  it('20 minutes de saisie avec −220 mots : objectif atteint (100 %)', () => {
    const c = app(base({ activeDays: { [today()]: 1200 } }));
    expect(c.dayGoalPct(0, 500)).toBe(100);
  });
  it('10 minutes de saisie : 50 % (au prorata)', () => {
    expect(app(base({ activeDays: { [today()]: 600 } })).dayGoalPct(0, 500)).toBe(50);
  });
  it('les mots nets restent suffisants (500 mots = 100 %)', () => { expect(app(base()).dayGoalPct(500, 500)).toBe(100); });
  it('« aujourd\'hui » montre le net négatif au lieu de 0', () => {
    const c = app(base({ chapters: [{ words: 780 }] })); c.els['today-words'] = el(); c.els['sidebar-goal-bar'] = el();
    c.updateDailyStats();
    expect(c.els['today-words'].innerText).toBe('\u2212220');
  });
});

describe('AUD-11-015 : le message attend une pause de saisie', () => {
  it('la barre bouge tout de suite, le message seulement après le délai, une seule fois', () => {
    const c = app(base({ chapters: [{ words: 1600 }] })); c.els['sidebar-goal-bar'] = el();
    c.updateDailyStats(); c.updateDailyStats();
    expect(c.els['sidebar-goal-bar'].style.width).toBe('100%');
    expect(c.toasts.length).toBe(0);
    c.flush();
    expect(c.toasts.length).toBe(1);
    expect(c.toasts[0].m).toContain('Objectif atteint : 600 mots');
    c.updateDailyStats(); c.flush();
    expect(c.toasts.length).toBe(1);
  });
  it('rien en mode Focus : le message est repoussé', () => {
    const c = app(base({ chapters: [{ words: 1600 }] }), { active: ['focus-overlay'] });
    c.updateDailyStats(); c.flush();
    expect(c.toasts.length).toBe(0);
    expect(c.timers.filter(Boolean).length).toBe(1);
  });
  it('journée de révision : message « Séance accomplie » avec les minutes et le net signé', () => {
    const c = app(base({ chapters: [{ words: 780 }], activeDays: { [today()]: 5100 } }));
    c.updateDailyStats(); c.flush();
    expect(c.toasts[0].m).toContain('Séance accomplie : 85 minutes de saisie, \u2212220 mots.');
  });
  it('si le texte est supprimé avant le délai, pas de message', () => {
    const c = app(base({ chapters: [{ words: 1600 }] }));
    c.updateDailyStats(); c.db.chapters = [{ words: 1100 }]; c.flush();
    expect(c.toasts.length).toBe(0);
  });
});

describe('AUD-11-017 : mode « sans chiffres »', () => {
  it('la préférence est mémorisée sur l\'appareil et pose la classe du corps', () => {
    const c = app(base());
    expect(c.hideCountersPref()).toBe(false);
    c.setHideCountersPref(true);
    expect(c.store.plume_hide_counters).toBe('1');
    expect(c.bodyClasses['hide-counters']).toBe(true);
    c.setHideCountersPref(false);
    expect(c.store.plume_hide_counters).toBeUndefined();
  });
  it('aucun message d\'objectif quand le mode est actif', () => {
    const c = app(base({ chapters: [{ words: 1600 }] }), { store: { plume_hide_counters: '1' } });
    c.updateDailyStats(); c.flush();
    expect(c.toasts.length).toBe(0);
  });
  it('index.html : case à cocher et bloc masquable ; CSS et branchements présents', () => {
    const h = read('index.html');
    expect(h).toContain('id="hide-counters-cb"');
    expect(h).toContain('class="sidebar-counters"');
    expect(read('css/style.css')).toContain('body.hide-counters .sidebar-counters{display:none;}');
    expect(read('js/router.js')).toContain("getElementById('hide-counters-cb').addEventListener('change'");
    expect(read('js/tabs.js')).toContain('applyHideCounters()');
  });
});
