#!/usr/bin/env node
'use strict';
// ═══════════════════════════════════════════════════════
// SURVEILLANCE DU QUOTA GRATUIT D1 DU COMPTE (v9.70.0, audit AUD-07-008)
// Les limites gratuites de D1 (100 000 lignes écrites et 5 millions de lignes lues par jour) sont partagées par TOUTES
// les bases du compte (plume-sync, horizon-poi, odyssee-chat-db…). Un pic dans l'une bloque les autres. Ce script
// additionne les 24 dernières heures de chaque base (wrangler d1 info) et sort en erreur (code 1) à partir de 80 %
// d'une des deux limites : lancé chaque jour par .github/workflows/surveillance-quota.yml, une sortie en erreur fait
// envoyer un courriel par GitHub. Usage local : node scripts/surveiller-quota-d1.cjs [--seuil=0.8]
// Jamais de contenu : uniquement des compteurs.
// ═══════════════════════════════════════════════════════
const { execSync } = require('node:child_process');

const LIMITE_ECRITES = 100000;
const LIMITE_LUES = 5000000;
const WRANGLER = 'wrangler@4.149.0';

// Pure : reçoit [{ name, rows_written_24h, rows_read_24h }] et renvoie le verdict.
function evaluerQuota(bases, seuil = 0.8) {
  const ecrites = bases.reduce((s, b) => s + (Number(b.rows_written_24h) || 0), 0);
  const lues = bases.reduce((s, b) => s + (Number(b.rows_read_24h) || 0), 0);
  const pctEcrites = ecrites / LIMITE_ECRITES, pctLues = lues / LIMITE_LUES;
  return {
    ecrites, lues, pctEcrites, pctLues,
    alerte: pctEcrites >= seuil || pctLues >= seuil,
    parBase: bases.map(b => ({ name: b.name, ecrites: Number(b.rows_written_24h) || 0, lues: Number(b.rows_read_24h) || 0 }))
  };
}

// wrangler écrit parfois un bandeau avant le JSON : on prend à partir de la première ligne qui ouvre un tableau/objet.
function extraireJson(texte) {
  const m = /^[[{]\s*$/m.exec(texte) || /^[[{]/m.exec(texte);
  return JSON.parse(m ? texte.slice(m.index) : texte);
}
function wr(args) {
  return extraireJson(execSync('npx --yes ' + WRANGLER + ' ' + args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 }));
}

function main() {
  const arg = process.argv.find(a => a.startsWith('--seuil='));
  const seuil = arg ? Number(arg.slice(8)) : 0.8;
  const liste = wr('d1 list --json');
  const bases = liste.map(b => {
    const info = wr('d1 info ' + b.name + ' --json');
    return { name: b.name, rows_written_24h: info.rows_written_24h, rows_read_24h: info.rows_read_24h };
  });
  const v = evaluerQuota(bases, seuil);
  for (const b of v.parBase) console.log(b.name.padEnd(18), 'écrites 24 h :', String(b.ecrites).padStart(7), '· lues 24 h :', String(b.lues).padStart(9));
  console.log('TOTAL compte'.padEnd(18), 'écrites 24 h :', String(v.ecrites).padStart(7), '(' + (v.pctEcrites * 100).toFixed(1) + ' % de ' + LIMITE_ECRITES + ')',
    '· lues 24 h :', String(v.lues).padStart(9), '(' + (v.pctLues * 100).toFixed(1) + ' % de ' + LIMITE_LUES + ')');
  if (v.alerte) {
    console.log('::error::Quota gratuit D1 du compte presque atteint (seuil ' + Math.round(seuil * 100) + ' %). Voir docs/EXPLOITATION.md §7.');
    process.exit(1);
  }
  console.log('Quota D1 : marge suffisante.');
}

module.exports = { evaluerQuota, extraireJson, LIMITE_ECRITES, LIMITE_LUES };
if (require.main === module) main();
