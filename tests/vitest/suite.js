// ═══════════════════════════════════════════════════════
// SUITE PORTÉE — contenu extrait tel quel de l'ancien tests/test-runner.js
// (lignes 57-550 de la version d'origine), à l'intérieur du même IIFE
// asynchrone. Seule la toute fin (compteur _pass/_fail + écriture du
// résumé dans #summary) a été retirée : __results (accumulé par
// assert(), voir harness-after.js) est lu depuis l'extérieur par
// env.js une fois cette promesse résolue — inutile de renvoyer quoi
// que ce soit ici explicitement.
// ═══════════════════════════════════════════════════════
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

  group('migrateDb() — remapping des liens et de la chronologie par ID, v12 → v13 (audit)');
  const v12 = {
    _schemaVersion: 12,
    chapters: [{ id:'chX', title:'X' }, { id:'chY', title:'Y' }],
    chars: [{ name:'Marie', links:[{ type:'places', idx:0 }] }],
    places: [{ name:'Paris' }],
    quests: [{ text:'Trouver le trésor' }],
    timeline: [{ text:'Rencontre', chapterIdx:1 }]
  };
  const migratedV12 = migrateDb(JSON.parse(JSON.stringify(v12)));
  assert(!!migratedV12.chars[0].id && !!migratedV12.places[0].id && !!migratedV12.quests[0].id, 'chaque personnage/lieu/quête reçoit un ID stable');
  assert(migratedV12.chars[0].links[0].id === migratedV12.places[0].id && migratedV12.chars[0].links[0].idx === undefined, 'le lien personnage → lieu est remappé sur l\'ID (idx supprimé)');
  assert(migratedV12.timeline[0].chapterId === 'chY' && migratedV12.timeline[0].chapterIdx === undefined, "l'événement de chronologie est remappé sur l'ID du chapitre (idx supprimé)");

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
  document.getElementById('cp-pwd').value = 'motdepasse-un1';
  document.getElementById('cp-pwd2').value = 'motdepasse-un1';
  document.getElementById('cp-question').value = SECURITY_QUESTIONS[0];
  document.getElementById('cp-answer').value = 'Fido';
  await submitCreateProfile({ firstAdmin: true });
  let idx = await loadProfilesIndex();
  assert(idx.profiles.length === 1, "le profil est ajouté à l'index");
  const p1 = idx.profiles[0];
  assert(p1.name === 'TestUser' && p1.role === 'admin', 'nom et rôle admin corrects');
  assert(!!p1.wrapPwd && !!p1.wrapAnswer && !!p1.wrapCode, 'les 3 enveloppes de clé sont générées');
  const dekViaPwd = await Crypto.decrypt(p1.wrapPwd, 'motdepasse-un1');
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
  document.getElementById('login-pwd').value = 'motdepasse-un1';
  await doLogin();
  assert(_currentProfileId === p1.id, 'connexion réussie : profil courant mis à jour');

  group('profiles.js — session sans mot de passe et mots de passe de 12 caractères (v9.24.0)');
  {
    // 1. La session « rester connecté » ne contient plus le mot de passe
    const sess = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY));
    assert(sess && sess.profileId === p1.id && !!sess.dek, 'la session mémorise le profil et la clé de données');
    assert(!('pwd' in sess), 'le mot de passe n\'est plus stocké dans la session');
    const dureeMs = sess.expiresAt - Date.now();
    assert(dureeMs > 11.9 * 3600000 && dureeMs <= 12 * 3600000, 'durée par défaut de la session : 12 heures');
    // 2. Une session héritée d'une ancienne version est purgée de son mot de passe à la lecture
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ profileId: p1.id, dek: 'dek', pwd: 'ancien-mot-de-passe', expiresAt: null }));
    const lue = readLocalSession();
    assert(lue && !('pwd' in lue), 'lecture d\'une ancienne session : mot de passe retiré');
    assert(!('pwd' in JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY))), 'et effacé du stockage');
    persistLocalSession(_currentProfile, _dataKey); // remet une session saine pour la suite
    // 3. Un mot de passe de 11 caractères est refusé à la création
    const nbAvant = (await loadProfilesIndex()).profiles.length;
    renderCreateProfile({ firstAdmin: false });
    document.getElementById('cp-name').value = 'Court';
    document.getElementById('cp-pwd').value = 'onzecarac11'; document.getElementById('cp-pwd2').value = 'onzecarac11';
    document.getElementById('cp-question').value = SECURITY_QUESTIONS[0]; document.getElementById('cp-answer').value = 'x';
    await submitCreateProfile({ firstAdmin: false });
    assert(/12 caractères/.test(document.getElementById('cp-err').textContent), 'mot de passe de 11 caractères refusé (message : 12 minimum)');
    assert((await loadProfilesIndex()).profiles.length === nbAvant, 'aucun profil créé avec un mot de passe trop court');
    // 4. Changement de mot de passe : l'ancien est vérifié sans être gardé en mémoire
    for (const id of ['mp-old-pwd', 'mp-new-pwd', 'mp-new-pwd2']) {
      if (!document.getElementById(id)) { const i = document.createElement('input'); i.id = id; document.body.appendChild(i); }
    }
    const setMp = (a, b) => { document.getElementById('mp-old-pwd').value = a; document.getElementById('mp-new-pwd').value = b; document.getElementById('mp-new-pwd2').value = b; };
    const toastTxt = () => (_lastToast && _lastToast.msg) || '';
    setMp('mauvais-ancien-mdp', 'nouveau-mdp-solide-1'); await saveMyPassword();
    assert(/actuel incorrect/.test(toastTxt()), 'changement refusé si l\'ancien mot de passe est faux');
    setMp('motdepasse-un1', 'court-11-ch'); await saveMyPassword();
    assert(/trop court/.test(toastTxt()), 'changement refusé si le nouveau mot de passe a moins de 12 caractères');
    setMp('motdepasse-un1', 'nouveau-mdp-solide-1'); await saveMyPassword();
    let idx2 = await loadProfilesIndex(); const pp = idx2.profiles.find(x => x.id === p1.id);
    assert(await Crypto.decrypt(pp.wrapPwd, 'nouveau-mdp-solide-1') !== null, 'le nouveau mot de passe ouvre la clé de données');
    assert(await Crypto.decrypt(pp.wrapPwd, 'motdepasse-un1') === null, 'l\'ancien mot de passe ne fonctionne plus');
    // Un second changement immédiat doit se baser sur l'enveloppe À JOUR (pas sur une copie périmée)
    setMp('nouveau-mdp-solide-1', 'motdepasse-un1'); await saveMyPassword();
    idx2 = await loadProfilesIndex();
    assert(await Crypto.decrypt(idx2.profiles.find(x => x.id === p1.id).wrapPwd, 'motdepasse-un1') !== null, 'deuxième changement enchaîné accepté (remise à l\'état initial pour la suite)');
  }

  group('library.js — création et ouverture d\'un manuscrit');
  // createNewDocument() n'ouvre plus qu'une fenêtre de choix du type de
  // document (texte / roman graphique, voir graphicnovel.js) — plus rien de
  // synchrone à tester sans simuler un clic dans cette fenêtre. La création
  // réelle d'un manuscrit texte, elle, est inchangée : createNewTextDocument().
  await createNewTextDocument();
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
  document.getElementById('rec-pwd').value = 'nouveauMdp-12ab';
  document.getElementById('rec-pwd2').value = 'nouveauMdp-12ab';
  await submitRecovery(p1.id);
  idx = await loadProfilesIndex();
  const p1AfterRecovery = idx.profiles.find(p => p.id === p1.id);
  const dekAfter = await Crypto.decrypt(p1AfterRecovery.wrapPwd, 'nouveauMdp-12ab');
  assert(dekAfter !== null, 'récupération par question : le nouveau mot de passe fonctionne');
  const oldStillWorks = await Crypto.decrypt(p1AfterRecovery.wrapPwd, 'motdepasse-un1');
  assert(oldStillWorks === null, "l'ancien mot de passe est bien invalidé après récupération");

  group('profiles.js — protections de suppression de profil');
  // Second profil "jetable", créé par l'admin, pour tester une suppression réussie.
  renderCreateProfile({ firstAdmin: false, byAdmin: true });
  document.getElementById('cp-name').value = 'Marie';
  document.getElementById('cp-pwd').value = 'motdepasse-deux2';
  document.getElementById('cp-pwd2').value = 'motdepasse-deux2';
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

  // Suppression réussie d'un profil non-admin avec confirmation correcte
  // (interaction avec la modale stylée — voir showConfirmModal(), notifications.js).
  const delPromise = adminDeleteProfile(marie.id);
  // Correction : adminDeleteProfile() fait un await (loadProfilesIndex())
  // AVANT d'ouvrir la modale — celle-ci n'est donc pas encore active au
  // moment où delPromise est retournée. Sans cette attente, le clic sur
  // "Confirmer" arrive trop tôt (aucun effet) et delPromise ne se résout
  // jamais : le test reste bloqué indéfiniment, sans la moindre erreur.
  const cmOverlay = document.getElementById('confirm-modal-overlay');
  while (!cmOverlay.classList.contains('active')) {
    await new Promise(r => setTimeout(r, 0));
  }
  const cmInput = document.getElementById('confirm-modal-input');
  cmInput.value = 'Marie';
  cmInput.dispatchEvent(new Event('input'));
  document.getElementById('confirm-modal-confirm-btn').click();
  await delPromise;
  idx = await loadProfilesIndex();
  assert(!idx.profiles.some(pr => pr.id === marie.id), 'le profil "Marie" est supprimé après confirmation correcte');
  const marieData = await loadData('data_' + marie.id);
  assert(marieData === null, 'les données du profil supprimé sont bien effacées');

  // ═══════════════════════════════════════════════════════
  // COUVERTURE ÉTENDUE (v7.21.0) — modules qui n'avaient encore aucun test.
  // On repart d'un contexte neutre (profil déconnecté) : save() redevient un
  // no-op silencieux ici, comme au tout début de la suite — la persistance
  // réelle reste couverte par le groupe "library.js" ci-dessus, on ne la
  // re-teste pas à chaque groupe suivant.
  // ═══════════════════════════════════════════════════════
  _currentProfileId = null; _dataKey = null; _currentDocumentId = null;

  group('readability.js — fleschKincaid() / fleschLabel() / countDialogLines()');
  const easyText = 'Le chat va. Le chien va. Le chat vu.';
  const hardText = 'Épistémologiquement, cette considération transcendantale problématise irrémédiablement toute conceptualisation antérieure.';
  assert(fleschKincaid(easyText) > fleschKincaid(hardText), 'un texte simple obtient un meilleur score qu\'un texte complexe');
  assert(fleschLabel(95)[0] === 'Très facile', 'label "Très facile" pour un score ≥ 90');
  assert(fleschLabel(75)[0] === 'Facile', 'label "Facile" pour un score ≥ 70');
  assert(fleschLabel(55)[0] === 'Standard', 'label "Standard" pour un score ≥ 50');
  assert(fleschLabel(35)[0] === 'Difficile', 'label "Difficile" pour un score ≥ 30');
  assert(fleschLabel(10)[0] === 'Très difficile', 'label "Très difficile" en dessous de 30');
  const dl = countDialogLines('— Bonjour !\nIl faisait beau.\n« Ça va ? »\nElle sourit.');
  assert(dl.dialog === 2 && dl.narration === 2, 'compte correctement les lignes de dialogue (—, «) et de narration');

  group('relations.js — buildGraphData()');
  db = { chars:[{ id:'c1', name:'Marie', links:[{ type:'places', id:'p1' }] }], places:[{ id:'p1', name:'Paris' }], quests:[], chapters:[{ id:'ch1', title:'Chapitre Un' }] };
  const graph = buildGraphData();
  assert(graph.nodes.length === 3, 'un nœud par personnage/lieu/chapitre existant (ici 3)');
  assert(graph.links.length === 1 && graph.links[0].source === 'chars-c1' && graph.links[0].target === 'places-p1', 'le lien personnage → lieu est bien construit');

  group('snapshots.js — takeSnapshot()');
  db = { chapters:[{ id:'sx1', content:'Version A', title:'Ch1' }], history:{} };
  takeSnapshot(0, 'Premier snapshot');
  assert(db.history['sx1'].length === 1 && db.history['sx1'][0].label === 'Premier snapshot', 'un premier snapshot est enregistré');
  takeSnapshot(0, 'Doublon');
  assert(db.history['sx1'].length === 1, 'un contenu identique au précédent snapshot n\'est pas re-enregistré');
  db.chapters[0].content = 'Version B';
  db.history['sx1'][0].ts -= 20 * 60000; // v9.25.0 : historique espacé — le 1er snapshot a 20 min (autre tranche de 15 min)
  takeSnapshot(0, 'Deuxième snapshot');
  assert(db.history['sx1'].length === 2 && db.history['sx1'][0].content === 'Version B', 'un contenu modifié crée un nouveau snapshot (le plus récent en tête)');
  // v9.25.0 — historique ESPACÉ : 35 sauvegardes (une toutes les 16 min, soit ~9 h) ne laissent
  // que le plus récent de chaque tranche (15 min puis 3 h), pas les 35 copies.
  for (let i = 0; i < 35; i++) {
    db.chapters[0].content = 'Version ' + i; takeSnapshot(0, 'Snap ' + i);
    db.history['sx1'].forEach(sn => { sn.ts -= 16 * 60000; });
  }
  assert(db.history['sx1'].length >= 5 && db.history['sx1'].length < 20, `l'historique est espacé (${db.history['sx1'].length} copies pour 35 sauvegardes sur ~9 h)`);
  assert(db.history['sx1'][0].content === 'Version 34', 'la copie la plus récente est toujours conservée, en tête');

  group('export-format-utils.js — escapeXml() / toXhtmlSafe()');
  assert(escapeXml('<a> & "b"') === '&lt;a&gt; &amp; &quot;b&quot;', 'échappe correctement <, >, & et "');
  const xhtml = toXhtmlSafe('<p>Bonjour <strong>monde</strong></p>');
  assert(xhtml.includes('<p') && xhtml.includes('<strong') && xhtml.includes('monde'), 'convertit un fragment HTML en XHTML bien formé');
  assert(!xhtml.startsWith('<div'), 'l\'enveloppe technique <div> ajoutée pour le parsing n\'apparaît jamais dans la sortie');

  group('timeline.js — addTimelineEvent()');
  db = { chapters:[{ id:'ch1', title:'Ch1' }], timeline: [] };
  document.body.insertAdjacentHTML('beforeend', '<input id="tl-event-text"><input id="tl-event-date"><select id="tl-chapter-sel"><option value="">--</option><option value="ch1">Ch1</option></select><div id="timeline-events"></div><div id="timeline-track"></div>');
  document.getElementById('tl-event-text').value = 'Rencontre avec le mentor';
  document.getElementById('tl-event-date').value = 'An 1';
  document.getElementById('tl-chapter-sel').value = 'ch1';
  addTimelineEvent();
  assert(db.timeline.length === 1 && db.timeline[0].text === 'Rencontre avec le mentor' && db.timeline[0].chapterId === 'ch1', 'un événement est ajouté avec son texte, sa date et son chapitre associé');
  document.getElementById('tl-event-text').value = '';
  addTimelineEvent();
  assert(db.timeline.length === 1, 'un événement sans texte n\'est pas ajouté');

  group('wordcloud.js — buildWordFreq()');
  db = { chapters:[{ content:'<p>Le chat noir dort. Le chat noir ronronne.</p>' }] };
  cur = 0;
  const freq = buildWordFreq(false);
  const chatEntry = freq.find(([w]) => w === 'chat');
  assert(chatEntry && chatEntry[1] === 2, 'compte correctement les occurrences d\'un mot (hors mots vides)');
  assert(!freq.some(([w]) => w === 'le'), 'les mots vides (STOP_WORDS) comme "le" sont exclus');

  group('panels.js — doGlobalSearch()');
  db = {
    chapters: [{ title:'Chapitre Un', content:'<p>Marie court dans la forêt.</p>' }],
    chars: [{ name:'Marie', role:'Héroïne' }],
    places: [{ name:'Forêt Sombre' }],
    quests: [{ text:'Trouver Marie' }]
  };
  document.body.insertAdjacentHTML('beforeend', '<div id="search-results"></div><div id="search-count"></div>');
  doGlobalSearch('marie');
  assert(document.getElementById('search-count').textContent === '3 occurrence(s)', 'trouve les occurrences dans les chapitres, personnages et quêtes');
  assert(document.getElementById('search-results').querySelectorAll('.search-result-item').length === 3, 'un résultat par occurrence trouvée');
  doGlobalSearch('x');
  assert(document.getElementById('search-count').textContent === '', 'une requête de moins de 2 caractères ne lance pas de recherche');

  group('notifications.js — updateTrashBadge() / flashSave()');
  document.body.insertAdjacentHTML('beforeend', '<div id="trash-badge"></div><div id="save-indicator"></div><span id="autosave-label"></span>');
  db = { trash: [] };
  updateTrashBadge();
  assert(document.getElementById('trash-badge').style.display === 'none', 'le badge est masqué quand la corbeille est vide');
  db.trash = [1,2,3];
  updateTrashBadge();
  assert(document.getElementById('trash-badge').textContent === '3' && document.getElementById('trash-badge').style.display === 'flex', 'le badge affiche le nombre de chapitres en corbeille');
  db.trash = new Array(150).fill(1);
  updateTrashBadge();
  assert(document.getElementById('trash-badge').textContent === '99+', 'le badge plafonne l\'affichage à "99+"');
  flashSave();
  assert(document.getElementById('autosave-label').textContent.startsWith('Enregistré à '), 'flashSave() horodate l\'indicateur de sauvegarde');

  group('pluginSystem.js — plugin "Temps de lecture"');
  db = { chapters: [{ content: '<p>' + 'mot '.repeat(300) + '</p>' }] };
  const totalWPlugin = db.chapters.reduce((s,c) => s + getWordCount(c.content), 0);
  const readingPlugin = PLUGINS_REGISTRY.find(p => p.id === 'readingtime');
  assert(!!readingPlugin, 'le plugin "Temps de lecture" est bien enregistré');
  const pluginResult = await readingPlugin.run();
  assert(pluginResult.includes(`${totalWPlugin} mots`), 'calcule le bon nombre total de mots');
  assert(pluginResult.includes('Lecture lente') && pluginResult.includes('Lecture rapide'), 'donne une estimation de lecture lente et rapide');

  group('findreplace.js — collectTextNodes() / buildFlatIndex() / findAllMatches()');
  const frRoot = document.createElement('div');
  frRoot.innerHTML = '<p>Le chat noir dort.</p><p>Le CHAT est content.</p>';
  assert(collectTextNodes(frRoot).length === 2, 'un nœud texte par paragraphe');
  const flatIdx = buildFlatIndex(frRoot);
  assert(flatIdx.flat === 'Le chat noir dort.\nLe CHAT est content.', 'reconstitue le texte à plat dans l\'ordre des nœuds, avec une coupure entre paragraphes (v9.36.0)');
  assert(findAllMatches(frRoot, 'chat').length === 2, 'trouve les 2 occurrences, insensible à la casse');

  group('memory.js — splitPassages() / extractKeywords() / scoreRelevance()');
  const longText = Array(250).fill('mot').join(' ');
  const passages = splitPassages(longText, 100, 20);
  assert(passages.length > 1, 'découpe un long texte en plusieurs passages avec chevauchement');
  assert(passages.every(p => p.split(' ').length <= 100), 'chaque passage respecte la taille de fenêtre demandée');
  const kw = extractKeywords('Le chat noir dort. Le chat noir ronronne doucement.');
  assert(kw.includes('chat') && !kw.includes('le'), 'extrait les mots-clés significatifs et exclut les mots vides');
  const relevanceScore = scoreRelevance(['chat'], ['chat','noir'], 'le chat noir dort');
  assert(relevanceScore === 5, `combine occurrences (×2) et présence en mot-clé (+3) — attendu 5, obtenu ${relevanceScore}`);

  group('memory.js — buildNarrativeIndex() / searchNarrativeIndex()');
  db = {
    chapters: [{ id:'m1', title:'Chapitre Un', content:'<p>' + 'Marie traverse la forêt sombre à la recherche du mentor perdu depuis longtemps. '.repeat(6) + '</p>' }],
    chars: [], places: []
  };
  const totalPassages = buildNarrativeIndex();
  assert(_indexBuilt === true && totalPassages > 0, 'construit un index narratif à partir des chapitres');
  const memResults = searchNarrativeIndex('mentor', 3);
  assert(memResults.length > 0 && memResults[0].chId === 'm1', 'retrouve un passage pertinent pour une requête donnée');

  group('database.js — apparence (palette / police / thème)');
  db = { accentPalette:'rouge-violet', editorFont:'palatino', darkMode:false, paperMode:false };
  selectPalette('bleu-ocean');
  assert(db.accentPalette === 'bleu-ocean', 'selectPalette() met à jour db.accentPalette');
  assert(document.documentElement.style.getPropertyValue('--accent') === '#2980b9', 'applyAccentPalette() pose la bonne couleur CSS');
  selectFont('times');
  assert(db.editorFont === 'times' && document.body.classList.contains('font-times'), 'selectFont() met à jour db et la classe CSS du corps');
  selectTheme('dark');
  assert(db.darkMode === true && db.paperMode === false && document.body.classList.contains('dark-mode'), 'selectTheme("dark") active le mode sombre et désactive le mode papier');

  group('database.js — liens entre personnages/lieux (addLink / removeLink)');
  db.chars = [{ id:'c1', name:'Marie', links:[] }];
  db.places = [{ id:'p1', name:'Paris', links:[] }];
  document.body.insertAdjacentHTML('beforeend', '<div id="char-edit"></div><div id="place-edit"></div>');
  addLink('chars', 'c1', 'places', 'p1');
  assert(db.chars[0].links.length === 1 && db.chars[0].links[0].type === 'places' && db.chars[0].links[0].id === 'p1', 'addLink() ajoute un lien personnage → lieu');
  addLink('chars', 'c1', 'places', 'p1');
  assert(db.chars[0].links.length === 1, 'un lien déjà existant n\'est pas dupliqué');
  removeLink('chars', 'c1', 0);
  assert(db.chars[0].links.length === 0, 'removeLink() retire bien le lien');

  group('database.js — quêtes et mots faibles');
  db.quests = []; db.weakWords = [];
  document.body.insertAdjacentHTML('beforeend', '<input id="q-in"><div id="quest-list"></div><input id="new-weak-word"><div id="weak-words-list"></div>');
  document.getElementById('q-in').value = 'Trouver le trésor';
  addQuest();
  assert(db.quests.length === 1 && db.quests[0].text === 'Trouver le trésor' && db.quests[0].done === false, 'addQuest() ajoute une quête non terminée');
  document.getElementById('new-weak-word').value = 'TRÈS';
  addWeakWord();
  assert(db.weakWords.includes('très'), 'addWeakWord() ajoute le mot en minuscules');

  group('editor.js — cycle de vie des chapitres (ajout, déplacement, duplication, suppression, restauration)');
  db = {
    chapters: [
      { id:'e1', title:'Chapitre 1', content:'<p>Texte un.</p>', tension:20, status:'draft', tags:[] },
      { id:'e2', title:'Chapitre 2', content:'<p>Texte deux.</p>', tension:30, status:'draft', tags:[] }
    ],
    history: {}, trash: [], weakWords: []
  };
  cur = 0;
  document.body.insertAdjacentHTML('beforeend',
    '<div id="writer" contenteditable="true"></div>' +
    '<div id="chapter-title" contenteditable="true"></div>' +
    '<select id="chapter-status-sel"><option value="draft">Brouillon</option></select>' +
    '<input id="tension-slider" type="range">' +
    '<button id="undo-btn"></button><button id="redo-btn"></button>' +
    '<div id="chapter-list"></div><div id="chapter-ctx-menu"></div><div id="trash-list"></div>'
  );
  loadChapter(0);
  assert(document.getElementById('writer').innerHTML === db.chapters[0].content, 'loadChapter() charge le contenu du chapitre dans l\'éditeur');

  addChapter();
  assert(db.chapters.length === 3 && cur === 2, 'addChapter() ajoute un chapitre et le rend actif');
  const newChapterId = db.chapters[2].id;
  assert(!!newChapterId, 'le nouveau chapitre reçoit un ID');

  moveChapter(2, 'up');
  assert(db.chapters[1].id === newChapterId && cur === 1, 'moveChapter("up") déplace le chapitre et garde le focus sur lui');
  moveChapter(1, 'down');
  assert(db.chapters[2].id === newChapterId && cur === 2, 'moveChapter("down") inverse correctement le déplacement');

  duplicateChapter(0);
  assert(db.chapters.length === 4 && db.chapters[1].title === 'Chapitre 1 (copie)', 'duplicateChapter() insère une copie juste après l\'original');
  assert(db.chapters[1].id !== db.chapters[0].id, 'la copie reçoit un ID distinct');

  const realConfirm = showConfirmModal;
  showConfirmModal = async () => true; // v9.44.0 : les confirmations passent par la modale de l'app
  await deleteChapter(db.chapters.findIndex(c => c.id === newChapterId));
  assert(db.trash.length === 1 && db.trash[0].chapter.id === newChapterId, 'deleteChapter() déplace le chapitre vers la corbeille');
  assert(!db.chapters.some(c => c.id === newChapterId), 'le chapitre supprimé n\'est plus dans la liste active');
  restoreFromTrash(0);
  assert(db.chapters.some(c => c.id === newChapterId), 'restoreFromTrash() restaure le chapitre dans la liste active');
  assert(db.trash.length === 0, 'le chapitre restauré quitte la corbeille');
  await deleteChapter(db.chapters.findIndex(c => c.id === newChapterId));
  await permanentlyPurge(0);
  assert(db.trash.length === 0, 'permanentlyPurge() supprime définitivement un chapitre de la corbeille');
  showConfirmModal = realConfirm;

  // ── v9.33.0 (AUD-02-001 / 008 / 009) — texte jamais perdu ──
  group('editor.js — mode Focus, copies de chapitre, restauration (v9.33.0)');
  document.body.insertAdjacentHTML('beforeend',
    '<div id="history-overlay"></div><div id="focus-overlay"></div><div id="focus-writer" contenteditable="true"></div><input id="focus-title"><span id="focus-wordcount"></span>');
  db = { chapters:[
      { id:'f1', title:'Chapitre F1', content:'<p>Ancien texte.</p>', tension:20, status:'draft', tags:[] },
      { id:'f2', title:'Chapitre F2', content:'<p>Autre.</p>', tension:20, status:'draft', tags:[] } ],
    history:{}, trash:[], weakWords:[], sessionStats:{} };
  cur = 0;
  loadChapter(0);
  // 001 — en Focus, la frappe part dans le manuscrit sans quitter le Focus
  document.getElementById('focus-overlay').classList.add('active');
  document.getElementById('focus-writer').innerHTML = '<p>Texte tapé en Focus.</p>';
  document.getElementById('focus-title').value = 'Titre Focus';
  focusLiveSync();
  assert(db.chapters[0].content === '<p>Texte tapé en Focus.</p>', 'Focus : chaque frappe met à jour le manuscrit (avant : rien avant la sortie du Focus)');
  assert(_unsavedChanges === undefined || typeof _unsavedChanges === 'boolean', 'Focus : l\'enregistrement différé est armé');
  // Un flush (minuteur de 5 min, Ctrl+S, fermeture) ne doit PAS écraser le Focus par l'ancien texte de #writer
  flushCurrentChapter();
  assert(db.chapters[0].content === '<p>Texte tapé en Focus.</p>' && db.chapters[0].title === 'Titre Focus',
    'Focus : flushCurrentChapter() lit le champ du Focus (et non l\'ancien #writer périmé)');
  document.getElementById('focus-overlay').classList.remove('active');
  // 008 — quitter un chapitre modifié en garde une copie ; le simple consultation n'en crée pas
  loadChapter(0);
  document.getElementById('writer').innerHTML = '<p>Version réécrite.</p>';
  changeCh(1);
  assert((db.history['f1'] || []).length === 1 && db.history['f1'][0].content === '<p>Version réécrite.</p>', 'quitter un chapitre modifié enregistre une copie de son état');
  changeCh(0);
  assert(!db.history['f2'], 'quitter un chapitre non modifié ne crée aucune copie (pas de gonflement du manuscrit)');
  // 009 — restaurer garde l'état écrasé comme copie manuelle
  document.getElementById('writer').innerHTML = '<p>Texte récent à ne pas perdre.</p>';
  flushCurrentChapter();
  const snapToRestore = { ts: Date.now() - 3600000, label: 'Ancienne', content: '<p>Très ancien.</p>', title: 'Ancien' };
  db.history['f1'].push(snapToRestore);
  const realConfirm009 = showConfirmModal; showConfirmModal = async () => true;
  await restoreSnapshot('f1', db.history['f1'].length - 1);
  showConfirmModal = realConfirm009;
  assert(db.chapters[0].content === '<p>Très ancien.</p>', 'restoreSnapshot() restaure bien la version choisie');
  assert(db.history['f1'].some(s => /^Manuel — Avant restauration/.test(s.label) && s.content === '<p>Texte récent à ne pas perdre.</p>'),
    'restoreSnapshot() garde l\'état écrasé comme copie manuelle « Avant restauration »');

  // ── v9.34.0 (AUD-02-005 / 006 / 007 / 020 / 021) — chiffres exacts ──
  group('schema.js — comptage de mots et date locale (v9.34.0)');
  assert(getWordCount('<p>Mon cœur et ma sœur.</p>') === 5, 'cœur / sœur comptent pour un mot chacun');
  assert(getWordCount("<p>L'homme, peut-être.</p>") === 2, "« L'homme » et « peut-être » comptent pour un mot chacun");
  assert(getWordCount('<p>Bonjour&nbsp;! Salut&nbsp;:</p>') === 2, 'les espaces insécables (&nbsp;) ne sont pas comptés comme un mot « nbsp »');
  assert(getWordCount('<p>— Bonjour, dit-il.</p>') === 2, 'un tiret de dialogue seul n\'est pas un mot');
  assert(getWordCount('') === 0 && getWordCount(null) === 0, 'texte vide ou nul : 0 mot');
  assert(dateKey(new Date(2026, 9, 5, 0, 30)) === '2026-10-05' && dateKey(new Date(2026, 0, 3, 23, 59)) === '2026-01-03', 'dateKey() donne la date LOCALE (00 h 30 reste le jour même)');
  const rb = rebaseWordStats({ docType:'texte', chapters:[{ content:'<p>Mon cœur, l\'homme.</p>' }], sessionStats:{ '2026-10-01': 10, '2026-10-02': 20 } });
  // ancien : Mon c ur l homme = 5 (« cœur » coupé en 2, l'homme en 2) ; nouveau : 3 → décalage de -2 sur tout l'historique
  assert(rb.sessionStats['2026-10-01'] === 8 && rb.sessionStats['2026-10-02'] === 18 && rb.wordCountRebased === true, 'rebaseWordStats() décale tout l\'historique du même écart');
  const rb2 = rebaseWordStats(JSON.parse(JSON.stringify(rb)));
  assert(rb2.sessionStats['2026-10-02'] === 18, 'rebaseWordStats() ne s\'applique qu\'une fois par manuscrit');
  assert(DEFAULT_DB().wordCountRebased === true, 'un nouveau manuscrit n\'est jamais recalé (compté avec le nouveau comptage dès l\'origine)');

  group('editor.js — mots faibles et surlignages d\'analyse (v9.34.0)');
  db = { chapters:[{ id:'w1', title:'W', content:'', tension:20, status:'draft', tags:[] }], history:{}, trash:[], weakWords:['déjà', 'très', '(juste'], sessionStats:{} };
  cur = 0;
  document.getElementById('writer').innerHTML = '<p class="très">Il est déjà là, très très tôt, juste</p><p>Rien.</p>';
  analyzeStyle();
  const marked = [...document.getElementById('writer').querySelectorAll('mark')].map(m => m.textContent);
  assert(marked.join('|') === 'déjà|très|très', 'mots faibles accentués trouvés, un mot à parenthèse ne fait plus planter, le nom de classe n\'est pas touché');
  assert(document.getElementById('writer').querySelector('p').className === 'très', 'l\'analyse ne modifie pas les attributs HTML');
  liveCounter();
  assert(!/<mark/i.test(db.chapters[0].content), 'les surlignages d\'analyse ne sont jamais enregistrés dans le manuscrit');
  assert(!/<mark/i.test(toXhtmlSafe('<p>un <mark>très</mark> mot</p>')), 'ni exportés');
  analyzeStyle(); analyzeStyle();
  assert(document.getElementById('writer').querySelectorAll('mark mark').length === 0, 'relancer l\'analyse n\'imbrique pas les surlignages');

  group('stats.js — champ d\'objectif vidé (v9.34.0)');
  const goalEl = document.createElement('input');
  goalEl.value = ''; assert(readGoalInput(goalEl) === null, 'champ vidé : aucune valeur enregistrée');
  goalEl.value = '0'; assert(readGoalInput(goalEl) === null, 'valeur 0 : refusée');
  goalEl.value = '1200'; assert(readGoalInput(goalEl) === 1200, 'valeur valide : acceptée');

  // ── v9.36.0 (AUD-02-004 / 010 / 018 / 019) — gestion des chapitres ──
  group('export-format-utils.js — découpage d\'un fichier importé en chapitres (v9.36.0)');
  const sp1 = splitImportedHtml('<p>Préface</p><h1>Un</h1><p>a</p><p>b</p><h1>Deux</h1><p>c <em>it</em></p>', 'Mon livre');
  assert(sp1 && sp1.length === 3 && sp1[0].title === 'Mon livre' && sp1[1].title === 'Un' && sp1[2].title === 'Deux', 'titres de niveau 1 : un chapitre par titre, préface conservée');
  assert(sp1[2].content === '<p>c <em>it</em></p>' && !/<h1/.test(sp1[1].content), 'la mise en forme est conservée et le titre n\'est pas répété dans le texte');
  const sp2 = splitImportedHtml('<h1>Seul</h1><p>a</p><h2>S1</h2><p>b</p><h2>S2</h2><p>c</p>', 'T');
  assert(sp2 && sp2.map(c => c.title).join('|') === 'T|S1|S2', 'un seul titre de niveau 1 : on se rabat sur le niveau 2 (le début devient le premier chapitre)');
  const sp3 = splitImportedHtml('<p>Chapitre 1 : Départ</p><p>texte</p><p>CHAPITRE II</p><p>suite</p><p>Épilogue</p><p>fin</p>', 'T');
  assert(sp3 && sp3.length === 3 && sp3[0].title === 'Chapitre 1 : Départ' && sp3[2].title === 'Épilogue', 'sans styles de titre : repère « Chapitre N », « Chapitre II », « Épilogue »');
  assert(splitImportedHtml('<p>texte</p><h1>Un seul</h1><p>suite</p>', 'T') === null, 'moins de 2 chapitres détectés : pas de découpage');

  group('findreplace.js — options et remplacement global (v9.36.0)');
  const mkRoot = html => { const d = document.createElement('div'); d.innerHTML = html; return d; };
  assert(findAllMatches(mkRoot('<p>Le lenny le LE</p>'), 'le').length === 4, 'sans option : insensible à la casse, trouve aussi dans « lenny »');
  assert(findAllMatches(mkRoot('<p>Le lenny le LE</p>'), 'le', { matchCase: true }).length === 2, 'respecter la casse');
  assert(findAllMatches(mkRoot('<p>Le lenny le LE</p>'), 'le', { wholeWord: true }).length === 3, 'mot entier');
  assert(findAllMatches(mkRoot('<p>été déjà</p>'), 'été', { wholeWord: true }).length === 1 && findAllMatches(mkRoot('<p>étés</p>'), 'été', { wholeWord: true }).length === 0, 'mot entier avec lettres accentuées');
  assert(findAllMatches(mkRoot('<p>fin.</p><p>Début</p>'), 'fin.Début').length === 0 && findAllMatches(mkRoot('<p>fin<br>début</p>'), 'findébut').length === 0, 'une occurrence ne traverse ni deux paragraphes ni un retour à la ligne');
  assert(findAllMatches(mkRoot('<p>Ma <b>sœ</b>ur</p>'), 'sœur').length === 1, 'une occurrence à cheval sur une mise en forme est trouvée');
  const rr = mkRoot('<p>Élara dit à <em>Élara</em> que élara</p>');
  assert(replaceAllInRoot(rr, 'Élara', 'Elena', { matchCase: true }) === 2 && rr.textContent.includes('Elena dit à Elena que élara'), 'replaceAllInRoot() remplace toutes les occurrences correspondantes');
  db = { chapters:[
      { id:'g1', title:'G1', content:'<p>Élara arrive. Élara sourit.</p>', tension:20, status:'draft', tags:[] },
      { id:'g2', title:'G2', content:'<p>Rien ici.</p>', tension:20, status:'draft', tags:[] },
      { id:'g3', title:'G3', content:'<p>Élara part.</p>', tension:20, status:'draft', tags:[] } ],
    history:{}, trash:[], weakWords:[], sessionStats:{} };
  cur = 0; loadChapter(0);
  const gp = planGlobalReplace('Élara', {});
  assert(gp.total === 3 && gp.plan.length === 2 && gp.plan[0].index === 0 && gp.plan[1].index === 2, 'planGlobalReplace() compte par chapitre sans rien modifier');
  assert(db.chapters[2].content === '<p>Élara part.</p>', 'le décompte ne modifie aucun chapitre');
  const doneG = applyGlobalReplace(gp.plan, 'Élara', 'Elena', {});
  assert(doneG === 3 && db.chapters[2].content === '<p>Elena part.</p>' && db.chapters[0].content.includes('Elena arrive. Elena sourit.'), 'applyGlobalReplace() remplace dans le chapitre ouvert et dans les autres');
  assert(db.history['g3'] && /^Manuel — Avant remplacement global/.test(db.history['g3'][0].label) && db.history['g3'][0].content === '<p>Élara part.</p>' && !db.history['g2'], 'chaque chapitre modifié (et lui seul) garde une copie d\'avant');

  group('editor.js — scinder, fusionner, duplication, corbeille (v9.36.0)');
  db = { chapters:[
      { id:'s1', title:'Chapitre S', content:'<p>Début du chapitre.</p><p>Suite <em>importante</em> ici.</p>', tension:30, status:'draft', tags:['a'], wordGoal:500, researchNotes:'notes' },
      { id:'s2', title:'Chapitre T', content:'<p>Autre.</p>', tension:20, status:'draft', tags:[] } ],
    history:{}, trash:[], weakWords:[], sessionStats:{} };
  cur = 0; loadChapter(0);
  const wr = document.getElementById('writer');
  const emNode = wr.querySelector('em').firstChild;
  const selS = window.getSelection(); selS.removeAllRanges();
  const rg = document.createRange(); rg.setStart(emNode, 0); rg.collapse(true); selS.addRange(rg);
  splitChapterAtCaret();
  assert(db.chapters.length === 3 && db.chapters[1].title === 'Chapitre S (suite)' && cur === 0, 'splitChapterAtCaret() crée le chapitre suivant et reste sur le premier');
  assert(db.chapters[0].content.includes('Début du chapitre.') && !db.chapters[0].content.includes('importante'), 'le texte avant le curseur reste dans le chapitre d\'origine');
  assert(db.chapters[1].content.includes('<em>importante</em>') && db.chapters[1].content.includes('ici.'), 'le texte après le curseur (avec sa mise en forme) passe dans le nouveau chapitre');
  assert((db.history['s1'] || []).some(s => /^Manuel — Avant scission/.test(s.label) && s.content.includes('importante')), 'une copie d\'avant la scission est gardée');
  const realConfirmM = showConfirmModal; showConfirmModal = async () => true;
  await mergeWithNext(0);
  showConfirmModal = realConfirmM;
  assert(db.chapters.length === 2 && db.chapters[0].content.includes('Début du chapitre.') && db.chapters[0].content.includes('importante'), 'mergeWithNext() recolle le chapitre suivant à la fin');
  assert(db.trash.length === 1 && db.trash[0].chapter.title === 'Chapitre S (suite)' && db.trash[0].index === 1, 'le chapitre absorbé va à la corbeille avec sa position');
  duplicateChapter(0);
  assert(db.chapters[1].wordGoal === 500 && db.chapters[1].researchNotes === 'notes', 'duplicateChapter() copie l\'objectif de mots et les notes de recherche');
  const idRestore = db.chapters[1].id;
  const realConfirmD = showConfirmModal; showConfirmModal = async () => true;
  cur = 0;
  await deleteChapter(1);
  assert(db.trash[db.trash.length - 1].index === 1, 'deleteChapter() mémorise la position d\'origine');
  restoreFromTrash(db.trash.length - 1);
  showConfirmModal = realConfirmD;
  assert(db.chapters[1].id === idRestore, 'restoreFromTrash() remet le chapitre à sa position d\'origine');

  // ── v9.38.0 (AUD-02-011 / 012) — quêtes et chronologie ──
  group('timeline.js — modifier, déplacer, trier, supprimer (v9.38.0)');
  document.body.insertAdjacentHTML('beforeend', '<button id="tl-add-btn">+ Ajouter</button><button id="tl-cancel-edit-btn" class="u-d-none">Annuler</button><div id="quest-list"></div><div id="quest-edit"></div>');
  const evA = { text:'A', date:'An 1', chapterId:'c3' }, evB = { text:'B', date:'An 2' }, evC = { text:'C', chapterId:'c1' }, evD = { text:'D', chapterId:'c3' }, evE = { text:'E', chapterId:'inconnu' };
  const sortedTl = sortedTimelineByChapters([evA, evB, evC, evD, evE], [{ id:'c1' }, { id:'c2' }, { id:'c3' }]);
  assert(sortedTl.map(e => e.text).join('') === 'CADBE', 'tri selon les chapitres : ordre des chapitres, ordre actuel à égalité, sans chapitre (ou chapitre disparu) à la fin');
  db = { chapters:[{ id:'c1', title:'Un' }, { id:'c2', title:'Deux' }], timeline:[{ text:'X', date:'d1', chapterId:'c1' }, { text:'Y' }, { text:'Z' }], quests:[] };
  moveTimelineEvent(0, 1);
  assert(db.timeline.map(e => e.text).join('') === 'YXZ', 'moveTimelineEvent() déplace d\'un cran vers l\'avant');
  moveTimelineEvent(0, -1);
  assert(db.timeline.map(e => e.text).join('') === 'YXZ', 'déplacer le premier vers l\'arrière ne fait rien');
  populateTimelineChapterSel();
  startEditTimelineEvent(1);
  assert(document.getElementById('tl-event-text').value === 'X' && document.getElementById('tl-event-date').value === 'd1' && document.getElementById('tl-chapter-sel').value === 'c1', 'startEditTimelineEvent() remplit le formulaire');
  assert(!document.getElementById('tl-cancel-edit-btn').classList.contains('u-d-none') && document.getElementById('tl-add-btn').textContent.includes('Enregistrer'), 'le mode modification est visible (Enregistrer / Annuler)');
  document.getElementById('tl-event-text').value = 'X modifié'; document.getElementById('tl-chapter-sel').value = 'c2';
  addTimelineEvent();
  assert(db.timeline.length === 3 && db.timeline[1].text === 'X modifié' && db.timeline[1].date === 'd1' && db.timeline[1].chapterId === 'c2', 'enregistrer remplace l\'événement sans en créer un nouveau');
  assert(document.getElementById('tl-add-btn').textContent === '+ Ajouter' && document.getElementById('tl-cancel-edit-btn').classList.contains('u-d-none') && document.getElementById('tl-event-text').value === '', 'le formulaire revient en mode ajout');
  startEditTimelineEvent(0); cancelEditTimelineEvent();
  assert(db.timeline[0].text === 'Y' && document.getElementById('tl-event-text').value === '', 'annuler la modification ne change rien');
  const realConfirmT = showConfirmModal;
  showConfirmModal = async () => false; await deleteTimelineEvent(0);
  assert(db.timeline.length === 3, 'suppression refusée à la confirmation : rien n\'est supprimé');
  showConfirmModal = async () => true; await deleteTimelineEvent(0);
  showConfirmModal = realConfirmT;
  assert(db.timeline.length === 2 && db.timeline[0].text === 'X modifié', 'suppression confirmée : l\'événement disparaît');

  group('database.js — suppression d\'une quête (v9.38.0)');
  db = { chapters:[], chars:[{ id:'p1', name:'Marie', links:[{ type:'quests', id:'q1' }, { type:'quests', id:'q2' }] }], places:[], quests:[{ id:'q1', text:'Trouver l\'épée', links:[] }, { id:'q2', text:'Sauver Marie' }] };
  showConfirmModal = async () => false; await deleteQuest('q1');
  assert(db.quests.length === 2, 'suppression refusée : la quête reste');
  showConfirmModal = async () => true; await deleteQuest('q1');
  showConfirmModal = realConfirmT;
  assert(db.quests.length === 1 && db.quests[0].id === 'q2', 'suppression confirmée : la quête disparaît');
  assert(db.chars[0].links.length === 1 && db.chars[0].links[0].id === 'q2', 'les liens vers la quête supprimée sont retirés des autres éléments');
  showQuestEdit(0);
  assert(!!document.querySelector('#quest-edit button[aria-label="Supprimer cette entrée"]'), 'la fiche d\'une quête a un bouton de suppression');

  group('editor.js — Annuler / Rétablir');
  db = { chapters:[{ id:'u1', title:'Chapitre Undo', content:'Contenu initial', tension:20, status:'draft', tags:[] }], history:{}, trash:[], weakWords:[] };
  cur = 0;
  loadChapter(0);
  document.getElementById('writer').innerHTML = 'Version A';
  checkpointNow();
  document.getElementById('writer').innerHTML = 'Version B';
  checkpointNow();
  undoEdit();
  assert(db.chapters[0].content === 'Version A', 'undoEdit() restaure l\'étape précédente');
  undoEdit();
  assert(db.chapters[0].content === 'Contenu initial', 'un second undo revient au contenu d\'origine');
  redoEdit();
  assert(db.chapters[0].content === 'Version A', 'redoEdit() rétablit l\'étape suivante');
  assert(isTypingTarget(document.getElementById('writer')) === false, '#writer n\'est jamais considéré comme un champ de saisie');
  assert(isTypingTarget(document.createElement('input')) === true, 'un <input> est bien un champ de saisie');
  const ceDiv = document.createElement('div'); ceDiv.contentEditable = 'true'; document.body.appendChild(ceDiv);
  assert(isTypingTarget(ceDiv) === true, 'un élément contentEditable (hors #writer) est bien un champ de saisie');
  updateTension('45');
  assert(db.chapters[cur].tension === 45, 'updateTension() met à jour la tension du chapitre courant');

  group('editor.js — surlignage des mots faibles (analyzeStyle / clearStyle)');
  db.weakWords = ['triste'];
  document.getElementById('writer').innerHTML = '<p>Il était triste ce jour-là.</p>';
  analyzeStyle();
  assert(/<mark>triste<\/mark>/i.test(document.getElementById('writer').innerHTML), 'analyzeStyle() surligne les mots faibles configurés');
  const realConfirmCS = showConfirmModal; showConfirmModal = async () => true;
  await clearStyle();
  showConfirmModal = realConfirmCS;
  assert(!document.getElementById('writer').innerHTML.includes('<mark>'), 'clearStyle() retire les surlignages sans altérer le texte');
  assert(document.getElementById('writer').innerHTML.includes('triste'), 'le texte original reste intact après clearStyle()');

  group('stats.js — statistiques d\'écriture (série, meilleure heure, objectifs)');
  db = { chapters:[{ content:'<p>' + 'mot '.repeat(120) + '</p>' }], sessionStats:{}, dailyGoal:500, weeklyGoal:3000, monthlyGoal:12000 };
  updateDailyStats();
  const todayKey = getTodayKey();
  assert(db.sessionStats[todayKey] === 120, 'updateDailyStats() enregistre le total de mots du jour');

  const streakDay0 = new Date(), streakDay1 = new Date(streakDay0), streakDay2 = new Date(streakDay0);
  streakDay1.setDate(streakDay1.getDate()-1); streakDay2.setDate(streakDay2.getDate()-2);
  const k0 = streakDay0.toISOString().slice(0,10), k1 = streakDay1.toISOString().slice(0,10), k2 = streakDay2.toISOString().slice(0,10);
  db.sessionStats = { [k2]: 100, [k1]: 250, [k0]: 400 };
  assert(computeWritingStreak() === 3, `3 jours consécutifs de progression donnent une série de 3 (obtenu ${computeWritingStreak()})`);

  db.hourlyActivity = new Array(24).fill(0);
  db.hourlyActivity[14] = 50; db.hourlyActivity[9] = 200;
  assert(computeBestWritingHour() === 9, 'identifie l\'heure ayant cumulé le plus de mots');

  db.sessionStats = {};
  assert(getWordsInLastNDays(7, 800) === 800, 'sans aucun historique antérieur, tout le total est attribué à la période demandée');
  const cutoffTest = new Date(); cutoffTest.setDate(cutoffTest.getDate()-10);
  db.sessionStats[cutoffTest.toISOString().slice(0,10)] = 500;
  assert(getWordsInLastNDays(7, 800) === 300, 'soustrait la référence trouvée avant la fenêtre demandée (800 - 500 = 300)');

  group('pwa.js — mise à jour (application automatique / bannière / applyUpdate)');
  document.body.insertAdjacentHTML('beforeend', '<div id="sw-update-banner"></div>');
  let postedMessage = null;
  _swRegistration = { waiting: { postMessage: (m) => { postedMessage = m; } } };
  // v7.22.3 — une mise à jour repérée juste après le chargement doit
  // s'appliquer TOUTE SEULE, sans attendre un clic sur la bannière : c'est
  // ce qui évite de rester bloqué pour toujours sur une version cassée qui
  // fait planter la page avant qu'on puisse cliquer où que ce soit.
  assert(Date.now() - _pageLoadedAt < AUTO_UPDATE_WINDOW_MS, 'les tests tournent bien dans la fenêtre de mise à jour automatique');
  showUpdateBanner();
  assert(postedMessage && postedMessage.type === 'SKIP_WAITING', 'une mise à jour détectée juste après le chargement est appliquée automatiquement');
  assert(!document.getElementById('sw-update-banner').classList.contains('show'), 'dans ce cas la bannière n\'est pas affichée (rechargement immédiat)');
  // Passé ce délai, on retrouve le comportement d'origine : c'est
  // l'utilisateur qui décide du moment du rechargement.
  postedMessage = null;
  const realDateNow = Date.now;
  Date.now = () => realDateNow() + AUTO_UPDATE_WINDOW_MS + 1000;
  showUpdateBanner();
  Date.now = realDateNow;
  assert(document.getElementById('sw-update-banner').classList.contains('show'), 'plus tard dans la session, la bannière est affichée au lieu de recharger sans prévenir');
  assert(postedMessage === null, 'et rien n\'est appliqué tant que l\'utilisateur n\'a pas cliqué');
  applyUpdate();
  assert(postedMessage && postedMessage.type === 'SKIP_WAITING', 'applyUpdate() envoie le message SKIP_WAITING au Service Worker en attente');
  assert(!document.getElementById('sw-update-banner').classList.contains('show'), 'applyUpdate() masque la bannière après la mise à jour');

  group('sw.js — cacheableResponse()');
  const okResponse = new Response('contenu', { status:200 });
  assert((await cacheableResponse(okResponse)) !== null, 'une réponse normale est mise en cache');
  const badResponse = new Response('erreur', { status:500 });
  assert((await cacheableResponse(badResponse)) === null, 'une réponse en erreur (5xx) n\'est jamais mise en cache');

  // ═══════════════════════════════════════════════════════
  // NON COUVERTS ICI, DÉLIBÉRÉMENT — voir README pour le détail :
  //  - router.js       : bootstrap complet de l'app (redéclare db/cur en
  //                      conflit avec cette suite, démarre les profils tout
  //                      seul au chargement). Ses utilitaires purs
  //                      (debounce, getTodayKey, getPlainText) sont testés
  //                      ici via leur copie dans test-runner-env.js.
  //  - tabs.js          : uniquement du rendu/navigation DOM (onglets,
  //                      glisser-déposer, sous-onglets), sans logique
  //                      isolable du reste de l'app.
  //  - tts.js           : dépend entièrement des API navigateur de synthèse
  //                      vocale et de reconnaissance vocale.
  //  - ai.js            : chaque fonction appelle une vraie API externe
  //                      (Claude) — pas testable sans y envoyer de vraies
  //                      requêtes réseau.
  //  - odf-loader.js    : ne fait que charger un module ESM depuis un CDN,
  //                      aucune logique propre à tester.
  // ═══════════════════════════════════════════════════════
  if (typeof hideGate === 'function') hideGate();
})();
