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
// v7.28.0 — Correction du bug de dictée "frénétique" (le même texte inséré
// des dizaines de fois) : le code se fiait auparavant à `e.resultIndex`,
// fourni par le navigateur pour indiquer quels résultats sont nouveaux
// depuis le dernier événement. Or sur de nombreuses versions de Chrome, en
// mode `continuous`, cette valeur est peu fiable et peut revenir à 0 —
// l'ancien code retraitait alors TOUT l'historique déjà dicté à chaque
// nouvelle phrase (et le réinsérait en double, triple...), l'accumulation
// s'aggravant au fil de la dictée. On ne dépend plus de `resultIndex` :
// on suit nous-mêmes, avec `_dictationLastFinalIndex`, le dernier résultat
// définitif déjà inséré pour la session de reconnaissance en cours.
let _dictationLastFinalIndex = -1;
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
  // v7.29.0 — Cause réelle du bug de dictée "frénétique" : initDictation()
  // est rappelée à CHAQUE ouverture de manuscrit (voir initApp(), router.js).
  // Chaque appel créait une nouvelle reconnaissance vocale sans jamais
  // arrêter proprement la précédente. Si la dictée était encore active (ou
  // pas complètement arrêtée) au moment d'ouvrir un autre manuscrit,
  // l'ancienne instance continuait à tourner en arrière-plan ET la nouvelle
  // se mettait à écouter aussi — les deux écrivant dans la même zone de
  // texte (l'élément #writer est réutilisé d'un manuscrit à l'autre), d'où
  // le texte inséré en double, triple, voire beaucoup plus après plusieurs
  // ouvertures. On coupe maintenant systématiquement toute instance
  // précédente (et on neutralise ses gestionnaires d'événements en premier,
  // au cas où stop() ne serait pas instantané) avant d'en créer une nouvelle.
  if (_recognition) {
    try {
      _recognition.onresult = null;
      _recognition.onerror = null;
      _recognition.onend = null;
      _recognition.abort();
    } catch(e) { /* déjà arrêtée ou jamais démarrée : rien à faire */ }
  }
  _dictating = false;
  _dictationLastFinalIndex = -1;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { document.getElementById('dictate-status').textContent='Non supporté'; return; }
  _recognition = new SpeechRecognition();
  _recognition.lang = 'fr-FR'; _recognition.continuous = true; _recognition.interimResults = true;
  _recognition.onresult = e => {
    let interim='', final='';
    // On parcourt TOUS les résultats de la session (et non depuis
    // e.resultIndex, voir commentaire plus haut) ; seuls les résultats
    // définitifs situés après le dernier déjà inséré sont pris en compte.
    for (let i=0; i<e.results.length; i++) {
      if (e.results[i].isFinal) {
        if (i > _dictationLastFinalIndex) { final += e.results[i][0].transcript; _dictationLastFinalIndex = i; }
      } else interim += e.results[i][0].transcript;
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
  // v7.28.0 — Une nouvelle session de reconnaissance qui redémarre repart
  // avec un tableau `results` vide côté navigateur : notre compteur maison
  // doit repartir à -1 avec elle, sans quoi le premier résultat définitif
  // de la nouvelle session serait ignoré (i > _dictationLastFinalIndex
  // resterait faux un temps).
  _recognition.onend = () => { if (_dictating) { _dictationLastFinalIndex = -1; _recognition.start(); } };
}

function toggleDictation() {
  if (!_recognition) { toast('Dictée non supportée','error'); return; }
  if (_dictating) stopDictation(); else startDictation();
}
function startDictation() {
  captureDictationRange();
  _dictationLastFinalIndex = -1;
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
