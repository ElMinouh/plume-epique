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
      const writer = document.getElementById('writer');
      writer.innerHTML += DOMPurify.sanitize(' ' + final);
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
  _dictating = true; _recognition.start();
  const btn = document.getElementById('dictate-btn');
  btn.style.background = '#e74c3c'; btn.classList.add('record-pulse');
  document.getElementById('dictate-status').textContent = 'Enregistrement…';
}
function stopDictation() {
  _dictating = false; _recognition.stop();
  const btn = document.getElementById('dictate-btn');
  btn.style.background = 'var(--accent)'; btn.classList.remove('record-pulse');
  document.getElementById('dictate-status').textContent = 'Prêt';
  document.getElementById('dictate-preview').textContent = '';
}
