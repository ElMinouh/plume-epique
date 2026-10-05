# Plume Épique

Application web d'aide à l'écriture de romans, avec un module de **romans graphiques / livres illustrés**.
100 % côté client, **chiffrement local** (AES-GCM), multi-profils, synchronisation multi-appareils optionnelle
(Cloudflare Workers + D1), PWA installable. Déployée sur Cloudflare Pages : <https://plume-epique.pages.dev>.

> Version courante : voir `APP_VERSION` dans `js/router.js` (et `CACHE` dans `sw.js`, toujours identiques).
> Ancien README (historique des versions jusqu'à la v9.1.1) : [`docs/HISTORIQUE.md`](docs/HISTORIQUE.md).

## Documentation

| Document | Contenu |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Architecture, conventions, règles de travail (lots, versions, tests locaux) |
| [`docs/EXPLOITATION.md`](docs/EXPLOITATION.md) | Déployer, revenir en arrière, restaurer, changer la clé de synchro, quotas, journaux |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Choix d'architecture importants et leurs raisons |
| [`docs/BILAN-AUDIT-01.md`](docs/BILAN-AUDIT-01.md) | Bilan de remédiation de l'audit technique d'octobre 2026 (28 constats) |
| [`vendor/LISEZMOI.md`](vendor/LISEZMOI.md) | Librairies tierces servies localement et comment les mettre à jour |
| [`docs/HISTORIQUE.md`](docs/HISTORIQUE.md) | Ancien README : historique et incidents jusqu'en juillet 2026 |

## Fonctionnement en bref

- **Pas de bundler** : tous les `js/*.js` sont des scripts classiques chargés dans un ordre précis par `index.html`
  (liste dans `CLAUDE.md`). Toute nouvelle librairie va dans `vendor/` (aucun CDN : `script-src 'self'`).
- **Données** : manuscrits chiffrés dans IndexedDB (une clé de données par profil, enveloppée par mot de passe,
  réponse secrète et code de récupération). Images du roman graphique : base séparée, **chiffrées** elles aussi.
- **Enregistrement** : local immédiat (0,6 s après la frappe) ; envoi en ligne **après une pause** (1 min) ou
  au plus tard 5 min en écriture continue, et immédiatement à la fermeture, au changement d'onglet ou de manuscrit.
- **Synchronisation** : Worker `plume-epique-sync` (`worker/sync-worker.js`), stockage **Cloudflare D1**
  (`plume-sync`), numéros de version par clé (refus 409 si la base est périmée), suppressions propagées par pierres
  tombales, images synchronisées une fois chacune (clés `img_*`, budget 350 Mo). Voir `docs/DECISIONS.md`.
- **IA** : Worker `plume-epique-ai` (`worker/worker.js`) relayant vers **Google Gemini** ; clé de synchronisation
  obligatoire, taille bornée. Le texte envoyé transite en clair chez Google le temps du traitement (notice affichée).
- **Suppression** : propagée par pierres tombales ; le serveur n'efface un manuscrit (et son historique de chat IA) que si l'index de bibliothèque le marque supprimé.
- **Sauvegardes** : exports DOCX/EPUB/ODT/PDF/JSON, sauvegarde GitHub Gist chiffrée (par paquets), sauvegarde de
  7 jours de la base D1 (Time Travel), corbeille de 30 jours, historique espacé sur un mois.

## Développement

```bash
npm install
npm test            # Vitest : ~300 tests (client, Workers sur une vraie base SQLite, intégration à deux appareils)
```

Pas de build, pas de linter. Les tests partagent un contexte applicatif global : `fileParallelism: false`.

### Tester en réel sur une copie locale (jamais sur le site de production)

Deux « appareils » = deux ports `localhost` (stockages séparés) reliés à un Worker de synchro local avec une base D1
jetable et une clé de **test**.

```bash
# 1. base D1 locale jetable (une seule fois)
npx wrangler d1 execute plume-sync -c worker/wrangler-sync.toml --local --persist-to .wrangler-test --file worker/sync-schema.sql
# 2. Worker de synchro local (clé de test)
npx wrangler dev -c worker/wrangler-sync.toml --local --persist-to .wrangler-test --port 8787 --var SYNC_KEY:test-key-local-12345
# 3. deux appareils (dans deux autres terminaux)
node scripts/dev-server.cjs 8081
node scripts/dev-server.cjs 8082
```

Le serveur de test applique la **vraie politique de sécurité** (`_headers`) : toute violation de la CSP apparaît en
console. Saisir la clé `test-key-local-12345` à l'écran de configuration, créer un profil de test.

## Déploiement

- **Site** : push sur `main` → Cloudflare Pages (publication automatique, ~1 min).
- **Workers** : push touchant `worker/**` → GitHub Actions : tests, contrôle à blanc, déploiement
  (`.github/workflows/deploy-workers.yml`). Procédures détaillées, retour arrière et incidents : `docs/EXPLOITATION.md`.
- **Version** : à chaque release, `APP_VERSION` (`js/router.js`) et `CACHE` (`sw.js`) sont bumpés ensemble.

## Sécurité (résumé)

CSP stricte (`_headers`) : scripts et styles **uniquement** du site, aucun CDN, aucun style ni script en ligne ;
tout HTML inséré est assaini (DOMPurify) ou échappé (`escapeHtml`). Worker de synchro : clé de synchronisation
(comparaison à temps constant, freinage des essais), liste blanche de clés, tailles bornées, journaux sans contenu.
Limites connues et choix assumés (question secrète conservée, clé de synchronisation commune à tous les profils d'un
foyer, etc.) : `docs/DECISIONS.md`.

## Limites connues

- Le quota d'écritures de la base D1 gratuite (100 000 lignes/jour) est **partagé par tout le compte Cloudflare** ;
  la limite de la base est de 500 Mo (dont 350 Mo réservés aux images). Voir `docs/EXPLOITATION.md`.
- Une suppression est propagée à tous les appareils et efface aussi le contenu chiffré du serveur ; la seule trace récupérable est la sauvegarde de 7 jours de la base D1 (Time Travel).
- La question secrète de récupération est une porte plus faible que le mot de passe (décision documentée).
- Pas de test automatisé en navigateur réel : les parcours complets sont vérifiés à la main sur copie locale.
