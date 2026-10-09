// ═══════════════════════════════════════════════════════
// LOT 5 (v9.37.0) — UNE IA QUI DIT CE QU'ELLE LIT (AUD-02-002)
//  • le texte est découpé (le relais accepte 30 000 caractères) et lu EN ENTIER ;
//  • résumé : un résumé par morceau puis une synthèse ;
//  • incohérences : chapitre en entier, ou roman en deux temps avec estimation, plafond, annulation ;
//  • la portion lue est toujours annoncée.
// Le service d'IA est remplacé par un faux qui enregistre les demandes.
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const MAX_PROMPT = 30000; // limite du relais IA (worker/worker.js)

function makeContext(chapters, chars) {
  const dom = new JSDOM(`<body>
    <div id="ai-summary-panel"></div><div id="ai-summary-text"></div>
    <select id="ai-check-scope"><option value="chapter">c</option><option value="novel">n</option></select>
    <div id="ai-check-result"></div>
    <input type="checkbox" id="ai-chat-ctx-chapter" checked><div id="ai-chat-ctx-note"></div>
  </body>`, { runScripts: 'outside-only' });
  const win = dom.window;
  win.DOMPurify = createDOMPurify(win);
  const ctx = dom.getInternalVMContext();
  const run = code => new vm.Script(code).runInContext(ctx);
  run(`
    function getPlainText(html) { return (html||'').replace(/<br\\s*\\/?>/gi,'\\n').replace(/<\\/p>/gi,'\\n').replace(/<[^>]*>/g,'').trim(); }
    var toast = () => {}; var showAiLoader = () => {}; var notifyThirdPartyDataUseOnce = async () => {};
    var flushCurrentChapter = () => {}; var confirmAnswer = true; var confirmMessages = [];
    var showConfirmModal = async o => { confirmMessages.push(o.message); return confirmAnswer; };
    var cur = 0; var db = { chapters: [], chars: [] };
  `);
  new vm.Script(read('js/schema.js')).runInContext(ctx);
  new vm.Script(read('js/icons.js')).runInContext(ctx);
  new vm.Script(read('js/ai.js')).runInContext(ctx);
  win.__chapters = chapters; win.__chars = chars || [];
  run('db.chapters = __chapters; db.chars = __chars; var prompts = []; var respond = (p, n) => "réponse " + prompts.length; callClaude = async (p, n, onChunk) => { prompts.push(p); const r = respond(p, n); if (r instanceof Error) throw r; return r; }; AI_RETRY_DELAY_MS = 0;');
  return { win, run, doc: win.document };
}
const para = (n, label) => Array.from({ length: n }, (_, i) => `Phrase ${label}${i} du récit.`).join(' ');
const chapterHtml = (paragraphs, label) => paragraphs.map((n, k) => `<p>${para(n, label + k + '-')}</p>`).join('');

describe('Découpage du texte', () => {
  const { run } = makeContext([]);
  it('chaque morceau respecte la taille maximale et tout le texte est conservé', () => {
    const text = Array.from({ length: 60 }, (_, i) => 'Paragraphe numéro ' + i + ' ' + 'mot '.repeat(40)).join('\n');
    const chunks = run(`aiChunkText(${JSON.stringify(text)}, 2000)`);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(2000);
    expect(chunks.join('\n').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' ').trim());
  });
  it('un paragraphe plus long que la limite est coupé, sans perdre de mot', () => {
    const text = Array.from({ length: 500 }, (_, i) => 'phrase' + i + '.').join(' ');
    const chunks = run(`aiChunkText(${JSON.stringify(text)}, 1000)`);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1000);
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(text);
  });
});

describe('Résumé du chapitre en entier', () => {
  it('un chapitre long est lu en entier : chaque morceau est résumé, puis une synthèse', async () => {
    const html = chapterHtml([200, 200, 200, 200, 200], 'R'); // ≈ 5 × 4 400 caractères
    const { run, doc } = makeContext([{ id: 'c1', title: 'Long', content: html }]);
    expect(html.length).toBeGreaterThan(20000);
    await run('generateAISummary()');
    const prompts = run('prompts');
    expect(prompts.length).toBeGreaterThanOrEqual(3);
    const all = prompts.join('\n');
    expect(all).toContain('Phrase R0-0 du récit.');
    expect(all).toContain('Phrase R4-199 du récit.'); // la toute fin du chapitre est lue
    for (const p of prompts) expect(p.length).toBeLessThan(MAX_PROMPT);
    expect(prompts[prompts.length - 1]).toContain('Partie 1 :');
    const el = doc.getElementById('ai-summary-text');
    expect(el.innerText).toMatch(/Chapitre lu en entier \(\d+ mots, \d+ parties\)/); // innerText : simple propriété sous jsdom
    expect(el.dataset.generated).not.toMatch(/Chapitre lu en entier/);
  });
  it('un chapitre court : un seul appel et la mention « lu en entier »', async () => {
    const { run, doc } = makeContext([{ id: 'c1', title: 'Court', content: chapterHtml([20], 'C') }]);
    await run('generateAISummary()');
    expect(run('prompts').length).toBe(1);
    expect(doc.getElementById('ai-summary-text').innerText).toMatch(/Chapitre lu en entier \(\d+ mots\)\./);
  });
});

describe('Incohérences : ce chapitre', () => {
  it('le chapitre est envoyé en entier, comparé aux fiches, et la portée est annoncée', async () => {
    const html = chapterHtml([150, 150, 150, 150], 'K');
    const { run, doc } = makeContext([{ id: 'c1', title: 'Chap', content: html }], [{ name: 'Marie', role: 'héroïne', phys: 'yeux verts' }]);
    await run('aiCheckInconsistencies()');
    const prompts = run('prompts');
    const all = prompts.join('\n');
    expect(all).toContain('Phrase K0-0 du récit.');
    expect(all).toContain('Phrase K3-149 du récit.');
    expect(all).toContain('Marie (héroïne): yeux verts');
    for (const p of prompts) expect(p.length).toBeLessThan(MAX_PROMPT);
    const txt = doc.getElementById('ai-check-result').textContent;
    expect(txt).toMatch(/lu en entier/);
    expect(txt).toMatch(/Tout le roman/);
  });
});

describe('Incohérences : tout le roman en deux temps', () => {
  const novel = n => Array.from({ length: n }, (_, i) => ({ id: 'n' + i, title: 'Titre ' + (i + 1), content: chapterHtml([60, 60], 'N' + i + '-') }));
  it('l\'estimation regroupe les chapitres courts : moins d\'appels que de chapitres', () => {
    const { run } = makeContext(novel(12));
    const est = run('aiNovelEstimate(db.chapters)');
    expect(est.batches.length).toBeLessThan(12);
    expect(est.calls).toBe(est.batches.length + est.groups);
    expect(est.words).toBeGreaterThan(1000);
  });
  it('le mode roman demande confirmation, lit chaque chapitre, compare et annonce la portée', async () => {
    const { run, doc } = makeContext(novel(12), []);
    doc.getElementById('ai-check-scope').value = 'novel';
    run('respond = (p) => p.includes("Voici des faits") ? "Aucune contradiction." : "[Ch.1] fait court"');
    await run('aiCheckInconsistencies()');
    const prompts = run('prompts');
    const est = run('aiNovelEstimate(db.chapters)');
    expect(run('confirmMessages').length).toBe(1);
    expect(run('confirmMessages')[0]).toMatch(/12 chapitres/);
    const all = prompts.join('\n');
    for (let i = 0; i < 12; i++) expect(all).toContain('[Ch.' + (i + 1) + ' — Titre ' + (i + 1) + ']');
    expect(all).toContain('Phrase N11-1-59 du récit.'); // la fin du dernier chapitre est lue
    expect(prompts.length).toBe(est.batches.length + 1);
    expect(prompts[prompts.length - 1]).toContain('Voici des faits');
    for (const p of prompts) expect(p.length).toBeLessThan(MAX_PROMPT);
    const txt = doc.getElementById('ai-check-result').textContent;
    expect(txt).toMatch(/12 chapitres en entier/);
    expect(txt).toContain('Aucune contradiction.');
  });
  it('si vous refusez la confirmation, aucun appel n\'est fait', async () => {
    const { run, doc } = makeContext(novel(5), []);
    doc.getElementById('ai-check-scope').value = 'novel';
    run('confirmAnswer = false');
    await run('aiCheckInconsistencies()');
    expect(run('prompts').length).toBe(0);
  });
  it('un roman trop volumineux est refusé avec un message, sans appel', async () => {
    const huge = Array.from({ length: 60 }, (_, i) => ({ id: 'h' + i, title: 'T' + i, content: '<p>' + 'mot '.repeat(6000) + '</p>' })); // 24 000 caractères chacun
    const { run, doc } = makeContext(huge, []);
    doc.getElementById('ai-check-scope').value = 'novel';
    await run('aiCheckInconsistencies()');
    expect(run('prompts').length).toBe(0);
    expect(doc.getElementById('ai-check-result').textContent).toMatch(/maximum 40/);
  });
  it('l\'annulation arrête les appels suivants', async () => {
    const { run, doc } = makeContext(novel(12), []);
    doc.getElementById('ai-check-scope').value = 'novel';
    run('respond = (p) => { if (prompts.length === 2) _aiCheckToken.cancelled = true; return "faits"; }');
    await run('aiCheckInconsistencies()');
    expect(run('prompts').length).toBe(2);
    expect(doc.getElementById('ai-check-result').textContent).toMatch(/annulée/);
  });
  it('un appel qui échoue une fois est retenté', async () => {
    const { run, doc } = makeContext([{ id: 'c', title: 'Chap', content: chapterHtml([30], 'E') }], []);
    run('var failed = false; respond = () => { if (!failed) { failed = true; return new Error("limite"); } return "ok"; }');
    await run('aiCheckInconsistencies()');
    expect(run('prompts').length).toBe(2);
    expect(doc.getElementById('ai-check-result').textContent).toMatch(/lu en entier/);
  });
});

describe('Chat : portion du chapitre annoncée', () => {
  it('au-delà de 8 000 caractères, l\'écran indique la portion transmise', () => {
    const { run, doc } = makeContext([{ id: 'c', title: 'Gros', content: chapterHtml([400], 'G') }]);
    run('updateAiChatContextNote()');
    expect(doc.getElementById('ai-chat-ctx-note').textContent).toMatch(/8000 premiers caractères sur \d+/);
    const prompt = run('buildAiChatPrompt("Salut")');
    expect(prompt).toContain('Phrase G0-0 du récit.');
    expect(prompt).not.toContain('Phrase G0-399 du récit.');
  });
  it('un chapitre court est annoncé « lu en entier »', () => {
    const { run, doc } = makeContext([{ id: 'c', title: 'Petit', content: '<p>Court.</p>' }]);
    run('updateAiChatContextNote()');
    expect(doc.getElementById('ai-chat-ctx-note').textContent).toBe('Chapitre lu en entier.');
  });
});
