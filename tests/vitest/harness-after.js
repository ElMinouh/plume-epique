// ═══════════════════════════════════════════════════════
// ENVIRONNEMENT DE TEST — porté depuis tests/test-runner.js (lignes 26-54)
// lors de la migration vers Vitest. Contenu logique identique à l'ancienne
// suite (mêmes mocks persistData/loadData/save/toast, mêmes variables
// globales `db`/`cur`/etc.) — seuls assert()/group() changent : au lieu
// d'écrire des <div> dans #results, ils accumulent dans __results, pour
// qu'un `it()` Vitest distinct soit généré pour chaque assertion (voir
// plume.test.js).
// ═══════════════════════════════════════════════════════
'use strict';

// ── Environnement minimal simulé pour tester profiles.js sans charger
// tout router.js (qui a des effets de bord au chargement — voir ADR-6) ──
let db, cur, _currentProfileId, _currentProfile, _dataKey, _encPassword;
const _mockStore = new Map();
async function persistData(key, payload) { _mockStore.set(key, payload); }
async function loadData(key) { return _mockStore.has(key) ? _mockStore.get(key) : null; }
function initApp() { /* stub : non testé ici, seule la logique profils l'est */ }
function getWordCount(t) { const m=(t||'').replace(/<[^>]*>/g,' ').match(/[a-zA-Z0-9À-ÿ]+/g); return m?m.length:0; }
async function enterLibrary() { /* stub : l'écran bibliothèque (DOM) n'est pas testé ici, voir createNewDocument()/openDocument() plus bas pour la logique réelle */ }
// v9.3.0 — Depuis l'arbitrage de synchro à empreinte de contenu, library.js
// crée toute enveloppe chiffrée de manuscrit via makeEncryptedEnvelope()
// (router.js), au lieu de construire {_enc:true,data:...} à la main — point
// de passage unique garantissant qu'aucune enveloppe n'oublie l'empreinte.
// router.js n'étant volontairement pas chargé dans ce harnais (voir en-tête
// de fichier), ce stub reproduit sa forme exacte SANS dépendre de
// sha256Hex()/_dataKey de synchro (uniquement utiles à l'arbitrage réel,
// testé lui à part — voir tests/vitest/sync-conflict-arbitration.test.js).
async function makeEncryptedEnvelope(plaintext) {
  return { _enc: true, data: await Crypto.encrypt(plaintext, _dataKey), _fp: null, _ts: Date.now() };
}
const save = async () => {
  if (!_currentProfileId || !_dataKey || !_currentDocumentId) return;
  await persistData(docDataKey(_currentProfileId, _currentDocumentId), await makeEncryptedEnvelope(JSON.stringify(db)));
  await touchDocumentMeta();
};
let _lastToast = null;
function toast(msg, type) { _lastToast = { msg, type }; }

// ── assert()/group() adaptés Vitest : accumulent au lieu d'écrire au DOM ──
// `var` (et non `let`) : seule une déclaration `var` (ou une affectation
// simple) devient une propriété du contexte, lisible depuis l'extérieur du
// vm une fois la suite terminée — un `let`/`const` resterait, lui,
// invisible hors de ce contexte (variable purement lexicale).
var __results = [];
var __currentGroup = '(sans groupe)';
function group(title) { __currentGroup = title; }
function assert(cond, label) { __results.push({ group: __currentGroup, label, pass: !!cond }); }
