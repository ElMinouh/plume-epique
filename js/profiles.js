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
const DEFAULT_SESSION_MINUTES = 1440; // 24h
function persistLocalSession(profil, dek, pwd) {
  const minutes = (profil.sessionMinutes === undefined || profil.sessionMinutes === null) ? DEFAULT_SESSION_MINUTES : profil.sessionMinutes;
  if (minutes === 0) { localStorage.removeItem(SESSION_STORAGE_KEY); return; }
  const expiresAt = minutes === -1 ? null : Date.now() + minutes * 60000;
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ profileId: profil.id, dek, pwd, expiresAt }));
}
function clearLocalSession() { localStorage.removeItem(SESSION_STORAGE_KEY); }
function readLocalSession() {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s.expiresAt !== null && s.expiresAt < Date.now()) { localStorage.removeItem(SESSION_STORAGE_KEY); return null; }
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
async function notifyThirdPartyDataUseOnce() {
  if (!_currentProfile || _currentProfile.seenThirdPartyNotice) return;
  alert('ℹ️ À savoir : les fonctions IA (résumé, continuation, incohérences, noms, synonymes/antonymes, mémoire narrative) et le plugin LanguageTool envoient le texte concerné à des services externes (Mistral AI, LanguageTool.org) pour être traités. Ce texte n\'est jamais stocké en clair par Plume, mais transite en clair chez ces services le temps du traitement.\n\nCe message ne s\'affichera plus.');
  _currentProfile.seenThirdPartyNotice = true;
  const idx = await loadProfilesIndex();
  const profil = idx.profiles.find(p => p.id === _currentProfileId);
  if (profil) { profil.seenThirdPartyNotice = true; await saveProfilesIndex(idx); }
}

// ── ÉCRAN 0 : Clé de synchronisation de cet appareil (v7.22.0) ──────────
// N'apparaît qu'une seule fois par appareil (voir needsSyncKeySetup() dans
// router.js) — jamais par profil : cette clé déverrouille l'accès au Worker
// de synchronisation pour CET APPAREIL, quel que soit le profil ensuite
// utilisé dessus.
function renderSyncKeyGate() {
  gateShell(`
    <div class="gate-title"><i>🔑</i> Clé de synchronisation</div>
    <div class="gate-sub">Cet appareil ne connaît pas encore la clé de synchronisation. Demandez-la à votre administrateur pour retrouver vos profils et manuscrits ici aussi.</div>
    <label class="gate-label">Clé de synchronisation</label>
    <div class="u-d-flex u-gap-6px">
      <input id="sync-key-input" type="password" class="gate-field u-flex-1" placeholder="Collez ou saisissez la clé" autocomplete="off">
      <button id="sync-key-verify-btn" class="gate-btn gate-btn-ghost btn-sm u-w-auto u-ws-nowrap">✅ Vérifier</button>
    </div>
    <div id="sync-key-status" class="gate-err"></div>
    <button id="sync-key-submit-btn" class="gate-btn gate-btn-primary">Valider</button>
    <button id="sync-key-skip-btn" class="gate-link">Continuer sans synchronisation (hors-ligne uniquement)</button>
  `);
  const statusEl = document.getElementById('sync-key-status');
  document.getElementById('sync-key-verify-btn').addEventListener('click', async () => {
    const key = document.getElementById('sync-key-input').value.trim();
    if (!key) { statusEl.style.color = ''; statusEl.textContent = 'Entrez une clé à vérifier.'; return; }
    statusEl.style.color = '#9a95a8'; statusEl.textContent = '⏳ Vérification…';
    const ok = await verifySyncKey(key);
    statusEl.style.color = ok ? '#7fd8a0' : '#e8a09a';
    statusEl.textContent = ok ? '✅ Clé valide.' : '❌ Clé invalide, ou Worker injoignable.';
  });
  document.getElementById('sync-key-submit-btn').addEventListener('click', async () => {
    const key = document.getElementById('sync-key-input').value.trim();
    if (!key) { statusEl.style.color = ''; statusEl.textContent = 'Entrez une clé, ou utilisez "Continuer sans synchronisation".'; return; }
    setSyncKey(key);
    hideGate();
    await bootProfiles();
  });
  document.getElementById('sync-key-skip-btn').addEventListener('click', () => {
    setSyncSkipped();
    hideGate();
    bootProfiles();
  });
}

async function loadProfilesIndex() { return loadData('profiles'); }
async function saveProfilesIndex(idx) { await persistData('profiles', idx); }

function gateEl() { return document.getElementById('profile-gate'); }
function showGate() { gateEl().style.display = 'flex'; }
function hideGate() { gateEl().style.display = 'none'; }

// ── Bootstrap : décide quel écran afficher au démarrage ─────────────────
async function bootProfiles() {
  const idx = await loadProfilesIndex();
  if (idx && Array.isArray(idx.profiles) && idx.profiles.length) {
    // Le système de profils est actif : la migration a forcément déjà eu
    // lieu. L'ancienne clé mono-profil 'main' n'est donc plus nécessaire
    // — on la purge silencieusement si elle traîne encore.
    const legacy = await loadData('main');
    if (legacy) await persistData('main', null);
    // "Rester connecté" (nouveau) : si une session valide est enregistrée
    // sur cet appareil pour un profil existant, on saute directement
    // l'écran de connexion.
    const session = readLocalSession();
    if (session) {
      const profil = idx.profiles.find(p => p.id === session.profileId);
      if (profil) { await openProfile(profil, session.dek, session.pwd); return; }
      clearLocalSession();
    }
    renderLoginScreen(idx);
    return;
  }
  // Aucun profil : soit première installation, soit anciennes données à migrer.
  const legacy = await loadData('main');
  if (legacy) renderMigration(legacy);
  else renderCreateProfile({ firstAdmin: true });
}

// ── Petits utilitaires d'écran ──────────────────────────────────────────
function gateShell(innerHtml) {
  const g = gateEl();
  g.innerHTML = `<div class="gate-card"><img src="icons/icon-192.png" class="gate-logo" alt="Plume" width="64" height="64">${innerHtml}</div>`;
  showGate();
}
function nameExists(idx, name, exceptId) {
  const n = name.trim().toLowerCase();
  return idx.profiles.some(p => p.name.toLowerCase() === n && p.id !== exceptId);
}
function questionOptionsHtml() {
  return SECURITY_QUESTIONS.map(q => `<option value="${DOMPurify.sanitize(q)}">${DOMPurify.sanitize(q)}</option>`).join('');
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
  document.getElementById('login-pwd').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
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
  await openProfile(profil, dek, pwd);
}

// ── ÉCRAN 4 : Création d'un profil ──────────────────────────────────────
// opts = { firstAdmin:bool, byAdmin:bool, migrationDb:objet|null }
function renderCreateProfile(opts) {
  opts = opts || {};
  const defaultName = opts.firstAdmin ? 'Cyril' : '';
  gateShell(`
    <div class="gate-title"><i>👤</i> ${opts.firstAdmin ? 'Bienvenue — créez le profil administrateur' : 'Nouveau profil'}</div>
    <label class="gate-label">Nom du profil</label>
    <input id="cp-name" type="text" class="gate-field" value="${DOMPurify.sanitize(defaultName)}" placeholder="Votre nom">
    <label class="gate-label">Mot de passe</label>
    <input id="cp-pwd" type="password" class="gate-field" placeholder="Mot de passe" autocomplete="new-password">
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

  if (!name) { errEl.textContent = 'Entrez un nom de profil.'; return; }
  if (nameExists(idx, name)) { errEl.textContent = 'Ce nom de profil existe déjà.'; return; }
  if (pwd.length < 8) { errEl.textContent = 'Mot de passe trop court (8 caractères minimum).'; return; }
  if (pwd !== pwd2) { errEl.textContent = 'Les deux mots de passe ne correspondent pas.'; return; }
  if (!answer.trim()) { errEl.textContent = 'Entrez une réponse à la question de sécurité.'; return; }

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

  idx.profiles.push(profil);
  await saveProfilesIndex(idx);

  // Affiche le code de récupération, puis :
  //  • création normale → bibliothèque (vide, "+ Nouveau projet" pour commencer)
  //  • création par l'admin pour autrui → retour au panneau admin
  showRecoveryCode(code, name, async () => {
    if (opts.byAdmin) { hideGate(); openManageProfiles(); toast('Profil créé', 'success'); }
    else { await openProfile(profil, dek, pwd); }
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
        <label class="gate-label">Confirmer</label>
        <input id="rec-pwd2" type="password" class="gate-field" placeholder="Répétez" autocomplete="new-password">
      </div>
      <div id="rec-err" class="gate-err"></div>
      <button id="rec-submit" class="gate-btn gate-btn-primary">Vérifier et définir un nouveau mot de passe</button>
      <button id="rec-back" class="gate-link">Retour</button>
    `);
    document.getElementById('rec-submit').addEventListener('click', () => submitRecovery(profileId));
    document.getElementById('rec-back').addEventListener('click', () => renderLoginScreen(idx));
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

  if (pwd.length < 8) { errEl.textContent = 'Nouveau mot de passe trop court (8 caractères minimum).'; return; }
  if (pwd !== pwd2) { errEl.textContent = 'Les deux mots de passe ne correspondent pas.'; return; }

  let dek = null;
  if (answer.trim()) dek = await Crypto.decrypt(profil.wrapAnswer, Crypto.normalize(answer));
  if (!dek && code.trim()) dek = await Crypto.decrypt(profil.wrapCode, Crypto.normalizeCode(code));
  if (!dek) { errEl.textContent = 'Réponse ou code de récupération incorrect.'; return; }

  // On ré-enveloppe la clé avec le nouveau mot de passe et on connecte.
  profil.wrapPwd = await Crypto.encrypt(dek, pwd);
  await saveProfilesIndex(idx);
  toast('Mot de passe réinitialisé', 'success');
  await openProfile(profil, dek, pwd);
}

// ── Ouverture effective d'un profil : mène à SA bibliothèque de manuscrits ─
async function openProfile(profil, dek, pwd) {
  _currentProfileId = profil.id;
  _currentProfile = profil;
  _dataKey = dek;
  _encPassword = pwd;
  persistLocalSession(profil, dek, pwd);
  hideGate();
  syncPushEntireLibrary(); // arrière-plan, non bloquant — voir library.js
  await enterLibrary();
}

function logout() {
  if (!confirm('Se déconnecter ? Les modifications non enregistrées seront perdues.')) return;
  clearLocalSession();
  location.reload();
}

// Bouton "Accueil" (bibliothèque + éditeur) : retour à l'écran de connexion.
// Techniquement identique à logout() (aucun état sensible ne doit rester en
// mémoire), mais formulé pour un usage de navigation plutôt que de sécurité.
function goHome() {
  if (!confirm('Retourner à l\'écran de connexion ? Les modifications non enregistrées seront perdues.')) return;
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
        ${(!isMe) ? `<button class="action-btn btn-sm u-bg-v-danger" data-del="${p.id}">🗑️</button>` : ''}
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
  const newName = prompt('Nouveau nom pour « ' + profil.name + ' » :', profil.name);
  if (!newName || !newName.trim()) return;
  if (nameExists(idx, newName, pid)) { toast('Ce nom existe déjà.', 'error'); return; }
  profil.name = newName.trim();
  await saveProfilesIndex(idx);
  if (pid === _currentProfileId) _currentProfile.name = profil.name;
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

  const confirmName = prompt(`⚠️ SUPPRESSION DÉFINITIVE\n\nCela effacera le profil « ${profil.name} » ET tous ses manuscrits, sans possibilité de récupération.\n\nPour confirmer, tapez exactement le nom du profil :`);
  if (confirmName === null) return;
  if (confirmName.trim().toLowerCase() !== profil.name.toLowerCase()) { toast('Nom incorrect, suppression annulée.', 'error'); return; }

  const docList = await loadData(docListKey(pid));
  if (docList && Array.isArray(docList.documents)) {
    for (const d of docList.documents) await persistData(docDataKey(pid, d.id), null);
  }
  await persistData(docListKey(pid), null);
  await persistData('data_' + pid, null);
  idx.profiles = idx.profiles.filter(p => p.id !== pid);
  await saveProfilesIndex(idx);
  renderManageProfiles();
  toast('Profil supprimé définitivement', 'success');
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
  const idx = await loadProfilesIndex();
  const profil = idx.profiles.find(p => p.id === _currentProfileId);
  profil.sessionMinutes = minutes;
  _currentProfile.sessionMinutes = minutes;
  await saveProfilesIndex(idx);
  // Répercute tout de suite sur la session déjà active de cet appareil,
  // sans attendre une prochaine connexion.
  persistLocalSession(profil, _dataKey, _encPassword);
  toast('Durée de session mise à jour', 'success');
}

async function saveMyName() {
  const idx = await loadProfilesIndex();
  const profil = idx.profiles.find(p => p.id === _currentProfileId);
  const newName = document.getElementById('mp-my-name').value.trim();
  if (!newName) { toast('Le nom ne peut pas être vide.', 'error'); return; }
  if (nameExists(idx, newName, _currentProfileId)) { toast('Ce nom existe déjà.', 'error'); return; }
  profil.name = newName; _currentProfile.name = newName;
  await saveProfilesIndex(idx);
  toast('Nom du profil mis à jour', 'success');
}

async function saveMyPassword() {
  const oldPwd = document.getElementById('mp-old-pwd').value;
  const newPwd = document.getElementById('mp-new-pwd').value;
  const newPwd2 = document.getElementById('mp-new-pwd2').value;
  if (oldPwd !== _encPassword) { toast('Mot de passe actuel incorrect.', 'error'); return; }
  if (newPwd.length < 8) { toast('Nouveau mot de passe trop court (8 min).', 'error'); return; }
  if (newPwd !== newPwd2) { toast('Les deux mots de passe ne correspondent pas.', 'error'); return; }
  const idx = await loadProfilesIndex();
  const profil = idx.profiles.find(p => p.id === _currentProfileId);
  profil.wrapPwd = await Crypto.encrypt(_dataKey, newPwd);
  _encPassword = newPwd;
  await saveProfilesIndex(idx);
  document.getElementById('mp-old-pwd').value = '';
  document.getElementById('mp-new-pwd').value = '';
  document.getElementById('mp-new-pwd2').value = '';
  toast('Mot de passe modifié', 'success');
}

async function saveMyQuestion() {
  const question = document.getElementById('mp-my-question').value;
  const answer = document.getElementById('mp-my-answer').value;
  if (!answer.trim()) { toast('Entrez la nouvelle réponse.', 'error'); return; }
  const idx = await loadProfilesIndex();
  const profil = idx.profiles.find(p => p.id === _currentProfileId);
  profil.question = question;
  profil.wrapAnswer = await Crypto.encrypt(_dataKey, Crypto.normalize(answer));
  _currentProfile.question = question;
  await saveProfilesIndex(idx);
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
    <input id="mig-name" type="text" class="gate-field" value="Cyril">
    ${encrypted
      ? `<label class="gate-label">Votre mot de passe actuel</label>
         <input id="mig-oldpwd" type="password" class="gate-field" placeholder="Mot de passe actuel" autocomplete="current-password">`
      : `<label class="gate-label">Choisissez un mot de passe</label>
         <input id="mig-newpwd" type="password" class="gate-field" placeholder="Mot de passe" autocomplete="new-password">
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
}

async function submitMigration(legacy, encrypted) {
  const errEl = document.getElementById('mig-err');
  errEl.textContent = '';
  const name = document.getElementById('mig-name').value.trim() || 'Cyril';
  const question = document.getElementById('mig-question').value;
  const answer = document.getElementById('mig-answer').value;
  if (!answer.trim()) { errEl.textContent = 'Entrez une réponse à la question de sécurité.'; return; }

  let dbData, pwd;
  if (encrypted) {
    pwd = document.getElementById('mig-oldpwd').value;
    const dec = await Crypto.decrypt(legacy.data, pwd);
    if (!dec) { errEl.textContent = 'Mot de passe actuel incorrect.'; return; }
    dbData = migrateDb(JSON.parse(dec));
  } else {
    pwd = document.getElementById('mig-newpwd').value;
    const pwd2 = document.getElementById('mig-newpwd2').value;
    if (pwd.length < 8) { errEl.textContent = 'Mot de passe trop court (8 min).'; return; }
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
  await saveProfilesIndex({ version: 1, profiles: [profil] });

  // Le roman récupéré depuis l'ancien format mono-profil devient le premier
  // manuscrit de la bibliothèque de ce nouvel administrateur.
  if (!dbData.title) dbData.title = 'Mon manuscrit';
  const docId = genChapterId();
  await persistData(docDataKey(profil.id, docId), { _enc: true, data: await Crypto.encrypt(JSON.stringify(dbData), dek) });
  await persistData(docListKey(profil.id), { version:1, documents:[{
    id: docId, title: dbData.title, lastModified: Date.now(),
    chapterCount: (dbData.chapters||[]).length,
    wordCount: (dbData.chapters||[]).reduce((s,c) => s + getWordCount(c.content), 0)
  }] });

  showRecoveryCode(code, name, async () => { await openProfile(profil, dek, pwd); });
}
