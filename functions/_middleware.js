// v9.64.0 (audit AUD-06-011) — le dépôt entier était publié avec le site (documentation d'exploitation, CLAUDE.md,
// code des Workers, tests, package.json) : utile à un attaquant, inutile à l'application.
// `_routes.json` ne déclenche cette fonction QUE pour ces chemins (les fichiers de l'application restent servis
// directement, sans consommer le quota de Functions) ; elle y répond 404.
export function onRequest() {
  return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}
