# Suivi de remédiation — audit qualité perçue et finition premium n°8 (octobre 2026)

Base : v9.79.0. Document d'origine : `Audit-08` (rapport `.docx` + `.csv`, hors dépôt, dans `Claude outputs/Audit-08/`). 24 constats réels + 1 observation, note 67/100 (niveau Professionnel), plan en 5 lots. Protocole par lot : voir `CLAUDE.md`.

| Lot | Version | Constats | Contenu | Statut |
|---|---|---|---|---|
| 1 | 9.80.0 → 9.80.1 | 002, 003, 004, 005, 006, 013, 023 | « Aujourd'hui » depuis la première ouverture du jour (`db.dayStart`), « Cette séance » conservé ; graphique « mots par jour » en écarts ; compteur de la ligne du chapitre en direct ; plus de « ... » dans Univers ; onglet Mémoire corrigé (icône, accents) ; pluriels `plur()` ; glyphes Unicode et anglicismes remplacés (icônes `merge`, `copy`, `rotate-ccw`…) | livré (9.80.1 : la tuile « Cette séance » tenait sur trois lignes, corrigée) |
| 2 | 9.81.0 | 008, 009, 010, 011, 012, 019 | Sélecteur de vue en une ligne ; « Nouveau projet » partout et titres par défaut numérotés ; icônes `rows-3` (étagère) et `compass` (visite complète) ; bouton de thème = cible du clic (Clair / Sombre) ; onglet de l'éditeur « Système » renommé « Versions » ; titre d'onglet « Manuscrit — Plume » sans numéro de version | livré |
| 3 | 9.82.0 → 9.82.1 | 007, 020, 021, 022 | « Rechercher » et « Mots » en icône seule (barre sur une rangée, alignement de colonne gardé), pied de page en icônes volet ouvert ; bibliothèque mobile en 2 colonnes, ⋮ à zone tactile invisible (disque de 28 px), titres sur deux lignes ; éditeur mobile : un seul bouton bibliothèque (celui de l'en-tête reste en vue Fiches), onglet « IA », dégradé de défilement de la barre ; couvertures automatiques tirées de six palettes selon l'identifiant | livré |
| 4 | 9.83.0 | 014, 015, 016, 017 | Erreurs lisibles (`toastError`, `messageErreurLisible`, bouton « Copier le détail ») à la place du message brut ; messages en file d'attente avec action « Annuler » (suppression d'un chapitre ou d'un manuscrit) ; message aux jetons du thème ; graphiques, graphe de relations, nuage de mots et animation vocale aux couleurs du thème (`chartPalette`), recolorés au changement de thème | livré |
| 5 | 9.84.0 → 9.84.1 | 018, 024 (001 annulé par le propriétaire le 16/10/2026) | 14 fenêtres sortent en fondu (visibility + opacity, sans changer le code d'ouverture/fermeture) ; manifeste PWA : `id`, `lang`, `categories`, raccourci « Nouveau projet » (`./?action=nouveau`, géré par `runPendingShortcut`), Service Worker tolérant à la requête hors ligne | livré |

AUD-08-001 (premier écran sans nom de produit) : **annulé** par le propriétaire le 16/10/2026 ; l'écran « Où sont vos manuscrits ? » reste tel quel (décision AUD-03-008 maintenue).

AUD-08-025 : tests avec de vraies personnes, appareils réels, lecteurs d'écran — hors code.
Tests : `tests/vitest/lot-aud08-1-finition.test.js`.

**Incident v9.84.0 (17/10/2026) :** à l'ouverture d'un document, la page était figée (tous les boutons inactifs). Cause : le fondu de sortie des fenêtres (AUD-08-018) les laisse en `display:flex` ; le détecteur de fenêtres ouvertes (`_modalVisible`, notifications.js) ne regardait que `getClientRects()` et rendait donc toute la page `inert`. Corrigé en 9.84.1 (`visibility` prise en compte + second passage à 240 ms). Leçon : un changement de CSS qui modifie l'affichage doit être testé avec un manuscrit ouvert, pas seulement la bibliothèque.
