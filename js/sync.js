'use strict';
// ═══════════════════════════════════════════════════════
// EXPORT DOCX
// ═══════════════════════════════════════════════════════
async function exportDocx(indices) {
  flushCurrentChapter();
  if (typeof docx === 'undefined') { toast('Lib DOCX non chargée','error'); return; }
  const chapters = Array.isArray(indices) ? indices.map(i => db.chapters[i]).filter(Boolean) : db.chapters;
  if (!chapters.length) { toast('Aucun chapitre sélectionné.','error'); return; }
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docx;
  const children = [new Paragraph({ text:'Mon Roman — Plume Épique Studio', heading:HeadingLevel.TITLE })];
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

// ═══════════════════════════════════════════════════════
// EXPORT EPUB (nouveau v6.1.0)
// Génère un .epub minimal valide (mimetype + container.xml + content.opf +
// toc.ncx + un fichier xhtml par chapitre) via JSZip. Le contenu de chaque
// chapitre est repassé par le navigateur (DOMParser + XMLSerializer) pour
// produire du XHTML bien formé, requis par le format EPUB.
// ═══════════════════════════════════════════════════════
function escapeXml(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function toXhtmlSafe(html) {
  const clean = DOMPurify.sanitize(html || '<p></p>');
  const doc = new DOMParser().parseFromString(`<div>${clean}</div>`, 'text/html');
  const div = doc.body.firstChild;
  return new XMLSerializer().serializeToString(div).replace(/^<div>|<\/div>$/g, '');
}
async function exportEpub(indices) {
  flushCurrentChapter();
  if (typeof JSZip === 'undefined') { toast('Bibliothèque EPUB non chargée (vérifiez la connexion).', 'error'); return; }
  const chapters = Array.isArray(indices) ? indices.map(i => db.chapters[i]).filter(Boolean) : db.chapters;
  if (!chapters.length) { toast('Aucun chapitre sélectionné.','error'); return; }

  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression:'STORE' });
  zip.folder('META-INF').file('container.xml',
`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);

  const oebps = zip.folder('OEBPS');
  const uid = 'urn:uuid:' + genChapterId();
  const title = 'Mon Roman — Plume Épique';

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
    <dc:title>${escapeXml(title)}</dc:title>
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
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>
    ${navPoints.join('\n    ')}
  </navMap>
</ncx>`);

  const blob = await zip.generateAsync({ type:'blob', mimeType:'application/epub+zip' });
  saveAs(blob, 'roman_plume.epub');
  toast('Export EPUB généré', 'success');
}

// ═══════════════════════════════════════════════════════
// CLOUD / BACKUP — GitHub Gist
// Correction v6.1.0 : si le projet est chiffré localement, la sauvegarde
// Gist est désormais chiffrée elle aussi avec le même mot de passe (avant,
// le Gist contenait le roman en clair même quand le chiffrement local
// était activé — cohérence de sécurité rétablie).
// ═══════════════════════════════════════════════════════
async function syncCloud(){
  flushCurrentChapter();
  if(!_cloudToken){toast('Token requis','error');return;}
  try{
    const payload = _encPassword
      ? JSON.stringify({ _enc:true, data: await Crypto.encrypt(JSON.stringify(db), _encPassword) })
      : JSON.stringify(db);
    const method=db.gistId?'PATCH':'POST',url=db.gistId?`https://api.github.com/gists/${db.gistId}`:'https://api.github.com/gists';
    const resp=await fetch(url,{method,headers:{'Authorization':`token ${_cloudToken}`,'Content-Type':'application/json'},body:JSON.stringify({public:false,files:{"plume.json":{content:payload}}})});
    if(!resp.ok)throw new Error(`HTTP ${resp.status}`);const data=await resp.json();
    if(data.id){db.gistId=data.id;document.getElementById('gist-id').value=data.id;save();document.getElementById('cloud-status').innerText='✅ Sauvegardé (gist privé'+(_encPassword?', chiffré':'')+')';}
  }catch(e){document.getElementById('cloud-status').innerText='❌ '+e.message;}
}
async function loadCloud(){
  const gistId=document.getElementById('gist-id').value.trim()||db.gistId;
  if(!gistId){toast('Gist ID requis','error');return;}
  try{
    const resp=await fetch(`https://api.github.com/gists/${gistId}`,{headers:_cloudToken?{'Authorization':`token ${_cloudToken}`}:{}});
    if(!resp.ok)throw new Error(`HTTP ${resp.status}`);const data=await resp.json();const raw=data.files?.["plume.json"]?.content;
    if(!raw)throw new Error('Fichier introuvable');
    await applyRemoteProjectJson(raw, 'cloud-status');
  }catch(e){document.getElementById('cloud-status').innerText='❌ '+e.message;}
}

// Historique des révisions du Gist (nouveau v6.1.0) : GitHub conserve
// automatiquement toutes les révisions d'un gist à chaque sauvegarde —
// on expose simplement cet historique déjà existant côté GitHub.
async function openGistHistory() {
  const gistId = document.getElementById('gist-id').value.trim() || db.gistId;
  if (!gistId) { toast('Gist ID requis','error'); return; }
  const listEl = document.getElementById('gist-history-list');
  listEl.innerHTML = '<div style="padding:10px;opacity:.6;">Chargement…</div>';
  document.getElementById('gist-history-overlay').classList.add('active');
  try {
    const resp = await fetch(`https://api.github.com/gists/${gistId}/commits`, { headers: _cloudToken ? {'Authorization':`token ${_cloudToken}`} : {} });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const commits = await resp.json();
    if (!commits.length) { listEl.innerHTML = '<div style="padding:10px;opacity:.6;">Aucun historique.</div>'; return; }
    listEl.innerHTML = '';
    commits.slice().reverse().forEach((c, i) => {
      const date = new Date(c.committed_at).toLocaleString('fr');
      const el = document.createElement('div');
      el.className = 'history-item';
      el.innerHTML = `<span>${i===0?'🟢 Version actuelle':'Révision'} — ${date}</span>`;
      el.addEventListener('click', () => loadGistRevision(gistId, c.version));
      listEl.appendChild(el);
    });
  } catch(e) {
    listEl.innerHTML = `<div style="padding:10px;color:var(--danger);">❌ ${e.message}</div>`;
  }
}
async function loadGistRevision(gistId, sha) {
  if (!confirm('Charger cette révision remplacera votre projet actuel. Continuer ?')) return;
  try {
    const resp = await fetch(`https://api.github.com/gists/${gistId}/${sha}`, { headers: _cloudToken ? {'Authorization':`token ${_cloudToken}`} : {} });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const raw = data.files?.["plume.json"]?.content;
    if (!raw) throw new Error('Fichier introuvable dans cette révision');
    await applyRemoteProjectJson(raw, null);
  } catch(e) {
    toast('Erreur : ' + e.message, 'error');
  }
}
function closeGistHistory() { document.getElementById('gist-history-overlay').classList.remove('active'); }

// Applique un JSON de projet reçu du cloud (gère la variante chiffrée
// {_enc:true, data} produite par syncCloud) puis recharge la page.
async function applyRemoteProjectJson(raw, statusElId) {
  let parsed = JSON.parse(raw);
  if (parsed._enc && parsed.data) {
    const pwd = prompt('Cette sauvegarde est chiffrée. Entrez le mot de passe :');
    if (!pwd) return;
    const dec = await Crypto.decrypt(parsed.data, pwd);
    if (!dec) {
      if (statusElId) document.getElementById(statusElId).innerText = '❌ Mot de passe incorrect.';
      else toast('Mot de passe incorrect.', 'error');
      return;
    }
    parsed = JSON.parse(dec);
    _encPassword = pwd; db = migrateDb(parsed); save(); location.reload();
    return;
  }
  if (!parsed.chapters) throw new Error('Format invalide');
  db = migrateDb(parsed); save(); location.reload();
}

// ═══════════════════════════════════════════════════════
// SAUVEGARDE GIST AUTOMATIQUE PROGRAMMÉE (nouveau v7.12.0, Lot 9)
// db.autoGistInterval (minutes, 0 = désactivée) pilote un minuteur qui
// relance syncCloud() en silence. _cloudToken n'étant jamais persisté (par
// sécurité — voir router.js), le minuteur ne fait rien tant que
// l'utilisateur n'a pas collé son token dans le champ "Token" au moins une
// fois pendant la session en cours ; dès qu'il l'a fait, le prochain
// déclenchement du minuteur envoie la sauvegarde normalement.
// ═══════════════════════════════════════════════════════
let _autoGistTimer = null;
function scheduleAutoGistBackup() {
  clearInterval(_autoGistTimer);
  _autoGistTimer = null;
  const minutes = db.autoGistInterval || 0;
  if (minutes <= 0) return;
  _autoGistTimer = setInterval(() => {
    if (_cloudToken && db.gistId) syncCloud();
  }, minutes * 60 * 1000);
}

// ═══════════════════════════════════════════════════════
// EXPORT / IMPORT JSON
// Correction v6.1.0 : si le projet est chiffré, l'export JSON l'est
// désormais aussi (même mot de passe) — auparavant, le fichier exporté
// contenait toujours le roman en clair, même projet chiffré activé.
// ═══════════════════════════════════════════════════════
async function megaExport(){
  flushCurrentChapter();
  const payload = JSON.stringify(db);
  if (_encPassword) {
    const cipher = await Crypto.encrypt(payload, _encPassword);
    saveAs(new Blob([JSON.stringify({ _enc:true, data:cipher })], {type:'application/json'}), 'projet_plume_chiffre.json');
    toast('Export JSON chiffré (même mot de passe que le projet)', 'success');
  } else {
    saveAs(new Blob([payload],{type:'application/json'}),'projet_plume.json');
  }
}
function importProject(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=async e=>{
    try{
      const p=JSON.parse(e.target.result);
      if (p._enc && p.data) {
        const pwd = prompt('Ce fichier est chiffré. Entrez le mot de passe utilisé lors de l\'export :');
        if (!pwd) return;
        const dec = await Crypto.decrypt(p.data, pwd);
        if (!dec) { toast('Mot de passe incorrect.','error'); return; }
        const parsed = JSON.parse(dec);
        if(!parsed.chapters||!Array.isArray(parsed.chapters))throw new Error('Chapitres invalides');
        db=migrateDb(parsed);_encPassword=pwd;save();location.reload();
        return;
      }
      if(!p.chapters||!Array.isArray(p.chapters))throw new Error('Chapitres invalides');
      db=migrateDb(p);save();location.reload();
    }catch(err){toast('Fichier invalide: '+err.message,'error');}
  };
  reader.onerror=()=>toast('Erreur lecture','error');reader.readAsText(file);
}

// ═══════════════════════════════════════════════════════
// IMPORT DOCX (nouveau v7.12.0, Lot 9)
// mammoth.js convertit le .docx en HTML dans le navigateur (rien n'est
// envoyé nulle part). Le résultat est toujours passé par DOMPurify avant
// tout stockage ou affichage (convention XSS du projet, comme partout
// ailleurs). L'utilisateur choisit ensuite la destination :
//   - Nouveau manuscrit (avec titre à saisir)
//   - Nouveau chapitre dans un manuscrit existant de la bibliothèque
//     (celui actuellement ouvert ou un autre — les deux sont supportés)
// ═══════════════════════════════════════════════════════
let _docxImportHtml = null, _docxImportTitleGuess = '';
function importDocxFile(input) {
  const file = input.files[0]; if (!file) return;
  if (typeof mammoth === 'undefined') { toast('Bibliothèque DOCX non chargée (vérifiez la connexion).', 'error'); input.value = ''; return; }
  _docxImportTitleGuess = file.name.replace(/\.docx$/i, '').trim() || 'Chapitre importé';
  file.arrayBuffer().then(buf => mammoth.convertToHtml({ arrayBuffer: buf })).then(result => {
    _docxImportHtml = DOMPurify.sanitize(result.value || '<p></p>');
    openDocxImportModal(file.name);
  }).catch(err => { toast('Fichier .docx invalide : ' + err.message, 'error'); }).finally(() => { input.value = ''; });
}
async function openDocxImportModal(filename) {
  document.getElementById('docx-import-filename').textContent = filename;
  document.getElementById('docx-new-title').value = _docxImportTitleGuess;
  const list = await loadDocList();
  const sel = document.getElementById('docx-existing-select');
  sel.innerHTML = list.documents.slice().sort((a,b)=>b.lastModified-a.lastModified)
    .map(d => `<option value="${d.id}">${DOMPurify.sanitize(d.title || 'Sans titre')}${d.id===_currentDocumentId?' (ouvert actuellement)':''}</option>`).join('');
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
    flushCurrentChapter(); await save(); // ne jamais quitter le manuscrit courant sans le sauvegarder d'abord
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
    db = dbData; _currentDocumentId = docId; cur = 0;
    initApp();
    toast('Nouveau manuscrit créé depuis le fichier Word.', 'success');
    return;
  }

  const targetDocId = document.getElementById('docx-existing-select').value;
  if (!targetDocId) { toast('Aucun manuscrit disponible.', 'error'); closeDocxImportModal(); return; }

  if (targetDocId === _currentDocumentId) {
    db.chapters.push(newChapter);
    cur = db.chapters.length - 1;
    renderChapterList(); loadChapter(cur); updateDailyStats(); save();
    closeDocxImportModal();
    toast('Chapitre ajouté au manuscrit actuel.', 'success');
    return;
  }

  // Manuscrit différent de celui ouvert : on le charge, on le modifie, on le
  // referme, sans quitter l'écran d'édition actuel.
  try {
    const stored = await loadData(docDataKey(_currentProfileId, targetDocId));
    if (!stored || !stored._enc) throw new Error('Manuscrit introuvable.');
    const dec = await Crypto.decrypt(stored.data, _dataKey);
    if (!dec) throw new Error('Déchiffrement impossible.');
    const otherDb = migrateDb(JSON.parse(dec));
    otherDb.chapters.push(newChapter);
    const cipher = await Crypto.encrypt(JSON.stringify(otherDb), _dataKey);
    await persistData(docDataKey(_currentProfileId, targetDocId), { _enc:true, data:cipher });
    const list = await loadDocList();
    const entry = list.documents.find(d => d.id === targetDocId);
    if (entry) {
      entry.chapterCount = otherDb.chapters.length;
      entry.wordCount = otherDb.chapters.reduce((s,c) => s + getWordCount(c.content), 0);
      entry.lastModified = Date.now();
      await saveDocList(list);
    }
    closeDocxImportModal();
    toast(`Chapitre ajouté à « ${entry ? entry.title : 'ce manuscrit'} ».`, 'success');
  } catch(e) {
    toast('Erreur : ' + e.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════
// EXPORT SÉLECTIF (nouveau v6.2.0)
// Les boutons DOCX/EPUB ouvrent désormais ce panneau de sélection des
// chapitres à inclure, au lieu d'exporter tout le roman systématiquement.
// ═══════════════════════════════════════════════════════
function openExportSelect() {
  flushCurrentChapter();
  const listEl = document.getElementById('export-select-list');
  listEl.innerHTML = db.chapters.map((ch,i) =>
    `<label style="display:flex;align-items:center;gap:8px;font-size:.82rem;padding:4px 0;cursor:pointer;">
      <input type="checkbox" class="export-select-cb" data-idx="${i}" checked>
      ${DOMPurify.sanitize(ch.title||('Chapitre '+(i+1)))}
    </label>`
  ).join('');
  document.getElementById('export-select-overlay').classList.add('active');
}
function closeExportSelect() { document.getElementById('export-select-overlay').classList.remove('active'); }
function getSelectedExportIndices() {
  return Array.from(document.querySelectorAll('.export-select-cb:checked')).map(cb => parseInt(cb.dataset.idx));
}
function toggleAllExportSelect() {
  const boxes = document.querySelectorAll('.export-select-cb');
  const allChecked = Array.from(boxes).every(cb => cb.checked);
  boxes.forEach(cb => cb.checked = !allChecked);
}
