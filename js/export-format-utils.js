'use strict';
// ═══════════════════════════════════════════════════════
// EXPORT DOCX / ODT / EPUB — v7.13.0 (Lot 10) : ces 3 fonctions opèrent
// désormais sur un tableau de chapitres passé explicitement, plutôt que sur
// le `db` global — l'export se fait maintenant depuis la bibliothèque, pour
// un manuscrit qui n'est pas forcément celui ouvert dans l'éditeur.
// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// v9.35.0 (audit AUD-02-003 / 013 / 017) — EXPORTS FIDÈLES
//  • DOCX et PDF gardent gras, italique, souligné, titres et retours à la ligne (avant : texte brut,
//    alors que l'EPUB et l'ODT gardaient le HTML) ;
//  • « Chapitre N : » n'est plus ajouté devant un titre qui commence déjà par « Chapitre » ;
//  • le fichier porte le nom du manuscrit (avant : roman_plume.* pour tous) ;
//  • un seul message si un composant d'export manque (les librairies sont servies par le site, ce
//    n'est jamais un problème de connexion).
// ═══════════════════════════════════════════════════════
const EXPORT_LIB_MISSING = "Composant d'export introuvable : rechargez la page et acceptez la mise à jour de l'application.";

function exportChapterTitle(ch, i) {
  const t = String((ch && ch.title) || '').trim();
  if (!t) return `Chapitre ${i + 1}`;
  return /^chapitre\b/i.test(t) ? t : `Chapitre ${i + 1} : ${t}`;
}
function exportFileName(title, ext) {
  const base = String(title || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80);
  return (base || 'manuscrit') + '.' + ext;
}

// Découpe le HTML d'un chapitre en blocs { heading: 0|1|2|3, runs: [{ text, bold, italic, underline, br }] }.
// Un bloc = un paragraphe ou un titre ; les retours à la ligne internes sont des runs { br: true }.
function htmlToExportBlocks(html) {
  const clean = DOMPurify.sanitize(stripAnalysisMarks(html || ''));
  const body = new DOMParser().parseFromString('<body>' + clean + '</body>', 'text/html').body;
  const blocks = [];
  const BLOCK = /^(p|div|h[1-6]|li|blockquote|pre)$/;
  let current = null;
  const open = heading => { current = { heading: heading || 0, runs: [] }; blocks.push(current); return current; };
  const walk = (node, st, heading) => {
    node.childNodes.forEach(child => {
      if (child.nodeType === 3) {
        const text = child.textContent.replace(/[\r\n\t]+/g, ' ');
        if (!text || (!current && !text.trim())) return;
        if (!current) open(heading);
        current.runs.push({ text, bold: st.bold, italic: st.italic, underline: st.underline });
        return;
      }
      if (child.nodeType !== 1) return;
      const tag = child.tagName.toLowerCase();
      if (tag === 'br') { if (!current) open(heading); current.runs.push({ br: true }); return; }
      if (BLOCK.test(tag)) {
        const level = /^h[1-3]$/.test(tag) ? Number(tag[1]) : (/^h[4-6]$/.test(tag) ? 3 : 0);
        open(level || heading);
        walk(child, level ? { ...st, bold: true } : st, level || heading);
        current = null;
        return;
      }
      const next = { ...st };
      if (tag === 'strong' || tag === 'b') next.bold = true;
      if (tag === 'em' || tag === 'i') next.italic = true;
      if (tag === 'u') next.underline = true;
      walk(child, next, heading);
    });
  };
  walk(body, { bold: false, italic: false, underline: false }, 0);
  return blocks;
}

async function exportDocx(chapters, title) {
  if (typeof docx === 'undefined') { toast(EXPORT_LIB_MISSING, 'error'); return; }
  if (!chapters || !chapters.length) { toast('Aucun chapitre sélectionné.','error'); return; }
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docx;
  const HEAD = [null, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_3];
  const children = [new Paragraph({ text: title || 'Mon Roman — Plume', heading:HeadingLevel.TITLE })];
  chapters.forEach((ch, i) => {
    children.push(new Paragraph({ text: exportChapterTitle(ch, i), heading:HeadingLevel.HEADING_1 }));
    htmlToExportBlocks(ch.content).forEach(block => {
      const runs = block.runs.map(r => r.br
        ? new TextRun({ break: 1 })
        : new TextRun({ text: r.text, size: 24, bold: r.bold || undefined, italics: r.italic || undefined, underline: r.underline ? {} : undefined }));
      children.push(new Paragraph(block.heading ? { heading: HEAD[block.heading], children: runs } : { children: runs }));
    });
    children.push(new Paragraph({}));
  });
  const blob = await Packer.toBlob(new Document({ sections:[{ children }] }));
  saveAs(blob, exportFileName(title, 'docx')); toast('Export DOCX réussi !','success');
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
  const clean = DOMPurify.sanitize(stripAnalysisMarks(html) || '<p></p>');
  const doc = new DOMParser().parseFromString(`<div>${clean}</div>`, 'text/html');
  const wrapper = doc.body.firstChild;
  const serializer = new XMLSerializer();
  return Array.from(wrapper.childNodes).map(node => serializer.serializeToString(node)).join('');
}
async function exportEpub(chapters, title) {
  if (typeof JSZip === 'undefined') { toast(EXPORT_LIB_MISSING, 'error'); return; }
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
  saveAs(blob, exportFileName(title, 'epub'));
  toast('Export EPUB généré', 'success');
}

// Export ODT (nouveau v7.13.0, Lot 10) — via odf-kit (chargé en ESM, voir
// js/odf-loader.js). NB : le HTML final envoyé à htmlToOdt() est une suite
// de <h1>/<h2>/contenu SANS balise racine commune — c'est volontaire et
// correct : parseHtml() (dans odf-kit) enveloppe systématiquement l'entrée
// dans SA PROPRE balise avant analyse, donc chaque chapitre est bien
// conservé (vérifié dans le code source d'odf-kit avant ce correctif).
async function exportOdt(chapters, title) {
  if (!window.odfKit || !window.odfKit.htmlToOdt) { toast(EXPORT_LIB_MISSING, 'error'); return; }
  if (!chapters || !chapters.length) { toast('Aucun chapitre sélectionné.','error'); return; }
  try {
    let html = `<h1>${escapeXml(title || 'Mon Roman — Plume')}</h1>`;
    chapters.forEach((ch, i) => {
      html += `<h2>${escapeXml(exportChapterTitle(ch, i))}</h2>` + toXhtmlSafe(ch.content);
    });
    const bytes = await window.odfKit.htmlToOdt(html, { pageFormat:'A4' });
    const blob = new Blob([bytes], { type:'application/vnd.oasis.opendocument.text' });
    saveAs(blob, exportFileName(title, 'odt'));
    toast('Export ODT réussi !', 'success');
  } catch(e) {
    toast('Erreur export ODT : ' + e.message, 'error');
  }
}

// Export PDF (nouveau v7.15.0) — via jsPDF, déjà chargé dans le projet
// (utilisé jusqu'ici pour le PDF de code de récupération de profil).
// Mise en page d'un manuscrit en PDF (v9.35.0, AUD-02-003) : Times 12 pt, alinéa de première ligne,
// chaque chapitre sur une nouvelle page, numéros de page. Les mots sont placés un par un pour
// pouvoir mélanger romain / gras / italique sur une même ligne. N'utilise de jsPDF que :
// setFont, setFontSize, getTextWidth, text, line, addPage, internal.pageSize.
const PDF_LAYOUT = { margin: 25, bottom: 25, fontSize: 12, lineHeight: 6.4, indent: 8, headSizes: [12, 16, 14, 12.5] };
function pdfFontStyle(r) { return r.bold && r.italic ? 'bolditalic' : r.bold ? 'bold' : r.italic ? 'italic' : 'normal'; }
// Découpe les runs d'un bloc en « mots » stylés ; un retour à la ligne forcé devient { br: true }.
function pdfTokens(runs) {
  const tokens = [];
  runs.forEach(r => {
    if (r.br) { tokens.push({ br: true }); return; }
    const parts = String(r.text).split(/(\s+)/);
    parts.forEach(p => {
      if (!p) return;
      if (/^\s+$/.test(p)) { tokens.push({ space: true, style: pdfFontStyle(r) }); return; }
      tokens.push({ text: p, style: pdfFontStyle(r), underline: !!r.underline });
    });
  });
  return tokens;
}
// Écrit les blocs d'un chapitre à partir de la position y ; renvoie la nouvelle position y.
function pdfWriteBlocks(doc, blocks, y, L) {
  const pageW = doc.internal.pageSize.getWidth(), pageH = doc.internal.pageSize.getHeight();
  const maxX = pageW - L.margin;
  const ensure = need => { if (y + need > pageH - L.bottom) { doc.addPage(); y = L.margin; } };
  blocks.forEach(block => {
    const size = block.heading ? L.headSizes[block.heading] : L.fontSize;
    const lineH = block.heading ? L.lineHeight * size / L.fontSize : L.lineHeight;
    doc.setFontSize(size);
    if (block.heading) y += 3;
    const tokens = pdfTokens(block.runs);
    const base = block.heading ? 'bold' : 'normal';
    doc.setFont('times', base);
    const spaceW = doc.getTextWidth(' ');
    let x = L.margin + (block.heading ? 0 : L.indent);
    let line = []; // segments de la ligne en cours : { text, style, underline, x, w }
    let pendingSpace = false, empty = true;
    const flush = () => {
      ensure(lineH);
      line.forEach(seg => {
        doc.setFont('times', block.heading ? 'bold' : seg.style);
        doc.text(seg.text, seg.x, y);
        if (seg.underline) doc.line(seg.x, y + 0.7, seg.x + seg.w, y + 0.7);
      });
      y += lineH; line = []; x = L.margin; pendingSpace = false;
    };
    tokens.forEach(t => {
      if (t.br) { flush(); empty = false; return; }
      if (t.space) { pendingSpace = true; return; }
      doc.setFont('times', block.heading ? 'bold' : t.style);
      const w = doc.getTextWidth(t.text);
      const gap = (pendingSpace && line.length) ? spaceW : 0;
      if (line.length && x + gap + w > maxX) { flush(); }
      const sx = line.length ? x + ((pendingSpace) ? spaceW : 0) : x;
      const last = line[line.length - 1];
      if (last && last.style === t.style && !!last.underline === t.underline && pendingSpace) {
        last.text += ' ' + t.text; last.w = sx + w - last.x; // même style : un seul appel d'écriture
      } else if (last && last.style === t.style && !!last.underline === t.underline && !pendingSpace) {
        last.text += t.text; last.w = sx + w - last.x;
      } else {
        line.push({ text: t.text, style: t.style, underline: t.underline, x: sx, w });
      }
      x = sx + w; pendingSpace = false; empty = false;
    });
    if (line.length || empty) flush();
    if (block.heading) y += 2;
  });
  return y;
}
async function exportPdf(chapters, title) {
  if (!window.jspdf || !window.jspdf.jsPDF) { toast(EXPORT_LIB_MISSING, 'error'); return; }
  if (!chapters || !chapters.length) { toast('Aucun chapitre sélectionné.', 'error'); return; }
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'mm', format:'a4', compress:true });
    const L = PDF_LAYOUT;
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFont('times', 'bold'); doc.setFontSize(24);
    doc.text(doc.splitTextToSize(title || 'Mon Roman — Plume', pageWidth - L.margin * 2), pageWidth / 2, 90, { align:'center' });
    chapters.forEach((ch, i) => {
      doc.addPage();
      let y = L.margin + 10;
      doc.setFont('times', 'bold'); doc.setFontSize(16);
      doc.text(doc.splitTextToSize(exportChapterTitle(ch, i), pageWidth - L.margin * 2), pageWidth / 2, y, { align:'center' });
      y += 14;
      pdfWriteBlocks(doc, htmlToExportBlocks(ch.content), y, L);
    });
    // Numéros de page (la page de titre n'est pas numérotée).
    const pages = doc.getNumberOfPages();
    doc.setFont('times', 'normal'); doc.setFontSize(10);
    for (let p = 2; p <= pages; p++) {
      doc.setPage(p);
      doc.text(String(p - 1), pageWidth / 2, doc.internal.pageSize.getHeight() - 12, { align:'center' });
    }
    doc.save(exportFileName(title, 'pdf'));
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
// v9.36.0 (audit AUD-02-004) — DÉCOUPAGE À L'IMPORT. Un roman Word devenait un seul chapitre géant.
// On repère les titres du fichier : le niveau de titre le plus haut présent (titre 1, sinon titre 2) ;
// à défaut, les lignes courtes « Chapitre 3 », « Chapter 3 », « Prologue », « Épilogue ». Le texte avant le
// premier titre devient un chapitre à part s'il n'est pas vide. Renvoie null si moins de 2 chapitres.
function splitImportedHtml(html, firstTitle) {
  const root = document.createElement('div');
  root.innerHTML = html || '';
  const nodes = Array.from(root.childNodes);
  const isHeading = (n, tag) => n.nodeType === 1 && n.tagName.toLowerCase() === tag;
  const textOf = n => (n.textContent || '').replace(/\s+/g, ' ').trim();
  let test = null;
  for (const tag of ['h1', 'h2']) {
    if (nodes.filter(n => isHeading(n, tag) && textOf(n)).length >= 2) { test = n => isHeading(n, tag) && !!textOf(n); break; }
  }
  if (!test) {
    const re = /^(chapitre|chapter)\s+([0-9]+|[ivxlcdm]+|[a-zéèêûîô-]+)\b|^(prologue|épilogue|epilogue)\s*$/i;
    const asTitle = n => n.nodeType === 1 && /^(p|h[1-6])$/i.test(n.tagName) && textOf(n).length > 0 && textOf(n).length < 80 && re.test(textOf(n));
    if (nodes.filter(asTitle).length >= 2) test = asTitle;
  }
  if (!test) return null;
  const chapters = [];
  let current = { title: firstTitle || 'Début', parts: [], preface: true };
  nodes.forEach(n => {
    if (test(n)) {
      chapters.push(current);
      current = { title: textOf(n), parts: [] };
    } else if (n.nodeType === 1) current.parts.push(n.outerHTML);
    else if (n.nodeType === 3 && n.textContent.trim()) current.parts.push('<p>' + escapeHtml(n.textContent) + '</p>');
  });
  chapters.push(current);
  const out = chapters
    .filter(c => !(c.preface && !c.parts.join('').replace(/<[^>]*>/g, '').trim()))
    .map(c => ({ title: c.title, content: c.parts.join('') || '<p></p>' }));
  return out.length >= 2 ? out : null;
}

let _docxImportHtml = null, _docxImportTitleGuess = '', _docxImportSplit = null;
function importManuscriptFile(input) {
  const file = input.files[0]; if (!file) return;
  const isOdt = /\.odt$/i.test(file.name);
  const isDocx = /\.docx$/i.test(file.name);
  if (!isOdt && !isDocx) { toast('Format non reconnu (.docx ou .odt attendu).', 'error'); input.value=''; return; }
  if (isDocx && typeof mammoth === 'undefined') { toast(EXPORT_LIB_MISSING, 'error'); input.value=''; return; }
  if (isOdt && (!window.odfKit || !window.odfKit.odtToHtml)) { toast(EXPORT_LIB_MISSING, 'error'); input.value=''; return; }
  _docxImportTitleGuess = file.name.replace(/\.(docx|odt)$/i, '').trim() || 'Chapitre importé';
  const convert = isOdt
    ? file.arrayBuffer().then(buf => window.odfKit.odtToHtml(new Uint8Array(buf), { fragment:true }))
    : file.arrayBuffer().then(buf => mammoth.convertToHtml({ arrayBuffer: buf })).then(r => r.value);
  Promise.resolve(convert).then(html => {
    _docxImportHtml = sanitizeManuscriptHtml(html || '<p></p>'); // v9.27.0 : sans attributs style (l'import ODT en produit)
    openDocxImportModal(file.name);
  }).catch(err => { toast('Fichier invalide : ' + err.message, 'error'); }).finally(() => { input.value = ''; });
}
async function openDocxImportModal(filename) {
  document.getElementById('docx-import-filename').textContent = filename;
  document.getElementById('docx-new-title').value = _docxImportTitleGuess;
  const list = await loadDocList();
  const sel = document.getElementById('docx-existing-select');
  sel.innerHTML = list.documents.filter(d => d.docType !== 'roman_graphique').sort((a,b)=>b.lastModified-a.lastModified)
    .map(d => `<option value="${d.id}">${DOMPurify.sanitize(d.title || 'Sans titre')}</option>`).join('');
  setDocxImportMode('new');
  // v9.36.0 : proposition de découpage si des titres de chapitres sont détectés.
  _docxImportSplit = splitImportedHtml(_docxImportHtml, _docxImportTitleGuess);
  const splitWrap = document.getElementById('docx-split-wrap');
  if (splitWrap) {
    splitWrap.classList.toggle('u-d-none', !_docxImportSplit);
    if (_docxImportSplit) {
      document.getElementById('docx-split-cb').checked = true;
      document.getElementById('docx-split-label').textContent = 'Découper en ' + _docxImportSplit.length + ' chapitres (titres détectés dans le fichier)';
    }
  }
  document.getElementById('docx-import-overlay').classList.add('active');
}
function closeDocxImportModal() {
  document.getElementById('docx-import-overlay').classList.remove('active');
  _docxImportHtml = null; _docxImportSplit = null;
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
  const mkChapter = (title, content) => ({ id: genChapterId(), title, content, tension:20, summary:'', status:'draft', tags:[], wordGoal:0, researchNotes:'' });
  const splitCb = document.getElementById('docx-split-cb');
  const newChapters = (_docxImportSplit && splitCb && splitCb.checked)
    ? _docxImportSplit.map(c => mkChapter(c.title, c.content))
    : [mkChapter(_docxImportTitleGuess, _docxImportHtml)];

  if (isNew) {
    const title = document.getElementById('docx-new-title').value.trim() || 'Nouveau manuscrit';
    const docId = genChapterId();
    const dbData = DEFAULT_DB();
    dbData.title = title;
    dbData.chapters = newChapters;
    const cipher = await Crypto.encryptData(JSON.stringify(dbData), _dataKey);
    await persistData(docDataKey(_currentProfileId, docId), { _enc:true, data:cipher });
    await mutateDocList(list => {
      list.documents.push({ id:docId, title, lastModified:Date.now(), chapterCount:newChapters.length, wordCount:newChapters.reduce((t, c) => t + getWordCount(c.content), 0), wordGoal:0, cover:'auto', docType:'texte' });
    });
    closeDocxImportModal();
    toast('Nouveau manuscrit créé depuis le fichier importé.', 'success');
    await renderLibraryScreen();
    return;
  }

  const targetDocId = document.getElementById('docx-existing-select').value;
  if (!targetDocId) { toast('Aucun manuscrit disponible.', 'error'); closeDocxImportModal(); return; }
  try {
    const otherDb = await loadManuscriptData(targetDocId);
    if (!Array.isArray(otherDb.chapters)) { toast("Un roman graphique n'accepte pas de chapitres.", 'error'); return; }
    newChapters.forEach(c => otherDb.chapters.push(c));
    await persistManuscriptData(targetDocId, otherDb);
    await touchDocListEntry(targetDocId, otherDb);
    closeDocxImportModal();
    toast(newChapters.length > 1 ? `${newChapters.length} chapitres ajoutés à « ${DOMPurify.sanitize(otherDb.title||'ce manuscrit')} ».` : `Chapitre ajouté à « ${DOMPurify.sanitize(otherDb.title||'ce manuscrit')} ».`, 'success');
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
// v9.16.0 (Lot 7, audit #25) : les images des romans graphiques vivent dans
// une base locale séparée (voir js/images.js), jamais dans le blob chiffré
// ci-dessus — sans ce bloc, un manuscrit illustré restauré depuis ce fichier
// perdrait silencieusement toutes ses images (positions conservées, cadres
// vides). `images` regroupe, par manuscrit, chaque image en base64 —
// `version:2` marque cet ajout ; un fichier `version:1` plus ancien n'a
// simplement pas ce champ, l'import reste compatible.
async function megaExportLibrary() {
  try {
    const list = await loadDocList();
    const documents = {};
    const images = {};
    for (const entry of list.documents) {
      documents[entry.id] = await loadData(docDataKey(_currentProfileId, entry.id));
      if (entry.docType === 'roman_graphique' && typeof getAllGraphicImagesForDocument === 'function') {
        const recs = await getAllGraphicImagesForDocument(entry.id);
        if (recs.length) {
          // v9.28.0 (AUD-01-011) : octets CHIFFRÉS avec la clé du profil (comme les manuscrits du même
          // fichier) — avant, images en clair dans un fichier réputé chiffré. `enc:true` les distingue
          // des anciens exports (images en clair), toujours acceptés à l'import.
          const lot = [];
          for (const r of recs) {
            const cipher = await graphicImageCipher(r);
            if (cipher) lot.push({ id: r.id, width: r.width, height: r.height, mime: r.mime || 'image/webp', enc: true, data: bytesToBase64(cipher) });
          }
          images[entry.id] = lot;
        }
      }
    }
    const payload = JSON.stringify({ _plumeLibraryExport:true, version:3, doclist:list, documents, images });
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
      const newEntries = [];
      let added = 0;
      for (const oldId of Object.keys(p.documents)) {
        const oldEntry = (p.doclist && p.doclist.documents || []).find(d => d.id === oldId);
        const newId = genChapterId();
        let envelope = p.documents[oldId];
        const imgList = (p.images && p.images[oldId]) || [];
        // Restaure les images de ce manuscrit (Lot 7, audit #25) — avec un
        // NOUVEL id à chaque image (comme duplicateGraphicImage() pour la
        // duplication de page) : réutiliser l'id d'origine tel quel serait
        // dangereux si ce fichier est un backup du MÊME profil dont les
        // manuscrits d'origine sont encore présents localement — la base
        // d'images étant indexée par id global (pas par manuscrit), une
        // image réimportée sous son id d'origine "volerait" (réassignerait
        // silencieusement) l'image existante à ce nouveau manuscrit,
        // cassant le manuscrit d'origine. D'où le remappage des imageId
        // DANS le contenu déchiffré avant réenregistrement.
        if (imgList.length && typeof restoreGraphicImage === 'function') {
          try {
            const decrypted = envelope && envelope._enc ? await Crypto.decrypt(envelope.data, _dataKey) : null;
            if (decrypted) {
              const docData = JSON.parse(decrypted);
              const idMap = {};
              imgList.forEach(img => { idMap[img.id] = genElementId(); });
              (docData.pages || []).forEach(pg => (pg.elements || []).forEach(el => {
                if (el.type === 'image' && el.imageId && idMap[el.imageId]) el.imageId = idMap[el.imageId];
              }));
              docData.gistSyncedImageIds = []; // nouveau manuscrit, jamais encore synchronisé
              const cipher = await Crypto.encryptData(JSON.stringify(docData), _dataKey);
              envelope = { _enc:true, data:cipher };
              for (const img of imgList) {
                const bytes = Uint8Array.from(atob(img.data), c => c.charCodeAt(0));
                // v9.28.0 : export chiffré (enc:true, octets chiffrés avec la clé du profil — vérifiés avant
                // d'être gardés) ou ancien export en clair (rechiffré ici). restoreGraphicImage calcule
                // l'empreinte de déduplication et chiffre au repos.
                await restoreGraphicImage(img.enc
                  ? { id: idMap[img.id], docId: newId, cipherBytes: bytes, mime: img.mime, width: img.width, height: img.height, refCount: 1 }
                  : { id: idMap[img.id], docId: newId, plainBytes: bytes, mime: img.mime || 'image/webp', width: img.width, height: img.height, refCount: 1 });
              }
            }
            // decrypted === null : fichier d'un autre profil, illisible de
            // toute façon — le message d'alerte plus bas prévient l'utilisateur.
            // Pas de remappage possible ni nécessaire (pas de risque de
            // collision d'id avec un fichier qu'on ne peut pas déchiffrer).
          } catch(e) { /* la restauration d'image ne doit pas bloquer le reste de l'import */ }
        }
        // Chaque manuscrit importé devient un NOUVEAU manuscrit (nouvel
        // identifiant) — jamais d'écrasement d'un manuscrit existant.
        await persistData(docDataKey(_currentProfileId, newId), envelope);
        newEntries.push({
          id:newId,
          title: (oldEntry && oldEntry.title) || 'Manuscrit importé',
          lastModified: Date.now(),
          chapterCount: (oldEntry && oldEntry.chapterCount) || 0,
          wordCount: (oldEntry && oldEntry.wordCount) || 0,
          wordGoal: (oldEntry && oldEntry.wordGoal) || 0,
          cover: (oldEntry && oldEntry.cover) || 'auto',
          docType: (oldEntry && oldEntry.docType) || 'texte'
        });
        added++;
      }
      await mutateDocList(list => { newEntries.forEach(entry => list.documents.push(entry)); });
      // Correction (audit) : le fichier importé peut venir d'un AUTRE profil
      // (DEK différente) — dans ce cas, les manuscrits sont bien copiés mais
      // resteraient silencieusement indéchiffrables. On vérifie ici en
      // tentant de déchiffrer un des documents importés, pour prévenir
      // clairement plutôt que de laisser croire à un import pleinement réussi.
      let unreadable = false;
      const firstNewId = newEntries[0]?.id;
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
