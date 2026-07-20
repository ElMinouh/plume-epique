'use strict';
function renderTabs(){
  const nav=document.getElementById('tab-menu');nav.innerHTML='';
  db.tabOrder.forEach(id=>{
    if(!document.getElementById(id))return;
    const btn=document.createElement('button');
    btn.className='tab-btn';btn.textContent=tabLabels[id]||id;
    btn.dataset.tabId=id;btn.setAttribute('role','tab');
    btn.setAttribute('draggable','true');
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
    nav.appendChild(btn);
  });
}
function toggleTab(id,btn){
  const cont=document.getElementById('tab-container'),active=btn.classList.contains('active');
  document.querySelectorAll('.tab-btn,.tab-content').forEach(e=>e.classList.remove('active'));
  if(!active){
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
function initGoalUI(){const i=document.getElementById('daily-goal-input');if(i)i.value=db.dailyGoal||500;}
