# Suivi de remédiation — audit qualité perçue et finition premium n°8 (octobre 2026)

Base : v9.79.0. Document d'origine : `Audit-08` (rapport `.docx` + `.csv`, hors dépôt, dans `Claude outputs/Audit-08/`). 24 constats réels + 1 observation, note 67/100 (niveau Professionnel), plan en 5 lots. Protocole par lot : voir `CLAUDE.md`.

| Lot | Version | Constats | Contenu | Statut |
|---|---|---|---|---|
| 1 | 9.80.0 → 9.80.1 | 002, 003, 004, 005, 006, 013, 023 | « Aujourd'hui » depuis la première ouverture du jour (`db.dayStart`), « Cette séance » conservé ; graphique « mots par jour » en écarts ; compteur de la ligne du chapitre en direct ; plus de « ... » dans Univers ; onglet Mémoire corrigé (icône, accents) ; pluriels `plur()` ; glyphes Unicode et anglicismes remplacés (icônes `merge`, `copy`, `rotate-ccw`…) | livré (9.80.1 : la tuile « Cette séance » tenait sur trois lignes, corrigée) |
| 2 | 9.81.0 | 008, 009, 010, 011, 012, 019 | Sélecteur de vue en une ligne ; « Nouveau projet » partout et titres par défaut numérotés ; icônes `rows-3` (étagère) et `compass` (visite complète) ; bouton de thème = cible du clic (Clair / Sombre) ; onglet de l'éditeur « Système » renommé « Versions » ; titre d'onglet « Manuscrit — Plume » sans numéro de version | livré |
| 3 | 9.82.0 | 007, 020, 021, 022 | à venir | à valider |
| 4 | 9.83.0 | 014, 015, 016, 017 | à venir | à valider |
| 5 | 9.84.0 | 001, 018, 024 | à venir | à valider |

AUD-08-025 : tests avec de vraies personnes, appareils réels, lecteurs d'écran — hors code.
Tests : `tests/vitest/lot-aud08-1-finition.test.js`.
