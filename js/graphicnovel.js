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

// ─────────────────────────────────────────────────────────
// ÉCRAN — affichage / masquage (même principe que showLibraryScreen, v.
// library.js : une classe sur <body> qui bascule ce qui est visible)
// ─────────────────────────────────────────────────────────
function showGraphicNovelScreen() { document.body.classList.add('graphicnovel-mode'); }
function hideGraphicNovelScreen() { document.body.classList.remove('graphicnovel-mode'); }

function openGraphicNovelScreen() {
  ensureGraphicNovelScreen();
  showGraphicNovelScreen();
  if (db.darkMode) document.body.classList.add('dark-mode'); else document.body.classList.remove('dark-mode');
  document.body.classList.toggle('paper-mode', !!db.paperMode);
  _gnActivePage = 0; _gnSelectedElId = null; _gnPreviewGabarit = null;
  const titleEl = document.getElementById('gn-doc-title');
  if (titleEl) titleEl.textContent = db.title || 'Sans titre';
  renderGraphicNovelScreen();
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
      });
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
}
function closeNewDocumentTypeModal() {
  const el = document.getElementById('gn-type-modal-overlay');
  if (el) el.remove();
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
        <button class="gn-icon-btn" id="gn-add-image-btn" title="Ajouter une image libre sur la page">🖼️+</button>
        <button class="gn-icon-btn" id="gn-add-text-btn" title="Ajouter un bloc de texte libre sur la page">🔤+</button>
        <button class="gn-icon-btn gn-active" id="gn-grid-toggle" title="Grille magnétique (alignement précis)">▦</button>
        <span class="gn-zoom-tag">100%</span>
      </div>
      <button class="action-btn" id="gn-export-btn" title="Exporter le livre en PDF qualité impression (300 DPI, fond perdu 3 mm)">Exporter le PDF</button>
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
  document.getElementById('gn-doc-title').addEventListener('blur', e => updateGraphicNovelTitle(e.target.textContent));
  document.getElementById('gn-doc-title').addEventListener('keydown', e => { if (e.key==='Enter') { e.preventDefault(); e.target.blur(); } });
  document.getElementById('gn-page-prev').addEventListener('click', () => gnSetActivePage((_gnActivePage - 1 + db.pages.length) % db.pages.length));
  document.getElementById('gn-page-next').addEventListener('click', () => gnSetActivePage((_gnActivePage + 1) % db.pages.length));
  document.getElementById('gn-page-add').addEventListener('click', gnAddPage);
  document.getElementById('gn-grid-toggle').addEventListener('click', e => {
    _gnSnapGrid = !_gnSnapGrid;
    e.currentTarget.classList.toggle('gn-active', _gnSnapGrid);
  });
  document.getElementById('gn-add-image-btn').addEventListener('click', () => gnAddFreeElement('image'));
  document.getElementById('gn-add-text-btn').addEventListener('click', () => gnAddFreeElement('text'));
  document.getElementById('gn-export-btn').addEventListener('click', gnExportGraphicNovelPDF);

  // Délégation d'événements sur les listes reconstruites souvent (évite
  // d'empiler des écouteurs à chaque rendu — même principe que
  // wireAppEventListenersOnce dans router.js).
  document.getElementById('gn-pages-list').addEventListener('click', e => {
    const del = e.target.closest('.gn-pg-del');
    if (del) { e.stopPropagation(); gnDeletePage(Number(del.dataset.idx)); return; }
    const thumb = e.target.closest('.gn-pg-thumb'); if (!thumb) return;
    gnSetActivePage(Number(thumb.dataset.idx));
  });
  document.getElementById('gn-gabarits').addEventListener('click', e => {
    const g = e.target.closest('.gn-gab'); if (!g) return;
    gnPreviewGabarit(g.dataset.key);
  });
  document.getElementById('gn-layers').addEventListener('click', e => {
    const lz = e.target.closest('.gn-lz button');
    if (lz) { e.stopPropagation(); if (!lz.disabled) gnMoveLayer(Number(lz.dataset.idx), lz.dataset.dir); return; }
    const row = e.target.closest('.gn-layer-row'); if (!row) return;
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
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const ae = document.activeElement;
    if (ae && (ae.isContentEditable || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    gnDeleteElement(_gnSelectedElId);
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
  const label = document.getElementById('gn-page-label');
  if (label) label.textContent = 'Page ' + (_gnActivePage + 1) + ' / ' + db.pages.length;
}

function gnMiniIconHtml(elements) {
  return elements.map(z =>
    `<div class="gn-icon-z ${z.type==='image'?'gn-icon-i':'gn-icon-t'}" style="left:${z.x}%;top:${z.y}%;width:${z.w}%;height:${z.h}%;"></div>`
  ).join('');
}

function gnRenderPagesSidebar() {
  const box = document.getElementById('gn-pages-list');
  box.innerHTML = db.pages.map((p, i) => `
    <div class="gn-pg-thumb${i===_gnActivePage?' gn-active':''}" data-idx="${i}" title="Page ${i+1}">
      ${gnMiniIconHtml(p.elements)}
      <span class="gn-pg-num">${i+1}</span>
      <button class="gn-pg-del" data-idx="${i}" title="Supprimer la page ${i+1}" aria-label="Supprimer la page ${i+1}">✕</button>
    </div>`).join('');
}

function gnRenderGabaritsPanel() {
  const box = document.getElementById('gn-gabarits');
  box.innerHTML = GRAPHIC_GABARIT_ORDER.map(key => `
    <div class="gn-gab${_gnPreviewGabarit===key?' gn-active':''}" data-key="${key}">
      <div class="gn-icon">${gnMiniIconHtml(GRAPHIC_GABARITS[key].build())}</div>
      <span class="gn-gab-lbl">${GRAPHIC_GABARITS[key].label}</span>
    </div>`).join('');
}

// exportMode (voir gnExportGraphicNovelPDF, section EXPORT PDF plus bas) :
// rendu "propre" pour la capture haute résolution — aucune poignée/mini-
// barre/grille, et les éléments vides (image sans imageId, texte sans
// contenu) ne sont pas dessinés du tout (page de fond visible à la place).
async function gnRenderCanvas(exportMode) {
  const canvas = document.getElementById('gn-canvas');
  canvas.innerHTML = '';
  const preview = !!_gnPreviewGabarit && !exportMode;
  let elements;
  if (preview) {
    const banner = document.createElement('div');
    banner.className = 'gn-preview-banner';
    banner.innerHTML = `<span>Aperçu du gabarit « ${GRAPHIC_GABARITS[_gnPreviewGabarit].label} » — non appliqué</span><button id="gn-apply-gab">Appliquer à cette page</button>`;
    canvas.appendChild(banner);
    banner.querySelector('#gn-apply-gab').addEventListener('click', gnApplyPreviewGabarit);
    elements = GRAPHIC_GABARITS[_gnPreviewGabarit].build();
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
          // silencieusement leurs glyphes au contenu sauvegardé.
          zone.addEventListener('input', () => {
            const clone = zone.cloneNode(true);
            clone.querySelectorAll('.gn-mini-toolbar, .gn-move-handle, .gn-handle').forEach(n => n.remove());
            el.content = clone.textContent;
            saveGraphicNovel();
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
  }
  canvas.onclick = gnDeselectOnBackdrop;
  if (!exportMode) { gnRenderImageProps(); gnRenderTextProps(); }
}
function gnDeselectOnBackdrop(e) {
  if (e.target.id === 'gn-canvas' || e.target.classList.contains('gn-zone-wrap')) gnSelectElement(null);
}

function gnRenderLayers() {
  const box = document.getElementById('gn-layers');
  const elements = db.pages[_gnActivePage].elements;
  box.innerHTML = elements.map((el, i) => `
    <div class="gn-layer-row${el.id===_gnSelectedElId?' gn-sel':''}" data-el-id="${el.id}">
      <span class="gn-lg">${el.type==='image'?'🖼️':'🔤'}</span>
      <span class="gn-lname">${el.type==='image' ? (el.imageId ? 'Image' : 'Image (vide)') : (el.content ? el.content.slice(0,28) : 'Bloc de texte vide')}</span>
      <span class="gn-lz">
        <button data-dir="up" data-idx="${i}" title="Passer au premier plan" ${i===elements.length-1?'disabled':''}>▲</button>
        <button data-dir="down" data-idx="${i}" title="Passer à l'arrière-plan" ${i===0?'disabled':''}>▼</button>
      </span>
    </div>`).join('') || '<p class="gn-layers-empty">Page vide — choisis un gabarit ou ajoute un élément.</p>';
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
    <div class="gn-prop-label"><span>Zoom</span><span class="gn-prop-val" id="gn-zoom-val">${Math.round(el.zoom)}%</span></div>
    <input type="range" id="gn-zoom-slider" min="100" max="300" value="${el.zoom}">
    <div class="gn-prop-label gn-mt-sm"><span>Rotation</span><span class="gn-prop-val" id="gn-rot-val">${Math.round(el.rotation)}°</span></div>
    <input type="range" id="gn-rot-slider" min="-180" max="180" value="${el.rotation}">
    <div class="gn-imgprops-hint">En mode ✥ Recadrer (mini-barre sur l'image), glisse dans le cadre pour repositionner l'image.</div>
    <div class="gn-side-label gn-mt-sm">Forme du cadre</div>
    <div class="gn-shape-row">
      ${GN_FRAME_SHAPES.map(s => `<button class="gn-shape-btn${el.frameShape===s.key?' gn-active':''}" data-shape="${s.key}" title="${s.title}">${s.glyph}</button>`).join('')}
    </div>`;
  const zoneEl = document.querySelector(`.gn-zone[data-el-id="${el.id}"]`);
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
  box.querySelectorAll('.gn-shape-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      el.frameShape = btn.dataset.shape;
      saveGraphicNovel();
      gnRenderCanvas();
    });
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
    </div>`;
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
}

// ─────────────────────────────────────────────────────────
// ACTIONS
// ─────────────────────────────────────────────────────────
function gnSetActivePage(i) {
  _gnActivePage = i; _gnSelectedElId = null; _gnPreviewGabarit = null;
  renderGraphicNovelScreen();
}
function gnPreviewGabarit(key) { _gnPreviewGabarit = key; gnRenderGabaritsPanel(); gnRenderCanvas(); }
function gnApplyPreviewGabarit() {
  if (!_gnPreviewGabarit) return;
  db.pages[_gnActivePage].elements = GRAPHIC_GABARITS[_gnPreviewGabarit].build();
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
  const ok = await showConfirmModal({ title:'Supprimer cette page ?', message:'Ses images et son texte seront perdus.', confirmLabel:'Supprimer', danger:true });
  if (!ok) return;
  const [removed] = db.pages.splice(i, 1);
  (removed.elements || []).forEach(el => { if (el.type === 'image' && el.imageId) deleteGraphicImage(el.imageId); });
  saveGraphicNovel();
  gnSetActivePage(Math.min(_gnActivePage, db.pages.length - 1));
}
function gnAddFreeElement(type) {
  const page = db.pages[_gnActivePage];
  const el = type === 'image' ? makeImageElement(28, 28, 44, 34) : makeTextElement(28, 65, 44, 15);
  page.elements.push(el);
  saveGraphicNovel();
  gnSelectElement(el.id);
}
function gnDeleteElement(id) {
  const page = db.pages[_gnActivePage];
  const el = page.elements.find(e => e.id === id);
  if (el && el.type === 'image' && el.imageId) deleteGraphicImage(el.imageId);
  page.elements = page.elements.filter(e => e.id !== id);
  _gnSelectedElId = null;
  saveGraphicNovel();
  renderGraphicNovelScreen();
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
// Calcule et applique le cadrage (pan/zoom/rotation) d'une image dans son
// cadre : l'image couvre toujours le cadre au minimum (recadrage type
// "cover"), zoom au-delà agrandit, focusX/focusY déplacent la portion
// visible. La rotation s'applique au cadre-fenêtre (.gn-frame-fill), qui
// reste découpé à la taille du cadre — l'image tourne avec lui.
function gnApplyImageTransform(zoneEl, el) {
  const frameEl = zoneEl && zoneEl.querySelector('.gn-frame-fill');
  const img = frameEl && frameEl.querySelector('img');
  if (!frameEl || !img) return;
  const frameW = frameEl.clientWidth, frameH = frameEl.clientHeight;
  if (!frameW || !frameH) return;
  frameEl.style.transform = el.rotation ? `rotate(${el.rotation}deg)` : '';
  const iw = el.imageW || frameW, ih = el.imageH || frameH;
  const baseScale = Math.max(frameW / iw, frameH / ih);
  const scale = baseScale * ((el.zoom || 100) / 100);
  const imgW = iw * scale, imgH = ih * scale;
  const maxX = Math.max(0, imgW - frameW), maxY = Math.max(0, imgH - frameH);
  const tx = -((el.focusX ?? 50) / 100) * maxX;
  const ty = -((el.focusY ?? 50) / 100) * maxY;
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
  if (mode === 'move') {
    el.x = gnClamp(gnSnap(_gnDrag.origX + dxPct), 0, 100 - el.w);
    el.y = gnClamp(gnSnap(_gnDrag.origY + dyPct), 0, 100 - el.h);
  } else {
    const { pos, origX, origY, origW, origH } = _gnDrag;
    if (pos.includes('e')) el.w = gnClamp(gnSnap(origW + dxPct), 6, 100 - origX);
    if (pos.includes('s')) el.h = gnClamp(gnSnap(origH + dyPct), 6, 100 - origY);
    if (pos.includes('w')) { const nw = gnClamp(gnSnap(origW - dxPct), 6, origX + origW); el.x = origX + origW - nw; el.w = nw; }
    if (pos.includes('n')) { const nh = gnClamp(gnSnap(origH - dyPct), 6, origY + origH); el.y = origY + origH - nh; el.h = nh; }
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

function gnMmToPx(mm) { return Math.round(mm / 25.4 * GN_PDF_DPI); }

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
function gnExportProgress(show, label) {
  let el = document.getElementById('gn-export-modal');
  if (!show) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'gn-export-modal';
    el.className = 'gn-modal-overlay';
    el.innerHTML = `<div class="gn-modal" style="text-align:center;">
      <h3>Génération du PDF</h3>
      <div class="ai-loader"><span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span></div>
      <p class="gn-modal-sub" id="gn-export-label"></p>
    </div>`;
    document.body.appendChild(el);
  }
  document.getElementById('gn-export-label').textContent = label || '';
}

async function gnExportGraphicNovelPDF() {
  if (typeof html2canvas !== 'function' || !window.jspdf) {
    toast('⚠️ Les librairies d\'export PDF n\'ont pas pu se charger (connexion hors-ligne ?).', 'error');
    return;
  }
  const pages = db.pages || [];
  if (!pages.length) { toast('Aucune page à exporter.', 'error'); return; }
  const btn = document.getElementById('gn-export-btn');
  if (btn) btn.disabled = true;
  const savedPage = _gnActivePage, savedSel = _gnSelectedElId, savedPan = _gnPanMode;
  _gnSelectedElId = null; _gnPanMode = false;
  const pageEl = document.getElementById('gn-canvas');
  pageEl.classList.add('gn-export-mode');
  pageEl.style.width = GN_EDITOR_REF_PX + 'px';
  gnExportProgress(true, 'Préparation…');
  try {
    const trimWpx = gnMmToPx(GN_PDF_TRIM_MM.w), trimHpx = gnMmToPx(GN_PDF_TRIM_MM.h);
    const bleedPx = gnMmToPx(GN_PDF_BLEED_MM);
    const fullWpx = trimWpx + bleedPx * 2, fullHpx = trimHpx + bleedPx * 2;
    const fullWmm = GN_PDF_TRIM_MM.w + GN_PDF_BLEED_MM * 2, fullHmm = GN_PDF_TRIM_MM.h + GN_PDF_BLEED_MM * 2;
    const scale = trimWpx / GN_EDITOR_REF_PX;
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit:'mm', format:[fullWmm, fullHmm], orientation:'portrait', compress:true });
    for (let i = 0; i < pages.length; i++) {
      gnExportProgress(true, `Page ${i + 1} / ${pages.length}…`);
      _gnActivePage = i;
      await gnRenderCanvas(true);
      await gnWaitImagesReady(pageEl);
      // Laisse le navigateur peindre le rendu avant de le capturer.
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
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
    const filename = (db.title || 'roman-graphique').trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'roman-graphique';
    pdf.save(filename + '.pdf');
    toast('✅ PDF qualité impression généré (' + pages.length + ' page' + (pages.length > 1 ? 's' : '') + ').', 'success');
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
