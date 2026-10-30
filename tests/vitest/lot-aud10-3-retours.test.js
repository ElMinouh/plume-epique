// ═══════════════════════════════════════════════════════
// LOT 3 de l'audit AUD-10 (v9.92.0) : messages de seuil informatifs (018), repères d'indicateurs (010), points d'incohérence
// de l'IA exploitables : aller au chapitre, ignorer, retrouver (007).
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

// Extrait le bloc « POINTS D'INCOHÉRENCE » de ai.js et l'exécute dans une page JSDOM minimale.
function app(chapters, ignored) {
  const dom = new JSDOM('<body><div id="res"></div></body>', { runScripts: 'outside-only' });
  const ctx = dom.getInternalVMContext(), win = dom.window;
  win.visits = []; win.saves = 0;
  const ai = read('js/ai.js');
  const bloc = ai.slice(ai.indexOf('const AI_IGNORED_MAX'), ai.indexOf('async function generateAISummary'));
  const stop = read('js/wordcloud.js').split('\n')[1];
  new vm.Script(`
    ${stop}
    var db = { chapters: ${JSON.stringify(chapters)}, aiIgnored: ${JSON.stringify(ignored || [])} };
    function save() { saves++; } function changeCh(i) { visits.push(i); }
    function plur(n, s, p) { return Math.abs(n) >= 2 ? p : s; }
    function aiShowResult(el, note, body) { el.textContent = 'BRUT:' + note + '|' + body; }
  `).runInContext(ctx);
  new vm.Script(bloc).runInContext(ctx);
  return { win, d: win.document, run: s => new vm.Script(s).runInContext(ctx) };
}
const CH = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

describe('AUD-10-007 : analyse de la réponse de l\'IA', () => {
  it('« [Ch.3, Ch.9] » : chapitres lus dans le crochet, hors des chapitres existants écartés', () => {
    const { run } = app(CH);
    const p = JSON.parse(run(`JSON.stringify(parseAiPoints("[Ch.1, Ch.3] Marie a les yeux verts puis bleus.\\n- [Ch.9] Hors plage mais valable en texte.", 4))`));
    expect(p[0]).toMatchObject({ texte: 'Marie a les yeux verts puis bleus.', chapitres: [1, 3], neutre: false });
    expect(p[1].chapitres).toEqual([]);
  });
  it('sans crochet : les mentions « chapitre N » de la ligne sont reconnues ; puces et numéros retirés', () => {
    const { run } = app(CH);
    const p = JSON.parse(run(`JSON.stringify(parseAiPoints("1. Léo a 12 ans au chapitre 2 mais 14 ans au Ch.4.", 4))`));
    expect(p).toHaveLength(1);
    expect(p[0].chapitres).toEqual([2, 4]);
    expect(p[0].texte.startsWith('Léo')).toBe(true);
  });
  it('lignes d\'en-tête (« Partie 2 : ») et lignes trop courtes ignorées ; « Aucune incohérence » est un point neutre', () => {
    const { run } = app(CH);
    const p = JSON.parse(run(`JSON.stringify(parseAiPoints("Partie 2 :\\nok\\nAucune incohérence détectée.", 4))`));
    expect(p).toHaveLength(1);
    expect(p[0].neutre).toBe(true);
  });
});

describe('AUD-10-007 : affichage, aller au chapitre, ignorer, rétablir', () => {
  const REP = '[Ch.1, Ch.3] Marie a les yeux verts au chapitre un puis bleus au chapitre trois.\n[Ch.2] Le village change de nom entre deux scènes.';
  it('chaque point a ses boutons « Aller au chapitre N » et « Ignorer » ; le clic ouvre le bon chapitre', () => {
    const { d, run, win } = app(CH);
    run(`aiShowPoints(document.getElementById('res'), 'Note', ${JSON.stringify(REP)})`);
    const btns = [...d.querySelectorAll('#res button')].map(b => b.textContent);
    expect(btns).toEqual(['Aller au chapitre 1', 'Aller au chapitre 3', 'Ignorer', 'Aller au chapitre 2', 'Ignorer']);
    [...d.querySelectorAll('#res button')].find(b => b.textContent === 'Aller au chapitre 3').click();
    expect(win.visits).toEqual([2]);
    expect(d.getElementById('res').textContent).toContain('Note');
  });
  it('« Ignorer » mémorise le point (identifiants de chapitre) ; il disparaît, un compteur le retrouve ; « Rétablir » le rend', () => {
    const { d, run, win } = app(CH);
    run(`aiShowPoints(document.getElementById('res'), 'Note', ${JSON.stringify(REP)})`);
    [...d.querySelectorAll('#res button')].filter(b => b.textContent === 'Ignorer')[0].click();
    expect(win.saves).toBe(1);
    expect(JSON.parse(run('JSON.stringify(db.aiIgnored)'))[0].c).toEqual(['a', 'c']);
    expect(d.getElementById('res').textContent).not.toContain('yeux verts');
    const afficher = [...d.querySelectorAll('#res button')].find(b => /1 point ignoré — afficher/.test(b.textContent));
    expect(afficher).toBeTruthy();
    afficher.click();
    expect(d.getElementById('res').textContent).toContain('yeux verts');
    [...d.querySelectorAll('#res button')].find(b => b.textContent === 'Rétablir').click();
    expect(JSON.parse(run('JSON.stringify(db.aiIgnored)'))).toEqual([]);
    expect(d.getElementById('res').textContent).toContain('yeux verts');
  });
  it('à l\'analyse suivante, le même point — même légèrement reformulé — reste ignoré ; un autre point sur d\'autres chapitres non', () => {
    const { d, run } = app(CH);
    run(`aiShowPoints(document.getElementById('res'), 'N', ${JSON.stringify(REP)})`);
    [...d.querySelectorAll('#res button')].filter(b => b.textContent === 'Ignorer')[0].click();
    const reformule = '[Ch.1, Ch.3] Les yeux de Marie sont verts au chapitre un, puis bleus au chapitre trois.\n[Ch.1, Ch.4] Marie a les yeux verts au chapitre un puis bleus au chapitre trois.';
    run(`aiShowPoints(document.getElementById('res'), 'N', ${JSON.stringify(reformule)})`);
    const txt = d.getElementById('res').textContent;
    expect(txt).not.toContain('Les yeux de Marie');
    expect(txt).toContain('[Ch.1, Ch.4]');
  });
  it('réponse sans point reconnaissable : repli sur le texte brut, rien n\'est perdu', () => {
    const { d, run } = app(CH);
    run(`aiShowPoints(document.getElementById('res'), 'N', 'ok')`);
    expect(d.getElementById('res').textContent).toBe('BRUT:N|ok');
  });
  it('la liste des points ignorés est plafonnée', () => {
    const { run } = app(CH);
    run(`for (let i = 0; i < 75; i++) aiIgnorePoint({ texte: 'Point numéro unique' + String.fromCharCode(97 + (i % 26)) + ' mot' + 'x'.repeat(i % 7) + ' special' + i + 'zz', chapitres: [1] });`);
    expect(run('db.aiIgnored.length')).toBeLessThanOrEqual(60);
  });
  it('le texte de l\'IA n\'est jamais injecté en HTML (textContent)', () => {
    const { d, run } = app(CH);
    run(`aiShowPoints(document.getElementById('res'), 'N', '[Ch.1] <img src=x onerror=alert(1)> voilà un point suspect')`);
    expect(d.querySelector('#res img')).toBeNull();
  });
});

describe('AUD-10-007 : branchement', () => {
  const ai = read('js/ai.js');
  it('les deux analyses demandent « un point par ligne » préfixé par les chapitres et affichent via aiShowPoints', () => {
    expect(ai).toContain('commençant par « [Ch.${cur + 1}] »');
    expect(ai).toContain('par exemple « [Ch.3, Ch.9] »');
    expect((ai.match(/\n\s+aiShowPoints\(el, /g) || []).length).toBe(2);
  });
  it('db.aiIgnored est un champ du manuscrit (synchronisé, pas dérivé) présent dans le manuscrit neuf', () => {
    expect(read('js/schema.js')).toContain('aiIgnored:[]');
    expect(read('js/router.js')).not.toMatch(/SYNC_DERIVED_FIELDS = \[[^\]]*aiIgnored/);
    expect(read('js/library.js')).not.toMatch(/GIST_FP_EXCLUDED = \[[^\]]*aiIgnored/);
  });
});

describe('AUD-10-018 : messages de seuil informatifs', () => {
  const ai = read('js/ai.js');
  it('plus d\'ordre sec en alerte rouge : les seuils sont dits, en information', () => {
    for (const vieux of ["'Écrivez davantage.'", "'Pas assez de texte.'", "'Chapitre trop court.'", "'Sélection vide.'"]) expect(ai).not.toContain(vieux);
    expect(ai).toContain("il faut au moins 100 caractères pour que l'IA propose une suite (vous en avez ${text.length}).".replace('il', 'Il'));
    expect(ai).toContain('Il faut au moins 100 caractères pour analyser le chapitre (vous en avez ${text.trim().length}).');
    expect(ai).toContain('Il faut au moins 50 mots pour analyser le roman (vous en avez ${est.words}).');
    expect(ai).toContain("annulez-la.', 'info'");
  });
});

describe('AUD-10-010 : repères d\'indicateurs (textes statiques, périphérie gelée)', () => {
  const h = read('index.html');
  it('l\'écran Détail explique chaque indicateur sans norme chiffrée par genre', () => {
    expect(h).toContain('id="analytics-help"');
    for (const t of ['Mots/phrase', 'Score Flesch', 'Dialogue / narration', 'repère personnel et non une règle']) expect(h).toContain(t);
  });
  it('les mots faibles par défaut sont expliqués dans Config', () => {
    expect(h).toContain('« juste » et « très » sont proposés au départ');
    expect(h).toContain('« Analyser le style » du menu Outils');
  });
});
