// ═══════════════════════════════════════════════════════
// LOT 2 de l'audit AUD-10 (v9.91.0) : statistiques et objectifs qui n'ignorent plus la révision.
//   004 série et « aujourd'hui » · 005 objectifs et messages · 015 fourchette de fin · 017 durée du sprint
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

// Charge schema.js (dateKey, plur, getTodayKey) puis stats.js dans un contexte nu, avec des doublures minimales.
function app(db, extra = '') {
  const els = {};
  const ctx = {
    document: { getElementById: id => els[id] || null }, toasts: [], localStorage: undefined,
    toast: (m, t, o) => ctx.toasts.push({ m, t, o }), save() {}, debouncedSave() {}, sessionStartTime: Date.now(), sessionWordsStart: 0,
    chaptersTotalWords: chs => (chs || []).reduce((n, c) => n + (c.words || 0), 0), getWordCount: () => 0
  };
  vm.createContext(ctx);
  const sch = read('js/schema.js');
  const grab = nom => { const i = sch.indexOf('function ' + nom); return sch.slice(i, sch.indexOf('\n}', i) + 2); };
  const one = nom => { const i = sch.indexOf('function ' + nom); return sch.slice(i, sch.indexOf('\n', i) + 1); };
  vm.runInContext(grab('dateKey') + one('plur') + one('getTodayKey'), ctx);
  ctx.db = db;
  vm.runInContext(read('js/stats.js') + extra, ctx);
  ctx.els = els;
  return ctx;
}
const jourDe = n => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const cle = n => { const d = jourDe(n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

describe('AUD-10-004 : la série compte les jours d\'écriture, pas seulement le gain net', () => {
  it('un jour à −500 mots mais avec 10 min de saisie prolonge la série (avant : rupture)', () => {
    const db = { chapters: [], sessionStats: { [cle(2)]: 1000, [cle(1)]: 1500, [cle(0)]: 1000 }, activeDays: { [cle(0)]: 600 } };
    expect(app(db).computeWritingStreak()).toBe(3);
  });
  it('un seul jour manqué ne rompt pas la série ; deux jours consécutifs la rompent', () => {
    const base = { chapters: [], sessionStats: {} };
    const un = app({ ...base, activeDays: { [cle(0)]: 300, [cle(2)]: 300, [cle(3)]: 300 } });
    expect(un.computeWritingStreak()).toBe(3);
    const deux = app({ ...base, activeDays: { [cle(0)]: 300, [cle(3)]: 300, [cle(4)]: 300 } });
    expect(deux.computeWritingStreak()).toBe(1);
  });
  it('aujourd\'hui encore vide ne casse pas la série tant qu\'hier est un jour d\'écriture', () => {
    const db = { chapters: [], sessionStats: {}, activeDays: { [cle(1)]: 300, [cle(2)]: 300 } };
    expect(app(db).computeWritingStreak()).toBe(2);
  });
  it('moins d\'une minute de saisie ne fait pas un jour d\'écriture', () => {
    expect(app({ chapters: [], sessionStats: {}, activeDays: { [cle(0)]: 30 } }).computeWritingStreak()).toBe(0);
  });
  it('règle historique conservée : 3 jours de progression de total donnent 3, sans activeDays', () => {
    const db = { chapters: [], sessionStats: { [cle(2)]: 100, [cle(1)]: 250, [cle(0)]: 400 } };
    expect(app(db).computeWritingStreak()).toBe(3);
  });
  it('trackActiveTime enregistre les secondes du jour dans db.activeDays, et seulement pour un manuscrit texte', () => {
    const db = { chapters: [], sessionStats: {} };
    const c = app(db);
    vm.runInContext('trackActiveTime(1000); trackActiveTime(11000);', c);
    expect(db.activeDays[cle(0)]).toBe(10);
    const gn = { pages: [] };
    const c2 = app(gn);
    vm.runInContext('trackActiveTime(1000); trackActiveTime(11000);', c2);
    expect(gn.activeDays).toBeUndefined();
  });
  it('la carte « Aujourd\'hui » affiche le net signé (une journée de coupes n\'est plus « 0 »)', () => {
    const s = read('js/stats.js');
    expect(s).toContain("{v:netLabel,l:\"Aujourd'hui, net\"");
    expect(s).toContain("'\u2212'");
  });
});

describe('AUD-10-004 : activeDays est un champ DÉRIVÉ (aucun faux conflit de synchro, aucune sauvegarde inutile)', () => {
  it('exclu de l\'arbitrage de synchro et de l\'empreinte du Gist, présent dans le manuscrit neuf', () => {
    expect(read('js/router.js')).toMatch(/SYNC_DERIVED_FIELDS = \[[^\]]*'activeDays'/);
    expect(read('js/library.js')).toMatch(/GIST_FP_EXCLUDED = \[[^\]]*'activeDays'/);
    expect(read('js/schema.js')).toContain('activeDays:{}');
  });
});

describe('AUD-10-005 : objectif suggéré, révision visible, messages factuels', () => {
  const serie = valeurs => { // valeurs[i] = mots écrits il y a (i+1) jours ; totaux cumulés de sessionStats
    const stats = {}; let total = 0;
    for (let i = valeurs.length - 1; i >= 0; i--) { total += valeurs[i]; stats[cle(i + 1)] = total; }
    return { stats, total };
  };
  it('suggestion = médiane des jours d\'écriture des 14 derniers jours + 15 %, arrondie à 50', () => {
    const { stats, total } = serie([300, 0, 400, 200, 0, 350]);
    const c = app({ chapters: [], sessionStats: stats, dayStart: { k: cle(0), w: total } });
    expect(c.suggestedDailyGoal(total)).toBe(350); // médiane 325 × 1,15 = 373,75 → arrondi à 50 le plus proche : 350
  });
  it('moins de 3 jours d\'écriture : aucune suggestion', () => {
    const { stats, total } = serie([300, 0, 400]);
    const c = app({ chapters: [], sessionStats: stats, dayStart: { k: cle(0), w: total } });
    expect(c.suggestedDailyGoal(total)).toBeNull();
  });
  it('la révision se lit dans les statuts existants', () => {
    const chapters = [{ status: 'final' }, { status: 'final' }, { status: 'review' }, {}, { status: 'draft' }];
    const c = app({ chapters, sessionStats: {} });
    expect(c.revisionCounts()).toEqual({ draft: 2, review: 1, final: 2, total: 5 });
    expect(c.revisionSentence()).toBe(' Révision : 2 chapitres sur 5 en Final.');
    expect(app({ chapters: [{}], sessionStats: {} }).revisionSentence()).toBe('');
  });
  it('plus d\'éloge vide : ni « Bravo ! » ni « Objectif journalier atteint ! »', () => {
    const s = read('js/stats.js');
    expect(s).not.toContain('Bravo');
    expect(s).not.toContain('Objectif journalier atteint');
    expect(s).toContain("'Objectif atteint : '");
  });
  it('les éléments d\'interface existent et le bouton est branché', () => {
    const h = read('index.html'), r = read('js/router.js');
    for (const id of ['goal-suggestion', 'goal-suggestion-text', 'goal-suggestion-apply', 'revision-summary']) expect(h).toContain('id="' + id + '"');
    expect(r).toContain("getElementById('goal-suggestion-apply').addEventListener('click',applyGoalSuggestion)");
  });
});

describe('AUD-10-015 : date de fin en fourchette', () => {
  function estimation(valeurs, wordGoal, totalExtra = 0) {
    const stats = {}; let total = 1000;
    const cumuls = [];
    for (let i = valeurs.length - 1; i >= 0; i--) { total += valeurs[i]; stats[cle(i + 1)] = total; }
    const el = { textContent: '' };
    const c = app({ chapters: [{ words: total + totalExtra }], sessionStats: stats, wordGoal, dayStart: { k: cle(0), w: total + totalExtra } });
    c.els['finish-date-estimate'] = el;
    vm.runInContext('updateEstimatedFinishDate()', c);
    return el.textContent;
  }
  it('moins de 5 jours d\'écriture : pas de date, la raison est dite', () => {
    expect(estimation([300, 400, 0, 200], 50000)).toMatch(/au moins 5/);
  });
  it('assez de jours : une fourchette « entre … et … », avec la mention « révision non incluse »', () => {
    const t = estimation([300, 500, 200, 400, 350, 250, 450], 50000);
    expect(t).toMatch(/Écriture terminée entre le .+ et le .+ \(révision non incluse\)/);
    expect(t).not.toMatch(/À ce rythme/);
  });
  it('rythme très lent : « au-delà de trois ans » plutôt qu\'une date fantaisiste', () => {
    expect(estimation([50, 50, 50, 50, 50], 5000000)).toMatch(/dépasse trois ans/);
  });
});

describe('AUD-10-017 : durée du sprint au choix', () => {
  function sprintCtx(stockage) {
    const els = {
      writer: { innerText: 'un deux' }, 'sprint-timer': { innerText: '' }, 'sprint-progress': { innerText: '' },
      'sprint-duration-sel': { value: '', disabled: false }, 'sprint-chip': { hidden: true },
      'sprint-chip-time': { textContent: '' }, 'sprint-chip-words': { textContent: '' }
    };
    const ctx = {
      document: { getElementById: id => els[id] || null }, toasts: [], saves: 0, els,
      localStorage: { getItem: k => stockage[k] ?? null, setItem: (k, v) => { stockage[k] = v; } },
      toast: (m, t, o) => ctx.toasts.push({ m, t, o }), save() { ctx.saves++; },
      getWordCount: t => (t || '').trim() ? t.trim().split(/\s+/).length : 0,
      setInterval: () => 1, clearInterval() {}, sprintInterval: null, sprintWordsStart: 0
    };
    vm.createContext(ctx);
    ctx.db = { sprint: null, chapters: [] };
    vm.runInContext(read('js/stats.js'), ctx);
    return ctx;
  }
  it('par défaut 25 minutes ; le choix est mémorisé sur l\'appareil et refusé s\'il n\'est pas 15, 25 ou 45', () => {
    const st = {}, c = sprintCtx(st);
    expect(vm.runInContext('sprintMinutesPref()', c)).toBe(25);
    vm.runInContext('setSprintMinutesPref(45)', c);
    expect(st.plume_sprint_min).toBe('45');
    expect(c.els['sprint-timer'].innerText).toBe('45:00');
    vm.runInContext('setSprintMinutesPref(7)', c);
    expect(st.plume_sprint_min).toBe('45');
  });
  it('un sprint de 15 minutes dure 15 minutes, le dit, et sa durée survit au rechargement (db.sprint.minutes)', () => {
    const c = sprintCtx({ plume_sprint_min: '15' });
    vm.runInContext('startSprint()', c);
    expect(c.db.sprint.minutes).toBe(15);
    expect(Math.round((c.db.sprint.endTime - Date.now()) / 60000)).toBe(15);
    expect(c.toasts.at(-1).m).toBe('Sprint de 15 minutes lancé.');
    expect(c.els['sprint-duration-sel'].disabled).toBe(true);
  });
  it('fin de sprint : message factuel avec la durée réelle', () => {
    const c = sprintCtx({ plume_sprint_min: '45' });
    vm.runInContext('startSprint()', c);
    c.els.writer.innerText = 'un deux trois quatre';
    c.db.sprint.endTime = Date.now() - 1000;
    vm.runInContext('runSprintTick()', c);
    expect(c.toasts.at(-1).m).toBe('Sprint terminé : +2 mots en 45 minutes.');
    expect(c.db.sprint).toBeNull();
  });
  it('le sélecteur existe et est branché', () => {
    expect(read('index.html')).toContain('id="sprint-duration-sel"');
    expect(read('js/router.js')).toContain("getElementById('sprint-duration-sel').addEventListener('change'");
  });
});
