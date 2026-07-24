# Plume Épique Studio — v7.0.0

Outil d'aide et de suivi d'écriture (roman). Application 100% cliente (aucun serveur
applicatif requis pour le cœur de l'app), stockage local chiffré (IndexedDB), déployée
sur Cloudflare Pages.

🔗 https://plume-epique.pages.dev

## Structure du projet

```
plume-epique/
├── index.html          → structure de la page
├── manifest.json        → manifeste PWA (installation en app)
├── sw.js                 → Service Worker (cache hors-ligne + notification de mise à jour)
├── _headers               → en-têtes HTTP Cloudflare Pages (CSP, nosniff, referrer-policy)
├── worker/
│   ├── worker.js          → Worker Cloudflare relais IA (Mistral) — édité manuellement
│   │                         dans le dashboard Cloudflare, ce fichier sert de référence
│   └── sync-worker.js      → Worker Cloudflare de synchronisation multi-appareils (KV) —
│                              même principe, voir section dédiée plus bas
├── css/
│   └── style.css         → tous les styles
├── js/
│   ├── schema.js           → schéma de données, migrations, ID de chapitre (sans DOM,
│   │                          testable indépendamment — voir tests/test-runner.html)
│   ├── router.js            → état global, sauvegarde par profil, bootstrap de l'appli
│   ├── profiles.js           → système multi-profils (connexion, création, récupération,
│   │                            administration, migration) — voir section dédiée
│   ├── pwa.js                → installation PWA + notification de mise à jour du SW
│   ├── crypto.js              → chiffrement AES-GCM + enveloppes de clé (multi-profils)
│   ├── notifications.js       → messages toast, indicateur de sauvegarde
│   ├── editor.js               → chapitres (CRUD, suppression/réorganisation/duplication,
│   │                              statut brouillon/à revoir/final), éditeur, mode focus,
│   │                              mise en forme riche
│   ├── tabs.js                 → onglets (ouverture, réordonnancement souris + clavier)
│   ├── panels.js               → recherche globale (chapitres, personnages, lieux, quêtes),
│   │                              synonymes/antonymes
│   ├── findreplace.js           → rechercher/remplacer dans l'éditeur
│   ├── ai.js                    → appels IA (résumé, continuation, incohérences, noms)
│   ├── snapshots.js              → historique des versions par ID stable de chapitre
│   ├── diff.js                    → comparaison de versions (diff mot-à-mot par LCS)
│   ├── stats.js                    → statistiques quotidiennes + sprint d'écriture persistant
│   ├── readability.js              → analyse Flesch-Kincaid, dialogue/narration
│   ├── relations.js                → graphe relationnel (D3)
│   ├── timeline.js                 → chronologie des événements
│   ├── tts.js                       → lecture vocale + dictée
│   ├── wordcloud.js                  → nuage de mots-clés
│   ├── pluginSystem.js               → plugins (grammaire, répétitions, synopsis...)
│   ├── export-format-utils.js          → export DOCX/JSON (chiffré si projet chiffré)/EPUB,
│   │                                     sauvegarde GitHub Gist privé + historique des révisions
│   ├── database.js                    → personnages, lieux, quêtes, liens
│   └── memory.js                      → mémoire narrative (recherche + questions IA,
│                                          navigation par ID de chapitre stable)
├── tests/
│   └── test-runner.html   → tests automatisés minimaux (à ouvrir directement dans un
│                             navigateur, aucune installation requise)
└── README.md
```

## Intelligence artificielle

Les fonctionnalités IA (résumé, continuation, incohérences, noms, synonymes/antonymes,
synopsis, mémoire narrative) passent par un Worker Cloudflare relais
(`plume-epique-ai.air7841.workers.dev`) qui appelle l'API **Mistral AI**
(`mistral-large-latest`) avec une clé secrète côté serveur, jamais exposée au navigateur.
`ai.js` ne dépend que d'un format de réponse interne normalisé (`{content:[{type:'text',
text}]}`) — changer de fournisseur IA à l'avenir ne nécessite de modifier que
`worker/worker.js`, jamais `ai.js` ni ses appelants.

## Multi-profils (v7.0.0)

L'accès à l'application passe par un écran de connexion : on choisit un profil
dans une liste déroulante, on saisit son mot de passe. Le premier profil créé
est administrateur (« Cyril » par défaut) ; l'administrateur peut ajouter,
renommer et supprimer des profils. Chaque utilisateur peut, dans « Mon profil »
(onglet Config), modifier son propre nom, son mot de passe et sa question de
sécurité.

### Profils étanches — comment ça marche

Chaque profil possède une clé de données (DEK) aléatoire qui chiffre **ses**
données, et elle seule : aucun profil ne peut lire les données d'un autre, pas
même l'administrateur. Cette clé n'est jamais stockée en clair — elle est
« enveloppée » (chiffrée) séparément par trois secrets qui ouvrent tous la même
clé : le mot de passe, la réponse à la question de sécurité, et un code de
récupération. Oublier le mot de passe ne perd donc pas les données : on ré-ouvre
la clé via la question **ou** le code, puis on redéfinit un mot de passe.

L'index des profils (noms, rôles, enveloppes de clé) est stocké en clair sous la
clé IndexedDB `profiles` ; les données de chaque profil sous `data_<id>`,
toujours chiffrées par la DEK du profil.

### Récupération

Deux mécanismes complémentaires, tous deux sans serveur :
- **Question de sécurité** : pratique, mais choisir une réponse non devinable.
- **Code de récupération** : généré à la création, affiché une seule fois, et
  téléchargeable en PDF (librairie jsPDF). Très solide, à conserver en lieu sûr.

La réinitialisation de mot de passe par l'administrateur n'existe pas
volontairement (elle casserait l'étanchéité) — la récupération se fait toujours
via la question ou le code, par l'utilisateur lui-même.

### Migration depuis l'ancien format mono-profil

Au premier lancement de la v7.0.0, si des données existaient déjà (ancien
stockage mono-profil sous la clé `main`), un écran de migration les rattache
automatiquement au profil administrateur « Cyril » : l'utilisateur saisit son
mot de passe actuel (ou en définit un si les données n'étaient pas chiffrées),
choisit une question de sécurité, et reçoit son code de récupération. Aucune
donnée n'est perdue. L'ancienne clé `main` est conservée intacte par sécurité.

## Synchronisation multi-appareils (v7.22.0)

Se connecter avec le même profil (nom + mot de passe) sur n'importe quel
appareil retrouve désormais la totalité des manuscrits, sans rien exporter/
importer à la main. Un Worker Cloudflare (`worker/sync-worker.js`, à déployer
séparément — même principe que le Worker IA) sert de second point de
stockage à côté d'IndexedDB : chaque écriture est poussée vers ce Worker en
plus du stockage local, chaque lecture essaie d'abord le Worker avant de
retomber sur la copie locale hors-ligne. Le contenu qui y transite reste
chiffré côté client exactement comme pour IndexedDB — le Worker ne stocke
que des blobs opaques, il ne voit jamais rien en clair.

### Clé de synchronisation

Le code du site étant public, un Worker sans protection serait accessible à
n'importe qui capable d'en deviner l'adresse. Une **clé de synchronisation**
protège donc l'accès : une phrase choisie une fois par l'administrateur (côté
Worker, en secret), à taper une seule fois sur chaque appareil (pas par
profil — un seul par appareil, valable pour tous les profils qui l'utilisent
ensuite). Un bouton « Vérifier » confirme immédiatement qu'une clé saisie est
correcte, avant de valider. Un appareil peut aussi choisir de s'en passer
(« Continuer sans synchronisation ») et rester 100% local, comme avant cette
version.

### Déploiement du Worker de synchronisation

1. Créez un nouveau Worker Cloudflare et collez-y le contenu de
   `worker/sync-worker.js`.
2. Créez un namespace KV et liez-le à ce Worker sous le nom exact `PLUME_SYNC`.
3. Ajoutez un secret `SYNC_KEY` (la clé de synchronisation, choisie par vous).
4. Reportez l'URL du Worker déployé dans `js/router.js` (constante
   `SYNC_WORKER_URL`) et dans `_headers` (`connect-src`).

## Sécurité — Content Security Policy

Depuis la v6.2.0, un fichier `_headers` à la racine (reconnu automatiquement par
Cloudflare Pages, aucune configuration dashboard requise) applique une CSP en
défense en profondeur contre le XSS : seuls les CDN réellement utilisés
(jsDelivr, unpkg, d3js.org) peuvent charger du JavaScript, et seules les
destinations réseau connues du projet (Worker IA, GitHub, LanguageTool) sont
autorisées en `connect-src`. `style-src` est strict (`'self'` uniquement,
sans `'unsafe-inline'`) : le projet n'utilise plus d'attributs `style=""` en
ligne (retirés au profit des classes utilitaires `u-*`/`gate-*`, voir
conventions du projet) — la protection contre les injections de script comme
de style est donc stricte des deux côtés. Si une future dépendance ou un futur appel réseau externe est ajouté
au projet, il faudra penser à l'ajouter à `_headers`, sans quoi le navigateur
le bloquera silencieusement (vérifier la console en cas de bouton qui ne
répond plus après une modification).

**Cas vécu (v7.13.0 → v7.16.0)** : le chargeur d'`odf-kit` avait été ajouté en
`<script type="module">` **inline** directement dans `index.html`. `script-src`
n'autorisant pas l'inline (volontairement, voir plus haut), ce script était
bloqué silencieusement depuis son introduction — l'export/import ODT ne
fonctionnait donc pas, sans qu'aucune erreur ne soit visible ailleurs que dans
la console du navigateur. Corrigé en déplaçant le script dans un fichier
externe `js/odf-loader.js` (couvert par `'self'`), sans toucher à `_headers`.
**Leçon** : tout nouveau `<script>` doit être un fichier externe, jamais du
code écrit directement dans `index.html` — même quelques lignes.

## Versioning

Le projet suit un versioning sémantique (v6.0.0, v6.0.1, v6.1.0...).
Chaque mise à jour doit :
- mettre à jour le numéro affiché en bas à droite de l'éditeur (`index.html`, `#mode-bar`) ;
- bumper le nom du cache dans `sw.js` (`const CACHE = 'plume-epique-vX.Y.Z'`).

## Historique des corrections majeures

- **Mode Focus** : ne perd plus le gras/italique/souligné.
- **Mise en forme riche** dans la barre d'outils : Gras, Italique, Souligné, Titre, Paragraphe.
- **Faille XSS corrigée** partout via DOMPurify.
- **Chiffrement renforcé** : PBKDF2 à 310 000 itérations.
- **Gist GitHub explicitement privé.**
- **IA gratuite** via Worker Cloudflare + Mistral (aucune carte bancaire requise).
- **Suppression et réorganisation des chapitres**, avec historique de versions indexé par
  ID stable de chapitre (survit aux suppressions/réorganisations).
- **Service Worker réel** avec cache hors-ligne complet (fichiers locaux + librairies CDN)
  et **notification de mise à jour** (bannière "Nouvelle version disponible", plus
  d'activation silencieuse).
- **Mémoire narrative** : la navigation vers un chapitre source utilise désormais l'ID
  stable du chapitre (et non plus sa position), donc reste fiable même après suppression
  ou réorganisation.
- **Recherche globale étendue** aux personnages, lieux et quêtes (plus seulement les
  chapitres).
- **Sprint d'écriture persistant** : survit à un rechargement de page ou une fermeture
  accidentelle de l'onglet.
- **Confirmation ajoutée** avant le bouton "Nettoyer" (suppression des surlignages).
- **Diff amélioré** : comparaison de versions par algorithme LCS (détecte les vrais
  ajouts/suppressions de mots, plus fiable que la simple différence d'ensembles).
- **Accessibilité clavier** pour le drag & drop des onglets (Alt+←/→ une fois un onglet
  sélectionné au clavier).

Les versions ci-dessous sont classées de la plus récente à la plus ancienne.

### v7.16.2

- **Troisième et dernier correctif sur l'export ODT** (après la v7.16.0 et la v7.16.1),
  cette fois dans `toXhtmlSafe()` (`export-format-utils.js`, anciennement `sync.js` —
  renommé en v7.24.0, ce fichier n'a jamais géré la synchronisation cloud, qui vit dans
  router.js), fonction partagée par l'export ODT et
  l'export EPUB. Bug reproduit et confirmé de façon isolée (avec génération réelle d'un
  fichier `.odt`, relu ensuite par `odf-kit` lui-même pour valider le contenu) : la fonction
  retirait l'enveloppe technique `<div>` ajoutée pour l'analyse via un simple remplacement de
  texte (`.replace(/^<div>|<\/div>$/g, '')`), qui suppose que la balise ouvrante sérialisée
  est exactement `<div>` sans attribut. Or `XMLSerializer` ajoute légitimement un attribut
  `xmlns="..."` sur l'élément racine d'une sérialisation isolée (comportement standard des
  navigateurs, pas un bug) : la balise ouvrante réelle devenait `<div xmlns="...">`, que le
  remplacement de texte ne reconnaissait plus. Elle restait donc dans la sortie sans être
  refermée, ce qui faisait échouer l'analyseur XML strict d'`odf-kit` dès le premier chapitre
  (message `parseXml: unclosed elements: <div>`). Corrigé en sérialisant chaque élément de
  contenu individuellement plutôt que l'enveloppe entière.

### v7.16.1

- **Second correctif sur l'export/import ODT**, révélé une fois le blocage CSP de la
  v7.16.0 levé : la version d'`odf-kit` pinée (0.9.2) n'avait pas encore le sous-chemin
  `odt-reader` (ajouté seulement en 0.9.8) — l'import échouait en réalité depuis la toute
  première mise en place de cette fonctionnalité (v7.13.0), simplement masqué jusqu'ici par
  le blocage CSP. Version bumpée vers 0.13.10 (signatures `htmlToOdt`/`odtToHtml` inchangées,
  vérifiées directement dans le paquet npm avant ce correctif).

### v7.16.0

- **Correction d'un bug de fuseau horaire** dans la statistique « Série en cours »
  (`computeWritingStreak()`) : pour tout fuseau horaire en avance sur UTC (Europe, Asie...),
  la série de jours consécutifs d'écriture pouvait être sous-comptée d'exactement un jour.
  Bug détecté par les tests automatisés ci-dessous, jamais visible en développement (fuseau
  UTC). `getWordsInLastNDays()` avait le même défaut, également corrigé.
- **Correction de l'export/import ODT** : le petit script de chargement d'`odf-kit` était
  un script inline dans `index.html`, bloqué silencieusement par la Content Security Policy
  (`script-src` n'autorise pas l'inline, volontairement). Déplacé dans un fichier externe
  `js/odf-loader.js`, chargé depuis `'self'` — aucun assouplissement de la CSP n'a été
  nécessaire.
- **Tests automatisés étendus** (`tests/test-runner.html`) : fonctions pures de `stats.js`
  (`computeWritingStreak`, `computeBestWritingHour`, `getWordsInLastNDays`), `formatRelativeDate()`
  de `library.js`, et la logique de navigation par onglets (`toggleTab`, `activateSubtab`,
  `openTabOrSubtab`, association sous-onglet → catégorie).
- **Nettoyage** du champ `db.autoGistInterval` (par manuscrit), devenu un vestige inutilisé
  depuis la v7.14.0 (remplacé par `libsettings.autoGistInterval`, par profil, qui seul est
  encore lu par l'application).

### v7.15.0

- **Réorganisation finale du panneau Système & Sauvegardes** (compte GitHub, sauvegarde
  auto de toute la bibliothèque, manuscrit sélectionné, bibliothèque entière).
- **Export PDF** du manuscrit (via jsPDF), en plus de DOCX/ODT/EPUB/JSON.
- Correction CSS : l'overlay du panneau Système avait été omis de la règle commune à tous
  les overlays modaux.

### v7.14.0

- **Vérification du token GitHub** avant toute tentative de sauvegarde (bouton "Vérifier"),
  suite à un retour utilisateur : aucun moyen auparavant de confirmer qu'un token collé
  était valide avant d'en avoir réellement besoin.

### v7.13.0 (Lot 10)

- **Panneau "Système & Sauvegardes"** généralisé à toute la bibliothèque (et non plus à un
  seul manuscrit) : sauvegarde Gist automatique programmable par profil, export/import JSON
  de toute la bibliothèque en une fois.
- **Export ODT**, et généralisation de l'import DOCX/ODT vers un nouveau manuscrit ou un
  chapitre d'un manuscrit existant.

### v7.12.0 (Lot 9)

- **Import DOCX** (via mammoth.js) vers un nouveau manuscrit ou un chapitre d'un manuscrit
  existant.
- **Sauvegarde Gist automatique programmée** (intervalle configurable).
- **Statistiques avancées** : série de jours consécutifs d'écriture, meilleur moment de la
  journée pour écrire.

### v7.11.0 (Lot 7)

- **Bibliothèque en vue Étagère** (dos de livres colorés, hauteur proportionnelle au nombre
  de mots), en alternative à la vue Grille existante.

### v7.10.0 (Lot 6)

- **Vue "Fiches"** pour les chapitres (façon tableau de liège), en alternative à la liste
  latérale classique — toujours réinitialisée sur "Liste" à l'ouverture d'un manuscrit.

### v7.9.0

- **Couverture personnalisable par manuscrit** (10 palettes dédiées + option Automatique).
- **Objectif de mots** pour le manuscrit entier, avec barre de progression sur la carte
  bibliothèque.

### v7.8.1

- Menu contextuel des chapitres (⋮) repositionné en élément unique `position:fixed`, pour
  ne plus être rogné par l'`overflow` de la sidebar.

### v7.8.0

- **Tags libres** sur les chapitres, en complément du statut fixe (Brouillon / À revoir / Final).

### v7.7.0

- **Apparence personnalisable** : palette de couleurs, thème papier, police d'écriture.

### v7.5.0

- **Aide-mémoire des raccourcis clavier** (touche `?`).
- **Confirmation avant de fermer/recharger l'onglet** s'il reste des modifications non
  encore sauvegardées.

### v7.4.0

- **Regroupement des anciens onglets en 7 catégories** (Univers, IA & Mémoire, Analyse,
  Système...), avec sous-navigation dédiée par catégorie.
- **Barre d'outils regroupée en menus déroulants** (¶ Paragraphe / 🛠️ Outils / 🔎 Rechercher).

### v7.2.0

- **Bibliothèque multi-manuscrits** : chaque profil peut désormais contenir plusieurs
  romans, avec migration automatique de l'ancien roman unique vers le premier manuscrit.

### v7.1.0

- Correction de navigation : un clic programmatique (lien personnage/lieu/quête, recherche
  globale) rouvre désormais toujours l'onglet ciblé, même s'il était déjà actif.

### v7.0.0

- **Système multi-profils** — voir section dédiée plus haut. Écran de connexion,
  profils étanches (chiffrement par profil), administration (ajout / renommage /
  suppression), gestion de son propre profil, récupération par question de
  sécurité et par code de récupération téléchargeable en PDF, et migration
  automatique des données existantes vers le profil administrateur.
- Le stockage passe d'une clé unique (`main`) à un index de profils (`profiles`)
  plus une entrée chiffrée par profil (`data_<id>`).

### v6.2.0

- **Content Security Policy** (`_headers`) — voir section dédiée plus haut.
- **Corbeille des chapitres supprimés** : la suppression d'un chapitre le déplace
  désormais vers une corbeille (purge automatique après 30 jours) au lieu de l'effacer
  immédiatement et définitivement.
- **Mode lecture linéaire** : parcourir tout le roman à la suite, en lecture seule, sans
  naviguer chapitre par chapitre.
- **Export sélectif** : les exports DOCX et EPUB permettent désormais de choisir les
  chapitres à inclure, plutôt que d'exporter tout le roman systématiquement.
- **Objectifs hebdomadaire et mensuel**, en plus de l'objectif quotidien déjà existant.
- **Mode sombre par défaut selon les préférences système** à la toute première création
  d'un projet (un choix manuel ultérieur reste toujours prioritaire).

### v6.1.0

- **Tests automatisés minimaux** (`tests/test-runner.html`) sur les fonctions les plus
  sensibles du projet : migration de schéma, chiffrement AES-GCM/PBKDF2, diff LCS.
  La logique de schéma a été extraite dans `schema.js` (sans dépendance au DOM) pour
  la rendre testable indépendamment de l'application.
- **Export JSON chiffré** si le projet est chiffré (même mot de passe) — auparavant,
  l'export contenait toujours le roman en clair, même chiffrement local activé.
- **Sauvegarde GitHub Gist chiffrée** dans les mêmes conditions (même correction que
  ci-dessus, appliquée à la sauvegarde cloud).
- **Historique des révisions du Gist** consultable et restaurable (GitHub conserve déjà
  automatiquement chaque révision d'un gist — fonctionnalité exposée dans l'app).
- **Compteur de mots par chapitre** visible directement dans la sidebar.
- **Rechercher/remplacer** dans l'éditeur.
- **Dupliquer un chapitre**.
- **Export EPUB** (en plus de DOCX/JSON).
- **Statut par chapitre** (Brouillon / À revoir / Final), visible dans la sidebar et
  modifiable depuis l'éditeur.

## Limites connues

- Les tests couvrent les fonctions les plus critiques (schéma, chiffrement, diff), pas
  l'ensemble de l'application (pas de tests d'intégration UI).
- Le rechercher/remplacer ne traite pas les occurrences qui chevauchent une limite de
  mise en forme (ex. un mot moitié en gras, moitié non) — cas rare, à corriger manuellement.
- `style-src` de la CSP est strict (`'self'` uniquement) depuis que les attributs
  `style=""` en ligne ont été retirés du projet — aucune protection réduite sur ce point.
- Section bande dessinée / ouvrages illustrés : pas commencée. Nécessitera une structure
  de données séparée (ex. `db.comicPages`) plutôt qu'une réutilisation du modèle de
  chapitres texte, et une nouvelle version de schéma (`SCHEMA_VERSION` → 7).
