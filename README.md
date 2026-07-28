# Plume — v9.1.1

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
├── .github/
│   ├── workflows/
│   │   ├── deploy-workers.yml → déploie automatiquement worker.js et sync-worker.js sur
│   │   │                          Cloudflare à chaque push (voir section dédiée plus bas) —
│   │   │                          remplace le copier-coller manuel dans le dashboard
│   │   └── test.yml            → lance `npm test` à chaque push et pull request
│   └── dependabot.yml            → alerte/PR automatique si une faille est trouvée dans une
│                                     dépendance npm ou une action utilisée par les workflows
├── worker/
│   ├── worker.js          → Worker Cloudflare relais IA (Mistral) — déployé automatiquement
│   │                          par .github/workflows/deploy-workers.yml, voir wrangler-ai.toml
│   ├── wrangler-ai.toml    → configuration de déploiement du Worker IA
│   ├── sync-worker.js      → Worker Cloudflare de synchronisation multi-appareils (KV) —
│   │                          même principe, voir section dédiée plus bas
│   └── wrangler-sync.toml  → configuration de déploiement du Worker de synchro (namespace KV)
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
│   ├── test-runner.html   → ancienne suite (héritée, gardée en secours : à ouvrir
│   │                          directement dans un navigateur, aucune installation
│   │                          requise) — remplacée comme suite de référence par
│   │                          tests/vitest/ ci-dessous (dette technique corrigée,
│   │                          voir "Tests automatisés" plus bas)
│   └── vitest/            → suite Vitest (voir `npm test`) — même couverture logique
│                              que l'ancienne suite, mais un `it()` par assertion :
│                              un échec précis et nommé, pas un compteur global à
│                              ouvrir dans un navigateur pour comprendre ce qui casse
├── package.json           → dépendances de test (`npm install` puis `npm test`)
├── vitest.config.js
└── README.md
```

## Tests automatisés

`npm install` puis `npm test` (ou `npm run test:watch` en continu). Depuis v9.1,
`.github/workflows/test.yml` relance aussi automatiquement `npm test` à chaque
push et pull request — une régression est détectée sans avoir à y penser, en
plus de l'exécution manuelle. La suite (`tests/vitest/`) charge les vrais fichiers de `js/` dans un contexte Node/jsdom
partagé (même ordre que l'ancienne `tests/test-runner.html`, voir
`tests/vitest/env.js`), et exécute le même contenu de test qu'avant
(`tests/vitest/suite.js`, porté à l'identique) — seul le harnais change : chaque
assertion devient un `it()` Vitest individuel, repéré nommément en cas d'échec,
plutôt qu'un compteur global "X/Y réussis" qu'il fallait ouvrir dans un navigateur
pour identifier lequel avait échoué. `tests/test-runner.html` reste disponible en
secours (utile sans Node/npm), mais `tests/vitest/` est désormais la suite de
référence.

`tests/vitest/sync.test.js` couvre en plus, séparément (fetch mocké, contexte
jsdom isolé), la logique de synchro réelle de `router.js` : `syncPush`,
`syncPull`, `persistData`, `loadData`, `getKnownRemoteHash` (envoi réussi, envoi
échoué, conflit détecté entre appareils).


## Intelligence artificielle

Les fonctionnalités IA (résumé, continuation, incohérences, noms, synonymes/antonymes,
synopsis, mémoire narrative) passent par un Worker Cloudflare relais
(`plume-epique-ai.air7841.workers.dev`) qui appelle l'API **Mistral AI**
(`mistral-large-latest`) avec une clé secrète côté serveur, jamais exposée au navigateur.
`ai.js` ne dépend que d'un format de réponse interne normalisé (`{content:[{type:'text',
text}]}`) — changer de fournisseur IA à l'avenir ne nécessite de modifier que
`worker/worker.js`, jamais `ai.js` ni ses appelants.

Depuis la v8.0.3, la réponse est relayée en flux (Server-Sent Events) plutôt
qu'attendue en bloc : le texte s'affiche mot par mot au fur et à mesure de sa
génération par Mistral, au lieu d'apparaître d'un coup à la fin.

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

Un envoi qui échoue (hors-ligne, Worker temporairement injoignable) est
mémorisé dans une file d'attente persistée (survit à une fermeture d'onglet)
et retenté automatiquement en arrière-plan, avec un délai croissant (10s,
1min, 5min) — sans attendre la prochaine écriture ou connexion sur cet
élément précis.

### Versionnage (v8.1.0)

Chaque clé porte un numéro de version croissant, attribué par le Worker et
stocké dans les métadonnées KV. Toute écriture annonce la version sur
laquelle elle se base (`X-Plume-Base-Version`) ; le Worker la refuse (409)
si elle ne correspond pas à la version stockée. Le client relit alors,
réconcilie, et repart de la bonne base. Toute lecture n'est appliquée en
local que si son numéro est **strictement** supérieur à celui de la copie
locale.

Sans ce numéro, la synchronisation ne savait comparer que « identique » ou
« différent », jamais « plus récent » — c'est la cause racine de l'incident
du 27/07/2026 (voir Historique).

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

### Déploiement des Workers (automatisé depuis v9.0)

Les deux Workers (`worker.js` et `sync-worker.js`) se déploient désormais
automatiquement via GitHub Actions (`.github/workflows/deploy-workers.yml`,
Wrangler) à chaque push touchant `worker/**` — le copier-coller manuel dans le
dashboard Cloudflare ("Quick Edit") n'est plus utilisé et ne doit plus l'être :
le dépôt est la seule source de vérité, ce qui est écrit dans ces fichiers est
garanti être ce qui tourne réellement en ligne.

Configuration nécessaire (déjà en place, à titre de référence si un jour un
nouveau compte Cloudflare doit être relié) :
1. Secrets GitHub du dépôt (Settings → Secrets and variables → Actions) :
   `CLOUDFLARE_API_TOKEN` (jeton avec permission "Edit Cloudflare Workers") et
   `CLOUDFLARE_ACCOUNT_ID`.
2. `worker/wrangler-sync.toml` déclare le binding KV `PLUME_SYNC` (nom fixe,
   ne pas modifier — c'est celui utilisé dans le code) avec l'ID du namespace
   KV réel (non secret, visible dans le dashboard Cloudflare → Workers & Pages
   → Storage & Databases → KV).
3. Les secrets applicatifs (`SYNC_KEY`, `MISTRAL_API_KEY`) restent configurés
   côté Cloudflare (Worker → Variables and Secrets) — ils ne se déclarent
   jamais dans les fichiers du dépôt, et un déploiement Wrangler ne les touche
   pas.

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

Convention de bump (sauf demande explicite contraire) :
- **patch** (x.x.N) : ajustement ciblé (un bug, un détail visuel isolé) ;
- **minor** (x.N.0) : un écran ou un lot complet validé, ou un correctif critique ;
- **major** (N.0.0) : refonte importante.

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

### v9.1.1 — accessibilité clavier

Test manuel de navigation 100% au clavier (menus, fenêtres, visite guidée) :
deux bugs trouvés et corrigés. Échap ne fermait que 14 fenêtres sur 20 (il
manquait "Mon profil", "Gérer les profils", le panneau Système bibliothèque,
le chat IA, les notes de chapitre, la modale de confirmation, et les menus
déroulants de la barre d'outils). Aucun piège de focus n'existait : Tab
pouvait faire sortir le focus d'une fenêtre ouverte vers la page derrière —
corrigé par un mécanisme générique basé sur `role="dialog"`, qui protège
automatiquement toute fenêtre actuelle et future sans rien à modifier ailleurs.

### v9.1.0 — bibliothèque mobile

Grille de la bibliothèque compactée sur mobile (3 colonnes au lieu d'une
seule pleine largeur ; 2 manuscrits max visibles auparavant). Bouton menu (⋮)
conservé à 44×44 de zone tactile malgré la carte étroite (padding autour d'une
icône plus petite, pas un agrandissement visuel réel).

### v9.0.0 – v9.0.2 — visites guidées (bugs Android)

- Bulles de tour à largeur fixe pouvant déborder sur téléphone étroit —
  largeur désormais plafonnée à l'écran.
- Bulle "Visite complète" : hauteur supposée fixe (160px) pour décider du
  placement au-dessus/en dessous de la cible, alors qu'elle varie avec la
  longueur du texte — débordait en bas d'écran sur les étapes au texte long.
  Hauteur réelle mesurée désormais.
- Visite bibliothèque et étape "Synonymes & antonymes" : cibles cachées
  derrière un menu replié sur mobile (⋯, ✨▾), sautées en cascade jusqu'à la
  fin faute d'être jamais visibles.
- **Bug de propagation de clic (Android uniquement)** : sur un clic tactile
  réel, "Suivant" remontait (bubbling) jusqu'à `document`, où des écouteurs
  déjà existants ("fermer tout menu au clic extérieur") refermaient aussitôt
  le menu que la visite venait d'ouvrir dans ce même clic — avant même que la
  résolution de cible ne s'exécute. Invisible sur PC (le chemin concerné n'y
  est jamais emprunté). Corrigé par `e.stopPropagation()` sur les boutons de
  navigation de la visite.
- Onglet "Config" restant ouvert à la fin de la visite complète — restaure
  désormais l'onglet actif d'avant son lancement.
- Bouton "📚 retour bibliothèque" toujours visible sur mobile, entre le titre
  du manuscrit et le bouton ☰ (jusqu'ici accessible seulement une fois le
  panneau chapitres déplié).

### v8.1.1 – v8.1.4 — Chantier Responsive Mobile

Tous les écrans passés en revue et corrigés pour mobile (audit + maquette
validée avant chaque implémentation) : panneaux "Mon profil"/"Gérer les
profils", les 5 sous-onglets d'Univers (Personnages/Lieux/Quêtes/Chronologie/
Relations — dont un bug réel : la fiche de détail pouvait être coupée sous la
liste, cadre bloqué à la hauteur de l'écran), IA & Mémoire, Analyse, Système
(dont le panneau Historique des versions, affiché en 2 colonnes fixes même
sur mobile, empilées verticalement depuis), Config/Sprint, et les visites
guidées/aide contextuelle. Cibles tactiles portées à ~44px partout.

### Infrastructure (v9.0 – v9.1)

- **Déploiement automatique des Workers** via GitHub Actions + Wrangler —
  voir section dédiée plus haut. Élimine le risque de divergence entre le
  fichier de référence du dépôt et le code réellement déployé (identifié
  comme dette technique après l'incident v8.1.0 ci-dessous).
- **Tests automatiques** à chaque push/pull request (`.github/workflows/test.yml`).
- **Dependabot** actif (dépendances npm + actions GitHub), avec une exception
  documentée : les mises à jour majeures de `jsdom` sont ignorées tant que
  jsdom 30.x embarque une version cassée d'`undici` (`TypeError:
  webidl.util.markAsUncloneable is not a function`, sans rapport avec le
  code de l'app).

### v8.1.0 — perte de profils par synchronisation (incident du 27/07/2026)

**Symptôme.** Tous les profils sauf le plus ancien ont disparu simultanément
sur tous les appareils, y compris côté serveur. Sur l'appareil observé, les
profils s'affichaient quelques secondes avant de disparaître.

**Cause racine.** La synchronisation n'avait aucune notion de « plus
récent ». Elle ne comparait que des empreintes : « identique » ou
« différent ». Face à deux versions différentes d'une même donnée, elle était
donc structurellement incapable de choisir la bonne, et retenait simplement
la dernière écrite. Deux conséquences, toutes deux constatées :

1. `syncPushEntireLibrary()` (appelée à **chaque** connexion, y compris les
   connexions automatiques via « rester connecté ») repoussait la copie
   locale de l'index des profils. Depuis un appareil resté en arrière, cette
   écriture écrasait la version à jour du serveur — donc celle de tous les
   autres appareils.
2. Cette écriture locale incrémentait `_localWriteVersion`, ce qui **annulait**
   la mise à jour entrante que `loadData()` était en train de récupérer.
   L'appareil en retard ne pouvait donc même pas apprendre qu'il l'était : il
   restait périmé indéfiniment tout en imposant sa version aux autres.

Les correctifs antérieurs (v7.27.0, v7.40.3, v7.42.2) traitaient les
symptômes de ce défaut en tentant de deviner quelle version était la bonne,
sans jamais donner au système le moyen de le savoir.

**Correctif.** Numéro de version croissant attribué par le Worker, avec refus
serveur des écritures périmées (voir « Versionnage » plus haut). S'y ajoutent
trois garde-fous indépendants :

- l'index des profils ne peut jamais rétrécir par synchronisation
  (`mergeProfilesIndex`) : une version entrante ne peut qu'ajouter ou mettre
  à jour des profils, jamais en retirer ;
- l'écran « premier administrateur » n'est plus affiché lorsqu'une clé de
  synchronisation est configurée et que le serveur n'a pas pu confirmer
  l'absence de profils — c'est cet écran qui remplaçait l'index entier
  (`profiles = [nouveau]`) et provoquait les créations de comptes en cascade ;
- `endSetupTour()` (library.js) réécrivait l'index entier hors du verrou :
  passe désormais par `mutateProfilesIndex()`.

Le rafraîchissement en arrière-plan était par ailleurs entièrement désactivé
sur les navigateurs sans IndexedDB : ces appareils ne recevaient jamais
aucune mise à jour tout en poussant la leur. Corrigé.

**Non-régression.** `tests/vitest/sync-versioning.test.js` rejoue le scénario
exact de l'incident en faisant tourner ensemble le vrai client et le vrai
Worker sur une base KV simulée. Le test échoue sur le code d'avant la v8.1.0
(le serveur y finit avec un seul profil) et passe après.

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

- Cohérence différée de Cloudflare KV (jusqu'à 60s de propagation entre
  régions) : le versionnage (v8.1.0) empêche d'écraser une version connue,
  mais pas de lire une version pas encore propagée. Ne concerne que le même
  appareil/profil écrivant la même donnée à quelques dizaines de secondes
  d'écart depuis deux régions différentes — jugé négligeable pour un usage
  familial (filet de sécurité déjà en place : détection par empreinte,
  sauvegarde de secours + avertissement). Migration vers D1/Durable Objects
  envisageable si une garantie absolue devenait nécessaire un jour ;
  explicitement non recommandée pour l'usage actuel (coût d'ingénierie
  disproportionné, voir discussion du 28/07/2026).
- Les tests couvrent les fonctions les plus critiques (schéma, chiffrement, diff), pas
  l'ensemble de l'application (pas de tests d'intégration UI).
- Le rechercher/remplacer ne traite pas les occurrences qui chevauchent une limite de
  mise en forme (ex. un mot moitié en gras, moitié non) — cas rare, à corriger manuellement.
- `style-src` de la CSP est strict (`'self'` uniquement) depuis que les attributs
  `style=""` en ligne ont été retirés du projet — aucune protection réduite sur ce point.
- Section bande dessinée / ouvrages illustrés : pas commencée. Nécessitera une structure
  de données séparée (ex. `db.comicPages`) plutôt qu'une réutilisation du modèle de
  chapitres texte, et une nouvelle version de schéma (`SCHEMA_VERSION` → 7).
