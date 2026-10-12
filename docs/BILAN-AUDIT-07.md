# Suivi de remédiation — audit n°7 « performances, scalabilité, résilience » (octobre 2026)

Base : v9.69.0 (note 64/100, niveau 3 — Production à l'échelle familiale). Rapport d'origine : `Claude outputs/Audit-07/`
(non versionné). 22 constats `AUD-07-xxx`, traités en 9 lots.

| Lot | Constats | Statut |
|---|---|---|
| 1 Détection | 016, 008, 017, 018 | 🟢 v9.70.0 (voir ci-dessous) |
| 2 Historique hors du manuscrit | 001 | à faire |
| 3 Réseau de synchro | 011, 012, 020 | à faire |
| 4 Écritures évitables | 009, 010 | à faire |
| 5 Worker D1 / IA | 007, 015 | à faire |
| 6 CPU à la frappe | 003, 002, 022 | à faire |
| 7 Chargement et cache | 004, 005, 006 | à faire |
| 8 Images et export | 013, 014 | à faire |
| 9 Budgets CI et décisions | 019, 021 | à faire |

## Lot 1 — v9.70.0

| ID | Statut | Preuve |
|---|---|---|
| 016 | 🟢 erreurs navigateur (`js/pwa.js` → `/client-error`), sonde `/health` ; reste à créer le moniteur externe (UptimeRobot) | `lot-aud07-1-detection.test.js` |
| 008 | 🟢 alerte quotidienne à 80 % sur tout le compte (workflow + script). Mesure du 12/10 : horizon-poi 27 023 lignes écrites/24 h, Plume 277 | `lot-aud07-1-detection.test.js`, exécution réelle du script |
| 017 | 🟢 sauvegarde chiffrée hors dépôt, RPO/RTO écrits, exercice de restauration fait le 12/10/2026. **Décision** : dépôt public ⇒ aucun artefact GitHub | `lot-aud07-1-sauvegarde.test.js`, exercice réel |
| 018 | 🟡 partiel : essai local 1 → 19,5 Mio OK, 21 Mio refusé (413) ; plafond CPU du plan gratuit non éprouvé en production | `docs/EXPLOITATION.md` §13 |
