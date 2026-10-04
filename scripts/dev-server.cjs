// Serveur statique de TEST (dev local uniquement) : sert le dépôt avec la CSP réelle (_headers) et redirige la
// synchro vers le Worker LOCAL (http://localhost:8787), jamais vers la production. Usage : node scripts/dev-server.cjs 8081
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2]);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
// CSP réelle du site (_headers) + autorisation du Worker local, pour reproduire les blocages.
const hdr = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8');
const CSP = (hdr.match(/Content-Security-Policy:\s*(.+)/) || [])[1].trim().replace("connect-src 'self'", "connect-src 'self' http://localhost:8787");
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
  let body = fs.readFileSync(f);
  if (p === '/js/router.js') body = Buffer.from(body.toString('utf8').replace('https://plume-epique-sync.air7841.workers.dev', 'http://localhost:8787'));
  if (p === '/sw.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' }); return res.end('self.addEventListener("fetch",()=>{});'); } // pas de cache hors-ligne en test
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP });
  res.end(body);
}).listen(PORT, () => console.log('test server on', PORT));
