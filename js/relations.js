'use strict';
function buildGraphData() {
  const nodes = [], links = [];
  const colorMap = { chars:'#c0392b', places:'#2980b9', quests:'#27ae60', chapters:'#f39c12' };
  ['chars','places','quests'].forEach(type => {
    db[type].forEach((item) => {
      nodes.push({ id:`${type}-${item.id}`, label: item.name||item.text||'?', type, color: colorMap[type] });
      (item.links||[]).forEach(link => {
        links.push({ source:`${type}-${item.id}`, target:`${link.type}-${link.id}` });
      });
    });
  });
  db.chapters.forEach((ch, i) => {
    nodes.push({ id:`chapters-${ch.id}`, label:`Ch.${i+1} ${ch.title}`.substring(0,20), type:'chapters', color:colorMap.chapters });
  });
  return { nodes, links };
}
function renderGraph() {
  const container = document.getElementById('graph-container');
  const svg = d3.select('#graph-svg');
  svg.selectAll('*').remove();
  const { nodes, links } = buildGraphData();
  if (!nodes.length) { svg.append('text').attr('x','50%').attr('y','50%').attr('text-anchor','middle').attr('fill','rgba(150,150,150,.6)').text('Aucune donnée. Ajoutez des personnages, lieux ou quêtes.'); return; }
  const W = container.clientWidth || 700, H = container.clientHeight || 400;
  svg.attr('viewBox', `0 0 ${W} ${H}`);
  const sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d=>d.id).distance(80))
    .force('charge', d3.forceManyBody().strength(-150))
    .force('center', d3.forceCenter(W/2, H/2))
    .force('collision', d3.forceCollide(30));
  const link = svg.append('g').selectAll('line').data(links).join('line').attr('class','graph-link');
  const node = svg.append('g').selectAll('g').data(nodes).join('g').attr('class','graph-node')
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
  sim.on('tick', () => {
    link.attr('x1',d=>d.source.x).attr('y1',d=>d.source.y).attr('x2',d=>d.target.x).attr('y2',d=>d.target.y);
    node.attr('transform',d=>`translate(${Math.max(15,Math.min(W-15,d.x))},${Math.max(15,Math.min(H-15,d.y))})`);
  });
}
