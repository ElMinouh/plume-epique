'use strict';
// Lit le registre des événements de sécurité du Worker de synchro (audit AUD-06-016, Lot 7) : résumé des dernières 24 heures
// et derniers événements (type, empreinte courte du profil, pays, précision). Aucune adresse IP, aucun contenu, aucune clé.
//
// Usage (PowerShell, depuis la racine du dépôt) :
//   $env:PLUME_SYNC_KEY = '<clé de synchronisation>'
//   node scripts/evenements-securite.cjs
// Que regarder : une rafale de « auth_fail » (quelqu'un essaie des clés), des « profile_denied » répétés (serrure d'un profil
// testée), un « delete » / « profile_erase » / « role_change » que vous n'avez pas fait.
const DEFAULT_URL = 'https://plume-epique-sync.air7841.workers.dev';
const LIBELLES = {
  auth_fail: 'clé de synchronisation refusée', rate_limit: 'trop d\'essais (frein déclenché)', origin_refused: 'origine refusée',
  profile_denied: 'accès refusé à un profil (serrure)', index_denied: 'modification de la liste des profils refusée', quota: 'quota dépassé',
  delete: 'suppression de données', profile_erase: 'effacement d\'un profil', profile_lock: 'profil verrouillé (1re connexion)', role_change: 'changement de rôle'
};
function formater(resume) {
  const lignes = ['Événements de sécurité (conservés ' + (resume.retentionDays || 30) + ' jours).', ''];
  const k = Object.entries(resume.last24h || {});
  lignes.push('Dernières 24 h :' + (k.length ? '' : ' aucun événement.'));
  k.forEach(([type, n]) => lignes.push('  ' + String(n).padStart(5) + '  ' + type + ' — ' + (LIBELLES[type] || '')));
  lignes.push('', 'Derniers événements :');
  (resume.last || []).slice(0, 30).forEach(e => lignes.push('  ' + new Date(e.ts).toLocaleString('fr-FR') + '  ' + e.kind.padEnd(15) + ' profil ' + (e.pid || '—').padEnd(10) + ' pays ' + (e.cc || '—').padEnd(3) + ' ' + (e.detail || '')));
  return lignes.join('\n');
}
module.exports = { formater, LIBELLES };
if (require.main === module) {
  const cle = process.env.PLUME_SYNC_KEY;
  if (!cle) { console.error('Variable PLUME_SYNC_KEY absente (clé de synchronisation).'); process.exit(2); }
  const url = (process.argv.find(a => a.startsWith('--url=')) || '').slice(6) || DEFAULT_URL;
  fetch(url + '?key=__security__', { headers: { Authorization: 'Bearer ' + cle } })
    .then(async r => { if (!r.ok) throw new Error('Le serveur a répondu ' + r.status); console.log(formater(await r.json())); })
    .catch(e => { console.error(e.message); process.exit(1); });
}
