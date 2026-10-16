'use strict';
function buildGraphData() {
  const nodes = [], links = [];
  const pal = typeof chartPalette === 'function' ? chartPalette() : ['#8a6414', '#1d3a5c', '#2e7d4f', '#b7791f']; // v9.83.0 (AUD-08-017) : couleurs du thème
  const colorMap = { chars:pal[0], places:pal[1], quests:pal[2], chapters:pal[3] };
  ['chars','places','quests'].forEach(type => {
    db[type].forEach((item) => {
      nodes.push({ id:`${type}-${item.id}`, label: item.name||item.text||'?', type, color: colorMap[type] });
      (item.links||[]).forEach(link => {
        links.push({ source:`${type}-${item.id}`, target:`${link.type}-${link.id}`, label: link.label || '' });
      });
    });
  });
  db.chapters.forEach((ch, i) => {
    nodes.push({ id:`chapters-${ch.id}`, label:`Ch.${i+1} ${ch.title}`.substring(0,20), type:'chapters', color:colorMap.chapters });
  });
  return { nodes, links };
}
// v9.62.0 (AUD-05-009) — équivalent textuel du graphe : une ligne par élément, avec ses relations. Le graphe dessiné
// n'était lisible qu'à la souris (nom au survol) ; cette liste l'est au clavier, au lecteur d'écran et à la loupe.
const GRAPH_TYPE_LABEL = { chars: 'Personnage', places: 'Lieu', quests: 'Quête', chapters: 'Chapitre' };
function renderGraphList(nodes, links) {
  const ul = document.getElementById('graph-list'); if (!ul) return;
  const byId = new Map(nodes.map(n => [n.id, n]));
  ul.textContent = '';
  nodes.forEach(n => {
    const rel = links.filter(l => l.source === n.id || l.target === n.id).map(l => {
      const other = byId.get(l.source === n.id ? l.target : l.source);
      return other ? other.label + (l.label ? ' (' + l.label + ')' : '') : null;
    }).filter(Boolean);
    const li = document.createElement('li');
    li.textContent = n.label + ' — ' + GRAPH_TYPE_LABEL[n.type] + (rel.length ? ' : en relation avec ' + rel.join(', ') : ' : aucune relation');
    ul.appendChild(li);
  });
}
async function renderGraph() {
  const container = document.getElementById('graph-container');
  // v9.76.0 (AUD-07-004) : d3 est chargé à la première ouverture du graphe, pas au démarrage de l'application.
  if (!(await ensureLib('d3'))) { toast('La bibliothèque du graphe n\'a pas pu se charger (connexion hors-ligne ?).', 'error'); return; }
  const svg = d3.select('#graph-svg');
  svg.selectAll('*').remove();
  const { nodes, links } = buildGraphData();
  renderGraphList(nodes, links);
  if (!nodes.length) { svg.append('text').attr('x','50%').attr('y','50%').attr('text-anchor','middle').attr('fill','rgba(150,150,150,.6)').text('Aucune donnée. Ajoutez des personnages, lieux ou quêtes.'); return; }
  const W = container.clientWidth || 700, H = container.clientHeight || 400;
  svg.attr('viewBox', `0 0 ${W} ${H}`);
  const sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d=>d.id).distance(80))
    .force('charge', d3.forceManyBody().strength(-150))
    .force('center', d3.forceCenter(W/2, H/2))
    .force('collision', d3.forceCollide(30));
  const link = svg.append('g').selectAll('line').data(links).join('line').attr('class','graph-link');
  // v9.48.0 (AUD-03-030) : la relation nommée s'affiche au milieu du lien.
  const linkLabel = svg.append('g').selectAll('text').data(links.filter(l => l.label)).join('text').attr('class','graph-link-label').attr('text-anchor','middle').text(d => d.label);
  const node = svg.append('g').selectAll('g').data(nodes).join('g').attr('class','graph-node')
    .attr('tabindex', 0).attr('role', 'img').attr('aria-label', d => d.label + ', ' + GRAPH_TYPE_LABEL[d.type])
    .call(d3.drag()
      .on('start', (event,d) => { if(!event.active) sim.alphaTarget(.3).restart(); d.fx=d.x; d.fy=d.y; })
      .on('drag', (event,d) => { d.fx=event.x; d.fy=event.y; })
      .on('end', (event,d) => { if(!event.active) sim.alphaTarget(0); d.fx=null; d.fy=null; }));
  node.append('circle').attr('r', d=>d.type==='chapters'?14:10).attr('fill',d=>d.color).attr('stroke','white').attr('stroke-width',2);
  node.append('text').attr('dy','3px').attr('text-anchor','middle').attr('fill','white').style('font-size','8px').text(d=>d.label.substring(0,10));
  const tooltip = document.getElementById('node-tooltip');
  node.on('mouseover', (event, d) => {
    tooltip.style.display='block'; tooltip.textContent = d.label;
    tooltip.style.left = (event.pageX+10)+'px'; tooltip.style.top = (event.pageY-10)+'px';
  }).on('mouseout', () => { tooltip.style.display='none'; });
  // v9.62.0 (AUD-05-009) : le même nom s'affiche au focus clavier (avant : survol de la souris seulement).
  node.on('focus', (event, d) => {
    const r = event.currentTarget.getBoundingClientRect();
    tooltip.style.display='block'; tooltip.textContent = d.label;
    tooltip.style.left = (r.right + window.scrollX + 6) + 'px'; tooltip.style.top = (r.top + window.scrollY) + 'px';
  }).on('blur', () => { tooltip.style.display='none'; });
  sim.on('tick', () => {
    link.attr('x1',d=>d.source.x).attr('y1',d=>d.source.y).attr('x2',d=>d.target.x).attr('y2',d=>d.target.y);
    linkLabel.attr('x',d=>(d.source.x+d.target.x)/2).attr('y',d=>(d.source.y+d.target.y)/2-4);
    node.attr('transform',d=>`translate(${Math.max(15,Math.min(W-15,d.x))},${Math.max(15,Math.min(H-15,d.y))})`);
  });
}
