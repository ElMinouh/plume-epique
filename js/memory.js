'use strict';
let _narrativeIndex = [];
let _indexBuilt = false;

function splitPassages(text, windowSize=200, overlap=30) {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const passages = [];
  let i = 0;
  while (i < words.length) {
    const chunk = words.slice(i, i + windowSize).join(' ');
    if (chunk.trim().length > 20) passages.push(chunk);
    i += windowSize - overlap;
    if (i >= words.length) break;
  }
  return passages;
}

function extractKeywords(text) {
  const words = text.toLowerCase().match(/[a-zA-ZÀ-ÿ]{3,}/g) || [];
  const freq = {};
  words.forEach(w => { if (!STOP_WORDS.has(w)) freq[w] = (freq[w]||0) + 1; });
  return Object.entries(freq).sort((a,b) => b[1]-a[1]).slice(0, 20).map(([w]) => w);
}

function scoreRelevance(queryKeywords, passageKeywords, passageText) {
  const passageLower = passageText.toLowerCase();
  let score = 0;
  queryKeywords.forEach(qw => {
    const matches = (passageLower.match(new RegExp(`\\b${qw}\\b`, 'g')) || []).length;
    score += matches * 2;
    if (passageKeywords.includes(qw)) score += 3;
    if (qw.length > 5) {
      const stem = qw.slice(0, Math.floor(qw.length * 0.75));
      if (passageLower.includes(stem)) score += 1;
    }
  });
  return score;
}

function buildNarrativeIndex() {
  flushCurrentChapter();
  _narrativeIndex = [];
  let totalPassages = 0;

  db.chapters.forEach((ch, chIdx) => {
    const plainText = getPlainText(ch.content);
    if (!plainText || plainText.length < 30) return;
    const passages = splitPassages(plainText);
    passages.forEach((text, pIdx) => {
      _narrativeIndex.push({
        chIdx,
        chTitle: ch.title || `Chapitre ${chIdx+1}`,
        passageIdx: pIdx,
        text,
        keywords: extractKeywords(text)
      });
      totalPassages++;
    });
  });

  db.chars.forEach(c => {
    const text = `Personnage ${c.name}: rôle ${c.role||'?'}, âge ${c.age||'?'}, ${c.phys||''} ${c.info||''}`;
    _narrativeIndex.push({ chIdx:-1, chTitle:'📚 Personnages', passageIdx:0, text, keywords: extractKeywords(text) });
  });
  db.places.forEach(p => {
    const text = `Lieu ${p.name}: type ${p.type||'?'}, ambiance ${p.mood||'?'}, ${p.info||''}`;
    _narrativeIndex.push({ chIdx:-2, chTitle:'🏰 Lieux', passageIdx:0, text, keywords: extractKeywords(text) });
  });

  _indexBuilt = true;
  return totalPassages;
}

function searchNarrativeIndex(query, topK=5) {
  if (!_indexBuilt || !_narrativeIndex.length) return [];
  const queryKeywords = extractKeywords(query);
  const rawWords = query.toLowerCase().match(/[a-zA-ZÀ-ÿ]{3,}/g) || [];
  const allQueryWords = [...new Set([...queryKeywords, ...rawWords])];

  const scored = _narrativeIndex.map(entry => ({
    ...entry,
    score: scoreRelevance(allQueryWords, entry.keywords, entry.text)
  })).filter(e => e.score > 0).sort((a,b) => b.score - a.score);

  return scored.slice(0, topK);
}

async function queryNarrativeMemory() {
  const query = document.getElementById('memory-query-input').value.trim();
  if (!query) { toast('Entrez une question.', 'error'); return; }
  if (!_indexBuilt) { toast('Indexez d\'abord le roman.', 'error'); return; }

  const resultsEl = document.getElementById('memory-results');
  resultsEl.innerHTML = '<div class="ai-loader"><div class="ai-dot"></div><div class="ai-dot"></div><div class="ai-dot"></div></div>';

  const passages = searchNarrativeIndex(query, 6);

  if (!passages.length) {
    resultsEl.innerHTML = '<div style="opacity:.6;font-size:.82rem;padding:10px;">Aucun passage pertinent trouvé pour cette question.</div>';
    return;
  }

  const context = passages.map((p, i) =>
    `[Extrait ${i+1} — ${p.chTitle}]\n${p.text}`
  ).join('\n\n');

  try {
    const answer = await callClaude(
      `Tu es un assistant littéraire expert. Réponds à cette question en français en te basant UNIQUEMENT sur les extraits fournis. Si la réponse n'est pas dans les extraits, dis-le clairement.\n\nQuestion : "${query}"\n\nExtraits pertinents du roman :\n\n${context}\n\nRéponds de façon précise et cite le chapitre source.`,
      600
    );

    resultsEl.innerHTML = '';

    const answerCard = document.createElement('div');
    answerCard.style.cssText = 'background:rgba(142,68,173,.1);border:1px solid rgba(142,68,173,.3);border-radius:10px;padding:14px;font-size:.83rem;line-height:1.65;';
    answerCard.innerHTML = `<div style="font-weight:700;color:var(--accent2);margin-bottom:6px;">🧠 Réponse</div>${DOMPurify.sanitize(answer.replace(/\n/g,'<br>'))}`;
    resultsEl.appendChild(answerCard);

    const sourcesTitle = document.createElement('div');
    sourcesTitle.style.cssText = 'font-size:.72rem;font-weight:700;color:var(--text-muted);margin-top:4px;';
    sourcesTitle.textContent = 'Passages sources :';
    resultsEl.appendChild(sourcesTitle);

    passages.forEach((p, i) => {
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--item-bg);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:.76rem;line-height:1.55;cursor:pointer;';
      card.innerHTML = `<div style="font-weight:700;color:var(--accent);margin-bottom:4px;">${DOMPurify.sanitize(p.chTitle)} <span style="opacity:.5;">· score: ${p.score}</span></div><div style="opacity:.8;">${DOMPurify.sanitize(p.text.substring(0, 200))}${p.text.length>200?'…':''}</div>`;
      if (p.chIdx >= 0) {
        card.title = 'Cliquer pour aller à ce chapitre';
        card.addEventListener('click', () => changeCh(p.chIdx));
      }
      resultsEl.appendChild(card);
    });

  } catch(e) {
    resultsEl.innerHTML = `<div style="color:var(--danger);font-size:.82rem;padding:10px;">❌ Erreur IA: ${e.message}</div>`;
  }
}

function indexNarrative() {
  const btn = document.getElementById('memory-index-btn');
  const status = document.getElementById('memory-index-status');
  btn.disabled = true; btn.textContent = '⏳ Indexation…';
  setTimeout(() => {
    try {
      const n = buildNarrativeIndex();
      status.textContent = `✅ ${n} passages indexés (${db.chapters.length} chapitres + Personnages & Lieux)`;
      status.style.color = 'var(--success)';
      toast(`Roman indexé : ${n} passages`, 'success');
    } catch(e) {
      status.textContent = '❌ Erreur : ' + e.message;
      status.style.color = 'var(--danger)';
    }
    btn.disabled = false; btn.textContent = '🔄 Indexer le roman';
  }, 50);
}
