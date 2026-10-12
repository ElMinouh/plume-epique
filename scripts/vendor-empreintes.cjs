'use strict';
// Empreintes SHA-256 des bibliothèques de tiers servies par le site (vendor/) — audit AUD-06-020, Lot 7.
//
// Pourquoi : ces fichiers sont des copies faites à la main. Rien ne prouvait qu'un fichier n'avait pas été modifié
// (copie corrompue, mise à jour douteuse, compromission du poste ou du dépôt). `vendor/SHA256SUMS` fige leur contenu ; un
// test le recalcule à chaque lancement de `npm test` (donc à chaque push, en CI) et échoue au moindre octet de différence.
//
// Usage :
//   node scripts/vendor-empreintes.cjs             # vérifie (code de sortie 1 si une empreinte diffère)
//   node scripts/vendor-empreintes.cjs --ecrire    # régénère vendor/SHA256SUMS (APRÈS une mise à jour VOLONTAIRE d'une librairie)
// Une mise à jour de librairie = fichier dans vendor/ + index.html + sw.js + package.json + `--ecrire` + commit de SHA256SUMS.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VENDOR = path.join(ROOT, 'vendor');
const FICHIER = path.join(VENDOR, 'SHA256SUMS');
const EXCLUS = new Set(['SHA256SUMS', 'LISEZMOI.md']);

function lister(dir, base = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...lister(path.join(dir, e.name), rel));
    else if (!EXCLUS.has(e.name)) out.push(rel);
  }
  return out;
}
// Les fins de ligne d'un fichier TEXTE dépendent de la machine (Git sous Windows convertit en CRLF à l'extraction) : on les
// normalise en LF avant de hacher, sinon l'empreinte différerait entre le poste et la CI. Les fichiers binaires (woff2) sont
// hachés tels quels.
const TEXTE = /\.(js|mjs|txt|md|json|css)$/i;
function sha256(fichier) {
  let contenu = fs.readFileSync(fichier);
  if (TEXTE.test(fichier)) contenu = Buffer.from(contenu.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  return crypto.createHash('sha256').update(contenu).digest('hex');
}
function calculer() { return lister(VENDOR).map(rel => ({ chemin: rel, empreinte: sha256(path.join(VENDOR, rel)) })); }
function lireSommes() {
  if (!fs.existsSync(FICHIER)) return [];
  return fs.readFileSync(FICHIER, 'utf8').split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#')).map(l => {
    const m = /^([0-9a-f]{64})  (.+)$/.exec(l);
    return m ? { empreinte: m[1], chemin: m[2] } : { invalide: l };
  });
}
// Compare l'état réel aux sommes enregistrées : { modifies, manquants, nouveaux, invalides }.
function comparer(reel = calculer(), attendu = lireSommes()) {
  const att = new Map(attendu.filter(x => !x.invalide).map(x => [x.chemin, x.empreinte]));
  const rel = new Map(reel.map(x => [x.chemin, x.empreinte]));
  return {
    modifies: [...rel].filter(([c, h]) => att.has(c) && att.get(c) !== h).map(([c]) => c),
    manquants: [...att.keys()].filter(c => !rel.has(c)),
    nouveaux: [...rel.keys()].filter(c => !att.has(c)),
    invalides: attendu.filter(x => x.invalide).map(x => x.invalide)
  };
}
function ecrire() {
  const lignes = ['# Empreintes SHA-256 de vendor/ (audit AUD-06-020). Régénérer volontairement : node scripts/vendor-empreintes.cjs --ecrire', ...calculer().map(x => x.empreinte + '  ' + x.chemin)];
  fs.writeFileSync(FICHIER, lignes.join('\n') + '\n', 'utf8');
  return lignes.length - 1;
}
module.exports = { calculer, lireSommes, comparer, ecrire, lister, sha256 };

if (require.main === module) {
  if (process.argv.includes('--ecrire')) { console.log(ecrire() + ' empreinte(s) écrite(s) dans vendor/SHA256SUMS.'); process.exit(0); }
  const c = comparer();
  const ok = !c.modifies.length && !c.manquants.length && !c.nouveaux.length && !c.invalides.length;
  if (ok) { console.log('vendor/ : toutes les empreintes correspondent.'); process.exit(0); }
  c.modifies.forEach(x => console.error('MODIFIÉ   : ' + x));
  c.manquants.forEach(x => console.error('MANQUANT  : ' + x));
  c.nouveaux.forEach(x => console.error('NON LISTÉ : ' + x + ' (voulu ? relancer avec --ecrire)'));
  c.invalides.forEach(x => console.error('LIGNE INVALIDE : ' + x));
  process.exit(1);
}
