# Suivi de remédiation — audit graphique, esthétique et direction artistique n°4 (octobre 2026)

Base : v9.48.0. Document d'origine : `Audit-04` (rapport `.docx` + `.csv`, hors dépôt, dans `Claude outputs/Audit-04/`). 30 constats (29 réels + 1 observation de couverture), note 51/100, plan en 7 lots. Protocole par lot : voir `CLAUDE.md`.

| Lot | Version | Constats | Contenu | Statut |
|---|---|---|---|---|
| 1 | 9.49.0 | 004, 008, 009, 010, 021 | Fiches : fond de statut limité à la pastille ; textes d'accent en `--accent-text`, gris de métadonnées plus foncés, jetons `--success-text` / `--danger-text` ; 5 palettes d'accent revues (texte d'accent par thème) ; 20 couvertures assombries au besoin (texte blanc ≥ 4,5:1) ; bouton Bibliothèque mobile stylé | livré |
| 2 | 9.50.0 | 029, 012, 005, 013, 006, 014 | Échelles (rayons, ombres, voile, durées) ; jetons par rôle, un seul jeu de couleurs de bouton ; titres en couleur de repère (`--title`) ; variantes de boutons et barre d'outils neutre ; états actifs teintés ; focus, sélection, scrollbars, `color-scheme` ; 14 classes utilitaires jamais définies, enfin définies | livré |
| 3a | 9.51.0 | 002, 003, 023 (partie statique) | Sprite d'icônes Lucide (98 symboles, ISC, version figée) intégré à `index.html`, `js/icons.js` (helper `icon()` et lexique), emojis et chevrons ▾ de `index.html` remplacés, placeholders et options de liste sans emoji, test de conformité du sprite | livré |
| 3b | 9.52.0 | 002, 003, 023 (partie dynamique) | 211 emojis des 17 fichiers JS : gabarits en `icon()` (onglets sans chevron, quêtes par type de projet, chronologie, couvertures, roman graphique, connexion), messages / titres de visites / plugins sans emoji, icône par type de toast ; test « aucun emoji dans js/*.js » | livré |
| 4 | 9.53.0 | 001, 007, 018, 022, 030 | Palette « Marine & Or » par défaut (bascule unique de l'ancien défaut), marque dans l'en-tête, thème clair ivoire, surfaces à 3 niveaux (`--glass` / `--surface-2`), `theme-color` dynamique, code de récupération en grille, logo `icons/plume.svg` (reproduction à valider ; PNG d'installation inchangés) | livré |
| 5 | — | 016, 015 | Typographie embarquée, mouvement | à venir |
| 6 | — | 017, 019, 011, 020, 026 | Composition, roman graphique, étagère, rappel, modes Focus/Lecture | à venir |
| 7 | — | 024, 025, 027, 028 | États vides, pastilles, impression, zones non vues | à venir |

Note lot 1 : les couvertures claires (glacier, coucher de soleil, rose poudré, corail, or…) sont plus profondes qu'avant ; c'est le prix d'un titre blanc lisible. Test : `tests/vitest/lot27-corrections-graphiques.test.js`.
