// ═══════════════════════════════════════════════════════
// AUD-08 LOT 4 (v9.83.0) — MESSAGES ET COULEURS DE VISUALISATION (AUD-08-014, 015, 016, 017)
// ═══════════════════════════════════════════════════════
import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const css = read('css/style.css');
function grab(file, name, kw = 'function ') {
  const src = read(file), i = src.indexOf(kw + name);
  if (i < 0) throw new Error(name + ' introuvable');
  let d = 0; const j = src.indexOf(') {', i) + 2; // saute les valeurs par défaut du type opts={}
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const NOTIF = ['hideToast', 'scheduleNextToast', 'toast', 'showToastNow', 'messageErreurLisible', 'toastError', 'themeColor', 'withAlpha', 'chartPalette'].map(n => grab('js/notifications.js', n + '(')).join('\n');

function app() {
  const dom = new JSDOM('<div id="toast"></div>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const ctx = dom.getInternalVMContext();
  ctx.setTimeout = setTimeout; ctx.clearTimeout = clearTimeout; ctx.icon = n => '<i data-i="' + n + '"></i>';
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: t => { ctx.__copied = t; return Promise.resolve(); } }, configurable: true });
  new vm.Script('let _toastTimer = null, _toastQueue = [], _toastShownAt = 0, _toastNextTimer = null;\nconst TOAST_MIN_MS = 1200, TOAST_GAP_MS = 250, TOAST_QUEUE_MAX = 5;\n' + NOTIF).runInContext(ctx);
  return { d: dom.window.document, run: s => new vm.Script(s).runInContext(ctx), ctx };
}
const txt = a => a.d.getElementById('toast').textContent;

describe('AUD-08-015 — file de messages et action « Annuler »', () => {
  it('un message arrivé juste après un autre attend son tour au lieu de l\'effacer', () => {
    vi.useFakeTimers();
    try {
      const a = app();
      a.run("toast('Premier','success')"); a.run("toast('Deuxième','info')");
      expect(txt(a)).toContain('Premier'); expect(txt(a)).not.toContain('Deuxième');
      vi.advanceTimersByTime(3100);            // le premier disparaît (3 s)
      vi.advanceTimersByTime(300);             // 250 ms d'intervalle
      expect(txt(a)).toContain('Deuxième');
    } finally { vi.useRealTimers(); }
  });
  it('un doublon n\'est pas empilé ; les erreurs passent devant', () => {
    vi.useFakeTimers();
    try {
      const a = app();
      a.run("toast('A','success')"); a.run("toast('A','success')"); a.run("toast('B','info')"); a.run("toast('B','info')");
      expect(a.run('_toastQueue.length')).toBe(1);
      a.run("toast('Panne','error')");
      expect(txt(a)).toContain('Panne');
    } finally { vi.useRealTimers(); }
  });
  it('l\'action « Annuler » s\'affiche, exécute son code et ferme le message', () => {
    const a = app(); a.ctx.__done = 0;
    a.run("toast('Chapitre déplacé','success',{action:{label:'Annuler',onClick:()=>{__done++;}}})");
    const b = a.d.querySelector('#toast .toast-action');
    expect(b.textContent).toBe('Annuler');
    expect(a.d.getElementById('toast').classList.contains('has-action')).toBe(true);
    b.click();
    expect(a.ctx.__done).toBe(1);
    expect(a.d.getElementById('toast').classList.contains('show')).toBe(false);
  });
  it('la suppression d\'un chapitre ou d\'un manuscrit propose « Annuler »', () => {
    expect(grab('js/editor.js', 'deleteChapter(', 'async function ')).toContain("label: 'Annuler'");
    expect(read('js/library.js')).toContain("label: 'Annuler', onClick: () => restoreDocumentFromTrash(docId)");
  });
});

describe('AUD-08-014 — erreurs lisibles, plus de message brut', () => {
  const a = app();
  const m = (e, c) => a.run('messageErreurLisible(' + e + ', ' + JSON.stringify(c) + ')');
  it('réseau, accès, stockage, fichier, serveur, inconnu', () => {
    expect(m("new Error('Failed to fetch')", "L'export").message).toBe("L'export n'a pas abouti : la connexion a échoué (hors ligne ou service injoignable).");
    expect(m("new Error('GitHub 401 Bad credentials')", 'La sauvegarde').message).toContain("l'accès a été refusé");
    expect(m("Object.assign(new Error('x'),{name:'QuotaExceededError'})", 'Le stockage').message).toContain("l'espace de stockage est plein");
    expect(m("new Error('Unexpected token < in JSON')", "L'import").message).toContain('illisible');
    expect(m("new Error('HTTP 503')", 'La synchro').message).toContain('réessayez plus tard');
    expect(m("new Error('HTTP 422 : Payload too large')", 'La sauvegarde').message).toContain('HTTP 422 : Payload too large'); // détail HTTP gardé (AUD-01-026)
    expect(m("new Error('boom')", 'Ceci').message).toBe("Ceci n'a pas abouti : une erreur inattendue s'est produite.");
  });
  it('le détail technique reste disponible (bouton « Copier le détail ») et le texte de rassurance est ajouté', async () => {
    a.run("toastError('La sauvegarde GitHub', new Error('Failed to fetch'), 'Vos textes restent enregistrés sur cet appareil.')");
    expect(txt(a)).toContain('Vos textes restent enregistrés sur cet appareil.');
    expect(txt(a)).not.toContain('Failed to fetch');
    a.d.querySelector('#toast .toast-action').click();
    await Promise.resolve();
    expect(a.ctx.__copied).toBe('Failed to fetch');
  });
  it('plus aucun « Erreur : » + e.message dans l\'application', () => {
    for (const f of ['js/library.js', 'js/export-format-utils.js']) expect(read(f)).not.toMatch(/toast\('Erreur[^']*' \+ e\.message/);
  });
});

describe('AUD-08-016 — le message utilise les jetons du thème', () => {
  it('plus de #1a1a2e ni #e8e0d0 dans la règle #toast', () => {
    const r = css.match(/#toast\{[^}]*\}/)[0];
    expect(r).toContain('background:var(--surface-2)'); expect(r).toContain('color:var(--text)');
    expect(r).not.toMatch(/#1a1a2e|#e8e0d0/);
  });
});

describe('AUD-08-017 — graphiques aux couleurs du thème', () => {
  it('aucun rouge de l\'ancienne palette dans les graphiques, le graphe, le nuage et l\'animation vocale', () => {
    for (const f of ['js/stats.js', 'js/router.js', 'js/relations.js', 'js/wordcloud.js']) expect(read(f)).not.toMatch(/#c0392b|192,\s*57,\s*43/i);
    expect(css).not.toContain('rgba(192,57,43,0)');
  });
  it('chartPalette lit les jetons du thème, withAlpha convertit hex et rgb', () => {
    const ctx = vm.createContext({ document: { body: {} } });
    ctx.getComputedStyle = () => ({ getPropertyValue: n => ({ '--title': ' #8a6414 ', '--accent': '#1d3a5c' })[n] || '' });
    new vm.Script(grab('js/notifications.js', 'themeColor(') + grab('js/notifications.js', 'withAlpha(') + grab('js/notifications.js', 'chartPalette(')).runInContext(ctx);
    expect(vm.runInContext('chartPalette()[0]', ctx)).toBe('#8a6414');
    expect(vm.runInContext('chartPalette()[2]', ctx)).toBe('#2e7d4f'); // repli quand le jeton est absent
    expect(vm.runInContext("withAlpha('#8a6414', .5)", ctx)).toBe('rgba(138,100,20,0.5)');
    expect(vm.runInContext("withAlpha('rgb(10, 20, 30)', .2)", ctx)).toBe('rgba(10,20,30,0.2)');
  });
  it('au changement de thème, les graphiques déjà tracés sont recolorés', () => {
    expect(grab('js/notifications.js', 'runThemeSwitch(')).toContain('refreshThemedCharts');
    expect(read('js/stats.js')).toContain('function refreshThemedCharts()');
  });
});
