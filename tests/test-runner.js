// Suite de tests de Plume Épique — extraite du <script> inline de
// tests/test-runner.html lors du passage de la CSP à script-src 'self'
// (v7.19.0, étape 3/3). Le contenu est identique, seul l'emplacement change.
'use strict';
// Stub minimal : diff.js appelle DOMPurify.sanitize(), non chargé ici volontairement
// (le vrai DOMPurify n'apporte rien à ces tests et alourdirait ce fichier autonome).
if (typeof DOMPurify === 'undefined') { window.DOMPurify = { sanitize: s => s }; }

// ── Environnement minimal simulé pour tester profiles.js sans charger
// tout router.js (qui a des effets de bord au chargement — voir ADR-6) ──
let db, cur, _currentProfileId, _currentProfile, _dataKey, _encPassword;
const _mockStore = new Map();
async function persistData(key, payload) { _mockStore.set(key, payload); }
async function loadData(key) { return _mockStore.has(key) ? _mockStore.get(key) : null; }
function initApp() { /* stub : non testé ici, seule la logique profils l'est */ }
function getWordCount(t) { const m=(t||'').replace(/<[^>]*>/g,' ').match(/[a-zA-Z0-9À-ÿ]+/g); return m?m.length:0; }
async function enterLibrary() { /* stub : l'écran bibliothèque (DOM) n'est pas testé ici, voir createNewDocument()/openDocument() plus bas pour la logique réelle */ }
const save = async () => {
  if (!_currentProfileId || !_dataKey || !_currentDocumentId) return;
  const cipher = await Crypto.encrypt(JSON.stringify(db), _dataKey);
  await persistData(docDataKey(_currentProfileId, _currentDocumentId), { _enc:true, data:cipher });
  await touchDocumentMeta();
};
let _lastToast = null;
function toast(msg, type) { _lastToast = { msg, type }; }

let _pass = 0, _fail = 0;
function assert(cond, label) {
  const el = document.createElement('div'); el.className = 'line';
  if (cond) { _pass++; el.innerHTML = `<span class="pass">✔</span> ${label}`; }
  else { _fail++; el.innerHTML = `<span class="fail">✘ ÉCHEC</span> — ${label}`; }
  document.getElementById('results').appendChild(el);
}
function group(title) {
  const el = document.createElement('div'); el.className = 'group';
  el.textContent = title; document.getElementById('results').appendChild(el);
}

(async () => {
  group('genChapterId()');
  const id1 = genChapterId(), id2 = genChapterId();
  assert(!!id1 && typeof id1 === 'string', 'génère un ID non vide');
  assert(id1 !== id2, 'deux appels donnent des IDs différents');

  group('migrateDb() — schéma v1 → actuel');
  const v1 = { _schemaVersion: 1, chapters: [{ title:'Ch1', content:'texte' }, { title:'Ch2', content:'texte 2' }] };
  const migrated = migrateDb(JSON.parse(JSON.stringify(v1)));
  assert(migrated._schemaVersion === SCHEMA_VERSION, `_schemaVersion mis à jour (attendu ${SCHEMA_VERSION})`);
  assert(Array.isArray(migrated.timeline), 'timeline initialisé');
  assert(Array.isArray(migrated.tabOrder), 'tabOrder initialisé');
  assert(typeof migrated.history === 'object', 'history initialisé');
  assert(migrated.chapters.every(c => !!c.id), 'chaque chapitre a un ID stable');
  assert(migrated.chapters.every(c => !!c.status), 'chaque chapitre a un statut par défaut');

  group("migrateDb() — remapping de l'historique v3 → v4 (par ID, pas par position)");
  const v3 = {
    _schemaVersion: 3,
    chapters: [{ title:'A', content:'a' }, { title:'B', content:'b' }],
    history: { '0': [{ label:'snap A', content:'a', date:'x' }], '1': [{ label:'snap B', content:'b', date:'x' }] }
  };
  const migratedV3 = migrateDb(JSON.parse(JSON.stringify(v3)));
  const idA = migratedV3.chapters[0].id, idB = migratedV3.chapters[1].id;
  assert(!!migratedV3.history[idA] && migratedV3.history[idA][0].label === 'snap A', "historique du chapitre A remappé sur son ID");
  assert(!!migratedV3.history[idB] && migratedV3.history[idB][0].label === 'snap B', "historique du chapitre B remappé sur son ID");

  group('DEFAULT_DB()');
  const fresh = DEFAULT_DB();
  assert(fresh.chapters.length === 1, 'un chapitre par défaut');
  assert(fresh.chapters[0].status === 'draft', 'statut par défaut = brouillon');
  assert(fresh.sprint === null, 'aucun sprint actif par défaut');

  group('Crypto — chiffrement / déchiffrement (AES-GCM + PBKDF2)');
  const secret = 'Ceci est un texte de test avec des accents éàù.';
  const pwd = 'motdepasse-test-123';
  const cipher = await Crypto.encrypt(secret, pwd);
  assert(typeof cipher === 'string' && cipher.length > 0, 'encrypt() renvoie une chaîne non vide');
  const decrypted = await Crypto.decrypt(cipher, pwd);
  assert(decrypted === secret, 'decrypt() restitue exactement le texte original');
  const wrongDecrypt = await Crypto.decrypt(cipher, 'mauvais-mot-de-passe');
  assert(wrongDecrypt === null, 'un mauvais mot de passe échoue proprement (renvoie null, pas d\'exception)');

  group('diff.js — computeDiff() (algorithme LCS)');
  const d1 = computeDiff('le chat noir dort', 'le chat noir dort');
  assert(/\+0 mots ajoutés/.test(d1) && /-0 mots supprimés/.test(d1), 'aucun changement compté sur deux textes identiques');
  const d2 = computeDiff('le chat dort', 'le chat noir dort');
  assert(/diff-add/.test(d2) && d2.includes('noir'), 'un mot ajouté est bien détecté');
  const d3 = computeDiff('le chat noir dort', 'le chat dort');
  assert(/diff-del/.test(d3) && d3.includes('noir'), 'un mot supprimé est bien détecté');

  group('profiles.js — nameExists()');
  const fakeIdx = { profiles: [{ id:'p1', name:'Cyril' }, { id:'p2', name:'Marie' }] };
  assert(nameExists(fakeIdx, 'cyril') === true, 'insensible à la casse');
  assert(nameExists(fakeIdx, 'Cyril', 'p1') === false, "exclut le profil lui-même (exceptId)");
  assert(nameExists(fakeIdx, 'Nouveau') === false, "un nom absent renvoie false");

  group('profiles.js — création de profil (enveloppement de clé DEK)');
  renderCreateProfile({ firstAdmin: true });
  document.getElementById('cp-name').value = 'TestUser';
  document.getElementById('cp-pwd').value = 'motdepasse1';
  document.getElementById('cp-pwd2').value = 'motdepasse1';
  document.getElementById('cp-question').value = SECURITY_QUESTIONS[0];
  document.getElementById('cp-answer').value = 'Fido';
  await submitCreateProfile({ firstAdmin: true });
  let idx = await loadProfilesIndex();
  assert(idx.profiles.length === 1, "le profil est ajouté à l'index");
  const p1 = idx.profiles[0];
  assert(p1.name === 'TestUser' && p1.role === 'admin', 'nom et rôle admin corrects');
  assert(!!p1.wrapPwd && !!p1.wrapAnswer && !!p1.wrapCode, 'les 3 enveloppes de clé sont générées');
  const dekViaPwd = await Crypto.decrypt(p1.wrapPwd, 'motdepasse1');
  const dekViaAnswer = await Crypto.decrypt(p1.wrapAnswer, Crypto.normalize('Fido'));
  assert(dekViaPwd !== null, 'le mot de passe ouvre la DEK');
  assert(dekViaAnswer !== null, 'la réponse à la question ouvre aussi la DEK');
  assert(dekViaPwd === dekViaAnswer, 'les deux méthodes donnent exactement la même clé (profils étanches)');
  const wrongDek = await Crypto.decrypt(p1.wrapPwd, 'mauvais-mot-de-passe');
  assert(wrongDek === null, 'un mauvais mot de passe échoue proprement');

  group('profiles.js — connexion (doLogin)');
  idx = await loadProfilesIndex();
  renderLoginScreen(idx);
  document.getElementById('login-profile-sel').value = p1.id;
  document.getElementById('login-pwd').value = 'mauvais-mdp';
  await doLogin();
  assert(document.getElementById('login-err').textContent === 'Mot de passe incorrect.', 'mauvais mot de passe rejeté proprement');
  document.getElementById('login-pwd').value = 'motdepasse1';
  await doLogin();
  assert(_currentProfileId === p1.id, 'connexion réussie : profil courant mis à jour');

  group('library.js — création et ouverture d\'un manuscrit');
  await createNewDocument();
  assert(!!_currentDocumentId, 'un document est créé et devient le document courant');
  assert(!!db && Array.isArray(db.chapters) && db.chapters.length === 1, 'le nouveau manuscrit a un chapitre par défaut');
  const createdDocId = _currentDocumentId;
  const listAfterCreate = await loadDocList();
  assert(listAfterCreate.documents.some(d => d.id === createdDocId), 'le manuscrit apparaît dans l\'index de la bibliothèque');
  db.title = 'Mon roman de test';
  db.chapters[0].content = '<p>Un peu de texte pour le compteur de mots.</p>';
  await save();
  const listAfterSave = await loadDocList();
  const entry = listAfterSave.documents.find(d => d.id === createdDocId);
  assert(entry && entry.title === 'Mon roman de test', 'le titre du manuscrit est répercuté dans la bibliothèque après sauvegarde');
  assert(entry && entry.wordCount > 0, 'le compteur de mots de la bibliothèque est mis à jour après sauvegarde');
  _currentDocumentId = null; db = null;
  await openDocument(createdDocId);
  assert(_currentDocumentId === createdDocId && db && db.title === 'Mon roman de test', 'réouverture du manuscrit : titre et contenu bien déchiffrés');

  group('profiles.js — récupération (mot de passe oublié)');
  renderRecovery(p1.id); // async en interne (.then()) : on laisse le temps au DOM d'apparaître
  await new Promise(r => setTimeout(r, 0));
  document.getElementById('rec-answer').value = 'fido'; // insensible à la casse/accents via Crypto.normalize
  document.getElementById('rec-pwd').value = 'nouveauMdp1';
  document.getElementById('rec-pwd2').value = 'nouveauMdp1';
  await submitRecovery(p1.id);
  idx = await loadProfilesIndex();
  const p1AfterRecovery = idx.profiles.find(p => p.id === p1.id);
  const dekAfter = await Crypto.decrypt(p1AfterRecovery.wrapPwd, 'nouveauMdp1');
  assert(dekAfter !== null, 'récupération par question : le nouveau mot de passe fonctionne');
  const oldStillWorks = await Crypto.decrypt(p1AfterRecovery.wrapPwd, 'motdepasse1');
  assert(oldStillWorks === null, "l'ancien mot de passe est bien invalidé après récupération");

  group('profiles.js — protections de suppression de profil');
  // Second profil "jetable", créé par l'admin, pour tester une suppression réussie.
  renderCreateProfile({ firstAdmin: false, byAdmin: true });
  document.getElementById('cp-name').value = 'Marie';
  document.getElementById('cp-pwd').value = 'motdepasse2';
  document.getElementById('cp-pwd2').value = 'motdepasse2';
  document.getElementById('cp-question').value = SECURITY_QUESTIONS[1];
  document.getElementById('cp-answer').value = 'Paris';
  await submitCreateProfile({ firstAdmin: false, byAdmin: true });
  idx = await loadProfilesIndex();
  const marie = idx.profiles.find(pr => pr.name === 'Marie');
  assert(!!marie, 'le second profil "Marie" est créé');

  // Auto-suppression bloquée (profil courant = p1, on tente de se supprimer soi-même).
  await adminDeleteProfile(p1.id);
  idx = await loadProfilesIndex();
  assert(idx.profiles.some(pr => pr.id === p1.id), 'on ne peut pas supprimer son propre profil');

  // Dernier administrateur protégé (test isolé de la garde, indépendamment
  // du flux UI réel — voir note dans le README sur cette protection).
  const savedCurrentId = _currentProfileId;
  _currentProfileId = 'session-admin-fictive';
  await adminDeleteProfile(p1.id);
  idx = await loadProfilesIndex();
  assert(idx.profiles.some(pr => pr.id === p1.id), "le dernier administrateur ne peut pas être supprimé");
  _currentProfileId = savedCurrentId;

  // Suppression réussie d'un profil non-admin avec confirmation correcte.
  const realPrompt = window.prompt;
  window.prompt = () => 'Marie';
  await adminDeleteProfile(marie.id);
  window.prompt = realPrompt;
  idx = await loadProfilesIndex();
  assert(!idx.profiles.some(pr => pr.id === marie.id), 'le profil "Marie" est supprimé après confirmation correcte');
  const marieData = await loadData('data_' + marie.id);
  assert(marieData === null, 'les données du profil supprimé sont bien effacées');

  const total = _pass + _fail;
  const summary = document.getElementById('summary');
  summary.className = _fail === 0 ? 'ok' : 'ko';
  summary.textContent = _fail === 0
    ? `✅ ${_pass}/${total} tests réussis.`
    : `❌ ${_fail}/${total} test(s) en échec (${_pass} réussis sur ${total}).`;
})();
