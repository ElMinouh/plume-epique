# Suivi de remédiation — audit accessibilité WCAG 2.2 n°5 (octobre 2026)

Base : v9.56.0. Document d'origine : `Audit-05` (rapport `.docx` + `.csv`, hors dépôt, dans `Claude outputs/Audit-05/`). 18 constats (3 élevés, 12 moyens, 2 faibles, 1 observation), note 64/100, plan en 7 lots.

| Lot | Version | Constats | Contenu | Statut |
|---|---|---|---|---|
| 1 | 9.57.0 | 001, 002 (+ début 017) | `label for` sur les 16 libellés des écrans de profil ; `aria-label` sur 28 champs de index.html et 2 de la récupération ; 3 labels reliés ; test garde-fou `lot34-formulaires-accessibles.test.js` | livré |
| 2 | 9.58.0 | 003, 004, 016 | Gestionnaire central des fenêtres modales (retour du focus au déclencheur, `inert` sur le reste de la page) ; noms des fenêtres connexion / recherche / Focus ; messages en pause au focus clavier. Les fenêtres du roman graphique restituaient déjà le focus (`gnWireModalA11y`) : le constat 003 les visait à tort | livré |
| 3 | 9.59.0 | 005, 012, 006 | Recopie centrale `.active` → `aria-pressed` / `aria-checked` ; groupes nommés ; `role="status"` sur le nombre de résultats et l'état de synchro (l'état « Enregistré » reste muet, pour ne pas annoncer chaque sauvegarde ; l'échec passe déjà par le message `role="alert"`) ; h1 par écran, h2 de section, lien « Aller au contenu » | livré |
| 4 | 9.60.0 / 9.60.1 | 010, 011 | Bouton de sélection par vignette (focus conservé au re-rendu), Alt+↑/↓ pour déplacer, monter/descendre au survol et au focus ; `el.alt` appliqué au rendu, alt de page de l'EPUB construit depuis les alts et textes ; 9.60.1 : le focus suit aussi les boutons monter/descendre (donné d'abord au numéro de la page pour les afficher) | livré |
| 5 | 9.61.0 | 007, 018 (013 retiré) | `--border-strong` ≥ 3:1 (clair `#80776a`, papier `#80745e`, sombre et connexion `#808c9c`) sur `.field`, champs des fiches, liste et options du roman graphique ; mesure à 320 px : deux débordements réels corrigés (ligne titre/notes/statut du chapitre : 14 px ; barre du roman graphique : 224 px). **013 retiré, faux positif de l'audit** : le ⋮ est déjà visible en permanence (opacité .7, v9.45.0 AUD-03-016) et ≥ 24 px — j'avais lu une règle sans voir les surcharges postérieures | livré |
| 6 | 9.62.0 / 9.62.1 | 008, 009 | `setChartAlt` : `role="img"` + nom résumant les données + tableau « Afficher les données » pour les 3 graphiques ; nuage de mots nommé (sa liste des 15 premiers mots existait déjà, le constat était donc partiel) ; graphe des relations : liste équivalente, nœuds focalisables, nom au focus ; 9.62.1 : tableau pleine largeur (vu au test local : il était écrasé) | livré |
| 7 | 9.63.0 | 014, 015 | Police Atkinson Hyperlegible embarquée (4 fichiers, OFL) ; interligne (3 niveaux), espacement des lettres et des mots, correction orthographique du navigateur (désactivée par défaut), par appareil ; « Langue du passage… » (`<span lang>`, un seul paragraphe, conservé jusqu'à l'EPUB) | livré |

## Conclusion (2026-10-11)

7 lots livrés en 10 versions (9.57.0 → 9.63.0) pour 17 constats retenus sur 18 (013 retiré, faux positif).

Corrections apportées à l'audit lui-même pendant les lots, découvertes au code ou au test local :
- 003 : les fenêtres du roman graphique restituaient déjà le focus (`gnWireModalA11y`) ;
- 008 : le nuage de mots avait déjà sa liste textuelle ;
- 012 : « Enregistré à… » volontairement non annoncé (bruit), l'échec passe par le message `role="alert"` ;
- 013 : faux positif (le ⋮ est visible en permanence depuis la v9.45.0 et ≥ 24 px) ;
- 018 : mesuré à 320 px, deux débordements réels corrigés.

Reste à faire par une personne : un test avec un lecteur d'écran réel (NVDA/VoiceOver/TalkBack), qui ne peut pas être remplacé par les contrôles automatiques.
