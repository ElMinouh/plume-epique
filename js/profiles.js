'use strict';
// ═══════════════════════════════════════════════════════════════════════
// SYSTÈME MULTI-PROFILS (v7.0.0)
//
// Principe cryptographique — profils étanches :
//   • Chaque profil possède une "clé de données" (DEK) aléatoire qui chiffre
//     SES données, et elle seule. Aucun profil ne peut lire les données d'un
//     autre (pas même l'administrateur).
//   • Cette DEK n'est jamais stockée en clair. Elle est "enveloppée" (chiffrée)
//     séparément par trois secrets, chacun ouvrant la même clé :
//        1. le mot de passe du profil       → wrapPwd
//        2. la réponse à la question secrète → wrapAnswer
//        3. le code de récupération          → wrapCode
//   • Oublier le mot de passe ne perd donc pas les données : on ré-ouvre la
//     DEK via la question OU le code, puis on ré-enveloppe avec un nouveau
//     mot de passe.
//
// L'index des profils (noms, rôles, enveloppes) est stocké en clair sous la
// clé 'profiles'. Les données de chaque profil sous 'data_<id>'.
// ═══════════════════════════════════════════════════════════════════════

const SECURITY_QUESTIONS = [
  'Le nom de votre premier animal de compagnie ?',
  'Votre ville de naissance ?',
  'Le nom de jeune fille de votre mère ?',
  'Le titre de votre film préféré ?',
  'Le nom de votre école primaire ?'
];

// ═══════════════════════════════════════════════════════════════════════
// "RESTER CONNECTÉ" (nouveau) — par profil, réglable dans Mon profil.
// Compromis sécurité assumé sur demande explicite (même principe que le
// token GitHub, voir library.js) : le mot de passe et la DEK du profil sont
// alors gardés en clair dans localStorage sur CET appareil, pendant la durée
// choisie, pour éviter de ressaisir le mot de passe à chaque fermeture du
// site. "Se déconnecter" et "Accueil" effacent toujours cette session
// immédiatement, quelle que soit la durée choisie. Par défaut (profil sans
// réglage explicite) : 24h.
// Valeurs de profil.sessionMinutes : 0 = désactivé, -1 = toujours, sinon
// nombre de minutes.
// ═══════════════════════════════════════════════════════════════════════
const SESSION_STORAGE_KEY = 'plume_auto_session';
// v9.24.0 (audit AUD-01-009) — le MOT DE PASSE n'est plus jamais stocké : il
// ne servait qu'à comparer l'ancien mot de passe lors d'un changement (voir
// saveMyPassword), la clé de données (dek) suffit à rouvrir la session. Les
// sessions déjà enregistrées par une version antérieure sont purgées de leur
// mot de passe dès la première lecture (readLocalSession). Durée par défaut
// ramenée de 24 h à 12 h pour les profils sans réglage explicite.
const DEFAULT_SESSION_MINUTES = 720; // 12h
// v9.24.0 — longueur minimale des NOUVEAUX mots de passe (les anciens, plus
// courts, continuent de fonctionner jusqu'à leur prochain changement).
const MIN_PASSWORD_LENGTH = 12;
function persistLocalSession(profil, dek) {
  const minutes = (profil.sessionMinutes === undefined || profil.sessionMinutes === null) ? DEFAULT_SESSION_MINUTES : profil.sessionMinutes;
  if (minutes === 0) { localStorage.removeItem(SESSION_STORAGE_KEY); return; }
  const expiresAt = minutes === -1 ? null : Date.now() + minutes * 60000;
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ profileId: profil.id, dek, expiresAt }));
}
function clearLocalSession() { localStorage.removeItem(SESSION_STORAGE_KEY); }
function readLocalSession() {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s.expiresAt !== null && s.expiresAt < Date.now()) { localStorage.removeItem(SESSION_STORAGE_KEY); return null; }
    // Purge du mot de passe laissé en clair par les versions antérieures.
    if ('pwd' in s) { delete s.pwd; localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(s)); }
    return s;
  } catch(e) { return null; }
}

// ═══════════════════════════════════════════════════════════════════════
// AVERTISSEMENT "SERVICES TIERS" (nouveau) — affiché une seule fois à vie
// par profil (le drapeau vit dans l'index des profils, donc suit le profil
// même d'un appareil à l'autre via la synchronisation). Prévient que les
// fonctions IA (résumé, continuation, incohérences, noms, synonymes/
// antonymes, mémoire narrative) et le plugin LanguageTool envoient le texte
// concerné en clair à des services externes pour être traités — à appeler
// avant le tout premier usage de l'une de ces fonctions.
// ═══════════════════════════════════════════════════════════════════════
// v9.47.0 (AUD-03-024) : la notice est aussi relisible à volonté depuis ❔ Aide → Confidentialité et IA.
function showAiPrivacyNotice() {
  return showInfoModal({
    title: 'Vos textes et l\'IA',
    message: 'Les fonctions IA (résumé, continuation, incohérences, noms, synonymes, mémoire narrative, reformulation du roman graphique) envoient le texte concerné à Google (modèle Gemini) via le relais de Plume. Le correcteur LanguageTool envoie aussi le texte à LanguageTool.org.\n\nPlume ne stocke jamais ce texte en clair, mais il transite en clair chez ces services le temps du traitement. Avec l\'offre gratuite de Gemini, Google peut conserver ces échanges et s\'en servir pour améliorer ses produits : n\'envoyez pas un passage que vous voulez garder strictement confidentiel.',
    confirmLabel: 'J\'ai compris'
  });
}
async function notifyThirdPartyDataUseOnce() {
  // v9.20.0 (audit AUD-01-012) — la notice nommait Mistral alors que le texte
  // part chez Google (Gemini) depuis le 11/09/2026. Nouveau drapeau « V2 » :
  // la notice corrigée est réaffichée une fois, même aux profils qui avaient
  // vu l'ancienne (qui désignait le mauvais prestataire).
  if (!_currentProfile || _currentProfile.seenThirdPartyNoticeV2) return;
  await showAiPrivacyNotice();
  _currentProfile.seenThirdPartyNoticeV2 = true;
  await mutateProfilesIndex(idx => {
    const profil = idx.profiles.find(p => p.id === _currentProfileId);
    if (profil) profil.seenThirdPartyNoticeV2 = true;
  });
}

// Notice unique (Lot 7, audit #25) : jusqu'ici les images d'un roman
// graphique restaient strictement locales. La synchro Gist les envoie
// désormais aussi (chiffrées, vers le Gist privé du manuscrit) — un
// changement de comportement assez sensible pour prévenir une fois, comme
// pour l'usage de services IA externes ci-dessus.
async function notifyGistImageSyncOnce() {
  if (!_currentProfile || _currentProfile.seenGistImageNotice) return;
  await showInfoModal({
    title: 'Images du roman graphique',
    message: 'Jusqu\'ici, les images d\'un roman graphique restaient uniquement sur cet appareil. Désormais, la sauvegarde GitHub les envoie aussi, chiffrées avec la même clé que le reste de vos données, vers la sauvegarde privée de ce manuscrit, pour qu\'elles suivent sur vos autres appareils.',
    confirmLabel: 'J\'ai compris'
  });
  _currentProfile.seenGistImageNotice = true;
  await mutateProfilesIndex(idx => {
    const profil = idx.profiles.find(p => p.id === _currentProfileId);
    if (profil) profil.seenGistImageNotice = true;
  });
}

// ── ÉCRAN 0 : Clé de synchronisation de cet appareil (v7.22.0) ──────────
// N'apparaît qu'une seule fois par appareil (voir needsSyncKeySetup() dans
// router.js) — jamais par profil : cette clé déverrouille l'accès au Worker
// de synchronisation pour CET APPAREIL, quel que soit le profil ensuite
// utilisé dessus.
function renderSyncKeyGate() {
  // v9.41.0 (AUD-03-008) : question posée dans les mots de l'utilisateur (« où sont vos
  // manuscrits ? »), deux choix de poids égal, un seul bouton qui vérifie PUIS enregistre
  // la clé (avant : « Vérifier » et « Valider » séparés, « Valider » acceptait une clé non
  // vérifiée). Plus de compteur « Étape x/3 » : il ne se suivait pas quand on ignorait l'étape.
  gateShell(`
    <div class="gate-title"><i>🔑</i> Où sont vos manuscrits ?</div>
    <div class="gate-sub">Pour retrouver vos profils et manuscrits sur cet appareil, saisissez la clé de synchronisation de votre famille (demandez-la à votre administrateur). Sinon, écrivez ici seulement.</div>
    <label class="gate-label">Clé de synchronisation</label>
    <input id="sync-key-input" type="password" class="gate-field" placeholder="Collez ou saisissez la clé" autocomplete="off">
    <div id="sync-key-status" class="gate-err" aria-live="polite"></div>
    <button id="sync-key-submit-btn" class="gate-btn gate-btn-primary">Utiliser cette clé</button>
    <button id="sync-key-skip-btn" class="gate-btn gate-btn-ghost">Écrire sur cet appareil seulement</button>
  `);
  const statusEl = document.getElementById('sync-key-status');
  const submitBtn = document.getElementById('sync-key-submit-btn');
  const submit = async () => {
    const key = document.getElementById('sync-key-input').value.trim();
    if (!key) { statusEl.style.color = ''; statusEl.textContent = 'Entrez une clé, ou choisissez « Écrire sur cet appareil seulement ».'; return; }
    statusEl.style.color = '#9a95a8'; statusEl.textContent = '⏳ Vérification…';
    submitBtn.disabled = true;
    const ok = await verifySyncKey(key);
    submitBtn.disabled = false;
    if (!ok) { statusEl.style.color = '#e8a09a'; statusEl.textContent = '❌ Clé refusée, ou serveur injoignable. Vérifiez la clé et votre connexion.'; return; }
    setSyncKey(key);
    hideGate();
    await bootProfiles();
  };
  submitBtn.addEventListener('click', submit);
  document.getElementById('sync-key-input').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  initPasswordToggle('sync-key-input');
  document.getElementById('sync-key-skip-btn').addEventListener('click', () => {
    setSyncSkipped();
    hideGate();
    bootProfiles();
  });
}

async function loadProfilesIndex() { return loadData('profiles'); }
async function saveProfilesIndex(idx) { await persistData('profiles', idx); }

// ═══════════════════════════════════════════════════════
// CORRECTIF (dette technique repérée pendant la correction du bug de
// couverture, library.js) : l'index des profils suivait le même patron à
// risque (lecture complète → modification → écriture complète, sans
// verrou) que celui qui causait les couvertures qui "reviennent en
// arrière". Plusieurs fonctions ci-dessous relisaient même l'index AVANT
// une attente asynchrone (chiffrement, confirmation utilisateur) puis
// réutilisaient cette copie devenue potentiellement périmée pour l'écrire
// — un scénario identique à celui déjà corrigé sur la bibliothèque.
// mutateProfilesIndex() sérialise ces opérations exactement comme
// mutateDocList() (library.js) : chaque appel attend que le précédent soit
// ENTIÈREMENT terminé (lecture + modification + écriture) avant de
// commencer le sien.
// ═══════════════════════════════════════════════════════
let _profilesIndexLock = Promise.resolve();
async function mutateProfilesIndex(mutator) {
  const run = _profilesIndexLock.then(async () => {
    const idx = (await loadProfilesIndex()) || { version: 1, profiles: [] };
    const result = await mutator(idx);
    await saveProfilesIndex(idx);
    return result;
  });
  _profilesIndexLock = run.then(() => {}, () => {}); // la chaîne continue même si `mutator` échoue
  return run;
}

function gateEl() { return document.getElementById('profile-gate'); }
function showGate() { gateEl().style.display = 'flex'; }
function hideGate() { gateEl().style.display = 'none'; }

// ── Bootstrap : décide quel écran afficher au démarrage ─────────────────
async function bootProfiles() {
  const idx = await loadProfilesIndex();
  if (idx && Array.isArray(idx.deletedProfiles) && idx.deletedProfiles.length) purgeTombstonedProfiles(idx); // v9.39.0 : copies locales des profils supprimés ailleurs
  if (idx && Array.isArray(idx.profiles) && idx.profiles.length) {
    // Le système de profils est actif : la migration a forcément déjà eu
    // lieu. L'ancienne clé mono-profil 'main' n'est donc plus nécessaire
    // — on la purge silencieusement si elle traîne encore.
    // v9.21.0 (audit AUD-01-017) — lecture strictement locale : l'ancienne
    // clé 'main' n'existe plus que sur un appareil jamais migré ; l'interroger
    // via loadData() obligeait chaque démarrage à attendre le serveur.
    const legacy = await readLocalOnly('main');
    if (legacy) await persistData('main', null);
    // "Rester connecté" (nouveau) : si une session valide est enregistrée
    // sur cet appareil pour un profil existant, on saute directement
    // l'écran de connexion.
    const session = readLocalSession();
    if (session) {
      const profil = idx.profiles.find(p => p.id === session.profileId);
      if (profil) { await openProfile(profil, session.dek); return; }
      clearLocalSession();
    }
    renderLoginScreen(idx);
    return;
  }
  // ═══════════════════════════════════════════════════════
  // GARDE-FOU (v8.1.0) — NE JAMAIS CONCLURE « PREMIÈRE INSTALLATION » SUR UN DOUTE
  //
  // Aucun profil trouvé peut vouloir dire deux choses radicalement
  // différentes : « cet appareil est vierge » (légitime) ou « le serveur n'a
  // pas répondu » (temporaire). Jusqu'ici les deux menaient au même écran de
  // création du premier administrateur — et ce profil-là REMPLAÇAIT l'index
  // entier (profiles = [nouveau]), effaçant les vrais profils dès l'envoi
  // suivant. C'est très probablement l'origine des créations de comptes en
  // cascade constatées les 26-27/07/2026.
  //
  // Désormais : si une clé de synchronisation est configurée sur cet appareil
  // et que la dernière tentative de synchro a ÉCHOUÉ, on refuse de conclure.
  // On propose de réessayer, plutôt que d'ouvrir un écran destructeur.
  // ═══════════════════════════════════════════════════════
  if (getSyncKey() && getLastSyncStatus().ok === false) {
    renderSyncUnavailable();
    return;
  }

  // Aucun profil : soit première installation, soit anciennes données à migrer.
  const legacy = await loadData('main');
  if (legacy) renderMigration(legacy);
  else renderCreateProfile({ firstAdmin: true });
}

// Écran affiché quand des profils pourraient exister sur le serveur mais que
// celui-ci est injoignable — voir le garde-fou ci-dessus. Volontairement sans
// bouton « créer un profil » : c'est précisément l'action qui détruisait les
// données. Pour repartir de zéro sciemment, l'utilisateur peut retirer sa clé
// de synchronisation depuis l'écran de configuration.
function renderSyncUnavailable() {
  gateShell(`
    <div class="gate-title"><i>📡</i> Serveur injoignable</div>
    <div class="gate-sub">
      Vos profils sont peut-être stockés en ligne, mais le serveur de
      synchronisation ne répond pas pour l'instant. Aucun profil n'est affiché
      tant que ce n'est pas vérifié — c'est volontaire : créer un profil
      maintenant risquerait de remplacer les vôtres.
    </div>
    <div class="gate-sub">Vérifiez votre connexion internet, puis réessayez.</div>
    <button id="sync-unavail-retry" class="gate-btn gate-btn-primary">Réessayer</button>
    <button id="sync-unavail-settings" class="gate-link">Modifier la clé de synchronisation</button>
  `);
  document.getElementById('sync-unavail-retry').addEventListener('click', () => bootProfiles());
  document.getElementById('sync-unavail-settings').addEventListener('click', () => renderSyncKeyGate());
}

// ── Petits utilitaires d'écran ──────────────────────────────────────────
// v9.44.0 (AUD-03-023) : chaque écran d'accueil est un vrai <form> (gestionnaires de mots de passe, sémantique) ;
// Entrée dans un champ déclenche le bouton principal ; l'erreur affichée disparaît (et le champ perd son état
// « invalide ») dès qu'on modifie un champ. Tous les boutons restent de type button : leurs gestionnaires de
// clic existants font le travail, rien n'est soumis deux fois.
function wireGateForm(form) {
  form.querySelectorAll('button').forEach(b => { b.type = 'button'; });
  form.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    const primary = form.querySelector('.gate-btn-primary');
    if (!primary) return;
    e.preventDefault();
    primary.click();
  });
  form.addEventListener('input', e => {
    const err = form.querySelector('.gate-err');
    if (err) err.textContent = '';
    if (e.target.removeAttribute) e.target.removeAttribute('aria-invalid');
  });
}
// Affiche l'erreur À CÔTÉ du formulaire, marque le champ fautif et y place le curseur.
function gateFail(errEl, fieldId, msg) {
  errEl.textContent = msg;
  const f = document.getElementById(fieldId);
  if (f) { f.setAttribute('aria-invalid', 'true'); errEl.setAttribute('role', 'alert'); f.focus(); }
}
// Règle visible sous un champ mot de passe : « 12 caractères minimum » + compteur.
function wirePasswordHint(inputId, hintId) {
  const input = document.getElementById(inputId), hint = document.getElementById(hintId);
  if (!input || !hint) return;
  const upd = () => { const n = input.value.length; hint.textContent = n >= MIN_PASSWORD_LENGTH ? '✔ ' + n + ' caractères' : MIN_PASSWORD_LENGTH + ' caractères minimum (' + n + '/' + MIN_PASSWORD_LENGTH + ')'; hint.classList.toggle('ok', n >= MIN_PASSWORD_LENGTH); };
  input.addEventListener('input', upd); upd();
}
function gateShell(innerHtml) {
  const g = gateEl();
  g.innerHTML = `<div class="gate-card"><img src="icons/icon-192.png" class="gate-logo" alt="Plume" width="64" height="64"><form class="gate-form" novalidate>${innerHtml}</form></div>`;
  wireGateForm(g.querySelector('form'));
  showGate();
}
function nameExists(idx, name, exceptId) {
  const n = name.trim().toLowerCase();
  return idx.profiles.some(p => p.name.toLowerCase() === n && p.id !== exceptId);
}
function questionOptionsHtml() {
  return SECURITY_QUESTIONS.map(q => `<option value="${escapeHtml(q)}">${escapeHtml(q)}</option>`).join('');
}

// ── ÉCRAN 1 : Connexion ─────────────────────────────────────────────────
function renderLoginScreen(idx) {
  const opts = idx.profiles.map(p => `<option value="${p.id}">${DOMPurify.sanitize(p.name)}</option>`).join('');
  gateShell(`
    <div class="gate-title">Plume</div>
    <div class="gate-sub">Choisissez votre profil</div>
    <label class="gate-label">Profil</label>
    <select id="login-profile-sel" class="gate-field">${opts}</select>
    <label class="gate-label">Mot de passe</label>
    <input id="login-pwd" type="password" class="gate-field" placeholder="Mot de passe" autocomplete="current-password">
    <div id="login-err" class="gate-err"></div>
    <button id="login-btn" class="gate-btn gate-btn-primary">Se connecter</button>
    <button id="login-forgot" class="gate-link">Mot de passe oublié ?</button>
    <div class="gate-divider"></div>
    <button id="login-add" class="gate-btn gate-btn-ghost">➕ Ajouter un profil</button>
  `);
  document.getElementById('login-btn').addEventListener('click', doLogin);
  initPasswordToggle('login-pwd');
  document.getElementById('login-add').addEventListener('click', () => renderCreateProfile({ firstAdmin: false }));
  document.getElementById('login-forgot').addEventListener('click', () => {
    const pid = document.getElementById('login-profile-sel').value;
    renderRecovery(pid);
  });
}

async function doLogin() {
  const idx = await loadProfilesIndex();
  const pid = document.getElementById('login-profile-sel').value;
  const pwd = document.getElementById('login-pwd').value;
  const errEl = document.getElementById('login-err');
  errEl.textContent = '';
  const profil = idx.profiles.find(p => p.id === pid);
  if (!profil) { errEl.textContent = 'Profil introuvable.'; return; }
  const dek = await Crypto.decrypt(profil.wrapPwd, pwd);
  if (!dek) { errEl.textContent = 'Mot de passe incorrect.'; return; }
  await openProfile(profil, dek);
}

// ── ÉCRAN 4 : Création d'un profil ──────────────────────────────────────
// opts = { firstAdmin:bool, byAdmin:bool, migrationDb:objet|null }
function renderCreateProfile(opts) {
  opts = opts || {};
  const defaultName = '';
  gateShell(`
    <div class="gate-title"><i>👤</i> ${opts.firstAdmin ? 'Bienvenue — créez le profil administrateur' : 'Nouveau profil'}</div>
    <label class="gate-label">Nom du profil</label>
    <input id="cp-name" type="text" class="gate-field" value="${DOMPurify.sanitize(defaultName)}" placeholder="Votre prénom ou pseudo" autocomplete="username">
    <label class="gate-label">Mot de passe</label>
    <input id="cp-pwd" type="password" class="gate-field" placeholder="Choisissez un mot de passe" autocomplete="new-password">
    <div id="cp-pwd-hint" class="gate-hint"></div>
    <label class="gate-label">Confirmer le mot de passe</label>
    <input id="cp-pwd2" type="password" class="gate-field" placeholder="Répétez le mot de passe" autocomplete="new-password">
    <div class="gate-section">
      <label class="gate-label">Question de sécurité</label>
      <select id="cp-question" class="gate-field">${questionOptionsHtml()}</select>
      <label class="gate-label">Votre réponse</label>
      <input id="cp-answer" type="text" class="gate-field" placeholder="Réponse (à retenir)">
    </div>
    <div id="cp-err" class="gate-err"></div>
    <button id="cp-submit" class="gate-btn gate-btn-primary">Créer le profil</button>
    ${opts.firstAdmin ? '' : '<button id="cp-cancel" class="gate-link">Annuler</button>'}
  `);
  document.getElementById('cp-submit').addEventListener('click', () => submitCreateProfile(opts));
  initPasswordToggle('cp-pwd');
  initPasswordToggle('cp-pwd2');
  wirePasswordHint('cp-pwd', 'cp-pwd-hint');
  const cancel = document.getElementById('cp-cancel');
  if (cancel) cancel.addEventListener('click', async () => {
    if (opts.byAdmin) { hideGate(); openManageProfiles(); }
    else { const idx = await loadProfilesIndex(); renderLoginScreen(idx); }
  });
}

async function submitCreateProfile(opts) {
  const idx = (await loadProfilesIndex()) || { version: 1, profiles: [] };
  const name = document.getElementById('cp-name').value.trim();
  const pwd = document.getElementById('cp-pwd').value;
  const pwd2 = document.getElementById('cp-pwd2').value;
  const question = document.getElementById('cp-question').value;
  const answer = document.getElementById('cp-answer').value;
  const errEl = document.getElementById('cp-err');
  errEl.textContent = '';

  if (!name) { gateFail(errEl, 'cp-name', 'Entrez un nom de profil.'); return; }
  if (nameExists(idx, name)) { gateFail(errEl, 'cp-name', 'Ce nom de profil existe déjà.'); return; }
  if (pwd.length < MIN_PASSWORD_LENGTH) { gateFail(errEl, 'cp-pwd', 'Mot de passe trop court (' + MIN_PASSWORD_LENGTH + ' caractères minimum).'); return; }
  if (pwd !== pwd2) { gateFail(errEl, 'cp-pwd2', 'Les deux mots de passe ne correspondent pas.'); return; }
  if (!answer.trim()) { gateFail(errEl, 'cp-answer', 'Entrez une réponse à la question de sécurité.'); return; }

  const dek = Crypto.genDataKey();
  const code = Crypto.genRecoveryCode();
  const profil = {
    id: genChapterId(),
    name,
    role: opts.firstAdmin ? 'admin' : 'user',
    question,
    wrapPwd: await Crypto.encrypt(dek, pwd),
    wrapAnswer: await Crypto.encrypt(dek, Crypto.normalize(answer)),
    wrapCode: await Crypto.encrypt(dek, Crypto.normalizeCode(code))
  };

  // Correction (audit) : entre la validation du nom ci-dessus et la fin des
  // opérations de chiffrement (async, juste au-dessus), un autre profil a
  // pu être créé entre-temps (autre onglet/appareil). mutateProfilesIndex()
  // relit une copie fraîche juste avant d'écrire ; on revérifie le nom
  // dessus pour couvrir ce cas de collision, désormais rarissime mais réel.
  const nameTaken = await mutateProfilesIndex(freshIdx => {
    if (nameExists(freshIdx, name)) return true;
    freshIdx.profiles.push(profil);
    return false;
  });
  if (nameTaken) { errEl.textContent = 'Ce nom de profil existe déjà (créé entre-temps sur un autre appareil).'; return; }

  // Affiche le code de récupération, puis :
  //  • création normale → bibliothèque (vide, "+ Nouveau projet" pour commencer)
  //  • création par l'admin pour autrui → retour au panneau admin
  showRecoveryCode(code, name, async () => {
    if (opts.byAdmin) { hideGate(); openManageProfiles(); toast('Profil créé', 'success'); }
    else { await openProfile(profil, dek); }
  });
}

// ── ÉCRAN 5 : Code de récupération ──────────────────────────────────────
function showRecoveryCode(code, name, onContinue) {
  gateShell(`
    <div class="gate-title"><i>🛡️</i> Votre code de récupération</div>
    <div class="gate-sub">Conservez ce code en lieu sûr. Il permet de récupérer le profil « ${DOMPurify.sanitize(name)} » en cas d'oubli du mot de passe. Il ne sera plus jamais affiché.</div>
    <div class="gate-code">${DOMPurify.sanitize(code)}</div>
    <button id="rc-pdf" class="gate-btn gate-btn-accent">⬇️ Télécharger en PDF</button>
    <label class="gate-check"><input type="checkbox" id="rc-ack"> J'ai mis ce code en sécurité</label>
    <button id="rc-continue" class="gate-btn gate-btn-ghost" disabled>Continuer</button>
  `);
  document.getElementById('rc-pdf').addEventListener('click', () => downloadRecoveryPdf(code, name));
  document.getElementById('rc-ack').addEventListener('change', e => {
    document.getElementById('rc-continue').disabled = !e.target.checked;
  });
  document.getElementById('rc-continue').addEventListener('click', onContinue);
}

function downloadRecoveryPdf(code, name) {
  if (!window.jspdf || !window.jspdf.jsPDF) { toast('Bibliothèque PDF non chargée.', 'error'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(18); doc.text('Plume — Code de récupération', 20, 25);
  doc.setFontSize(11);
  doc.text('Profil : ' + name, 20, 40);
  doc.text('Date : ' + new Date().toLocaleString('fr'), 20, 48);
  doc.setDrawColor(142, 68, 173); doc.setLineWidth(0.5); doc.rect(20, 58, 170, 16);
  doc.setFontSize(17); doc.text(code, 25, 69);
  doc.setFontSize(10);
  const warn = "Conservez ce document en lieu sûr. Ce code permet de récupérer l'accès à votre profil si vous oubliez votre mot de passe. Ne le partagez avec personne : il donne un accès complet à vos données.";
  doc.text(doc.splitTextToSize(warn, 170), 20, 88);
  doc.save('code-recuperation-' + name.replace(/[^a-zA-Z0-9]/g, '_') + '.pdf');
}

// ── ÉCRAN 6 : Récupération (mot de passe oublié) ────────────────────────
function renderRecovery(profileId) {
  loadProfilesIndex().then(idx => {
    const profil = idx.profiles.find(p => p.id === profileId);
    if (!profil) { renderLoginScreen(idx); return; }
    gateShell(`
      <div class="gate-title"><i>🔓</i> Récupérer « ${DOMPurify.sanitize(profil.name)} »</div>
      <div class="gate-sub">Utilisez l'une des deux méthodes ci-dessous.</div>
      <div class="gate-box">
        <div class="gate-box-title">❔ Question de sécurité</div>
        <div class="gate-q">${DOMPurify.sanitize(profil.question || '')}</div>
        <input id="rec-answer" type="text" class="gate-field" placeholder="Votre réponse">
      </div>
      <div class="gate-or">— ou —</div>
      <div class="gate-box">
        <div class="gate-box-title">🔑 Code de récupération</div>
        <input id="rec-code" type="text" class="gate-field u-ff-monospace" placeholder="XXXX-XXXX-XXXX-…">
      </div>
      <div class="gate-section">
        <label class="gate-label">Nouveau mot de passe</label>
        <input id="rec-pwd" type="password" class="gate-field" placeholder="Nouveau mot de passe" autocomplete="new-password">
        <div id="rec-pwd-hint" class="gate-hint"></div>
        <label class="gate-label">Confirmer</label>
        <input id="rec-pwd2" type="password" class="gate-field" placeholder="Répétez" autocomplete="new-password">
      </div>
      <div id="rec-err" class="gate-err"></div>
      <button id="rec-submit" class="gate-btn gate-btn-primary">Vérifier et définir un nouveau mot de passe</button>
      <button id="rec-back" class="gate-link">Retour</button>
    `);
    document.getElementById('rec-submit').addEventListener('click', () => submitRecovery(profileId));
    document.getElementById('rec-back').addEventListener('click', () => renderLoginScreen(idx));
    initPasswordToggle('rec-pwd');
    initPasswordToggle('rec-pwd2');
    wirePasswordHint('rec-pwd', 'rec-pwd-hint');
  });
}

async function submitRecovery(profileId) {
  const idx = await loadProfilesIndex();
  const profil = idx.profiles.find(p => p.id === profileId);
  const answer = document.getElementById('rec-answer').value;
  const code = document.getElementById('rec-code').value;
  const pwd = document.getElementById('rec-pwd').value;
  const pwd2 = document.getElementById('rec-pwd2').value;
  const errEl = document.getElementById('rec-err');
  errEl.textContent = '';

  if (pwd.length < MIN_PASSWORD_LENGTH) { gateFail(errEl, 'rec-pwd', 'Nouveau mot de passe trop court (' + MIN_PASSWORD_LENGTH + ' caractères minimum).'); return; }
  if (pwd !== pwd2) { gateFail(errEl, 'rec-pwd2', 'Les deux mots de passe ne correspondent pas.'); return; }

  let dek = null;
  if (answer.trim()) dek = await Crypto.decrypt(profil.wrapAnswer, Crypto.normalize(answer));
  if (!dek && code.trim()) dek = await Crypto.decrypt(profil.wrapCode, Crypto.normalizeCode(code));
  if (!dek) { errEl.textContent = 'Réponse ou code de récupération incorrect.'; return; }

  // On ré-enveloppe la clé avec le nouveau mot de passe et on connecte.
  // Correction (audit) : écrit sur une copie FRAÎCHE de l'index (relue à
  // l'intérieur du verrou), pas celle chargée avant les déchiffrements/
  // chiffrement ci-dessus — sans quoi une modification concurrente d'un
  // AUTRE profil, survenue pendant cette attente, serait silencieusement
  // écrasée par cette copie devenue périmée.
  const newWrapPwd = await Crypto.encrypt(dek, pwd);
  await mutateProfilesIndex(freshIdx => {
    const freshProfil = freshIdx.profiles.find(p => p.id === profileId);
    if (freshProfil) freshProfil.wrapPwd = newWrapPwd;
  });
  toast('Mot de passe réinitialisé', 'success');
  await openProfile(profil, dek);
}

// ── Ouverture effective d'un profil : mène à SA bibliothèque de manuscrits ─
async function openProfile(profil, dek) {
  _currentProfileId = profil.id;
  _currentProfile = profil;
  _dataKey = dek;
  persistLocalSession(profil, dek);
  hideGate();
  syncPushEntireLibrary(); // arrière-plan, non bloquant — voir library.js
  await enterLibrary();
}

// v9.44.0 (AUD-03-009) : « Accueil » (qui était la même chose que « Déconnexion ») est supprimé. L'application
// enregistre automatiquement : on enregistre et on envoie ce qui est en attente AVANT de quitter, au lieu de
// prévenir à tort d'une perte de modifications (boîte native du navigateur). Une confirmation
// n'apparaît que si l'enregistrement vient réellement d'échouer. En bibliothèque, on n'enregistre pas : le dernier
// manuscrit ouvert l'a déjà été en le quittant (et save() y changerait la date « Modifié »).
async function logout() {
  let incomplete = false;
  try {
    if (!document.body.classList.contains('library-mode') && _currentDocumentId) {
      if (db.docType === 'roman_graphique') await saveGraphicNovel(true);
      else { flushCurrentChapter(); await save(); }
      if (typeof _saveFailedSince !== 'undefined' && _saveFailedSince) incomplete = true;
    }
    if (typeof flushPendingSyncPushes === 'function') flushPendingSyncPushes(true);
  } catch (e) { incomplete = true; }
  if (incomplete) {
    const ok = await showConfirmModal({ title: 'Enregistrement incomplet', message: 'Vos derniers changements n\'ont peut-être pas pu être enregistrés. Se déconnecter quand même ?', confirmLabel: 'Se déconnecter quand même', danger: true });
    if (!ok) return;
  }
  clearLocalSession();
  location.reload();
}

// ── ÉCRAN 2 : Gestion des profils (administrateur) ──────────────────────
async function openManageProfiles() {
  if (!_currentProfile || _currentProfile.role !== 'admin') { toast('Réservé à l\'administrateur.', 'error'); return; }
  await renderManageProfiles();
  document.getElementById('manage-profiles-close-btn').onclick = closeManageProfiles;
  document.getElementById('manage-profiles-overlay').classList.add('active');
}
function closeManageProfiles() { document.getElementById('manage-profiles-overlay').classList.remove('active'); }

async function renderManageProfiles() {
  const idx = await loadProfilesIndex();
  const listEl = document.getElementById('manage-profiles-list');
  listEl.innerHTML = idx.profiles.map(p => {
    const initial = (p.name[0] || '?').toUpperCase();
    const isAdmin = p.role === 'admin';
    const isMe = p.id === _currentProfileId;
    return `<div class="mp-row">
      <div class="mp-avatar ${isAdmin ? 'mp-avatar-admin' : 'mp-avatar-user'}">${DOMPurify.sanitize(initial)}</div>
      <div class="mp-name">${DOMPurify.sanitize(p.name)}${isAdmin ? ' <span class="mp-badge">admin</span>' : ''}${isMe ? ' <span class="mp-you">vous</span>' : ''}</div>
      <div class="mp-actions">
        <button class="action-btn btn-sm" data-rename="${p.id}">✏️ Renommer</button>
        ${(!isMe) ? `<button class="action-btn btn-danger btn-sm" data-del="${p.id}">🗑️</button>` : ''}
      </div>
    </div>`;
  }).join('');
  listEl.querySelectorAll('[data-rename]').forEach(b => b.addEventListener('click', () => adminRenameProfile(b.dataset.rename)));
  listEl.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => adminDeleteProfile(b.dataset.del)));
}

async function adminRenameProfile(pid) {
  const idx = await loadProfilesIndex();
  const profil = idx.profiles.find(p => p.id === pid);
  if (!profil) return;
  const newName = await showPromptModal({ title: 'Renommer le profil', message: 'Nouveau nom pour « ' + profil.name + ' ».', label: 'Nom du profil', value: profil.name, confirmLabel: 'Renommer' });
  if (!newName || !newName.trim()) return;
  const trimmed = newName.trim();
  // Correction (audit) : prompt() bloque le fil d'exécution, mais seulement
  // dans CET onglet — un autre appareil/onglet a pu modifier l'index
  // pendant que la boîte de dialogue restait ouverte. Écriture + revérif.
  // du nom sur une copie fraîche, à l'intérieur du verrou.
  let duplicate = false;
  await mutateProfilesIndex(freshIdx => {
    const freshProfil = freshIdx.profiles.find(p => p.id === pid);
    if (!freshProfil) return;
    if (nameExists(freshIdx, trimmed, pid)) { duplicate = true; return; }
    freshProfil.name = trimmed;
  });
  if (duplicate) { toast('Ce nom existe déjà.', 'error'); return; }
  if (pid === _currentProfileId) _currentProfile.name = trimmed;
  renderManageProfiles();
  toast('Profil renommé', 'success');
}

async function adminDeleteProfile(pid) {
  const idx = await loadProfilesIndex();
  const profil = idx.profiles.find(p => p.id === pid);
  if (!profil) return;
  if (pid === _currentProfileId) { toast('Vous ne pouvez pas supprimer votre propre profil.', 'error'); return; }
  const admins = idx.profiles.filter(p => p.role === 'admin');
  if (profil.role === 'admin' && admins.length <= 1) { toast('Impossible de supprimer le dernier administrateur.', 'error'); return; }

  const ok = await showConfirmModal({
    title: 'Supprimer ce profil ?',
    message: `Cela effacera le profil « ${profil.name} » ET tous ses manuscrits de tous vos appareils, sans possibilité de récupération. Les données chiffrées restent sur le serveur de synchronisation, illisibles sans le mot de passe du profil.`,
    confirmLabel: 'Supprimer définitivement',
    danger: true,
    requireText: profil.name
  });
  if (!ok) return;

  const docList = await loadData(docListKey(pid));
  if (docList && Array.isArray(docList.documents)) {
    for (const d of docList.documents) {
      await persistData(docDataKey(pid, d.id), null);
      await cleanupDocumentSideData(pid, d.id);
    }
  }
  await persistData(docListKey(pid), null);
  await persistData('data_' + pid, null);
  // Correction (audit) : copie rechargée à l'intérieur du verrou (même
  // principe que deleteDocument() dans library.js) — pas celle lue avant
  // la confirmation ci-dessus, qui a pu devenir périmée pendant l'attente
  // de l'utilisateur (saisie du nom exact à retaper).
  await mutateProfilesIndex(freshIdx => {
    freshIdx.profiles = freshIdx.profiles.filter(p => p.id !== pid);
    // v9.39.0 (AUD-02-015) : pierre tombale — sans elle, un autre appareil renvoyait le profil au serveur.
    freshIdx.deletedProfiles = mergeTombstones(freshIdx.deletedProfiles, [{ id: pid, at: Date.now() }], Date.now());
  });
  if (typeof flushPendingSyncPushes === 'function') flushPendingSyncPushes(true);
  renderManageProfiles();
  toast('Profil supprimé de tous vos appareils', 'success');
}

function adminAddProfile() {
  closeManageProfiles();
  renderCreateProfile({ firstAdmin: false, byAdmin: true });
}

// ── ÉCRAN 3 : Mon profil (chacun pour soi) ──────────────────────────────
function openMyProfile() {
  document.getElementById('mp-my-name').value = _currentProfile.name;
  const qSel = document.getElementById('mp-my-question');
  qSel.innerHTML = questionOptionsHtml();
  qSel.value = _currentProfile.question || SECURITY_QUESTIONS[0];
  document.getElementById('mp-my-answer').value = '';
  document.getElementById('mp-old-pwd').value = '';
  document.getElementById('mp-new-pwd').value = '';
  document.getElementById('mp-new-pwd2').value = '';
  const sessSel = document.getElementById('mp-session-duration');
  if (sessSel) {
    const minutes = (_currentProfile.sessionMinutes === undefined || _currentProfile.sessionMinutes === null) ? DEFAULT_SESSION_MINUTES : _currentProfile.sessionMinutes;
    sessSel.value = String(minutes);
    // Assignation directe (pas addEventListener) : évite d'empiler un
    // nouveau listener à chaque ouverture du panneau, sans dépendre du
    // câblage global (router.js) pour ce nouvel élément.
    sessSel.onchange = saveMySessionDuration;
  }
  // Câblage du bouton ✕ en assignation directe (idempotent, sans dépendre
  // du câblage global de router.js) — corrige un cas où ce bouton restait
  // inopérant tant qu'aucun manuscrit n'avait encore été ouvert.
  document.getElementById('my-profile-close-btn').onclick = closeMyProfile;
  document.getElementById('my-profile-overlay').classList.add('active');
}
function closeMyProfile() { document.getElementById('my-profile-overlay').classList.remove('active'); }

async function saveMySessionDuration() {
  const minutes = parseInt(document.getElementById('mp-session-duration').value, 10);
  await mutateProfilesIndex(idx => {
    const profil = idx.profiles.find(p => p.id === _currentProfileId);
    if (profil) profil.sessionMinutes = minutes;
  });
  _currentProfile.sessionMinutes = minutes;
  // Répercute tout de suite sur la session déjà active de cet appareil,
  // sans attendre une prochaine connexion.
  persistLocalSession(_currentProfile, _dataKey);
  toast('Durée de session mise à jour', 'success');
}

async function saveMyName() {
  const newName = document.getElementById('mp-my-name').value.trim();
  if (!newName) { toast('Le nom ne peut pas être vide.', 'error'); return; }
  let duplicate = false;
  await mutateProfilesIndex(idx => {
    if (nameExists(idx, newName, _currentProfileId)) { duplicate = true; return; }
    const profil = idx.profiles.find(p => p.id === _currentProfileId);
    if (profil) profil.name = newName;
  });
  if (duplicate) { toast('Ce nom existe déjà.', 'error'); return; }
  _currentProfile.name = newName;
  toast('Nom du profil mis à jour', 'success');
}

async function saveMyPassword() {
  const oldPwd = document.getElementById('mp-old-pwd').value;
  const newPwd = document.getElementById('mp-new-pwd').value;
  const newPwd2 = document.getElementById('mp-new-pwd2').value;
  // v9.24.0 — vérification de l'ancien mot de passe sans le garder en mémoire :
  // on tente d'ouvrir l'enveloppe À JOUR du profil (relue dans l'index, car
  // _currentProfile peut dater d'avant une récupération de mot de passe).
  const freshIdx = await loadProfilesIndex();
  const freshProfil = freshIdx && freshIdx.profiles.find(p => p.id === _currentProfileId);
  const oldOk = freshProfil && await Crypto.decrypt(freshProfil.wrapPwd, oldPwd);
  if (!oldOk) { toast('Mot de passe actuel incorrect.', 'error'); return; }
  if (newPwd.length < MIN_PASSWORD_LENGTH) { toast('Nouveau mot de passe trop court (' + MIN_PASSWORD_LENGTH + ' caractères minimum).', 'error'); return; }
  if (newPwd !== newPwd2) { toast('Les deux mots de passe ne correspondent pas.', 'error'); return; }
  const newWrapPwd = await Crypto.encrypt(_dataKey, newPwd);
  await mutateProfilesIndex(idx => {
    const profil = idx.profiles.find(p => p.id === _currentProfileId);
    if (profil) profil.wrapPwd = newWrapPwd;
  });
  _currentProfile.wrapPwd = newWrapPwd;
  document.getElementById('mp-old-pwd').value = '';
  document.getElementById('mp-new-pwd').value = '';
  document.getElementById('mp-new-pwd2').value = '';
  toast('Mot de passe modifié', 'success');
}

async function saveMyQuestion() {
  const question = document.getElementById('mp-my-question').value;
  const answer = document.getElementById('mp-my-answer').value;
  if (!answer.trim()) { toast('Entrez la nouvelle réponse.', 'error'); return; }
  const newWrapAnswer = await Crypto.encrypt(_dataKey, Crypto.normalize(answer));
  await mutateProfilesIndex(idx => {
    const profil = idx.profiles.find(p => p.id === _currentProfileId);
    if (profil) { profil.question = question; profil.wrapAnswer = newWrapAnswer; }
  });
  _currentProfile.question = question;
  document.getElementById('mp-my-answer').value = '';
  toast('Question de sécurité mise à jour', 'success');
}

// ── MIGRATION des données mono-profil existantes vers le profil admin ────
function renderMigration(legacy) {
  const encrypted = !!(legacy && legacy._enc);
  gateShell(`
    <div class="gate-title"><i>✨</i> Mise à jour : profils</div>
    <div class="gate-sub">Plume gère maintenant plusieurs profils. On sécurise vos données actuelles dans le profil administrateur.</div>
    <label class="gate-label">Nom du profil</label>
    <input id="mig-name" type="text" class="gate-field" placeholder="Votre prénom ou pseudo">
    ${encrypted
      ? `<label class="gate-label">Votre mot de passe actuel</label>
         <input id="mig-oldpwd" type="password" class="gate-field" placeholder="Mot de passe actuel" autocomplete="current-password">`
      : `<label class="gate-label">Choisissez un mot de passe</label>
         <input id="mig-newpwd" type="password" class="gate-field" placeholder="Mot de passe (12 caractères minimum)" autocomplete="new-password">
         <label class="gate-label">Confirmer</label>
         <input id="mig-newpwd2" type="password" class="gate-field" placeholder="Répétez" autocomplete="new-password">`}
    <div class="gate-section">
      <label class="gate-label">Question de sécurité</label>
      <select id="mig-question" class="gate-field">${questionOptionsHtml()}</select>
      <label class="gate-label">Votre réponse</label>
      <input id="mig-answer" type="text" class="gate-field" placeholder="Réponse (à retenir)">
    </div>
    <div id="mig-err" class="gate-err"></div>
    <button id="mig-submit" class="gate-btn gate-btn-primary">Sécuriser mes données</button>
  `);
  document.getElementById('mig-submit').addEventListener('click', () => submitMigration(legacy, encrypted));
  if (encrypted) initPasswordToggle('mig-oldpwd');
  else { initPasswordToggle('mig-newpwd'); initPasswordToggle('mig-newpwd2'); }
}

async function submitMigration(legacy, encrypted) {
  const errEl = document.getElementById('mig-err');
  errEl.textContent = '';
  const name = document.getElementById('mig-name').value.trim() || 'Cyril';
  const question = document.getElementById('mig-question').value;
  const answer = document.getElementById('mig-answer').value;
  if (!answer.trim()) { gateFail(errEl, 'cp-answer', 'Entrez une réponse à la question de sécurité.'); return; }

  let dbData, pwd;
  if (encrypted) {
    pwd = document.getElementById('mig-oldpwd').value;
    const dec = await Crypto.decrypt(legacy.data, pwd);
    if (!dec) { errEl.textContent = 'Mot de passe actuel incorrect.'; return; }
    dbData = migrateDb(JSON.parse(dec));
  } else {
    pwd = document.getElementById('mig-newpwd').value;
    const pwd2 = document.getElementById('mig-newpwd2').value;
    if (pwd.length < MIN_PASSWORD_LENGTH) { errEl.textContent = 'Mot de passe trop court (' + MIN_PASSWORD_LENGTH + ' caractères minimum).'; return; }
    if (pwd !== pwd2) { errEl.textContent = 'Les deux mots de passe ne correspondent pas.'; return; }
    dbData = migrateDb(legacy);
  }

  const dek = Crypto.genDataKey();
  const code = Crypto.genRecoveryCode();
  const profil = {
    id: genChapterId(), name, role: 'admin', question,
    wrapPwd: await Crypto.encrypt(dek, pwd),
    wrapAnswer: await Crypto.encrypt(dek, Crypto.normalize(answer)),
    wrapCode: await Crypto.encrypt(dek, Crypto.normalizeCode(code))
  };
  await mutateProfilesIndex(idx => {
    idx.version = 1;
    idx.profiles = [profil];
  });

  // Le roman récupéré depuis l'ancien format mono-profil devient le premier
  // manuscrit de la bibliothèque de ce nouvel administrateur.
  if (!dbData.title) dbData.title = 'Mon manuscrit';
  const docId = genChapterId();
  await persistData(docDataKey(profil.id, docId), { _enc: true, data: await Crypto.encryptData(JSON.stringify(dbData), dek) });
  await persistData(docListKey(profil.id), { version:1, documents:[{
    id: docId, title: dbData.title, lastModified: Date.now(),
    chapterCount: (dbData.chapters||[]).length,
    wordCount: (dbData.chapters||[]).reduce((s,c) => s + getWordCount(c.content), 0)
  }] });

  showRecoveryCode(code, name, async () => { await openProfile(profil, dek); });
}
