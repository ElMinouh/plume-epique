'use strict';
// ═══════════════════════════════════════════════════════
// RECHERCHE GLOBALE
// ═══════════════════════════════════════════════════════
function openGlobalSearch() {
  document.getElementById('search-overlay').classList.add('active');
  document.getElementById('search-input').focus();
  document.getElementById('search-input').value = '';
  document.getElementById('search-results').innerHTML = '';
  document.getElementById('search-count').textContent = '';
}
function closeGlobalSearch() { document.getElementById('search-overlay').classList.remove('active'); }

// Correction v6.0.0 : la recherche globale couvre désormais aussi les
// personnages, lieux et quêtes (plus seulement le contenu des chapitres).
function doGlobalSearch(query) {
  const q = query.trim().toLowerCase(), container = document.getElementById('search-results'), countEl = document.getElementById('search-count');
  container.innerHTML = '';
  if (q.length < 2) { countEl.textContent = ''; return; }
  let total = 0;
  const qEscaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function addResult(icon, label, snippetText, onClick) {
    const highlighted = snippetText.replace(new RegExp(`(${qEscaped})`,'gi'),'<mark>$1</mark>');
    const el = document.createElement('div');
    el.className='search-result-item'; el.setAttribute('role','listitem');
    el.innerHTML = `<div class="sr-chapter">${icon} ${DOMPurify.sanitize(label)}</div><div>...${DOMPurify.sanitize(highlighted)}...</div>`;
    el.addEventListener('click', () => { onClick(); closeGlobalSearch(); });
    container.appendChild(el);
  }

  function goToTab(tabId) {
    openTabOrSubtab(tabId);
  }

  // Chapitres
  db.chapters.forEach((ch, i) => {
    const text = ch.content.replace(/<[^>]*>/g,' '), lower = text.toLowerCase();
    let idx = 0, occs = [];
    while ((idx = lower.indexOf(q, idx)) !== -1) { occs.push(idx); idx++; }
    if (!occs.length) return;
    total += occs.length;
    occs.slice(0,3).forEach(pos => {
      const s=Math.max(0,pos-60), e=Math.min(text.length,pos+q.length+60);
      const snippet = text.slice(s,e).replace(/\s+/g,' ').trim();
      addResult('📖', ch.title, snippet, () => changeCh(i));
    });
  });

  // Personnages
  db.chars.forEach((c, i) => {
    const text = `${c.name||''} ${c.role||''} ${c.age||''} ${c.phys||''} ${c.info||''}`;
    if (!text.toLowerCase().includes(q)) return;
    total++;
    addResult('👥', c.name||'Personnage', text.replace(/\s+/g,' ').trim().substring(0,140), () => {
      goToTab('tab-chars'); showEdit('chars', i);
    });
  });

  // Lieux
  db.places.forEach((p, i) => {
    const text = `${p.name||''} ${p.type||''} ${p.mood||''} ${p.info||''}`;
    if (!text.toLowerCase().includes(q)) return;
    total++;
    addResult('🏰', p.name||'Lieu', text.replace(/\s+/g,' ').trim().substring(0,140), () => {
      goToTab('tab-places'); showEdit('places', i);
    });
  });

  // Quêtes
  db.quests.forEach((qst, i) => {
    const text = `${qst.text||''} ${qst.reward||''} ${qst.steps||''}`;
    if (!text.toLowerCase().includes(q)) return;
    total++;
    addResult('🎯', qst.text||'Quête', text.replace(/\s+/g,' ').trim().substring(0,140), () => {
      goToTab('tab-quests'); showQuestEdit(i);
    });
  });

  countEl.textContent = total ? `${total} occurrence(s)` : 'Aucun résultat.';
}
const debouncedSearch = debounce(doGlobalSearch, 250);

// ═══════════════════════════════════════════════════════
// DICTIONNAIRE SYNONYMES / ANTONYMES (via IA)
// ═══════════════════════════════════════════════════════
let _lexSavedRange = null;

function saveCursorPosition() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    const writer = document.getElementById('writer');
    if (writer.contains(range.commonAncestorContainer)) {
      _lexSavedRange = range.cloneRange();
    }
  }
}

function insertWordAtCursor(word) {
  const writer = document.getElementById('writer');
  writer.focus();
  if (_lexSavedRange) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(_lexSavedRange);
    _lexSavedRange.deleteContents();
    _lexSavedRange.insertNode(document.createTextNode(' ' + word + ' '));
    sel.collapseToEnd();
    _lexSavedRange = null;
  } else {
    writer.innerHTML += ' ' + DOMPurify.sanitize(word) + ' ';
  }
  liveCounter();
  toast('Mot inséré : ' + word, 'success');
}

async function handleSearch() {
  const word = document.getElementById('lex-in').value.trim();
  const mode = document.getElementById('search-mode').value;
  if (!word) return;
  await notifyThirdPartyDataUseOnce();

  saveCursorPosition();

  const panel = document.getElementById('lex-panel');
  const titleEl = document.getElementById('lex-panel-title');
  const wordEl = document.getElementById('lex-panel-word');
  const wordsEl = document.getElementById('lex-words');

  titleEl.textContent = mode === 'syn' ? '✨ Synonymes' : '🌑 Antonymes';
  wordEl.textContent = 'Recherche de « ' + word + ' »…';
  wordsEl.innerHTML = '<div class="ai-loader"><div class="ai-dot"></div><div class="ai-dot"></div><div class="ai-dot"></div></div>';
  panel.classList.add('active');

  try {
    const prompt = mode === 'syn'
      ? `Donne-moi 12 synonymes français du mot "${word}". Réponds UNIQUEMENT avec les mots séparés par des virgules, sans explication, sans numérotation, sans ponctuation autre que les virgules. Exemple: beau, joli, magnifique, splendide`
      : `Donne-moi 10 antonymes français du mot "${word}". Réponds UNIQUEMENT avec les mots séparés par des virgules, sans explication, sans numérotation, sans ponctuation autre que les virgules. Exemple: laid, affreux, horrible, moche`;

    const result = await callClaude(prompt, 200);
    const words = result.split(/[,\n]+/).map(w => w.trim().toLowerCase()).filter(w => w.length > 1 && w.length < 30 && /^[a-zA-ZÀ-ÿ\s'-]+$/.test(w));

    if (!words.length) {
      wordsEl.innerHTML = '<span class="lex-empty">Aucun résultat trouvé.</span>';
      return;
    }

    wordEl.textContent = '« ' + word + ' » — ' + words.length + ' résultat(s)';
    wordsEl.innerHTML = '';
    words.forEach(w => {
      const chip = document.createElement('span');
      chip.className = 'lex-word';
      chip.textContent = w;
      chip.addEventListener('click', () => { insertWordAtCursor(w); });
      wordsEl.appendChild(chip);
    });
  } catch(e) {
    wordsEl.innerHTML = `<span class="lex-empty u-c-v-danger">❌ ${e.message}</span>`;
  }
}
