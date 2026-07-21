# Plume Épique Studio — v6.2.0

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
│   └── worker.js          → Worker Cloudflare relais IA (Mistral) — édité manuellement
│                             dans le dashboard Cloudflare, ce fichier sert de référence
├── css/
│   └── style.css         → tous les styles
├── js/
│   ├── schema.js           → schéma de données, migrations, ID de chapitre (sans DOM,
│   │                          testable indépendamment — voir tests/test-runner.html)
│   ├── router.js            → état global, sauvegarde, bootstrap de l'appli
│   ├── pwa.js                → installation PWA + notification de mise à jour du SW
│   ├── crypto.js              → chiffrement AES-GCM du projet
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
│   ├── sync.js                        → export DOCX/JSON (chiffré si projet chiffré)/EPUB,
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

## Sécurité — Content Security Policy

Depuis la v6.2.0, un fichier `_headers` à la racine (reconnu automatiquement par
Cloudflare Pages, aucune configuration dashboard requise) applique une CSP en
défense en profondeur contre le XSS : seuls les CDN réellement utilisés
(jsDelivr, unpkg, d3js.org) peuvent charger du JavaScript, et seules les
destinations réseau connues du projet (Worker IA, GitHub, LanguageTool) sont
autorisées en `connect-src`. `style-src` inclut `'unsafe-inline'` car le projet
utilise des attributs `style=""` en ligne dans tout `index.html` — un choix
d'implémentation existant, pas une régression introduite par la CSP ; la
protection principale contre le XSS (l'exécution de script) reste, elle,
stricte. Si une future dépendance ou un futur appel réseau externe est ajouté
au projet, il faudra penser à l'ajouter à `_headers`, sans quoi le navigateur
le bloquera silencieusement (vérifier la console en cas de bouton qui ne
répond plus après une modification).

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

## Limites connues

- Les tests couvrent les fonctions les plus critiques (schéma, chiffrement, diff), pas
  l'ensemble de l'application (pas de tests d'intégration UI).
- Le rechercher/remplacer ne traite pas les occurrences qui chevauchent une limite de
  mise en forme (ex. un mot moitié en gras, moitié non) — cas rare, à corriger manuellement.
- `style-src` de la CSP inclut `'unsafe-inline'` (nécessaire vu l'usage d'attributs
  `style=""` en ligne dans tout le projet) — protection réduite contre les attaques par
  injection de style pur, sans rapport avec l'exécution de script.
- Nom interne de la base IndexedDB toujours `plume_v55` (résidu historique du tout
  premier fichier, aucun impact utilisateur).
- Section bande dessinée / ouvrages illustrés : pas commencée. Nécessitera une structure
  de données séparée (ex. `db.comicPages`) plutôt qu'une réutilisation du modèle de
  chapitres texte, et une nouvelle version de schéma (`SCHEMA_VERSION` → 7).
