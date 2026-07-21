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
    || `<div style="opacity:.5;font-size:.78rem;padding:10px;text-align:center;">${filter?'Aucun résultat.':'Aucun élément pour le moment.'}</div>`;
  c.querySelectorAll('.chapter-item').forEach(el=>{el.addEventListener('click',()=>showEdit(el.dataset.type,parseInt(el.dataset.idx)));el.addEventListener('keydown',e=>{if(e.key==='Enter')showEdit(el.dataset.type,parseInt(el.dataset.idx));});});
}
function showEdit(k,i){
  const item=db[k][i];const container=document.getElementById(k==='chars'?'char-edit':'place-edit');container.innerHTML='';
  const hdr=document.createElement('div');hdr.style.cssText='display:flex;justify-content:space-between;gap:6px;';
  const nameInput=document.createElement('input');nameInput.className='field';nameInput.style.fontWeight='700';nameInput.value=item.name;
  nameInput.addEventListener('input',()=>{db[k][i].name=nameInput.value;debouncedSave();renderLibrary(k);});
  const delBtn=document.createElement('button');delBtn.className='action-btn btn-sm';delBtn.style.background='#e74c3c';delBtn.textContent='✕';
  delBtn.addEventListener('click',()=>{db[k].splice(i,1);save();renderLibrary(k);container.innerHTML='...';});
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
  container.insertAdjacentHTML('beforeend',renderLinkPanel(k,i));updateLinkItems();
}

// ═══════════════════════════════════════════════════════
// LIENS ENTRE ENTITÉS
// ═══════════════════════════════════════════════════════
function addLink(type,fromIdx,toType,toIdx){if(!db[type][fromIdx].links)db[type][fromIdx].links=[];const exists=db[type][fromIdx].links.some(l=>l.type===toType&&l.idx===toIdx);if(!exists){db[type][fromIdx].links.push({type:toType,idx:toIdx});save();showEdit(type,fromIdx);}}
function removeLink(type,fromIdx,linkIdx){db[type][fromIdx].links=db[type][fromIdx].links.filter((_,i)=>i!==linkIdx);save();showEdit(type,fromIdx);}
function navigateToLink(targetType,targetIdx){const tabId=targetType==='chars'?'tab-chars':targetType==='places'?'tab-places':'tab-quests';openTabOrSubtab(tabId);if(targetType==='quests')showQuestEdit(targetIdx);else showEdit(targetType,targetIdx);}
function renderLinkPanel(type,idx){
  const item=db[type][idx];let html=`<div style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px;"><strong style="font-size:.8rem;">🔗 Liens</strong><div id="link-list" style="margin:6px 0;">`;
  (item.links||[]).forEach((l,i)=>{const target=db[l.type]?.[l.idx];if(target)html+=`<span class="link-badge" data-nav-type="${l.type}" data-nav-idx="${l.idx}">${DOMPurify.sanitize(target.name||target.text)}<button data-remove-type="${type}" data-remove-from="${idx}" data-remove-link="${i}" style="background:none;border:none;color:white;cursor:pointer;margin-left:3px;">×</button></span>`;});
  html+=`</div><div class="form-row" style="margin-top:6px;"><select id="link-type-sel" class="field"><option value="chars">Perso</option><option value="places">Lieu</option><option value="quests">Quête</option></select><select id="link-item-sel" class="field"></select><button class="action-btn btn-sm" data-link-from-type="${type}" data-link-from-idx="${idx}">+</button></div></div>`;
  return html;
}
document.addEventListener('click',e=>{
  const badge=e.target.closest('[data-nav-type]');if(badge&&e.target.dataset.removeType===undefined&&e.target.dataset.removeLink===undefined)navigateToLink(badge.dataset.navType,parseInt(badge.dataset.navIdx));
  if(e.target.dataset.removeType!==undefined){e.stopPropagation();removeLink(e.target.dataset.removeType,parseInt(e.target.dataset.removeFrom),parseInt(e.target.dataset.removeLink));}
  const addLinkBtn=e.target.closest('[data-link-from-type]');if(addLinkBtn)execAddLink(addLinkBtn.dataset.linkFromType,parseInt(addLinkBtn.dataset.linkFromIdx));
});
function updateLinkItems(){const sel=document.getElementById('link-type-sel');if(!sel)return;const itemSel=document.getElementById('link-item-sel');if(!itemSel)return;itemSel.innerHTML='';db[sel.value].forEach((it,i)=>{itemSel.innerHTML+=`<option value="${i}">${DOMPurify.sanitize(it.name||it.text)}</option>`;});}
document.addEventListener('change',e=>{if(e.target.id==='link-type-sel')updateLinkItems();});
function execAddLink(fromType,fromIdx){const toType=document.getElementById('link-type-sel')?.value;const toIdx=parseInt(document.getElementById('link-item-sel')?.value);if(toType&&!isNaN(toIdx))addLink(fromType,fromIdx,toType,toIdx);}

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
    || `<div style="opacity:.5;font-size:.78rem;padding:10px;text-align:center;">${filter?'Aucun résultat.':'Aucune quête pour le moment.'}</div>`;
  c.querySelectorAll('[data-quest-check]').forEach(cb=>cb.addEventListener('click',e=>{e.stopPropagation();db.quests[parseInt(cb.dataset.questCheck)].done=cb.checked;save();}));
  c.querySelectorAll('[data-quest-idx]').forEach(el=>el.addEventListener('click',()=>showQuestEdit(parseInt(el.dataset.questIdx))));
}
function showQuestEdit(i){const q=db.quests[i],c=document.getElementById('quest-edit');c.innerHTML='';const ti=document.createElement('input');ti.className='field';ti.value=q.text;ti.addEventListener('input',()=>{db.quests[i].text=ti.value;debouncedSave();renderQuests();});const rl=document.createElement('label');rl.textContent='Récompense';rl.style.fontSize='.72rem';const ri=document.createElement('input');ri.className='field';ri.value=q.reward||'';ri.addEventListener('input',()=>{db.quests[i].reward=ri.value;debouncedSave();});const sl=document.createElement('label');sl.textContent='Étapes';sl.style.fontSize='.72rem';const sta=document.createElement('textarea');sta.className='field';sta.value=q.steps||'';sta.rows=4;sta.addEventListener('input',()=>{db.quests[i].steps=sta.value;debouncedSave();});c.append(ti,rl,ri,sl,sta);c.insertAdjacentHTML('beforeend',renderLinkPanel('quests',i));updateLinkItems();}
function addQuest(){const i=document.getElementById('q-in');if(i.value.trim()){db.quests.push({text:i.value.trim(),done:false});i.value='';save();renderQuests();}}

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
function addItem(k){const n=prompt('Nom :');if(n){db[k].push({name:n,info:''});save();renderLibrary(k);}}

// ═══════════════════════════════════════════════════════
// MOTS FAIBLES
// ═══════════════════════════════════════════════════════
function renderWeakWords() {
  const c=document.getElementById('weak-words-list');
  c.innerHTML=db.weakWords.map((w,i)=>`<span class="link-badge">${DOMPurify.sanitize(w)} <button class="remove-weak" data-idx="${i}" style="background:none;border:none;color:white;cursor:pointer;font-weight:bold;padding:0 2px;">×</button></span>`).join('');
  c.querySelectorAll('.remove-weak').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();db.weakWords.splice(parseInt(btn.dataset.idx),1);save();renderWeakWords();}));
}
function addWeakWord(){const i=document.getElementById('new-weak-word');const w=i.value.trim().toLowerCase();if(w&&!db.weakWords.includes(w)){db.weakWords.push(w);i.value='';save();renderWeakWords();}}
