'use strict';
// Compare les bibliothèques de vendor/ aux fichiers des paquets npm officiels installés (node_modules, dont l'intégrité
// est garantie par package-lock.json et `npm ci`) — audit AUD-06-020, Lot 7. À lancer à la main une fois par trimestre
// ou avant toute mise à jour de librairie : `npm ci && node scripts/vendor-compare-npm.cjs`.
//
// Les fichiers « générés par jsDelivr » (chart.js, odf-kit, marked, fflate, polices) ne sont PAS des copies exactes d'un fichier
// de paquet (voir vendor/LISEZMOI.md) : ils sont listés comme « non comparables » ; leur contrôle est la procédure de
// reproduction décrite dans vendor/LISEZMOI.md et l'empreinte de SHA256SUMS.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

// fichier de vendor/ -> [paquet npm, chemin du fichier dans le paquet]
const CORRESPONDANCES = {
  'dompurify-3.4.16.min.js': ['dompurify', 'dist/purify.min.js'],
  'd3-7.9.0.min.js': ['d3', 'dist/d3.min.js'],
  'jszip-3.10.1.min.js': ['jszip', 'dist/jszip.min.js'],
  'jspdf-4.2.1.umd.min.js': ['jspdf', 'dist/jspdf.umd.min.js'],
  'html2canvas-1.4.1.min.js': ['html2canvas', 'dist/html2canvas.min.js'],
  'idb-8.0.3.umd.js': ['idb', 'build/umd.js'],
  'file-saver-2.0.5.min.js': ['file-saver', 'dist/FileSaver.min.js'],
  'mammoth-1.11.0.browser.min.js': ['mammoth', 'mammoth.browser.min.js'],
  'docx-9.8.1.js': ['docx', 'dist/index.iife.js']
};
// La seule modification admise (documentée dans vendor/LISEZMOI.md) : la ligne finale « //# sourceMappingURL=… » est retirée
// des copies de vendor/ (le fichier .map n'est pas servi). Elle est donc ignorée dans la comparaison.
const SOURCE_MAP = /\r?\n?\/\/# sourceMappingURL=[^\n]*\s*$/;
const normaliser = tampon => Buffer.from(tampon.toString('utf8').replace(SOURCE_MAP, '').replace(/\s+$/, ''), 'utf8');
const sha = f => crypto.createHash('sha256').update(normaliser(fs.readFileSync(f))).digest('hex');

function comparer() {
  const rapport = [];
  for (const [fichier, [paquet, chemin]] of Object.entries(CORRESPONDANCES)) {
    const vendor = path.join(ROOT, 'vendor', fichier);
    const officiel = path.join(ROOT, 'node_modules', paquet, chemin);
    if (!fs.existsSync(vendor)) { rapport.push({ fichier, etat: 'absent de vendor/' }); continue; }
    if (!fs.existsSync(officiel)) { rapport.push({ fichier, etat: 'paquet non installé (npm ci) ou chemin inconnu : ' + paquet + '/' + chemin }); continue; }
    rapport.push({ fichier, etat: sha(vendor) === sha(officiel) ? 'identique' : 'DIFFÉRENT' });
  }
  return rapport;
}
module.exports = { comparer, CORRESPONDANCES };
if (require.main === module) {
  const r = comparer();
  r.forEach(x => console.log((x.etat === 'identique' ? '  ok   ' : '  !!   ') + x.fichier + ' : ' + x.etat));
  console.log('Non comparables (générés par jsDelivr) : chart, odf-kit (×3), marked, fflate, polices.');
  process.exit(r.every(x => x.etat === 'identique') ? 0 : 1);
}
