// ═══════════════════════════════════════════════════════
// LOT 4 de l'audit AUD-10 (v9.93.0) : mode « Coach » du chat IA (AUD-10-006). L'IA signale, explique et questionne ; elle ne
// réécrit pas et ne propose aucun bouton d'insertion dans le manuscrit. Le défaut reste « Produire ».
// (AUD-10-019, résumé écrit d'abord par l'auteur : refusé par le propriétaire le 13/11/2026, non traité.)
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

function app(stockage = {}) {
  const dom = new JSDOM(`<body>
    <select id="ai-chat-mode-sel"><option value="produce">P</option><option value="coach">C</option></select><div id="ai-chat-mode-note"></div>
    <div id="ai-chat-messages"></div><div id="ai-chat-chips"></div>
    <input type="checkbox" id="ai-chat-ctx-chapter" checked><div id="ai-chat-ctx-note"></div>
  </body>`, { runScripts: 'outside-only' });
  const win = dom.window; win.DOMPurify = createDOMPurify(win); win.store = stockage;
  const ctx = dom.getInternalVMContext(), run = c => new vm.Script(c).runInContext(ctx);
  run(`
    function getPlainText(h) { return (h || '').replace(/<[^>]*>/g, '').trim(); }
    var toast = () => {}; var showAiLoader = () => {}; var notifyThirdPartyDataUseOnce = async () => true; var flushCurrentChapter = () => {};
    var cur = 0; var db = { chapters: [{ id: 'a', title: 'Ch', content: '<p>Texte du chapitre.</p>' }], chars: [] };
  `);
  Object.defineProperty(win, 'localStorage', { configurable: true, value: { getItem: k => (k in stockage ? stockage[k] : null), setItem: (k, v) => { stockage[k] = String(v); } } });
  new vm.Script(read('js/schema.js')).runInContext(ctx);
  new vm.Script(read('js/icons.js')).runInContext(ctx);
  new vm.Script(read('js/ai.js')).runInContext(ctx);
  return { win, run, d: win.document, store: stockage };
}
const boutons = (d, sel) => [...d.querySelectorAll(sel + ' button')].map(b => b.textContent.replace(/\s+/g, ' ').trim());

describe('AUD-10-006 : choix du mode', () => {
  it('par défaut « Produire » (rien ne change sans choix) ; un mode inconnu est refusé', () => {
    const { run, store } = app();
    expect(run('aiMode()')).toBe('produce');
    run("setAiMode('nimporte')");
    expect(run('aiMode()')).toBe('produce');
    expect(store.plume_ai_mode).toBeUndefined();
  });
  it('le choix est mémorisé sur l\'appareil, affiché dans le sélecteur et expliqué', () => {
    const { run, d, store } = app();
    run("setAiMode('coach')");
    expect(store.plume_ai_mode).toBe('coach');
    expect(d.getElementById('ai-chat-mode-sel').value).toBe('coach');
    expect(d.getElementById('ai-chat-mode-note').textContent).toMatch(/ne réécrit pas/);
    run("setAiMode('produce')");
    expect(d.getElementById('ai-chat-mode-note').textContent).toBe('');
  });
  it('un stockage indisponible ne casse rien : Produire, et le mode se règle quand même pour la session', () => {
    const { win, run } = app();
    Object.defineProperty(win, 'localStorage', { configurable: true, value: { getItem() { throw new Error('bloqué'); }, setItem() { throw new Error('bloqué'); } } });
    expect(run('aiMode()')).toBe('produce');
    expect(() => run("setAiMode('coach')")).not.toThrow();
    expect(run('aiMode()')).toBe('coach');
  });
});

describe('AUD-10-006 : le prompt', () => {
  it('Produire : la consigne d\'origine ; Coach : pas de réécriture, principe nommé, question finale', () => {
    const { run } = app();
    expect(run('buildAiChatPrompt("Salut")')).toContain("Tu es un assistant d'écriture pour un roman en français.");
    run("setAiMode('coach')");
    const p = run('buildAiChatPrompt("Salut")');
    expect(p).toContain("coach d'écriture");
    expect(p).toContain('ne réécris jamais son texte');
    expect(p).toContain('nomme le principe en jeu');
    expect(p).toContain('termine par une question');
    expect(p).not.toContain("Tu es un assistant d'écriture pour un roman");
    expect(p).toContain('Utilisateur : Salut');
  });
});

describe('AUD-10-006 : puces et boutons', () => {
  it('puces génériques : génératives en Produire, questionnantes en Coach', () => {
    const { run, d } = app();
    run('renderAiChatChips()');
    expect(boutons(d, '#ai-chat-chips')).toEqual(['Trouver un nom', 'Suite possible', 'Idée de rebondissement']);
    run("setAiMode('coach')");
    expect(boutons(d, '#ai-chat-chips')).toEqual(["Qu'est-ce qui cloche ?", 'Que ressent ce personnage ?', "Quel est l'enjeu de la scène ?"]);
  });
  it('puces sur un passage : Reformuler/Continuer/Corriger en Produire ; points forts, questions, confusion en Coach — sans demande de réécriture', () => {
    const { run, d } = app();
    run("_aiChatSelectionText = 'Il marchait dans la rue.'; renderAiChatSelectionChips()");
    expect(boutons(d, '#ai-chat-chips')).toEqual(['Reformuler ce passage', 'Continuer ce passage', 'Corriger ce passage']);
    run("setAiMode('coach')");
    expect(boutons(d, '#ai-chat-chips')).toEqual(['Points forts et faibles', 'Pose-moi des questions', "Qu'est-ce qui est confus ?"]);
    d.querySelectorAll('#ai-chat-chips button').forEach(b => b.click());
    const saisie = d.getElementById('ai-chat-input');
    expect(saisie).toBeNull(); // pas de champ dans ce DOM de test : le remplissage est vérifié sur les textes ci-dessous
    const src = read('js/ai.js');
    expect(src).toContain('sans le réécrire');
    expect(src).toContain('sans proposer de réécriture');
  });
  it('« Corriger ce passage » (Produire) demande aussi d\'expliquer ce qui a été corrigé', () => {
    expect(read('js/ai.js')).toContain('puis liste en 2 ou 3 puces ce que tu as corrigé et pourquoi');
  });
  it('réponses de l\'IA : Insérer / Copier / Remplacer en Produire ; seulement Copier en Coach, même avec un passage à remplacer', () => {
    const { run, d } = app();
    run("_aiChatHistory = [{ role: 'user', text: 'Q' }, { role: 'assistant', text: 'R' }]; _aiChatPendingReplaceRange = {}; renderAiChatMessages()");
    expect(boutons(d, '#ai-chat-messages')).toEqual(['Insérer', 'Copier', 'Remplacer']);
    run("setAiMode('coach')");
    expect(boutons(d, '#ai-chat-messages')).toEqual(['Copier']);
  });
});

describe('AUD-10-006 : branchement', () => {
  it('le sélecteur existe, est étiqueté et branché ; le chat applique le mode à l\'ouverture', () => {
    const h = read('index.html');
    expect(h).toContain('<label for="ai-chat-mode-sel">Mode</label>');
    expect(h).toContain('id="ai-chat-mode-note"');
    expect(read('js/router.js')).toContain("getElementById('ai-chat-mode-sel').addEventListener('change'");
    expect(read('js/ai.js')).toMatch(/async function openAiChat\(\) \{\n  await loadAiChatHistoryIfNeeded\(\);\n  applyAiModeUI\(\);/);
  });
  it('le mode est propre à l\'appareil : aucun champ de manuscrit ajouté', () => {
    expect(read('js/schema.js')).not.toMatch(/aiMode|plume_ai_mode/);
  });
});
