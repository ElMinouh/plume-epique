// ═══════════════════════════════════════════════════════
// LOT 5 de l'audit AUD-10 (v9.94.0) : relecture outillée.
//   008 remarques de relecture depuis le mode Lecture · 009 passes datées et statuts définis
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

function app(chapters, { note = 'À reprendre' } = {}) {
  const dom = new JSDOM(`<body>
    <div id="writer"></div><div id="reading-content"></div>
    <span id="chapter-notes-badge"></span><div id="chapter-remarks-list"></div>
    <input type="checkbox" id="pass-structure"><input type="checkbox" id="pass-continuite"><input type="checkbox" id="pass-style"><input type="checkbox" id="pass-langue">
  </body>`, { runScripts: 'outside-only' });
  const win = dom.window; win.toasts = []; win.saves = 0; win.prompts = []; win.noteReponse = note;
  const ctx = dom.getInternalVMContext(), run = c => new vm.Script(c).runInContext(ctx);
  const ed = read('js/editor.js');
  const a = ed.indexOf('const REVIEW_PASSES'), b = ed.indexOf('\n}\n', ed.indexOf('function warnFinalWithoutPasses')) + 3;
  run(`
    var db = { chapters: ${JSON.stringify(chapters)} }, cur = 0;
    function toast(m, t) { toasts.push({ m, t }); } function debouncedSave() { saves++; }
    function getTodayKey() { return '2026-11-18'; } function plur(n, s, p) { return Math.abs(n) >= 2 ? p : s; }
    function updateGoalsUI() {}
    async function showPromptModal(o) { prompts.push(o); return noteReponse; }
  `);
  run(ed.slice(a, b));
  return { win, d: win.document, run };
}
function lecture(d, chapitres) {
  d.getElementById('reading-content').innerHTML = chapitres.map((t, i) => `<div class="reading-chapter" data-ch-idx="${i}"><h2>Ch ${i + 1}</h2><p>${t}</p></div>`).join('');
}
function selectionner(win, d, idx, mot) {
  const p = d.querySelectorAll('.reading-chapter')[idx].querySelector('p'), node = p.firstChild, at = node.textContent.indexOf(mot);
  const r = d.createRange(); r.setStart(node, at); r.setEnd(node, at + mot.length);
  const s = win.getSelection(); s.removeAllRanges(); s.addRange(r);
}
const CH = () => [{ id: 'a', title: 'Un', content: '<p>Marie ouvrit la porte et regarda dehors.</p>' }, { id: 'b', title: 'Deux', content: '<p>Le village dormait.</p>' }];

describe('AUD-10-008 : remarques depuis le mode Lecture', () => {
  it('« Noter la sélection » range la remarque dans le BON chapitre, avec l\'extrait et la date', async () => {
    const { win, d, run } = app(CH());
    lecture(d, ['Marie ouvrit la porte et regarda dehors.', 'Le village dormait.']);
    selectionner(win, d, 1, 'village dormait');
    await run('addRemarkFromReading()');
    const r = JSON.parse(run('JSON.stringify(db.chapters[1].remarks)'));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ q: 'village dormait', n: 'À reprendre', done: false, at: '2026-11-18' });
    expect(run('(db.chapters[0].remarks || []).length')).toBe(0);
    expect(win.saves).toBeGreaterThan(0);
    expect(win.toasts.at(-1).m).toBe('Remarque ajoutée au chapitre 2.');
    expect(win.prompts[0].message).toContain('village dormait');
  });
  it('sans sélection, ou fenêtre annulée, ou remarque vide : rien n\'est créé', async () => {
    const { win, d, run } = app(CH());
    lecture(d, ['Marie ouvrit la porte.', 'Le village dormait.']);
    win.getSelection().removeAllRanges();
    await run('addRemarkFromReading()');
    expect(win.toasts.at(-1).t).toBe('info');
    selectionner(win, d, 0, 'porte');
    win.noteReponse = null; await run('addRemarkFromReading()');
    selectionner(win, d, 0, 'porte');
    win.noteReponse = '   '; await run('addRemarkFromReading()');
    expect(run('(db.chapters[0].remarks || []).length')).toBe(0);
  });
  it('plafond de 50 remarques par chapitre', async () => {
    const { win, d, run } = app([{ id: 'a', title: 'Un', content: '', remarks: Array.from({ length: 50 }, (_, i) => ({ id: 'x' + i, q: 'q', n: 'n', done: false })) }]);
    lecture(d, ['Marie ouvrit la porte.']);
    selectionner(win, d, 0, 'porte');
    await run('addRemarkFromReading()');
    expect(run('db.chapters[0].remarks.length')).toBe(50);
    expect(win.toasts.at(-1).m).toMatch(/50 remarques/);
  });
  it('le passage est retrouvé par son texte (espaces repliés, casse ignorée) ; absent : « passage modifié depuis »', () => {
    const { win, d, run } = app([{ id: 'a', title: 'Un', content: '', remarks: [
      { id: 'r1', q: 'REGARDA   dehors', n: 'vérifier', done: false, at: '' }, { id: 'r2', q: 'phrase disparue', n: 'à revoir', done: false, at: '' }] }]);
    d.getElementById('writer').innerHTML = '<p>Marie ouvrit la porte et regarda\ndehors.</p>';
    run('renderChapterReview()');
    const txt = d.getElementById('chapter-remarks-list').textContent;
    expect(txt).toContain('vérifier');
    expect(txt).not.toMatch(/vérifier \(passage modifié/);
    expect(txt).toMatch(/à revoir \(passage modifié depuis\)/);
    const range = run("findQuoteRange(document.getElementById('writer'), 'REGARDA   dehors')");
    expect(range.toString().replace(/\s+/g, ' ')).toBe('regarda dehors');
  });
  it('« Aller au passage » sélectionne le texte ; « Fait » et « Supprimer » mettent à jour la liste et le badge', () => {
    const { win, d, run } = app([{ id: 'a', title: 'Un', content: '', remarks: [
      { id: 'r1', q: 'la porte', n: 'ouverte ?', done: false, at: '' }, { id: 'r2', q: 'dehors', n: 'flou', done: false, at: '' }] }]);
    d.getElementById('writer').innerHTML = '<p>Marie ouvrit la porte et regarda dehors.</p>';
    d.getElementById('writer').scrollIntoView = () => {}; d.querySelector('#writer p').scrollIntoView = () => {};
    run('renderChapterReview()');
    expect(d.getElementById('chapter-notes-badge').textContent).toBe(' (2)');
    [...d.querySelectorAll('#chapter-remarks-list button')].find(b => b.textContent === 'Aller au passage').click();
    expect(win.getSelection().toString()).toBe('la porte');
    d.querySelector('#chapter-remarks-list input[type=checkbox]').click();
    expect(run('db.chapters[0].remarks[0].done')).toBe(true);
    expect(d.getElementById('chapter-notes-badge').textContent).toBe(' (1)');
    [...d.querySelectorAll('#chapter-remarks-list button')].filter(b => b.textContent === 'Supprimer')[0].click();
    expect(run('db.chapters[0].remarks.length')).toBe(1);
  });
  it('le texte des remarques n\'est jamais injecté en HTML', () => {
    const { d, run } = app([{ id: 'a', title: 'Un', content: '', remarks: [{ id: 'r', q: '<img src=x onerror=1>', n: '<b>gras</b>', done: false, at: '' }] }]);
    run('renderChapterReview()');
    expect(d.querySelector('#chapter-remarks-list img, #chapter-remarks-list b')).toBeNull();
  });
});

describe('AUD-10-009 : passes de relecture', () => {
  it('cocher une passe enregistre la date du jour, décocher l\'efface ; l\'infobulle la dit', () => {
    const { d, run } = app(CH());
    run('onPassToggle("style", true)');
    expect(run('db.chapters[0].passes.style')).toBe('2026-11-18');
    expect(d.getElementById('pass-style').checked).toBe(true);
    expect(d.getElementById('pass-style').title).toMatch(/Style : faite le 18\/11\/2026/);
    run('onPassToggle("style", false)');
    expect(run('db.chapters[0].passes.style')).toBeNull();
    expect(d.getElementById('pass-style').title).toMatch(/pas encore faite/);
  });
  it('« Final » avec des passes non faites : information NON bloquante qui les nomme', () => {
    const { win, run } = app(CH());
    run('onPassToggle("structure", true); onPassToggle("langue", true)');
    run('warnFinalWithoutPasses()');
    expect(win.toasts.at(-1)).toEqual({ m: 'Final avec 2 passes non faites (continuité, style).', t: 'info' });
    const avant = win.toasts.length;
    run('onPassToggle("continuite", true); onPassToggle("style", true); warnFinalWithoutPasses()');
    expect(win.toasts.length).toBe(avant);
  });
  it('données défensives : passes et remarques invalides venues d\'un import sont normalisées', () => {
    const { run } = app([{ id: 'a', title: 'Un', content: '', passes: { structure: 'hier', style: '2026-11-01', inconnue: '2026-11-02' }, remarks: [null, { q: 5 }, { q: 'ok', n: 'x'.repeat(900), done: 'oui' }] }]);
    run('normalizeChapterReview(db.chapters[0])');
    expect(JSON.parse(run('JSON.stringify(db.chapters[0].passes)'))).toEqual({ structure: null, continuite: null, style: '2026-11-01', langue: null });
    const r = JSON.parse(run('JSON.stringify(db.chapters[0].remarks)'));
    expect(r).toHaveLength(1);
    expect(r[0].n.length).toBe(500);
    expect(r[0].done).toBe(false);
    expect(r[0].id).toBeTruthy();
  });
  it('Config : le bilan de révision compte les passes faites', () => {
    const s = read('js/stats.js');
    expect(s).toContain('function reviewPassesCount()');
    expect(s).toContain('Passes de relecture : ${reviewPassesCount().faites} sur ${reviewPassesCount().total}.');
  });
});

describe('AUD-10-008/009 : branchement, exports, impression', () => {
  const h = read('index.html'), r = read('js/router.js'), css = read('css/style.css');
  it('le bouton, les cases, la liste et le badge existent ; les statuts sont définis à l\'écran', () => {
    for (const id of ['reading-note-btn', 'reading-actions', 'pass-structure', 'pass-continuite', 'pass-style', 'pass-langue', 'chapter-remarks-list', 'chapter-notes-badge']) expect(h).toContain('id="' + id + '"');
    expect(h).toContain('Brouillon : en cours d\'écriture · À revoir : relecture en cours · Final : relu, prêt à être lu par d\'autres.');
    expect(r).toContain("getElementById('reading-note-btn').addEventListener('click',addRemarkFromReading)");
    expect(r).toContain("if(e.target.value==='final')warnFinalWithoutPasses()");
  });
  it('chaque chapitre du mode Lecture porte son indice (data-ch-idx) ; la saisie passe devant le mode Lecture ; rien à l\'impression', () => {
    expect(read('js/editor.js')).toContain('<div class="reading-chapter" data-ch-idx="${i}">');
    expect(css).toContain('#confirm-modal-overlay{display:none;position:fixed;inset:0;z-index:9600;');
    expect(css).toMatch(/#reading-overlay\.active button,#reading-actions\{display:none !important;\}/);
  });
  it('remarques et passes ne sont écrites dans aucun export de texte (DOCX, EPUB, ODT, PDF)', () => {
    const ex = read('js/export-format-utils.js');
    expect(ex).not.toMatch(/\.remarks|\.passes/);
  });
  it('un chapitre copié ou scindé ne reprend pas les remarques', () => {
    const ed = read('js/editor.js');
    const copie = ed.slice(ed.indexOf("title: (orig.title||'Chapitre') + ' (copie)'"), ed.indexOf("researchNotes: orig.researchNotes || '' };") + 50);
    expect(copie).not.toContain('remarks');
  });
});
