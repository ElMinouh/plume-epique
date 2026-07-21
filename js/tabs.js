'use strict';
function renderTabs(){
  const nav=document.getElementById('tab-menu');nav.innerHTML='';
  db.tabOrder.forEach(id=>{
    if(!document.getElementById(id))return;
    const btn=document.createElement('button');
    btn.className='tab-btn';btn.textContent=tabLabels[id]||id;
    btn.dataset.tabId=id;btn.setAttribute('role','tab');
    btn.setAttribute('draggable','true');
    btn.title='Alt+← / Alt+→ pour réordonner au clavier';
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
// Correction : ajout du paramètre forceOpen (v7.1.0). Un clic manuel sur un
// onglet déjà actif doit toujours le refermer (comportement "interrupteur"
// voulu). En revanche, une navigation programmatique (ex. depuis la
// recherche globale ou un lien personnage/lieu/quête) doit TOUJOURS ouvrir
// l'onglet cible, même s'il était déjà actif — auparavant, cliquer sur un
// tel lien alors que l'onglet était déjà ouvert le refermait par erreur.
function toggleTab(id,btn,forceOpen){
  const cont=document.getElementById('tab-container'),active=btn.classList.contains('active');
  document.querySelectorAll('.tab-btn,.tab-content').forEach(e=>e.classList.remove('active'));
  if(!active||forceOpen){
    btn.classList.add('active');document.getElementById(id).classList.add('active');cont.classList.add('open');
    if(id==='tab-map')updateChart();
    if(id==='tab-chars')renderLibrary('chars');if(id==='tab-places')renderLibrary('places');
    if(id==='tab-quests')renderQuests();if(id==='tab-config'){renderWeakWords();initGoalUI();}
    if(id==='tab-wordcloud')renderWordCloud();if(id==='tab-timeline'){populateTimelineChapterSel();renderTimeline();}
    if(id==='tab-stats')renderStats();if(id==='tab-history')renderHistoryTab();
    if(id==='tab-graph')renderGraph();if(id==='tab-analytics')renderAnalytics();
    if(id==='tab-plugins')renderPlugins();if(id==='tab-memory'){
      if(!_indexBuilt) document.getElementById('memory-index-status').textContent='Pas encore indexé.';
    }
  }else cont.classList.remove('open');
}
function initGoalUI(){
  const i=document.getElementById('daily-goal-input');if(i)i.value=db.dailyGoal||500;
  const w=document.getElementById('weekly-goal-input');if(w)w.value=db.weeklyGoal||3000;
  const m=document.getElementById('monthly-goal-input');if(m)m.value=db.monthlyGoal||12000;
  updateGoalsUI();
}
