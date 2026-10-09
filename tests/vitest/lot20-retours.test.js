// ════════════════════════════════════════════════════════════════════
// LOT B « retours et couches » (v9.42.0, audit AUD-03-019, 018, 020, 021)
//  • messages : durées, minuteur annulé, ✕, échec d'enregistrement permanent ;
//  • confirmation : focus sur « Annuler » pour une action destructrice ;
//  • Échap : une seule couche à la fois ; Tab : seulement les vraies modales ;
//  • onglets du haut : motif accordéon (aria-expanded), plus de role="tab".
// ════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

function notifCtx() {
  const dom = new JSDOM(`<body>
    <div id="toast"></div><span id="autosave-label"></span><div id="save-indicator"></div>
    <div id="confirm-modal-overlay"><div id="confirm-modal-title"></div><div id="confirm-modal-message"></div>
      <div id="confirm-modal-input-wrap"><label id="confirm-modal-input-label"></label><input id="confirm-modal-input"></div>
      <button id="confirm-modal-cancel-btn">Annuler</button><button id="confirm-modal-confirm-btn">Confirmer</button></div>
    </body>`, { runScripts: 'outside-only' });
  const win = dom.window;
  win.timers = [];
  win.setTimeout = (fn, ms) => { const t = { fn, ms, on: true }; win.timers.push(t); return win.timers.length; };
  win.clearTimeout = id => { if (win.timers[id - 1]) win.timers[id - 1].on = false; };
  const ctx = dom.getInternalVMContext();
  new vm.Script(read('js/notifications.js'), { filename: 'js/notifications.js' }).runInContext(ctx);
  return { win, run: code => new vm.Script(code).runInContext(ctx) };
}

describe('AUD-03-019 — messages temporaires', () => {
  it('durées par type, ✕ sur les erreurs, minuteur précédent annulé', () => {
    const { win, run } = notifCtx();
    const el = win.document.getElementById('toast');
    run("toast('Bonjour', 'info')");
    expect(win.timers.at(-1).ms).toBe(4000);
    expect(el.querySelector('.toast-close')).toBeNull();
    run("toast('Fait', 'success')");
    expect(win.timers.at(-1).ms).toBe(3000);
    expect(win.timers[0].on).toBe(false); // le minuteur du 1er message ne coupe plus le 2e
    run("toast('Oups', 'error')");
    expect(win.timers.at(-1).ms).toBe(8000);
    expect(el.querySelector('.toast-close')).not.toBeNull();
    expect(el.classList.contains('has-close')).toBe(true);
  });
  it('un message « sticky » n\'est jamais retiré par minuteur, seul le ✕ le ferme', () => {
    const { win, run } = notifCtx();
    const n = win.timers.length;
    run("toast('Échec', 'error', { sticky: true, kind: 'save' })");
    expect(win.timers.length).toBe(n);
    const el = win.document.getElementById('toast');
    expect(el.classList.contains('show')).toBe(true);
    el.querySelector('.toast-close').click();
    expect(el.classList.contains('show')).toBe(false);
  });
  it('échec d\'enregistrement : état permanent dans le pied de page, effacé au premier succès (avec son message)', () => {
    const { win, run } = notifCtx();
    const lbl = win.document.getElementById('autosave-label');
    run("toast('⚠️ Échec', 'error', { sticky: true, kind: 'save' }); markSaveFailed();");
    expect(lbl.textContent).toMatch(/^⚠ Non enregistré depuis \d{2}:\d{2}$/);
    expect(lbl.classList.contains('save-failed')).toBe(true);
    run('markSaveFailed();'); // un 2e échec garde l'heure du 1er
    run('flashSave();');
    expect(lbl.textContent).toMatch(/^Enregistré à /);
    expect(lbl.classList.contains('save-failed')).toBe(false);
    expect(win.document.getElementById('toast').classList.contains('show')).toBe(false);
  });
  it('les chemins d\'échec (texte et roman graphique) utilisent le message permanent', () => {
    expect(read('js/router.js')).toMatch(/'error', \{ sticky: true, kind: 'save' \}\);\s*\n\s*if \(typeof markSaveFailed/);
    expect(read('js/graphicnovel.js')).toContain("kind: 'save' }); if (typeof markSaveFailed");
    expect(read('css/style.css')).toContain('#autosave-label.save-failed{display:inline!important');
  });
});

describe('AUD-03-018 — focus de la confirmation', () => {
  it('action destructrice : focus sur « Annuler » ; sinon sur « Confirmer »', async () => {
    const { win, run } = notifCtx();
    run("showConfirmModal({ title:'t', message:'m', danger:true })");
    expect(win.document.activeElement.id).toBe('confirm-modal-cancel-btn');
    run("showConfirmModal({ title:'t', message:'m' })");
    expect(win.document.activeElement.id).toBe('confirm-modal-confirm-btn');
  });
});

describe('AUD-03-020 — Échap : une couche à la fois', () => {
  const src = read('js/router.js');
  const code = src.slice(src.indexOf('function _isOn('), src.indexOf("document.addEventListener('keydown', escapeArbiter, true);"));
  function setup(html) {
    const dom = new JSDOM(`<body>${html}</body>`, { runScripts: 'outside-only' });
    const win = dom.window; win.closed = [];
    const ctx = dom.getInternalVMContext();
    new vm.Script(`
      function closeAiChat(){ closed.push('chat'); document.getElementById('ai-chat-panel').classList.remove('active'); }
      function closeFindReplace(){ closed.push('fr'); }
      function closeLibrarySystemPanel(){ closed.push('systeme'); document.getElementById('library-system-overlay').classList.remove('active'); }
      function closeShortcutsHelp(){} function exitFocus(){} function exitReadingMode(){} function closeGlobalSearch(){}
      function closeTrash(){} function closeDocTrash(){} function closeMyProfile(){} function closeManageProfiles(){}
      function closeGistHistory(){} function closeExportSelect(){} function closeDocxImportModal(){} function closeConflictDiff(){}
      ${code}
      document.addEventListener('keydown', escapeArbiter, true);
    `).runInContext(ctx);
    return win;
  }
  const esc = win => win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

  it('avec le panneau Système et le chat IA ouverts, un Échap ferme le Système seulement, le suivant le chat', () => {
    const win = setup(`<div id="library-system-overlay" class="active"></div><div id="ai-chat-panel" class="active"></div>`);
    esc(win);
    expect(win.closed).toEqual(['systeme']);
    esc(win);
    expect(win.closed).toEqual(['systeme', 'chat']);
  });
  it('la confirmation passe avant tout le reste (elle se ferme par son bouton Annuler)', () => {
    const win = setup(`<div id="confirm-modal-overlay" class="active"><button id="confirm-modal-cancel-btn"></button></div><div id="ai-chat-panel" class="active"></div>`);
    win.document.getElementById('confirm-modal-cancel-btn').addEventListener('click', () => { win.closed.push('annuler'); win.document.getElementById('confirm-modal-overlay').classList.remove('active'); });
    esc(win);
    expect(win.closed).toEqual(['annuler']);
  });
  it('s\'abstient quand une fenêtre « roman graphique » est ouverte (elle gère Échap elle-même)', () => {
    const win = setup(`<div class="gn-modal-overlay"></div><div id="ai-chat-panel" class="active"></div>`);
    esc(win);
    expect(win.closed).toEqual([]);
  });
  it('les anciens gestionnaires qui fermaient tout en bloc ont disparu', () => {
    expect(src).not.toContain("if(document.getElementById('gist-history-overlay').classList.contains('active'))closeGistHistory();");
    expect(read('js/library.js')).not.toMatch(/closeDocxImportModal\(\);\n\s*if \(document\.getElementById\('export-select-overlay'\)/);
  });
  it('Tab n\'est piégé que dans les vraies modales (aria-modal)', () => {
    expect(src).toContain(`querySelectorAll('[role="dialog"][aria-modal="true"]')`);
  });
});

describe('AUD-03-021 — onglets du haut en accordéon', () => {
  const tabs = read('js/tabs.js');
  it('plus de role="tab" ; aria-expanded et aria-controls tenus à jour', () => {
    expect(tabs).not.toContain("setAttribute('role','tab')");
    expect(tabs).toContain("btn.setAttribute('aria-expanded','false');btn.setAttribute('aria-controls',id);");
    expect(tabs).toContain("btn.setAttribute('aria-expanded','true')");
  });
  it('les cinq panneaux sont des régions nommées, pas des tabpanel orphelins', () => {
    const html = read('index.html');
    for (const t of ['tab-univers', 'tab-ia-memoire', 'tab-analysegroup', 'tab-systeme', 'tab-config'])
      expect(html).toMatch(new RegExp(`id="${t}" class="tab-content" role="region" aria-label="[^"]+"`));
  });
});
