# Plume Épique

Application web d'aide à l'écriture de romans, avec un module de **romans graphiques / livres illustrés**.
100 % côté client, **chiffrement local** (AES-GCM), multi-profils, synchronisation multi-appareils optionnelle
(Cloudflare Workers + D1), PWA installable. Déployée sur Cloudflare Pages : <https://plume-epique.pages.dev>.

> Version courante : voir `APP_VERSION` dans `js/router.js` (et `CACHE` dans `sw.js`, toujours identiques). Ce README
> décrit la **v9.76.0**. Ancien README (historique des versions jusqu'à la v9.1.1) : [`docs/HISTORIQUE.md`](docs/HISTORIQUE.md).

## Documentation

| Document | Contenu |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Architecture, conventions, règles de travail (lots, versions, tests locaux, mise à jour du README) |
| [`docs/EXPLOITATION.md`](docs/EXPLOITATION.md) | Déployer, revenir en arrière, restaurer, changer la clé de synchro, quotas, journaux |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Choix d'architecture importants et leurs raisons |
| [`docs/BILAN-AUDIT-01.md`](docs/BILAN-AUDIT-01.md) | Bilan de remédiation de l'audit technique d'octobre 2026 (28 constats) |
| [`docs/BILAN-AUDIT-02.md`](docs/BILAN-AUDIT-02.md) | Bilan de remédiation de l'audit fonctionnel d'octobre 2026 (22 constats, v9.33.0 → v9.39.0) |
| [`docs/BILAN-AUDIT-04.md`](docs/BILAN-AUDIT-04.md) | Suivi de remédiation de l'audit graphique / direction artistique d'octobre 2026 (30 constats, en cours) |
| [`docs/BILAN-AUDIT-07.md`](docs/BILAN-AUDIT-07.md) | Suivi de remédiation de l'audit performances / scalabilité / résilience d'octobre 2026 (22 constats, en cours) |
| [`docs/BILAN-AUDIT-03.md`](docs/BILAN-AUDIT-03.md) | Bilan de remédiation de l'audit ergonomique (UX) d'octobre 2026 (36 constats, v9.41.0 → v9.48.0) |
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
- **Cohérence** (v9.44.0) : plus aucune boîte native du navigateur (confirmations, saisie des tags/du nom de profil et notices passent par les fenêtres de l'application) ; « Accueil » supprimé (c'était une déconnexion) : la déconnexion enregistre d'abord, sans message inexact ; vocabulaire unifié (« version », « jeton d'accès GitHub », « sauvegarde GitHub ») ; formulaires d'accueil : Entrée valide, règle du mot de passe visible, erreur liée au champ.
- **Export et sauvegardes** (v9.45.0) : « Exporter ce chapitre / le manuscrit » dans le menu Outils de l'éditeur et **Ctrl+E** ; le ⋮ d'une carte de la bibliothèque ouvre directement l'export ; le panneau **Système** a trois onglets (Fichiers · Sauvegarde GitHub · Synchronisation) et une seule liste de manuscrits ; le ⋮ des chapitres et des manuscrits est toujours visible et le clic droit ouvre le même menu.
- **Volet latéral et sprint** (v9.46.0) : les onglets (Univers, IA, Analyse, Système, Config) s'ouvrent dans un **volet à droite du texte**, de largeur réglable (poignée ou flèches, mémorisée par appareil), fermé par ✕, Échap ou le même onglet ; sur téléphone il passe en plein écran avec « Retour au texte » ; le sprint s'affiche en pied de page (⏱ mm:ss · +mots), se lance depuis le menu Outils, et sa fin est annoncée.
- **Confort d'écriture** (v9.47.0) : barre d'outils regroupée (**Structure**, **Focus** direct, Outils, Rechercher, ✨ Mots) ; invite « Commencez à écrire ici… » et curseur dans le chapitre vide ; réglage **Largeur du texte** (Config, 72 caractères par défaut) ; filtre de chapitres (dès 8 chapitres) ; curseur « Tension du chapitre : n/100 » ; pied de page regroupé (✔ Enregistré · ☁ Synchronisé ou Local seulement) ; **❔ Aide** unique (premiers pas, visite guidée, confidentialité et IA, raccourcis) et seulement 5 icônes ⓘ.
- **Plus de faux conflit entre deux appareils** (v9.52.1) : l'historique automatique, la position du curseur et les statistiques d'écriture ne comptent plus comme « modifié ici » quand Plume arbitre une divergence de synchro (empreinte « cœur » `_cfp`, `plume_synccfp_*`). Un appareil resté ouvert qui n'a ajouté qu'un instantané reprend simplement la version de l'autre ; un vrai changement de texte des deux côtés reste un conflit.
- **Plus de perte silencieuse à l'ouverture d'un manuscrit** (v9.53.1) : quand un autre appareil a écrit entre-temps, Plume recharge la version la plus récente dans l'éditeur (message « sa version la plus récente est chargée ») au lieu de laisser l'ancien texte en mémoire — auparavant, la frappe suivante repartait avec un numéro de version à jour et le serveur effaçait la phrase de l'autre appareil sans conflit. Avec des frappes non encore enregistrées, rien n'est remplacé : c'est un conflit à arbitrer (Système). La base commune de l'arbitrage n'est plus modifiée par une simple lecture du serveur (seulement après un envoi accepté ou une adoption réelle). L'indicateur du pied de page affiche **« En attente d'envoi »** (et la bibliothèque « Envoi en attente ») tant qu'un envoi différé n'est pas parti ; « Synchronisé » ne veut plus dire que « le dernier échange a réussi ».
- **Confort de lecture** (v9.63.0, AUD-05-014/015) : dans Config, interligne (normal / confortable / large), espacement des lettres et des mots (normal / élargi), correction orthographique du navigateur (désactivée par défaut) et police **Atkinson Hyperlegible** (lettres conçues pour être distinguées, embarquée dans `vendor/fonts/`) ; réglages propres à l'appareil, appliqués à l'écriture, au mode Focus et au mode Lecture. Menu Structure → « Langue du passage… » entoure la sélection d'un `<span lang>` (lecteurs d'écran : bonne voix pour un dialogue en anglais ou une citation latine).
- **Graphiques lisibles sans la vue** (v9.62.0, AUD-05-008/009) : chaque graphique (session, dialogue/narration, tension, nuage de mots) a un nom qui résume ses données et un tableau « Afficher les données » (`setChartAlt`, `notifications.js`) ; le graphe des relations a une liste textuelle équivalente (une ligne par élément avec ses relations), des nœuds focalisables et nommés, et son nom s'affiche aussi au focus clavier.
- **Contours de champs et petits écrans** (v9.61.0, AUD-05-007/018) : jeton `--border-strong` (≥ 3:1 sur toute surface et sur le remplissage du champ, par thème ; écran de connexion inclus) pour les champs de saisie, vérifié par `lot38-contours-champs.test.js` ; à 320 px (zoom 400 %) la ligne titre/notes/statut du chapitre et la barre du roman graphique passent à la ligne au lieu de déborder (mesuré en navigateur : aucun défilement horizontal en bibliothèque, éditeur, volet latéral, roman graphique, fenêtres).
- **Roman graphique au clavier** (v9.60.0, AUD-05-010/011) : chaque vignette de page a un bouton de sélection nommé (« Page 3 sur 8 », page affichée signalée) ; Alt+↑ / Alt+↓ déplacent la page et le focus la suit ; les boutons monter/descendre apparaissent aussi au survol et au focus (plus seulement au tactile) ; le texte alternatif saisi pour une image est appliqué au rendu et l'EPUB décrit chaque page (alts des images + texte des bulles).
- **États, annonces et structure** (v9.59.0, AUD-05-005/012/006) : l'état choisi des sélecteurs de réglages (thème, palette, police, taille, vues) est exposé par `aria-pressed` / `aria-checked` (recopie centrale de `.active`) ; nombre de résultats de recherche et état de synchro en `role="status"` ; un titre de niveau 1 par écran (connexion, bibliothèque, éditeur, roman graphique), des titres de section dans l'éditeur et un lien « Aller au contenu » en tête de page (Tab depuis le haut).
- **Fenêtres accessibles** (v9.58.0, AUD-05-003/004/016) : un gestionnaire central (`notifications.js`) rend le focus au déclencheur à la fermeture de chaque fenêtre modale et rend le reste de la page inerte tant qu'elle est ouverte ; les 3 fenêtres sans nom (connexion, recherche, Focus) en ont un ; les messages temporaires se mettent aussi en pause au focus clavier.
- **Champs de formulaire accessibles** (v9.57.0, AUD-05-001/002) : chaque champ a un nom accessible (`label for` ou `aria-label`) sur les écrans de connexion, de création/récupération de profil et dans tous les panneaux ; `lot34-formulaires-accessibles.test.js` échoue si un champ perd son nom (placeholder et title ne comptent pas).
- **États, impression et contraste** (v9.56.0) : états vides accompagnés (icône, titre, phrase d'aide) dans Univers, chronologie, corbeilles, versions et historiques ; pastilles d'état par jetons de rôle ET par forme (chapitre : anneau / demi-disque / disque plein ; synchro : rond / losange / carré), lisibles sans la couleur ; impression propre (Ctrl+P : seul le texte du chapitre, ou tout le manuscrit en mode Lecture, noir sur blanc en Literata) ; mode contraste forcé de Windows et préférence « contraste renforcé » pris en charge ; un test interdit toute nouvelle teinte d'état en dur. Limite : rendu non vérifié sur iOS / Android réels.
- **Composition et modules** (v9.55.0) : barre d'outils, titre, notes et texte alignés sur la même colonne ; roman graphique au même langage d'état que le reste (accent unique, cibles agrandies) ; étagère aux couleurs du thème (chêne en clair et papier, bleu nuit en sombre) dont les dos s'élargissent pour afficher le titre ; rappel de sauvegarde GitHub en pastille discrète, affiché après 7 jours d'usage et masqué sur téléphone ; modes Focus et Lecture qui suivent le thème et la largeur de colonne.
- **Typographie et mouvement** (v9.54.0) : polices embarquées (Literata pour l'écriture, Inter pour l'interface, OFL, sous-ensemble latin, ~150 Ko, précachées hors-ligne) — « Literata » remplace Palatino comme police d'écriture par défaut (bascule unique, Palatino reste au choix) ; échelle de 9 tailles, 3 poids (400 / 500 / 600) et 4 interlignes, aucune valeur libre ; fenêtres modales et volet latéral à entrée animée (une courbe, trois durées) ; changement de thème sans état intermédiaire (v9.54.1 : filet de sécurité si l'onglet est en arrière-plan).
- **Faux conflits et envois fantômes corrigés** (v9.53.2) : le thème, la palette et la police sont propres à chaque appareil mais étaient réécrits dans le manuscrit à chaque ouverture ; ils comptaient comme « modifié ici » et deux appareils aux préférences différentes se déclaraient mutuellement en conflit sans que personne ait écrit. Ils sortent de l'empreinte « cœur » (comme l'historique, la position et les statistiques). Un envoi différé programmé avant l'adoption d'une version distante est annulé (il repartait avec l'ancienne copie et écrasait la version adoptée), et « En attente d'envoi » ne compte plus les clés déjà adoptées ni celles en pause de conflit. **Mettre à jour tous les appareils** : pendant la transition, un manuscrit écrit par une ancienne et une nouvelle version peut encore signaler un conflit par prudence.
- **Marque et thèmes** (v9.53.0) : palette par défaut « Marine & Or » (couleurs du logo ; l'ancienne « Rouge & Violet » reste au choix et bascule une seule fois pour les profils qui l'avaient par défaut) ; logo et nom « Plume » dans l'en-tête de l'éditeur ; thème clair ivoire chaud (plus de dégradé bleu) ; surfaces à trois niveaux (fond < cartes < menus et fenêtres) pour les trois thèmes ; couleur de thème du navigateur qui suit le thème ; code de récupération en blocs de 4 ; logo vectoriel `icons/plume.svg` (les PNG d'installation sont inchangés).
- **Icônes vectorielles, suite** (v9.52.0) : les gabarits générés en JavaScript (onglets du volet sans chevron, bibliothèque, roman graphique, connexion, assistant IA, chronologie, pastilles de couverture…) utilisent `icon('nom')` ; les messages, titres de visites guidées et noms de plugins perdent leur emoji ; chaque message temporaire porte une icône selon son type (succès / erreur / information). Un test échoue si un emoji réapparaît dans `js/*.js`.
- **Icônes vectorielles** (v9.51.0, 1re partie) : les emojis de l'interface statique (`index.html` : onglets du volet, barre d'outils, panneaux, bibliothèque, pied de page) sont remplacés par un sprite d'icônes à trait fin (`lucide-static`, licence ISC, version figée) qui suit le thème, la palette et la couleur des boutons ; helper `icon('nom')` dans `js/icons.js` ; le sprite se régénère par `node scripts/build-icons.cjs`. Suite (gabarits JS, visites guidées, messages) en v9.52.0.
- **Jetons, rôles et boutons** (v9.50.0) : échelles uniques (3 rayons + pastille, 4 niveaux d'ombre, 1 voile de modale, 3 durées) ; couleurs par rôle (`--danger-solid`, `--title`…) ; titres en or profond (clair/papier) ou or clair (sombre), l'accent de la palette ne désignant plus que l'action ; boutons à variantes `btn-secondary` / `btn-ghost` / `btn-danger` / `btn-warn` (plus aucune couleur de fond posée à la main), barre d'outils neutre, état actif en fond teinté ; anneau de focus clavier, sélection, barres de défilement et `color-scheme` aux couleurs du thème ; 14 classes utilitaires qui n'avaient jamais été définies le sont enfin.
- **Corrections graphiques** (v9.49.0) : vue Fiches (fond crème conservé, seul le liseré indique le statut) ; palettes d'accent et couvertures de manuscrit à contraste vérifié par test (≥ 4,5:1 avec le texte blanc, texte d'accent adapté au thème) ; bouton « Bibliothèque » mobile au style de l'application.
- **Apparence, bibliothèque et liens** (v9.48.0) : thème, palette et police d'écriture sont des **préférences du profil, par appareil** (appliquées dès la connexion, réglage clair/sombre du système par défaut, non synchronisées) ; en-tête de la bibliothèque réduit à Système · Compte ▾ · Aide ▾ ; roman graphique : libellés sur les icônes, un seul bouton « Exporter ▾ » ; liens entre fiches avec **relation nommée** (« frère de »), affichée dans le graphe.
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
npm test            # Vitest : ~1000 tests (client, Workers sur une vraie base SQLite, intégration à deux appareils)
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
npx wrangler dev -c worker/wrangler-sync.toml --local --persist-to .wrangler-test --port 8787 --var SYNC_KEY:test-key-local-12345 --var "CORS_EXTRA:http://localhost:*"
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
(comparaison à temps constant, freinage des essais), liste blanche de clés, tailles bornées, CORS limité à l'application (v9.64.0), version minimale du client (426), journaux sans contenu. Serrure par profil (v9.65.0) : chaque profil a un jeton dérivé de sa clé de données, la clé de synchro seule n'ouvre plus les données d'un profil verrouillé ; quotas par profil ; liste des profils protégée (v9.65.1 : rôle administrateur fixé côté serveur) ; mots de passe triviaux refusés et coût de dérivation versionné (v9.66.0, format p2 écrit après activation en deux temps). Worker IA : jeton DÉRIVÉ de la clé de synchro (le relais ne détient plus la clé), erreurs génériques. Le site ne publie plus `docs/`, `worker/`, `tests/`, `CLAUDE.md`… (404).
Limites connues et choix assumés (question secrète conservée, clé de synchronisation commune à tous les profils d'un
foyer, etc.) : `docs/DECISIONS.md`.

## Limites connues

- **Chargement et hors ligne** (v9.76.0, AUD-07-004/005/006) : d3, Chart.js, JSZip, jsPDF, html2canvas et mammoth ne sont plus chargés au démarrage (64 % des octets du premier chargement) mais à la première utilisation (`ensureLib`, table `VENDOR_LIBS` dans `schema.js`) ; ils restent précachés, donc disponibles hors ligne ; le graphique de tension apparaît quelques dizaines de millisecondes après l'ouverture d'un manuscrit, le temps de charger Chart.js. Les fichiers de `vendor/` sont servis avec `Cache-Control: immutable` et par le service worker sans revalidation (leur nom porte la version). Le précache du service worker est tolérant : un fichier en échec n'empêche plus les autres, la liste des manquants est affichée dans Système (« Hors ligne : prêt / incomplet ») et retentée au retour du réseau.
- **Coût de la frappe et de l'enregistrement** (v9.75.0, AUD-07-002/003) : le nombre de mots est mis en cache par chapitre (`chapterWordCount`, `chaptersTotalWords`, `schema.js`) : une frappe ne recompte que le chapitre modifié (0,1 ms au lieu de 7 à 18 ms pour 150 000 à 400 000 mots, mesuré dans Chrome 152) ; la conversion base64 de l'enveloppe chiffrée utilise `Uint8Array.toBase64` / `fromBase64` quand le navigateur les offre (chaîne produite identique à l'ancien chemin, qui reste en repli) : enveloppe de 150 000 mots en 10 ms au lieu de 24 ms, de 400 000 mots en 26 ms au lieu de 67 ms. Un chapitre de 50 000 mots coûte environ 1 ms par frappe : aucun correctif nécessaire.
- **Quotas du serveur et relais IA** (v9.74.0, AUD-07-007/015) : l'occupation (octets, nombre de clés par profil, images) est tenue par des compteurs mis à jour dans la transaction de chaque écriture (table `sync_totals`) au lieu d'un balayage de tous les morceaux ; un compteur ne peut jamais refuser seul (recomptage avant tout 507) ; la migration est automatique à la première requête après le déploiement. Le relais IA plafonne les appels à 200 par profil et par jour (variable `AI_DAILY_LIMIT`, compteur dans D1, ignoré s'il est indisponible), coupe un fournisseur qui ne répond pas en 25 s (504) et retente UNE fois après 2 s sur 429/503 ; un appel refusé par le fournisseur ne compte pas.
- **Écritures évitées** (v9.73.0, AUD-07-009/010) : l'index de la bibliothèque (date de modification, nombre de mots et de chapitres) n'est plus réécrit à chaque enregistrement du texte : il l'est à l'ouverture, tout de suite si le titre/l'objectif/la vignette changent, au plus toutes les 5 minutes d'écriture et à la sortie (retour à la bibliothèque, déconnexion, masquage ou fermeture de la page) ; un plantage brutal peut laisser la date ou le nombre de mots en retard jusqu'à la prochaine ouverture. La sauvegarde GitHub automatique n'envoie plus un manuscrit identique à celui de la dernière sauvegarde réussie (le bouton manuel envoie toujours) et la date de dernière sauvegarde est propre à l'appareil (plus dans l'index synchronisé).
- **Fiabilité des échanges réseau** (v9.72.0, AUD-07-011/012/020) : le rafraîchissement de fond d'un manuscrit déjà présent en local annonce la version connue et le serveur répond 304 sans corps si rien n'a changé (au lieu de renvoyer tout le manuscrit) ; le délai d'un envoi est de 30 s + 10 s par Mo (plus de 30 s fixes) ; la lecture du corps des réponses de synchro (manuscrits, images) a elle aussi un délai maximal (40 s, 120 s pour une image). Les flux de l'IA ne sont pas bornés. Pas d'envoi par morceaux reprenables : un envoi interrompu repart de zéro.
- **Poids d'un manuscrit et synchronisation** (v9.71.0, AUD-07-001) : l'historique des versions voyage dans le manuscrit ; les copies AUTOMATIQUES d'un chapitre (ou d'une page de roman graphique) sont plafonnées à 2 Mo au total (les plus anciennes tombent d'abord, la plus récente et toutes les copies manuelles sont gardées). Le serveur refuse un envoi de plus de 20 Mio : au-delà de 19 Mio le client n'envoie plus rien et affiche un message fixe « trop volumineux pour la synchronisation » (une fois par manuscrit et par session) ; le manuscrit reste enregistré sur l'appareil. Si un manuscrit s'approchait vraiment de cette limite, la sortie de l'historique du document (table locale non synchronisée) est prévue — voir `docs/DECISIONS.md`.
- **Détection** (v9.70.0) : une sonde `/health` publique, les erreurs JavaScript du navigateur signalées au serveur (synchronisation activée seulement, sans contenu), une alerte quotidienne de quota D1 (courriel GitHub à 80 %) et une sauvegarde chiffrée de la base à lancer à la main (`scripts/sauvegarder-d1.cjs`, dossier hors dépôt) : voir `docs/EXPLOITATION.md` §13. Aucune supervision externe n'est branchée tant que le propriétaire n'a pas créé le moniteur (UptimeRobot).
- **Surveillance** (v9.69.0) : le serveur de synchro tient un registre des événements de sécurité (30 jours, sans IP ni contenu) à consulter avec `node scripts/evenements-securite.cjs` ; il n'envoie **aucune alerte** automatique. Les bibliothèques de `vendor/` sont protégées par des empreintes (`vendor/SHA256SUMS`, test et CI).
- **Vie privée** (v9.68.0) : l'IA (Google Gemini), le correcteur (LanguageTool) et la dictée vocale ne partent qu'avec l'accord du profil (écran Accepter / Refuser, réglable dans Mon profil) ; une page « Politique de confidentialité » est dans l'aide. Les titres des manuscrits, leurs nombres de mots et dates, les prénoms des profils et la question de sécurité ne sont **pas chiffrés** sur le serveur (chiffrement des titres étudié puis annulé, `docs/BILAN-AUDIT-06.md`).
- **Imports** (v9.67.0) : un .docx/.odt est refusé au-delà de 300 Mo (ou 3 Go une fois décompressé), une bibliothèque JSON au-delà de 900 Mo (au-delà de ≈ 500 Mo, le navigateur peut échouer à la lire de lui-même) ; message avec la taille et un conseil.
- **Session en clair** : « Rester connecté » garde la clé de données dans le navigateur de l'appareil (risque assumé, `docs/DECISIONS.md` n°37).
- **Langue d'un passage** : l'indication `lang` est conservée dans le manuscrit, le mode Lecture et l'export EPUB, **pas** dans l'export DOCX/ODT/PDF ; elle ne s'applique qu'à l'intérieur d'un seul paragraphe.
- **Accessibilité** : audit AUD-05 traité de bout en bout (voir `docs/BILAN-AUDIT-05.md`) ; aucun test avec un lecteur d'écran réel n'a été fait (NVDA, VoiceOver, TalkBack) — à réaliser par une personne qui l'utilise au quotidien.

- Le quota d'écritures de la base D1 gratuite (100 000 lignes/jour) est **partagé par tout le compte Cloudflare** ;
  la limite de la base est de 500 Mo (dont 350 Mo réservés aux images). Un manuscrit à la corbeille garde sa place
  30 jours. Voir `docs/EXPLOITATION.md`.
- Une suppression **définitive** (fin des 30 jours ou « Définitif ») est propagée à tous les appareils et efface le
  contenu chiffré du serveur ; la seule trace récupérable est la sauvegarde de 7 jours de la base D1 (Time Travel).
- **Un profil supprimé** disparaît de tous les appareils et ses données sont **effacées du serveur** (v9.68.0 : opération dédiée, réservée à l'administrateur, vérifiée par le Worker) ; la sauvegarde du serveur (Time Travel) les garde 7 jours puis elles disparaissent. Hors ligne, l'effacement est retenté à la connexion suivante de l'administrateur.
- Le contrôle d'incohérences « tout le roman » compare des faits extraits chapitre par chapitre ; sur un roman très long, la
  comparaison se fait par groupes de chapitres consécutifs et une contradiction entre deux groupes peut échapper (signalé à l'écran).
- La date d'une chronologie est un texte libre : le tri automatique se fait selon l'ordre des chapitres, pas selon la date.
- **Dépendances** : les bibliothèques servies par le site sont dans `vendor/` (Dependabot ne les propose plus (config du 06/10/2026 : mensuel, outils de test et actions regroupés) : les mettre à jour à la main une fois par trimestre — `npm outdated`, `npm audit`, notes de version —, méthode dans `vendor/LISEZMOI.md` . Les alertes de sécurité Dependabot sont activées sur le dépôt (depuis le 06/10/2026 ; une alerte ouverte sur `sprintf-js`, voir `vendor/LISEZMOI.md`) ; les mises à jour de sécurité automatiques restent désactivées). `docx` est en 9.8.1 depuis la v9.40.0 et **n'est chargé qu'à la première demande d'export DOCX** (1,2 Mo : il alourdissait chaque démarrage ; il reste précaché par le service worker, donc l'export marche hors ligne). `npm audit` signale 3 alertes modérées sur `mammoth` (outil en ligne de commande, absent du fichier servi) : sans effet sur le site (alerte fermée sur GitHub le 06/10/2026).
- Un appareil **dont la session est restaurée sans mot de passe** n'a pas la clé des données : il ne peut pas comparer les empreintes, donc traite toute divergence avec prudence (conflit signalé). Ouvrir un manuscrit avant la première synchro réussie peut ainsi le marquer « modifié ici ».
- La question secrète de récupération est une porte plus faible que le mot de passe (décision documentée).
- Pas de test automatisé en navigateur réel : les parcours complets sont vérifiés à la main sur copie locale.
