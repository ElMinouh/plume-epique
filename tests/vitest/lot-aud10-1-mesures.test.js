// ═══════════════════════════════════════════════════════
// LOT 1 de l'audit AUD-10 (v9.90.0) : trois mesures qui donnaient un retour faux à l'auteur.
//   002 lisibilité (formule française) · 003 répétitions (mots accentués) · 014 mots/min (temps de saisie effectif)
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const SCRIPTS = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js') && f !== 'odf-loader.js');

describe('AUD-10-002 : lisibilité calibrée pour le français', () => {
  const src = read('js/readability.js');
  const fk = new Function(src.slice(src.indexOf('function fleschKincaid'), src.indexOf('function fleschLabel')) + '\nreturn fleschKincaid;')();
  const phrase = 'Elle ouvrit la porte et regarda dans la pièce sombre. Personne ne répondit. Le silence pesait sur la maison comme une couverture humide.';
  it('texte narratif courant : score « Difficile ou mieux » (≥ 40), non plus « Très difficile » (15 avec l\'ancienne formule)', () => {
    expect(fk(phrase)).toBeGreaterThanOrEqual(40);
    expect(fk(phrase)).toBeLessThanOrEqual(60);
  });
  it('un texte simple reste meilleur qu\'un texte complexe ; le score reste entre 0 et 100', () => {
    const facile = 'Le chat va. Le chien va. Le chat vu.';
    const dur = 'Épistémologiquement, cette considération transcendantale problématise irrémédiablement toute conceptualisation antérieure.';
    expect(fk(facile)).toBeGreaterThan(fk(dur));
    for (const t of [facile, dur, '']) { const s = fk(t); expect(s).toBeGreaterThanOrEqual(0); expect(s).toBeLessThanOrEqual(100); }
  });
  it('les syllabes sont comptées par groupes de voyelles (« eau » = 1) : « beau » ne pèse pas plus que « bon »', () => {
    expect(fk('Un beau eau. Un beau eau.')).toBe(fk('Un bon bon. Un bon bon.'));
  });
  it('la formule est celle de Kandel & Moles', () => {
    expect(src).toContain('207 - 1.015*(wordCount/sentences) - 73.6*(syllables/wordCount)');
  });
});

describe('AUD-10-003 : le détecteur de répétitions voit les mots accentués', () => {
  function lancer(texte) {
    const ctx = {
      db: { chapters: [{ content: texte }] }, cur: 0, flushCurrentChapter() {}, getPlainText: t => t,
      STOP_WORDS: new Set(), DOMPurify: { sanitize: s => s }, icon: () => '', escapeRegExp: s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      document: { getElementById: () => null }
    };
    vm.createContext(ctx);
    vm.runInContext(read('js/pluginSystem.js') + '\nthis.__reg = PLUGINS_REGISTRY;', ctx);
    return ctx.__reg.find(p => p.id === 'repetitions').run();
  }
  it('« visité » répété 3 fois est signalé (avant : 0 occurrence)', async () => {
    const r = await lancer('Il avait visité la ville. Elle avait visité le port. Nous avons visité la tour.');
    expect(r).toContain('visité');
    expect(r).not.toContain('Aucune répétition');
  });
  it('un mot à initiale accentuée (« éclat ») est signalé', async () => {
    const r = await lancer('Un éclat brilla ici. Un éclat brilla là. Un éclat brilla encore.');
    expect(r).toContain('éclat');
  });
  it('un mot sans accent reste signalé ; un texte sans répétition ne l\'est pas', async () => {
    expect(await lancer('La maison dort. Une maison veille. Cette maison attend.')).toContain('maison');
    expect(await lancer('Le soleil se lève sur la mer calme. Les oiseaux chantent doucement.')).toContain('Aucune répétition');
  });
  it('aucune regex à \\b sur du texte français dans le plugin (\\b est ASCII)', () => {
    const s = read('js/pluginSystem.js');
    expect(s.slice(s.indexOf("id: 'repetitions'"), s.indexOf("id: 'synopsis'"))).not.toMatch(/\\\\b/);
  });
});

describe('AUD-10-014 : mots/min sur le temps de saisie effectif', () => {
  const s = read('js/stats.js');
  const bloc = s.slice(s.indexOf('const ACTIVE_GAP_MAX_MS'), s.indexOf('function updateDailyStats'));
  function nouveau() {
    const ctx = { sessionStartTime: 1000 };
    vm.createContext(ctx);
    vm.runInContext(bloc, ctx);
    return ctx;
  }
  it('des frappes rapprochées s\'additionnent', () => {
    const c = nouveau();
    vm.runInContext('trackActiveTime(1000); trackActiveTime(11000); trackActiveTime(21000);', c);
    expect(vm.runInContext('activeTypingMs()', c)).toBe(20000);
  });
  it('une pause de 30 minutes ne compte pas', () => {
    const c = nouveau();
    vm.runInContext('trackActiveTime(1000); trackActiveTime(11000); trackActiveTime(11000 + 30 * 60000); trackActiveTime(11000 + 30 * 60000 + 5000);', c);
    expect(vm.runInContext('activeTypingMs()', c)).toBe(15000);
  });
  it('une nouvelle séance (sessionStartTime changé) repart de zéro', () => {
    const c = nouveau();
    vm.runInContext('trackActiveTime(1000); trackActiveTime(9000);', c);
    c.sessionStartTime = 500000;
    expect(vm.runInContext('activeTypingMs()', c)).toBe(0);
  });
  it('la frappe (éditeur et Focus) alimente le suivi ; la navigation entre chapitres non', () => {
    const e = read('js/editor.js');
    expect((e.match(/trackActiveTime\(Date\.now\(\)\)/g) || []).length).toBe(2);
    expect(s.slice(s.indexOf('function updateDailyStats'), s.indexOf('let _goalCelebratedDay'))).not.toContain('trackActiveTime');
  });
  it('les nouveaux globaux ne font pas doublon', () => {
    const n = SCRIPTS.filter(f => /^function trackActiveTime\(/m.test(read('js/' + f)));
    expect(n).toEqual(['stats.js']);
  });
});
