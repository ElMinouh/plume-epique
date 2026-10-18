# Suivi de remédiation — audit cohérence globale et excellence systémique n°9 (octobre 2026)

Base : v9.84.1. Document d'origine : `Audit-09` (rapport `.docx` + `.csv`, hors dépôt, dans `Claude outputs/Audit-09/`). 16 constats réels + 1 observation de couverture (1 élevée, 11 moyennes, 4 faibles), note 71/100, niveau 4 Production. Tous à traiter (décision du 18/10/2026). Protocole par lot : voir `CLAUDE.md`.

| Lot | Version | Constats | Contenu | Statut |
|---|---|---|---|---|
| 1 | 9.84.1 (inchangée) | 006, 007, 016, 017 | `docs/PRODUIT.md`, `docs/RISQUES.md`, contradictions documentaires corrigées, CLAUDE.md allégé (un seul protocole), test de cohérence `lot-aud09-1-gouvernance.test.js` | livré |
| 2 | 9.84.1 (inchangée) | 001 | Parcours navigateur Playwright + axe-core (6 scénarios, `tests/e2e/`, `npm run e2e`), étape CI ; les 6 passent au rouge sans le correctif 9.84.1 ; axe : aucune violation sur 3 écrans | livré |
| 3 | 9.85.0 | 002, 003 | Registre `DOC_TYPES` (`schema.js`) interrogé par Ctrl+S/Z/Y/E/F, ouverture, déconnexion, rafraîchissement ; 18 comparaisons de type remplacées ; Ctrl+F cherche dans les pages du roman graphique (plantage reproduit par parcours navigateur avant correctif) ; tests `lot-aud09-3-registre-types.test.js` | livré |
| 4 | 9.87.0 | 004, 015 | Socle commun du roman graphique (thème, aide, raccourcis) | à valider |
| 5 | 9.88.0 | 005, 012, 013, 014 | Vocabulaire « projet », erreurs, icône étincelles, nom | à valider |
| 6 | 9.89.0 | 008, 009 | « Rester connecté », correcteur orthographique | à valider |
| 7 | 9.90.0 | 010, 011 | Périphérie (visite, plugins), architecture | à valider |

Décisions du propriétaire : rotation de la clé de synchro refusée (12/10/2026), maintenue le 18/10/2026 (`docs/RISQUES.md`).
