'use strict';
function renderTimeline() {
  const el=document.getElementById('timeline-events'); el.innerHTML='';
  if(!db.timeline.length){ el.innerHTML='<p class="tl-empty-msg">Aucun événement.</p>'; return; }
  const w=Math.max(700,db.timeline.length*180);
  document.getElementById('timeline-track').style.width=w+'px';
  db.timeline.forEach((evt,i)=>{
    const lr=db.timeline.length>1?i/(db.timeline.length-1):.5, lp=60+lr*(w-120), isA=i%2===0;
    const dot=document.createElement('div'); dot.className='tl-dot'; dot.style.left=lp+'px'; el.appendChild(dot);
    const ev=document.createElement('div'); ev.className=`tl-event ${isA?'above':'below'}`; ev.style.left=lp+'px'; ev.style.transform='translateX(-50%)';
    const conn=document.createElement('div'); conn.className='tl-connector'; conn.style.height='38px';
    const card=document.createElement('div'); card.className='tl-card';
    const chT=evt.chapterIdx!==undefined?db.chapters[evt.chapterIdx]?.title||'':'';
    if(chT){const s=document.createElement('strong');s.textContent=chT;card.appendChild(s);}
    if(evt.date){const d=document.createElement('div');d.className='tl-date';d.textContent=evt.date;card.appendChild(d);}
    const txt=document.createElement('div');txt.textContent=evt.text;card.appendChild(txt);
    const del=document.createElement('button');del.textContent='×';del.className='tl-del-btn';
    del.addEventListener('click',e=>{e.stopPropagation();db.timeline.splice(i,1);save();renderTimeline();});
    card.appendChild(del);
    if(isA){ev.appendChild(card);ev.appendChild(conn);}else{ev.appendChild(conn);ev.appendChild(card);}
    el.appendChild(ev);
  });
}
function populateTimelineChapterSel() {
  document.getElementById('tl-chapter-sel').innerHTML='<option value="">-- Chapitre --</option>'+db.chapters.map((c,i)=>`<option value="${i}">${i+1}. ${DOMPurify.sanitize(c.title)}</option>`).join('');
}
function addTimelineEvent() {
  const text=document.getElementById('tl-event-text').value.trim(), date=document.getElementById('tl-event-date').value.trim(), chSel=document.getElementById('tl-chapter-sel').value;
  if(!text) return;
  db.timeline.push({text,date,chapterIdx:chSel!==''?parseInt(chSel):undefined});
  document.getElementById('tl-event-text').value=''; document.getElementById('tl-event-date').value='';
  save(); renderTimeline();
}
