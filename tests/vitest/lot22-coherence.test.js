// ════════════════════════════════════════════════════════════════════
// LOT D « cohérence » (v9.44.0, audit AUD-03-027, 009, 017, 025, 023)
//  • plus aucun confirm/prompt/alert natif : tout passe par les modales de l'application ;
//  • « Accueil » supprimé, déconnexion qui enregistre au lieu d'avertir à tort ;
//  • vocabulaire (versions, jeton, sauvegarde GitHub), vouvoiement ;
//  • formulaires d'accueil : Entrée, règle visible, erreur effacée à la saisie.
// ════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const jsFiles = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'));

describe('AUD-03-017 — plus de dialogues natifs', () => {
  it('aucun appel à alert / confirm / prompt dans js/ (hors commentaires)', () => {
    const bad = [];
    for (const f of jsFiles) {
      read('js/' + f).split(/\r?\n/).forEach((ln, i) => {
        const code = ln.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
        if (/(^|[^A-Za-z0-9_.$])(alert|confirm|prompt)\s*\(/.test(code)) bad.push(`${f}:${i + 1}: ${ln.trim().slice(0, 80)}`);
      });
    }
    expect(bad).toEqual([]);
  });

  function ctxModal() {
    const dom = new JSDOM(`<body><div id="confirm-modal-overlay"><div id="confirm-modal-title"></div><div id="confirm-modal-message"></div>
      <div id="confirm-modal-input-wrap" class="u-d-none"><label id="confirm-modal-input-label"></label><input id="confirm-modal-input"></div>
      <button id="confirm-modal-cancel-btn">Annuler</button><button id="confirm-modal-confirm-btn">Confirmer</button></div></body>`, { runScripts: 'outside-only', url: 'http://localhost/' });
    const ctx = dom.getInternalVMContext();
    new vm.Script(read('js/notifications.js')).runInContext(ctx);
    return { win: dom.window, run: c => new vm.Script(c).runInContext(ctx) };
  }
  it('showPromptModal : renvoie le texte saisi (Entrée ou bouton), null si annulé', async () => {
    const { win, run } = ctxModal();
    const d = win.document;
    let p = run("showPromptModal({ title:'t', label:'Tags', value:'a, b' })");
    expect(d.getElementById('confirm-modal-input').value).toBe('a, b');
    expect(d.getElementById('confirm-modal-input-wrap').classList.contains('u-d-none')).toBe(false);
    d.getElementById('confirm-modal-input').value = 'x, y';
    d.getElementById('confirm-modal-confirm-btn').click();
    expect(await p).toBe('x, y');
    p = run("showPromptModal({ title:'t', value:'z' })");
    d.getElementById('confirm-modal-input').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(await p).toBe('z');
    p = run("showPromptModal({ title:'t', value:'z' })");
    d.getElementById('confirm-modal-cancel-btn').click();
    expect(await p).toBeNull();
  });
  it('showInfoModal : un seul bouton, se referme et rend la main ; la confirmation suivante retrouve « Annuler »', async () => {
    const { win, run } = ctxModal();
    const d = win.document;
    const p = run("showInfoModal({ title:'À savoir', message:'Un.\\n\\nDeux.' })");
    expect(d.getElementById('confirm-modal-cancel-btn').classList.contains('u-d-none')).toBe(true);
    expect(d.getElementById('confirm-modal-confirm-btn').textContent).toBe("J'ai compris");
    d.getElementById('confirm-modal-confirm-btn').click();
    expect(await p).toBe(true);
    run("showConfirmModal({ title:'t', message:'m' })");
    expect(d.getElementById('confirm-modal-cancel-btn').classList.contains('u-d-none')).toBe(false);
    expect(d.getElementById('confirm-modal-input-wrap').classList.contains('u-d-none')).toBe(true);
  });
  it('la notice de confidentialité de l\'IA est une fenêtre dédiée, sans « Ce message ne s\'affichera plus »', () => {
    const src = read('js/profiles.js');
    expect(src).toContain("title: 'Vos textes et l\\'IA'");
    expect(src).not.toContain("Ce message ne s");
    expect(read('css/style.css')).toContain('#confirm-modal-message{white-space:pre-line;}');
    expect(read('css/style.css')).toContain('.u-jc-flex-end{justify-content:flex-end}');
  });
});

describe('AUD-03-009 — « Accueil » supprimé, déconnexion honnête', () => {
  it('plus aucun bouton ni fonction « Accueil »', () => {
    const html = read('index.html');
    for (const id of ['library-home-btn', 'editor-home-btn', 'ltop-home']) expect(html).not.toContain(id);
    for (const f of jsFiles) expect(read('js/' + f), f).not.toMatch(/goHome|library-home-btn|editor-home-btn|ltop-home/);
    expect(read('js/profiles.js')).not.toContain('seront perdues');
  });
  const src = read('js/profiles.js');
  const fn = src.slice(src.indexOf('async function logout()'), src.indexOf('// ── ÉCRAN 2'));
  function run({ library, failedSince, confirmAnswer, docType = 'texte' }) {
    const dom = new JSDOM(`<body class="${library ? 'library-mode' : ''}"></body>`, { runScripts: 'outside-only' });
    const calls = [];
    const g = {
      _currentDocumentId: 'd1', db: { docType },
      flushCurrentChapter: () => calls.push('flush'), save: async () => { calls.push('save'); }, saveGraphicNovel: async () => { calls.push('saveGN'); },
      flushPendingSyncPushes: () => calls.push('push'), clearLocalSession: () => calls.push('clear'),
      showConfirmModal: async () => { calls.push('modal'); return confirmAnswer; },
      _saveFailedSince: failedSince ? new Date() : null, location: { reload: () => calls.push('reload') }
    };
    const body = new Function(...Object.keys(g), 'document', fn + '\nreturn logout();');
    return body(...Object.values(g), dom.window.document).then(() => calls);
  }
  it('depuis la bibliothèque : n\'enregistre pas (ne touche pas à la date), envoie les écritures en attente, se déconnecte', async () => {
    expect(await run({ library: true })).toEqual(['push', 'clear', 'reload']);
  });
  it('depuis l\'éditeur : enregistre PUIS se déconnecte, sans demander confirmation', async () => {
    expect(await run({ library: false })).toEqual(['flush', 'save', 'push', 'clear', 'reload']);
    expect(await run({ library: false, docType: 'roman_graphique' })).toEqual(['saveGN', 'push', 'clear', 'reload']);
  });
  it('si l\'enregistrement vient d\'échouer : demande confirmation, et reste connecté si on refuse', async () => {
    expect(await run({ library: false, failedSince: true, confirmAnswer: false })).toEqual(['flush', 'save', 'push', 'modal']);
    expect(await run({ library: false, failedSince: true, confirmAnswer: true })).toEqual(['flush', 'save', 'push', 'modal', 'clear', 'reload']);
  });
});

describe('AUD-03-025 — vocabulaire', () => {
  it('plus de « snapshot », « Gist » ni « token » dans le texte visible de index.html', () => {
    const visible = read('index.html').replace(/<!--[\s\S]*?-->/g, '').replace(/\s(id|class|data-[a-z-]+|for|aria-controls|aria-describedby)="[^"]*"/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
    expect(visible).not.toMatch(/\bsnapshots?\b|\bgist\b|\btoken\b/i);
  });
  it('anciennes formulations disparues des messages', () => {
    const all = jsFiles.map(f => read('js/' + f)).join('\n');
    for (const old of ['Colle un token', 'Token valide', 'Token invalide', 'Révision restaurée', 'Aucun snapshot', 'veux-tu', 'ton imprimeur', 'Erreur Gist', 'Sauvegarde Gist auto', "depuis le Gist"])
      expect(all, old).not.toContain(old);
    expect(read('js/database.js')).not.toContain("name:'Sans titre'");
  });
});

describe('AUD-03-023 — formulaires d\'accueil', () => {
  const src = read('js/profiles.js');
  const helpers = src.slice(src.indexOf('function wireGateForm'), src.indexOf('function gateShell'));
  function form() {
    const dom = new JSDOM(`<body><form id="f"><input id="a"><input id="b"><div class="gate-err">Erreur</div><div id="hint"></div>
      <button class="gate-btn-primary" id="ok">OK</button><button id="autre">Autre</button></form></body>`, { runScripts: 'outside-only' });
    const ctx = dom.getInternalVMContext(); const win = dom.window;
    win.clicks = [];
    new vm.Script('const MIN_PASSWORD_LENGTH = 12;\n' + helpers).runInContext(ctx);
    win.document.getElementById('ok').addEventListener('click', () => win.clicks.push('ok'));
    win.document.getElementById('autre').addEventListener('click', () => win.clicks.push('autre'));
    return { win, run: c => new vm.Script(c).runInContext(ctx) };
  }
  it('Entrée dans un champ déclenche une seule fois le bouton principal ; tous les boutons sont de type button', () => {
    const { win, run } = form(); const d = win.document;
    run("wireGateForm(document.getElementById('f'))");
    expect([...d.querySelectorAll('button')].every(b => b.type === 'button')).toBe(true);
    d.getElementById('a').dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(win.clicks).toEqual(['ok']);
  });
  it('l\'erreur affichée et l\'état « invalide » disparaissent dès qu\'on modifie un champ', () => {
    const { win, run } = form(); const d = win.document;
    run("wireGateForm(document.getElementById('f'))");
    run("gateFail(document.querySelector('.gate-err'), 'b', 'Trop court')");
    expect(d.querySelector('.gate-err').textContent).toBe('Trop court');
    expect(d.getElementById('b').getAttribute('aria-invalid')).toBe('true');
    expect(d.activeElement.id).toBe('b');
    d.getElementById('b').dispatchEvent(new win.Event('input', { bubbles: true }));
    expect(d.querySelector('.gate-err').textContent).toBe('');
    expect(d.getElementById('b').hasAttribute('aria-invalid')).toBe(false);
  });
  it('la règle « 12 caractères minimum » reste visible et compte pendant la saisie', () => {
    const { win, run } = form(); const d = win.document;
    run("wirePasswordHint('a', 'hint')");
    expect(d.getElementById('hint').textContent).toBe('12 caractères minimum (0/12)');
    d.getElementById('a').value = 'abcdefghijkl'; d.getElementById('a').dispatchEvent(new win.Event('input'));
    expect(d.getElementById('hint').textContent).toBe('✔ 12 caractères');
    expect(d.getElementById('hint').classList.contains('ok')).toBe(true);
  });
  it('plus de prénom « Cyril » préinscrit ; Entrée valide aussi « Mon profil »', () => {
    expect(src).not.toMatch(/value="Cyril"/);
    expect(src).toContain("const defaultName = '';");
    expect(read('js/router.js')).toContain("['mp-new-pwd2','mp-save-pwd-btn']");
  });
});

describe('AUD-03-027 — sélecteur de portée de l\'analyse', () => {
  it('pleine largeur de sa carte, libellés courts, explication en dessous', () => {
    const html = read('index.html');
    expect(html).toMatch(/<select id="ai-check-scope" class="field u-w-100pc/);
    expect(html).toContain('<option value="chapter">Ce chapitre</option>');
    expect(html).toContain('id="ai-check-scope-help"');
  });
});
