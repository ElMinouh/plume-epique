// ═══════════════════════════════════════════════════════
// LOT 6 (v9.27.0) — DURCISSEMENT DU SITE (AUD-01-003 / 013 / 020 / 024 / 027)
//  • librairies servies par le site (vendor/), cohérence index.html ↔ sw.js ↔ package.json ;
//  • politique de sécurité (_headers) sans site tiers ;
//  • aucun style en ligne dans les gabarits JS (bloqué par la CSP) ;
//  • texte brut échappé, collage nettoyé.
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const html = read('index.html'), sw = read('sw.js'), headers = read('_headers'), pkg = JSON.parse(read('package.json'));

describe('Librairies locales (vendor/) — AUD-01-003', () => {
  const scriptSrcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
  const vendorFiles = fs.readdirSync(path.join(ROOT, 'vendor')).filter(f => f.endsWith('.js'));

  it('aucun script de index.html ne vient d\'un site externe', () => {
    expect(scriptSrcs.length).toBeGreaterThan(20);
    for (const s of scriptSrcs) expect(s, s).not.toMatch(/^https?:\/\//);
  });
  it('chaque fichier de vendor/ est précaché par le Service Worker, et chaque fichier référencé existe', () => {
    for (const f of vendorFiles) expect(sw, f).toContain('./vendor/' + f);
    for (const s of scriptSrcs.filter(s => s.startsWith('vendor/'))) expect(fs.existsSync(path.join(ROOT, s)), s).toBe(true);
  });
  it('plus aucune adresse de CDN dans index.html, sw.js, _headers ni odf-loader.js', () => {
    for (const [nom, txt] of [['index.html', html], ['sw.js', sw], ['_headers', headers], ['odf-loader.js', read('js/odf-loader.js')]]) {
      expect(txt, nom).not.toMatch(/cdn\.jsdelivr\.net|unpkg\.com|d3js\.org/);
    }
  });
  it('les versions de package.json (dependencies) correspondent aux fichiers de vendor/', () => {
    const noms = { 'chart.js': 'chart', 'file-saver': 'file-saver', jspdf: 'jspdf', dompurify: 'dompurify', idb: 'idb', d3: 'd3', docx: 'docx', jszip: 'jszip', html2canvas: 'html2canvas', mammoth: 'mammoth', 'odf-kit': 'odf-kit', fflate: 'fflate', marked: 'marked' };
    for (const [dep, version] of Object.entries(pkg.dependencies)) {
      if (dep === 'lucide-static') continue; // icônes : sprite intégré à index.html (scripts/build-icons.cjs), pas un fichier de vendor/
      expect(vendorFiles.some(f => f.startsWith(noms[dep] + '-' + version)), `${dep}@${version}`).toBe(true);
    }
  });
  it('la version de DOMPurify testée (npm) est celle des fichiers servis', () => {
    expect(createDOMPurify(new JSDOM('').window).version).toBe(html.match(/vendor\/dompurify-([\d.]+)\.min\.js/)[1]);
  });
  it('les modules ODT importent des fichiers locaux (aucun import externe ou absolu)', () => {
    for (const f of vendorFiles.filter(f => f.endsWith('.esm.js'))) {
      const code = read('vendor/' + f);
      expect(code, f).not.toMatch(/(from|import\()\s*["']\/npm\//);
      expect(code, f).not.toMatch(/(from|import\()\s*["']https?:/);
      expect(code, f).not.toMatch(/sourceMappingURL/);
      for (const m of code.matchAll(/(?:from|import\()\s*"(\.\/[^"]+)"/g)) expect(fs.existsSync(path.join(ROOT, 'vendor', m[1])), m[1]).toBe(true);
    }
  });
});

describe('En-têtes de sécurité (_headers) — AUD-01-003 / 024', () => {
  const csp = headers.match(/Content-Security-Policy:\s*(.+)/)[1];
  it('script-src n\'autorise que le site lui-même ; connect-src ne contient plus de CDN', () => {
    expect(csp).toMatch(/script-src 'self';/);
    expect(csp.match(/connect-src ([^;]+)/)[1]).not.toMatch(/jsdelivr|unpkg|d3js/);
  });
  it('form-action, frame-ancestors, object-src sont restreints', () => {
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });
  it('autres en-têtes : Permissions-Policy (micro conservé pour la dictée), COOP, HSTS, nosniff', () => {
    expect(headers).toMatch(/Permissions-Policy:.*camera=\(\).*microphone=\(self\)/);
    expect(headers).toContain('Cross-Origin-Opener-Policy: same-origin');
    expect(headers).toMatch(/Strict-Transport-Security: max-age=\d{7,}/);
    expect(headers).toContain('X-Content-Type-Options: nosniff');
  });
});

describe('Aucun style en ligne dans les gabarits JS — AUD-01-013', () => {
  it('pas de style="…" dans le HTML construit par les scripts (la CSP le bloque), hors contenu exporté', () => {
    const fautes = [];
    for (const f of fs.readdirSync(path.join(ROOT, 'js')).filter(n => n.endsWith('.js'))) {
      read('js/' + f).split('\n').forEach((ligne, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(ligne)) return;
        if (/style=\\?["']/.test(ligne) && !/dataUrl/.test(ligne)) fautes.push(`${f}:${i + 1}`);
      });
    }
    expect(fautes).toEqual([]);
  });
  it('les classes qui remplacent ces styles existent dans la feuille de style', () => {
    const css = read('css/style.css');
    for (let i = 0; i < 8; i++) expect(css).toContain(`.uni-card-c${i} {`);
    expect(css).toContain('.conflict-row-awaiting');
    expect(css).toContain('.conflict-badge-awaiting');
  });
  it('les variables de couleur utilisées par les classes de conflit existent (l\'ancien style en ligne en citait trois inexistantes)', () => {
    const css = read('css/style.css');
    const bloc = css.slice(css.indexOf('.conflict-row-awaiting'));
    const vars = [...bloc.matchAll(/var\((--[a-z0-9-]+)\)/g)].map(m => m[1]);
    expect(vars.length).toBeGreaterThan(0);
    for (const v of vars) expect(css, v).toMatch(new RegExp(v + '\\s*:'));
  });
  it('index de couleur d\'une carte Univers : stable et dans la palette', () => {
    const ctx = vm.createContext({});
    vm.runInContext(read('js/database.js').slice(read('js/database.js').indexOf('const CARD_SPINE_COLORS'), read('js/database.js').indexOf('let _universeViewMode')) + '\nthis.f = colorIndexForId;', ctx);
    for (const id of ['a', 'b', 'xyz-123', '', null]) { const i = ctx.f(id); expect(i).toBeGreaterThanOrEqual(0); expect(i).toBeLessThan(8); expect(ctx.f(id)).toBe(i); }
  });
});

describe('Texte brut échappé et collage nettoyé — AUD-01-020 / 027', () => {
  const window = new JSDOM('').window;
  const ctx = vm.createContext({ DOMPurify: createDOMPurify(window), console });
  vm.runInContext(read('js/schema.js').slice(read('js/schema.js').indexOf('function escapeHtml'), read('js/schema.js').indexOf('function genChapterId')) + '\nthis.escapeHtml = escapeHtml;', ctx);
  const ed = read('js/editor.js');
  vm.runInContext(ed.slice(ed.indexOf('function stripStyleAttributes'), ed.indexOf('function handleManuscriptPaste')) + '\nthis.sanitizeManuscriptHtml = sanitizeManuscriptHtml; this.stripStyleAttributes = stripStyleAttributes; this.cleanPastedHtml = cleanPastedHtml; this.plainTextToHtml = plainTextToHtml;', ctx);

  it('escapeHtml neutralise <, >, &, guillemets et apostrophes ; tolère null', () => {
    expect(ctx.escapeHtml('<img src=x onerror="a()"> & \'b\'')).toBe('&lt;img src=x onerror=&quot;a()&quot;&gt; &amp; &#39;b&#39;');
    expect(ctx.escapeHtml(null)).toBe('');
    expect(ctx.escapeHtml(42)).toBe('42');
  });
  it('un message d\'erreur contenant du HTML ne produit aucune balise', () => {
    const d = new JSDOM('<div id="x"></div>').window.document;
    d.getElementById('x').innerHTML = `<span>❌ ${ctx.escapeHtml('<img src=x onerror=alert(1)>')}</span>`;
    expect(d.querySelectorAll('img').length).toBe(0);
  });
  it('collage Word/web : seuls paragraphes, retours, gras/italique/souligné et titres survivent', () => {
    const word = '<p class="MsoNormal" style="font-family:Calibri;color:red">Un <b style="x:y">mot</b> et <i>un autre</i></p><table><tr><td>cellule</td></tr></table><font face="Arial">police</font><script>alert(1)</script><h3 style="margin:0">Titre</h3>';
    const out = ctx.cleanPastedHtml(word);
    expect(out).toContain('<p>Un <b>mot</b> et <i>un autre</i></p>');
    expect(out).toContain('<h3>Titre</h3>');
    expect(out).not.toMatch(/style=|class=|<table|<font|<script|<td/i);
    expect(out).toContain('cellule'); // le texte est conservé, pas la mise en forme
  });
  it('collage de texte brut : paragraphes et retours à la ligne, HTML échappé', () => {
    expect(ctx.plainTextToHtml('ligne 1\nligne 2\n\n<b>para 2</b>')).toBe('<p>ligne 1<br>ligne 2</p><p>&lt;b&gt;para 2&lt;/b&gt;</p>');
  });
  it('à l\'affichage, les attributs style sont retirés mais les surlignages (classes hl-*) et la mise en forme restent', () => {
    const out = ctx.sanitizeManuscriptHtml('<p style="color:red">a <span class="hl-jaune">surligné</span> <strong>gras</strong></p>');
    expect(out).toBe('<p>a <span class="hl-jaune">surligné</span> <strong>gras</strong></p>');
  });
});
