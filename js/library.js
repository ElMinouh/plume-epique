'use strict';
// ═══════════════════════════════════════════════════════════════════════
// BIBLIOTHÈQUE MULTI-MANUSCRITS (v7.2.0)
//
// Chaque profil peut désormais contenir PLUSIEURS manuscrits distincts,
// plutôt qu'un seul comme avant. Après connexion, l'utilisateur arrive sur
// cette bibliothèque, choisit un manuscrit existant ou en crée un nouveau,
// et se retrouve dans l'éditeur habituel.
//
// Stockage :
//   'doclist_<profileId>' → index en clair { version, documents:[{id,title,
//      lastModified,chapterCount,wordCount}] } — pas de contenu sensible.
//   'doc_<profileId>_<docId>' → { _enc:true, data:<cipher> }, contenu
//      toujours chiffré par la DEK du profil, exactement comme avant.
//
// Migration : les profils créés avant cette fonctionnalité (v7.0/v7.1)
// stockaient leur unique roman sous 'data_<profileId>'. Au premier passage
// par la bibliothèque, ce roman devient automatiquement le premier
// manuscrit — voir migrateLegacyDocumentIfNeeded().
// ═══════════════════════════════════════════════════════════════════════

let _currentDocumentId = null;

function docListKey(profileId) { return 'doclist_' + profileId; }
function docDataKey(profileId, docId) { return 'doc_' + profileId + '_' + docId; }

async function loadDocList() {
  const list = await loadData(docListKey(_currentProfileId));
  return (list && Array.isArray(list.documents)) ? list : { version:1, documents:[] };
}
async function saveDocList(list) { await persistData(docListKey(_currentProfileId), list); }

function libraryScreenEl() { return document.getElementById('library-screen'); }
function showLibraryScreen() { document.body.classList.add('library-mode'); }
function hideLibraryScreen() { document.body.classList.remove('library-mode'); }

function formatRelativeDate(ts) {
  if (!ts) return '';
  const diffDays = Math.floor((Date.now() - ts) / 86400000);
  if (diffDays <= 0) return "Modifié aujourd'hui";
  if (diffDays === 1) return 'Modifié hier';
  if (diffDays < 7) return `Modifié il y a ${diffDays} jours`;
  if (diffDays < 30) return `Modifié il y a ${Math.floor(diffDays/7)} semaine(s)`;
  return `Modifié il y a ${Math.floor(diffDays/30)} mois`;
}

// ── Point d'entrée après connexion/création/récupération/migration ──────
async function enterLibrary() {
  await migrateLegacyDocumentIfNeeded();
  wireLibraryStaticUI();
  await renderLibrary();
  showLibraryScreen();
}

let _libraryWired = false;
function wireLibraryStaticUI() {
  if (_libraryWired) return;
  _libraryWired = true;
  document.getElementById('library-my-profile-btn').addEventListener('click', openMyProfile);
  document.getElementById('library-manage-profiles-btn').addEventListener('click', openManageProfiles);
  document.getElementById('library-logout-btn').addEventListener('click', logout);
}

// Migration silencieuse : un profil v7.0/v7.1 a son roman unique sous
// 'data_<profileId>'. On le transforme en premier manuscrit de la
// bibliothèque, sans avoir à changer son chiffrement (même DEK, même
// enveloppe) — sauf si aucun titre n'existait encore, auquel cas on lui en
// attribue un et on réenregistre l'enveloppe avec ce titre inclus.
async function migrateLegacyDocumentIfNeeded() {
  const list = await loadDocList();
  if (list.documents.length) return;
  const legacy = await loadData('data_' + _currentProfileId);
  if (!legacy || !legacy._enc) return;

  const docId = genChapterId();
  let title = 'Mon manuscrit', chapterCount = 0, wordCount = 0, storedBlob = legacy;
  try {
    const dec = await Crypto.decrypt(legacy.data, _dataKey);
    if (dec) {
      const parsed = JSON.parse(dec);
      chapterCount = (parsed.chapters||[]).length;
      wordCount = (parsed.chapters||[]).reduce((s,c) => s + getWordCount(c.content), 0);
      if (parsed.title) {
        title = parsed.title;
      } else {
        parsed.title = title;
        storedBlob = { _enc:true, data: await Crypto.encrypt(JSON.stringify(parsed), _dataKey) };
      }
    }
  } catch(e) { /* migration au mieux : on garde les valeurs par défaut ci-dessus */ }

  await persistData(docDataKey(_currentProfileId, docId), storedBlob);
  list.documents.push({ id:docId, title, lastModified:Date.now(), chapterCount, wordCount });
  await saveDocList(list);
  await persistData('data_' + _currentProfileId, null);
}

async function renderLibrary() {
  const list = await loadDocList();
  const sorted = list.documents.slice().sort((a,b) => b.lastModified - a.lastModified);

  document.getElementById('library-profile-name').textContent = 'Bonjour, ' + (_currentProfile ? _currentProfile.name : '');
  document.getElementById('library-manage-profiles-btn').style.display = (_currentProfile && _currentProfile.role === 'admin') ? '' : 'none';
  document.getElementById('library-count').textContent = sorted.length + ' manuscrit' + (sorted.length > 1 ? 's' : '');

  const container = document.getElementById('library-grid');
  container.innerHTML = `<div class="library-card library-new" id="library-new-btn" role="button" tabindex="0" aria-label="Nouveau projet">
      <span class="library-new-icon">+</span><span>Nouveau projet</span>
    </div>` + sorted.map(d => `
    <div class="library-card" data-doc-id="${d.id}" role="button" tabindex="0">
      <div class="library-cover">📖</div>
      <div class="library-card-body">
        <p class="library-card-title">${DOMPurify.sanitize(d.title || 'Sans titre')}</p>
        <p class="library-card-meta">${d.chapterCount||0} chapitre(s) · ${d.wordCount||0} mots</p>
        <p class="library-card-date">${formatRelativeDate(d.lastModified)}</p>
      </div>
    </div>`).join('');

  const newBtn = document.getElementById('library-new-btn');
  newBtn.addEventListener('click', createNewDocument);
  newBtn.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); createNewDocument(); } });
  container.querySelectorAll('[data-doc-id]').forEach(card => {
    card.addEventListener('click', () => openDocument(card.dataset.docId));
    card.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); openDocument(card.dataset.docId); } });
  });
}

async function openDocument(docId) {
  const stored = await loadData(docDataKey(_currentProfileId, docId));
  if (!stored || !stored._enc) { toast('Manuscrit introuvable.', 'error'); return; }
  const dec = await Crypto.decrypt(stored.data, _dataKey);
  if (!dec) { toast('Impossible de déchiffrer ce manuscrit.', 'error'); return; }
  db = migrateDb(JSON.parse(dec));
  _currentDocumentId = docId;
  cur = 0;
  hideLibraryScreen();
  initApp();
}

async function createNewDocument() {
  const list = await loadDocList();
  const docId = genChapterId();
  const dbData = DEFAULT_DB();
  dbData.title = 'Nouveau manuscrit';
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) dbData.darkMode = true;
  const cipher = await Crypto.encrypt(JSON.stringify(dbData), _dataKey);
  await persistData(docDataKey(_currentProfileId, docId), { _enc:true, data:cipher });
  list.documents.push({ id:docId, title:dbData.title, lastModified:Date.now(), chapterCount:1, wordCount:0 });
  await saveDocList(list);
  db = dbData;
  _currentDocumentId = docId;
  cur = 0;
  hideLibraryScreen();
  initApp();
}

async function backToLibrary() {
  flushCurrentChapter();
  await save();
  await renderLibrary();
  showLibraryScreen();
}

// Tient à jour titre / dates / compteurs dans l'index de la bibliothèque —
// appelé depuis save() à chaque sauvegarde du manuscrit ouvert.
async function touchDocumentMeta() {
  if (!_currentDocumentId) return;
  const list = await loadDocList();
  const entry = list.documents.find(d => d.id === _currentDocumentId);
  if (!entry) return;
  entry.title = db.title || 'Sans titre';
  entry.lastModified = Date.now();
  entry.chapterCount = db.chapters.length;
  entry.wordCount = db.chapters.reduce((s,c) => s + getWordCount(c.content), 0);
  await saveDocList(list);
}

function updateDocumentTitle(t) {
  db.title = t.trim();
  const dt = document.getElementById('document-title');
  if (dt && dt.innerText !== db.title) dt.innerText = db.title;
  debouncedSave();
}
