'use strict';
// Génère une clé de synchronisation ALÉATOIRE de 130 bits (26 caractères en base 32, sans caractères ambigus).
// Audit AUD-06-009 : une phrase choisie à la main peut être devinée par essais répétés ; une clé aléatoire non.
// La clé n'est ni enregistrée ni envoyée nulle part : elle s'affiche une fois dans ce terminal. Rangez-la
// aussitôt dans un gestionnaire de mots de passe (jamais dans un dossier OneDrive, voir docs/EXPLOITATION.md §6).
// Usage : node scripts/generer-cle.cjs
const crypto = require('crypto');
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symboles : 5 bits chacun, 256 % 32 === 0 donc sans biais
function genererCle(longueur = 26) {
  const octets = crypto.randomBytes(longueur);
  let cle = '';
  for (let i = 0; i < longueur; i++) cle += ALPHABET[octets[i] % ALPHABET.length];
  return cle;
}
module.exports = { genererCle };
if (require.main === module) {
  console.log(genererCle());
  console.error('\nClé de 130 bits générée (non enregistrée). Rangez-la dans votre gestionnaire de mots de passe.');
}
