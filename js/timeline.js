'use strict';
// ═══════════════════════════════════════════════════════
// CHRONOLOGIE
// v9.38.0 (audit AUD-02-012) : jusqu'ici les événements ne pouvaient être ni modifiés, ni déplacés, et la
// suppression (×) était immédiate. Désormais : ✎ modifier (le formulaire d'ajout se remplit), ◀ ▶ déplacer
// (clavier et tactile), « Trier selon les chapitres », et confirmation avant de supprimer.
// La date reste un texte libre (« An 1 », « 3 mars ») : aucun tri automatique par date n'est possible.
// ═══════════════════════════════════════════════════════
let _tlEditIndex = null; // index de l'événement en cours de modification (null : mode ajout)

function renderTimeline() {
  const el=document.getElementById('timeline-events'); el.innerHTML='';
  if(!db.timeline.length){ el.innerHTML='<p class="u-op-_45 u-pos-absolute u-top-50pc u-left-50pc u-transform-center-abs">Aucun événement.</p>'; return; }
  const w=Math.max(700,db.timeline.length*180);
  document.getElementById('timeline-track').style.width=w+'px';
  db.timeline.forEach((evt,i)=>{
    const lr=db.timeline.length>1?i/(db.timeline.length-1):.5, lp=60+lr*(w-120), isA=i%2===0;
    const dot=document.createElement('div'); dot.className='tl-dot'; dot.style.left=lp+'px'; el.appendChild(dot);
    const ev=document.createElement('div'); ev.className=`tl-event ${isA?'above':'below'}`; ev.style.left=lp+'px'; ev.style.transform='translateX(-50%)';
    const conn=document.createElement('div'); conn.className='tl-connector'; conn.style.height='38px';
    const card=document.createElement('div'); card.className='tl-card'+(i===_tlEditIndex?' tl-editing':'');
    // v9.38.0 : actions de la carte (déplacer, modifier, supprimer)
    const actions=document.createElement('div'); actions.className='tl-actions';
    const mkBtn=(label,title,handler,disabled)=>{
      const b=document.createElement('button'); b.className='tl-act-btn'; b.textContent=label; b.title=title; b.setAttribute('aria-label',title);
      if(disabled) b.disabled=true;
      b.addEventListener('click',e=>{ e.stopPropagation(); handler(); });
      actions.appendChild(b); return b;
    };
    mkBtn('◀','Déplacer cet événement avant le précédent',()=>moveTimelineEvent(i,-1),i===0);
    mkBtn('▶','Déplacer cet événement après le suivant',()=>moveTimelineEvent(i,1),i===db.timeline.length-1);
    mkBtn('✎','Modifier cet événement',()=>startEditTimelineEvent(i));
    mkBtn('×','Supprimer cet événement',()=>deleteTimelineEvent(i));
    card.appendChild(actions);
    // Correction (audit) : evt.chapterId (id stable) remplace evt.chapterIdx (position), qui pointait
    // silencieusement vers le mauvais chapitre après une suppression/réorganisation — voir migration schema.js v<13.
    const chT=evt.chapterId?(db.chapters.find(c=>c.id===evt.chapterId)?.title||''):'';
    if(chT){const s=document.createElement('strong');s.textContent=chT;card.appendChild(s);}
    if(evt.date){const d=document.createElement('div');d.className='tl-date';d.textContent=evt.date;card.appendChild(d);}
    const txt=document.createElement('div');txt.textContent=evt.text;card.appendChild(txt);
    if(isA){ev.appendChild(card);ev.appendChild(conn);}else{ev.appendChild(conn);ev.appendChild(card);}
    el.appendChild(ev);
  });
}
function populateTimelineChapterSel() {
  document.getElementById('tl-chapter-sel').innerHTML='<option value="">-- Chapitre --</option>'+db.chapters.map((c,i)=>`<option value="${c.id}">${i+1}. ${DOMPurify.sanitize(c.title)}</option>`).join('');
}
function addTimelineEvent() {
  const text=document.getElementById('tl-event-text').value.trim(), date=document.getElementById('tl-event-date').value.trim(), chSel=document.getElementById('tl-chapter-sel').value;
  if(!text) return;
  if(_tlEditIndex!==null && db.timeline[_tlEditIndex]) {
    // Mode modification : les champs du formulaire remplacent ceux de l'événement ; rien d'autre ne change.
    const evt=db.timeline[_tlEditIndex];
    evt.text=text; evt.date=date; evt.chapterId=chSel||undefined;
    cancelEditTimelineEvent(); save(); renderTimeline();
    return;
  }
  db.timeline.push({text,date,chapterId:chSel||undefined});
  document.getElementById('tl-event-text').value=''; document.getElementById('tl-event-date').value='';
  save(); renderTimeline();
}
function startEditTimelineEvent(i) {
  const evt=db.timeline[i]; if(!evt) return;
  _tlEditIndex=i;
  document.getElementById('tl-event-text').value=evt.text||'';
  document.getElementById('tl-event-date').value=evt.date||'';
  document.getElementById('tl-chapter-sel').value=evt.chapterId||'';
  document.getElementById('tl-add-btn').textContent='✔ Enregistrer';
  document.getElementById('tl-add-btn').title='Enregistrer la modification de cet événement';
  document.getElementById('tl-cancel-edit-btn').classList.remove('u-d-none');
  document.getElementById('tl-event-text').focus();
  renderTimeline();
}
function cancelEditTimelineEvent() {
  _tlEditIndex=null;
  document.getElementById('tl-event-text').value=''; document.getElementById('tl-event-date').value=''; document.getElementById('tl-chapter-sel').value='';
  const add=document.getElementById('tl-add-btn'); add.textContent='+ Ajouter'; add.title='Ajouter cet événement à la chronologie';
  document.getElementById('tl-cancel-edit-btn').classList.add('u-d-none');
  renderTimeline();
}
function moveTimelineEvent(i, dir) {
  const j=i+dir;
  if(j<0||j>=db.timeline.length) return;
  if(_tlEditIndex!==null) cancelEditTimelineEvent();
  [db.timeline[i],db.timeline[j]]=[db.timeline[j],db.timeline[i]];
  save(); renderTimeline();
}
async function deleteTimelineEvent(i) {
  const evt=db.timeline[i]; if(!evt) return;
  const ok=await showConfirmModal({ title:'Supprimer cet événement ?', message:`« ${evt.text||'Événement'} » sera retiré de la chronologie.`, confirmLabel:'Supprimer', danger:true });
  if(!ok) return;
  const at=db.timeline.indexOf(evt); if(at===-1) return;
  if(_tlEditIndex!==null) cancelEditTimelineEvent();
  db.timeline.splice(at,1);
  save(); renderTimeline();
}
// Ordre des chapitres, à égalité l'ordre actuel ; les événements sans chapitre (ou dont le chapitre n'existe
// plus) vont à la fin, dans leur ordre actuel. Fonction pure : renvoie un nouveau tableau.
function sortedTimelineByChapters(timeline, chapters) {
  const rank=new Map((chapters||[]).map((c,i)=>[c.id,i]));
  return (timeline||[]).map((e,i)=>({e,i,k:rank.has(e.chapterId)?rank.get(e.chapterId):Infinity}))
    .sort((a,b)=>(a.k===b.k?0:(a.k<b.k?-1:1))||a.i-b.i).map(x=>x.e);
}
function sortTimelineByChapters() {
  if(_tlEditIndex!==null) cancelEditTimelineEvent();
  db.timeline=sortedTimelineByChapters(db.timeline,db.chapters);
  save(); renderTimeline();
  toast('Événements classés selon l\'ordre des chapitres.','success');
}

// ═══════════════════════════════════════════════════════
// NETTOYAGE DES LIENS ORPHELINS (nouveau v7.36.1)
// evt.chapterId peut survivre à la suppression DÉFINITIVE de son chapitre
// (le rendu tolère déjà ce cas, voir renderTimeline ci-dessus, mais rien
// ne nettoyait activement le lien mort). Appelée uniquement depuis editor.js,
// au moment où un chapitre quitte la corbeille pour de bon (bouton
// "Définitif" ou purge auto à 30 jours) — jamais à la simple mise à la
// corbeille, tant qu'une restauration reste possible.
// ═══════════════════════════════════════════════════════
function gcOrphanTimelineLinks(purgedChapterIds) {
  if (!purgedChapterIds || !purgedChapterIds.length || !db.timeline) return;
  const ids = new Set(purgedChapterIds);
  let touched = false;
  db.timeline.forEach(evt => {
    if (evt.chapterId && ids.has(evt.chapterId)) { delete evt.chapterId; touched = true; }
  });
  if (touched) renderTimeline();
}
