'use strict';
// v7.21.0 — correctif : cette fonction appelait directement l'API Anthropic
// (reliquat d'un prototype antérieur au Worker), ce qui ne pouvait pas
// fonctionner : la CSP du projet (_headers) n'autorise que le Worker Cloudflare
// en connexion sortante, et aucune clé API n'est (ni ne doit être) présente
// côté client. Voir README, section "Intelligence artificielle" : le Worker
// (plume-epique-ai.air7841.workers.dev) relaie vers Mistral AI et renvoie une
// réponse déjà normalisée au format {content:[{type:'text', text}]} — c'est ce
// format que le reste de cette fonction attendait déjà, donc seule l'URL
// changeait. Le corps de la requête a été ajusté suite à un test réel : le
// Worker attend un champ "prompt" direct (il a répondu "prompt manquant" avec
// le format Anthropic {messages:[...]}), pas un tableau de messages.
async function callClaude(prompt, maxTokens=1000) {
  const resp = await fetch('https://plume-epique-ai.air7841.workers.dev', {
    method:'POST', headers:{'Content-Type':'application/json'},
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
  const data = await resp.json();
  return data.content?.map(b=>b.text||'').join('') || '';
}
async function generateAISummary() {
  await notifyThirdPartyDataUseOnce();
  flushCurrentChapter();
  const panel = document.getElementById('ai-summary-panel'), textEl = document.getElementById('ai-summary-text');
  const txt = getPlainText(db.chapters[cur].content);
  if (txt.length < 50) { toast('Chapitre trop court.','error'); return; }
  panel.classList.add('active'); showAiLoader('ai-summary-text');
  try {
    const s = await callClaude(`Résume ce chapitre en 3-5 phrases concises en français.\n\nChapitre: "${db.chapters[cur].title}"\n\n${txt.substring(0,3000)}`);
    textEl.innerText = s; textEl.dataset.generated = s;
  } catch(e) { textEl.innerHTML = `<span class="u-c-v-danger">❌ ${e.message}</span>`; }
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
    const r = await callClaude(`Voici la fin d'un chapitre: "...${text.slice(-600)}"\n\nPropose 3 continuations numérotées 1. 2. 3., chacune en 2-3 phrases en français, avec des tons variés.`, 800);
    el.innerHTML = DOMPurify.sanitize(r.replace(/\n/g,'<br>'));
  } catch(e) { el.innerHTML = `<span class="u-c-v-danger">❌ ${e.message}</span>`; }
}
async function aiCheckInconsistencies() {
  await notifyThirdPartyDataUseOnce();
  flushCurrentChapter();
  const fullText = db.chapters.map(c=>getPlainText(c.content)).join('\n---\n');
  if (fullText.trim().length < 100) { toast('Pas assez de texte.','error'); return; }
  const bible = db.chars.map(c=>`${c.name} (${c.role||'?'}): ${c.phys||''} ${c.info||''}`).join('\n');
  const el = document.getElementById('ai-check-result'); showAiLoader('ai-check-result');
  try {
    const r = await callClaude(`Personnages: ${bible||'(vide)'}\n\nTexte: ${fullText.substring(0,4000)}\n\nListe les incohérences potentielles en français (max 5 points).`, 600);
    el.innerHTML = DOMPurify.sanitize(r.replace(/\n/g,'<br>'));
  } catch(e) { el.innerHTML = `<span class="u-c-v-danger">❌ ${e.message}</span>`; }
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

    const r = await callClaude(prompt, 600);
    const lines = r.split('\n').map(l => l.trim()).filter(l => l.length > 3 && (l.includes('—') || l.includes('-') || l.match(/^[A-ZÀ-Ÿ]/)));
    if (lines.length === 0) {
      el.innerHTML = DOMPurify.sanitize(r.replace(/\n/g, '<br>'));
    } else {
      el.innerHTML = lines.map(line => `<div class="u-p-3px-0 u-bdb-1px-solid-v-border">${DOMPurify.sanitize(line)}</div>`).join('');
    }
  } catch(e) {
    el.innerHTML = `<span class="u-c-v-danger">❌ ${e.message}</span>`;
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
    const cipher = await Crypto.encrypt(JSON.stringify(_aiChatHistory), _dataKey);
    await persistData(aiChatDataKey(_currentProfileId, _currentDocumentId), { _enc:true, data:cipher });
  } catch(e) { /* la persistance de l'historique ne doit jamais bloquer la conversation en cours */ }
}

async function openAiChat() {
  await loadAiChatHistoryIfNeeded();
  renderAiChatMessages();
  renderAiChatChips();
  document.getElementById('ai-chat-panel').classList.add('active');
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
function buildAiChatPrompt(userMessage) {
  let ctx = '';
  if (document.getElementById('ai-chat-ctx-chapter')?.checked) {
    const chapterText = getPlainText(db.chapters[cur].content).substring(0, 3000);
    if (chapterText) ctx += `Chapitre actuel (« ${db.chapters[cur].title} ») :\n${chapterText}\n\n`;
  }
  if (document.getElementById('ai-chat-ctx-chars')?.checked) {
    const bible = db.chars.map(c => `${c.name} (${c.role||'?'}) : ${c.phys||''} ${c.info||''}`).join('\n');
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
    const reply = await callClaude(prompt, 700);
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
