'use strict';
// URL du Worker Cloudflare qui relaie les appels vers l'API Anthropic
// (garde la clé API cachée côté serveur, jamais exposée dans le navigateur).
const WORKER_URL = 'https://plume-epique-ai.air7841.workers.dev';

async function callClaude(prompt, maxTokens=1000) {
  const resp = await fetch(WORKER_URL, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ prompt, max_tokens:maxTokens })
  });
  if (!resp.ok) { const err=await resp.json(); throw new Error(err.error?.message||`HTTP ${resp.status}`); }
  const data = await resp.json();
  return data.content?.map(b=>b.text||'').join('') || '';
}
async function generateAISummary() {
  flushCurrentChapter();
  const panel = document.getElementById('ai-summary-panel'), textEl = document.getElementById('ai-summary-text');
  const txt = getPlainText(db.chapters[cur].content);
  if (txt.length < 50) { toast('Chapitre trop court.','error'); return; }
  panel.classList.add('active'); showAiLoader('ai-summary-text');
  try {
    const s = await callClaude(`Résume ce chapitre en 3-5 phrases concises en français.\n\nChapitre: "${db.chapters[cur].title}"\n\n${txt.substring(0,3000)}`);
    textEl.innerText = s; textEl.dataset.generated = s;
  } catch(e) { textEl.innerHTML = `<span style="color:var(--danger);">❌ ${e.message}</span>`; }
}
function copyAISummaryToChapter() {
  const textEl = document.getElementById('ai-summary-text'), s = textEl.dataset.generated||textEl.innerText;
  if (s) { db.chapters[cur].summary=s; save(); toast('Résumé copié','success'); }
}
async function aiContinueSuggestions() {
  flushCurrentChapter();
  const text = getPlainText(db.chapters[cur].content);
  if (text.length < 100) { toast('Écrivez davantage.','error'); return; }
  const el = document.getElementById('ai-continue-result'); showAiLoader('ai-continue-result');
  try {
    const r = await callClaude(`Voici la fin d'un chapitre: "...${text.slice(-600)}"\n\nPropose 3 continuations numérotées 1. 2. 3., chacune en 2-3 phrases en français, avec des tons variés.`, 800);
    el.innerHTML = DOMPurify.sanitize(r.replace(/\n/g,'<br>'));
  } catch(e) { el.innerHTML = `<span style="color:var(--danger);">❌ ${e.message}</span>`; }
}
async function aiCheckInconsistencies() {
  flushCurrentChapter();
  const fullText = db.chapters.map(c=>getPlainText(c.content)).join('\n---\n');
  if (fullText.trim().length < 100) { toast('Pas assez de texte.','error'); return; }
  const bible = db.chars.map(c=>`${c.name} (${c.role||'?'}): ${c.phys||''} ${c.info||''}`).join('\n');
  const el = document.getElementById('ai-check-result'); showAiLoader('ai-check-result');
  try {
    const r = await callClaude(`Personnages: ${bible||'(vide)'}\n\nTexte: ${fullText.substring(0,4000)}\n\nListe les incohérences potentielles en français (max 5 points).`, 600);
    el.innerHTML = DOMPurify.sanitize(r.replace(/\n/g,'<br>'));
  } catch(e) { el.innerHTML = `<span style="color:var(--danger);">❌ ${e.message}</span>`; }
}
async function aiGenerateNames() {
  const genre = document.getElementById('name-genre-sel').value;
  const sex = document.getElementById('name-sex-sel').value;
  const el = document.getElementById('ai-names-result');
  showAiLoader('ai-names-result');
  try {
    const prompt = `Tu es un expert en création littéraire. Génère exactement 10 noms de personnages originaux pour un roman de genre "${genre}", pour des personnages ${sex === 'mixte' ? 'mixtes (hommes et femmes)' : sex === 'féminin' ? 'féminins' : 'masculins'}.

Format OBLIGATOIRE — une ligne par nom, exactement comme ceci :
Nom Prénom — trait de caractère court

Exemple :
Elara Voss — archiviste mystérieuse
Kael Dorn — guerrier tourmenté

Génère 10 noms maintenant, en français ou adaptés au genre ${genre} :`;

    const r = await callClaude(prompt, 600);
    const lines = r.split('\n').map(l => l.trim()).filter(l => l.length > 3 && (l.includes('—') || l.includes('-') || l.match(/^[A-ZÀ-Ÿ]/)));
    if (lines.length === 0) {
      el.innerHTML = DOMPurify.sanitize(r.replace(/\n/g, '<br>'));
    } else {
      el.innerHTML = lines.map(line => `<div style="padding:3px 0;border-bottom:1px solid var(--border);">${DOMPurify.sanitize(line)}</div>`).join('');
    }
  } catch(e) {
    el.innerHTML = `<span style="color:var(--danger);">❌ ${e.message}</span>`;
  }
}
