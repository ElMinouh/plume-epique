'use strict';
// ═══════════════════════════════════════════════════════
// BIBLIOTHÈQUE (personnages / lieux)
// ═══════════════════════════════════════════════════════
// Filtres de recherche (v7.5.0) — état volatile, non persisté, remis à zéro
// à chaque rechargement de page.
let _charFilter = '', _placeFilter = '', _questFilter = '';
function filterChars(v){ _charFilter = v; renderLibrary('chars'); }
function filterPlaces(v){ _placeFilter = v; renderLibrary('places'); }
function filterQuests(v){ _questFilter = v; renderQuests(); }

function renderLibrary(k){
  const id=k==='chars'?'char-list-db':'place-list-db';const c=document.getElementById(id);
  const filter=(k==='chars'?_charFilter:_placeFilter).trim().toLowerCase();
  c.innerHTML=db[k]
    .map((item,i)=>({item,i}))
    .filter(({item})=>!filter||(item.name||'').toLowerCase().includes(filter))
    .map(({item,i})=>`<div class="chapter-item" data-type="${k}" data-idx="${i}" role="listitem" tabindex="0">${DOMPurify.sanitize(item.name)}</div>`).join('')
    || `<div class="u-op-_5 u-fs-_78rem u-p-10px u-ta-center">${filter?'Aucun résultat.':'Aucun élément pour le moment.'}</div>`;
  c.querySelectorAll('.chapter-item').forEach(el=>{el.addEventListener('click',()=>showEdit(el.dataset.type,parseInt(el.dataset.idx)));el.addEventListener('keydown',e=>{if(e.key==='Enter')showEdit(el.dataset.type,parseInt(el.dataset.idx));});});
}
function showEdit(k,i){
  const item=db[k][i];const container=document.getElementById(k==='chars'?'char-edit':'place-edit');container.innerHTML='';
  const hdr=document.createElement('div');hdr.className='u-d-flex u-jc-space-between u-gap-6px';
  const nameInput=document.createElement('input');nameInput.className='field';nameInput.style.fontWeight='700';nameInput.value=item.name;
  nameInput.addEventListener('input',()=>{db[k][i].name=nameInput.value;debouncedSave();renderLibrary(k);});
  const delBtn=document.createElement('button');delBtn.className='action-btn btn-sm';delBtn.style.background='#e74c3c';delBtn.textContent='✕';
  delBtn.addEventListener('click',()=>{
    // Correction (audit) : suppression jusqu'ici sans confirmation (seul
    // point de suppression de l'app dans ce cas), et sans nettoyer les liens
    // d'AUTRES personnages/lieux/quêtes pointant vers celui-ci.
    if(!confirm(`Supprimer définitivement « ${item.name||'cet élément'} » ? Les liens d'autres personnages/lieux/quêtes vers lui seront aussi retirés.`)) return;
    removeAllLinksTo(k, item.id);
    db[k].splice(i,1);save();renderLibrary(k);container.innerHTML='';
  });
  hdr.appendChild(nameInput);hdr.appendChild(delBtn);container.appendChild(hdr);
  if(k==='chars'){
    const row=document.createElement('div');row.className='form-row';
    ['Rôle:role','Âge:age'].forEach(pair=>{const[label,field]=pair.split(':');const div=document.createElement('div');
      const lbl=document.createElement('label');lbl.textContent=label;lbl.style.fontSize='.72rem';
      const inp=document.createElement('input');inp.className='field';inp.value=item[field]||'';
      inp.addEventListener('input',()=>{db.chars[i][field]=inp.value;debouncedSave();});div.appendChild(lbl);div.appendChild(inp);row.appendChild(div);});
    container.appendChild(row);
    ['Apparence:phys','Notes:info'].forEach(pair=>{const[label,field]=pair.split(':');
      const lbl=document.createElement('label');lbl.textContent=label;lbl.style.fontSize='.72rem';
      const ta=document.createElement('textarea');ta.className='field';ta.value=item[field]||'';ta.rows=3;
      ta.addEventListener('input',()=>{db.chars[i][field]=ta.value;debouncedSave();});container.appendChild(lbl);container.appendChild(ta);});
  }else{
    const row=document.createElement('div');row.className='form-row';
    ['Type:type','Ambiance:mood'].forEach(pair=>{const[label,field]=pair.split(':');const div=document.createElement('div');
      const lbl=document.createElement('label');lbl.textContent=label;lbl.style.fontSize='.72rem';
      const inp=document.createElement('input');inp.className='field';inp.value=item[field]||'';
      inp.addEventListener('input',()=>{db.places[i][field]=inp.value;debouncedSave();});div.appendChild(lbl);div.appendChild(inp);row.appendChild(div);});
    container.appendChild(row);
    const lbl=document.createElement('label');lbl.textContent='Description';lbl.style.fontSize='.72rem';
    const ta=document.createElement('textarea');ta.className='field';ta.value=item.info||'';ta.rows=4;
    ta.addEventListener('input',()=>{db.places[i].info=ta.value;debouncedSave();});container.appendChild(lbl);container.appendChild(ta);
  }
  container.insertAdjacentHTML('beforeend',renderLinkPanel(k,item.id));updateLinkItems();
}

// ═══════════════════════════════════════════════════════
// LIENS ENTRE ENTITÉS
// v7.35.0 (audit) : les liens référencent désormais un ID STABLE (item.id)
// plutôt qu'une position dans le tableau (item.idx) — supprimer un
// personnage/lieu/quête ne décale plus les liens des autres éléments vers
// un mauvais index. Migration automatique des données existantes : voir
// schema.js (v<13).
// ═══════════════════════════════════════════════════════
function removeAllLinksTo(targetType, targetId) {
  ['chars','places','quests'].forEach(t => {
    (db[t]||[]).forEach(item => {
      if (Array.isArray(item.links)) item.links = item.links.filter(l => !(l.type===targetType && l.id===targetId));
    });
  });
}
function showEditById(type, id) {
  const idx = db[type].findIndex(x => x.id === id);
  if (idx === -1) return;
  if (type === 'quests') showQuestEdit(idx); else showEdit(type, idx);
}
function addLink(type,fromId,toType,toId){
  const item=db[type].find(x=>x.id===fromId); if(!item) return;
  if(!item.links)item.links=[];
  const exists=item.links.some(l=>l.type===toType&&l.id===toId);
  if(!exists){item.links.push({type:toType,id:toId});save();showEditById(type,fromId);}
}
function removeLink(type,fromId,linkIdx){
  const item=db[type].find(x=>x.id===fromId); if(!item) return;
  item.links=(item.links||[]).filter((_,i)=>i!==linkIdx);
  save();showEditById(type,fromId);
}
function navigateToLink(targetType,targetId){
  const tabId=targetType==='chars'?'tab-chars':targetType==='places'?'tab-places':'tab-quests';
  openTabOrSubtab(tabId);
  const idx=db[targetType].findIndex(x=>x.id===targetId);
  if(idx===-1){toast('Cet élément a été supprimé depuis.','error');return;}
  if(targetType==='quests')showQuestEdit(idx);else showEdit(targetType,idx);
}
function renderLinkPanel(type,id){
  const item=db[type].find(x=>x.id===id);
  let html=`<div class="u-mt-12px u-bdt-1px-solid-v-border u-pt-10px"><strong class="u-fs-_8rem">🔗 Liens</strong><div id="link-list" class="u-m-6px-0">`;
  (item.links||[]).forEach((l,i)=>{const target=(db[l.type]||[]).find(x=>x.id===l.id);if(target)html+=`<span class="link-badge" data-nav-type="${l.type}" data-nav-id="${l.id}">${DOMPurify.sanitize(target.name||target.text)}<button data-remove-type="${type}" data-remove-from="${id}" data-remove-link="${i}" class="u-bg-none u-bd-none u-c-hfff u-cur-pointer u-ml-3px">×</button></span>`;});
  html+=`</div><div class="form-row u-mt-6px"><select id="link-type-sel" class="field"><option value="chars">Perso</option><option value="places">Lieu</option><option value="quests">Quête</option></select><select id="link-item-sel" class="field"></select><button class="action-btn btn-sm" data-link-from-type="${type}" data-link-from-id="${id}">+</button></div></div>`;
  return html;
}
document.addEventListener('click',e=>{
  const badge=e.target.closest('[data-nav-type]');if(badge&&e.target.dataset.removeType===undefined&&e.target.dataset.removeLink===undefined)navigateToLink(badge.dataset.navType,badge.dataset.navId);
  if(e.target.dataset.removeType!==undefined){e.stopPropagation();removeLink(e.target.dataset.removeType,e.target.dataset.removeFrom,parseInt(e.target.dataset.removeLink));}
  const addLinkBtn=e.target.closest('[data-link-from-type]');if(addLinkBtn)execAddLink(addLinkBtn.dataset.linkFromType,addLinkBtn.dataset.linkFromId);
});
function updateLinkItems(){const sel=document.getElementById('link-type-sel');if(!sel)return;const itemSel=document.getElementById('link-item-sel');if(!itemSel)return;itemSel.innerHTML='';db[sel.value].forEach((it)=>{itemSel.innerHTML+=`<option value="${it.id}">${DOMPurify.sanitize(it.name||it.text)}</option>`;});}
document.addEventListener('change',e=>{if(e.target.id==='link-type-sel')updateLinkItems();});
function execAddLink(fromType,fromId){const toType=document.getElementById('link-type-sel')?.value;const toId=document.getElementById('link-item-sel')?.value;if(toType&&toId)addLink(fromType,fromId,toType,toId);}

// ═══════════════════════════════════════════════════════
// QUÊTES
// ═══════════════════════════════════════════════════════
function renderQuests(){
  const c=document.getElementById('quest-list');
  const filter=_questFilter.trim().toLowerCase();
  c.innerHTML=db.quests
    .map((q,i)=>({q,i}))
    .filter(({q})=>!filter||(q.text||'').toLowerCase().includes(filter))
    .map(({q,i})=>`<div class="chapter-item" data-quest-idx="${i}" role="listitem" tabindex="0"><input type="checkbox" ${q.done?'checked':''} data-quest-check="${i}"> ${DOMPurify.sanitize(q.text)}</div>`).join('')
    || `<div class="u-op-_5 u-fs-_78rem u-p-10px u-ta-center">${filter?'Aucun résultat.':'Aucune quête pour le moment.'}</div>`;
  c.querySelectorAll('[data-quest-check]').forEach(cb=>cb.addEventListener('click',e=>{e.stopPropagation();db.quests[parseInt(cb.dataset.questCheck)].done=cb.checked;save();}));
  c.querySelectorAll('[data-quest-idx]').forEach(el=>el.addEventListener('click',()=>showQuestEdit(parseInt(el.dataset.questIdx))));
}
function showQuestEdit(i){const q=db.quests[i],c=document.getElementById('quest-edit');c.innerHTML='';const ti=document.createElement('input');ti.className='field';ti.value=q.text;ti.addEventListener('input',()=>{db.quests[i].text=ti.value;debouncedSave();renderQuests();});const rl=document.createElement('label');rl.textContent='Récompense';rl.style.fontSize='.72rem';const ri=document.createElement('input');ri.className='field';ri.value=q.reward||'';ri.addEventListener('input',()=>{db.quests[i].reward=ri.value;debouncedSave();});const sl=document.createElement('label');sl.textContent='Étapes';sl.style.fontSize='.72rem';const sta=document.createElement('textarea');sta.className='field';sta.value=q.steps||'';sta.rows=4;sta.addEventListener('input',()=>{db.quests[i].steps=sta.value;debouncedSave();});c.append(ti,rl,ri,sl,sta);c.insertAdjacentHTML('beforeend',renderLinkPanel('quests',q.id));updateLinkItems();}
function addQuest(){const i=document.getElementById('q-in');if(i.value.trim()){db.quests.push({id:genChapterId(),text:i.value.trim(),done:false});i.value='';save();renderQuests();}}

// ═══════════════════════════════════════════════════════
// APPARENCE — palette de couleurs, thème, police d'écriture (nouveau v7.7.0)
// Stocké par manuscrit (comme darkMode), appliqué via des variables CSS/classes
// posées sur <html>/<body> — le fichier style.css garde ses valeurs par défaut
// intactes, elles ne servent que tant qu'aucun manuscrit n'est encore ouvert.
// ═══════════════════════════════════════════════════════
const ACCENT_PALETTES = {
  'rouge-violet': { label:'Rouge & Violet', a:'#c0392b', b:'#8e44ad' },
  'bleu-ocean':   { label:'Bleu Océan',     a:'#2980b9', b:'#16a085' },
  'emeraude':     { label:'Émeraude',       a:'#27ae60', b:'#2c3e50' },
  'rose-poudre':  { label:'Rose Poudré',    a:'#c2185b', b:'#d4af37' },
  'ardoise':      { label:'Ardoise',        a:'#34495e', b:'#7f8c8d' }
};
const EDITOR_FONTS = {
  'palatino': { css:"'Palatino Linotype',Georgia,serif" },
  'times':    { css:"'Times New Roman',Times,serif" },
  'verdana':  { css:'Verdana,Arial,sans-serif' },
  'courier':  { css:"'Courier New',Courier,monospace" }
};
function applyAccentPalette(key) {
  const p = ACCENT_PALETTES[key] || ACCENT_PALETTES['rouge-violet'];
  document.documentElement.style.setProperty('--accent', p.a);
  document.documentElement.style.setProperty('--accent2', p.b);
}
function applyEditorFont(key) {
  document.body.classList.remove('font-times','font-verdana','font-courier');
  if (key && key !== 'palatino' && EDITOR_FONTS[key]) document.body.classList.add('font-'+key);
}
function selectPalette(key) {
  if (!ACCENT_PALETTES[key]) return;
  db.accentPalette = key;
  applyAccentPalette(key);
  renderAppearanceUI();
  save();
}
function selectFont(key) {
  if (!EDITOR_FONTS[key]) return;
  db.editorFont = key;
  applyEditorFont(key);
  renderAppearanceUI();
  debouncedSave();
}
function selectTheme(mode) {
  db.darkMode = (mode === 'dark');
  db.paperMode = (mode === 'paper');
  document.body.classList.toggle('dark-mode', db.darkMode);
  document.body.classList.toggle('paper-mode', db.paperMode);
  renderAppearanceUI();
  save();
}
// Reflète db.accentPalette/darkMode+paperMode/editorFont sur les 3 sélecteurs
// de l'onglet Config — appelée à l'ouverture du manuscrit et après tout choix.
function renderAppearanceUI() {
  document.querySelectorAll('#palette-picker .palette-swatch').forEach(b => b.classList.toggle('active', b.dataset.palette === (db.accentPalette||'rouge-violet')));
  const currentTheme = db.paperMode ? 'paper' : (db.darkMode ? 'dark' : 'light');
  document.querySelectorAll('#theme-picker .mode-indicator').forEach(b => b.classList.toggle('active', b.dataset.theme === currentTheme));
  document.querySelectorAll('#font-picker .font-option').forEach(el => el.classList.toggle('active', el.dataset.font === (db.editorFont||'palatino')));
}

// ═══════════════════════════════════════════════════════
// DIVERS
// ═══════════════════════════════════════════════════════
function updateChart(){if(!tensionChart)return;tensionChart.data.labels=db.chapters.map((_,i)=>i+1);tensionChart.data.datasets[0].data=db.chapters.map(c=>c.tension);tensionChart.update();}
function toggleMode(){
  db.darkMode=!db.darkMode;
  // Le thème papier est exclusif du mode sombre (voir selectTheme ci-dessus).
  if (db.darkMode && db.paperMode) { db.paperMode=false; document.body.classList.remove('paper-mode'); renderAppearanceUI(); }
  document.body.classList.toggle('dark-mode',db.darkMode);
  save();
}
function addItem(k){const n=prompt('Nom :');if(n){db[k].push({id:genChapterId(),name:n,info:''});save();renderLibrary(k);}}

// ═══════════════════════════════════════════════════════
// MOTS FAIBLES
// ═══════════════════════════════════════════════════════
function renderWeakWords() {
  const c=document.getElementById('weak-words-list');
  c.innerHTML=db.weakWords.map((w,i)=>`<span class="link-badge">${DOMPurify.sanitize(w)} <button class="remove-weak u-bg-none u-bd-none u-c-hfff u-cur-pointer u-fwt-700 u-p-0-2px" data-idx="${i}">×</button></span>`).join('');
  c.querySelectorAll('.remove-weak').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();db.weakWords.splice(parseInt(btn.dataset.idx),1);save();renderWeakWords();}));
}
function addWeakWord(){const i=document.getElementById('new-weak-word');const w=i.value.trim().toLowerCase();if(w&&!db.weakWords.includes(w)){db.weakWords.push(w);i.value='';save();renderWeakWords();}}
