'use strict';
// ═══════════════════════════════════════════════════════
// EXPORT DOCX
// ═══════════════════════════════════════════════════════
async function exportDocx() {
  flushCurrentChapter();
  if (typeof docx === 'undefined') { toast('Lib DOCX non chargée','error'); return; }
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docx;
  const children = [new Paragraph({ text:'Mon Roman — Plume Épique Studio', heading:HeadingLevel.TITLE })];
  db.chapters.forEach((ch, i) => {
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
// CLOUD / BACKUP
// Correction V56 : le Gist créé est désormais explicitement PRIVÉ
// (l'ancienne version ne précisait pas "public", ce qui peut varier
// selon les comptes GitHub — on force donc public:false par sécurité,
// vu que le gist contient l'intégralité du roman).
// ═══════════════════════════════════════════════════════
async function syncCloud(){
  flushCurrentChapter();
  if(!_cloudToken){toast('Token requis','error');return;}
  try{const method=db.gistId?'PATCH':'POST',url=db.gistId?`https://api.github.com/gists/${db.gistId}`:'https://api.github.com/gists';
  const resp=await fetch(url,{method,headers:{'Authorization':`token ${_cloudToken}`,'Content-Type':'application/json'},body:JSON.stringify({public:false,files:{"plume.json":{content:JSON.stringify(db)}}})});
  if(!resp.ok)throw new Error(`HTTP ${resp.status}`);const data=await resp.json();
  if(data.id){db.gistId=data.id;document.getElementById('gist-id').value=data.id;save();document.getElementById('cloud-status').innerText='✅ Sauvegardé (gist privé)';}}
  catch(e){document.getElementById('cloud-status').innerText='❌ '+e.message;}
}
async function loadCloud(){
  const gistId=document.getElementById('gist-id').value.trim()||db.gistId;
  if(!gistId){toast('Gist ID requis','error');return;}
  try{const resp=await fetch(`https://api.github.com/gists/${gistId}`,{headers:_cloudToken?{'Authorization':`token ${_cloudToken}`}:{}});
  if(!resp.ok)throw new Error(`HTTP ${resp.status}`);const data=await resp.json();const raw=data.files?.["plume.json"]?.content;
  if(!raw)throw new Error('Fichier introuvable');const parsed=JSON.parse(raw);if(!parsed.chapters)throw new Error('Format invalide');
  db=migrateDb(parsed);save();location.reload();}catch(e){document.getElementById('cloud-status').innerText='❌ '+e.message;}
}
function megaExport(){flushCurrentChapter();saveAs(new Blob([JSON.stringify(db)],{type:'application/json'}),'projet_plume.json');}
function importProject(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{try{const p=JSON.parse(e.target.result);if(!p.chapters||!Array.isArray(p.chapters))throw new Error('Chapitres invalides');db=migrateDb(p);save();location.reload();}catch(err){toast('Fichier invalide: '+err.message,'error');}};
  reader.onerror=()=>toast('Erreur lecture','error');reader.readAsText(file);
}
