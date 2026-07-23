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
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { document.getElementById('dictate-status').textContent='Non supporté'; return; }
  _recognition = new SpeechRecognition();
  _recognition.lang = 'fr-FR'; _recognition.continuous = true; _recognition.interimResults = true;
  _recognition.onresult = e => {
    let interim='', final='';
    for (let i=e.resultIndex; i<e.results.length; i++) {
      if (e.results[i].isFinal) final += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    document.getElementById('dictate-preview').textContent = interim;
    if (final) {
      if (_dictationRange) {
        try {
          _dictationRange.deleteContents();
          const node = document.createTextNode(' ' + final);
          _dictationRange.insertNode(node);
          // Le curseur logique avance après le texte inséré, pour que la
          // phrase suivante s'enchaîne juste après (et non avant).
          _dictationRange.setStartAfter(node);
          _dictationRange.setEndAfter(node);
        } catch(e) {
          // Le DOM a changé entre-temps (édition manuelle pendant la
          // dictée) : on se replie sur l'ajout en fin de texte pour ce
          // fragment, sans interrompre la dictée en cours.
          document.getElementById('writer').innerHTML += DOMPurify.sanitize(' ' + final);
        }
      } else {
        document.getElementById('writer').innerHTML += DOMPurify.sanitize(' ' + final);
      }
      liveCounter();
      document.getElementById('dictate-preview').textContent = '';
    }
  };
  _recognition.onerror = e => { toast('Erreur dictée : '+e.error,'error'); stopDictation(); };
  _recognition.onend = () => { if (_dictating) _recognition.start(); };
}

function toggleDictation() {
  if (!_recognition) { toast('Dictée non supportée','error'); return; }
  if (_dictating) stopDictation(); else startDictation();
}
function startDictation() {
  captureDictationRange();
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
