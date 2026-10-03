# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Vue d'ensemble

**Plume Épique** — application web d'aide à l'écriture (romans) avec un module bolt-on pour la création de **romans graphiques / bandes dessinées** (`db.docType === 'roman_graphique'`). 100% côté client, chiffrement local (AES-GCM), multi-profils, synchronisation multi-appareils optionnelle via Cloudflare Workers/KV. Déployée sur Cloudflare Pages (`plume-epique.pages.dev`).

## Commandes

```bash
npm test          # vitest run — seule commande de dev réelle
npm run test:watch
npx vitest run tests/vitest/sync.test.js   # un seul fichier
npx vitest run -t "nom du test"            # filtre par nom
```

Pas de build, pas de bundler, pas de linter, pas de dev server. L'app tourne en fichiers statiques (ouvrir `index.html` ou déployer tel quel). CI (`.github/workflows/test.yml`) lance `npm test` sur chaque push/PR.

## Architecture

App multi-écrans classique en **scope global partagé** — pas de bundler, pas d'import/export (sauf `js/odf-loader.js`, seul fichier ESM). Tous les fichiers `js/*.js` sont chargés en `<script>` classiques dans `index.html`, **dans un ordre précis** dont dépendent les globals :

```
schema.js, images.js, graphicnovel.js, pwa.js, notifications.js, crypto.js,
router.js, profiles.js, library.js, editor.js, tabs.js, panels.js,
findreplace.js, ai.js, snapshots.js, diff.js, stats.js, readability.js,
relations.js, timeline.js, fulltour.js, tts.js, wordcloud.js, pluginSystem.js,
export-format-utils.js, database.js, memory.js
```

**Tout nouveau fichier `js/*.js` doit être ajouté à cette liste dans `index.html` (bon ordre) ET à `CORE_ASSETS` dans `sw.js`**, sinon il ne fonctionnera pas hors-ligne/en prod.

### État global central (js/router.js)

`router.js` (~96 Ko) est le cœur de l'app :
- `let db = DEFAULT_DB(), cur = 0, _cloudToken, _dataKey, _currentDocumentId, _currentProfileId` — état mutable partagé, lu/modifié directement par tous les autres modules (pas de bus d'événements, pas de store).
- `db` = données complètes du manuscrit courant (chapitres, personnages...). `cur` = index du chapitre courant.
- IndexedDB (ouverture/migration `plume_v55` → `plume_epique`), persistance chiffrée (`persistData`/`loadData`), moteur de sync (`syncPush`/`syncPull`, gestion de conflits versionnés), `APP_VERSION`, `initApp()` (bootstrap).

### Modules principaux (js/)

- `profiles.js` — login/création/récupération multi-profils, DEK enveloppée (mot de passe / question secrète / code PDF)
- `library.js` (~89 Ko) — bibliothèque multi-manuscrits par profil (`doclist_<profileId>`), grille/étagère, statut de sync
- `graphicnovel.js` (~123 Ko, plus gros fichier) — module roman graphique, **explicitement isolé** ("entirely isolated from the rest of the app" dans son en-tête), écran/save path propres (`#graphicnovel-screen`, `saveGraphicNovel`), undo stack propre, mais **réutilise les globals/utilitaires de router.js/library.js** (`db`, `cur`, `persistData`, `docDataKey`, `mutateDocList`, `toast`, `showLibraryScreen`...). **Patron à suivre pour toute nouvelle feature majeure** : isoler écran/état, mais brancher sur les mêmes primitives globales de persistance/crypto/profil.
- `editor.js` — CRUD chapitres, statuts brouillon/relecture/final, focus mode
- `images.js` — assets images du roman graphique (poids, dédup, quota)
- `ai.js` — appels IA (résumé, suite, incohérences...) via le Worker relais ; ne dépend que d'une forme de réponse normalisée `{content:[{type:'text', text}]}` — changer de fournisseur IA se fait uniquement dans `worker/worker.js`
- `crypto.js` — AES-GCM, enveloppes de clés multi-profils
- `export-format-utils.js` — export DOCX/JSON chiffré/EPUB/ODT/PDF, backup GitHub Gist
- `odf-loader.js` — seul module ESM, chargement dynamique d'odf-kit (déplacé hors du HTML à cause de la CSP, cf. ci-dessous)

Écrans basculés via classes CSS sur `<body>` (ex: `graphicnovel-mode`), pas de routing URL — `router.js` gère le routage de données, pas d'URL.

### worker/ (Cloudflare Workers)

Deux workers indépendants. Deux voies de déploiement coexistent :
- **Automatique** : `.github/workflows/deploy-workers.yml` (Wrangler) sur push dans `worker/**`.
- **Direct, avec accord explicite de l'utilisateur à chaque fois** : `wrangler` est installé et authentifié dans cet environnement, ce qui permet de déployer via `npx wrangler deploy -c worker/wrangler-ai.toml` ou `-c worker/wrangler-sync.toml`. Claude doit toujours demander confirmation à l'utilisateur avant chaque déploiement direct — jamais de déploiement sans validation explicite, quelle que soit la session.
  Après un déploiement direct validé, committer quand même les changements de `worker/*.js` dans le repo (référence pour la CI et pour la relecture).

**L'édition manuelle via le dashboard Cloudflare (humain cliquant dans l'interface web) reste dépréciée.**

- `worker.js` + `wrangler-ai.toml` — relais IA. **Utilise actuellement Google Gemini** (`gemini-3.6-flash`), migré de Mistral le 2026-09-11 (rate limits du free tier). Secret `MISTRAL_API_KEY`/clé Gemini uniquement dans le dashboard Cloudflare.
- `sync-worker.js` + `wrangler-sync.toml` — sync multi-appareils via KV (binding `PLUME_SYNC`, nom figé en dur dans le code). Écritures versionnées, 409 si écriture obsolète, gated par secret `SYNC_KEY`.

### PWA (sw.js)

`CACHE = 'plume-epique-vX.Y.Z'` — doit être identique à `APP_VERSION` (router.js) à chaque release. Pas de `skipWaiting()` automatique (bannière de mise à jour via `pwa.js`). Le fetch handler **n'intercepte jamais** les appels API (sync Worker, IA Worker, GitHub, LanguageTool) — un bug passé (v7.22.4) avait servi des données API périmées quand ce filtre manquait.

## Conventions

- Fichiers `js/` : tout minuscule, pas de séparateur (`findreplace.js`) ; `pluginSystem.js` et `export-format-utils.js` sont des exceptions
- Fonctions/variables : camelCase. Convention "privé" par préfixe underscore (`_currentDocumentId`, `_dataKey`) — pas de vraie privacité JS (peu de classes ES)
- Constantes : SCREAMING_SNAKE_CASE (`APP_VERSION`, `IDB_NAME`, `SCHEMA_VERSION`)
- CSS : classes utilitaires `u-*` (`u-d-flex`, `u-gap-8px`) et `gate-*` — **aucun style inline** (imposé par la CSP, voir plus bas)
- Module roman graphique : préfixe `_gn` pour tout global de module (`_gnActivePage`, `_gnUndoStack`, `_gnDrag`) — à réutiliser pour toute nouvelle feature isolée
- Commentaires abondants en français, documentant le *pourquoi* (historique de bugs, post-mortems) — convention forte à préserver

### CSP — règle stricte

`_headers` impose une CSP stricte : `style-src 'self'` uniquement (pas de `style=""` inline), scripts uniquement en fichiers externes (pas de `<script>` inline, même petit). **Incident réel documenté** (v7.13→v7.16) : un `<script type="module">` inline a été silencieusement bloqué pendant 3 versions avant d'être détecté → déplacé vers `js/odf-loader.js`. Toute nouvelle balise `<script>`/`style=""` dans `index.html` doit être un fichier externe.

## Versioning

La version réelle de l'app vit dans **deux endroits synchronisés**, jamais dans `package.json` (`"version": "1.0.0"` est un artefact du package de tests, non utilisé) :
- `js/router.js` → `const APP_VERSION`
- `sw.js` → `const CACHE = 'plume-epique-vX.Y.Z'`

Les deux doivent être bumpés ensemble à chaque release (contextes différents : page vs Service Worker, pas de variable partageable). Semver : patch = fix isolé, minor = écran/feature validé ou fix critique, major = refonte majeure. Commits en français, style `feat:`/`fix:`/`Lot N vX.Y.Z : ...`, référencent souvent des PR/issues GitHub.

## Notes pour Claude

- **Règle n°1 du projet, sans exception** : avant tout changement de code, présenter
  problème / pourquoi c'est un problème / solution proposée / difficulté, et attendre
  une validation explicite avant de coder.
  **Protocole par lot (impératif, rappelé le 2026-10-03)** — à chaque lot :
  1. AVANT de coder : expliquer les problèmes détectés, pourquoi ce sont des problèmes,
     les solutions proposées et leur degré de difficulté ; attendre la validation (ou le
     refus) de l'utilisateur lot par lot.
  2. APRÈS codage et livraison : donner le **numéro de version attendue** (APP_VERSION +
     CACHE de sw.js, bumpés ensemble) et la **méthode pour vérifier le résultat**
     (tests à lancer, parcours manuel, console/réseau à contrôler).
  3. APRÈS chaque push (demandé le 2026-10-03) : Claude vérifie lui-même le site en ligne
     (navigateur intégré, sans se connecter) : version publiée (APP_VERSION/sw.js/titre),
     versions des libs, erreurs console, réponses des Workers (curl : 401/403 attendus),
     puis donne à l'utilisateur uniquement la liste des tests qui exigent une session
     connectée (saisie, synchro, IA, exports) — Claude ne saisit jamais de mot de passe
     ni ne crée de profil sur le site réel.
  Lots regroupés de façon cohérente techniquement et économes en tokens (plan issu de
  l'audit AUD-01, fichiers dans `Claude outputs/Audit-01/`).
- **Les conversations se font UNIQUEMENT en français** dans ce projet, quelle que soit la session.
- **README.md est partiellement obsolète** — ne pas s'y fier pour l'état courant : le titre affiche encore v9.1.1, il décrit Mistral comme fournisseur IA (c'est Gemini depuis le 2026-09-11), et indique la section roman graphique comme "pas commencée" alors qu'elle est le focus principal du développement récent. Vérifier les faits sensibles au temps dans le code (`router.js` APP_VERSION, `worker/worker.js` modèle IA, `git log`) plutôt que dans le README. Le contenu architectural/historique du README reste utile.
- **Ordre de chargement des scripts = dépendance critique** : ajouter un fichier `js/*.js` sans respecter l'ordre dans `index.html` (et sans l'ajouter à `CORE_ASSETS` dans `sw.js`) casse l'app silencieusement.
- **Incident de perte de données** (v8.1.0, 2026-07-27) : la sync ne comparait que "hash identique vs différent", jamais "plus récent" → toutes les profils sauf le plus ancien ont disparu sur plusieurs appareils. Corrigé avec des numéros de version + sécurités `mergeProfilesIndex` + test de non-régression `tests/vitest/sync-versioning.test.js`. À lire avant de toucher `syncPush`/`syncPull`/fusion d'index de profils.
- Pas d'outil de lint/format configuré — ne pas inventer de commande lint.
- `vitest.config.js` : `fileParallelism: false` — les tests partagent un contexte d'app global (comme l'app réelle avec `db`/`cur`), s'exécutent dans l'ordre, ne pas les paralléliser mentalement.
- `CLE-DE-SYNCHRONISATION-NE-PAS-PARTAGER.txt` — clé de sync locale, gitignored, ne jamais committer.
