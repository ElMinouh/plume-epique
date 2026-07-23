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
// Vue bibliothèque : grille (par défaut) ou étagère façon dos de livres —
// nouveau v7.11.0 (Lot 7). Jamais mémorisée : remise à 'grid' à chaque
// entrée dans la bibliothèque (voir enterLibrary()).
let _libraryViewMode = 'grid';

// Couvertures personnalisables par manuscrit (nouveau v7.9.0) — liste dédiée,
// distincte des palettes d'interface (Config > Apparence) : plus décorative,
// 10 choix + « Automatique » (couleurs actuelles de l'interface).
const COVER_PALETTES = {
  'rouge-violet':   { label:'Rouge & Violet',   a:'#c0392b', b:'#8e44ad' },
  'bleu-ocean':     { label:'Bleu Océan',        a:'#2980b9', b:'#16a085' },
  'emeraude':       { label:'Émeraude',          a:'#27ae60', b:'#2c3e50' },
  'rose-poudre':    { label:'Rose Poudré',       a:'#c2185b', b:'#d4af37' },
  'ardoise':        { label:'Ardoise',           a:'#34495e', b:'#7f8c8d' },
  'coucher-soleil': { label:'Coucher de Soleil', a:'#f39c12', b:'#e74c3c' },
  'nuit-etoilee':   { label:'Nuit Étoilée',      a:'#16213e', b:'#6a3093' },
  'sepia':          { label:'Sépia',             a:'#6d4c41', b:'#3e2723' },
  'corail':         { label:'Corail',            a:'#ee5a6f', b:'#f29263' },
  'lavande':        { label:'Lavande',           a:'#8e7cc3', b:'#5b3a8e' }
};
let _coverPickerDocId = null;
function closeCoverPicker() {
  const menu = document.getElementById('cover-picker-menu');
  if (menu) menu.classList.remove('open');
  _coverPickerDocId = null;
}
function openCoverPicker(docId, btn) {
  const menu = document.getElementById('cover-picker-menu');
  const alreadyOpenForThis = menu.classList.contains('open') && _coverPickerDocId === docId;
  closeCoverPicker();
  if (alreadyOpenForThis) return; // un second clic sur le même 🎨 referme le menu
  _coverPickerDocId = docId;
  const rect = btn.getBoundingClientRect();
  menu.style.visibility = 'hidden';
  menu.classList.add('open');
  const w = menu.offsetWidth || 140;
  let left = rect.left;
  const maxLeft = window.innerWidth - w - 8;
  if (left > maxLeft) left = maxLeft;
  if (left < 8) left = 8;
  menu.style.left = left + 'px';
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.style.visibility = 'visible';
}
async function selectCover(key) {
  const docId = _coverPickerDocId;
  closeCoverPicker();
  if (!docId) return;
  const list = await loadDocList();
  const entry = list.documents.find(d => d.id === docId);
  if (!entry) return;
  entry.cover = key; // 'auto' ou une clé de COVER_PALETTES
  await saveDocList(list);
  await renderLibraryScreen();
}

// ═══════════════════════════════════════════════════════
// MENU ⋮ DES MANUSCRITS (nouveau v7.13.0, Lot 10)
// Un seul menu partagé (position:fixed, ADR-17 — même patron que le menu ⋮
// des chapitres, editor.js), utilisé en vue Grille ET Étagère. Regroupe ce
// qui était avant 2 boutons séparés (🎨/🗑️) + un nouveau raccourci Export.
// ═══════════════════════════════════════════════════════
let _libraryCtxMenuDocId = null, _libraryCtxMenuBtn = null;
function closeLibraryCtxMenu() {
  const menu = document.getElementById('library-ctx-menu');
  if (menu) menu.classList.remove('open');
  document.querySelectorAll('.library-card.menu-open, .lib-book.menu-open').forEach(el => el.classList.remove('menu-open'));
  _libraryCtxMenuDocId = null;
  _libraryCtxMenuBtn = null;
}
function openLibraryCtxMenu(docId, btn) {
  const menu = document.getElementById('library-ctx-menu');
  const alreadyOpenForThis = menu.classList.contains('open') && _libraryCtxMenuDocId === docId;
  closeLibraryCtxMenu();
  if (alreadyOpenForThis) return;
  _libraryCtxMenuDocId = docId;
  _libraryCtxMenuBtn = btn;
  const item = btn.closest('.library-card, .lib-book');
  if (item) item.classList.add('menu-open');
  const rect = btn.getBoundingClientRect();
  menu.style.visibility = 'hidden';
  menu.classList.add('open');
  const w = menu.offsetWidth || 180;
  let left = rect.right - w;
  if (left < 8) left = 8;
  const maxLeft = window.innerWidth - w - 8;
  if (left > maxLeft) left = maxLeft;
  menu.style.left = left + 'px';
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.style.visibility = 'visible';
}

function docListKey(profileId) { return 'doclist_' + profileId; }
function docDataKey(profileId, docId) { return 'doc_' + profileId + '_' + docId; }

// v7.22.0 — Après une connexion réussie, si une clé de synchronisation est
// configurée sur cet appareil (voir router.js), on pousse tout de suite
// l'ensemble de la bibliothèque de ce profil vers le Worker (arrière-plan,
// non bloquant) : ça garantit qu'un AUTRE appareil configuré avec la même
// clé retrouvera la totalité des manuscrits dès sa première connexion,
// sans attendre que chacun soit rouvert/modifié individuellement d'abord.
async function syncPushEntireLibrary() {
  if (!getSyncKey()) return;
  try {
    const idx = await loadProfilesIndex();
    if (idx) await persistData('profiles', idx);
    const list = await loadDocList();
    await persistData(docListKey(_currentProfileId), list);
    for (const entry of list.documents) {
      const raw = await loadData(docDataKey(_currentProfileId, entry.id));
      if (raw) await persistData(docDataKey(_currentProfileId, entry.id), raw);
    }
  } catch(e) { /* meilleure tentative uniquement, aucune erreur affichée ici */ }
}

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
  await loadLibSettings();
  scheduleLibraryAutoBackup();
  setLibraryViewMode('grid');
  await renderLibraryScreen();
  showLibraryScreen();
}

let _libraryWired = false;
function wireLibraryStaticUI() {
  if (_libraryWired) return;
  _libraryWired = true;
  document.getElementById('library-my-profile-btn').addEventListener('click', openMyProfile);
  document.getElementById('library-manage-profiles-btn').addEventListener('click', openManageProfiles);
  document.getElementById('library-logout-btn').addEventListener('click', logout);
  document.getElementById('library-home-btn').addEventListener('click', goHome);
  // Sélecteur de couverture (v7.9.0) — élément unique, câblé une seule fois.
  document.querySelectorAll('#cover-picker-menu .cover-swatch').forEach(btn => {
    btn.addEventListener('click', () => selectCover(btn.dataset.cover));
  });
  document.addEventListener('click', () => closeCoverPicker());
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCoverPicker(); });
  // Bascule Grille / Étagère — nouveau v7.11.0 (Lot 7).
  document.getElementById('view-grid-btn').addEventListener('click', () => setLibraryViewMode('grid'));
  document.getElementById('view-shelf-btn').addEventListener('click', () => setLibraryViewMode('shelf'));

  // ── Menu ⋮ des manuscrits (v7.13.0, Lot 10) ──────────────────────────
  document.getElementById('lctx-cover').addEventListener('click', () => {
    const docId = _libraryCtxMenuDocId, btn = _libraryCtxMenuBtn;
    closeLibraryCtxMenu();
    if (docId && btn) openCoverPicker(docId, btn);
  });
  document.getElementById('lctx-export').addEventListener('click', () => {
    const docId = _libraryCtxMenuDocId;
    closeLibraryCtxMenu();
    if (docId) openLibrarySystemPanel(docId);
  });
  document.getElementById('lctx-del').addEventListener('click', () => {
    const docId = _libraryCtxMenuDocId;
    closeLibraryCtxMenu();
    if (docId) deleteDocument(docId);
  });
  document.addEventListener('click', () => closeLibraryCtxMenu());
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    closeLibraryCtxMenu();
    if (document.getElementById('library-system-overlay').classList.contains('active')) closeLibrarySystemPanel();
    if (document.getElementById('docx-import-overlay').classList.contains('active')) closeDocxImportModal();
    if (document.getElementById('export-select-overlay').classList.contains('active')) closeExportSelect();
    if (document.getElementById('gist-history-overlay').classList.contains('active')) closeGistHistory();
  });

  // ── Panneau Système : bibliothèque entière (v7.13.0, Lot 10) ─────────
  document.getElementById('library-system-btn').addEventListener('click', () => openLibrarySystemPanel());
  document.getElementById('library-system-close-btn').addEventListener('click', closeLibrarySystemPanel);
  document.getElementById('lib-gh-token').addEventListener('change', e => { _cloudToken = e.target.value.trim(); saveLibSettings(); scheduleLibraryAutoBackup(); });
  document.getElementById('lib-verify-token-btn').addEventListener('click', async () => {
    _cloudToken = document.getElementById('lib-gh-token').value.trim();
    const statusEl = document.getElementById('lib-token-status');
    if (!_cloudToken) { statusEl.style.color = 'var(--danger)'; statusEl.textContent = '❌ Colle un token d\'abord.'; return; }
    statusEl.style.color = 'var(--text-muted)'; statusEl.textContent = '⏳ Vérification…';
    const ok = await libVerifyToken();
    if (ok) { statusEl.style.color = 'var(--success)'; statusEl.textContent = `✅ Token valide (connecté en tant que @${ok}).`; saveLibSettings(); }
    else { statusEl.style.color = 'var(--danger)'; statusEl.textContent = '❌ Token invalide ou refusé par GitHub.'; }
  });
  document.getElementById('lib-auto-gist-interval').addEventListener('change', e => { _libSettings.autoGistInterval = parseInt(e.target.value)||0; saveLibSettings(); scheduleLibraryAutoBackup(); });
  document.getElementById('lib-system-doc-select').addEventListener('change', e => refreshLibSystemDocStatus(e.target.value));
  document.getElementById('lib-export-btn').addEventListener('click', libExportCurrent);
  document.getElementById('lib-import-doc-trigger-btn').addEventListener('click', () => document.getElementById('lib-import-doc-file').click());
  document.getElementById('lib-import-doc-file').addEventListener('change', e => importManuscriptFile(e.target));
  document.getElementById('lib-sync-cloud-btn').addEventListener('click', async () => {
    const docId = document.getElementById('lib-system-doc-select').value;
    if (!docId) return;
    document.getElementById('lib-cloud-status').textContent = '⏳ Sauvegarde en cours…';
    const ok = await libSyncManuscript(docId);
    document.getElementById('lib-cloud-status').textContent = ok ? '✅ Sauvegardé sur Gist' : '❌ Échec de la sauvegarde';
    refreshLibSystemDocStatus(docId);
  });
  document.getElementById('lib-load-cloud-btn').addEventListener('click', () => {
    const docId = document.getElementById('lib-system-doc-select').value;
    if (docId) libLoadManuscript(docId);
  });
  document.getElementById('lib-gist-history-btn').addEventListener('click', () => {
    const docId = document.getElementById('lib-system-doc-select').value;
    if (docId) libOpenGistHistory(docId);
  });
  document.getElementById('lib-export-json-btn').addEventListener('click', megaExportLibrary);
  document.getElementById('lib-import-json-trigger-btn').addEventListener('click', () => document.getElementById('lib-import-json-file').click());
  document.getElementById('lib-import-json-file').addEventListener('change', e => importProjectLibrary(e.target));

  // ── Import DOCX/ODT — modale (v7.12.0, généralisée v7.13.0) ──────────
  document.getElementById('docx-import-close-btn').addEventListener('click', closeDocxImportModal);
  document.getElementById('docx-mode-new-btn').addEventListener('click', () => setDocxImportMode('new'));
  document.getElementById('docx-mode-existing-btn').addEventListener('click', () => setDocxImportMode('existing'));
  document.getElementById('docx-import-confirm-btn').addEventListener('click', confirmDocxImport);

  // ── Export — sélection des chapitres puis choix du format ────────────
  document.getElementById('export-select-close-btn').addEventListener('click', closeExportSelect);
  document.getElementById('export-select-toggle-btn').addEventListener('click', toggleAllExportSelect);
  document.getElementById('export-select-docx-btn').addEventListener('click', () => { exportDocx(getSelectedExportChapters(), _exportSelectTitle); closeExportSelect(); });
  document.getElementById('export-select-odt-btn').addEventListener('click', () => { exportOdt(getSelectedExportChapters(), _exportSelectTitle); closeExportSelect(); });
  document.getElementById('export-select-pdf-btn').addEventListener('click', () => { exportPdf(getSelectedExportChapters(), _exportSelectTitle); closeExportSelect(); });
  document.getElementById('export-select-epub-btn').addEventListener('click', () => { exportEpub(getSelectedExportChapters(), _exportSelectTitle); closeExportSelect(); });

  // ── Historique Gist — fermeture (déclenché depuis le panneau Système) ─
  document.getElementById('gist-history-close-btn').addEventListener('click', closeGistHistory);
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
  list.documents.push({ id:docId, title, lastModified:Date.now(), chapterCount, wordCount, wordGoal:0, cover:'auto' });
  await saveDocList(list);
  await persistData('data_' + _currentProfileId, null);
}

async function renderLibraryScreen() {
  const list = await loadDocList();
  const sorted = list.documents.slice().sort((a,b) => b.lastModified - a.lastModified);

  document.getElementById('library-profile-name').textContent = 'Bonjour, ' + (_currentProfile ? _currentProfile.name : '');
  document.getElementById('library-manage-profiles-btn').style.display = (_currentProfile && _currentProfile.role === 'admin') ? '' : 'none';
  document.getElementById('library-count').textContent = sorted.length + ' manuscrit' + (sorted.length > 1 ? 's' : '');

  const container = document.getElementById('library-grid');
  container.innerHTML = `<div class="library-card library-new" id="library-new-btn" role="button" tabindex="0" aria-label="Nouveau projet" title="Créer un nouveau manuscrit vierge">
      <span class="library-new-icon">+</span><span>Nouveau projet</span>
    </div>` + sorted.map(d => {
      const cover = d.cover && d.cover !== 'auto' ? COVER_PALETTES[d.cover] : null;
      const coverClass = cover ? ` cover-${d.cover}` : '';
      const goal = d.wordGoal || 0;
      const pct = goal > 0 ? Math.min(100, Math.round((d.wordCount||0) / goal * 100)) : 0;
      return `
    <div class="library-card" data-doc-id="${d.id}" role="button" tabindex="0" title="Ouvrir « ${DOMPurify.sanitize(d.title || 'Sans titre')} »">
      <button class="library-kebab-btn" data-kebab-doc="${d.id}" title="Actions du manuscrit" aria-label="Actions du manuscrit">⋮</button>
      <div class="library-cover${coverClass}">📖</div>
      <div class="library-card-body">
        <p class="library-card-title">${DOMPurify.sanitize(d.title || 'Sans titre')}</p>
        <p class="library-card-meta">${d.chapterCount||0} chapitre(s) · ${d.wordCount||0} mots</p>
        ${goal>0 ? `<div class="library-progress" title="${d.wordCount||0} / ${goal} mots"><div class="library-progress-bar" data-pct="${pct}"></div></div><p class="library-progress-label">${d.wordCount||0} / ${goal} mots · ${pct}%</p>` : ''}
        <p class="library-card-date">${formatRelativeDate(d.lastModified)}${d.lastGistSync ? ' · ☁️ '+formatRelativeDate(d.lastGistSync).replace('Modifié ','') : ''}</p>
      </div>
    </div>`;
    }).join('');

  const newBtn = document.getElementById('library-new-btn');
  newBtn.addEventListener('click', createNewDocument);
  newBtn.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); createNewDocument(); } });
  container.querySelectorAll('[data-doc-id]').forEach(card => {
    card.addEventListener('click', (e) => { if (e.target.closest('.library-kebab-btn')) return; openDocument(card.dataset.docId); });
    card.addEventListener('keydown', e => { if ((e.key==='Enter'||e.key===' ')&&!e.target.closest('.library-kebab-btn')) { e.preventDefault(); openDocument(card.dataset.docId); } });
  });
  container.querySelectorAll('[data-kebab-doc]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openLibraryCtxMenu(btn.dataset.kebabDoc, btn); });
  });
  // v7.18.0 : largeur de la barre de progression posée via la propriété CSSOM
  // (autorisée par la CSP style-src même sans 'unsafe-inline'), plutôt qu'un
  // style="width:...' textuel dans le HTML généré ci-dessus (bloqué, lui).
  container.querySelectorAll('.library-progress-bar[data-pct]').forEach(el => {
    el.style.width = el.dataset.pct + '%';
  });
  // v7.11.0 : garder l'étagère synchronisée si c'est la vue active (même
  // principe que la corkboard des chapitres — Lot 6, editor.js).
  if (_libraryViewMode === 'shelf') renderLibraryShelf(sorted);
}

// ═══════════════════════════════════════════════════════
// VUE ÉTAGÈRE — dos de livres colorés (nouveau v7.11.0, Lot 7)
// Réutilise la couleur de couverture (Lot 5) et le sélecteur de couverture
// existant (openCoverPicker). Hauteur du dos proportionnelle au nombre de
// mots. Jamais mémorisée : remise à 'grid' à chaque entrée en bibliothèque.
// ═══════════════════════════════════════════════════════
function setLibraryViewMode(mode) {
  _libraryViewMode = mode;
  const isShelf = mode === 'shelf';
  document.getElementById('view-grid-btn').classList.toggle('active', !isShelf);
  document.getElementById('view-shelf-btn').classList.toggle('active', isShelf);
  document.getElementById('library-grid').style.display = isShelf ? 'none' : 'grid';
  document.getElementById('library-shelf').style.display = isShelf ? 'block' : 'none';
  if (isShelf) renderLibraryShelf();
}
async function renderLibraryShelf(sorted) {
  const cont = document.getElementById('library-shelf');
  if (!cont) return;
  if (!sorted) {
    const list = await loadDocList();
    sorted = list.documents.slice().sort((a,b) => b.lastModified - a.lastModified);
  }
  const PER_ROW = 7;
  const items = sorted.map(d => ({ d })).concat([{ isNew:true }]);
  let html = '';
  for (let i = 0; i < items.length; i += PER_ROW) {
    html += `<div class="lib-shelf-row"><div class="lib-shelf-plank"></div>` + items.slice(i, i + PER_ROW).map(it => {
      if (it.isNew) return `<div class="lib-book lib-book-new u-h-80px" id="library-new-btn-shelf" role="button" tabindex="0" aria-label="Nouveau projet" title="Créer un nouveau manuscrit vierge">+</div>`;
      const d = it.d;
      const cover = d.cover && d.cover !== 'auto' ? COVER_PALETTES[d.cover] : null;
      const shelfCoverClass = cover ? ` shelf-cover-${d.cover}` : '';
      const h = Math.max(80, Math.min(170, 80 + Math.round((d.wordCount||0) / 800)));
      return `<div class="lib-book${shelfCoverClass}" data-doc-id="${d.id}" data-h="${h}" role="button" tabindex="0" title="Ouvrir « ${DOMPurify.sanitize(d.title || 'Sans titre')} »">
        <button class="lib-book-kebab" data-kebab-doc="${d.id}" title="Actions du manuscrit" aria-label="Actions du manuscrit">⋮</button>
        <span class="lib-book-title">${DOMPurify.sanitize(d.title || 'Sans titre')}</span>
      </div>`;
    }).join('') + `</div>`;
  }
  cont.innerHTML = html;
  // v7.18.0 : hauteur du dos de livre posée via la propriété CSSOM (autorisée
  // par la CSP même sans 'unsafe-inline'), plutôt qu'un style="height:..."
  // textuel dans le HTML généré ci-dessus (bloqué, lui).
  cont.querySelectorAll('.lib-book[data-h]').forEach(el => {
    el.style.height = el.dataset.h + 'px';
  });

  cont.querySelectorAll('[data-doc-id]').forEach(book => {
    book.addEventListener('click', e => { if (e.target.closest('.lib-book-kebab')) return; openDocument(book.dataset.docId); });
    book.addEventListener('keydown', e => { if ((e.key==='Enter'||e.key===' ')&&!e.target.closest('.lib-book-kebab')) { e.preventDefault(); openDocument(book.dataset.docId); } });
  });
  cont.querySelectorAll('[data-kebab-doc]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openLibraryCtxMenu(btn.dataset.kebabDoc, btn); });
  });
  const newBtn = document.getElementById('library-new-btn-shelf');
  if (newBtn) {
    newBtn.addEventListener('click', createNewDocument);
    newBtn.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); createNewDocument(); } });
  }
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
  list.documents.push({ id:docId, title:dbData.title, lastModified:Date.now(), chapterCount:1, wordCount:0, wordGoal:0, cover:'auto' });
  await saveDocList(list);
  db = dbData;
  _currentDocumentId = docId;
  cur = 0;
  hideLibraryScreen();
  initApp();
}

// Suppression définitive d'un manuscrit depuis la bibliothèque — confirmation
// forte (retaper le titre exact), même principe que la suppression de profil.
async function deleteDocument(docId) {
  const list = await loadDocList();
  const entry = list.documents.find(d => d.id === docId);
  if (!entry) return;
  const title = entry.title || 'Sans titre';
  const confirmTitle = prompt(`⚠️ SUPPRESSION DÉFINITIVE\n\nCela effacera le manuscrit « ${title} » ainsi que tous ses chapitres, sans possibilité de récupération.\n\nPour confirmer, tapez exactement le titre du manuscrit :`);
  if (confirmTitle === null) return;
  if (confirmTitle.trim().toLowerCase() !== title.toLowerCase()) { toast('Titre incorrect, suppression annulée.', 'error'); return; }
  await persistData(docDataKey(_currentProfileId, docId), null);
  list.documents = list.documents.filter(d => d.id !== docId);
  await saveDocList(list);
  await renderLibraryScreen();
  toast('Manuscrit supprimé définitivement', 'success');
}

async function backToLibrary() {
  flushCurrentChapter();
  await save();
  await renderLibraryScreen();
  showLibraryScreen();
  // v7.13.0 (Lot 10) : déclencheur "changement de manuscrit / retour à la
  // bibliothèque" — en plus des 15 min et de la perte de focus de l'onglet.
  syncAllLibraryManuscripts('leave');
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
  entry.wordGoal = db.wordGoal || 0;
  await saveDocList(list);
}

function updateDocumentTitle(t) {
  db.title = t.trim();
  const dt = document.getElementById('document-title');
  if (dt && dt.innerText !== db.title) dt.innerText = db.title;
  debouncedSave();
}

// ═══════════════════════════════════════════════════════
// RÉGLAGES BIBLIOTHÈQUE — Token GitHub + intervalle auto (v7.13.0, Lot 10)
// Un seul token par profil (compte), mémorisé (chiffré avec la DEK du
// profil, comme les manuscrits) — contrairement à l'ancien _cloudToken
// (Lot 9), qui n'était jamais persisté. Compromis sécurité assumé sur
// demande explicite : plus pratique, le token reste stocké sur l'appareil.
// ═══════════════════════════════════════════════════════
let _libSettings = { autoGistInterval: 15 };
function libSettingsKey(profileId) { return 'libsettings_' + profileId; }
async function loadLibSettings() {
  const raw = await loadData(libSettingsKey(_currentProfileId));
  _libSettings = { autoGistInterval: 15 };
  if (raw && typeof raw.autoGistInterval === 'number') _libSettings.autoGistInterval = raw.autoGistInterval;
  if (raw && raw.token && raw.token._enc) {
    try {
      const dec = await Crypto.decrypt(raw.token.data, _dataKey);
      if (dec) _cloudToken = dec;
    } catch(e) { /* token illisible : on repart sans, l'utilisateur le recollera */ }
  }
}
async function saveLibSettings() {
  const payload = { autoGistInterval: _libSettings.autoGistInterval };
  if (_cloudToken) payload.token = { _enc:true, data: await Crypto.encrypt(_cloudToken, _dataKey) };
  await persistData(libSettingsKey(_currentProfileId), payload);
}

// Vérifie le token GitHub auprès de l'API (endpoint /user, en lecture
// seule) — nouveau v7.14.0, suite à un retour utilisateur : aucun moyen de
// confirmer qu'un token collé est valide avant de tenter une vraie
// sauvegarde. Retourne le login GitHub si valide, sinon null.
async function libVerifyToken() {
  if (!_cloudToken) return null;
  try {
    const resp = await fetch('https://api.github.com/user', { headers: { 'Authorization': `token ${_cloudToken}` } });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.login || 'compte GitHub';
  } catch(e) { return null; }
}

// ═══════════════════════════════════════════════════════
// HELPERS PARTAGÉS — charger/persister un manuscrit par id, indépendamment
// de ce qui est actuellement ouvert dans l'éditeur (`db`). Utilisés ici et
// dans sync.js (import DOCX/ODT vers un autre manuscrit, export, etc.)
// ═══════════════════════════════════════════════════════
async function loadManuscriptData(docId) {
  const stored = await loadData(docDataKey(_currentProfileId, docId));
  if (!stored || !stored._enc) throw new Error('Manuscrit introuvable.');
  const dec = await Crypto.decrypt(stored.data, _dataKey);
  if (!dec) throw new Error('Déchiffrement impossible.');
  return migrateDb(JSON.parse(dec));
}
async function persistManuscriptData(docId, mData) {
  const cipher = await Crypto.encrypt(JSON.stringify(mData), _dataKey);
  await persistData(docDataKey(_currentProfileId, docId), { _enc:true, data:cipher });
}
async function touchDocListEntry(docId, mData) {
  const list = await loadDocList();
  const entry = list.documents.find(d => d.id === docId);
  if (!entry) return;
  entry.title = mData.title || entry.title;
  entry.chapterCount = mData.chapters.length;
  entry.wordCount = mData.chapters.reduce((s,c) => s + getWordCount(c.content), 0);
  entry.wordGoal = mData.wordGoal || 0;
  entry.lastModified = Date.now();
  await saveDocList(list);
}

// ═══════════════════════════════════════════════════════
// GIST — PAR MANUSCRIT, ORCHESTRÉ PAR LA BIBLIOTHÈQUE (v7.13.0, Lot 10)
// Chaque manuscrit garde SON PROPRE Gist (mData.gistId) — pas un Gist unique
// pour toute la bibliothèque, pour que l'historique GitHub par manuscrit
// reste lisible (voir l'échange précédent sur la cohérence de cette
// approche). Ces fonctions travaillent toujours à partir du stockage local
// (jamais de `db` en mémoire), donc sûres à appeler même si le manuscrit
// visé n'est pas celui ouvert dans l'éditeur.
// ═══════════════════════════════════════════════════════
async function libSyncManuscript(docId, opts) {
  opts = opts || {};
  if (!_cloudToken) { if (!opts.silent) toast('Token GitHub requis.', 'error'); return false; }
  try {
    const mData = await loadManuscriptData(docId);
    const method = mData.gistId ? 'PATCH' : 'POST';
    const url = mData.gistId ? `https://api.github.com/gists/${mData.gistId}` : 'https://api.github.com/gists';
    const resp = await fetch(url, { method, headers:{'Authorization':`token ${_cloudToken}`,'Content-Type':'application/json'}, body: JSON.stringify({ public:false, files:{ "plume.json": { content: JSON.stringify(mData) } } }) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data.id && data.id !== mData.gistId) { mData.gistId = data.id; await persistManuscriptData(docId, mData); }
    const list = await loadDocList();
    const entry = list.documents.find(d => d.id === docId);
    if (entry) { entry.lastGistSync = Date.now(); await saveDocList(list); }
    return true;
  } catch(e) {
    if (!opts.silent) toast('Erreur Gist : ' + e.message, 'error');
    return false;
  }
}
async function libLoadManuscript(docId) {
  try {
    const mData = await loadManuscriptData(docId);
    if (!mData.gistId) { toast("Ce manuscrit n'a pas encore de Gist.", 'error'); return; }
    const resp = await fetch(`https://api.github.com/gists/${mData.gistId}`, { headers: _cloudToken ? {'Authorization':`token ${_cloudToken}`} : {} });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const raw = data.files && data.files["plume.json"] && data.files["plume.json"].content;
    if (!raw) throw new Error('Fichier introuvable dans ce Gist.');
    const restored = migrateDb(JSON.parse(raw));
    restored.gistId = mData.gistId;
    await persistManuscriptData(docId, restored);
    await touchDocListEntry(docId, restored);
    toast('Manuscrit restauré depuis le Gist.', 'success');
    await renderLibraryScreen();
    refreshLibSystemDocStatus(docId);
  } catch(e) { toast('Erreur : ' + e.message, 'error'); }
}
function closeGistHistory() { document.getElementById('gist-history-overlay').classList.remove('active'); }
async function libOpenGistHistory(docId) {
  let mData;
  try { mData = await loadManuscriptData(docId); } catch(e) { toast(e.message, 'error'); return; }
  if (!mData.gistId) { toast("Ce manuscrit n'a pas encore de Gist.", 'error'); return; }
  const listEl = document.getElementById('gist-history-list');
  listEl.innerHTML = '<div class="u-p-10px u-op-_6">Chargement…</div>';
  document.getElementById('gist-history-overlay').classList.add('active');
  try {
    const resp = await fetch(`https://api.github.com/gists/${mData.gistId}/commits`, { headers: _cloudToken ? {'Authorization':`token ${_cloudToken}`} : {} });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const commits = await resp.json();
    if (!commits.length) { listEl.innerHTML = '<div class="u-p-10px u-op-_6">Aucun historique.</div>'; return; }
    listEl.innerHTML = '';
    commits.slice().reverse().forEach((c, i) => {
      const date = new Date(c.committed_at).toLocaleString('fr');
      const el = document.createElement('div');
      el.className = 'history-item';
      el.innerHTML = `<span>${i===0?'🟢 Version actuelle':'Révision'} — ${date}</span>`;
      el.addEventListener('click', () => libLoadGistRevision(docId, mData.gistId, c.version));
      listEl.appendChild(el);
    });
  } catch(e) { listEl.innerHTML = `<div class="u-p-10px u-c-v-danger">❌ ${e.message}</div>`; }
}
async function libLoadGistRevision(docId, gistId, sha) {
  if (!confirm('Charger cette révision remplacera ce manuscrit. Continuer ?')) return;
  try {
    const resp = await fetch(`https://api.github.com/gists/${gistId}/${sha}`, { headers: _cloudToken ? {'Authorization':`token ${_cloudToken}`} : {} });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const raw = data.files && data.files["plume.json"] && data.files["plume.json"].content;
    if (!raw) throw new Error('Fichier introuvable dans cette révision');
    const restored = migrateDb(JSON.parse(raw));
    restored.gistId = gistId;
    await persistManuscriptData(docId, restored);
    await touchDocListEntry(docId, restored);
    closeGistHistory();
    toast('Révision restaurée.', 'success');
    await renderLibraryScreen();
    refreshLibSystemDocStatus(docId);
  } catch(e) { toast('Erreur : ' + e.message, 'error'); }
}

// ═══════════════════════════════════════════════════════
// SAUVEGARDE AUTO — TOUTE LA BIBLIOTHÈQUE (v7.13.0, Lot 10)
// 3 déclencheurs : toutes les 15 min (par défaut), au retour à la
// bibliothèque (backToLibrary), et à la perte de focus de l'onglet
// (voir router.js). Si des échecs surviennent (token expiré, réseau...),
// un avertissement s'affiche une fois — pas de spam à chaque cycle.
// ═══════════════════════════════════════════════════════
let _libSyncing = false, _libBackupWarned = false;
async function syncAllLibraryManuscripts(reason) {
  if (_libSyncing || !_currentProfileId || !_dataKey || !_cloudToken) return;
  const interval = (_libSettings && _libSettings.autoGistInterval) || 0;
  if (interval <= 0 && reason !== 'manual') return;
  _libSyncing = true;
  try {
    if (_currentDocumentId && !document.body.classList.contains('library-mode')) { flushCurrentChapter(); await save(); }
    const list = await loadDocList();
    let failures = 0;
    for (const entry of list.documents) { if (!(await libSyncManuscript(entry.id, { silent:true }))) failures++; }
    if (failures > 0 && !_libBackupWarned) { _libBackupWarned = true; toast('⚠️ Sauvegarde Gist auto : '+failures+' manuscrit(s) en échec (token expiré ?).', 'error'); }
    else if (failures === 0) _libBackupWarned = false;
    if (document.body.classList.contains('library-mode')) await renderLibraryScreen();
  } finally { _libSyncing = false; }
}
let _libAutoTimer = null;
function scheduleLibraryAutoBackup() {
  clearInterval(_libAutoTimer); _libAutoTimer = null;
  const minutes = (_libSettings && _libSettings.autoGistInterval) || 0;
  if (minutes <= 0) return;
  _libAutoTimer = setInterval(() => syncAllLibraryManuscripts('interval'), minutes * 60 * 1000);
}

// ═══════════════════════════════════════════════════════
// PANNEAU SYSTÈME — bibliothèque entière (v7.13.0, Lot 10)
// Remplace l'ancien onglet "📦 Backup" de l'éditeur (retiré). Regroupe :
// GitHub Gist (token + intervalle, pour toute la bibliothèque), actions sur
// UN manuscrit choisi (export, import DOCX/ODT, Gist manuel/historique), et
// export/import JSON de toute la bibliothèque.
// ═══════════════════════════════════════════════════════
async function openLibrarySystemPanel(preselectDocId) {
  document.getElementById('lib-gh-token').value = _cloudToken || '';
  document.getElementById('lib-auto-gist-interval').value = String(_libSettings.autoGistInterval ?? 15);
  document.getElementById('lib-cloud-status').textContent = '';
  const list = await loadDocList();
  const sel = document.getElementById('lib-system-doc-select');
  const sorted = list.documents.slice().sort((a,b)=>b.lastModified-a.lastModified);
  sel.innerHTML = sorted.map(d => `<option value="${d.id}">${DOMPurify.sanitize(d.title || 'Sans titre')}</option>`).join('');
  if (preselectDocId) sel.value = preselectDocId;
  await refreshLibSystemDocStatus(sel.value);
  document.getElementById('library-system-overlay').classList.add('active');
}
function closeLibrarySystemPanel() {
  document.getElementById('library-system-overlay').classList.remove('active');
}
async function refreshLibSystemDocStatus(docId) {
  const statusEl = document.getElementById('lib-doc-gist-status');
  if (!docId) { statusEl.textContent = ''; return; }
  try {
    const mData = await loadManuscriptData(docId);
    const list = await loadDocList();
    const entry = list.documents.find(d => d.id === docId);
    statusEl.textContent = mData.gistId
      ? `Gist : ${mData.gistId}${entry && entry.lastGistSync ? ' · dernière sauvegarde ' + formatRelativeDate(entry.lastGistSync).replace('Modifié ','') : ''}`
      : 'Pas encore de Gist pour ce manuscrit (créé au premier "Sauver").';
  } catch(e) { statusEl.textContent = ''; }
}
async function libExportCurrent() {
  const docId = document.getElementById('lib-system-doc-select').value;
  if (!docId) { toast('Aucun manuscrit sélectionné.', 'error'); return; }
  try {
    const mData = await loadManuscriptData(docId);
    openExportSelect(mData.chapters, mData.title);
  } catch(e) { toast('Erreur : ' + e.message, 'error'); }
}
