#!/usr/bin/env node
'use strict';
// ═══════════════════════════════════════════════════════
// SAUVEGARDE CHIFFRÉE DE LA BASE DE SYNCHRONISATION (v9.70.0, audit AUD-07-017)
// Time Travel ne remonte que 7 jours. Ce script exporte la base D1 « plume-sync » et la range CHIFFRÉE (AES-256-GCM,
// clé dérivée par scrypt d'une phrase secrète) dans un dossier HORS dépôt et HORS OneDrive. Le dépôt GitHub étant
// public, aucune sauvegarde ne doit y être publiée (artefacts compris).
//
//   node scripts/sauvegarder-d1.cjs                      sauvegarde (garde les 8 dernières)
//   node scripts/sauvegarder-d1.cjs --dechiffrer F.enc --vers F.sql    déchiffre une sauvegarde
//
// Phrase secrète : variable PLUME_BACKUP_PASSPHRASE, sinon fichier PASSPHRASE-SAUVEGARDE.txt dans le dossier secret
// (créé au premier lancement avec une valeur aléatoire — GARDEZ-EN UNE COPIE dans votre gestionnaire de mots de passe :
// sans elle, les sauvegardes sont illisibles). Dossier : C:\Secrets\Plume\ (Windows) ou ~/.plume-secrets/ ailleurs ;
// option --dossier=... pour en changer. Objectifs : RPO ≤ 7 jours (lancement hebdomadaire), RTO ≤ 4 h.
// ═══════════════════════════════════════════════════════
const { execSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAGIE = Buffer.from('PLB1');
const GARDER = 8;

function chiffrerSauvegarde(clair, phrase) {
  const sel = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const cle = crypto.scryptSync(phrase, sel, 32);
  const c = crypto.createCipheriv('aes-256-gcm', cle, iv);
  const corps = Buffer.concat([c.update(clair), c.final()]);
  return Buffer.concat([MAGIE, sel, iv, c.getAuthTag(), corps]);
}
function dechiffrerSauvegarde(enc, phrase) {
  if (enc.length < 48 || !enc.subarray(0, 4).equals(MAGIE)) throw new Error('Fichier de sauvegarde Plume non reconnu.');
  const sel = enc.subarray(4, 20), iv = enc.subarray(20, 32), tag = enc.subarray(32, 48);
  const d = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(phrase, sel, 32), iv);
  d.setAuthTag(tag);
  try { return Buffer.concat([d.update(enc.subarray(48)), d.final()]); }
  catch (e) { throw new Error('Phrase secrète incorrecte ou fichier altéré.'); }
}
// Garde les `n` plus récentes (noms triables : plume-sync-AAAA-MM-JJ.sql.enc) ; renvoie les noms supprimés.
function elaguer(dossier, n = GARDER) {
  const f = fs.readdirSync(dossier).filter(x => /^plume-sync-\d{4}-\d{2}-\d{2}.*\.sql\.enc$/.test(x)).sort();
  const sup = f.slice(0, Math.max(0, f.length - n));
  sup.forEach(x => fs.unlinkSync(path.join(dossier, x)));
  return sup;
}
function dossierSecret(arg) {
  if (arg) return arg;
  return process.platform === 'win32' ? 'C:\\Secrets\\Plume' : path.join(os.homedir(), '.plume-secrets');
}
function lirePhrase(dossier) {
  if (process.env.PLUME_BACKUP_PASSPHRASE) return process.env.PLUME_BACKUP_PASSPHRASE;
  const f = path.join(dossier, 'PASSPHRASE-SAUVEGARDE.txt');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const p = crypto.randomBytes(32).toString('base64url');
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(f, p + '\n', { mode: 0o600 });
  console.log('Nouvelle phrase secrète créée dans ' + f + '\n>>> GARDEZ-EN UNE COPIE dans votre gestionnaire de mots de passe : sans elle, les sauvegardes sont illisibles.');
  return p;
}
const argVal = nom => { const a = process.argv.find(x => x.startsWith('--' + nom + '=')); return a ? a.slice(nom.length + 3) : null; };
const argSuiv = nom => { const i = process.argv.indexOf('--' + nom); return i >= 0 ? process.argv[i + 1] : null; };

function main() {
  const dossier = dossierSecret(argVal('dossier'));
  const dechif = argSuiv('dechiffrer');
  if (dechif) {
    const vers = argSuiv('vers');
    if (!vers) throw new Error('Indiquez --vers fichier.sql');
    fs.writeFileSync(vers, dechiffrerSauvegarde(fs.readFileSync(dechif), lirePhrase(dossier)));
    console.log('Déchiffré dans ' + vers + ' (à supprimer après usage).');
    return;
  }
  const cible = path.join(dossier, 'backups-d1');
  fs.mkdirSync(cible, { recursive: true });
  const phrase = lirePhrase(dossier);
  const tmp = path.join(os.tmpdir(), 'plume-d1-' + crypto.randomBytes(6).toString('hex') + '.sql');
  try {
    execSync('npx --yes wrangler@4.149.0 d1 export plume-sync --remote --output "' + tmp + '"', { stdio: ['ignore', 'inherit', 'inherit'], timeout: 300000 });
    const clair = fs.readFileSync(tmp);
    if (clair.length < 500 || !/CREATE TABLE/i.test(clair.toString('utf8', 0, 200000))) throw new Error('Export suspect (trop court ou sans schéma) : sauvegarde non enregistrée.');
    const nom = 'plume-sync-' + new Date().toISOString().slice(0, 10) + '.sql.enc';
    fs.writeFileSync(path.join(cible, nom), chiffrerSauvegarde(clair, phrase));
    console.log('Sauvegarde chiffrée : ' + path.join(cible, nom) + ' (' + clair.length + ' octets en clair).');
    const sup = elaguer(cible);
    if (sup.length) console.log('Anciennes sauvegardes supprimées : ' + sup.join(', '));
  } finally { try { fs.unlinkSync(tmp); } catch (e) { /* déjà absent */ } }
}

module.exports = { chiffrerSauvegarde, dechiffrerSauvegarde, elaguer };
if (require.main === module) { try { main(); } catch (e) { console.error('Échec : ' + e.message); process.exit(1); } }
