'use strict';
// ═══════════════════════════════════════════════════════
// MODULE ROMAN GRAPHIQUE / LIVRE ILLUSTRÉ (nouveau)
// Écran d'édition dédié aux manuscrits db.docType === 'roman_graphique'.
// Entièrement isolé du reste de l'app : construit son propre écran
// (#graphicnovel-screen, injecté dans <body> au premier besoin) et sa
// propre sauvegarde (saveGraphicNovel), pour ne rien risquer sur
// l'éditeur chapitre par chapitre existant (router.js/editor.js). Réutilise
// les mêmes globales que le reste de l'app (db, cur, _currentDocumentId,
// _currentProfileId, _dataKey) et les mêmes utilitaires (persistData,
// docDataKey, makeEncryptedEnvelope, mutateDocList, getWordCount, toast,
// showLibraryScreen/hideLibraryScreen) — définis dans router.js/library.js,
// chargés avant ce fichier.
//
// Limites assumées de cette première version (à faire évoluer) :
//   - pas d'export PDF (bouton visible mais désactivé) ;
//   - édition libre (glisser/redimensionner) réservée au PC — sur mobile,
//     on choisit un gabarit et on remplace les images, sans positionnement
//     libre (décision prise avec l'utilisateur lors de la maquette).
// ═══════════════════════════════════════════════════════

const GN_DESKTOP_BREAKPOINT = 900;
function gnIsDesktop() { return window.innerWidth > GN_DESKTOP_BREAKPOINT; }

let _gnBuilt = false;
let _gnActivePage = 0;
let _gnSelectedElId = null;
// Mode "recadrer" (togglé via ✥ dans la mini-barre) : tant qu'il est actif,
// glisser DANS le cadre de l'image sélectionnée déplace l'image à
// l'intérieur (pan) au lieu de déplacer le cadre sur la page — évite tout
// conflit avec le glisser habituel qui repositionne l'élément.
let _gnPanMode = false;
let _gnPreviewGabarit = null;
let _gnSnapGrid = true;
let _gnDrag = null; // { mode:'move'|'resize', elId, startX, startY, origX, origY, origW, origH }

// Annuler/Rétablir (Lot 4, audit #9) : un seul point d'accroche (voir
// gnCommitUndoSnapshot, appelé depuis saveGraphicNovel ci-dessous) plutôt que
// d'instrumenter chacun des ~20 sites de mutation du fichier — toute action
// finit de toute façon par passer par saveGraphicNovel(). Pile en mémoire
// uniquement (jamais persistée, comme _undoStacks dans editor.js), état
// complet des pages (JSON.stringify(db.pages)) à chaque étape plutôt qu'un
// diff — plus simple, et la pile reste petite (pas d'images en base64 dans
// db.pages, seulement des imageId).
const GN_UNDO_LIMIT = 100; // même limite que UNDO_LIMIT (editor.js)
let _gnUndoStack = { stack: [], index: -1 };

// ─────────────────────────────────────────────────────────
// ÉCRAN — affichage / masquage (même principe que showLibraryScreen, v.
// library.js : une classe sur <body> qui bascule ce qui est visible)
// ─────────────────────────────────────────────────────────
function showGraphicNovelScreen() { document.body.classList.add('graphicnovel-mode'); }
function hideGraphicNovelScreen() { document.body.classList.remove('graphicnovel-mode'); }

function openGraphicNovelScreen() {
  ensureGraphicNovelScreen();
  // Lot 4 (v9.13.0) : sans cet appel, un manuscrit roman graphique ouvert
  // sans jamais être passé par l'éditeur texte (initApp, router.js) n'a
  // JAMAIS ses raccourcis clavier globaux câblés (Ctrl+Z/Y compris) — la
  // fonction est protégée par son propre indicateur _appWired, donc sans
  // risque à rappeler ici.
  if (typeof wireAppEventListenersOnce === 'function') wireAppEventListenersOnce();
  showGraphicNovelScreen();
  if (db.darkMode) document.body.classList.add('dark-mode'); else document.body.classList.remove('dark-mode');
  document.body.classList.toggle('paper-mode', !!db.paperMode);
  _gnActivePage = 0; _gnSelectedElId = null; _gnPreviewGabarit = null;
  const titleEl = document.getElementById('gn-doc-title');
  if (titleEl) titleEl.textContent = db.title || 'Sans titre';
  // Corbeille (Lot 3) : purge les entrées expirées à chaque ouverture, jamais
  // en cours d'édition — voir gnPurgeOldTrash().
  gnPurgeOldTrash();
  // Annuler/Rétablir (Lot 4) : pile remise à zéro à chaque ouverture d'un
  // manuscrit — on ne propose jamais d'annuler au-delà de la session en cours.
  gnResetUndoStack();
  // Stats (Lot 6, audit #21) : mêmes globales que l'éditeur texte
  // (router.js), pour que "mots aujourd'hui"/"mots par minute" restent
  // justes si jamais calculés pendant que ce manuscrit est ouvert.
  if (typeof sessionWordsStart !== 'undefined') { sessionWordsStart = gnCountWords(); sessionStartTime = Date.now(); }
  renderGraphicNovelScreen();
  gnRenderTrashBadge();
}

async function backToLibraryFromGraphicNovel() {
  await saveGraphicNovel(true);
  hideGraphicNovelScreen();
  await renderLibraryScreen();
  showLibraryScreen();
}

// ─────────────────────────────────────────────────────────
// SAUVEGARDE — dédiée, ne touche jamais à db.chapters (voir en-tête)
// ─────────────────────────────────────────────────────────
function gnCountWords() {
  let n = 0;
  (db.pages || []).forEach(p => (p.elements || []).forEach(el => {
    if (el.type === 'text') n += getWordCount(el.content);
  }));
  return n;
}
// Stats (Lot 6, audit #21) : équivalent de updateDailyStats() (stats.js)
// pour ce docType — mêmes champs (db.sessionStats, db.hourlyActivity),
// mêmes fonctions génériques réutilisées telles quelles (getTodayKey,
// trackHourlyActivity), seule la source du total de mots change
// (gnCountWords() au lieu de db.chapters.reduce(...)). Pas d'UI dédiée dans
// l'écran roman graphique cette fois — juste la collecte des données, pour
// qu'un manuscrit illustré compte dans la série d'écriture/l'heure la plus
// productive comme un manuscrit texte.
function gnUpdateDailyStats() {
  if (typeof getTodayKey !== 'function' || typeof trackHourlyActivity !== 'function') return;
  const today = getTodayKey();
  const totalW = gnCountWords();
  if (!db.sessionStats) db.sessionStats = {};
  db.sessionStats[today] = totalW;
  trackHourlyActivity(totalW);
}
async function saveGraphicNovel(immediate) {
  if (!_currentProfileId || !_dataKey || !_currentDocumentId) return;
  const doSave = async () => {
    try {
      const payload = { ...db };
      await persistData(docDataKey(_currentProfileId, _currentDocumentId), await makeEncryptedEnvelope(JSON.stringify(payload)));
      await mutateDocList(list => {
        const entry = list.documents.find(d => d.id === _currentDocumentId);
        if (!entry) return;
        entry.title = db.title || 'Sans titre';
        entry.docType = 'roman_graphique';
        entry.lastModified = Date.now();
        entry.chapterCount = (db.pages || []).length;
        entry.wordCount = gnCountWords();
        entry.wordGoal = 0;
        // Vignette bibliothèque (Lot 6, audit #23) : uniquement la géométrie
        // des éléments de la page 1 (positions/tailles/types), jamais leur
        // contenu (texte) ni les images elles-mêmes — l'index de la
        // bibliothèque est stocké en clair (voir library.js), il ne doit
        // jamais recevoir de vrai contenu de manuscrit.
        const cover = (db.pages && db.pages[0]) || null;
        entry.gnCoverShapes = cover ? cover.elements.map(e => ({ type: e.type, x: e.x, y: e.y, w: e.w, h: e.h })) : [];
        entry.gnCoverBg = cover ? (cover.background || '') : '';
      });
      // Annuler/Rétablir (Lot 4) : point d'accroche unique — n'importe quelle
      // mutation (glisser, propriétés, ajout/suppression, corbeille…) passe
      // par ici une fois réellement sauvegardée.
      gnCommitUndoSnapshot();
      gnUpdateDailyStats();
      if (typeof flashSave === 'function') flashSave();
    } catch(e) {
      console.error('Échec de sauvegarde (roman graphique) :', e);
      if (typeof toast === 'function') toast('⚠️ Échec de la sauvegarde : ' + (e && e.message ? e.message : e), 'error');
    }
  };
  if (immediate) { clearTimeout(_gnSaveTimer); await doSave(); return; }
  clearTimeout(_gnSaveTimer);
  _gnSaveTimer = setTimeout(doSave, 600);
}
let _gnSaveTimer = null;

// ─────────────────────────────────────────────────────────
// ANNULER / RÉTABLIR (Lot 4, audit #9)
// ─────────────────────────────────────────────────────────
function gnResetUndoStack() {
  _gnUndoStack = { stack: [JSON.stringify(db.pages)], index: 0 };
  gnUpdateUndoRedoButtons();
}
function gnCommitUndoSnapshot() {
  const snap = JSON.stringify(db.pages);
  if (_gnUndoStack.stack[_gnUndoStack.index] === snap) { gnUpdateUndoRedoButtons(); return; }
  _gnUndoStack.stack = _gnUndoStack.stack.slice(0, _gnUndoStack.index + 1);
  _gnUndoStack.stack.push(snap);
  _gnUndoStack.index = _gnUndoStack.stack.length - 1;
  if (_gnUndoStack.stack.length > GN_UNDO_LIMIT) { _gnUndoStack.stack.shift(); _gnUndoStack.index--; }
  gnUpdateUndoRedoButtons();
}
function gnUndo() {
  if (_gnUndoStack.index <= 0) { toast('Rien à annuler.', 'info'); return; }
  _gnUndoStack.index--;
  gnApplyUndoState();
}
function gnRedo() {
  if (_gnUndoStack.index >= _gnUndoStack.stack.length - 1) { toast('Rien à rétablir.', 'info'); return; }
  _gnUndoStack.index++;
  gnApplyUndoState();
}
function gnApplyUndoState() {
  db.pages = JSON.parse(_gnUndoStack.stack[_gnUndoStack.index]);
  _gnSelectedElId = null; _gnPreviewGabarit = null;
  if (_gnActivePage >= db.pages.length) _gnActivePage = db.pages.length - 1;
  renderGraphicNovelScreen();
  gnRenderTrashBadge();
  // saveGraphicNovel() re-déclenche gnCommitUndoSnapshot(), mais l'état
  // rejoué est déjà identique au sommet de pile visé : la comparaison au
  // début de gnCommitUndoSnapshot évite toute duplication.
  saveGraphicNovel();
  gnUpdateUndoRedoButtons();
}
function gnUpdateUndoRedoButtons() {
  const ub = document.getElementById('gn-undo-btn'), rb = document.getElementById('gn-redo-btn');
  if (ub) ub.disabled = _gnUndoStack.index <= 0;
  if (rb) rb.disabled = _gnUndoStack.index >= _gnUndoStack.stack.length - 1;
}

function updateGraphicNovelTitle(t) {
  db.title = (t || '').trim();
  saveGraphicNovel();
}

// ─────────────────────────────────────────────────────────
// CRÉATION — depuis la fenêtre de choix de type
// ─────────────────────────────────────────────────────────
async function createNewGraphicNovel() {
  const docId = genChapterId();
  const dbData = DEFAULT_DB_GRAPHIC();
  dbData.title = 'Nouveau roman graphique';
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) dbData.darkMode = true;
  await persistData(docDataKey(_currentProfileId, docId), await makeEncryptedEnvelope(JSON.stringify(dbData)));
  await mutateDocList(list => {
    list.documents.push({ id:docId, title:dbData.title, docType:'roman_graphique', lastModified:Date.now(), chapterCount:1, wordCount:0, wordGoal:0, cover:'auto' });
  });
  db = dbData;
  _currentDocumentId = docId;
  cur = 0;
  hideLibraryScreen();
  openGraphicNovelScreen();
}

// ─────────────────────────────────────────────────────────
// ACCESSIBILITÉ CLAVIER DES FENÊTRES MODALES (Lot 9, audit #29)
// Point d'entrée unique, appelé par chacune des 5 fenêtres du module
// (nouveau projet, export PDF, export livre, corbeille, historique de
// page) plutôt que de dupliquer cette logique dans chacune : Échap ferme
// la fenêtre, Tab/Maj+Tab restent piégés à l'intérieur tant qu'elle est
// ouverte (comme l'exige un dialogue modal accessible — sans ça, Tab fait
// sortir le focus vers la page derrière, invisible sous l'overlay), et le
// focus revient sur l'élément qui avait déclenché l'ouverture à la
// fermeture. La fonction de fermeture de chaque fenêtre doit appeler
// gnCleanupModalA11y(overlay) AVANT de retirer l'overlay du DOM.
// ─────────────────────────────────────────────────────────
function gnWireModalA11y(overlay, closeFn) {
  const previouslyFocused = document.activeElement;
  const focusableSel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const getFocusable = () => Array.from(overlay.querySelectorAll(focusableSel)).filter(el => !el.disabled && el.offsetParent !== null);
  const first = getFocusable()[0];
  (first || overlay.querySelector('.gn-modal'))?.focus();
  function onKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeFn(); return; }
    if (e.key !== 'Tab') return;
    const items = getFocusable();
    if (!items.length) return;
    const firstItem = items[0], lastItem = items[items.length - 1];
    if (e.shiftKey && document.activeElement === firstItem) { e.preventDefault(); lastItem.focus(); }
    else if (!e.shiftKey && document.activeElement === lastItem) { e.preventDefault(); firstItem.focus(); }
  }
  overlay.addEventListener('keydown', onKeydown);
  overlay._gnA11yCleanup = () => {
    overlay.removeEventListener('keydown', onKeydown);
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
  };
}
function gnCleanupModalA11y(overlay) {
  if (overlay && overlay._gnA11yCleanup) overlay._gnA11yCleanup();
}

// ─────────────────────────────────────────────────────────
// FENÊTRE "NOUVEAU PROJET" — choix du type de document
// ─────────────────────────────────────────────────────────
function openNewDocumentTypeModal() {
  closeNewDocumentTypeModal();
  const overlay = document.createElement('div');
  overlay.id = 'gn-type-modal-overlay';
  overlay.className = 'gn-modal-overlay';
  overlay.innerHTML = `
    <div class="gn-modal" role="dialog" aria-modal="true" aria-label="Nouveau projet">
      <h3>Nouveau projet</h3>
      <p class="gn-modal-sub">Quel type d'ouvrage veux-tu écrire ? Ce choix détermine l'éditeur qui s'ouvrira.</p>
      <div class="gn-type-grid">
        <div class="gn-type-card" data-type="texte" role="button" tabindex="0">
          <div class="gn-type-glyph">📖</div>
          <h4>Texte seul</h4>
          <p>Roman, essai, nouvelle. L'éditeur chapitre par chapitre habituel.</p>
        </div>
        <div class="gn-type-card" data-type="roman_graphique" role="button" tabindex="0">
          <div class="gn-type-glyph">🎨</div>
          <h4>Roman graphique</h4>
          <p>Livre illustré : images et texte composés page par page.</p>
        </div>
        <div class="gn-type-card gn-disabled" data-type="bd" role="button" tabindex="0" aria-disabled="true">
          <span class="gn-soon-badge">Bientôt</span>
          <div class="gn-type-glyph">🖼️</div>
          <h4>Bande dessinée</h4>
          <p>Cases et bulles. Arrive dans une prochaine étape.</p>
        </div>
      </div>
      <div class="gn-modal-actions">
        <button class="action-btn u-bg-h7f8c8d" id="gn-type-cancel" type="button">Annuler</button>
        <button class="action-btn" id="gn-type-continue" type="button" disabled>Continuer</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  let chosen = null;
  overlay.querySelectorAll('.gn-type-card:not(.gn-disabled)').forEach(card => {
    const pick = () => {
      overlay.querySelectorAll('.gn-type-card').forEach(c => c.classList.remove('gn-selected'));
      card.classList.add('gn-selected');
      chosen = card.dataset.type;
      document.getElementById('gn-type-continue').disabled = false;
    };
    card.addEventListener('click', pick);
    card.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); pick(); } });
  });
  document.getElementById('gn-type-cancel').addEventListener('click', closeNewDocumentTypeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeNewDocumentTypeModal(); });
  document.getElementById('gn-type-continue').addEventListener('click', () => {
    closeNewDocumentTypeModal();
    if (chosen === 'roman_graphique') createNewGraphicNovel();
    else if (chosen === 'texte') createNewTextDocument();
  });
  gnWireModalA11y(overlay, closeNewDocumentTypeModal);
}
function closeNewDocumentTypeModal() {
  const el = document.getElementById('gn-type-modal-overlay');
  if (el) { gnCleanupModalA11y(el); el.remove(); }
}

// ─────────────────────────────────────────────────────────
// CONSTRUCTION DE L'ÉCRAN (une seule fois, injectée dans <body>)
// ─────────────────────────────────────────────────────────
function ensureGraphicNovelScreen() {
  if (_gnBuilt) return;
  _gnBuilt = true;
  const el = document.createElement('div');
  el.id = 'graphicnovel-screen';
  el.innerHTML = `
    <div class="gn-toolbar">
      <button class="gn-icon-btn" id="gn-back-btn" title="Retour à la bibliothèque" aria-label="Retour à la bibliothèque">←</button>
      <div class="gn-title-block">
        <div class="gn-doc-name" id="gn-doc-title" contenteditable="true" spellcheck="false" title="Cliquer pour renommer"></div>
        <div class="gn-doc-kind">Roman graphique</div>
      </div>
      <div class="gn-pager">
        <button id="gn-page-prev" title="Page précédente" aria-label="Page précédente">‹</button>
        <span id="gn-page-label"></span>
        <button id="gn-page-next" title="Page suivante" aria-label="Page suivante">›</button>
      </div>
      <div class="gn-tb-tools">
        <button class="gn-icon-btn" id="gn-undo-btn" title="Annuler (Ctrl+Z)" disabled>↶</button>
        <button class="gn-icon-btn" id="gn-redo-btn" title="Rétablir (Ctrl+Y)" disabled>↷</button>
        <button class="gn-icon-btn" id="gn-add-image-btn" title="Ajouter une image libre sur la page">🖼️+</button>
        <button class="gn-icon-btn" id="gn-add-text-btn" title="Ajouter un bloc de texte libre sur la page">🔤+</button>
        <button class="gn-icon-btn gn-active" id="gn-grid-toggle" title="Grille magnétique (alignement précis)">▦</button>
        <button class="gn-icon-btn gn-trash-btn" id="gn-trash-btn" title="Corbeille (pages et éléments supprimés, récupérables 30 jours)">🗑️<span class="trash-badge" id="gn-trash-badge"></span></button>
      </div>
      <button class="action-btn" id="gn-export-btn" title="Exporter le livre en PDF qualité impression (choix du format, de la résolution et du fond perdu à l'étape suivante)">Exporter le PDF</button>
      <button class="action-btn" id="gn-export-book-btn" title="Exporter le livre en ZIP (images), DOCX, EPUB ou ODT — pour partager ou lire hors de l'application (pas pour l'impression professionnelle, voir « Exporter le PDF »)">Exporter le livre</button>
    </div>
    <div class="gn-body">
      <div class="gn-side-pages">
        <div class="gn-side-label">Pages</div>
        <div class="gn-pages-list" id="gn-pages-list"></div>
        <button class="gn-pg-add" id="gn-page-add" title="Ajouter une page">+</button>
      </div>
      <div class="gn-canvas-wrap">
        <div class="gn-page-canvas" id="gn-canvas"></div>
      </div>
      <div class="gn-side-right">
        <div id="gn-imgprops-block" hidden>
          <div class="gn-side-label">Image sélectionnée</div>
          <div class="gn-imgprops" id="gn-imgprops"></div>
        </div>
        <div id="gn-txtprops-block" hidden>
          <div class="gn-side-label">Texte sélectionné</div>
          <div class="gn-txtprops" id="gn-txtprops"></div>
        </div>
        <div class="gn-side-label">Page</div>
        <div class="gn-pageprops" id="gn-pageprops"></div>
        <div class="gn-side-label gn-mt">Gabarits</div>
        <div class="gn-gabarits" id="gn-gabarits"></div>
        <div class="gn-side-label gn-mt">Calques — page active</div>
        <div class="gn-layers" id="gn-layers"></div>
      </div>
    </div>
    <p class="gn-mobile-note">Sur téléphone : choisis un gabarit et remplace les images. Le positionnement libre précis se fait sur ordinateur.</p>`;
  document.body.appendChild(el);
  gnWireEvents();
}

function gnWireEvents() {
  document.getElementById('gn-back-btn').addEventListener('click', backToLibraryFromGraphicNovel);
  document.getElementById('gn-export-book-btn').addEventListener('click', gnOpenBookExportModal);
  document.getElementById('gn-doc-title').addEventListener('blur', e => updateGraphicNovelTitle(e.target.textContent));
  document.getElementById('gn-doc-title').addEventListener('keydown', e => { if (e.key==='Enter') { e.preventDefault(); e.target.blur(); } });
  document.getElementById('gn-page-prev').addEventListener('click', () => gnSetActivePage((_gnActivePage - 1 + db.pages.length) % db.pages.length));
  document.getElementById('gn-page-next').addEventListener('click', () => gnSetActivePage((_gnActivePage + 1) % db.pages.length));
  document.getElementById('gn-page-add').addEventListener('click', gnAddPage);
  document.getElementById('gn-undo-btn').addEventListener('click', gnUndo);
  document.getElementById('gn-redo-btn').addEventListener('click', gnRedo);
  document.getElementById('gn-grid-toggle').addEventListener('click', e => {
    _gnSnapGrid = !_gnSnapGrid;
    e.currentTarget.classList.toggle('gn-active', _gnSnapGrid);
  });
  document.getElementById('gn-add-image-btn').addEventListener('click', () => gnAddFreeElement('image'));
  document.getElementById('gn-add-text-btn').addEventListener('click', () => gnAddFreeElement('text'));
  document.getElementById('gn-export-btn').addEventListener('click', gnOpenExportOptionsModal);
  document.getElementById('gn-trash-btn').addEventListener('click', gnOpenTrashModal);

  // Délégation d'événements sur les listes reconstruites souvent (évite
  // d'empiler des écouteurs à chaque rendu — même principe que
  // wireAppEventListenersOnce dans router.js).
  document.getElementById('gn-pages-list').addEventListener('click', e => {
    const dup = e.target.closest('.gn-pg-dup');
    if (dup) { e.stopPropagation(); gnDuplicatePage(Number(dup.dataset.idx)); return; }
    const del = e.target.closest('.gn-pg-del');
    if (del) { e.stopPropagation(); gnDeletePage(Number(del.dataset.idx)); return; }
    const thumb = e.target.closest('.gn-pg-thumb'); if (!thumb) return;
    gnSetActivePage(Number(thumb.dataset.idx));
  });
  gnWirePageDragReorder();
  document.getElementById('gn-gabarits').addEventListener('click', e => {
    const del = e.target.closest('.gn-gab-del');
    if (del) { e.stopPropagation(); gnDeleteCustomGabarit(del.dataset.id); return; }
    const g = e.target.closest('.gn-gab'); if (!g) return;
    gnPreviewGabarit(g.dataset.key);
  });
  document.getElementById('gn-layers').addEventListener('click', e => {
    const lz = e.target.closest('.gn-lz button');
    if (lz) { e.stopPropagation(); if (!lz.disabled) gnMoveLayer(Number(lz.dataset.idx), lz.dataset.dir); return; }
    const row = e.target.closest('.gn-layer-row'); if (!row) return;
    gnSelectElement(row.dataset.elId);
  });
  // Entrée/Espace équivaut au clic (Lot 9, audit #29) — mêmes touches que
  // .gn-type-card (fenêtre "Nouveau projet"), même convention dans tout le
  // module. e.target === row (pas closest) : évite de redéclencher quand
  // Entrée/Espace est pressée sur un bouton ▲/▼ à l'intérieur de la ligne,
  // qui a déjà son propre comportement natif pour ces touches.
  document.getElementById('gn-layers').addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('.gn-layer-row');
    if (!row || e.target !== row) return;
    e.preventDefault();
    gnSelectElement(row.dataset.elId);
  });

  // Suppression au clavier (Suppr / Retour arrière) de l'élément
  // sélectionné — en plus du 🗑 de la mini-barre. Ignoré pendant la
  // frappe (titre du document, texte d'une page, tout champ éditable) :
  // sinon Retour arrière en train d'écrire supprimerait l'image ou le
  // bloc sélectionné au lieu d'effacer un caractère.
  document.addEventListener('keydown', e => {
    if (!document.body.classList.contains('graphicnovel-mode')) return;
    if (!_gnSelectedElId) return;
    const ae = document.activeElement;
    if (ae && (ae.isContentEditable || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      gnDeleteElement(_gnSelectedElId);
      return;
    }
    // Déplacement au clavier (Lot 5, audit #17) : 1% par appui, 5% avec Maj
    // — mêmes unités et mêmes bornes que le glisser à la souris (gnClamp).
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const page = db.pages[_gnActivePage];
      const el = page.elements.find(x => x.id === _gnSelectedElId);
      if (!el) return;
      e.preventDefault();
      const step = e.shiftKey ? 5 : 1;
      if (e.key === 'ArrowUp') el.y = gnClamp(el.y - step, 0, 100 - el.h);
      if (e.key === 'ArrowDown') el.y = gnClamp(el.y + step, 0, 100 - el.h);
      if (e.key === 'ArrowLeft') el.x = gnClamp(el.x - step, 0, 100 - el.w);
      if (e.key === 'ArrowRight') el.x = gnClamp(el.x + step, 0, 100 - el.w);
      saveGraphicNovel();
      gnRenderCanvas();
      gnRenderPagesSidebar();
    }
  });
}

// ─────────────────────────────────────────────────────────
// RENDU
// ─────────────────────────────────────────────────────────
function renderGraphicNovelScreen() {
  gnRenderPagesSidebar();
  gnRenderGabaritsPanel();
  gnRenderCanvas();
  gnRenderLayers();
  gnRenderPageProps();
  const label = document.getElementById('gn-page-label');
  if (label) label.textContent = 'Page ' + (_gnActivePage + 1) + ' / ' + db.pages.length;
}

// Fond de la page active (Lot 1) : champ db.pages[i].background, présent
// dans le schéma depuis la toute première version du module mais jamais
// exposé jusqu'ici — la page affichait toujours #f4ecd8 en dur.
function gnRenderPageProps() {
  const box = document.getElementById('gn-pageprops');
  if (!box) return;
  const page = db.pages[_gnActivePage];
  box.innerHTML = `<label class="gn-color-lbl">Fond <input type="color" id="gn-page-bg-picker" value="${page.background || '#f4ecd8'}"></label>
    <button class="action-btn btn-sm gn-mt-sm" id="gn-page-history-btn" title="Versions précédentes de cette page (instantané automatique toutes les 5 minutes)">🕓 Historique de la page</button>
    <button class="action-btn btn-sm gn-mt-sm" id="gn-save-gabarit-btn" title="Enregistrer la disposition de cette page (positions et styles, sans le contenu ni les images) comme gabarit réutilisable">💾 Enregistrer comme gabarit</button>
    <div class="gn-storage-info" id="gn-storage-info" aria-live="polite"></div>`;
  document.getElementById('gn-page-bg-picker').addEventListener('input', e => {
    page.background = e.target.value;
    const canvas = document.getElementById('gn-canvas');
    if (canvas) canvas.style.backgroundColor = page.background;
    saveGraphicNovel();
    gnRenderPagesSidebar(); // reflète la couleur sur la vignette de la page dans la liste
  });
  document.getElementById('gn-page-history-btn').addEventListener('click', gnOpenPageHistoryModal);
  document.getElementById('gn-save-gabarit-btn').addEventListener('click', gnSaveAsCustomGabarit);
  const infoEl = document.getElementById('gn-storage-info');
  if (infoEl) { infoEl.style.fontSize = '11px'; infoEl.style.opacity = '.6'; infoEl.style.marginTop = '6px'; }
  gnUpdateStorageInfo();
}

// Poids des images du document + repère d'occupation du stockage (Lot 8,
// audit #26). Asynchrone et séparé du rendu principal (ci-dessus) pour ne
// pas rendre renderGraphicNovelScreen() lui-même asynchrone — l'affichage
// se complète dès que le calcul (IndexedDB + navigator.storage.estimate)
// revient, sans bloquer le reste de l'interface.
let _gnStorageWarnShown = false; // avertissement une seule fois par session
async function gnUpdateStorageInfo() {
  const el = document.getElementById('gn-storage-info');
  if (!el) return;
  try {
    const totalBytes = await getGraphicImagesTotalSize(_currentDocumentId);
    const mo = totalBytes / (1024 * 1024);
    let txt = `🖼️ Images de ce roman graphique : ${mo < 0.1 ? '< 0,1' : mo.toFixed(1)} Mo`;
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      if (est.quota) {
        const pct = Math.round((est.usage / est.quota) * 100);
        txt += ` — ${pct}% de l'espace de stockage du navigateur utilisé`;
        if (pct >= 80 && !_gnStorageWarnShown) {
          _gnStorageWarnShown = true;
          toast(`⚠️ Espace de stockage bientôt plein (${pct}%). Pense à exporter/sauvegarder ce roman graphique.`, 'error');
        }
      }
    }
    if (document.getElementById('gn-storage-info')) el.textContent = txt;
  } catch (e) { /* purement informatif, jamais bloquant */ }
}

function gnMiniIconHtml(elements) {
  // Pas de style="" en ligne (interdit par la CSP style-src 'self') : les
  // coordonnées passent par des attributs data-*, appliquées ensuite en JS
  // via gnApplyMiniIconStyles().
  return elements.map(z =>
    `<div class="gn-icon-z ${z.type==='image'?'gn-icon-i':'gn-icon-t'}" data-x="${z.x}" data-y="${z.y}" data-w="${z.w}" data-h="${z.h}"></div>`
  ).join('');
}

function gnApplyMiniIconStyles(container) {
  container.querySelectorAll('.gn-icon-z').forEach(el => {
    el.style.left = el.dataset.x + '%';
    el.style.top = el.dataset.y + '%';
    el.style.width = el.dataset.w + '%';
    el.style.height = el.dataset.h + '%';
  });
}

function gnRenderPagesSidebar() {
  const box = document.getElementById('gn-pages-list');
  // Lot 5 (audit #16) : draggable="true" pour la réorganisation par glisser
  // (voir gnWirePageDragReorder) — PC uniquement, comme le reste de l'édition
  // libre du module (gnIsDesktop).
  box.innerHTML = db.pages.map((p, i) => `
    <div class="gn-pg-thumb${i===_gnActivePage?' gn-active':''}" data-idx="${i}" title="Page ${i+1}"${gnIsDesktop()?' draggable="true"':''}>
      ${gnMiniIconHtml(p.elements)}
      <span class="gn-pg-num">${i+1}</span>
      <button class="gn-pg-dup" data-idx="${i}" title="Dupliquer la page ${i+1}" aria-label="Dupliquer la page ${i+1}">⧉</button>
      <button class="gn-pg-del" data-idx="${i}" title="Supprimer la page ${i+1}" aria-label="Supprimer la page ${i+1}">✕</button>
    </div>`).join('');
  // Fond de vignette : propriété JS .style.backgroundColor, jamais l'attribut
  // style="" (voir note CSP ci-dessus).
  box.querySelectorAll('.gn-pg-thumb').forEach((el, i) => {
    el.style.backgroundColor = db.pages[i].background || '#f4ecd8';
  });
  gnApplyMiniIconStyles(box);
}

// Gabarits personnalisés (Lot 5, audit #20) : même « forme » {label, build()}
// que les gabarits fournis (GRAPHIC_GABARITS, schema.js), pour que tout le
// reste du module (aperçu, application, mini-icônes) n'ait pas à distinguer
// les deux origines — seule cette fonction sait qu'une clé "custom:<id>"
// pointe vers db.customGabarits plutôt que vers GRAPHIC_GABARITS.
function gnResolveGabarit(key) {
  if (!key) return null;
  if (key.startsWith('custom:')) {
    const cg = (db.customGabarits || []).find(g => g.id === key.slice(7));
    if (!cg) return null;
    return {
      label: cg.label,
      build: () => cg.elements.map(e => {
        if (e.type === 'image') {
          const el = makeImageElement(e.x, e.y, e.w, e.h);
          el.fit = e.fit; el.frameShape = e.frameShape;
          return el;
        }
        return makeTextElement(e.x, e.y, e.w, e.h, {
          fontFamily: e.fontFamily, fontSize: e.fontSize, align: e.align, bold: e.bold, italic: e.italic,
          lineHeight: e.lineHeight, letterSpacing: e.letterSpacing, color: e.color, background: e.background,
          bgOpacity: e.bgOpacity, textEffect: e.textEffect
        });
      })
    };
  }
  return GRAPHIC_GABARITS[key] || null;
}
function gnRenderGabaritsPanel() {
  const box = document.getElementById('gn-gabarits');
  const builtin = GRAPHIC_GABARIT_ORDER.map(key => `
    <div class="gn-gab${_gnPreviewGabarit===key?' gn-active':''}" data-key="${key}">
      <div class="gn-icon">${gnMiniIconHtml(GRAPHIC_GABARITS[key].build())}</div>
      <span class="gn-gab-lbl">${GRAPHIC_GABARITS[key].label}</span>
    </div>`).join('');
  const custom = (db.customGabarits || []).map(cg => `
    <div class="gn-gab${_gnPreviewGabarit==='custom:'+cg.id?' gn-active':''}" data-key="custom:${cg.id}">
      <button class="gn-gab-del" data-id="${cg.id}" title="Supprimer ce gabarit personnalisé" aria-label="Supprimer ce gabarit personnalisé">✕</button>
      <div class="gn-icon">${gnMiniIconHtml(cg.elements)}</div>
      <span class="gn-gab-lbl">${DOMPurify.sanitize(cg.label)}</span>
    </div>`).join('');
  box.innerHTML = builtin + custom;
  gnApplyMiniIconStyles(box);
}

// exportMode (voir gnExportGraphicNovelPDF, section EXPORT PDF plus bas) :
// rendu "propre" pour la capture haute résolution — aucune poignée/mini-
// barre/grille, et les éléments vides (image sans imageId, texte sans
// contenu) ne sont pas dessinés du tout (page de fond visible à la place).
async function gnRenderCanvas(exportMode) {
  const canvas = document.getElementById('gn-canvas');
  canvas.innerHTML = '';
  // Fond de page (Lot 1) : longhand backgroundColor, jamais le raccourci
  // "background" — sinon ça écraserait aussi background-image (la grille
  // pointillée d'édition, posée par la classe CSS .gn-page-canvas).
  canvas.style.backgroundColor = (db.pages[_gnActivePage] && db.pages[_gnActivePage].background) || '';
  const preview = !!_gnPreviewGabarit && !exportMode;
  let elements;
  if (preview) {
    const banner = document.createElement('div');
    banner.className = 'gn-preview-banner';
    const gab = gnResolveGabarit(_gnPreviewGabarit);
    banner.innerHTML = `<span>Aperçu du gabarit « ${gab ? DOMPurify.sanitize(gab.label) : ''} » — non appliqué</span><button id="gn-apply-gab">Appliquer à cette page</button>`;
    canvas.appendChild(banner);
    banner.querySelector('#gn-apply-gab').addEventListener('click', gnApplyPreviewGabarit);
    elements = gab ? gab.build() : [];
  } else {
    elements = db.pages[_gnActivePage].elements;
  }
  const wrap = document.createElement('div');
  wrap.className = 'gn-zone-wrap';
  if (preview) wrap.classList.add('gn-zone-wrap-preview');
  canvas.appendChild(wrap);
  for (const el of elements) {
    // Export : un élément vide ne laisse aucune trace visuelle dans le PDF
    // (ni cadre pointillé "Ajouter une image", ni espace de saisie "Texte…").
    if (exportMode && el.type === 'image' && !el.imageId) continue;
    if (exportMode && el.type === 'text' && !(el.content || '').trim()) continue;
    const zone = document.createElement('div');
    zone.className = 'gn-zone ' + (el.type === 'image' ? 'gn-zone-img' : 'gn-zone-txt');
    zone.style.left = el.x + '%'; zone.style.top = el.y + '%';
    zone.style.width = el.w + '%'; zone.style.height = el.h + '%';
    zone.dataset.elId = el.id || '';
    if (!preview && el.id === _gnSelectedElId) zone.classList.add('gn-selected');
    if (el.type === 'image') {
      if (el.type === 'image' && el.frameShape && el.frameShape !== 'rect') zone.classList.add('gn-shape-' + el.frameShape);
      if (el.imageId) {
        const url = await graphicImageUrl(el.imageId);
        const lowRes = Math.max(el.imageW||0, el.imageH||0) < 1200;
        zone.innerHTML = `<div class="gn-frame-fill"><img class="gn-pannable" draggable="false" src="${url||''}" alt=""></div>` +
          (lowRes && !exportMode ? `<span class="gn-dpi-warn" title="Résolution basse pour une impression nette">⚠ basse résolution</span>` : '');
        if (!preview && !exportMode) gnMakePannable(zone.querySelector('.gn-frame-fill'), el);
      } else if (!preview && !exportMode) {
        zone.classList.add('gn-zone-empty');
        zone.innerHTML = `<span class="gn-empty-plus">+</span><span class="gn-empty-label">Ajouter une image</span>`;
        // Zone vide : un clic ouvre directement le sélecteur de fichier —
        // pas besoin de la sélectionner d'abord.
        zone.addEventListener('click', e => { e.stopPropagation(); gnPickImageFor(el); });
      }
    } else {
      if (preview) {
        // Bug corrigé (tests) : classList.add('') lève une exception — la
        // plupart des gabarits (tous sauf "Texte seul") ont des zones de
        // texte sans el.align==='center', ce qui coupait le rendu de
        // l'aperçu en plein milieu à chaque fois.
        if (el.align === 'center') zone.classList.add('gn-zone-title');
        zone.innerHTML = `<div class="gn-zt-body">${el.align==='center' ? 'Titre de la page' : 'Texte…'}</div>`;
      } else {
        zone.contentEditable = exportMode ? 'false' : 'true';
        zone.spellcheck = false;
        zone.textContent = el.content || '';
        zone.dataset.placeholder = 'Texte…';
        gnApplyTextStyle(zone, el);
        if (!exportMode) {
          // Bug corrigé (tests réels) : la poignée ✥ et la mini-barre 🗑 sont
          // des ENFANTS de cette même zone contenteditable (contentEditable
          //="false" empêche seulement leur édition, pas leur présence dans
          // zone.textContent) — sans ce filtre, taper dans le texte incorpore
          // silencieusement leurs glyphes au contenu sauvegardé. Même
          // principe pour le badge de débordement (Lot 2, audit #2).
          zone.addEventListener('input', () => {
            const clone = zone.cloneNode(true);
            clone.querySelectorAll('.gn-mini-toolbar, .gn-move-handle, .gn-handle, .gn-overflow-warn').forEach(n => n.remove());
            el.content = clone.textContent;
            saveGraphicNovel();
            gnCheckTextOverflow(zone);
          });
          zone.addEventListener('pointerdown', e => e.stopPropagation());
        }
      }
    }
    if (!preview && !exportMode) {
      // Sélectionner (fait apparaître poignées + mini-barre) — pour une
      // image déjà remplie, remplacer se fait via 🔁 dans la mini-barre,
      // pas en recliquant dessus (sinon le sélecteur de fichier se
      // rouvrirait à chaque clic, y compris pour juste déplacer l'image).
      zone.addEventListener('click', e => { if (el.type!=='text') { e.stopPropagation(); gnSelectElement(el.id); } });
      if (gnIsDesktop()) gnMakeDraggable(zone, el);
      if (el.id === _gnSelectedElId) {
        // Poignées de redimensionnement : PC uniquement (glisser précis).
        // Sur mobile, seuls "changer l'image" / "supprimer" restent
        // disponibles (décision prise avec l'utilisateur sur la maquette).
        if (gnIsDesktop()) ['nw','ne','sw','se'].forEach(pos => {
          const h = document.createElement('div');
          h.className = 'gn-handle gn-handle-' + pos;
          gnMakeResizable(h, zone, el, pos);
          zone.appendChild(h);
        });
        // Le texte, lui, est directement éditable (contenteditable) : un
        // clic-glisse dans la zone place le curseur, il ne peut donc pas
        // aussi servir à déplacer le bloc. Poignée dédiée ✥ au-dessus,
        // exclue de l'édition (contenteditable="false").
        if (el.type === 'text' && gnIsDesktop()) {
          const mh = document.createElement('div');
          mh.className = 'gn-move-handle';
          mh.contentEditable = 'false';
          mh.title = 'Déplacer ce bloc de texte';
          mh.textContent = '✥';
          gnMakeMovableViaHandle(mh, zone, el);
          zone.appendChild(mh);
        }
        const mt = document.createElement('div'); mt.className = 'gn-mini-toolbar';
        mt.innerHTML = (el.type==='image' && el.imageId ? `<button data-act="recadrer" title="Recadrer (déplacer l'image dans le cadre)" class="${_gnPanMode ? 'gn-active' : ''}">✥</button>` : '') +
          (el.type==='image' ? '<button data-act="change" title="Changer l\'image">🔁</button>' : '') +
          (el.type==='image' && el.imageId ? '<button data-act="reset" title="Réinitialiser le cadrage">↺</button>' : '') +
          '<button data-act="delete" title="Supprimer cet élément (ou touche Suppr)">🗑</button>';
        mt.addEventListener('pointerdown', e => e.stopPropagation());
        mt.addEventListener('click', e => {
          // Bug corrigé (tests réels) : sans ceci, le clic remontait jusqu'au
          // gestionnaire de sélection de la zone (gnSelectElement), qui
          // réinitialise _gnPanMode juste après que ✥ vienne de l'activer —
          // le bouton "Recadrer" semblait alors ne jamais réagir.
          e.stopPropagation();
          const act = e.target.closest('button')?.dataset.act;
          if (act === 'delete') gnDeleteElement(el.id);
          if (act === 'change') gnPickImageFor(el);
          if (act === 'reset') { el.focusX=50; el.focusY=50; el.zoom=100; el.rotation=0; saveGraphicNovel(); gnRenderCanvas(); }
          if (act === 'recadrer') {
            _gnPanMode = !_gnPanMode;
            e.currentTarget.querySelector('[data-act="recadrer"]').classList.toggle('gn-active', _gnPanMode);
          }
        });
        zone.appendChild(mt);
      }
    }
    wrap.appendChild(zone);
    if (el.type === 'image' && el.imageId && !preview) gnApplyImageTransform(zone, el);
    if (el.type === 'text' && !preview && !exportMode) gnCheckTextOverflow(zone);
  }
  // Repère de zone de sécurité (Lot 2, audit #6) : liseré indicatif en
  // retrait du bord de page, pour ne pas placer d'élément important trop
  // près de la coupe. Approximatif par nature (le format réel n'est choisi
  // qu'à l'export, voir #8) — basé sur le format standard, en pourcentage
  // donc valable quel que soit le format choisi ensuite. Décoratif, jamais
  // dans l'export (exportMode).
  if (!exportMode) {
    const safe = document.createElement('div');
    safe.className = 'gn-safe-zone';
    safe.style.left = GN_SAFE_MARGIN_PCT_W + '%';
    safe.style.right = GN_SAFE_MARGIN_PCT_W + '%';
    safe.style.top = GN_SAFE_MARGIN_PCT_H + '%';
    safe.style.bottom = GN_SAFE_MARGIN_PCT_H + '%';
    canvas.appendChild(safe);
  }
  canvas.onclick = gnDeselectOnBackdrop;
  if (!exportMode) { gnRenderImageProps(); gnRenderTextProps(); }
}

// Débordement de texte (Lot 2, audit #2) : un texte trop long est rogné en
// silence par overflow:hidden sur .gn-zone-txt, y compris dans le PDF final.
// Signale-le par un badge, même principe que le badge "basse résolution"
// des images. Retire d'abord tout badge existant avant de mesurer, pour ne
// pas fausser scrollHeight avec le badge du rendu précédent.
function gnCheckTextOverflow(zone) {
  const existing = zone.querySelector('.gn-overflow-warn');
  if (existing) existing.remove();
  if (zone.scrollHeight - 1 <= zone.clientHeight) return;
  const badge = document.createElement('span');
  badge.className = 'gn-overflow-warn';
  badge.contentEditable = 'false';
  badge.title = 'Texte tronqué : dépasse le cadre, sera coupé à l\'impression';
  badge.textContent = '⚠ texte tronqué';
  zone.appendChild(badge);
}
function gnDeselectOnBackdrop(e) {
  if (e.target.id === 'gn-canvas' || e.target.classList.contains('gn-zone-wrap')) gnSelectElement(null);
}

function gnRenderLayers() {
  const box = document.getElementById('gn-layers');
  const elements = db.pages[_gnActivePage].elements;
  // role/tabindex/aria (Lot 9, audit #29) : ce panneau est jusqu'ici le SEUL
  // moyen de sélectionner un bloc de texte sans entrer directement en mode
  // édition (sur le canevas, cliquer un bloc de texte place le curseur —
  // voir gnRenderCanvas) — c'est donc le point le plus simple et le plus
  // sûr pour rendre la sélection atteignable au clavier, pour les images
  // comme pour le texte, sans toucher à la zone d'édition elle-même.
  box.innerHTML = elements.map((el, i) => {
    const label = el.type === 'image' ? (el.imageId ? 'Image' : 'Image (vide)') : (el.content ? el.content.slice(0,28) : 'Bloc de texte vide');
    return `
    <div class="gn-layer-row${el.id===_gnSelectedElId?' gn-sel':''}" data-el-id="${el.id}" role="button" tabindex="0" aria-pressed="${el.id===_gnSelectedElId}" aria-label="Sélectionner : ${DOMPurify.sanitize(label)}">
      <span class="gn-lg">${el.type==='image'?'🖼️':'🔤'}</span>
      <span class="gn-lname">${DOMPurify.sanitize(label)}</span>
      <span class="gn-lz">
        <button data-dir="up" data-idx="${i}" title="Passer au premier plan" ${i===elements.length-1?'disabled':''}>▲</button>
        <button data-dir="down" data-idx="${i}" title="Passer à l'arrière-plan" ${i===0?'disabled':''}>▼</button>
      </span>
    </div>`;
  }).join('') || '<p class="gn-layers-empty">Page vide — choisis un gabarit ou ajoute un élément.</p>';
}
// Ordre du tableau elements = ordre d'empilement (le dernier est dessiné
// au premier plan) — "monter/descendre" échange l'élément avec son voisin.
function gnMoveLayer(idx, dir) {
  const elements = db.pages[_gnActivePage].elements;
  const j = dir === 'up' ? idx + 1 : idx - 1;
  if (j < 0 || j >= elements.length) return;
  [elements[idx], elements[j]] = [elements[j], elements[idx]];
  saveGraphicNovel();
  gnRenderCanvas();
  gnRenderLayers();
}

// ─────────────────────────────────────────────────────────
// PANNEAU "IMAGE SÉLECTIONNÉE" — cadrage avancé (zoom, rotation, forme)
// ─────────────────────────────────────────────────────────
const GN_FRAME_SHAPES = [
  { key:'rect',    glyph:'▭', title:'Rectangle' },
  { key:'rounded', glyph:'▢', title:'Coins arrondis' },
  { key:'oval',    glyph:'⬭', title:'Ovale / cercle' }
];
function gnCurrentSelectedImageEl() {
  if (!_gnSelectedElId) return null;
  const el = (db.pages[_gnActivePage].elements || []).find(e => e.id === _gnSelectedElId);
  return (el && el.type === 'image' && el.imageId) ? el : null;
}
function gnRenderImageProps() {
  const block = document.getElementById('gn-imgprops-block');
  const box = document.getElementById('gn-imgprops');
  const el = gnCurrentSelectedImageEl();
  if (!el) { block.hidden = true; box.innerHTML = ''; return; }
  block.hidden = false;
  box.innerHTML = `
    <div class="gn-side-label">Ajustement</div>
    <div class="gn-shape-row">
      <button class="gn-shape-btn${el.fit!=='contain'?' gn-active':''}" data-fit="cover" title="Remplit tout le cadre (recadre l'image si besoin)">▣</button>
      <button class="gn-shape-btn${el.fit==='contain'?' gn-active':''}" data-fit="contain" title="Image entière visible (peut laisser des marges dans le cadre)">▢</button>
    </div>
    <div class="gn-prop-label gn-mt-sm"><span>Zoom</span><span class="gn-prop-val" id="gn-zoom-val">${Math.round(el.zoom)}%</span></div>
    <input type="range" id="gn-zoom-slider" min="100" max="300" value="${el.zoom}">
    <div class="gn-prop-label gn-mt-sm"><span>Rotation</span><span class="gn-prop-val" id="gn-rot-val">${Math.round(el.rotation)}°</span></div>
    <input type="range" id="gn-rot-slider" min="-180" max="180" value="${el.rotation}">
    <div class="gn-imgprops-hint">En mode ✥ Recadrer (mini-barre sur l'image), glisse dans le cadre pour repositionner l'image.</div>
    <div class="gn-side-label gn-mt-sm">Forme du cadre</div>
    <div class="gn-shape-row">
      ${GN_FRAME_SHAPES.map(s => `<button class="gn-shape-btn${el.frameShape===s.key?' gn-active':''}" data-shape="${s.key}" title="${s.title}">${s.glyph}</button>`).join('')}
    </div>
    <div class="gn-side-label gn-mt-sm">Texte alternatif</div>
    <input type="text" id="gn-alt-input" class="gn-alt-input" placeholder="Décrit l'image (accessibilité)" title="Texte alternatif : décrit l'image pour les lecteurs d'écran (non visible à l'impression)">`;
  // Affecté après coup via .value (jamais interpolé dans le template ci-dessus)
  // : el.alt est du texte libre saisi par l'utilisateur, contrairement aux
  // autres champs de ce panneau qui sont tous des valeurs contrôlées
  // (couleurs, nombres, clés fixes) — même précaution que pour el.content.
  document.getElementById('gn-alt-input').value = el.alt || '';
  const zoneEl = document.querySelector(`.gn-zone[data-el-id="${el.id}"]`);
  box.querySelectorAll('[data-fit]').forEach(btn => {
    btn.addEventListener('click', () => {
      el.fit = btn.dataset.fit;
      box.querySelectorAll('[data-fit]').forEach(b => b.classList.remove('gn-active'));
      btn.classList.add('gn-active');
      if (zoneEl) gnApplyImageTransform(zoneEl, el);
      saveGraphicNovel();
    });
  });
  document.getElementById('gn-zoom-slider').addEventListener('input', e => {
    el.zoom = +e.target.value;
    document.getElementById('gn-zoom-val').textContent = el.zoom + '%';
    if (zoneEl) gnApplyImageTransform(zoneEl, el);
    saveGraphicNovel();
  });
  document.getElementById('gn-rot-slider').addEventListener('input', e => {
    el.rotation = +e.target.value;
    document.getElementById('gn-rot-val').textContent = el.rotation + '°';
    if (zoneEl) gnApplyImageTransform(zoneEl, el);
    saveGraphicNovel();
  });
  box.querySelectorAll('[data-shape]').forEach(btn => {
    btn.addEventListener('click', () => {
      el.frameShape = btn.dataset.shape;
      saveGraphicNovel();
      gnRenderCanvas();
    });
  });
  document.getElementById('gn-alt-input').addEventListener('input', e => {
    el.alt = e.target.value;
    if (zoneEl) { const img = zoneEl.querySelector('img'); if (img) img.alt = el.alt; }
    saveGraphicNovel();
  });
}

// ─────────────────────────────────────────────────────────
// PANNEAU "TEXTE SÉLECTIONNÉ" — mise en forme professionnelle
// ─────────────────────────────────────────────────────────
// Clés stables (voir schema.js/makeTextElement) → police CSS réelle.
const GN_TEXT_FONTS = {
  palatino:   { label:'Classique (Palatino)',  css:"'Palatino Linotype',Georgia,serif" },
  georgia:    { label:'Roman (Georgia)',        css:"Georgia,'Palatino Linotype',serif" },
  sansserif:  { label:'Moderne (sans-serif)',   css:"-apple-system,'Segoe UI',Roboto,sans-serif" },
  manuscrite: { label:'Manuscrite / dialogue',  css:"'Comic Sans MS','Comic Neue',cursive" },
  machine:    { label:'Machine à écrire',       css:"'Courier New',monospace" }
};
const GN_TEXT_EFFECTS = [
  { key:'none',    label:'Aucun' },
  { key:'shadow',  label:'Ombre' },
  { key:'outline', label:'Liseré' }
];
// Applique tous les réglages de mise en forme d'un bloc de texte à sa zone
// DOM — appelé au rendu et après chaque changement dans le panneau, sans
// reconstruire le contenu (pour ne pas perdre le curseur pendant la frappe).
function gnApplyTextStyle(zone, el) {
  zone.style.fontFamily = (GN_TEXT_FONTS[el.fontFamily] || GN_TEXT_FONTS.palatino).css;
  zone.style.fontSize = (el.fontSize || 16) + 'px';
  zone.style.textAlign = el.align || 'left';
  zone.style.fontWeight = el.bold ? '700' : '400';
  zone.style.fontStyle = el.italic ? 'italic' : 'normal';
  zone.style.lineHeight = String(el.lineHeight || 1.5);
  zone.style.letterSpacing = (el.letterSpacing || 0) + 'px';
  zone.style.color = el.color || '';
  const op = (el.bgOpacity || 0) / 100;
  if (el.background && op > 0) {
    const r = parseInt(el.background.slice(1,3),16), g = parseInt(el.background.slice(3,5),16), b = parseInt(el.background.slice(5,7),16);
    zone.style.background = `rgba(${r},${g},${b},${op})`;
  } else {
    zone.style.background = '';
  }
  zone.style.textShadow = el.textEffect === 'shadow' ? '0 1px 3px rgba(0,0,0,.55)' : (el.textEffect === 'outline' ? '0 1px 2px rgba(0,0,0,.4)' : '');
  zone.style.webkitTextStroke = el.textEffect === 'outline' ? '.4px rgba(255,255,255,.7)' : '';
}
function gnCurrentSelectedTextEl() {
  if (!_gnSelectedElId) return null;
  const el = (db.pages[_gnActivePage].elements || []).find(e => e.id === _gnSelectedElId);
  return (el && el.type === 'text') ? el : null;
}
function gnRenderTextProps() {
  const block = document.getElementById('gn-txtprops-block');
  const box = document.getElementById('gn-txtprops');
  const el = gnCurrentSelectedTextEl();
  if (!el) { block.hidden = true; box.innerHTML = ''; return; }
  block.hidden = false;
  box.innerHTML = `
    <select id="gn-font-sel">
      ${Object.entries(GN_TEXT_FONTS).map(([k,f]) => `<option value="${k}"${el.fontFamily===k?' selected':''}>${f.label}</option>`).join('')}
    </select>
    <div class="gn-toggle-row gn-mt-sm">
      <button class="gn-toggle-btn${el.bold?' gn-active':''}" id="gn-bold-btn" title="Gras"><b>G</b></button>
      <button class="gn-toggle-btn${el.italic?' gn-active':''}" id="gn-italic-btn" title="Italique"><i>I</i></button>
      <button class="gn-toggle-btn${el.align==='left'?' gn-active':''}" data-align="left" title="Aligné à gauche">⟸</button>
      <button class="gn-toggle-btn${el.align==='center'?' gn-active':''}" data-align="center" title="Centré">⟺</button>
      <button class="gn-toggle-btn${el.align==='right'?' gn-active':''}" data-align="right" title="Aligné à droite">⟹</button>
    </div>
    <div class="gn-prop-label gn-mt-sm"><span>Taille</span><span class="gn-prop-val" id="gn-fs-val">${el.fontSize}px</span></div>
    <input type="range" id="gn-fs-slider" min="10" max="42" value="${el.fontSize}">
    <div class="gn-prop-label gn-mt-sm"><span>Interligne</span><span class="gn-prop-val" id="gn-lh-val">${el.lineHeight}</span></div>
    <input type="range" id="gn-lh-slider" min="1" max="2.4" step="0.1" value="${el.lineHeight}">
    <div class="gn-prop-label gn-mt-sm"><span>Espacement lettres</span><span class="gn-prop-val" id="gn-ls-val">${el.letterSpacing}px</span></div>
    <input type="range" id="gn-ls-slider" min="-1" max="6" step="0.5" value="${el.letterSpacing}">
    <div class="gn-side-label gn-mt-sm">Couleur & fond</div>
    <div class="gn-color-row">
      <label class="gn-color-lbl">Texte <input type="color" id="gn-color-picker" value="${el.color || '#3b2f1e'}"></label>
      <label class="gn-color-lbl">Fond <input type="color" id="gn-bg-picker" value="${el.background || '#f4ecd8'}"></label>
    </div>
    <div class="gn-prop-label gn-mt-sm"><span>Opacité du fond</span><span class="gn-prop-val" id="gn-bgop-val">${el.bgOpacity}%</span></div>
    <input type="range" id="gn-bgop-slider" min="0" max="100" value="${el.bgOpacity}">
    <div class="gn-side-label gn-mt-sm">Lisibilité</div>
    <div class="gn-toggle-row">
      ${GN_TEXT_EFFECTS.map(fx => `<button class="gn-toggle-btn${el.textEffect===fx.key?' gn-active':''}" data-effect="${fx.key}">${fx.label}</button>`).join('')}
    </div>
    <div class="gn-side-label gn-mt-sm">Assistance IA</div>
    <button class="action-btn btn-sm" id="gn-ai-rephrase-btn" title="Envoie ce texte à l'IA pour proposer une reformulation (service externe — voir la notice affichée au premier usage)">✨ Reformuler</button>
    <div id="gn-ai-rephrase-box" class="gn-mt-sm" hidden></div>`;
  const zoneEl = document.querySelector(`.gn-zone[data-el-id="${el.id}"]`);
  const reapply = () => { if (zoneEl) gnApplyTextStyle(zoneEl, el); saveGraphicNovel(); };
  document.getElementById('gn-font-sel').addEventListener('change', e => { el.fontFamily = e.target.value; reapply(); });
  document.getElementById('gn-bold-btn').addEventListener('click', e => { el.bold = !el.bold; e.currentTarget.classList.toggle('gn-active', el.bold); reapply(); });
  document.getElementById('gn-italic-btn').addEventListener('click', e => { el.italic = !el.italic; e.currentTarget.classList.toggle('gn-active', el.italic); reapply(); });
  box.querySelectorAll('[data-align]').forEach(btn => btn.addEventListener('click', () => {
    el.align = btn.dataset.align;
    box.querySelectorAll('[data-align]').forEach(b => b.classList.remove('gn-active'));
    btn.classList.add('gn-active');
    reapply();
  }));
  document.getElementById('gn-fs-slider').addEventListener('input', e => { el.fontSize = +e.target.value; document.getElementById('gn-fs-val').textContent = el.fontSize+'px'; reapply(); });
  document.getElementById('gn-lh-slider').addEventListener('input', e => { el.lineHeight = +e.target.value; document.getElementById('gn-lh-val').textContent = el.lineHeight; reapply(); });
  document.getElementById('gn-ls-slider').addEventListener('input', e => { el.letterSpacing = +e.target.value; document.getElementById('gn-ls-val').textContent = el.letterSpacing+'px'; reapply(); });
  document.getElementById('gn-color-picker').addEventListener('input', e => { el.color = e.target.value; reapply(); });
  document.getElementById('gn-bg-picker').addEventListener('input', e => { el.background = e.target.value; reapply(); });
  document.getElementById('gn-bgop-slider').addEventListener('input', e => { el.bgOpacity = +e.target.value; document.getElementById('gn-bgop-val').textContent = el.bgOpacity+'%'; reapply(); });
  box.querySelectorAll('[data-effect]').forEach(btn => btn.addEventListener('click', () => {
    el.textEffect = btn.dataset.effect;
    box.querySelectorAll('[data-effect]').forEach(b => b.classList.remove('gn-active'));
    btn.classList.add('gn-active');
    reapply();
  }));
  document.getElementById('gn-ai-rephrase-btn').addEventListener('click', () => gnRephraseSelectedText(el.id));
}
// Assistance IA (Lot 6, audit #22) : reformulation du bloc de texte
// sélectionné. Réutilise callClaude() (ai.js) telle quelle — elle ne sait
// rien de db.chapters, un simple texte en entrée suffit — et le même avis
// d'usage tiers que le reste de l'app (notifyThirdPartyDataUseOnce).
// elId gardé en fermeture plutôt que relu via _gnSelectedElId au moment où
// la réponse arrive : si l'utilisateur change de sélection pendant l'appel
// (qui peut prendre plusieurs secondes), on n'écrase pas le panneau d'un
// autre élément avec une réponse qui ne le concerne plus.
async function gnRephraseSelectedText(elId) {
  const page = db.pages[_gnActivePage];
  const el = page && page.elements.find(e => e.id === elId);
  if (!el) return;
  const txt = (el.content || '').trim();
  if (txt.length < 10) { toast('Texte trop court pour être reformulé.', 'error'); return; }
  if (typeof notifyThirdPartyDataUseOnce === 'function') await notifyThirdPartyDataUseOnce();
  const box = document.getElementById('gn-ai-rephrase-box');
  if (!box || _gnSelectedElId !== elId) return;
  box.hidden = false;
  box.innerHTML = '<div class="ai-loader"><div class="ai-dot"></div><div class="ai-dot"></div><div class="ai-dot"></div></div>';
  const stillCurrent = () => _gnSelectedElId === elId && document.getElementById('gn-ai-rephrase-box');
  let result = '';
  try {
    result = await callClaude(
      `Reformule ce texte en français : même sens, style plus fluide, longueur similaire. Réponds uniquement avec le texte reformulé, sans commentaire ni guillemets.\n\n${txt.substring(0, 1500)}`,
      500,
      partial => { const b = stillCurrent(); if (b) b.innerHTML = `<div class="gn-ai-result">${DOMPurify.sanitize(partial).replace(/\n/g,'<br>')}</div>`; }
    );
  } catch (e) {
    const b = stillCurrent();
    if (b) b.innerHTML = `<span class="u-c-v-danger">❌ ${DOMPurify.sanitize(e && e.message ? e.message : String(e))}</span>`;
    return;
  }
  const b = stillCurrent();
  if (!b) return;
  b.innerHTML = `<div class="gn-ai-result">${DOMPurify.sanitize(result).replace(/\n/g,'<br>')}</div>
    <div class="gn-modal-actions gn-mt-sm">
      <button class="action-btn btn-sm u-bg-h7f8c8d" id="gn-ai-rephrase-cancel">Ignorer</button>
      <button class="action-btn btn-sm" id="gn-ai-rephrase-apply">Appliquer</button>
    </div>`;
  document.getElementById('gn-ai-rephrase-cancel').addEventListener('click', () => { b.hidden = true; b.innerHTML = ''; });
  document.getElementById('gn-ai-rephrase-apply').addEventListener('click', () => {
    const target = page.elements.find(e => e.id === elId);
    if (!target) return;
    target.content = result;
    const zoneEl = document.querySelector('.gn-zone[data-el-id="' + elId + '"]');
    if (zoneEl) { zoneEl.textContent = result; gnCheckTextOverflow(zoneEl); }
    saveGraphicNovel();
    b.hidden = true; b.innerHTML = '';
  });
}

// ─────────────────────────────────────────────────────────
// ACTIONS
// ─────────────────────────────────────────────────────────
function gnSetActivePage(i) {
  _gnActivePage = i; _gnSelectedElId = null; _gnPreviewGabarit = null;
  renderGraphicNovelScreen();
}
function gnPreviewGabarit(key) { _gnPreviewGabarit = key; gnRenderGabaritsPanel(); gnRenderCanvas(); }
// Enregistrer la page active comme gabarit réutilisable (Lot 5, audit #20) :
// uniquement la disposition (positions/tailles/types/mise en forme du
// texte) — jamais le contenu ni les images, pour rester un vrai gabarit
// vide comme les modèles fournis. Nommage immédiat automatique (même
// principe que addItem() dans database.js : un seul clic suffit), pas de
// fenêtre de saisie.
function gnSaveAsCustomGabarit() {
  const page = db.pages[_gnActivePage];
  if (!page.elements.length) { toast('Page vide — rien à enregistrer comme gabarit.', 'error'); return; }
  if (!db.customGabarits) db.customGabarits = [];
  const elements = page.elements.map(el => el.type === 'image'
    ? { type:'image', x:el.x, y:el.y, w:el.w, h:el.h, fit:el.fit, frameShape:el.frameShape }
    : { type:'text', x:el.x, y:el.y, w:el.w, h:el.h, fontFamily:el.fontFamily, fontSize:el.fontSize,
        align:el.align, bold:el.bold, italic:el.italic, lineHeight:el.lineHeight, letterSpacing:el.letterSpacing,
        color:el.color, background:el.background, bgOpacity:el.bgOpacity, textEffect:el.textEffect });
  db.customGabarits.push({ id: genPageId(), label: 'Mon gabarit ' + (db.customGabarits.length + 1), elements });
  saveGraphicNovel();
  gnRenderGabaritsPanel();
  toast('Gabarit personnalisé enregistré.', 'success');
}
function gnDeleteCustomGabarit(id) {
  if (!db.customGabarits) return;
  db.customGabarits = db.customGabarits.filter(g => g.id !== id);
  if (_gnPreviewGabarit === 'custom:' + id) _gnPreviewGabarit = null;
  saveGraphicNovel();
  gnRenderGabaritsPanel();
  gnRenderCanvas();
}
function gnApplyPreviewGabarit() {
  const gab = gnResolveGabarit(_gnPreviewGabarit);
  if (!gab) return;
  db.pages[_gnActivePage].elements = gab.build();
  _gnPreviewGabarit = null;
  saveGraphicNovel();
  renderGraphicNovelScreen();
}
function gnAddPage() {
  db.pages.push(defaultGraphicPage('texteSeul'));
  saveGraphicNovel();
  gnSetActivePage(db.pages.length - 1);
}
async function gnDeletePage(i) {
  if (db.pages.length <= 1) { toast('Le manuscrit doit garder au moins une page.', 'error'); return; }
  const ok = await showConfirmModal({ title:'Supprimer cette page ?', message:'Déplacée vers la corbeille — récupérable pendant 30 jours.', confirmLabel:'Supprimer', danger:true });
  if (!ok) return;
  const [removed] = db.pages.splice(i, 1);
  // Corbeille (Lot 3, audit #11) : la page part dans db.trash, images
  // comprises — rien n'est détruit pour de bon avant la purge à 30 jours
  // (gnPurgeOldTrash) ou une suppression définitive manuelle.
  if (!db.trash) db.trash = [];
  db.trash.push({ kind:'gn-page', page: JSON.parse(JSON.stringify(removed)), deletedAt: Date.now() });
  saveGraphicNovel();
  gnSetActivePage(Math.min(_gnActivePage, db.pages.length - 1));
  gnRenderTrashBadge();
  toast('Page déplacée vers la corbeille.', 'success');
}
// Duplication de page (Lot 5, audit #15). Chaque image partage désormais le
// même stockage que l'original (voir duplicateGraphicImage, images.js,
// Lot 8 audit #27 — compteur de références) au lieu d'être recopiée en
// IndexedDB : l'originale et la copie restent tout aussi indépendantes à
// l'usage (supprimer l'une ne casse jamais l'autre), simplement sans
// doubler le stockage pour un contenu identique.
async function gnDuplicatePage(i) {
  const src = db.pages[i];
  if (!src) return;
  toast('Duplication…', 'info');
  const elements = [];
  for (const el of src.elements) {
    const clone = JSON.parse(JSON.stringify(el));
    clone.id = genElementId();
    if (clone.type === 'image' && clone.imageId) {
      const ref = await duplicateGraphicImage(clone.imageId, _currentDocumentId);
      if (ref) { clone.imageId = ref.imageId; clone.imageW = ref.imageW; clone.imageH = ref.imageH; }
      else { clone.imageId = null; clone.imageW = 0; clone.imageH = 0; }
    }
    elements.push(clone);
  }
  const copy = { id: genPageId(), background: src.background, elements };
  db.pages.splice(i + 1, 0, copy);
  saveGraphicNovel();
  gnSetActivePage(i + 1);
  toast('Page dupliquée.', 'success');
}
// Réorganisation des pages par glisser (Lot 5, audit #16) — drag & drop HTML5
// natif, PC uniquement (comme le reste de l'édition libre, voir gnIsDesktop).
// Câblée une seule fois sur le conteneur (délégation), jamais recâblée au
// re-rendu — même principe que les autres listes de gnWireEvents.
let _gnDragPageIdx = null;
function gnWirePageDragReorder() {
  const box = document.getElementById('gn-pages-list');
  const clearDropMarks = () => box.querySelectorAll('.gn-pg-drop-before').forEach(t => t.classList.remove('gn-pg-drop-before'));
  box.addEventListener('dragstart', e => {
    const thumb = e.target.closest('.gn-pg-thumb');
    if (!thumb) return;
    _gnDragPageIdx = Number(thumb.dataset.idx);
    e.dataTransfer.effectAllowed = 'move';
    thumb.classList.add('gn-pg-dragging');
  });
  box.addEventListener('dragend', e => {
    const thumb = e.target.closest('.gn-pg-thumb');
    if (thumb) thumb.classList.remove('gn-pg-dragging');
    clearDropMarks();
    _gnDragPageIdx = null;
  });
  box.addEventListener('dragover', e => {
    if (_gnDragPageIdx === null) return;
    const thumb = e.target.closest('.gn-pg-thumb');
    if (!thumb) return;
    e.preventDefault();
    clearDropMarks();
    thumb.classList.add('gn-pg-drop-before');
  });
  box.addEventListener('drop', e => {
    const from = _gnDragPageIdx;
    clearDropMarks();
    _gnDragPageIdx = null;
    if (from === null) return;
    const thumb = e.target.closest('.gn-pg-thumb');
    if (!thumb) return;
    e.preventDefault();
    const to = Number(thumb.dataset.idx);
    if (from === to) return;
    const [moved] = db.pages.splice(from, 1);
    db.pages.splice(to, 0, moved);
    if (_gnActivePage === from) _gnActivePage = to;
    else if (from < _gnActivePage && to >= _gnActivePage) _gnActivePage--;
    else if (from > _gnActivePage && to <= _gnActivePage) _gnActivePage++;
    saveGraphicNovel();
    renderGraphicNovelScreen();
  });
}
function gnAddFreeElement(type) {
  const page = db.pages[_gnActivePage];
  // Décalage en cascade (audit Lot 1) : sans ça, chaque nouvel élément
  // libre atterrissait exactement à la même position que le précédent, pile
  // empilé dessus — repart à 0 tous les 6 éléments pour rester dans la page.
  const offset = (page.elements.length % 6) * 4;
  const el = type === 'image'
    ? makeImageElement(gnClamp(28 + offset, 0, 56), gnClamp(28 + offset, 0, 66), 44, 34)
    : makeTextElement(gnClamp(28 + offset, 0, 56), gnClamp(65 + offset, 0, 85), 44, 15);
  page.elements.push(el);
  saveGraphicNovel();
  gnSelectElement(el.id);
}
function gnDeleteElement(id) {
  const page = db.pages[_gnActivePage];
  const el = page.elements.find(e => e.id === id);
  if (!el) return;
  // Corbeille (Lot 3, audit #10) : même principe que gnDeletePage ci-dessus.
  // pageId gardé pour restaurer sur la bonne page si elle existe encore.
  if (!db.trash) db.trash = [];
  db.trash.push({ kind:'gn-element', pageId: page.id, element: JSON.parse(JSON.stringify(el)), deletedAt: Date.now() });
  page.elements = page.elements.filter(e => e.id !== id);
  _gnSelectedElId = null;
  saveGraphicNovel();
  renderGraphicNovelScreen();
  gnRenderTrashBadge();
  toast('Élément déplacé vers la corbeille.', 'success');
}
function gnSelectElement(id) {
  _gnSelectedElId = id;
  _gnPanMode = false;
  gnRenderCanvas();
  gnRenderLayers();
}
function gnPickImageFor(el) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  // Masqué mais toujours "rendu" (display:none seul est parfois refusé par le
  // navigateur pour ouvrir le sélecteur de fichier) — hors écran plutôt
  // qu'invisible.
  input.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0;';
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.remove();
    if (!file) return;
    toast('Import de l\'image…', 'info');
    try {
      const ref = await storeGraphicImage(file, _currentDocumentId);
      el.imageId = ref.imageId; el.imageW = ref.imageW; el.imageH = ref.imageH;
      // Nouvelle image : le cadrage précédent (pan/zoom) n'a plus de sens,
      // on repart d'un cadrage neutre (image centrée, cadre plein).
      el.focusX = 50; el.focusY = 50; el.zoom = 100;
      saveGraphicNovel();
      renderGraphicNovelScreen();
    } catch(e) {
      toast('Impossible d\'importer cette image.', 'error');
    }
  });
  document.body.appendChild(input);
  input.click();
}

// ─────────────────────────────────────────────────────────
// GLISSER / REDIMENSIONNER (PC uniquement — voir gnIsDesktop)
// Positions/tailles en % de la page ; accrochage à 2% si _gnSnapGrid actif.
// ─────────────────────────────────────────────────────────
function gnSnap(v) { return _gnSnapGrid ? Math.round(v / 2) * 2 : Math.round(v * 10) / 10; }
function gnClamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// ─────────────────────────────────────────────────────────
// GUIDES D'ALIGNEMENT (Lot 5, audit #19)
// Accroche sur le centre de la page et les bords/centres des AUTRES
// éléments de la page active, en plus de la grille magnétique existante
// (_gnSnapGrid/gnSnap, un concept différent : arrondi à 2%, pas proximité).
// Purement visuel + positionnel pendant le geste — aucun état persistant,
// les guides sont retirés au relâchement (gnOnPointerUp).
// ─────────────────────────────────────────────────────────
const GN_ALIGN_TOLERANCE = 1.2; // % de la page
function gnAlignLines(axis, excludeId) {
  const page = db.pages[_gnActivePage];
  const lines = [50]; // centre de page
  (page.elements || []).forEach(o => {
    if (o.id === excludeId) return;
    if (axis === 'x') lines.push(o.x, o.x + o.w / 2, o.x + o.w);
    else lines.push(o.y, o.y + o.h / 2, o.y + o.h);
  });
  return lines;
}
function gnFindSnapLine(value, lines) {
  let best = null, bestDist = GN_ALIGN_TOLERANCE;
  lines.forEach(l => { const d = Math.abs(value - l); if (d <= bestDist) { bestDist = d; best = l; } });
  return best;
}
function gnClearAlignGuides() {
  document.querySelectorAll('.gn-align-guide').forEach(g => g.remove());
}
function gnShowAlignGuide(axis, pct) {
  const canvas = document.getElementById('gn-canvas');
  if (!canvas) return;
  const g = document.createElement('div');
  g.className = 'gn-align-guide gn-align-guide-' + axis;
  if (axis === 'x') g.style.left = pct + '%'; else g.style.top = pct + '%';
  canvas.appendChild(g);
}

function gnMakeDraggable(zoneEl, el) {
  zoneEl.addEventListener('pointerdown', e => {
    if (e.target.closest('.gn-handle') || e.target.closest('.gn-mini-toolbar')) return;
    if (el.type === 'text') return; // le texte est contenteditable : un clic-glisse dans la zone doit placer le curseur, pas déplacer le bloc — voir la poignée ✥ dédiée (gnMakeMovableViaHandle)
    const canvasRect = document.getElementById('gn-canvas').getBoundingClientRect();
    _gnDrag = { mode:'move', el, zoneEl, startX:e.clientX, startY:e.clientY, origX:el.x, origY:el.y, canvasRect, moved:false };
    zoneEl.setPointerCapture(e.pointerId);
  });
  zoneEl.addEventListener('pointermove', gnOnPointerMove);
  zoneEl.addEventListener('pointerup', gnOnPointerUp);
}
// Déplace un bloc de texte via sa poignée ✥ dédiée — même logique que le
// glisser habituel (mode 'move' de gnOnPointerMove/Up), simplement
// déclenchée depuis la poignée au lieu de toute la zone (qui doit rester
// disponible pour placer le curseur d'édition).
function gnMakeMovableViaHandle(handleEl, zoneEl, el) {
  handleEl.addEventListener('pointerdown', e => {
    e.stopPropagation();
    const canvasRect = document.getElementById('gn-canvas').getBoundingClientRect();
    _gnDrag = { mode:'move', el, zoneEl, startX:e.clientX, startY:e.clientY, origX:el.x, origY:el.y, canvasRect, moved:false };
    handleEl.setPointerCapture(e.pointerId);
  });
  handleEl.addEventListener('pointermove', gnOnPointerMove);
  handleEl.addEventListener('pointerup', gnOnPointerUp);
}
function gnMakeResizable(handleEl, zoneEl, el, pos) {
  handleEl.addEventListener('pointerdown', e => {
    e.stopPropagation();
    const canvasRect = document.getElementById('gn-canvas').getBoundingClientRect();
    _gnDrag = { mode:'resize', pos, el, zoneEl, startX:e.clientX, startY:e.clientY, origX:el.x, origY:el.y, origW:el.w, origH:el.h, canvasRect, moved:false };
    handleEl.setPointerCapture(e.pointerId);
  });
  handleEl.addEventListener('pointermove', gnOnPointerMove);
  handleEl.addEventListener('pointerup', gnOnPointerUp);
}
// Glisser l'image À L'INTÉRIEUR de son cadre (pan) — actif seulement en mode
// "recadrer" (_gnPanMode, togglé via ✥). Hors de ce mode, glisser sur
// l'image déplace le cadre entier sur la page (comportement habituel,
// géré par gnMakeDraggable ci-dessus) : les deux gestes ne peuvent pas
// cohabiter sur le même mouvement de souris, d'où le bouton dédié.
function gnMakePannable(frameEl, el) {
  frameEl.addEventListener('pointerdown', e => {
    if (!_gnPanMode) return;
    e.stopPropagation();
    _gnDrag = {
      mode:'pan', el, frameEl, startX:e.clientX, startY:e.clientY,
      startFocusX: el.focusX, startFocusY: el.focusY,
      frameW: frameEl.clientWidth, frameH: frameEl.clientHeight, moved:false
    };
    frameEl.setPointerCapture(e.pointerId);
  });
  frameEl.addEventListener('pointermove', gnOnPointerMove);
  frameEl.addEventListener('pointerup', gnOnPointerUp);
}
// Calcule et applique le cadrage (pan/zoom/rotation/ajustement) d'une image
// dans son cadre. el.fit==='contain' (nouveau) : l'image entière reste
// visible (peut laisser des marges) — sinon (défaut 'cover') elle couvre
// tout le cadre, quitte à être recadrée. zoom au-delà de 100% agrandit dans
// les deux cas, focusX/focusY déplacent la portion visible quand l'image
// déborde du cadre. La rotation s'applique au cadre-fenêtre (.gn-frame-fill),
// qui reste découpé à la taille du cadre — l'image tourne avec lui.
function gnApplyImageTransform(zoneEl, el) {
  const frameEl = zoneEl && zoneEl.querySelector('.gn-frame-fill');
  const img = frameEl && frameEl.querySelector('img');
  if (!frameEl || !img) return;
  const frameW = frameEl.clientWidth, frameH = frameEl.clientHeight;
  if (!frameW || !frameH) return;
  frameEl.style.transform = el.rotation ? `rotate(${el.rotation}deg)` : '';
  const iw = el.imageW || frameW, ih = el.imageH || frameH;
  const baseScale = el.fit === 'contain' ? Math.min(frameW / iw, frameH / ih) : Math.max(frameW / iw, frameH / ih);
  const scale = baseScale * ((el.zoom || 100) / 100);
  const imgW = iw * scale, imgH = ih * scale;
  const maxX = Math.max(0, imgW - frameW), maxY = Math.max(0, imgH - frameH);
  // Bug évité : quand l'image est plus petite qu'un axe du cadre (fit
  // "contain"), maxX/maxY vaut 0 — sans ce cas à part, l'image restait
  // plaquée en haut à gauche au lieu d'être centrée dans la marge.
  const tx = maxX > 0 ? -((el.focusX ?? 50) / 100) * maxX : (frameW - imgW) / 2;
  const ty = maxY > 0 ? -((el.focusY ?? 50) / 100) * maxY : (frameH - imgH) / 2;
  img.style.width = imgW + 'px'; img.style.height = imgH + 'px';
  img.style.transform = `translate(${tx}px,${ty}px)`;
}
// Bug corrigé (tests réels) : un simple clic (aucun déplacement) déclenchait
// quand même pointerdown → pointerup → sauvegarde + reconstruction complète
// du canvas, ce qui détruisait la zone cliquée AVANT que l'événement "click"
// (sélection, voir gnRenderCanvas) ne l'atteigne — la sélection au clic ne
// fonctionnait donc jamais. On ne considère maintenant que c'est un
// glisser/redimensionnement qu'après quelques pixels de mouvement réel ;
// en dessous, on ne touche à rien et le clic normal fait son travail.
const GN_DRAG_THRESHOLD_PX = 3;
function gnOnPointerMove(e) {
  if (!_gnDrag) return;
  const { mode, el, zoneEl, startX, startY, canvasRect } = _gnDrag;
  if (!_gnDrag.moved) {
    if (Math.abs(e.clientX - startX) < GN_DRAG_THRESHOLD_PX && Math.abs(e.clientY - startY) < GN_DRAG_THRESHOLD_PX) return;
    _gnDrag.moved = true;
  }
  if (mode === 'pan') {
    const { frameEl, startFocusX, startFocusY, frameW, frameH } = _gnDrag;
    const iw = el.imageW || frameW, ih = el.imageH || frameH;
    const baseScale = Math.max(frameW / iw, frameH / ih);
    const scale = baseScale * ((el.zoom || 100) / 100);
    const maxX = Math.max(1, iw * scale - frameW), maxY = Math.max(1, ih * scale - frameH);
    el.focusX = gnClamp(startFocusX - (e.clientX - startX) / maxX * 100, 0, 100);
    el.focusY = gnClamp(startFocusY - (e.clientY - startY) / maxY * 100, 0, 100);
    gnApplyImageTransform(frameEl.closest('.gn-zone'), el);
    return;
  }
  const dxPct = (e.clientX - startX) / canvasRect.width * 100;
  const dyPct = (e.clientY - startY) / canvasRect.height * 100;
  gnClearAlignGuides();
  if (mode === 'move') {
    el.x = gnClamp(gnSnap(_gnDrag.origX + dxPct), 0, 100 - el.w);
    el.y = gnClamp(gnSnap(_gnDrag.origY + dyPct), 0, 100 - el.h);
    const xLines = gnAlignLines('x', el.id), yLines = gnAlignLines('y', el.id);
    const left = gnFindSnapLine(el.x, xLines), centerX = gnFindSnapLine(el.x + el.w / 2, xLines), right = gnFindSnapLine(el.x + el.w, xLines);
    if (centerX !== null) { el.x = gnClamp(centerX - el.w / 2, 0, 100 - el.w); gnShowAlignGuide('x', centerX); }
    else if (left !== null) { el.x = gnClamp(left, 0, 100 - el.w); gnShowAlignGuide('x', left); }
    else if (right !== null) { el.x = gnClamp(right - el.w, 0, 100 - el.w); gnShowAlignGuide('x', right); }
    const top = gnFindSnapLine(el.y, yLines), centerY = gnFindSnapLine(el.y + el.h / 2, yLines), bottom = gnFindSnapLine(el.y + el.h, yLines);
    if (centerY !== null) { el.y = gnClamp(centerY - el.h / 2, 0, 100 - el.h); gnShowAlignGuide('y', centerY); }
    else if (top !== null) { el.y = gnClamp(top, 0, 100 - el.h); gnShowAlignGuide('y', top); }
    else if (bottom !== null) { el.y = gnClamp(bottom - el.h, 0, 100 - el.h); gnShowAlignGuide('y', bottom); }
  } else {
    const { pos, origX, origY, origW, origH } = _gnDrag;
    if (pos.includes('e')) el.w = gnClamp(gnSnap(origW + dxPct), 6, 100 - origX);
    if (pos.includes('s')) el.h = gnClamp(gnSnap(origH + dyPct), 6, 100 - origY);
    if (pos.includes('w')) { const nw = gnClamp(gnSnap(origW - dxPct), 6, origX + origW); el.x = origX + origW - nw; el.w = nw; }
    if (pos.includes('n')) { const nh = gnClamp(gnSnap(origH - dyPct), 6, origY + origH); el.y = origY + origH - nh; el.h = nh; }
    const xLines = gnAlignLines('x', el.id), yLines = gnAlignLines('y', el.id);
    if (pos.includes('e')) { const r = gnFindSnapLine(el.x + el.w, xLines); if (r !== null) { el.w = gnClamp(r - el.x, 6, 100 - el.x); gnShowAlignGuide('x', r); } }
    if (pos.includes('w')) { const l = gnFindSnapLine(el.x, xLines); if (l !== null) { const edgeR = el.x + el.w; el.x = gnClamp(l, 0, edgeR - 6); el.w = edgeR - el.x; gnShowAlignGuide('x', l); } }
    if (pos.includes('s')) { const b = gnFindSnapLine(el.y + el.h, yLines); if (b !== null) { el.h = gnClamp(b - el.y, 6, 100 - el.y); gnShowAlignGuide('y', b); } }
    if (pos.includes('n')) { const t = gnFindSnapLine(el.y, yLines); if (t !== null) { const edgeB = el.y + el.h; el.y = gnClamp(t, 0, edgeB - 6); el.h = edgeB - el.y; gnShowAlignGuide('y', t); } }
  }
  // Important : ne PAS appeler gnRenderCanvas() ici — ça remplacerait
  // zoneEl (qui détient la capture du pointeur) en plein glisser et
  // couperait le geste net. On met juste à jour le style, en direct.
  zoneEl.style.left = el.x + '%'; zoneEl.style.top = el.y + '%';
  zoneEl.style.width = el.w + '%'; zoneEl.style.height = el.h + '%';
}
function gnOnPointerUp() {
  if (!_gnDrag) return;
  const moved = _gnDrag.moved;
  _gnDrag = null;
  gnClearAlignGuides();
  if (!moved) return; // clic simple : rien à sauvegarder, laisser l'événement "click" gérer la sélection
  saveGraphicNovel();
  gnRenderCanvas();
  gnRenderPagesSidebar();
}

// ─────────────────────────────────────────────────────────
// EXPORT PDF QUALITÉ IMPRESSION
// Choix validés avec l'utilisateur (AskUserQuestion) : format 20×25 cm
// (ratio 4:5, identique à l'éditeur), 300 DPI, fond perdu 3 mm.
//
// Principe : plutôt que de reconstruire le rendu en vectoriel avec jsPDF
// (police par police, forme de cadre par forme de cadre, rotation par
// rotation — bien trop de rendu spécifique à dupliquer fidèlement), on
// capture chaque page telle qu'affichée réellement dans l'éditeur
// (html2canvas), à haute résolution. gnRenderCanvas(true) produit un
// rendu "propre" (sans poignées ni grille) de la page active ; le fond
// perdu est simulé par un léger agrandissement centré de cette capture
// (tout élément touchant un bord de page se prolonge donc naturellement
// dans la marge de massicotage, sans bande blanche).
// ─────────────────────────────────────────────────────────
const GN_PDF_TRIM_MM = { w: 200, h: 250 }; // 20 × 25 cm — conserve le ratio 4:5 de l'éditeur
const GN_PDF_BLEED_MM = 3;                  // fond perdu standard imprimeur
const GN_PDF_DPI = 300;                     // qualité impression professionnelle
// Largeur CSS de référence de .gn-page-canvas (voir css/style.css,
// width:min(440px,90%)) — sert à calculer le facteur d'agrandissement
// (html2canvas scale) pour atteindre la résolution cible.
const GN_EDITOR_REF_PX = 440;

// Choix avant export (Lot 2, audit #8). Tous les formats gardent le ratio
// 4:5 de l'éditeur (aspect-ratio fixe en CSS) — changer ce ratio demanderait
// de repenser toute la mise en page de l'éditeur, hors scope ici. DPI et
// fond perdu, eux, n'ont pas cette contrainte.
const GN_PRINT_FORMATS = [
  { key: 'compact',  label: '16 × 20 cm (compact)',     w: 160, h: 200 },
  { key: 'standard', label: '20 × 25 cm (standard)',    w: 200, h: 250 },
  { key: 'grand',    label: '24 × 30 cm (grand format)', w: 240, h: 300 }
];
const GN_PRINT_DPIS = [
  { key: 150, label: '150 DPI (aperçu rapide)' },
  { key: 300, label: '300 DPI (qualité impression)' }
];
const GN_PRINT_BLEEDS = [
  { key: 0, label: 'Aucun (0 mm)' },
  { key: 3, label: 'Standard imprimeur (3 mm)' },
  { key: 5, label: 'Renforcé (5 mm)' }
];

// Zone de sécurité (Lot 2, audit #6) : marge indicative en retrait du bord,
// en pourcentage du format standard (choisi par défaut à l'export — voir
// #8 ci-dessus). Reste une valeur approximative puisque le format réel
// n'est décidé qu'au moment d'exporter.
const GN_SAFE_MARGIN_MM = 5;
const GN_SAFE_MARGIN_PCT_W = (GN_SAFE_MARGIN_MM / GN_PDF_TRIM_MM.w * 100).toFixed(2);
const GN_SAFE_MARGIN_PCT_H = (GN_SAFE_MARGIN_MM / GN_PDF_TRIM_MM.h * 100).toFixed(2);

function gnMmToPx(mm, dpi) { return Math.round(mm / 25.4 * (dpi || GN_PDF_DPI)); }

// Attend que toutes les images <img> de la page à exporter soient
// effectivement décodées avant la capture — sans ça, html2canvas peut
// photographier une image encore vide sur un premier rendu.
function gnWaitImagesReady(container) {
  const imgs = Array.from(container.querySelectorAll('img'));
  return Promise.all(imgs.map(img => {
    if (img.complete && img.naturalWidth) return Promise.resolve();
    return new Promise(res => { img.addEventListener('load', res, { once:true }); img.addEventListener('error', res, { once:true }); });
  }));
}

// Petite fenêtre de progression pendant l'export (peut prendre plusieurs
// secondes par page en haute résolution) — réutilise le style des modales
// existantes (.gn-modal-overlay/.gn-modal) et de l'indicateur "IA en train
// d'écrire" (.ai-loader/.ai-dot) pour rester cohérent visuellement.
function gnExportProgress(show, label, onCancel) {
  let el = document.getElementById('gn-export-modal');
  if (!show) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'gn-export-modal';
    el.className = 'gn-modal-overlay';
    // "text-align:center" en classe CSS (.gn-modal-center), jamais en
    // style="" — bug CSP découvert et corrigé au passage (Lot 2), même
    // règle style-src que le reste du module (voir v9.10.1).
    el.innerHTML = `<div class="gn-modal gn-modal-center">
      <h3>Génération du PDF</h3>
      <div class="ai-loader"><span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span></div>
      <p class="gn-modal-sub" id="gn-export-label"></p>
      <button class="action-btn u-bg-h7f8c8d" id="gn-export-cancel-btn" type="button" title="Interrompt l'export en cours, aucun fichier ne sera généré">Annuler</button>
    </div>`;
    document.body.appendChild(el);
  }
  document.getElementById('gn-export-label').textContent = label || '';
  const cancelBtn = document.getElementById('gn-export-cancel-btn');
  if (cancelBtn) cancelBtn.onclick = onCancel || null; // onclick plutôt qu'addEventListener : évite d'empiler un écouteur par page pendant l'export.
}

let _gnExportCancelled = false;

// opts (Lot 2, audit #8) : { trimW, trimH, dpi, bleedMm } — voir
// gnOpenExportOptionsModal(). Retombe sur les constantes par défaut
// (format standard 20×25cm/300 DPI/3mm) si appelée sans argument.
async function gnExportGraphicNovelPDF(opts) {
  if (typeof html2canvas !== 'function' || !window.jspdf) {
    toast('⚠️ Les librairies d\'export PDF n\'ont pas pu se charger (connexion hors-ligne ?).', 'error');
    return;
  }
  const pages = db.pages || [];
  if (!pages.length) { toast('Aucune page à exporter.', 'error'); return; }
  const trimMmW = (opts && opts.trimW) || GN_PDF_TRIM_MM.w;
  const trimMmH = (opts && opts.trimH) || GN_PDF_TRIM_MM.h;
  const dpi = (opts && opts.dpi) || GN_PDF_DPI;
  const bleedMm = (opts && opts.bleedMm != null) ? opts.bleedMm : GN_PDF_BLEED_MM;
  const btn = document.getElementById('gn-export-btn');
  if (btn) btn.disabled = true;
  const savedPage = _gnActivePage, savedSel = _gnSelectedElId, savedPan = _gnPanMode;
  _gnSelectedElId = null; _gnPanMode = false;
  const pageEl = document.getElementById('gn-canvas');
  pageEl.classList.add('gn-export-mode');
  pageEl.style.width = GN_EDITOR_REF_PX + 'px';
  _gnExportCancelled = false;
  const cancelHandler = () => { _gnExportCancelled = true; gnExportProgress(true, 'Annulation…'); };
  gnExportProgress(true, 'Préparation…', cancelHandler);
  try {
    const trimWpx = gnMmToPx(trimMmW, dpi), trimHpx = gnMmToPx(trimMmH, dpi);
    const bleedPx = gnMmToPx(bleedMm, dpi);
    const fullWpx = trimWpx + bleedPx * 2, fullHpx = trimHpx + bleedPx * 2;
    const fullWmm = trimMmW + bleedMm * 2, fullHmm = trimMmH + bleedMm * 2;
    const scale = trimWpx / GN_EDITOR_REF_PX;
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit:'mm', format:[fullWmm, fullHmm], orientation:'portrait', compress:true });
    let cancelled = false;
    for (let i = 0; i < pages.length; i++) {
      if (_gnExportCancelled) { cancelled = true; break; }
      gnExportProgress(true, `Page ${i + 1} / ${pages.length}…`, cancelHandler);
      _gnActivePage = i;
      await gnRenderCanvas(true);
      await gnWaitImagesReady(pageEl);
      // Laisse le navigateur peindre le rendu avant de le capturer.
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (_gnExportCancelled) { cancelled = true; break; }
      const trimCanvas = await html2canvas(pageEl, {
        scale, backgroundColor: getComputedStyle(pageEl).backgroundColor || '#f4ecd8', useCORS:true, logging:false
      });
      // Fond perdu : léger agrandissement centré de la page capturée — tout
      // élément touchant un bord se prolonge donc dans la marge de
      // massicotage au lieu de laisser une bande blanche.
      const bleedCanvas = document.createElement('canvas');
      bleedCanvas.width = fullWpx; bleedCanvas.height = fullHpx;
      const ctx = bleedCanvas.getContext('2d');
      const bScale = fullWpx / trimCanvas.width;
      const dw = trimCanvas.width * bScale, dh = trimCanvas.height * bScale;
      ctx.drawImage(trimCanvas, (fullWpx - dw) / 2, (fullHpx - dh) / 2, dw, dh);
      const jpeg = bleedCanvas.toDataURL('image/jpeg', 0.92);
      if (i > 0) pdf.addPage([fullWmm, fullHmm], 'portrait');
      pdf.addImage(jpeg, 'JPEG', 0, 0, fullWmm, fullHmm, undefined, 'FAST');
    }
    if (cancelled) {
      toast('Export annulé.');
    } else {
      const filename = (db.title || 'roman-graphique').trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'roman-graphique';
      pdf.save(filename + '.pdf');
      toast('✅ PDF qualité impression généré (' + pages.length + ' page' + (pages.length > 1 ? 's' : '') + ').', 'success');
    }
  } catch (e) {
    console.error('Échec export PDF (roman graphique) :', e);
    toast('⚠️ Échec de l\'export PDF : ' + (e && e.message ? e.message : e), 'error');
  } finally {
    pageEl.classList.remove('gn-export-mode');
    pageEl.style.width = '';
    _gnActivePage = savedPage; _gnSelectedElId = savedSel; _gnPanMode = savedPan;
    await gnRenderCanvas();
    gnRenderPagesSidebar();
    gnExportProgress(false);
    if (btn) btn.disabled = false;
  }
}

// Boîte de dialogue avant export (Lot 2, audit #8) : format/DPI/fond perdu
// choisis ici plutôt que figés en constantes. Valeurs par défaut = anciennes
// constantes, donc "Générer" sans rien changer reproduit exactement le
// comportement d'avant.
function gnOpenExportOptionsModal() {
  gnCloseExportOptionsModal();
  const overlay = document.createElement('div');
  overlay.id = 'gn-export-opts-overlay';
  overlay.className = 'gn-modal-overlay';
  overlay.innerHTML = `
    <div class="gn-modal" role="dialog" aria-modal="true" aria-label="Options d'export PDF">
      <h3>Export PDF qualité impression</h3>
      <p class="gn-modal-sub">Choisis le format et la qualité avant de générer le fichier.</p>
      <div class="gn-export-opts">
        <label class="gn-side-label" for="gn-export-format">Format</label>
        <select id="gn-export-format" title="Le ratio 4:5 de l'éditeur est conservé pour tous les formats — seule la taille change">
          ${GN_PRINT_FORMATS.map(f => `<option value="${f.key}"${f.key==='standard'?' selected':''}>${f.label}</option>`).join('')}
        </select>
        <label class="gn-side-label" for="gn-export-dpi">Résolution</label>
        <select id="gn-export-dpi" title="300 DPI recommandé pour l'impression, 150 DPI pour un aperçu rapide">
          ${GN_PRINT_DPIS.map(d => `<option value="${d.key}"${d.key===300?' selected':''}>${d.label}</option>`).join('')}
        </select>
        <label class="gn-side-label" for="gn-export-bleed">Fond perdu</label>
        <select id="gn-export-bleed" title="Marge supplémentaire massicotée par l'imprimeur — 3 mm est le standard, à confirmer avec ton imprimeur">
          ${GN_PRINT_BLEEDS.map(b => `<option value="${b.key}"${b.key===3?' selected':''}>${b.label}</option>`).join('')}
        </select>
      </div>
      <div class="gn-modal-actions">
        <button class="action-btn u-bg-h7f8c8d" id="gn-export-opts-cancel" type="button">Annuler</button>
        <button class="action-btn" id="gn-export-opts-go" type="button">Générer le PDF</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('gn-export-opts-cancel').addEventListener('click', gnCloseExportOptionsModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) gnCloseExportOptionsModal(); });
  document.getElementById('gn-export-opts-go').addEventListener('click', () => {
    const formatKey = document.getElementById('gn-export-format').value;
    const format = GN_PRINT_FORMATS.find(f => f.key === formatKey) || GN_PRINT_FORMATS[1];
    const dpi = Number(document.getElementById('gn-export-dpi').value) || GN_PDF_DPI;
    const bleedMm = Number(document.getElementById('gn-export-bleed').value);
    gnCloseExportOptionsModal();
    gnExportGraphicNovelPDF({ trimW: format.w, trimH: format.h, dpi, bleedMm });
  });
  gnWireModalA11y(overlay, gnCloseExportOptionsModal);
}
function gnCloseExportOptionsModal() {
  const el = document.getElementById('gn-export-opts-overlay');
  if (el) { gnCleanupModalA11y(el); el.remove(); }
}

// ─────────────────────────────────────────────────────────
// EXPORT "LIVRE" — ZIP / DOCX / EPUB / ODT (Lot 7, audit #24)
// Différent du PDF ci-dessus : pas de fond perdu ni de DPI impression, juste
// une capture propre de chaque page à une résolution raisonnable pour un
// usage écran/partage. gnExportPagesToCanvases() factorise la seule partie
// commune aux 4 formats (parcours des pages, capture html2canvas, état de
// progression/annulation) — le PDF, déjà testé et livré, n'est pas touché.
// ─────────────────────────────────────────────────────────
const GN_BOOK_EXPORT_WIDTH_PX = 1800;

function gnExportFilename() {
  return (db.title || 'roman-graphique').trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'roman-graphique';
}

// onPage(canvas, index, total) appelé pour chaque page dans l'ordre.
// Renvoie false (et laisse le fichier non généré par l'appelant) si l'export
// a été annulé ou si les pages/librairies nécessaires manquent.
async function gnExportPagesToCanvases(onPage) {
  if (typeof html2canvas !== 'function') { toast('⚠️ La bibliothèque de capture n\'a pas pu se charger (connexion hors-ligne ?).', 'error'); return false; }
  const pages = db.pages || [];
  if (!pages.length) { toast('Aucune page à exporter.', 'error'); return false; }
  const pageEl = document.getElementById('gn-canvas');
  const savedPage = _gnActivePage, savedSel = _gnSelectedElId, savedPan = _gnPanMode;
  _gnSelectedElId = null; _gnPanMode = false;
  pageEl.classList.add('gn-export-mode');
  pageEl.style.width = GN_EDITOR_REF_PX + 'px';
  _gnExportCancelled = false;
  const cancelHandler = () => { _gnExportCancelled = true; gnExportProgress(true, 'Annulation…'); };
  gnExportProgress(true, 'Préparation…', cancelHandler);
  let ok = true;
  try {
    for (let i = 0; i < pages.length; i++) {
      if (_gnExportCancelled) { ok = false; break; }
      gnExportProgress(true, `Page ${i + 1} / ${pages.length}…`, cancelHandler);
      _gnActivePage = i;
      await gnRenderCanvas(true);
      await gnWaitImagesReady(pageEl);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (_gnExportCancelled) { ok = false; break; }
      const scale = GN_BOOK_EXPORT_WIDTH_PX / GN_EDITOR_REF_PX;
      const canvas = await html2canvas(pageEl, { scale, backgroundColor: getComputedStyle(pageEl).backgroundColor || '#f4ecd8', useCORS:true, logging:false });
      const cont = await onPage(canvas, i, pages.length);
      if (cont === false) { ok = false; break; }
    }
  } finally {
    pageEl.classList.remove('gn-export-mode');
    pageEl.style.width = '';
    _gnActivePage = savedPage; _gnSelectedElId = savedSel; _gnPanMode = savedPan;
    await gnRenderCanvas();
    gnRenderPagesSidebar();
    gnExportProgress(false);
  }
  return ok;
}

async function gnExportZip() {
  if (typeof JSZip === 'undefined') { toast('Bibliothèque ZIP non chargée (vérifiez la connexion).', 'error'); return; }
  const zip = new JSZip();
  const ok = await gnExportPagesToCanvases(async (canvas, i) => {
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9));
    zip.file(`page-${String(i + 1).padStart(2, '0')}.jpg`, blob);
  });
  if (!ok) { toast('Export annulé.'); return; }
  try {
    const zipBlob = await zip.generateAsync({ type:'blob' });
    saveAs(zipBlob, gnExportFilename() + '-images.zip');
    toast('✅ Export ZIP généré.', 'success');
  } catch(e) {
    toast('⚠️ Échec de l\'export ZIP : ' + (e && e.message ? e.message : e), 'error');
  }
}

async function gnExportBookDocx() {
  if (typeof docx === 'undefined') { toast('Lib DOCX non chargée (vérifiez la connexion).', 'error'); return; }
  const { Document, Packer, Paragraph, ImageRun, PageBreak } = docx;
  const children = [];
  const ok = await gnExportPagesToCanvases(async (canvas, i, total) => {
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9));
    const buf = await blob.arrayBuffer();
    const w = 500, h = Math.round(w * canvas.height / canvas.width);
    children.push(new Paragraph({ children: [new ImageRun({ data: buf, transformation: { width: w, height: h } })] }));
    if (i < total - 1) children.push(new Paragraph({ children: [new PageBreak()] }));
  });
  if (!ok) { toast('Export annulé.'); return; }
  try {
    const blob = await Packer.toBlob(new Document({ sections: [{ children }] }));
    saveAs(blob, gnExportFilename() + '.docx');
    toast('✅ Export DOCX généré.', 'success');
  } catch(e) {
    toast('⚠️ Échec de l\'export DOCX : ' + (e && e.message ? e.message : e), 'error');
  }
}

async function gnExportBookEpub() {
  if (typeof JSZip === 'undefined') { toast('Bibliothèque EPUB non chargée (vérifiez la connexion).', 'error'); return; }
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression:'STORE' });
  zip.folder('META-INF').file('container.xml',
`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
  const oebps = zip.folder('OEBPS');
  const imagesFolder = oebps.folder('images');
  const uid = 'urn:uuid:' + genChapterId();
  const bookTitle = escapeXml(db.title || 'Mon Roman graphique — Plume');
  const manifestItems = [], spineItems = [], navPoints = [];

  const ok = await gnExportPagesToCanvases(async (canvas, i) => {
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9));
    const num = i + 1;
    const imgName = `page${num}.jpg`;
    imagesFolder.file(imgName, blob);
    const xfname = `page${num}.xhtml`;
    oebps.file(xfname,
`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Page ${num}</title><style>body{margin:0;padding:0;}img{width:100%;height:auto;display:block;}</style></head>
<body><img src="images/${imgName}" alt="Page ${num}"/></body>
</html>`);
    manifestItems.push(`<item id="page${num}" href="${xfname}" media-type="application/xhtml+xml"/>`);
    manifestItems.push(`<item id="img${num}" href="images/${imgName}" media-type="image/jpeg"/>`);
    spineItems.push(`<itemref idref="page${num}"/>`);
    navPoints.push(`<navPoint id="navPoint-${num}" playOrder="${num}"><navLabel><text>Page ${num}</text></navLabel><content src="${xfname}"/></navPoint>`);
  });
  if (!ok) { toast('Export annulé.'); return; }
  try {
    oebps.file('content.opf',
`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${bookTitle}</dc:title>
    <dc:language>fr</dc:language>
    <dc:identifier id="BookId">${uid}</dc:identifier>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine toc="ncx">
    ${spineItems.join('\n    ')}
  </spine>
</package>`);
    oebps.file('toc.ncx',
`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="${uid}"/></head>
  <docTitle><text>${bookTitle}</text></docTitle>
  <navMap>
    ${navPoints.join('\n    ')}
  </navMap>
</ncx>`);
    const blob = await zip.generateAsync({ type:'blob', mimeType:'application/epub+zip' });
    saveAs(blob, gnExportFilename() + '.epub');
    toast('✅ Export EPUB généré.', 'success');
  } catch(e) {
    toast('⚠️ Échec de l\'export EPUB : ' + (e && e.message ? e.message : e), 'error');
  }
}

async function gnExportBookOdt() {
  if (!window.odfKit || !window.odfKit.htmlToOdt) { toast('Bibliothèque ODT non chargée (vérifiez la connexion).', 'error'); return; }
  let html = `<h1>${escapeXml(db.title || 'Mon Roman graphique — Plume')}</h1>`;
  const ok = await gnExportPagesToCanvases(async canvas => {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    html += `<p><img src="${dataUrl}" style="width:100%;"/></p>`;
  });
  if (!ok) { toast('Export annulé.'); return; }
  try {
    const bytes = await window.odfKit.htmlToOdt(html, { pageFormat:'A4' });
    const blob = new Blob([bytes], { type:'application/vnd.oasis.opendocument.text' });
    saveAs(blob, gnExportFilename() + '.odt');
    toast('✅ Export ODT généré.', 'success');
  } catch(e) {
    toast('⚠️ Échec de l\'export ODT : ' + (e && e.message ? e.message : e), 'error');
  }
}

function gnOpenBookExportModal() {
  gnCloseBookExportModal();
  const overlay = document.createElement('div');
  overlay.id = 'gn-export-book-overlay';
  overlay.className = 'gn-modal-overlay';
  overlay.innerHTML = `
    <div class="gn-modal" role="dialog" aria-modal="true" aria-label="Export du livre">
      <h3>Exporter le livre</h3>
      <p class="gn-modal-sub">Une image par page — pour partager ou lire hors de l'application (pas pour l'impression professionnelle, voir « Exporter le PDF »).</p>
      <div class="gn-export-opts">
        <label class="gn-side-label" for="gn-export-book-format">Format</label>
        <select id="gn-export-book-format" title="ZIP : une image par page. DOCX/ODT : document avec une page illustrée par page. EPUB : livre numérique pour liseuse.">
          <option value="zip">ZIP (une image par page)</option>
          <option value="docx">DOCX (Word)</option>
          <option value="epub">EPUB (liseuse)</option>
          <option value="odt">ODT (OpenDocument)</option>
        </select>
      </div>
      <div class="gn-modal-actions">
        <button class="action-btn u-bg-h7f8c8d" id="gn-export-book-cancel" type="button">Annuler</button>
        <button class="action-btn" id="gn-export-book-go" type="button">Générer</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('gn-export-book-cancel').addEventListener('click', gnCloseBookExportModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) gnCloseBookExportModal(); });
  document.getElementById('gn-export-book-go').addEventListener('click', async () => {
    const format = document.getElementById('gn-export-book-format').value;
    gnCloseBookExportModal();
    const btn = document.getElementById('gn-export-book-btn');
    if (btn) btn.disabled = true;
    try {
      if (format === 'zip') await gnExportZip();
      else if (format === 'docx') await gnExportBookDocx();
      else if (format === 'epub') await gnExportBookEpub();
      else if (format === 'odt') await gnExportBookOdt();
    } finally {
      if (btn) btn.disabled = false;
    }
  });
  gnWireModalA11y(overlay, gnCloseBookExportModal);
}
function gnCloseBookExportModal() {
  const el = document.getElementById('gn-export-book-overlay');
  if (el) { gnCleanupModalA11y(el); el.remove(); }
}

// ─────────────────────────────────────────────────────────
// CORBEILLE — pages et éléments supprimés (Lot 3, audit #10/#11)
// Même principe que la corbeille des chapitres (editor.js/db.trash, purge à
// 30 jours) : un manuscrit roman graphique a son propre db.trash (jamais
// utilisé jusqu'ici), partagé entre deux types d'entrées distingués par
// `kind` — un manuscrit n'ayant jamais à la fois des chapitres et des pages
// illustrées, aucun risque de mélange.
// ─────────────────────────────────────────────────────────
const GN_TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // même délai que editor.js

// Purge les entrées expirées et libère leurs images — à appeler à
// l'ouverture de l'écran (voir openGraphicNovelScreen), jamais pendant
// l'édition (une image encore affichée ne doit jamais disparaître sous les
// pieds de l'utilisateur).
function gnPurgeOldTrash() {
  const now = Date.now();
  const kept = [];
  (db.trash || []).forEach(t => {
    if (t.kind !== 'gn-page' && t.kind !== 'gn-element') { kept.push(t); return; }
    if (now - t.deletedAt < GN_TRASH_RETENTION_MS) { kept.push(t); return; }
    if (t.kind === 'gn-element' && t.element.type === 'image' && t.element.imageId) deleteGraphicImage(t.element.imageId);
    if (t.kind === 'gn-page') (t.page.elements || []).forEach(el => { if (el.type === 'image' && el.imageId) deleteGraphicImage(el.imageId); });
  });
  db.trash = kept;
}

function gnRenderTrashBadge() {
  const b = document.getElementById('gn-trash-badge');
  if (!b) return;
  const n = (db.trash || []).filter(t => t.kind === 'gn-page' || t.kind === 'gn-element').length;
  b.textContent = n > 99 ? '99+' : (n || '');
  b.style.display = n > 0 ? 'flex' : 'none';
}

function gnOpenTrashModal() {
  gnCloseTrashModal();
  const overlay = document.createElement('div');
  overlay.id = 'gn-trash-overlay';
  overlay.className = 'gn-modal-overlay';
  overlay.innerHTML = `
    <div class="gn-modal" role="dialog" aria-modal="true" aria-label="Corbeille">
      <h3>Corbeille</h3>
      <p class="gn-modal-sub">Pages et éléments supprimés, récupérables pendant 30 jours.</p>
      <div class="gn-trash-list" id="gn-trash-list"></div>
      <div class="gn-modal-actions">
        <button class="action-btn u-bg-h7f8c8d" id="gn-trash-close-btn" type="button">Fermer</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) gnCloseTrashModal(); });
  document.getElementById('gn-trash-close-btn').addEventListener('click', gnCloseTrashModal);
  gnRenderTrashList();
  gnWireModalA11y(overlay, gnCloseTrashModal);
}
function gnCloseTrashModal() {
  const el = document.getElementById('gn-trash-overlay');
  if (el) { gnCleanupModalA11y(el); el.remove(); }
}
function gnTrashEntryLabel(t) {
  if (t.kind === 'gn-page') {
    const n = (t.page.elements || []).length;
    return 'Page (' + n + ' élément' + (n > 1 ? 's' : '') + ')';
  }
  return t.element.type === 'image' ? 'Image' : 'Bloc de texte' + (t.element.content ? ' — « ' + t.element.content.slice(0, 24) + ' »' : ' (vide)');
}
function gnRenderTrashList() {
  const list = document.getElementById('gn-trash-list');
  if (!list) return;
  const entries = (db.trash || []).map((t, i) => ({ t, i })).filter(e => e.t.kind === 'gn-page' || e.t.kind === 'gn-element');
  if (!entries.length) {
    list.innerHTML = '<div class="u-op-_5 u-p-16px u-ta-center u-fs-_82rem">La corbeille est vide.</div>';
    return;
  }
  list.innerHTML = entries.slice().reverse().map(({ t, i }) => {
    const daysLeft = Math.max(0, 30 - Math.floor((Date.now() - t.deletedAt) / 86400000));
    return `<div class="history-item u-cur-default">
      <span>${gnTrashEntryLabel(t)}<br><span class="u-op-_5 u-fs-_68rem">Supprimé le ${new Date(t.deletedAt).toLocaleDateString('fr')} — purge auto dans ${daysLeft}j</span></span>
      <span class="u-d-flex u-gap-4px u-fsh-0">
        <button class="action-btn btn-sm" data-restore="${i}">↩ Restaurer</button>
        <button class="action-btn btn-sm u-bg-v-danger" data-purge="${i}">✕ Définitif</button>
      </span>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-restore]').forEach(btn => btn.addEventListener('click', () => gnRestoreFromTrash(parseInt(btn.dataset.restore))));
  list.querySelectorAll('[data-purge]').forEach(btn => btn.addEventListener('click', () => gnPurgeTrashEntry(parseInt(btn.dataset.purge))));
}
function gnRestoreFromTrash(i) {
  const item = db.trash[i];
  if (!item) return;
  if (item.kind === 'gn-page') {
    db.pages.push(item.page);
    toast('Page restaurée.', 'success');
  } else {
    // Sur sa page d'origine si elle existe encore, sinon sur la page active
    // (avec message clair — mieux qu'une restauration silencieuse ailleurs).
    const target = db.pages.find(p => p.id === item.pageId);
    if (target) {
      target.elements.push(item.element);
      toast('Élément restauré sur sa page d\'origine.', 'success');
    } else {
      db.pages[_gnActivePage].elements.push(item.element);
      toast('Page d\'origine introuvable — élément restauré sur la page active.', 'success');
    }
  }
  db.trash.splice(i, 1);
  saveGraphicNovel();
  renderGraphicNovelScreen();
  gnRenderTrashList();
  gnRenderTrashBadge();
}
function gnPurgeTrashEntry(i) {
  const item = db.trash[i];
  if (!item) return;
  if (!confirm('Supprimer définitivement ? Cette action est irréversible.')) return;
  if (item.kind === 'gn-element' && item.element.type === 'image' && item.element.imageId) deleteGraphicImage(item.element.imageId);
  if (item.kind === 'gn-page') (item.page.elements || []).forEach(el => { if (el.type === 'image' && el.imageId) deleteGraphicImage(el.imageId); });
  db.trash.splice(i, 1);
  saveGraphicNovel();
  gnRenderTrashList();
  gnRenderTrashBadge();
}

// ─────────────────────────────────────────────────────────
// HISTORIQUE DE PAGE (Lot 4, audit #13)
// Réutilise db.history (déjà présent dans le schéma, jamais utilisé pour un
// roman graphique jusqu'ici), même principe que snapshots.js mais indexé par
// page.id au lieu de chapitre — un instantané automatique toutes les 5
// minutes de la page active, sans vue de comparaison (une mise en page
// visuelle ne se compare pas comme du texte) : juste une liste, restauration
// directe avec confirmation.
// ─────────────────────────────────────────────────────────
const GN_MAX_SNAPSHOTS = 30; // même limite que MAX_SNAPSHOTS (snapshots.js)

function gnTakeSnapshot(pageIdx, label) {
  const page = db.pages[pageIdx];
  if (!page || !page.id) return;
  if (!db.history) db.history = {};
  if (!db.history[page.id]) db.history[page.id] = [];
  const content = JSON.stringify({ elements: page.elements, background: page.background });
  const last = db.history[page.id][0];
  if (last && last.content === content) return; // rien changé depuis le dernier instantané
  db.history[page.id].unshift({ ts: Date.now(), label: label || new Date().toLocaleString('fr'), content });
  if (db.history[page.id].length > GN_MAX_SNAPSHOTS) db.history[page.id] = db.history[page.id].slice(0, GN_MAX_SNAPSHOTS);
}

// Gardé par docType ET par la classe sur <body> : ce minuteur tourne en
// permanence (défini au chargement du script), mais ne doit agir que quand
// un roman graphique est réellement ouvert à l'écran — sinon _gnActivePage
// pointerait sur les pages d'un manuscrit qui n'est plus le document actif.
setInterval(() => {
  if (db.docType === 'roman_graphique' && document.body.classList.contains('graphicnovel-mode') && db.pages && db.pages[_gnActivePage]) {
    gnTakeSnapshot(_gnActivePage);
    saveGraphicNovel();
  }
}, 5 * 60 * 1000);

function gnOpenPageHistoryModal() {
  gnClosePageHistoryModal();
  const overlay = document.createElement('div');
  overlay.id = 'gn-history-overlay';
  overlay.className = 'gn-modal-overlay';
  overlay.innerHTML = `
    <div class="gn-modal" role="dialog" aria-modal="true" aria-label="Historique de la page">
      <h3>Historique de la page ${_gnActivePage + 1}</h3>
      <p class="gn-modal-sub">Instantané automatique toutes les 5 minutes. Pas de comparaison visuelle : la restauration remplace directement le contenu de la page.</p>
      <div class="gn-trash-list" id="gn-history-list"></div>
      <div class="gn-modal-actions">
        <button class="action-btn u-bg-h7f8c8d" id="gn-history-close-btn" type="button">Fermer</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) gnClosePageHistoryModal(); });
  document.getElementById('gn-history-close-btn').addEventListener('click', gnClosePageHistoryModal);
  gnRenderPageHistoryList();
  gnWireModalA11y(overlay, gnClosePageHistoryModal);
}
function gnClosePageHistoryModal() {
  const el = document.getElementById('gn-history-overlay');
  if (el) { gnCleanupModalA11y(el); el.remove(); }
}
function gnRenderPageHistoryList() {
  const list = document.getElementById('gn-history-list');
  if (!list) return;
  const page = db.pages[_gnActivePage];
  const snaps = (page && page.id && db.history && db.history[page.id]) || [];
  if (!snaps.length) {
    list.innerHTML = '<div class="u-op-_5 u-p-16px u-ta-center u-fs-_82rem">Aucun historique pour cette page.</div>';
    return;
  }
  list.innerHTML = snaps.map((snap, i) => `
    <div class="history-item u-cur-default">
      <span>${DOMPurify.sanitize(snap.label)}</span>
      <span class="u-d-flex u-gap-4px u-fsh-0">
        <button class="action-btn btn-sm" data-restore-hist="${i}">↩ Restaurer</button>
      </span>
    </div>`).join('');
  list.querySelectorAll('[data-restore-hist]').forEach(btn => btn.addEventListener('click', () => gnRestorePageSnapshot(parseInt(btn.dataset.restoreHist))));
}
function gnRestorePageSnapshot(i) {
  const page = db.pages[_gnActivePage];
  const snaps = (page && page.id && db.history && db.history[page.id]) || [];
  const snap = snaps[i];
  if (!snap) return;
  if (!confirm('Restaurer cette version de la page ? Le contenu actuel de la page sera remplacé.')) return;
  // Même principe que restoreSnapshot() dans snapshots.js : un point
  // d'annulation avant ET après la restauration (celui d'après vient de
  // saveGraphicNovel(true) plus bas), pour pouvoir faire Ctrl+Z si la
  // restauration ne convient pas finalement.
  gnCommitUndoSnapshot();
  const data = JSON.parse(snap.content);
  page.elements = data.elements;
  page.background = data.background;
  _gnSelectedElId = null;
  saveGraphicNovel(true);
  renderGraphicNovelScreen();
  gnClosePageHistoryModal();
  toast('Page restaurée depuis l\'historique.', 'success');
}
