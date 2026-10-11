'use strict';
// Migration UNIQUE de l'ancien stockage KV vers D1 (audit AUD-06-013, Lot 1).
//
// Pourquoi : tant que le Worker relit KV en repli, une donnée supprimée de D1 réapparaît (la version
// restée dans KV est servie à nouveau) : rien n'est vraiment effacé du serveur. Avant de retirer ce repli,
// on copie dans D1 ce qui n'existe QUE dans KV, sans jamais ressusciter un manuscrit supprimé.
//
// Sûreté :
//   • lecture seule par défaut (essai à blanc) ; l'écriture exige --appliquer ;
//   • la copie passe par l'API du Worker (GET puis PUT avec la version lue) : mêmes contrôles de version que
//     l'application (409 si quelqu'un a écrit entre-temps), aucune écriture SQL directe ;
//   • un doc_/aichat_ dont l'index doclist_ du profil porte la pierre tombale est IGNORÉ (jamais recopié) ;
//   • KV n'est jamais modifié ici ; le vidage est une étape séparée (--vider-kv --confirmer) à ne lancer
//     qu'APRÈS vérification du résultat.
// La clé de synchronisation se passe par la variable d'environnement PLUME_SYNC_KEY (jamais en argument).
//
// Usage (depuis la racine du dépôt) :
//   $env:PLUME_SYNC_KEY = '<clé>'            (PowerShell)
//   node scripts/migrer-kv-vers-d1.cjs                    # essai à blanc : liste ce qui serait copié
//   node scripts/migrer-kv-vers-d1.cjs --appliquer        # copie dans D1
//   node scripts/migrer-kv-vers-d1.cjs --vider-kv --confirmer   # vide KV (irréversible : sauvegarde d'abord)
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const KV_NAMESPACE_ID = '9abfbc1017d245ef8def8a6ac8c72418'; // identique à worker/wrangler-sync.toml (non secret)
const DEFAULT_URL = 'https://plume-epique-sync.air7841.workers.dev';
const TOMB_RE = /^(doc|aichat)_([A-Za-z0-9-]{1,80})_([A-Za-z0-9-]{1,80})$/;

// Décide, pour chaque clé de KV, de ce qu'on en fait. Pure : testée sans réseau.
//   kvKeys, d1Keys : tableaux de noms ; tombstones : { idProfil: Set(idManuscrit supprimés) }
function planMigration({ kvKeys, d1Keys, tombstones }) {
  const inD1 = new Set(d1Keys);
  const plan = { copier: [], dejaDansD1: [], supprimes: [], ignores: [] };
  for (const k of kvKeys) {
    if (k === '__ping__' || k === '__usage__') { plan.ignores.push(k); continue; }
    if (inD1.has(k)) { plan.dejaDansD1.push(k); continue; }
    const m = TOMB_RE.exec(k);
    if (m && tombstones && tombstones[m[2]] && tombstones[m[2]].has(m[3])) { plan.supprimes.push(k); continue; }
    plan.copier.push(k);
  }
  return plan;
}

// Copie les clés du plan via l'API du Worker. `call(key, {method, body, base})` renvoie une Response.
async function copyKeys(call, keys, log) {
  const res = { copiees: 0, conflits: 0, vides: 0, erreurs: [] };
  for (const k of keys) {
    try {
      const g = await call(k, { method: 'GET' });
      if (!g.ok) { res.erreurs.push(k + ' (lecture ' + g.status + ')'); continue; }
      const version = g.headers.get('X-Plume-Version');
      const body = await g.text();
      if (body === 'null') { res.vides++; continue; }
      const p = await call(k, { method: 'PUT', body, base: version });
      if (p.status === 409) { res.conflits++; log('  conflit (réécrite entre-temps, donc déjà dans D1) : ' + k); continue; }
      if (!p.ok) { res.erreurs.push(k + ' (écriture ' + p.status + ')'); continue; }
      res.copiees++;
    } catch (e) { res.erreurs.push(k + ' (' + e.message + ')'); }
  }
  return res;
}

// Index de suppressions de chaque profil concerné (lu via le Worker).
async function loadTombstones(call, kvKeys) {
  const profils = new Set();
  for (const k of kvKeys) { const m = TOMB_RE.exec(k); if (m) profils.add(m[2]); }
  const out = {};
  for (const p of profils) {
    const g = await call('doclist_' + p, { method: 'GET' });
    if (!g.ok) continue;
    try {
      const idx = JSON.parse(await g.text());
      out[p] = new Set(((idx && idx.deleted) || []).map(t => t && t.id).filter(Boolean));
    } catch (e) { /* index illisible : aucune pierre tombale connue, la copie reste prudente côté serveur */ }
  }
  return out;
}

function wrangler(args) {
  // shell:true (nécessaire pour npx sous Windows) concatène les arguments : on met entre guillemets ceux qui
  // contiennent un espace (ex. la requête SQL), sinon wrangler les reçoit découpés.
  const q = a => (/[\s"]/.test(a) ? '"' + a.replace(/"/g, '\\"') + '"' : a);
  const r = spawnSync('npx', ['wrangler', ...args.map(q)], { encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('wrangler ' + args.join(' ') + ' : ' + (r.stderr || r.stdout || '').slice(0, 400));
  return r.stdout;
}
function jsonOf(out) { const i = out.search(/[\[{]/); return JSON.parse(out.slice(i)); }
function listKvKeys() { return jsonOf(wrangler(['kv', 'key', 'list', '--namespace-id', KV_NAMESPACE_ID, '--remote'])).map(e => e.name); }
function listD1Keys() {
  const r = jsonOf(wrangler(['d1', 'execute', 'plume-sync', '--remote', '--json', '--command', 'SELECT k FROM sync_meta', '-c', 'worker/wrangler-sync.toml']));
  return (Array.isArray(r) ? r : [r]).flatMap(x => x.results || []).map(x => x.k);
}

async function main(argv, env) {
  const apply = argv.includes('--appliquer');
  const purge = argv.includes('--vider-kv');
  const url = (argv.find(a => a.startsWith('--url=')) || '').slice(6) || DEFAULT_URL;
  const key = env.PLUME_SYNC_KEY;
  if (!key && !purge) { console.error('Variable PLUME_SYNC_KEY absente (clé de synchronisation).'); return 2; }
  const call = (k, { method = 'GET', body, base } = {}) => fetch(url + '?key=' + encodeURIComponent(k), {
    method, body, headers: { Authorization: 'Bearer ' + key, ...(base != null ? { 'X-Plume-Base-Version': String(base) } : {}) }
  });
  const log = m => console.log(m);

  if (purge) {
    if (!argv.includes('--confirmer')) { console.error('Vidage de KV : ajoutez --confirmer (irréversible ; sauvegarde faite ?).'); return 2; }
    const keys = listKvKeys();
    const f = path.join(os.tmpdir(), 'plume-kv-delete-' + Date.now() + '.json');
    fs.writeFileSync(f, JSON.stringify(keys));
    wrangler(['kv', 'bulk', 'delete', f, '--namespace-id', KV_NAMESPACE_ID, '--remote', '--force']);
    fs.unlinkSync(f);
    console.log(keys.length + ' clé(s) supprimée(s) de KV. Vérification : ' + listKvKeys().length + ' restante(s).');
    return 0;
  }

  const kvKeys = listKvKeys(), d1Keys = listD1Keys();
  const plan = planMigration({ kvKeys, d1Keys, tombstones: await loadTombstones(call, kvKeys.filter(k => !d1Keys.includes(k))) });
  log('KV : ' + kvKeys.length + ' clé(s) · D1 : ' + d1Keys.length + ' clé(s)');
  log('  déjà dans D1 : ' + plan.dejaDansD1.length + ' · supprimées (non recopiées) : ' + plan.supprimes.length + ' · à copier : ' + plan.copier.length);
  plan.copier.forEach(k => log('  → ' + k.replace(/^(\w+?)_.*/, '$1_…')));
  if (!apply) { log('Essai à blanc : rien n\'a été écrit. Ajoutez --appliquer pour copier.'); return 0; }
  const r = await copyKeys(call, plan.copier, log);
  log('Copiées : ' + r.copiees + ' · conflits : ' + r.conflits + ' · vides : ' + r.vides + ' · erreurs : ' + r.erreurs.length);
  r.erreurs.forEach(e => log('  ! ' + e));
  return r.erreurs.length ? 1 : 0;
}

module.exports = { planMigration, copyKeys, loadTombstones, KV_NAMESPACE_ID, TOMB_RE };
if (require.main === module) main(process.argv.slice(2), process.env).then(c => process.exit(c), e => { console.error(e.message); process.exit(1); });
