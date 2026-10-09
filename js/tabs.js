'use strict';
function renderTabs(){
  const nav=document.getElementById('tab-menu');nav.innerHTML='';
  db.tabOrder.forEach(id=>{
    if(!document.getElementById(id))return;
    const btn=document.createElement('button');
    btn.className='tab-btn';btn.textContent=tabLabels[id]||id;
    btn.dataset.tabId=id;
    // v9.42.0 (AUD-03-021) : ces boutons ouvrent/ferment un panneau (reclic = fermer) : motif « accordéon »
    // (aria-expanded + aria-controls), pas « onglets » (role=tab sans tablist ni aria-selected).
    btn.setAttribute('aria-expanded','false');btn.setAttribute('aria-controls',id);
    btn.setAttribute('draggable','true');
    btn.title=(tabDescriptions[id]?tabDescriptions[id]+' — ':'')+'Alt+← / Alt+→ pour réordonner au clavier';
    btn.addEventListener('click',()=>toggleTab(id,btn));
    btn.addEventListener('dragstart',e=>{
      btn.classList.add('dragging');
      e.dataTransfer.setData('text/plain',id);
      e.dataTransfer.effectAllowed='move';
    });
    btn.addEventListener('dragend',()=>{
      btn.classList.remove('dragging');
      nav.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('drag-over'));
    });
    btn.addEventListener('dragover',e=>{
      e.preventDefault();e.dataTransfer.dropEffect='move';
      nav.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('drag-over'));
      if(!btn.classList.contains('dragging'))btn.classList.add('drag-over');
    });
    btn.addEventListener('dragleave',()=>btn.classList.remove('drag-over'));
    btn.addEventListener('drop',e=>{
      e.preventDefault();btn.classList.remove('drag-over');
      const draggedId=e.dataTransfer.getData('text/plain');
      if(draggedId===id)return;
      const fromIdx=db.tabOrder.indexOf(draggedId),toIdx=db.tabOrder.indexOf(id);
      if(fromIdx===-1||toIdx===-1)return;
      db.tabOrder.splice(fromIdx,1);db.tabOrder.splice(toIdx,0,draggedId);
      debouncedSave();renderTabs();
    });
    // Correction v6.0.0 : réordonnancement au clavier (Alt+← / Alt+→),
    // en plus du drag & drop souris.
    btn.addEventListener('keydown', e => {
      if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      e.preventDefault();
      const fromIdx = db.tabOrder.indexOf(id);
      const toIdx = e.key === 'ArrowLeft' ? fromIdx - 1 : fromIdx + 1;
      if (toIdx < 0 || toIdx >= db.tabOrder.length) return;
      db.tabOrder.splice(fromIdx, 1);
      db.tabOrder.splice(toIdx, 0, id);
      debouncedSave(); renderTabs();
      requestAnimationFrame(() => {
        const newBtn = nav.querySelector(`[data-tab-id="${id}"]`);
        if (newBtn) newBtn.focus();
      });
    });
    nav.appendChild(btn);
  });
}
// Correspondance sous-onglet → catégorie parente (nouveau v7.4.0). Utilisée
// pour la navigation par lien (personnage/lieu/quête, recherche globale) qui
// visait auparavant directement ces anciens onglets de premier niveau.
const SUBTAB_PARENTS = {
  'tab-chars':'tab-univers','tab-places':'tab-univers','tab-quests':'tab-univers',
  'tab-timeline':'tab-univers','tab-graph':'tab-univers',
  'tab-ai':'tab-ia-memoire','tab-memory':'tab-ia-memoire',
  'tab-stats':'tab-analysegroup','tab-wordcloud':'tab-analysegroup','tab-analytics':'tab-analysegroup','tab-map':'tab-analysegroup',
  'tab-snaps':'tab-systeme','tab-history':'tab-systeme','tab-plugins':'tab-systeme',
  'tab-config-main':'tab-config','tab-sprint':'tab-config'
};
// Rendu paresseux d'un sous-onglet (identique à ce que faisait toggleTab()
// avant le regroupement en catégories).
function renderSubtabContent(id){
  if(id==='tab-chars')renderLibrary('chars');
  if(id==='tab-places')renderLibrary('places');
  if(id==='tab-quests')renderQuests();
  if(id==='tab-timeline'){populateTimelineChapterSel();renderTimeline();}
  if(id==='tab-graph')renderGraph();
  if(id==='tab-stats')renderStats();
  if(id==='tab-wordcloud')renderWordCloud();
  if(id==='tab-analytics')renderAnalytics();
  if(id==='tab-map')updateChart();
  if(id==='tab-history')renderHistoryTab();
  if(id==='tab-plugins')renderPlugins();
  if(id==='tab-memory'){ if(!_indexBuilt) document.getElementById('memory-index-status').textContent='Pas encore indexé.'; }
  if(id==='tab-config-main'){renderWeakWords();initGoalUI();}
}
function activeSubtabId(categoryEl){
  const activeBtn = categoryEl && categoryEl.querySelector('.subtab-btn.active');
  return activeBtn ? activeBtn.dataset.subtab : null;
}
function activateSubtab(categoryId, subtabId){
  const categoryEl = document.getElementById(categoryId);
  if (!categoryEl) return;
  categoryEl.querySelectorAll('.subtab-btn').forEach(b => b.classList.toggle('active', b.dataset.subtab === subtabId));
  categoryEl.querySelectorAll('.subtab-content').forEach(c => c.classList.toggle('active', c.id === subtabId));
  renderSubtabContent(subtabId);
}
// Câblage des barres de sous-onglets (une fois, les éléments sont statiques).
function initSubtabNavs(){
  document.querySelectorAll('.subtab-nav').forEach(nav=>{
    const categoryEl = nav.closest('.tab-content');
    nav.querySelectorAll('.subtab-btn').forEach(btn=>{
      btn.addEventListener('click',()=>activateSubtab(categoryEl.id, btn.dataset.subtab));
    });
  });
}
// Point d'entrée unique pour la navigation programmatique (liens personnage/
// lieu/quête, recherche globale) : accepte aussi bien un onglet de premier
// niveau qu'un ancien identifiant de sous-onglet, et ouvre ce qu'il faut.
function openTabOrSubtab(id){
  const parentId = SUBTAB_PARENTS[id];
  const topId = parentId || id;
  const topBtn = document.querySelector(`button[data-tab-id="${topId}"]`);
  if (!topBtn) return;
  toggleTab(topId, topBtn, true);
  if (parentId) activateSubtab(parentId, id);
}
// Correction : ajout du paramètre forceOpen (v7.1.0). Un clic manuel sur un
// onglet déjà actif doit toujours le refermer (comportement "interrupteur"
// voulu). En revanche, une navigation programmatique (ex. depuis la
// recherche globale ou un lien personnage/lieu/quête) doit TOUJOURS ouvrir
// l'onglet cible, même s'il était déjà actif — auparavant, cliquer sur un
// tel lien alors que l'onglet était déjà ouvert le refermait par erreur.
// v9.46.0 (AUD-03-003) : le panneau est un VOLET LATÉRAL (3e colonne de <main>) ; main.has-panel donne
// la grille à trois colonnes, body.panel-open sert aux styles globaux. Sur téléphone, il passe en plein écran.
let _panelTrigger = null;
function setPanelOpen(open){
  document.getElementById('tab-container').classList.toggle('open',open);
  const main=document.querySelector('main'); if(main)main.classList.toggle('has-panel',open);
  document.body.classList.toggle('panel-open',open);
}
function closeSidePanel(returnFocus){
  document.querySelectorAll('.tab-btn,.tab-content').forEach(e=>e.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b=>b.setAttribute('aria-expanded','false'));
  setPanelOpen(false);
  if(returnFocus&&_panelTrigger&&document.contains(_panelTrigger))_panelTrigger.focus();
}
function toggleTab(id,btn,forceOpen){
  const active=btn.classList.contains('active');
  document.querySelectorAll('.tab-btn,.tab-content').forEach(e=>e.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b=>b.setAttribute('aria-expanded','false'));
  if(!active||forceOpen){
    btn.classList.add('active');btn.setAttribute('aria-expanded','true');
    _panelTrigger=btn;
    const contentEl=document.getElementById(id);
    contentEl.classList.add('active');setPanelOpen(true);
    const title=document.getElementById('panel-title');
    if(title)title.textContent=btn.textContent.replace(/[▾▴]/g,'').trim();
    if(id==='tab-config'){renderWeakWords();initGoalUI();}
    // Catégories groupées (Univers, IA & Mémoire, Analyse, Système) : rendre
    // le sous-onglet actuellement actif (le premier par défaut).
    const sub=activeSubtabId(contentEl);
    if(sub)renderSubtabContent(sub);
  }else setPanelOpen(false);
}
// Largeur du volet : réglable à la souris, au toucher (poignée) ou aux flèches ; mémorisée par appareil.
const PANEL_W_KEY='plume_panel_w';
function panelWidthLimits(){return {min:320,max:Math.max(360,Math.round(window.innerWidth*0.6))};}
function setPanelWidth(px,save){
  const {min,max}=panelWidthLimits();const w=Math.max(min,Math.min(max,Math.round(px)));
  const main=document.querySelector('main');if(main)main.style.setProperty('--panel-w',w+'px');
  const r=document.getElementById('panel-resizer');if(r){r.setAttribute('aria-valuenow',String(w));r.setAttribute('aria-valuemax',String(max));}
  if(save){try{localStorage.setItem(PANEL_W_KEY,String(w));}catch(e){/* réglage valable pour cette session seulement */}}
  return w;
}
function initSidePanel(){
  // Sans réglage mémorisé : largeur par défaut du CSS (clamp(320px,32vw,420px)).
  try{const v=parseInt(localStorage.getItem(PANEL_W_KEY),10);if(v>0)setPanelWidth(v,false);}catch(e){/* défaut */}
  const cont=document.getElementById('tab-container'),rz=document.getElementById('panel-resizer');
  document.getElementById('panel-close-btn').addEventListener('click',()=>closeSidePanel(true));
  let drag=false;
  rz.addEventListener('pointerdown',e=>{drag=true;rz.classList.add('dragging');rz.setPointerCapture&&rz.setPointerCapture(e.pointerId);e.preventDefault();});
  rz.addEventListener('pointermove',e=>{if(drag)setPanelWidth(cont.getBoundingClientRect().right-e.clientX,false);});
  const stop=e=>{if(!drag)return;drag=false;rz.classList.remove('dragging');setPanelWidth(cont.getBoundingClientRect().width,true);};
  rz.addEventListener('pointerup',stop);rz.addEventListener('pointercancel',stop);
  rz.addEventListener('keydown',e=>{
    if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;
    e.preventDefault();
    setPanelWidth(cont.getBoundingClientRect().width+(e.key==='ArrowLeft'?24:-24),true);
  });
}
function initGoalUI(){
  const i=document.getElementById('daily-goal-input');if(i)i.value=db.dailyGoal||500;
  const w=document.getElementById('weekly-goal-input');if(w)w.value=db.weeklyGoal||3000;
  const m=document.getElementById('monthly-goal-input');if(m)m.value=db.monthlyGoal||12000;
  updateGoalsUI();
}
