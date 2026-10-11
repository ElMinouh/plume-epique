'use strict';
// Installe sur le Worker IA le JETON DÉRIVÉ de la clé de synchronisation (audit AUD-06-009, Lot 2).
//
// Le relais IA ne doit plus détenir la clé de synchronisation elle-même : il compare avec
// AI_TOKEN = hex(SHA-256("plume-ai|" + clé), calculé aussi par le navigateur (js/ai.js, aiAuthToken). La dérivation
// est à sens unique : une fuite du secret du Worker IA ne permet pas de retrouver la clé de synchro.
//
// La clé se passe par la variable d'environnement PLUME_SYNC_KEY (jamais en argument, jamais affichée) ; le jeton
// part sur l'entrée standard de wrangler (jamais en argument non plus).
// Usage (PowerShell, depuis la racine du dépôt) :
//   $env:PLUME_SYNC_KEY = '<clé>'
//   node scripts/installer-jeton-ia.cjs            # affiche seulement l'empreinte courte du jeton (essai à blanc)
//   node scripts/installer-jeton-ia.cjs --installer # pose le secret AI_TOKEN sur le Worker IA
// Après installation ET une fois tous les appareils en v9.64.0 ou plus, retirer l'ancien secret du Worker IA :
//   npx wrangler secret delete SYNC_KEY -c worker/wrangler-ai.toml
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function jetonIA(cle) { return crypto.createHash('sha256').update('plume-ai|' + cle).digest('hex'); }
module.exports = { jetonIA };

if (require.main === module) {
  const cle = process.env.PLUME_SYNC_KEY;
  if (!cle) { console.error('Variable PLUME_SYNC_KEY absente.'); process.exit(2); }
  const jeton = jetonIA(cle);
  console.log('Jeton dérivé calculé (début : ' + jeton.slice(0, 6) + '…).');
  if (!process.argv.includes('--installer')) { console.log('Essai à blanc : rien n\'a été envoyé. Ajoutez --installer pour poser le secret AI_TOKEN.'); process.exit(0); }
  const r = spawnSync('npx', ['wrangler', 'secret', 'put', 'AI_TOKEN', '-c', 'worker/wrangler-ai.toml'], { input: jeton, encoding: 'utf8', shell: true });
  process.stdout.write((r.stdout || '') + (r.stderr || ''));
  process.exit(r.status === 0 ? 0 : 1);
}
