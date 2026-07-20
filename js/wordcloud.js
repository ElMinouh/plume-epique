'use strict';
const STOP_WORDS = new Set(['le','la','les','de','du','des','un','une','et','en','à','au','aux','que','qui','pour','par','sur','dans','est','il','elle','ils','elles','se','ne','pas','je','tu','nous','vous','on','ce','ou','mais','si','car','avec','son','sa','ses','leur','leurs','mon','ma','mes','ton','ta','tes','plus','tout','très','bien','aussi','comme','même','dont','the','and','to','of','in','is','it','that','was','he','she','they','are','for','on','with','as','at','be','by','from','or','an','this','have','had','not','but','lui','nos','vos','dont','donc','puis','après','avant','sous','lors','sans','chez','quand','comment','ni','or']);
function buildWordFreq(all) {
  const text = (all ? db.chapters.map(c=>c.content).join(' ') : db.chapters[cur].content||'').replace(/<[^>]*>/g,' ');
  const words = text.toLowerCase().match(/[a-zA-ZÀ-ÿ]{3,}/g)||[];
  const freq = {}; words.forEach(w => { if(!STOP_WORDS.has(w)) freq[w]=(freq[w]||0)+1; });
  return Object.entries(freq).sort((a,b)=>b[1]-a[1]);
}
function renderWordCloud() {
  flushCurrentChapter();
  const all = document.getElementById('wc-all-chapters').checked, freq = buildWordFreq(all);
  const canvas = document.getElementById('wordcloud-canvas'), ctx = canvas.getContext('2d');
  canvas.width = canvas.parentElement.clientWidth||700; canvas.height = 250;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  document.getElementById('wc-top-list').innerHTML = freq.slice(0,15).map(([w,c])=>
    `<span class="wc-chip"><span style="font-weight:700;color:var(--accent);">${DOMPurify.sanitize(w)}</span>&nbsp;<span style="opacity:.6;">${c}</span></span>`).join('');
  if (!freq.length) { ctx.fillStyle='rgba(150,150,150,.5)'; ctx.font='14px Georgia'; ctx.textAlign='center'; ctx.fillText('Aucun texte.',canvas.width/2,canvas.height/2); return; }
  const top40=freq.slice(0,40), max=top40[0][1];
  const colors=['#c0392b','#8e44ad','#27ae60','#d4ac0d','#2980b9','#e67e22'];
  const placed=[];
  top40.forEach(([word,count],idx)=>{
    const r=count/max, fs=Math.max(10,Math.round(11+r*42));
    ctx.font=`${r>.5?'bold ':''}${fs}px Georgia`;
    const tw=ctx.measureText(word).width; let angle=0, rad=0;
    const cx=canvas.width/2, cy=canvas.height/2;
    for(let t=0;t<300;t++){
      const x=cx+rad*Math.cos(angle)-tw/2, y=cy+rad*Math.sin(angle)+fs/3;
      const rect={x,y:y-fs,w:tw+4,h:fs+6};
      if(!placed.some(p=>!(rect.x>p.x+p.w||rect.x+rect.w<p.x||rect.y>p.y+p.h||rect.y+rect.h<p.y))&&x>5&&x+tw<canvas.width-5&&y-fs>5&&y<canvas.height-5){
        ctx.fillStyle=colors[idx%colors.length]; ctx.globalAlpha=.3+r*.7; ctx.fillText(word,x,y); ctx.globalAlpha=1; placed.push(rect); break;
      }
      angle+=.28; rad+=.45;
    }
  });
}
