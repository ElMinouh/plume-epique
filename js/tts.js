'use strict';
let _ttsUtterance = null, _ttsWords = [], _ttsIdx = 0;
let _recognition = null, _dictating = false;

function initTTS() {
  const sel = document.getElementById('tts-voice-sel');
  const loadVoices = () => {
    const voices = window.speechSynthesis.getVoices().filter(v => v.lang.startsWith('fr') || v.lang.startsWith('en'));
    sel.innerHTML = voices.map((v,i) => `<option value="${i}">${v.name} (${v.lang})</option>`).join('');
  };
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

function ttsPlay() {
  if (!window.speechSynthesis) { toast('TTS non supporté','error'); return; }
  flushCurrentChapter();
  const text = getPlainText(db.chapters[cur].content);
  if (!text) { toast('Aucun texte à lire.','error'); return; }
  window.speechSynthesis.cancel();
  const voices = window.speechSynthesis.getVoices();
  const selIdx = parseInt(document.getElementById('tts-voice-sel').value) || 0;
  const rate = parseFloat(document.getElementById('tts-rate').value) || 1;
  _ttsWords = text.split(/\s+/); _ttsIdx = 0;
  _ttsUtterance = new SpeechSynthesisUtterance(text);
  _ttsUtterance.voice = voices[selIdx] || null;
  _ttsUtterance.rate = rate; _ttsUtterance.lang = 'fr-FR';
  _ttsUtterance.onboundary = e => {
    if (e.name==='word') {
      _ttsIdx++;
      document.getElementById('tts-progress-bar').style.width = Math.min(100,(_ttsIdx/_ttsWords.length*100))+'%';
    }
  };
  _ttsUtterance.onend = () => { document.getElementById('tts-progress-bar').style.width='0'; };
  window.speechSynthesis.speak(_ttsUtterance);
  toast('Lecture en cours…');
}
function ttsPause() {
  if (window.speechSynthesis.speaking) window.speechSynthesis.pause();
  else window.speechSynthesis.resume();
}
function ttsStop() {
  window.speechSynthesis.cancel();
  document.getElementById('tts-progress-bar').style.width='0';
}

let _dictationRange = null;
// v7.30.0 — Le correctif v7.28.0 (suivi par index de résultat) ne suffisait
// pas : le bug se produit en réalité AU SEIN d'une même séance de dictée,
// pas seulement entre deux séances. Cause probable : le navigateur peut
// redéclencher `onresult` plusieurs fois pour le même passage de texte
// (accumulation progressive de la reconnaissance), et se fier à l'INDEX
// d'un résultat dans le tableau n'est pas fiable pour savoir si son
// contenu a déjà été inséré ou non. On compare désormais le texte définitif
// RÉELLEMENT DÉJÀ INSÉRÉ (`_dictationFinalTextSoFar`) au texte définitif
// total rapporté par le navigateur à cet instant : seule la partie
// nouvelle (au-delà de ce qui a déjà été écrit) est ajoutée à l'éditeur,
// peu importe combien de fois l'événement se redéclenche pour le même
// passage — une comparaison de contenu réel plutôt qu'une position dans
// un tableau, donc robuste même si le navigateur répète un événement.
let _dictationFinalTextSoFar = '';
// Capture la position du curseur au moment où la dictée démarre, pour y
// insérer le texte au fil de la dictée — au lieu de toujours l'ajouter en
// fin de texte, quel que soit l'endroit où on avait cliqué avant de dicter.
function captureDictationRange() {
  const writer = document.getElementById('writer');
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    if (writer.contains(range.commonAncestorContainer)) { _dictationRange = range.cloneRange(); return; }
  }
  // Pas de sélection valide dans l'éditeur (curseur ailleurs, ou perdu) :
  // on se rabat sur la fin du texte, comme avant ce correctif.
  const r = document.createRange();
  r.selectNodeContents(writer);
  r.collapse(false);
  _dictationRange = r;
}
function initDictation() {
  // v7.29.0 — initDictation() est rappelée à CHAQUE ouverture de manuscrit
  // (voir initApp(), router.js) : on coupe systématiquement toute instance
  // précédente (gestionnaires neutralisés en premier, au cas où stop() ne
  // serait pas instantané) avant d'en créer une nouvelle, pour empêcher
  // deux reconnaissances de tourner en même temps.
  if (_recognition) {
    try {
      _recognition.onresult = null;
      _recognition.onerror = null;
      _recognition.onend = null;
      _recognition.abort();
    } catch(e) { /* déjà arrêtée ou jamais démarrée : rien à faire */ }
  }
  _dictating = false;
  _dictationFinalTextSoFar = '';
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { document.getElementById('dictate-status').textContent='Non supporté'; return; }
  _recognition = new SpeechRecognition();
  _recognition.lang = 'fr-FR'; _recognition.continuous = true; _recognition.interimResults = true;
  _recognition.onresult = e => {
    let interim = '', currentFinalText = '';
    // On reconstruit le texte définitif TOTAL rapporté à cet instant (tous
    // les résultats marqués isFinal, dans l'ordre) plutôt que de se fier à
    // quels indices seraient "nouveaux" — voir commentaire plus haut.
    for (let i=0; i<e.results.length; i++) {
      if (e.results[i].isFinal) currentFinalText += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    document.getElementById('dictate-preview').textContent = interim;
    let newText = '';
    if (currentFinalText.length > _dictationFinalTextSoFar.length && currentFinalText.startsWith(_dictationFinalTextSoFar)) {
      // Cas normal : le texte définitif a grandi, on n'insère que la partie
      // qui n'était pas encore là.
      newText = currentFinalText.slice(_dictationFinalTextSoFar.length);
      _dictationFinalTextSoFar = currentFinalText;
    } else if (currentFinalText && currentFinalText !== _dictationFinalTextSoFar) {
      // Cas rare (le début du texte rapporté a changé de façon incompatible) :
      // on resynchronise sans rien réinsérer, pour ne jamais dupliquer.
      _dictationFinalTextSoFar = currentFinalText;
    }
    if (newText) {
      if (_dictationRange) {
        try {
          _dictationRange.deleteContents();
          const node = document.createTextNode(' ' + newText);
          _dictationRange.insertNode(node);
          // Le curseur logique avance après le texte inséré, pour que la
          // phrase suivante s'enchaîne juste après (et non avant).
          _dictationRange.setStartAfter(node);
          _dictationRange.setEndAfter(node);
        } catch(e) {
          // Le DOM a changé entre-temps (édition manuelle pendant la
          // dictée) : on se replie sur l'ajout en fin de texte pour ce
          // fragment, sans interrompre la dictée en cours.
          document.getElementById('writer').innerHTML += DOMPurify.sanitize(' ' + newText);
        }
      } else {
        document.getElementById('writer').innerHTML += DOMPurify.sanitize(' ' + newText);
      }
      liveCounter();
      document.getElementById('dictate-preview').textContent = '';
    }
  };
  _recognition.onerror = e => { toast('Erreur dictée : '+e.error,'error'); stopDictation(); };
  // Une nouvelle session de reconnaissance qui redémarre repart avec un
  // tableau `results` vide côté navigateur : notre suivi doit repartir de
  // zéro avec elle.
  _recognition.onend = () => { if (_dictating) { _dictationFinalTextSoFar = ''; _recognition.start(); } };
}

function toggleDictation() {
  if (!_recognition) { toast('Dictée non supportée','error'); return; }
  if (_dictating) stopDictation(); else startDictation();
}
function startDictation() {
  captureDictationRange();
  _dictationFinalTextSoFar = '';
  _dictating = true; _recognition.start();
  const btn = document.getElementById('dictate-btn');
  btn.style.background = '#e74c3c'; btn.classList.add('record-pulse');
  document.getElementById('dictate-status').textContent = 'Enregistrement…';
}
function stopDictation() {
  _dictating = false; _recognition.stop();
  _dictationRange = null;
  const btn = document.getElementById('dictate-btn');
  btn.style.background = 'var(--accent)'; btn.classList.remove('record-pulse');
  document.getElementById('dictate-status').textContent = 'Prêt';
  document.getElementById('dictate-preview').textContent = '';
}
