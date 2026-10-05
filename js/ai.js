'use strict';
// v7.21.0 — correctif : cette fonction appelait directement l'API Anthropic
// (reliquat d'un prototype antérieur au Worker), ce qui ne pouvait pas
// fonctionner : la CSP du projet (_headers) n'autorise que le Worker Cloudflare
// en connexion sortante, et aucune clé API n'est (ni ne doit être) présente
// côté client. Voir README, section "Intelligence artificielle" : le Worker
// (plume-epique-ai.air7841.workers.dev) relaie vers Google Gemini (Mistral
// jusqu'au 11/09/2026) et renvoie une
// réponse déjà normalisée au format {content:[{type:'text', text}]} — c'est ce
// format que le reste de cette fonction attendait déjà, donc seule l'URL
// changeait. Le corps de la requête a été ajusté suite à un test réel : le
// Worker attend un champ "prompt" direct (il a répondu "prompt manquant" avec
// le format Anthropic {messages:[...]}), pas un tableau de messages.
// v8.0.3 — Le Worker relaie désormais la réponse du fournisseur IA en flux (SSE,
// voir worker/worker.js) au lieu d'attendre la réponse complète : callClaude
// lit ce flux morceau par morceau et appelle onChunk(texte accumulé jusqu'ici)
// à chaque morceau reçu, pour un affichage progressif côté utilisateur.
// onChunk est optionnel — sans lui, callClaude se comporte comme avant :
// on attend simplement la fin et on renvoie le texte complet.
async function callClaude(prompt, maxTokens=1000, onChunk) {
  // v9.20.0 (audit AUD-01-004) — le relais IA exige désormais la clé de
  // synchronisation (même secret que le Worker de synchro). Sans elle (mode
  // « continuer sans synchronisation »), inutile d'appeler le réseau.
  const syncKey = (typeof getSyncKey === 'function') ? getSyncKey() : '';
  if (!syncKey) throw new Error("L'IA nécessite la clé de synchronisation (Système → Synchronisation). Elle n'est pas configurée sur cet appareil.");
  const resp = await fetchWithTimeout('https://plume-epique-ai.air7841.workers.dev', {
    timeoutMs: 60000, method:'POST', headers:{'Content-Type':'application/json', 'Authorization':'Bearer ' + syncKey},
    body:JSON.stringify({ prompt, maxTokens })
  });
  if (!resp.ok) {
    // v7.24.0 — correctif : resp.json() plantait si le Worker (ou Cloudflare
    // devant lui, en cas de panne) renvoyait une erreur en texte brut plutôt
    // qu'en JSON. On retombe alors sur le code HTTP plutôt que de laisser
    // planter la fonction.
    let msg = `HTTP ${resp.status}`;
    try { const err = await resp.json(); if (err.error?.message) msg = err.error.message; } catch(e) {}
    throw new Error(msg);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let full = '', buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    // Dernière ligne potentiellement incomplète (coupée en plein milieu par ce
    // morceau réseau) : gardée de côté, recollée au morceau suivant.
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const delta = JSON.parse(payload).choices?.[0]?.delta?.content || '';
        if (delta) { full += delta; if (onChunk) onChunk(full); }
      } catch(e) { /* morceau JSON non exploitable (rare, coupure réseau) : ignoré */ }
    }
  }
  return full;
}
// ═══════════════════════════════════════════════════════
// v9.37.0 (audit AUD-02-002) — UNE IA QUI DIT CE QU'ELLE LIT
// Avant : le résumé n'envoyait que les 3 000 premiers caractères du chapitre, et « Incohérences » les
// 4 000 premiers caractères du roman mis bout à bout (≈ 650 mots), sans le dire. Désormais :
//  • le texte est découpé en morceaux (le relais IA accepte au plus 30 000 caractères par demande) ;
//  • le résumé lit le chapitre en entier (un résumé par morceau, puis une synthèse) ;
//  • « Incohérences » : « Ce chapitre » (lu en entier, comparé aux fiches) ou « Tout le roman » en deux
//    temps — 1) faits extraits par paquets de chapitres, 2) faits comparés entre eux — avec estimation,
//    confirmation, progression, annulation et plafond d'appels ;
//  • l'écran indique toujours la portion réellement lue.
// ═══════════════════════════════════════════════════════
const AI_CHUNK_CHARS = 12000;          // résumé / contrôle d'un chapitre : taille d'un morceau
const AI_BATCH_CHARS = 20000;          // contrôle du roman : texte lu par appel (plusieurs chapitres courts, ou un morceau)
const AI_FACTS_GROUP_CHARS = 24000;    // faits comparés par appel
const AI_FACTS_EST_PER_BATCH = 4000;   // estimation (par excès) des faits renvoyés par paquet
const AI_BIBLE_MAX_CHARS = 4000;       // fiches personnages transmises au plus
const AI_CHAT_CHAPTER_CHARS = 8000;    // chapitre transmis au chat
const AI_MAX_CALLS = 40;               // plafond d'appels pour une analyse du roman
const AI_SECONDS_PER_CALL = 6;         // durée moyenne d'un appel (pour l'estimation affichée)
let AI_RETRY_DELAY_MS = 3000;

// Découpe un texte en morceaux d'au plus `maxChars`, en coupant de préférence entre paragraphes,
// sinon à la fin d'une phrase, sinon à un espace.
function aiChunkText(text, maxChars) {
  const out = [];
  let cur = '';
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
  for (const para of String(text || '').split('\n')) {
    let p = para;
    while (p.length > maxChars) {
      let cut = p.lastIndexOf('. ', maxChars);
      if (cut < maxChars * 0.5) cut = p.lastIndexOf(' ', maxChars);
      cut = cut < maxChars * 0.5 ? maxChars : cut + 1;
      if (cur.length + cut + 1 > maxChars) push();
      cur += (cur ? '\n' : '') + p.slice(0, cut);
      p = p.slice(cut).trimStart();
      push();
    }
    if (cur.length + p.length + 1 > maxChars) push();
    cur += (cur ? '\n' : '') + p;
  }
  push();
  return out;
}
// Fiches personnages, limitées pour ne jamais dépasser la taille acceptée par le relais.
function aiBibleText() {
  const full = (db.chars || []).map(c => `${c.name} (${c.role || '?'}): ${c.phys || ''} ${c.info || ''}`).join('\n');
  return full.length > AI_BIBLE_MAX_CHARS ? full.slice(0, AI_BIBLE_MAX_CHARS) + '\n[fiches tronquées]' : full;
}
// Paquets de chapitres à lire pour l'extraction des faits : plusieurs chapitres courts par appel ; un chapitre
// plus long que AI_BATCH_CHARS est découpé en plusieurs paquets. Chaque bloc est précédé de [Ch.N — titre].
function aiNovelBatches(chapters) {
  const batches = [];
  let cur = null;
  const open = () => { cur = { parts: [], chars: 0, from: null, to: null }; batches.push(cur); };
  chapters.forEach((ch, i) => {
    const text = getPlainText(ch.content);
    if (!text.trim()) return;
    const title = String(ch.title || '').trim() || 'sans titre';
    const pieces = text.length > AI_BATCH_CHARS ? aiChunkText(text, AI_BATCH_CHARS) : [text];
    pieces.forEach((piece, k) => {
      const head = pieces.length > 1 ? `[Ch.${i + 1} — ${title} — partie ${k + 1}/${pieces.length}]` : `[Ch.${i + 1} — ${title}]`;
      const block = head + '\n' + piece;
      if (!cur || cur.chars + block.length > AI_BATCH_CHARS) open();
      cur.parts.push(block);
      cur.chars += block.length + 2;
      if (cur.from === null) cur.from = i + 1;
      cur.to = i + 1;
    });
  });
  return batches.map(b => ({ text: b.parts.join('\n\n'), from: b.from, to: b.to }));
}
function aiNovelEstimate(chapters) {
  const batches = aiNovelBatches(chapters);
  const groups = Math.max(1, Math.ceil(batches.length * AI_FACTS_EST_PER_BATCH / AI_FACTS_GROUP_CHARS));
  const calls = batches.length + groups;
  const words = chapters.reduce((t, c) => t + getWordCount(c.content), 0);
  return { batches, groups, calls, words, seconds: calls * AI_SECONDS_PER_CALL };
}
// Regroupe les listes de faits (une par paquet) en groupes d'au plus AI_FACTS_GROUP_CHARS.
function aiPackFacts(factBlocks) {
  const groups = [];
  let cur = '';
  factBlocks.forEach(block => {
    const b = block.length > AI_FACTS_GROUP_CHARS ? block.slice(0, AI_FACTS_GROUP_CHARS) : block;
    if (cur && cur.length + b.length + 2 > AI_FACTS_GROUP_CHARS) { groups.push(cur); cur = ''; }
    cur += (cur ? '\n\n' : '') + b;
  });
  if (cur) groups.push(cur);
  return groups;
}
// Un appel IA avec une nouvelle tentative après une courte pause (limite de débit passagère).
async function aiCall(prompt, maxTokens, token) {
  const stopped = () => token && token.cancelled;
  if (stopped()) throw new Error('Analyse annulée.');
  try { return await callClaude(prompt, maxTokens); }
  catch (e) {
    if (stopped()) throw new Error('Analyse annulée.');
    await new Promise(r => setTimeout(r, AI_RETRY_DELAY_MS));
    if (stopped()) throw new Error('Analyse annulée.');
    return await callClaude(prompt, maxTokens);
  }
}
// Zone de résultat : une ligne d'état (muted) puis le texte ; ou la progression avec un bouton Annuler.
function aiShowProgress(el, text, token) {
  el.innerHTML = '';
  const line = document.createElement('div');
  line.className = 'u-fs-_72rem u-c-v-text-muted';
  line.textContent = text;
  el.appendChild(line);
  if (token) {
    const btn = document.createElement('button');
    btn.className = 'action-btn btn-sm u-mt-6px';
    btn.textContent = 'Annuler';
    btn.addEventListener('click', () => { token.cancelled = true; btn.disabled = true; line.textContent = 'Annulation…'; });
    el.appendChild(btn);
  }
}
function aiShowResult(el, scopeNote, body) {
  el.innerHTML = `<div class="u-fs-_72rem u-c-v-text-muted u-mb-6px">${escapeHtml(scopeNote)}</div>` + DOMPurify.sanitize(String(body || '').replace(/\n/g, '<br>'));
}

async function generateAISummary() {
  await notifyThirdPartyDataUseOnce();
  flushCurrentChapter();
  const panel = document.getElementById('ai-summary-panel'), textEl = document.getElementById('ai-summary-text');
  const ch = db.chapters[cur];
  const txt = getPlainText(ch.content);
  if (txt.length < 50) { toast('Chapitre trop court.','error'); return; }
  panel.classList.add('active'); showAiLoader('ai-summary-text');
  const chunks = aiChunkText(txt, AI_CHUNK_CHARS);
  const words = getWordCount(ch.content);
  try {
    let s, note;
    if (chunks.length === 1) {
      s = await callClaude(`Résume ce chapitre en 3-5 phrases concises en français.\n\nChapitre: "${ch.title}"\n\n${chunks[0]}`, 1000,
        partial => { textEl.innerText = partial; });
      note = `Chapitre lu en entier (${words} mots).`;
    } else {
      const partials = [];
      for (let i = 0; i < chunks.length; i++) {
        textEl.innerText = `Lecture de la partie ${i + 1} sur ${chunks.length}…`;
        partials.push(await aiCall(`Résume en 2-3 phrases, en français, la partie ${i + 1} sur ${chunks.length} du chapitre « ${ch.title} ».\n\n${chunks[i]}`, 500));
      }
      textEl.innerText = 'Synthèse…';
      s = await callClaude(`Voici les résumés successifs des ${chunks.length} parties d'un même chapitre (« ${ch.title} »). Rédige un résumé unique en 3-5 phrases concises en français.\n\n${partials.map((p, i) => `Partie ${i + 1} : ${p}`).join('\n')}`, 1000,
        partial => { textEl.innerText = partial; });
      note = `Chapitre lu en entier (${words} mots, ${chunks.length} parties).`;
    }
    textEl.innerText = s + '\n\n— ' + note;
    textEl.dataset.generated = s;
  } catch(e) { textEl.innerHTML = `<span class="u-c-v-danger">❌ ${escapeHtml(e.message)}</span>`; }
}
function copyAISummaryToChapter() {
  const textEl = document.getElementById('ai-summary-text'), s = textEl.dataset.generated||textEl.innerText;
  if (s) { db.chapters[cur].summary=s; save(); toast('Résumé copié','success'); }
}
async function aiContinueSuggestions() {
  await notifyThirdPartyDataUseOnce();
  flushCurrentChapter();
  const text = getPlainText(db.chapters[cur].content);
  if (text.length < 100) { toast('Écrivez davantage.','error'); return; }
  const el = document.getElementById('ai-continue-result'); showAiLoader('ai-continue-result');
  try {
    const r = await callClaude(`Voici la fin d'un chapitre: "...${text.slice(-600)}"\n\nPropose 3 continuations numérotées 1. 2. 3., chacune en 2-3 phrases en français, avec des tons variés.`, 800,
      partial => { el.innerHTML = DOMPurify.sanitize(partial.replace(/\n/g,'<br>')); });
    el.innerHTML = DOMPurify.sanitize(r.replace(/\n/g,'<br>'));
  } catch(e) { el.innerHTML = `<span class="u-c-v-danger">❌ ${escapeHtml(e.message)}</span>`; }
}
let _aiCheckToken = null;
async function aiCheckInconsistencies() {
  await notifyThirdPartyDataUseOnce();
  flushCurrentChapter();
  const el = document.getElementById('ai-check-result');
  const scopeSel = document.getElementById('ai-check-scope');
  const scope = scopeSel ? scopeSel.value : 'chapter';
  if (_aiCheckToken && !_aiCheckToken.done) { toast('Une analyse est déjà en cours.', 'error'); return; }
  if (scope === 'novel') return aiCheckWholeNovel(el);
  const ch = db.chapters[cur];
  const text = getPlainText(ch.content);
  if (text.trim().length < 100) { toast('Pas assez de texte.','error'); return; }
  const chunks = aiChunkText(text, AI_CHUNK_CHARS);
  const bible = aiBibleText();
  const token = _aiCheckToken = { cancelled: false, done: false };
  try {
    const results = [];
    for (let i = 0; i < chunks.length; i++) {
      aiShowProgress(el, chunks.length > 1 ? `Analyse de la partie ${i + 1} sur ${chunks.length}…` : 'Analyse du chapitre…', token);
      const r = await aiCall(`Personnages: ${bible || '(vide)'}\n\nTexte${chunks.length > 1 ? ` (partie ${i + 1} sur ${chunks.length} du chapitre « ${ch.title} »)` : ` du chapitre « ${ch.title} »`}: ${chunks[i]}\n\nListe les incohérences potentielles avec les fiches des personnages, en français (max 5 points).`, 600, token);
      results.push(chunks.length > 1 ? `Partie ${i + 1} :\n${r}` : r);
    }
    const words = getWordCount(ch.content);
    aiShowResult(el, `Analysé : chapitre « ${ch.title || cur + 1} » lu en entier (${words} mots), comparé aux fiches des personnages. Les autres chapitres n'ont pas été comparés : choisissez « Tout le roman » pour cela.`, results.join('\n\n'));
  } catch(e) { el.innerHTML = `<span class="u-c-v-danger">❌ ${escapeHtml(e.message)}</span>`; }
  finally { token.done = true; }
}
// Tout le roman, en deux temps : (1) faits extraits par paquets de chapitres, (2) faits comparés entre eux.
async function aiCheckWholeNovel(el) {
  const est = aiNovelEstimate(db.chapters);
  if (!est.batches.length || est.words < 50) { toast('Pas assez de texte.', 'error'); return; }
  if (est.calls > AI_MAX_CALLS) {
    el.innerHTML = `<span class="u-c-v-danger">❌ Ce roman demanderait environ ${est.calls} appels IA (maximum ${AI_MAX_CALLS}). Analysez-le par chapitre.</span>`;
    return;
  }
  const minutes = Math.max(1, Math.round(est.seconds / 60));
  const ok = await showConfirmModal({
    title: 'Analyser tout le roman ?',
    message: `${db.chapters.length} chapitres, ${est.words} mots : environ ${est.calls} appels à l'IA, soit ${minutes} minute(s) environ. Le texte est envoyé en clair au service d'IA (Google). Vous pouvez annuler à tout moment.`,
    confirmLabel: 'Analyser'
  });
  if (!ok) return;
  const token = _aiCheckToken = { cancelled: false, done: false };
  try {
    const factBlocks = [];
    let step = 0;
    for (const b of est.batches) {
      step++;
      aiShowProgress(el, `Lecture des chapitres ${b.from}${b.to !== b.from ? ' à ' + b.to : ''} (étape ${step} sur ${est.batches.length + est.groups})…`, token);
      const facts = await aiCall(`Pour chaque chapitre ci-dessous, liste les faits établis par le texte : âge, apparence, lieux, dates, liens entre personnages, événements clés. Au plus 10 puces par chapitre, 120 caractères maximum chacune, chaque puce préfixée par le numéro du chapitre, par exemple « [Ch.3] Marie a les yeux verts ». Français uniquement, sans commentaire.\n\n${b.text}`, 1200, token);
      factBlocks.push(String(facts || '').trim());
    }
    const bible = aiBibleText();
    let groups = aiPackFacts(factBlocks);
    const maxGroups = Math.max(1, AI_MAX_CALLS - est.batches.length);
    const limited = groups.length > maxGroups;
    groups = groups.slice(0, maxGroups);
    const results = [];
    for (let g = 0; g < groups.length; g++) {
      aiShowProgress(el, `Comparaison des faits (étape ${est.batches.length + g + 1} sur ${est.batches.length + groups.length})…`, token);
      const r = await aiCall(`Personnages: ${bible || '(vide)'}\n\nVoici des faits relevés dans les chapitres d'un roman :\n${groups[g]}\n\nRepère les contradictions entre ces faits, ou avec les fiches des personnages (par exemple une couleur d'yeux, un âge, un lieu ou une date qui diffèrent d'un chapitre à l'autre). Pour chaque point, cite les chapitres concernés. Français, 8 points au plus ; si tout est cohérent, dis-le.`, 800, token);
      results.push(groups.length > 1 ? `Groupe ${g + 1} :\n${r}` : r);
    }
    let note = `Analysé : ${db.chapters.length} chapitres en entier (${est.words} mots), en ${est.batches.length + groups.length} appels. Méthode : faits extraits par chapitre, puis comparés entre eux.`;
    if (groups.length > 1) note += ' Le roman est long : la comparaison est faite par groupes de chapitres consécutifs, une contradiction entre deux groupes peut échapper.';
    if (limited) note += ' Comparaison partielle (plafond d\'appels atteint).';
    aiShowResult(el, note, results.join('\n\n'));
  } catch(e) { el.innerHTML = `<span class="u-c-v-danger">❌ ${escapeHtml(e.message)}</span>`; }
  finally { token.done = true; }
}
async function aiGenerateNames() {
  await notifyThirdPartyDataUseOnce();
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

    const r = await callClaude(prompt, 600,
      partial => { el.innerHTML = DOMPurify.sanitize(partial.replace(/\n/g, '<br>')); });
    const lines = r.split('\n').map(l => l.trim()).filter(l => l.length > 3 && (l.includes('—') || l.includes('-') || l.match(/^[A-ZÀ-Ÿ]/)));
    if (lines.length === 0) {
      el.innerHTML = DOMPurify.sanitize(r.replace(/\n/g, '<br>'));
    } else {
      el.innerHTML = lines.map(line => `<div class="u-p-3px-0 u-bdb-1px-solid-v-border">${DOMPurify.sanitize(line)}</div>`).join('');
    }
  } catch(e) {
    el.innerHTML = `<span class="u-c-v-danger">❌ ${escapeHtml(e.message)}</span>`;
  }
}

// ═══════════════════════════════════════════════════════
// ASSISTANT IA CONVERSATIONNEL (v7.34.0)
// Chat multi-tours dans un panneau flottant, avec insertion directe dans le
// manuscrit. Le relais IA (callClaude, voir plus haut) n'accepte qu'un
// PROMPT UNIQUE (pas un tableau de messages) : la "mémoire" de conversation
// est donc simulée en renvoyant l'historique récent (8 derniers échanges)
// dans le prompt à chaque nouveau message, sans modifier le Worker.
// L'historique est persisté PAR MANUSCRIT, chiffré avec la même clé que le
// reste du document (_dataKey), via le même mécanisme que les documents
// (persistData/loadData, donc synchronisé multi-appareils gratuitement).
// ═══════════════════════════════════════════════════════
let _aiChatHistory = [];
let _aiChatLoadedForDoc = null; // évite de recharger l'historique à chaque ouverture du panneau pour le même manuscrit
let _aiChatPendingReplaceRange = null; // Range du manuscrit à remplacer (voir sendManuscriptSelectionToChat)
let _aiChatSelectionText = ''; // dernier passage du manuscrit envoyé au chat (pour composer les chips dédiées)

function aiChatDataKey(profileId, docId) { return 'aichat_' + profileId + '_' + docId; }

// Appelée à l'ouverture d'un nouveau manuscrit (voir initApp(), router.js) :
// remet l'assistant à zéro pour ne jamais mélanger deux conversations de
// deux manuscrits différents.
function resetAiChatForDocument() {
  document.getElementById('ai-chat-panel')?.classList.remove('active');
  _aiChatHistory = []; _aiChatLoadedForDoc = null; _aiChatPendingReplaceRange = null; _aiChatSelectionText = '';
}

async function loadAiChatHistoryIfNeeded() {
  if (_aiChatLoadedForDoc === _currentDocumentId) return;
  _aiChatHistory = []; _aiChatPendingReplaceRange = null;
  try {
    const stored = await loadData(aiChatDataKey(_currentProfileId, _currentDocumentId));
    if (stored && stored._enc) {
      const plain = await Crypto.decrypt(stored.data, _dataKey);
      if (plain) _aiChatHistory = JSON.parse(plain);
    }
  } catch(e) { /* historique illisible (rare) : on repart d'une conversation vide plutôt que de bloquer l'assistant */ }
  _aiChatLoadedForDoc = _currentDocumentId;
}
async function saveAiChatHistory() {
  try {
    const cipher = await Crypto.encryptData(JSON.stringify(_aiChatHistory), _dataKey);
    await persistData(aiChatDataKey(_currentProfileId, _currentDocumentId), { _enc:true, data:cipher });
  } catch(e) { /* la persistance de l'historique ne doit jamais bloquer la conversation en cours */ }
}

async function openAiChat() {
  await loadAiChatHistoryIfNeeded();
  renderAiChatMessages();
  renderAiChatChips();
  document.getElementById('ai-chat-panel').classList.add('active');
  updateAiChatContextNote();
  document.getElementById('ai-chat-input').focus();
}
function closeAiChat() { document.getElementById('ai-chat-panel').classList.remove('active'); }
function toggleAiChat() {
  const panel = document.getElementById('ai-chat-panel');
  if (panel.classList.contains('active')) closeAiChat(); else openAiChat();
}
async function resetAiChatConversation() {
  if (_aiChatHistory.length && !confirm('Effacer cette conversation avec l\'assistant IA ? Le manuscrit ne sera pas modifié.')) return;
  _aiChatHistory = []; _aiChatPendingReplaceRange = null; _aiChatSelectionText = '';
  await saveAiChatHistory();
  renderAiChatMessages(); renderAiChatChips();
  toast('Nouvelle conversation.', 'success');
}

// Construit le prompt unique envoyé au relais IA : instructions + contextes
// optionnels (chapitre, personnages) + historique récent + nouveau message.
// v9.37.0 : indique à l'écran la portion du chapitre transmise au chat.
function updateAiChatContextNote() {
  const el = document.getElementById('ai-chat-ctx-note');
  if (!el) return;
  const cb = document.getElementById('ai-chat-ctx-chapter');
  if (!cb || !cb.checked || !db.chapters || !db.chapters[cur]) { el.textContent = ''; return; }
  const len = getPlainText(db.chapters[cur].content).length;
  el.textContent = len > AI_CHAT_CHAPTER_CHARS
    ? `Chapitre lu : les ${AI_CHAT_CHAPTER_CHARS} premiers caractères sur ${len} (début du chapitre).`
    : 'Chapitre lu en entier.';
}
function buildAiChatPrompt(userMessage) {
  updateAiChatContextNote();
  let ctx = '';
  if (document.getElementById('ai-chat-ctx-chapter')?.checked) {
    const chapterText = getPlainText(db.chapters[cur].content).substring(0, AI_CHAT_CHAPTER_CHARS);
    if (chapterText) ctx += `Chapitre actuel (« ${db.chapters[cur].title} ») :\n${chapterText}\n\n`;
  }
  if (document.getElementById('ai-chat-ctx-chars')?.checked) {
    const bible = aiBibleText(); // v9.37.0 : bornée, pour ne jamais dépasser la taille acceptée par le relais
    if (bible) ctx += `Personnages :\n${bible}\n\n`;
  }
  // 16 derniers messages = 8 échanges environ, pour ne pas dépasser la
  // taille de prompt raisonnable côté relais IA.
  const prior = _aiChatHistory.slice(0, -1).slice(-16);
  const historyText = prior.map(m => (m.role === 'user' ? 'Utilisateur : ' : 'Assistant : ') + m.text).join('\n');
  return `Tu es un assistant d'écriture pour un roman en français. Réponds toujours en français, de façon concise et utile.\n\n${ctx}${historyText ? historyText + '\n' : ''}Utilisateur : ${userMessage}\nAssistant :`;
}

async function sendAiChatMessage() {
  const input = document.getElementById('ai-chat-input');
  const userText = input.value.trim();
  if (!userText) return;
  await notifyThirdPartyDataUseOnce();
  input.value = '';
  _aiChatSelectionText = '';
  renderAiChatChips();
  _aiChatHistory.push({ role:'user', text:userText, ts:Date.now() });
  renderAiChatMessages();
  const sendBtn = document.getElementById('ai-chat-send-btn');
  sendBtn.disabled = true;
  const messagesEl = document.getElementById('ai-chat-messages');
  messagesEl.insertAdjacentHTML('beforeend', '<div class="ai-chat-msg ai-chat-msg-assistant" id="ai-chat-loading"><div class="ai-loader"><div class="ai-dot"></div><div class="ai-dot"></div><div class="ai-dot"></div></div></div>');
  messagesEl.scrollTop = messagesEl.scrollHeight;
  try {
    const prompt = buildAiChatPrompt(userText);
    // v8.0.3 — dès le premier morceau reçu, la bulle de points clignotants
    // est remplacée par le texte qui s'écrit progressivement (voir
    // callClaude() plus haut) ; renderAiChatMessages() (appelé dans le
    // finally ci-dessous) reconstruit ensuite la bulle définitive avec ses
    // boutons Insérer/Copier/Remplacer, une fois la réponse complète.
    const reply = await callClaude(prompt, 700, partial => {
      const loadingEl = document.getElementById('ai-chat-loading');
      if (loadingEl) loadingEl.innerHTML = `<div class="ai-chat-bubble">${DOMPurify.sanitize(partial).replace(/\n/g,'<br>')}</div>`;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
    _aiChatHistory.push({ role:'assistant', text: (reply||'').trim() || '(réponse vide)', ts:Date.now() });
  } catch(e) {
    _aiChatHistory.push({ role:'assistant', text: '❌ ' + e.message, ts:Date.now() });
  } finally {
    sendBtn.disabled = false;
    renderAiChatMessages();
    await saveAiChatHistory();
  }
}

function renderAiChatMessages() {
  const cont = document.getElementById('ai-chat-messages');
  if (!cont) return;
  if (!_aiChatHistory.length) {
    cont.innerHTML = `<p class="u-fs-_72rem u-c-v-text-muted u-m-0">Posez une question, demandez une suite, une reformulation…</p>`;
    return;
  }
  const showReplace = !!_aiChatPendingReplaceRange;
  cont.innerHTML = _aiChatHistory.map((m, i) => {
    const bubble = `<div class="ai-chat-bubble">${DOMPurify.sanitize(m.text).replace(/\n/g,'<br>')}</div>`;
    if (m.role === 'user') return `<div class="ai-chat-msg ai-chat-msg-user" data-ai-msg-idx="${i}">${bubble}</div>`;
    return `<div class="ai-chat-msg ai-chat-msg-assistant" data-ai-msg-idx="${i}">${bubble}
      <div class="ai-chat-msg-actions">
        <button class="ai-chat-chip" data-ai-insert="${i}">➕ Insérer</button>
        <button class="ai-chat-chip" data-ai-copy="${i}">📋 Copier</button>
        ${showReplace ? `<button class="ai-chat-chip" data-ai-replace="${i}">🔁 Remplacer</button>` : ''}
      </div>
    </div>`;
  }).join('');
  cont.scrollTop = cont.scrollHeight;
  cont.querySelectorAll('[data-ai-insert]').forEach(btn => btn.addEventListener('click', () => insertAiChatMessage(parseInt(btn.dataset.aiInsert,10))));
  cont.querySelectorAll('[data-ai-copy]').forEach(btn => btn.addEventListener('click', () => copyAiChatMessage(parseInt(btn.dataset.aiCopy,10))));
  cont.querySelectorAll('[data-ai-replace]').forEach(btn => btn.addEventListener('click', () => replaceWithAiChatMessage(parseInt(btn.dataset.aiReplace,10))));
}

// Chips génériques (toujours visibles tant qu'aucun passage du manuscrit
// n'a été envoyé au chat) — un clic pré-remplit le champ, sans envoyer à la
// place de l'utilisateur (il garde la main pour ajuster avant de valider).
function renderAiChatChips() {
  const cont = document.getElementById('ai-chat-chips');
  if (!cont) return;
  const generic = [
    ['Trouver un nom', 'Propose-moi 5 noms de personnages originaux adaptés à mon roman.'],
    ['Suite possible', 'Propose-moi une suite possible pour ce chapitre.'],
    ['Idée de rebondissement', 'Propose-moi un rebondissement inattendu mais cohérent avec l\'histoire.']
  ];
  cont.innerHTML = generic.map((g,i) => `<button class="ai-chat-chip" data-chip-idx="${i}">${DOMPurify.sanitize(g[0])}</button>`).join('');
  cont.querySelectorAll('[data-chip-idx]').forEach(btn => btn.addEventListener('click', () => fillAiChatChip(generic[parseInt(btn.dataset.chipIdx,10)][1])));
}
// Chips dédiées à un passage du manuscrit qu'on vient d'envoyer au chat
// (voir sendManuscriptSelectionToChat) — remplacent temporairement les chips
// génériques tant que l'utilisateur n'a pas envoyé son message.
function renderAiChatSelectionChips() {
  const cont = document.getElementById('ai-chat-chips');
  if (!cont || !_aiChatSelectionText) return;
  const excerpt = _aiChatSelectionText;
  const actions = [
    ['Reformuler ce passage', `Reformule ce passage de mon manuscrit en gardant le sens mais en variant le style :\n\n« ${excerpt} »`],
    ['Continuer ce passage', `Voici la fin d'un passage de mon manuscrit :\n\n« ${excerpt} »\n\nPropose une suite cohérente en 2-3 phrases.`],
    ['Corriger ce passage', `Corrige les fautes et lourdeurs de ce passage de mon manuscrit, sans changer le sens :\n\n« ${excerpt} »`]
  ];
  cont.innerHTML = actions.map((a,i) => `<button class="ai-chat-chip" data-sel-chip-idx="${i}">${DOMPurify.sanitize(a[0])}</button>`).join('');
  cont.querySelectorAll('[data-sel-chip-idx]').forEach(btn => btn.addEventListener('click', () => fillAiChatChip(actions[parseInt(btn.dataset.selChipIdx,10)][1])));
}
function fillAiChatChip(text) {
  const input = document.getElementById('ai-chat-input');
  input.value = text;
  input.focus();
}

// Si une portion précise d'une réponse est sélectionnée dans la bulle au
// moment du clic, seule cette portion est utilisée (insertion/copie/
// remplacement) — sinon, c'est le message entier.
function getSelectedTextWithinMessage(idx) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const container = document.querySelector(`.ai-chat-msg[data-ai-msg-idx="${idx}"] .ai-chat-bubble`);
  if (!container) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const text = sel.toString().trim();
  return text || null;
}
// Insertion générique dans le manuscrit à la position du curseur — réutilise
// _lexSavedRange (voir panels.js), la même "dernière position connue dans
// #writer" déjà utilisée par le dictionnaire de synonymes/antonymes : un
// seul mécanisme de mémorisation du curseur pour toutes les insertions IA.
function insertTextAtCursor(text) {
  const writer = document.getElementById('writer');
  writer.focus();
  const html = DOMPurify.sanitize(text).replace(/\n/g, '<br>');
  if (_lexSavedRange) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(_lexSavedRange);
    _lexSavedRange.deleteContents();
    const frag = document.createElement('span');
    frag.innerHTML = html;
    _lexSavedRange.insertNode(frag);
    sel.collapseToEnd();
  } else {
    writer.innerHTML += html;
  }
  liveCounter();
}
// Remplace un passage précis du manuscrit (mémorisé au moment de l'envoi
// vers le chat, voir sendManuscriptSelectionToChat) par le texte fourni.
function replaceRangeWithText(range, text) {
  const writer = document.getElementById('writer');
  writer.focus();
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  range.deleteContents();
  const html = DOMPurify.sanitize(text).replace(/\n/g, '<br>');
  const frag = document.createElement('span');
  frag.innerHTML = html;
  range.insertNode(frag);
  sel.collapseToEnd();
  liveCounter();
}
function insertAiChatMessage(idx) {
  const msg = _aiChatHistory[idx];
  if (!msg) return;
  insertTextAtCursor(getSelectedTextWithinMessage(idx) || msg.text);
  toast('Texte inséré dans le manuscrit.', 'success');
}
function copyAiChatMessage(idx) {
  const msg = _aiChatHistory[idx];
  if (!msg) return;
  const text = getSelectedTextWithinMessage(idx) || msg.text;
  if (!navigator.clipboard) { toast('Copie presse-papier non disponible sur ce navigateur.', 'error'); return; }
  navigator.clipboard.writeText(text).then(() => toast('Copié.', 'success')).catch(() => toast('Copie impossible.', 'error'));
}
function replaceWithAiChatMessage(idx) {
  const msg = _aiChatHistory[idx];
  if (!msg || !_aiChatPendingReplaceRange) return;
  replaceRangeWithText(_aiChatPendingReplaceRange, getSelectedTextWithinMessage(idx) || msg.text);
  _aiChatPendingReplaceRange = null;
  renderAiChatMessages();
  toast('Sélection remplacée dans le manuscrit.', 'success');
}

// Bouton "💬 Discuter de la sélection" de la barre d'outils — envoie le
// passage actuellement sélectionné dans le manuscrit vers le chat, avec des
// chips d'action dédiées, et mémorise ce passage pour un remplacement direct
// une fois la réponse de l'IA obtenue.
async function sendManuscriptSelectionToChat() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { toast('Sélectionnez d\'abord un passage du manuscrit.', 'error'); return; }
  const range = sel.getRangeAt(0);
  const writer = document.getElementById('writer');
  if (!writer.contains(range.commonAncestorContainer)) { toast('Sélectionnez un passage dans le texte du chapitre.', 'error'); return; }
  const text = sel.toString().trim();
  if (!text) { toast('Sélection vide.', 'error'); return; }
  _aiChatPendingReplaceRange = range.cloneRange();
  _aiChatSelectionText = text.substring(0, 1500);
  await openAiChat();
  renderAiChatSelectionChips();
}
