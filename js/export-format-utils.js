'use strict';
// ═══════════════════════════════════════════════════════
// EXPORT DOCX / ODT / EPUB — v7.13.0 (Lot 10) : ces 3 fonctions opèrent
// désormais sur un tableau de chapitres passé explicitement, plutôt que sur
// le `db` global — l'export se fait maintenant depuis la bibliothèque, pour
// un manuscrit qui n'est pas forcément celui ouvert dans l'éditeur.
// ═══════════════════════════════════════════════════════
async function exportDocx(chapters, title) {
  if (typeof docx === 'undefined') { toast('Lib DOCX non chargée','error'); return; }
  if (!chapters || !chapters.length) { toast('Aucun chapitre sélectionné.','error'); return; }
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docx;
  const children = [new Paragraph({ text: title || 'Mon Roman — Plume', heading:HeadingLevel.TITLE })];
  chapters.forEach((ch, i) => {
    children.push(new Paragraph({ text:`Chapitre ${i+1} : ${ch.title}`, heading:HeadingLevel.HEADING_1 }));
    getPlainText(ch.content).split('\n').forEach(line => {
      if (line.trim()) children.push(new Paragraph({ children:[new TextRun({ text:line.trim(), size:24 })] }));
      else children.push(new Paragraph({}));
    });
    children.push(new Paragraph({}));
  });
  const blob = await Packer.toBlob(new Document({ sections:[{ children }] }));
  saveAs(blob, 'roman_plume.docx'); toast('Export DOCX réussi !','success');
}

function escapeXml(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// Correction v7.16.2 (bug remonté par l'utilisateur sur l'export ODT,
// "parseXml: unclosed elements: <div>") : l'ancienne version retirait
// l'enveloppe <div> ajoutée pour l'analyse via un regex fragile
// (`.replace(/^<div>|<\/div>$/g, '')`) qui suppose que la balise ouvrante
// sérialisée est EXACTEMENT `<div>`, sans aucun attribut. Or `XMLSerializer`
// ajoute légitimement un attribut `xmlns="http://www.w3.org/1999/xhtml"`
// sur l'élément servant de racine à une sérialisation isolée (comportement
// standard, pas un bug de navigateur) — la balise ouvrante réelle devient
// donc `<div xmlns="...">`, que le regex ne reconnaît plus. Résultat : la
// balise ouvrante restait dans la sortie, désormais SANS fermeture (celle-ci
// avait bien été retirée par la partie `<\/div>$` du même regex) → analyseur
// XML strict d'odf-kit en échec dès le premier chapitre.
// Correctif : sérialiser chaque enfant de l'enveloppe individuellement (au
// lieu de sérialiser l'enveloppe elle-même puis tenter de la retirer par
// texte) — l'enveloppe n'est alors jamais sérialisée, donc jamais présente
// dans la sortie, quels que soient les attributs qu'un sérialiseur pourrait
// lui ajouter. Un `xmlns` peut apparaître sur les éléments de premier niveau
// du fragment obtenu (inoffensif : odf-kit l'ignore, comme tout attribut
// qu'il ne reconnaît pas).
function toXhtmlSafe(html) {
  const clean = DOMPurify.sanitize(html || '<p></p>');
  const doc = new DOMParser().parseFromString(`<div>${clean}</div>`, 'text/html');
  const wrapper = doc.body.firstChild;
  const serializer = new XMLSerializer();
  return Array.from(wrapper.childNodes).map(node => serializer.serializeToString(node)).join('');
}
async function exportEpub(chapters, title) {
  if (typeof JSZip === 'undefined') { toast('Bibliothèque EPUB non chargée (vérifiez la connexion).', 'error'); return; }
  if (!chapters || !chapters.length) { toast('Aucun chapitre sélectionné.', 'error'); return; }

  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression:'STORE' });
  zip.folder('META-INF').file('container.xml',
`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);

  const oebps = zip.folder('OEBPS');
  const uid = 'urn:uuid:' + genChapterId();
  const bookTitle = title || 'Mon Roman — Plume';

  const manifestItems = [], spineItems = [], navPoints = [];

  chapters.forEach((ch, i) => {
    const fname = `chapter${i+1}.xhtml`;
    const chTitle = escapeXml(ch.title || `Chapitre ${i+1}`);
    oebps.file(fname,
`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${chTitle}</title></head>
<body><h1>${chTitle}</h1>${toXhtmlSafe(ch.content)}</body>
</html>`);
    manifestItems.push(`<item id="chap${i+1}" href="${fname}" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<itemref idref="chap${i+1}"/>`);
    navPoints.push(`<navPoint id="navPoint-${i+1}" playOrder="${i+1}"><navLabel><text>${chTitle}</text></navLabel><content src="${fname}"/></navPoint>`);
  });

  oebps.file('content.opf',
`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${escapeXml(bookTitle)}</dc:title>
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
  <docTitle><text>${escapeXml(bookTitle)}</text></docTitle>
  <navMap>
    ${navPoints.join('\n    ')}
  </navMap>
</ncx>`);

  const blob = await zip.generateAsync({ type:'blob', mimeType:'application/epub+zip' });
  saveAs(blob, 'roman_plume.epub');
  toast('Export EPUB généré', 'success');
}

// Export ODT (nouveau v7.13.0, Lot 10) — via odf-kit (chargé en ESM, voir
// js/odf-loader.js). NB : le HTML final envoyé à htmlToOdt() est une suite
// de <h1>/<h2>/contenu SANS balise racine commune — c'est volontaire et
// correct : parseHtml() (dans odf-kit) enveloppe systématiquement l'entrée
// dans SA PROPRE balise avant analyse, donc chaque chapitre est bien
// conservé (vérifié dans le code source d'odf-kit avant ce correctif).
async function exportOdt(chapters, title) {
  if (!window.odfKit || !window.odfKit.htmlToOdt) { toast('Bibliothèque ODT non chargée (vérifiez la connexion).', 'error'); return; }
  if (!chapters || !chapters.length) { toast('Aucun chapitre sélectionné.','error'); return; }
  try {
    let html = `<h1>${escapeXml(title || 'Mon Roman — Plume')}</h1>`;
    chapters.forEach((ch, i) => {
      html += `<h2>Chapitre ${i+1} : ${escapeXml(ch.title||'')}</h2>` + toXhtmlSafe(ch.content);
    });
    const bytes = await window.odfKit.htmlToOdt(html, { pageFormat:'A4' });
    const blob = new Blob([bytes], { type:'application/vnd.oasis.opendocument.text' });
    saveAs(blob, 'roman_plume.odt');
    toast('Export ODT réussi !', 'success');
  } catch(e) {
    toast('Erreur export ODT : ' + e.message, 'error');
  }
}

// Export PDF (nouveau v7.15.0) — via jsPDF, déjà chargé dans le projet
// (utilisé jusqu'ici pour le PDF de code de récupération de profil).
async function exportPdf(chapters, title) {
  if (!window.jspdf || !window.jspdf.jsPDF) { toast('Bibliothèque PDF non chargée (vérifiez la connexion).', 'error'); return; }
  if (!chapters || !chapters.length) { toast('Aucun chapitre sélectionné.', 'error'); return; }
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'mm', format:'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const maxWidth = pageWidth - margin * 2;
    let y = margin;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
    const titleLines = doc.splitTextToSize(title || 'Mon Roman — Plume', maxWidth);
    doc.text(titleLines, pageWidth / 2, 60, { align:'center' });
    doc.addPage();
    y = margin;

    chapters.forEach((ch, i) => {
      if (y + 12 > pageHeight - margin) { doc.addPage(); y = margin; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
      doc.text(`Chapitre ${i+1} : ${ch.title||''}`, margin, y);
      y += 10;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
      getPlainText(ch.content).split('\n').forEach(line => {
        if (!line.trim()) { y += 5; return; }
        doc.splitTextToSize(line.trim(), maxWidth).forEach(wrappedLine => {
          if (y + 6 > pageHeight - margin) { doc.addPage(); y = margin; }
          doc.text(wrappedLine, margin, y);
          y += 6;
        });
      });
      y += 8;
    });

    doc.save('roman_plume.pdf');
    toast('Export PDF réussi !', 'success');
  } catch(e) {
    toast('Erreur export PDF : ' + e.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════
// SÉLECTION DES CHAPITRES À EXPORTER (v6.2.0, généralisé v7.13.0)
// Un seul bouton "📤 Exporter" en bibliothèque ouvre ce panneau ; le choix
// du FORMAT (DOCX/ODT/PDF/EPUB) se fait ensuite, en bas du panneau.
// ═══════════════════════════════════════════════════════
let _exportSelectChapters = [], _exportSelectTitle = '';
function openExportSelect(chapters, title) {
  _exportSelectChapters = chapters || [];
  _exportSelectTitle = title || '';
  const listEl = document.getElementById('export-select-list');
  listEl.innerHTML = _exportSelectChapters.map((ch,i) =>
    `<label class="u-d-flex u-ai-center u-gap-8px u-fs-_82rem u-p-4px-0 u-cur-pointer">
      <input type="checkbox" class="export-select-cb" data-idx="${i}" checked>
      ${DOMPurify.sanitize(ch.title||('Chapitre '+(i+1)))}
    </label>`
  ).join('');
  document.getElementById('export-select-overlay').classList.add('active');
}
function closeExportSelect() { document.getElementById('export-select-overlay').classList.remove('active'); }
function getSelectedExportChapters() {
  const idxs = Array.from(document.querySelectorAll('.export-select-cb:checked')).map(cb => parseInt(cb.dataset.idx));
  return idxs.map(i => _exportSelectChapters[i]).filter(Boolean);
}
function toggleAllExportSelect() {
  const boxes = document.querySelectorAll('.export-select-cb');
  const allChecked = Array.from(boxes).every(cb => cb.checked);
  boxes.forEach(cb => cb.checked = !allChecked);
}

// ═══════════════════════════════════════════════════════
// IMPORT DOCX / ODT (nouveau v7.12.0, généralisé v7.13.0 — Lot 10)
// mammoth.js pour .docx, odf-kit pour .odt — conversion 100% dans le
// navigateur, rien n'est envoyé nulle part. Le résultat passe toujours par
// DOMPurify avant tout stockage (convention XSS du projet). L'utilisateur
// choisit ensuite la destination :
//   - Nouveau manuscrit (avec titre à saisir)
//   - Nouveau chapitre dans un manuscrit existant de la bibliothèque
// ═══════════════════════════════════════════════════════
let _docxImportHtml = null, _docxImportTitleGuess = '';
function importManuscriptFile(input) {
  const file = input.files[0]; if (!file) return;
  const isOdt = /\.odt$/i.test(file.name);
  const isDocx = /\.docx$/i.test(file.name);
  if (!isOdt && !isDocx) { toast('Format non reconnu (.docx ou .odt attendu).', 'error'); input.value=''; return; }
  if (isDocx && typeof mammoth === 'undefined') { toast('Bibliothèque DOCX non chargée (vérifiez la connexion).', 'error'); input.value=''; return; }
  if (isOdt && (!window.odfKit || !window.odfKit.odtToHtml)) { toast('Bibliothèque ODT non chargée (vérifiez la connexion).', 'error'); input.value=''; return; }
  _docxImportTitleGuess = file.name.replace(/\.(docx|odt)$/i, '').trim() || 'Chapitre importé';
  const convert = isOdt
    ? file.arrayBuffer().then(buf => window.odfKit.odtToHtml(new Uint8Array(buf), { fragment:true }))
    : file.arrayBuffer().then(buf => mammoth.convertToHtml({ arrayBuffer: buf })).then(r => r.value);
  Promise.resolve(convert).then(html => {
    _docxImportHtml = DOMPurify.sanitize(html || '<p></p>');
    openDocxImportModal(file.name);
  }).catch(err => { toast('Fichier invalide : ' + err.message, 'error'); }).finally(() => { input.value = ''; });
}
async function openDocxImportModal(filename) {
  document.getElementById('docx-import-filename').textContent = filename;
  document.getElementById('docx-new-title').value = _docxImportTitleGuess;
  const list = await loadDocList();
  const sel = document.getElementById('docx-existing-select');
  sel.innerHTML = list.documents.slice().sort((a,b)=>b.lastModified-a.lastModified)
    .map(d => `<option value="${d.id}">${DOMPurify.sanitize(d.title || 'Sans titre')}</option>`).join('');
  setDocxImportMode('new');
  document.getElementById('docx-import-overlay').classList.add('active');
}
function closeDocxImportModal() {
  document.getElementById('docx-import-overlay').classList.remove('active');
  _docxImportHtml = null;
}
function setDocxImportMode(mode) {
  const isNew = mode === 'new';
  document.getElementById('docx-mode-new-btn').classList.toggle('active', isNew);
  document.getElementById('docx-mode-existing-btn').classList.toggle('active', !isNew);
  document.getElementById('docx-new-fields').style.display = isNew ? 'block' : 'none';
  document.getElementById('docx-existing-fields').style.display = isNew ? 'none' : 'block';
}
async function confirmDocxImport() {
  if (!_docxImportHtml) { closeDocxImportModal(); return; }
  const isNew = document.getElementById('docx-mode-new-btn').classList.contains('active');
  const newChapter = { id: genChapterId(), title: _docxImportTitleGuess, content: _docxImportHtml, tension:20, summary:'', status:'draft', tags:[] };

  if (isNew) {
    const title = document.getElementById('docx-new-title').value.trim() || 'Nouveau manuscrit';
    const list = await loadDocList();
    const docId = genChapterId();
    const dbData = DEFAULT_DB();
    dbData.title = title;
    dbData.chapters = [newChapter];
    const cipher = await Crypto.encrypt(JSON.stringify(dbData), _dataKey);
    await persistData(docDataKey(_currentProfileId, docId), { _enc:true, data:cipher });
    list.documents.push({ id:docId, title, lastModified:Date.now(), chapterCount:1, wordCount:getWordCount(newChapter.content), wordGoal:0, cover:'auto' });
    await saveDocList(list);
    closeDocxImportModal();
    toast('Nouveau manuscrit créé depuis le fichier importé.', 'success');
    await renderLibraryScreen();
    return;
  }

  const targetDocId = document.getElementById('docx-existing-select').value;
  if (!targetDocId) { toast('Aucun manuscrit disponible.', 'error'); closeDocxImportModal(); return; }
  try {
    const otherDb = await loadManuscriptData(targetDocId);
    otherDb.chapters.push(newChapter);
    await persistManuscriptData(targetDocId, otherDb);
    await touchDocListEntry(targetDocId, otherDb);
    closeDocxImportModal();
    toast(`Chapitre ajouté à « ${DOMPurify.sanitize(otherDb.title||'ce manuscrit')} ».`, 'success');
    await renderLibraryScreen();
  } catch(e) {
    toast('Erreur : ' + e.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════
// EXPORT / IMPORT JSON — BIBLIOTHÈQUE ENTIÈRE (généralisé v7.13.0, Lot 10)
// Auparavant limité à un seul manuscrit ; regroupe désormais tous les
// manuscrits du profil dans un seul fichier. Chaque manuscrit reste stocké
// sous sa forme chiffrée (_enc:true, data) — le fichier exporté ne contient
// donc jamais de contenu en clair, cohérent avec le chiffrement du profil.
// ═══════════════════════════════════════════════════════
async function megaExportLibrary() {
  try {
    const list = await loadDocList();
    const documents = {};
    for (const entry of list.documents) {
      documents[entry.id] = await loadData(docDataKey(_currentProfileId, entry.id));
    }
    const payload = JSON.stringify({ _plumeLibraryExport:true, version:1, doclist:list, documents });
    saveAs(new Blob([payload], {type:'application/json'}), 'bibliotheque_plume.json');
    toast('Export de toute la bibliothèque réussi.', 'success');
  } catch(e) {
    toast('Erreur export : ' + e.message, 'error');
  }
}
function importProjectLibrary(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const p = JSON.parse(e.target.result);
      if (!p._plumeLibraryExport || !p.documents) throw new Error('Ce fichier n\'est pas un export de bibliothèque Plume.');
      const list = await loadDocList();
      let added = 0;
      for (const oldId of Object.keys(p.documents)) {
        const oldEntry = (p.doclist && p.doclist.documents || []).find(d => d.id === oldId);
        const newId = genChapterId();
        // Chaque manuscrit importé devient un NOUVEAU manuscrit (nouvel
        // identifiant) — jamais d'écrasement d'un manuscrit existant.
        await persistData(docDataKey(_currentProfileId, newId), p.documents[oldId]);
        list.documents.push({
          id:newId,
          title: (oldEntry && oldEntry.title) || 'Manuscrit importé',
          lastModified: Date.now(),
          chapterCount: (oldEntry && oldEntry.chapterCount) || 0,
          wordCount: (oldEntry && oldEntry.wordCount) || 0,
          wordGoal: (oldEntry && oldEntry.wordGoal) || 0,
          cover: (oldEntry && oldEntry.cover) || 'auto'
        });
        added++;
      }
      await saveDocList(list);
      // Correction (audit) : le fichier importé peut venir d'un AUTRE profil
      // (DEK différente) — dans ce cas, les manuscrits sont bien copiés mais
      // resteraient silencieusement indéchiffrables. On vérifie ici en
      // tentant de déchiffrer un des documents importés, pour prévenir
      // clairement plutôt que de laisser croire à un import pleinement réussi.
      let unreadable = false;
      const firstNewId = list.documents[list.documents.length - added]?.id;
      if (firstNewId) {
        try { await loadManuscriptData(firstNewId); } catch(e) { unreadable = true; }
      }
      if (unreadable) {
        toast('⚠️ Import terminé, mais ces manuscrits semblent illisibles : ce fichier vient probablement d\'un autre profil.', 'error');
      } else {
        toast(added + ' manuscrit(s) importé(s) dans la bibliothèque.', 'success');
      }
      await renderLibraryScreen();
    } catch(err) {
      toast('Fichier invalide : ' + err.message, 'error');
    }
  };
  reader.onerror = () => toast('Erreur de lecture', 'error');
  reader.readAsText(file);
}
