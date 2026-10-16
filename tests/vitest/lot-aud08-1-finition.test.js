// ═══════════════════════════════════════════════════════
// AUD-08 LOT 1 (v9.80.0) — DÉFAUTS VISIBLES (AUD-08-002, 003, 004, 005, 006, 013, 023)
//  • « aujourd'hui » = total − total à la première ouverture du JOUR (plus à l'ouverture du manuscrit) ;
//  • graphique « mots par jour » = écarts entre jours (plus le total cumulé) ;
//  • compteur de la ligne du chapitre courant mis à jour pendant la frappe ;
//  • plus de « ... » en dur, d'emoji en entité, de « (s) » ni de glyphes Unicode dans les libellés.
// ═══════════════════════════════════════════════════════
import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html');
const jsFiles = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'));

// Extrait le texte complet d'une fonction « function nom(...) { ... } » (accolades appariées).
function grab(file, name) {
  const src = read(file), i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error(name + ' introuvable dans ' + file);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
  throw new Error('accolades non appariées : ' + name);
}
function statsCtx(db) {
  const ctx = vm.createContext({ db });
  new vm.Script([grab('js/schema.js', 'dateKey'), grab('js/schema.js', 'getTodayKey'), grab('js/schema.js', 'plur'),
    grab('js/stats.js', 'dayStartWords'), grab('js/stats.js', 'wordsToday'), grab('js/stats.js', 'dailyWordsSeries')].join('\n')).runInContext(ctx);
  return ctx;
}
const key = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

describe('AUD-08-003 — « aujourd\'hui » depuis la première ouverture du jour', () => {
  it('la base est fixée une fois par jour : rouvrir le manuscrit ne remet pas le compteur à 0', () => {
    const db = { sessionStats: {} }; const c = statsCtx(db);
    expect(vm.runInContext('wordsToday(1000)', c)).toBe(0);          // première ouverture du jour : base = 1000
    expect(vm.runInContext('wordsToday(1050)', c)).toBe(50);
    // « rechargement » : la base est relue dans db.dayStart, pas recalculée au total courant
    expect(vm.runInContext('dayStartWords(1050)', c)).toBe(1000);
    expect(vm.runInContext('wordsToday(1050)', c)).toBe(50);
  });
  it('un nouveau jour repart de zéro', () => {
    const db = { dayStart: { k: key(1), w: 900 } }; const c = statsCtx(db);
    expect(vm.runInContext('wordsToday(1200)', c)).toBe(0);
    expect(db.dayStart.k).toBe(key(0));
  });
  it('supprimer du texte ne rend jamais le compteur négatif', () => {
    const c = statsCtx({}); vm.runInContext('dayStartWords(500)', c);
    expect(vm.runInContext('wordsToday(400)', c)).toBe(0);
  });
  it('dayStart est une donnée dérivée : exclue de la comparaison de synchronisation et de l\'empreinte GitHub', () => {
    expect(read('js/router.js')).toMatch(/SYNC_DERIVED_FIELDS = \[[^\]]*'dayStart'/);
    expect(read('js/library.js')).toMatch(/GIST_FP_EXCLUDED = \[[^\]]*'dayStart'/);
  });
  it('la base du jour est posée à l\'ouverture du manuscrit, et « Cette séance » garde l\'ancien décompte', () => {
    expect(read('js/router.js')).toContain('dayStartWords(sessionWordsStart)');
    expect(read('js/stats.js')).toContain("{v:sessionW,l:'Cette séance ('+elapsed+' min)'}");
  });
});

describe('AUD-08-004 — graphique « mots par jour » : écarts, pas totaux cumulés', () => {
  it('trace 500 et 30 pour des totaux de 1000, 1500 et 1530 ; 0 les jours sans écriture', () => {
    const db = { sessionStats: { [key(2)]: 1000, [key(1)]: 1500, [key(0)]: 1530 } }; const c = statsCtx(db);
    const s = vm.runInContext('dailyWordsSeries(7)', c);
    expect(s.length).toBe(7);
    expect(s.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(s.slice(5)).toEqual([500, 30]);
  });
  it('un trou de plusieurs jours est reporté sur le jour d\'écriture suivant', () => {
    const db = { sessionStats: { [key(5)]: 2000, [key(1)]: 2300 } }; const c = statsCtx(db);
    const s = vm.runInContext('dailyWordsSeries(7)', c);
    expect(s[5]).toBe(300);
    expect(s[2]).toBe(0);
  });
  it('aujourd\'hui utilise la base du jour quand elle existe', () => {
    const db = { sessionStats: { [key(1)]: 1500, [key(0)]: 1530 }, dayStart: { k: key(0), w: 1510 } }; const c = statsCtx(db);
    expect(vm.runInContext('dailyWordsSeries(7, 1530)', c)[6]).toBe(20);
  });
  it('le graphique utilise cette série', () => {
    expect(read('js/stats.js')).toContain('counts=dailyWordsSeries(7,totalW)');
  });
});

describe('AUD-08-002 — le compteur de la ligne du chapitre suit la frappe', () => {
  it('scheduleChapterCountRefresh met à jour la ligne active au bout de 300 ms', () => {
    vi.useFakeTimers();
    try {
      const dom = new JSDOM('<div id="chapter-list"><div class="chapter-item"><span class="ch-wordcount">0</span></div><div class="chapter-item active"><span class="ch-wordcount">0</span></div></div>', { runScripts: 'outside-only' });
      const ctx = dom.getInternalVMContext();
      ctx.setTimeout = setTimeout; ctx.clearTimeout = clearTimeout;
      ctx.db = { chapters: [{ n: 3 }, { n: 26 }] }; ctx.cur = 1; ctx.chapterWordCount = ch => ch.n;
      new vm.Script('let _chCountTimer = null;\n' + grab('js/editor.js', 'scheduleChapterCountRefresh')).runInContext(ctx);
      vm.runInContext('scheduleChapterCountRefresh()', ctx);
      expect(dom.window.document.querySelector('.active .ch-wordcount').textContent).toBe('0');
      vi.advanceTimersByTime(320);
      expect(dom.window.document.querySelector('.active .ch-wordcount').textContent).toBe('26');
      expect(dom.window.document.querySelector('.chapter-item:not(.active) .ch-wordcount').textContent).toBe('0');
    } finally { vi.useRealTimers(); }
  });
  it('liveCounter la déclenche', () => { expect(grab('js/editor.js', 'liveCounter')).toContain('scheduleChapterCountRefresh()'); });
});

describe('AUD-08-005 / 006 — plus de reste de maquette ni d\'emoji en entité', () => {
  it('aucun « ... » en dur dans les cadres d\'édition des fiches', () => {
    for (const id of ['char-edit', 'place-edit', 'quest-edit']) expect(html).toContain('id="' + id + '"></div>');
    expect(read('css/style.css')).toContain('.edit-box:empty{display:none;}');
  });
  it('index.html ne contient aucune entité numérique d\'emoji (&#1xxxxx;)', () => { expect(html).not.toMatch(/&#(?:1\d{5}|x1[0-9a-fA-F]{4});/); });
  it('l\'onglet Mémoire : icône du sprite, titre accentué, exemple court et accentué', () => {
    expect(html).not.toContain('Memoire');
    expect(html).toContain('Mémoire narrative</strong>');
    expect(html).toContain('placeholder="Que portait Léa au chapitre 3 ?"');
  });
});

describe('AUD-08-013 — pluriels à la française', () => {
  const c = vm.createContext({}); new vm.Script(grab('js/schema.js', 'plur')).runInContext(c);
  it('0 et 1 au singulier, 2 et plus au pluriel', () => {
    expect(vm.runInContext("plur(0,'mot','mots')", c)).toBe('mot');
    expect(vm.runInContext("plur(1,'mot','mots')", c)).toBe('mot');
    expect(vm.runInContext("plur(2,'mot','mots')", c)).toBe('mots');
  });
  it('aucun « mot(s) » dans les textes affichés (hors commentaires et noms de fonctions)', () => {
    const bad = [];
    for (const f of jsFiles) read('js/' + f).split('\n').forEach((l, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
      if (/[a-zéèêàùôûîç]\(s\)/i.test(l.replace(/(escapeRegExp|appendChild|String|querySelector|normalize|escapeXml|stringify|intersectsNode|escapeRegExpFr|normalizeCode)\(s\)/g, '').replace(/\/\/.*$/, '')) && !/function \w+\(s\)/.test(l)) bad.push(f + ':' + (i + 1));
    });
    expect(bad).toEqual([]);
  });
});

describe('AUD-08-023 — plus de glyphes Unicode ni d\'anglicismes dans les libellés de boutons', () => {
  it('aucun bouton de index.html ne commence ou ne finit par une flèche, un symbole ou un carré Unicode (hors Retour au texte du volet)', () => {
    const bad = [...html.matchAll(/<button\b[^>]*>([^<]*)<\/button>/g)].map(m => m[1].trim())
      .filter(t => /[←-⇿⏩-⏿■-◿☀-➿⤀-⧿⬀-⯿]/.test(t));
    expect(bad).toEqual([]);
  });
  it('« Reset » et « GO » ne sont plus affichés', () => {
    expect(html).not.toMatch(/>\s*[^<]*\bReset\s*</);
    expect(html).not.toMatch(/id="search-btn"[^>]*>GO</);
    expect(html).toContain('Réinitialiser');
  });
  it('le menu des chapitres utilise des icônes du sprite', () => {
    const menu = html.slice(html.indexOf('id="chapter-ctx-menu"'), html.indexOf('id="cctx-del"'));
    expect(menu.match(/#i-/g).length).toBe(4);
    expect(html).toContain('<use href="#i-merge">');
  });
});
