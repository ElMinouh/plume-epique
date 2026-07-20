# Plume Épique Studio — V56

Outil d'aide et de suivi d'écriture (roman). Application 100% cliente (aucun serveur requis),
stockage local chiffré (IndexedDB), déployable sur Cloudflare Pages.

## Structure du projet

```
plume-epique-studio/
├── index.html          → structure de la page
├── css/
│   └── style.css       → tous les styles
├── js/
│   ├── router.js        → état global, sauvegarde, bootstrap de l'appli
│   ├── pwa.js            → manifeste + service worker (installation en app)
│   ├── crypto.js         → chiffrement AES-GCM du projet
│   ├── notifications.js  → messages toast, indicateur de sauvegarde
│   ├── editor.js         → chapitres, éditeur, mode focus, mise en forme
│   ├── tabs.js           → onglets (ouverture, réordonnancement)
│   ├── panels.js         → recherche globale, synonymes/antonymes
│   ├── ai.js             → appels IA (résumé, continuation, incohérences, noms)
│   ├── snapshots.js       → historique des versions par chapitre
│   ├── diff.js            → comparaison de versions
│   ├── stats.js           → statistiques quotidiennes + sprint d'écriture
│   ├── readability.js     → analyse Flesch-Kincaid, dialogue/narration
│   ├── relations.js       → graphe relationnel (D3)
│   ├── timeline.js        → chronologie des événements
│   ├── tts.js             → lecture vocale + dictée
│   ├── wordcloud.js       → nuage de mots-clés
│   ├── pluginSystem.js    → plugins (grammaire, répétitions, synopsis...)
│   ├── sync.js            → export DOCX/JSON, sauvegarde GitHub Gist
│   ├── database.js        → personnages, lieux, quêtes, liens
│   └── memory.js          → mémoire narrative (recherche + questions IA)
└── README.md
```

## Corrections apportées en V56 (audit)

- **Mode Focus** : ne perd plus le gras/italique/souligné (zone désormais éditable
  en HTML riche au lieu d'être convertie en texte brut).
- **Mise en forme riche** ajoutée dans la barre d'outils : Gras, Italique, Souligné, Titre, Paragraphe.
- **Faille XSS corrigée** : tous les textes utilisateur (noms de personnages, lieux,
  quêtes, mots-clés) passent désormais systématiquement par DOMPurify avant insertion.
- **Chiffrement renforcé** : PBKDF2 passé de 100 000 à 310 000 itérations.
- **Gist GitHub explicitement privé** lors de la sauvegarde cloud.
- **Avertissement ajouté** sur l'écran de verrouillage : un mot de passe perdu rend les données illisibles.

## Limites connues (non corrigées dans cette passe, à traiter ensuite)

- Pas encore de suppression / réorganisation des chapitres.
- Le cache hors-ligne (PWA) ne couvre que la page, pas les bibliothèques externes (Chart.js, D3...) :
  l'app ne fonctionnera pas hors-ligne tant que ce point n'est pas traité.
- Les fonctionnalités IA (`ai.js`, `panels.js` synonymes, `memory.js`, `pluginSystem.js` synopsis)
  appellent directement `api.anthropic.com` sans clé API : elles ne fonctionnent que si ce
  logiciel reste utilisé comme Artifact Claude. Pour un usage 100% autonome sur Cloudflare,
  il faudra un petit backend relais qui détient la clé API (à discuter si besoin).
- Chronologie/historique indexés par position de chapitre (pas d'identifiant stable) :
  à revoir avant d'ajouter la suppression de chapitres.
