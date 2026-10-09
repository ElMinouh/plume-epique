# Plume Épique

Application web d'aide à l'écriture de romans, avec un module de **romans graphiques / livres illustrés**.
100 % côté client, **chiffrement local** (AES-GCM), multi-profils, synchronisation multi-appareils optionnelle
(Cloudflare Workers + D1), PWA installable. Déployée sur Cloudflare Pages : <https://plume-epique.pages.dev>.

> Version courante : voir `APP_VERSION` dans `js/router.js` (et `CACHE` dans `sw.js`, toujours identiques). Ce README
> décrit la **v9.43.0**. Ancien README (historique des versions jusqu'à la v9.1.1) : [`docs/HISTORIQUE.md`](docs/HISTORIQUE.md).

## Documentation

| Document | Contenu |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Architecture, conventions, règles de travail (lots, versions, tests locaux, mise à jour du README) |
| [`docs/EXPLOITATION.md`](docs/EXPLOITATION.md) | Déployer, revenir en arrière, restaurer, changer la clé de synchro, quotas, journaux |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Choix d'architecture importants et leurs raisons |
| [`docs/BILAN-AUDIT-01.md`](docs/BILAN-AUDIT-01.md) | Bilan de remédiation de l'audit technique d'octobre 2026 (28 constats) |
| [`docs/BILAN-AUDIT-02.md`](docs/BILAN-AUDIT-02.md) | Bilan de remédiation de l'audit fonctionnel d'octobre 2026 (22 constats, v9.33.0 → v9.39.0) |
| [`vendor/LISEZMOI.md`](vendor/LISEZMOI.md) | Librairies tierces servies localement et comment les mettre à jour |
| [`docs/HISTORIQUE.md`](docs/HISTORIQUE.md) | Ancien README : historique et incidents jusqu'en juillet 2026 |

## Fonctionnalités

- **Écriture** : chapitres (statuts, étiquettes, notes de recherche, objectif de mots, fiches), éditeur riche (gras, italique,
  souligné, titres, surlignage), **mode Focus** (enregistré en continu), lecture linéaire, annuler/rétablir par chapitre,
  reprise à la dernière position.
- **Structure** : glisser-déposer, **scinder un chapitre** au curseur, **fusionner** avec le suivant, duplication, corbeille
  de chapitres (30 jours, position d'origine conservée).
- **Recherche** : recherche globale ; **rechercher/remplacer** avec casse, mot entier et mode « tout le manuscrit »
  (décompte, confirmation, copie de sauvegarde de chaque chapitre modifié).
- **Historique** : versions espacées sur un mois (copie en quittant un chapitre modifié, à la fermeture, avant une
  restauration, un remplacement global, une scission ou une fusion), comparaison et restauration.
- **Univers** : personnages, lieux, quêtes/intrigues (suppression avec nettoyage des liens), graphe de relations,
  **chronologie** modifiable, réordonnable et triable selon les chapitres.
- **Suivi** : objectifs journalier / hebdomadaire / mensuel, série de jours, sprint, estimation de date de fin. Comptage de
  mots à la manière de Word (« cœur », « l'homme » = 1 mot) ; le « jour » suit l'heure **locale**.
- **IA** (Gemini) : résumé du chapitre **lu en entier**, continuation, incohérences (chapitre, ou **tout le roman en deux
  temps** avec estimation, confirmation, annulation et plafond de 40 appels), noms, synonymes, chat. L'écran indique toujours
  la portion de texte réellement lue.
- **Import / export** : DOCX, PDF (Times, numéros de page), EPUB, ODT avec la **mise en forme** conservée ; fichier nommé
  d'après le manuscrit ; import DOCX/ODT **découpé en chapitres** d'après les titres ; sauvegarde JSON de toute la
  bibliothèque (réimport sans doublons) ; sauvegarde GitHub Gist chiffrée.
- **Bibliothèque** : manuscrits multiples, **corbeille de manuscrits de 30 jours** (restauration sur tous les appareils),
  profils multiples (suppression de profil propagée à tous les appareils).
- **Premiers pas** (v9.41.0) : le premier écran propose « clé de la famille » ou « écrire sur cet appareil seulement » ; la configuration de la sauvegarde GitHub est **facultative** (bulle « Plus tard », panneau Système toujours fermable, rappel discret dans la bibliothèque) ; une seule bulle d'aide à la fois ; un clic sur un type de projet le crée.
- **Retours et clavier** (v9.42.0) : messages temporaires de 3 à 8 s avec ✕ pour les erreurs (pause au survol) ; un échec d'enregistrement reste affiché (message fixe + « ⚠ Non enregistré depuis hh:mm » dans le pied de page) jusqu'au prochain enregistrement réussi ; Échap ferme **une seule couche** à la fois ; Tab n'est piégé que dans les vraies fenêtres modales ; les confirmations de suppression mettent le focus sur « Annuler ».
- **Lisibilité** (v9.43.0) : textes d'interface relevés (≥ 12,5 px) et réglage **Taille de l'interface** (Normale / Grande / Très grande, par appareil) dans Config ; contrastes des boutons ≥ 4,5:1 ; cibles de clic ≥ 24 px (44 px au toucher) ; plus de débordement horizontal de l'éditeur sur téléphone ; animations coupées si le système le demande.
- **Roman graphique** : pages libres (images + texte), gabarits, cadrage, calques, corbeille de pages, exports.

## Fonctionnement en bref

- **Pas de bundler** : tous les `js/*.js` sont des scripts classiques chargés dans un ordre précis par `index.html`
  (liste dans `CLAUDE.md`). Toute nouvelle librairie va dans `vendor/` (aucun CDN : `script-src 'self'`).
- **Données** : manuscrits chiffrés dans IndexedDB (une clé de données par profil, enveloppée par mot de passe,
  réponse secrète et code de récupération). Images du roman graphique : base séparée, **chiffrées** elles aussi.
- **Enregistrement** : local immédiat (0,6 s après la frappe, y compris en mode Focus) ; envoi en ligne **après une pause**
  (1 min) ou au plus tard 5 min en écriture continue, et immédiatement à la fermeture, au changement d'onglet ou de manuscrit.
- **Synchronisation** : Worker `plume-epique-sync` (`worker/sync-worker.js`), stockage **Cloudflare D1**
  (`plume-sync`), numéros de version par clé (refus 409 si la base est périmée), suppressions propagées par pierres
  tombales (manuscrits `deleted`, profils `deletedProfiles`), images synchronisées une fois chacune (clés `img_*`,
  budget 350 Mo). Voir `docs/DECISIONS.md`.
- **IA** : Worker `plume-epique-ai` (`worker/worker.js`) relayant vers **Google Gemini** ; clé de synchronisation
  obligatoire, 30 000 caractères par demande au plus (l'application découpe les textes plus longs). Le texte envoyé
  transite en clair chez Google le temps du traitement (notice affichée).
- **Suppression d'un manuscrit** : « Mettre à la corbeille » (champ `trashedAt` dans l'index de bibliothèque, contenu
  conservé sur l'appareil et sur le serveur) ; au bout de 30 jours, ou via « Définitif » (retape du titre), suppression
  définitive par pierre tombale. Le serveur n'efface un manuscrit (et son historique de chat IA) que si l'index de
  bibliothèque le marque supprimé.
- **Sauvegardes** : exports DOCX/EPUB/ODT/PDF/JSON, sauvegarde GitHub Gist chiffrée (par paquets), sauvegarde de
  7 jours de la base D1 (Time Travel), corbeilles (chapitres et pages 30 jours, manuscrits 30 jours), historique espacé sur
  un mois.
- **Schéma** : la version de schéma des manuscrits est 17 ; des champs facultatifs ajoutés après (`wordCountRebased`,
  `trashedAt`…) sont ignorés sans danger par une version plus ancienne.

## Développement

```bash
npm install
npm test            # Vitest : ~470 tests (client, Workers sur une vraie base SQLite, intégration à deux appareils)
```

Pas de build, pas de linter. Les tests partagent un contexte applicatif global : `fileParallelism: false`.
La suite principale (`tests/vitest/suite.js`) charge `schema.js` avant tout : le comptage de mots, la date locale et les
pierres tombales y vivent pour être testés tels quels (aucune copie dans le harnais).

### Tester en réel sur une copie locale (jamais sur le site de production)

Deux « appareils » = deux ports `localhost` (stockages séparés) reliés à un Worker de synchro local avec une base D1
jetable et une clé de **test**. Utiliser des ports jamais servis auparavant (le stockage d'un port déjà utilisé conserve
d'anciens profils de test).

```bash
# 1. base D1 locale jetable (une seule fois)
npx wrangler d1 execute plume-sync -c worker/wrangler-sync.toml --local --persist-to .wrangler-test --file worker/sync-schema.sql
# 2. Worker de synchro local (clé de test)
npx wrangler dev -c worker/wrangler-sync.toml --local --persist-to .wrangler-test --port 8787 --var SYNC_KEY:test-key-local-12345
# 3. deux appareils (dans deux autres terminaux)
node scripts/dev-server.cjs 8084
node scripts/dev-server.cjs 8085
```

Le serveur de test applique la **vraie politique de sécurité** (`_headers`) : toute violation de la CSP apparaît en
console. Saisir la clé `test-key-local-12345` à l'écran de configuration, créer un profil de test. Après le test, arrêter
aussi les processus `workerd` laissés par `wrangler dev`.

## Déploiement

- **Site** : push sur `main` → Cloudflare Pages (publication automatique, ~1 min ; un navigateur déjà ouvert peut afficher
  l'ancienne version jusqu'à la bannière de mise à jour ou un second rechargement).
- **Workers** : push touchant `worker/**` → GitHub Actions : tests, contrôle à blanc, déploiement
  (`.github/workflows/deploy-workers.yml`). Procédures détaillées, retour arrière et incidents : `docs/EXPLOITATION.md`.
- **Version** : à chaque release, `APP_VERSION` (`js/router.js`) et `CACHE` (`sw.js`) sont bumpés ensemble.
- **Tous les appareils doivent être mis à jour** après une version qui ajoute un champ de synchronisation (v9.39.0 :
  corbeille de manuscrits, suppression de profil) : une version plus ancienne ignore ces champs.

## Sécurité (résumé)

CSP stricte (`_headers`) : scripts et styles **uniquement** du site, aucun CDN, aucun style ni script en ligne ;
tout HTML inséré est assaini (DOMPurify) ou échappé (`escapeHtml`). Worker de synchro : clé de synchronisation
(comparaison à temps constant, freinage des essais), liste blanche de clés, tailles bornées, journaux sans contenu.
Limites connues et choix assumés (question secrète conservée, clé de synchronisation commune à tous les profils d'un
foyer, etc.) : `docs/DECISIONS.md`.

## Limites connues

- Le quota d'écritures de la base D1 gratuite (100 000 lignes/jour) est **partagé par tout le compte Cloudflare** ;
  la limite de la base est de 500 Mo (dont 350 Mo réservés aux images). Un manuscrit à la corbeille garde sa place
  30 jours. Voir `docs/EXPLOITATION.md`.
- Une suppression **définitive** (fin des 30 jours ou « Définitif ») est propagée à tous les appareils et efface le
  contenu chiffré du serveur ; la seule trace récupérable est la sauvegarde de 7 jours de la base D1 (Time Travel).
- Un **profil supprimé** disparaît de tous les appareils, mais ses données chiffrées restent sur le serveur (le Worker
  refuse d'effacer autre chose que les manuscrits marqués) : illisibles sans le mot de passe, elles occupent de la place.
- Le contrôle d'incohérences « tout le roman » compare des faits extraits chapitre par chapitre ; sur un roman très long, la
  comparaison se fait par groupes de chapitres consécutifs et une contradiction entre deux groupes peut échapper (signalé à l'écran).
- La date d'une chronologie est un texte libre : le tri automatique se fait selon l'ordre des chapitres, pas selon la date.
- **Dépendances** : les bibliothèques servies par le site sont dans `vendor/` (Dependabot ne les propose plus (config du 06/10/2026 : mensuel, outils de test et actions regroupés) : les mettre à jour à la main une fois par trimestre — `npm outdated`, `npm audit`, notes de version —, méthode dans `vendor/LISEZMOI.md` . Les alertes de sécurité Dependabot sont activées sur le dépôt (depuis le 06/10/2026 ; une alerte ouverte sur `sprintf-js`, voir `vendor/LISEZMOI.md`) ; les mises à jour de sécurité automatiques restent désactivées). `docx` est en 9.8.1 depuis la v9.40.0 et **n'est chargé qu'à la première demande d'export DOCX** (1,2 Mo : il alourdissait chaque démarrage ; il reste précaché par le service worker, donc l'export marche hors ligne). `npm audit` signale 3 alertes modérées sur `mammoth` (outil en ligne de commande, absent du fichier servi) : sans effet sur le site (alerte fermée sur GitHub le 06/10/2026).
- La question secrète de récupération est une porte plus faible que le mot de passe (décision documentée).
- Pas de test automatisé en navigateur réel : les parcours complets sont vérifiés à la main sur copie locale.
