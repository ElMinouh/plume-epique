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

// ── Stubs ajoutés pour l'extension de couverture (memory.js, findreplace.js,
// editor.js, wordcloud.js). Ces fonctions vivent dans des fichiers non chargés
// par ce harnais (router.js, stats.js, readability.js) et ne sont pas l'objet
// des tests ci-dessous ; seul leur appel doit ne pas planter.
// Déclarés de façon défensive (comme le stub DOMPurify plus haut) : si l'un
// de ces noms existe déjà dans un fichier réellement chargé, c'est la vraie
// implémentation qui est conservée, pas le stub.
let _switching = false;
if (typeof updateDailyStats === 'undefined') { window.updateDailyStats = function () {}; }
if (typeof debouncedSave === 'undefined') { window.debouncedSave = function () {}; }
if (typeof getPlainText === 'undefined') {
  window.getPlainText = html => (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

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

  // ════════════════════════════════════════════════════════════════
  // EXTENSION DE COUVERTURE — memory.js, findreplace.js, editor.js
  // (annuler/rétablir), wordcloud.js, library.js (fonctions pures)
  // ════════════════════════════════════════════════════════════════

  // Bac à sable DOM : les fonctions testées ci-dessous lisent le vrai DOM.
  // On reconstruit ici les seuls éléments dont elles ont besoin.
  const sandbox = document.createElement('div');
  sandbox.className = 'hidden';
  sandbox.innerHTML =
    '<div id="writer" contenteditable="true"></div>' +
    '<button id="undo-btn"></button><button id="redo-btn"></button>' +
    '<input id="fr-find-input"><input id="fr-replace-input">' +
    '<div id="fr-status"></div>';
  document.body.appendChild(sandbox);
  const writerEl = document.getElementById('writer');
  const findInput = document.getElementById('fr-find-input');
  const replInput = document.getElementById('fr-replace-input');
  const _savedDb = db, _savedCur = cur;

  group('memory.js — splitPassages()');
  const mots300 = Array.from({length:300}, (_,i) => 'mot'+i).join(' ');
  const p300 = splitPassages(mots300);
  assert(p300.length === 2, `300 mots en fenêtres de 200 → 2 passages (obtenu ${p300.length})`);
  assert(p300[0].split(' ').length === 200, 'le premier passage contient exactement 200 mots');
  assert(p300[1].startsWith('mot170 '), 'le second passage démarre 30 mots en arrière (chevauchement)');
  assert(splitPassages('mot').length === 0, 'un fragment de moins de 20 caractères est ignoré');
  assert(splitPassages('').length === 0, 'un texte vide ne produit aucun passage');
  const pEsp = splitPassages('   plusieurs   espaces   consécutifs   ici   vraiment   ');
  assert(pEsp.length === 1 && !/ {2}/.test(pEsp[0]), 'les espaces multiples sont normalisés');
  const p50 = splitPassages(Array.from({length:50},(_,i)=>'mot'+i).join(' '), 20, 5);
  assert(p50.length === 4, `fenêtre et chevauchement personnalisés respectés (attendu 4, obtenu ${p50.length})`);

  group('memory.js — extractKeywords()');
  const kw = extractKeywords('Le dragon dort. Le dragon rêve du dragon et de la forêt.');
  assert(kw[0] === 'dragon', 'le mot le plus fréquent arrive en tête');
  assert(!kw.includes('les') && !kw.includes('dans') && !kw.includes('pour'), 'les mots outils (stop-words) sont écartés');
  assert(kw.includes('forêt'), 'les mots accentués sont conservés');
  assert(extractKeywords('avec dans pour mais donc').length === 0, 'un texte composé uniquement de mots outils ne donne aucun mot-clé');
  assert(extractKeywords('Il y a un an').length === 0, 'les mots de moins de 3 lettres sont écartés');
  const mots30 = Array.from({length:30},(_,i) =>
    'term' + String.fromCharCode(97 + Math.floor(i/26)) + String.fromCharCode(97 + i%26)).join(' ');
  assert(extractKeywords(mots30).length === 20, `la liste est plafonnée à 20 mots-clés (obtenu ${extractKeywords(mots30).length})`);
  assert(extractKeywords('DRAGON dragon Dragon')[0] === 'dragon', 'la casse est ignorée');

  group('memory.js — scoreRelevance()');
  assert(scoreRelevance(['chat'], [], 'le chat dort') === 2, 'une occurrence exacte vaut 2 points');
  assert(scoreRelevance(['chat'], ['chat'], 'le chat dort') === 5, 'occurrence exacte + présence dans les mots-clés = 5 points');
  assert(scoreRelevance(['chat'], [], 'chat chat chat') === 6, 'le score cumule les occurrences multiples');
  assert(scoreRelevance(['chat'], [], 'aucun rapport ici') === 0, 'aucune correspondance donne 0');
  assert(scoreRelevance(['chevalier'], [], 'les chevaliers arrivent') === 1,
    'un mot de plus de 5 lettres est reconnu par sa racine (+1) même sans correspondance exacte');
  assert(scoreRelevance(['dragon'], [], 'le dragon vole') === 3, 'occurrence exacte (2) + bonus de racine (1) pour un mot long');
  assert(scoreRelevance([], ['chat'], 'le chat dort') === 0, 'une requête sans mot-clé donne 0');

  group('memory.js — buildNarrativeIndex() / searchNarrativeIndex()');
  assert(searchNarrativeIndex('dragon').length === 0, 'aucune recherche possible avant indexation');
  db = {
    chapters: [
      { id:'ch-A', title:'La forge', content:'<p>'+('Le forgeron martèle le fer rouge dans la forge ardente. ').repeat(4)+'</p>' },
      { id:'ch-B', title:'Le dragon', content:'<p>'+('Le dragon écarlate survole la vallée et rugit vers les montagnes. ').repeat(4)+'</p>' },
      { id:'ch-C', title:'Trop court', content:'<p>Bref.</p>' }
    ],
    chars:  [{ name:'Aldric', role:'chevalier', age:'30', phys:'grand', info:'chasseur de dragon' }],
    places: [{ name:'Val Sombre', type:'vallée', mood:'inquiétant', info:'repaire du dragon' }]
  };
  cur = 0;
  // buildNarrativeIndex() commence par flushCurrentChapter() : on aligne
  // l'éditeur sur le chapitre courant pour ne pas l'écraser au passage.
  writerEl.innerHTML = db.chapters[0].content;
  const nbPassages = buildNarrativeIndex();
  assert(nbPassages === 2, `seuls les chapitres d'au moins 30 caractères sont indexés (attendu 2, obtenu ${nbPassages})`);
  const resDragon = searchNarrativeIndex('dragon', 5);
  assert(resDragon.length > 0, 'une recherche pertinente renvoie des résultats');
  assert(resDragon.every((r,i,a) => i === 0 || a[i-1].score >= r.score), 'les résultats sont triés par score décroissant');
  assert(resDragon.every(r => r.score > 0), 'les passages de score nul sont écartés');
  assert(resDragon.some(r => r.chId === 'ch-B'), "l'index référence le chapitre par son ID stable");
  assert(resDragon.some(r => r.chTitle === '📚 Personnages'), 'les personnages sont indexés');
  assert(resDragon.some(r => r.chTitle === '🏰 Lieux'), 'les lieux sont indexés');
  assert(searchNarrativeIndex('dragon', 1).length === 1, 'le paramètre topK limite le nombre de résultats');
  assert(searchNarrativeIndex('zzzzinexistant').length === 0, 'une recherche sans correspondance renvoie une liste vide');
  // Non-régression v6.0.0 : réorganiser les chapitres après indexation ne doit
  // pas casser le lien entre un résultat et son chapitre d'origine.
  db.chapters.reverse();
  const cible = searchNarrativeIndex('dragon', 5).find(r => r.chId === 'ch-B');
  assert(!!cible && db.chapters.findIndex(c => c.id === cible.chId) === 1,
    'après réorganisation des chapitres, un résultat pointe toujours vers le bon chapitre');
  db.chapters.reverse();

  group('findreplace.js — findAllMatches()');
  writerEl.innerHTML = 'Le chat dort. Le chat rêve.';
  assert(findAllMatches(writerEl, 'chat').length === 2, 'deux occurrences trouvées dans un texte simple');
  assert(findAllMatches(writerEl, 'CHAT').length === 2, 'la recherche est insensible à la casse');
  assert(findAllMatches(writerEl, 'licorne').length === 0, 'une requête absente ne renvoie rien');
  // Non-régression v7.1.0 : une occurrence à cheval sur une limite de mise en
  // forme (mot moitié en gras) doit être retrouvée.
  writerEl.innerHTML = 'Le <b>cha</b>t noir';
  const chevauche = findAllMatches(writerEl, 'chat');
  assert(chevauche.length === 1, 'une occurrence répartie sur deux nœuds texte est retrouvée (correctif v7.1.0)');
  assert(!!chevauche[0] && chevauche[0].startNode !== chevauche[0].endNode,
    "l'occurrence à cheval référence bien deux nœuds distincts");
  writerEl.innerHTML = 'aaaa';
  assert(findAllMatches(writerEl, 'aa').length === 2, 'les occurrences trouvées ne se chevauchent pas entre elles');
  const flatIdx = buildFlatIndex(writerEl);
  assert(flatIdx.flat === 'aaaa' && flatIdx.map.length === 4, 'buildFlatIndex() produit un texte à plat et une carte de même longueur');

  group('findreplace.js — frReplaceAll()');
  db = { chapters: [{ id:'fr-1', title:'Test', content:'' }] };
  cur = 0;
  findInput.value = 'chat'; replInput.value = 'chien';
  writerEl.innerHTML = 'Le chat et le chat.';
  frReplaceAll();
  assert(writerEl.textContent === 'Le chien et le chien.', 'toutes les occurrences sont remplacées');
  // Piège classique : un remplacement qui contient la requête ne doit pas se
  // ré-appliquer à lui-même.
  findInput.value = 'chat'; replInput.value = 'chaton';
  writerEl.innerHTML = 'chat chat';
  frReplaceAll();
  assert(writerEl.textContent === 'chaton chaton', 'un remplacement contenant la requête ne boucle pas sur lui-même');
  findInput.value = 'XX'; replInput.value = '';
  writerEl.innerHTML = 'aXXbXXc';
  frReplaceAll();
  assert(writerEl.textContent === 'abc', 'un remplacement vide supprime les occurrences');
  findInput.value = 'chat'; replInput.value = 'chien';
  writerEl.innerHTML = 'Le <b>cha</b>t noir';
  frReplaceAll();
  assert(writerEl.textContent === 'Le chien noir', 'un remplacement à cheval sur du gras aboutit au bon texte');
  assert(document.getElementById('fr-status').textContent === 'Aucun résultat',
    'le compteur d’occurrences est réinitialisé après un remplacement global');

  group('editor.js — piles annuler / rétablir');
  // frReplaceAll() appelle liveCounter(), qui arme une étape d'annulation
  // différée : on repart d'un état propre avant de tester les piles.
  clearTimeout(_undoPushTimer); _pendingUndoFlush = false;
  db = { chapters: [{ id:'ch-1', title:'Un', content:'A' }, { id:'ch-2', title:'Deux', content:'B' }] };
  cur = 0;
  Object.keys(_undoStacks).forEach(k => delete _undoStacks[k]);

  const st1 = getUndoStack('ch-1');
  assert(st1.stack.length === 1 && st1.stack[0] === '' && st1.index === 0, 'une pile neuve démarre vide, à l’index 0');
  ensureUndoStack(db.chapters[1]);
  assert(_undoStacks['ch-2'].stack[0] === 'B', 'ensureUndoStack() initialise la pile avec le contenu du chapitre');
  ensureUndoStack({ id:'ch-2', content:'ÉCRASÉ' });
  assert(_undoStacks['ch-2'].stack[0] === 'B', 'ensureUndoStack() n’écrase pas une pile déjà existante');

  writerEl.innerHTML = 'v1'; checkpointNow();
  assert(_undoStacks['ch-1'].stack.length === 2, 'une première modification est enregistrée');
  checkpointNow();
  assert(_undoStacks['ch-1'].stack.length === 2, 'un enregistrement identique au précédent n’ajoute pas d’étape');
  writerEl.innerHTML = 'v2'; checkpointNow();
  writerEl.innerHTML = 'v3'; checkpointNow();
  assert(_undoStacks['ch-1'].stack.length === 4, 'trois modifications successives donnent 4 états');

  undoEdit();
  assert(writerEl.innerHTML === 'v2', 'annuler revient à l’état précédent');
  assert(db.chapters[0].content === 'v2', 'annuler met aussi à jour le contenu du chapitre en mémoire');
  undoEdit();
  assert(writerEl.innerHTML === 'v1', 'annuler deux fois recule de deux états');
  redoEdit();
  assert(writerEl.innerHTML === 'v2', 'rétablir avance d’un état');
  redoEdit(); redoEdit();
  assert(writerEl.innerHTML === 'v3', 'on ne peut pas rétablir au-delà du dernier état');
  undoEdit(); undoEdit(); undoEdit(); undoEdit();
  assert(writerEl.innerHTML === '', 'on ne peut pas annuler au-delà du premier état');

  // Après une annulation, une nouvelle modification efface la branche
  // « rétablir » — comportement attendu d'un traitement de texte.
  _undoStacks['ch-1'] = { stack:['a','b','c'], index:1 };
  writerEl.innerHTML = 'z'; checkpointNow();
  assert(_undoStacks['ch-1'].stack.join('') === 'abz', 'une nouvelle modification après annulation efface la branche « rétablir »');

  // Plafond de la pile. La valeur attendue est écrite en dur volontairement :
  // sinon le test se comparerait à lui-même et ne détecterait aucune dérive.
  assert(UNDO_LIMIT === 100, 'le plafond de la pile d’annulation vaut bien 100 états');
  Object.keys(_undoStacks).forEach(k => delete _undoStacks[k]);
  for (let i = 0; i < UNDO_LIMIT + 5; i++) { writerEl.innerHTML = 'e' + i; checkpointNow(); }
  assert(_undoStacks['ch-1'].stack.length === UNDO_LIMIT,
    `la pile est plafonnée à ${UNDO_LIMIT} états (obtenu ${_undoStacks['ch-1'].stack.length})`);
  assert(_undoStacks['ch-1'].index === _undoStacks['ch-1'].stack.length - 1, 'l’index reste cohérent après élagage de la pile');
  assert(_undoStacks['ch-1'].stack[_undoStacks['ch-1'].stack.length-1] === 'e' + (UNDO_LIMIT+4),
    'c’est bien le plus ancien état qui est supprimé, pas le plus récent');

  // Non-régression ADR-4 : les piles sont indexées par ID de chapitre, donc
  // réorganiser les chapitres ne mélange pas les historiques.
  Object.keys(_undoStacks).forEach(k => delete _undoStacks[k]);
  cur = 0; writerEl.innerHTML = 'texte du chapitre un'; checkpointNow();
  cur = 1; writerEl.innerHTML = 'texte du chapitre deux'; checkpointNow();
  db.chapters.reverse();
  cur = db.chapters.findIndex(c => c.id === 'ch-1');
  undoEdit();
  assert(writerEl.innerHTML === '', 'après réorganisation, annuler agit sur la pile du bon chapitre');
  assert(_undoStacks['ch-2'].stack.includes('texte du chapitre deux'), 'la pile de l’autre chapitre est restée intacte');

  group('editor.js — isTypingTarget()');
  assert(isTypingTarget(null) === false, 'aucun élément → faux');
  assert(isTypingTarget(writerEl) === false, "l'éditeur principal n'est pas traité comme un champ de saisie tiers");
  assert(isTypingTarget(findInput) === true, 'un champ de recherche est bien un champ de saisie');
  assert(isTypingTarget(document.createElement('div')) === false, 'un simple bloc n’est pas un champ de saisie');

  group('wordcloud.js — buildWordFreq()');
  db = { chapters: [
    { id:'w1', content:'<p>Le <b>dragon</b> vole dans les cieux. Le dragon rugit.</p>' },
    { id:'w2', content:'<p>La forêt murmure et la forêt respire, forêt profonde.</p>' }
  ]};
  cur = 0;
  const freqCur = buildWordFreq(false);
  assert(freqCur[0][0] === 'dragon' && freqCur[0][1] === 2, 'chapitre courant seul : « dragon » compté 2 fois');
  assert(!freqCur.some(([w]) => w === 'dans' || w === 'les'), 'les mots outils sont écartés');
  assert(freqCur.every(([w]) => /^[a-zA-ZÀ-ÿ]+$/.test(w)), 'les balises HTML ne polluent pas le comptage');
  const freqAll = buildWordFreq(true);
  assert(freqAll[0][0] === 'forêt' && freqAll[0][1] === 3, 'tous chapitres : « forêt » en tête avec 3 occurrences');
  assert(freqAll.every((e,i,a) => i === 0 || a[i-1][1] >= e[1]), 'la liste est triée par fréquence décroissante');
  db = { chapters: [{ id:'w3', content:'' }] }; cur = 0;
  assert(buildWordFreq(false).length === 0, 'un chapitre vide ne produit aucun mot');

  group('library.js — fonctions pures');
  assert(docListKey('p1') === 'doclist_p1', 'la clé de liste de manuscrits est stable');
  assert(docDataKey('p1', 'd9') === 'doc_p1_d9', 'la clé de données de manuscrit est stable');
  assert(formatRelativeDate(0) === '', 'un horodatage absent renvoie une chaîne vide');
  const JOUR = 86400000;
  assert(formatRelativeDate(Date.now()) === "Modifié aujourd'hui", 'à l’instant → aujourd’hui');
  assert(formatRelativeDate(Date.now() - JOUR - 1000) === 'Modifié hier', 'un jour et des poussières → hier');
  assert(formatRelativeDate(Date.now() - 3*JOUR - 1000) === 'Modifié il y a 3 jours', 'trois jours → « il y a 3 jours »');
  assert(formatRelativeDate(Date.now() - 10*JOUR) === 'Modifié il y a 1 semaine(s)', 'dix jours → semaines');
  assert(formatRelativeDate(Date.now() - 65*JOUR) === 'Modifié il y a 2 mois', 'soixante-cinq jours → mois');
  assert(formatRelativeDate(Date.now() + 5*JOUR) === "Modifié aujourd'hui", 'une date future ne casse pas l’affichage');

  // Remise en état pour ne pas perturber d'éventuels tests ultérieurs.
  clearTimeout(_undoPushTimer); _pendingUndoFlush = false;
  db = _savedDb; cur = _savedCur;
  sandbox.remove();

  const total = _pass + _fail;
  const summary = document.getElementById('summary');
  summary.className = _fail === 0 ? 'ok' : 'ko';
  summary.textContent = _fail === 0
    ? `✅ ${_pass}/${total} tests réussis.`
    : `❌ ${_fail}/${total} test(s) en échec (${_pass} réussis sur ${total}).`;
})();
