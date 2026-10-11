# Bilan de remédiation — audit de sécurité avancé n°6 (octobre 2026)

Base : v9.63.2 (note 55/100, maturité « Correcte »). Documents d'origine : `Claude outputs/Audit-06/` (non versionné) —
rapport `.docx`, liste `.csv`, preuve rejouable `poc-verification-worker.mjs`. Plan : 7 lots, 23 constats.

| Lot | Constats | État |
|---|---|---|
| 1 | 012, 013 | en cours (étape A livrée en v9.63.3 ; étape B = Worker sans repli KV) |
| 2 | 009, 010, 011, 022, 023 | à faire |
| 3 | 001, 002, 017 | à faire |
| 4 | 003, 004, 006, 007 | à faire |
| 5 | 005, 018, 019, 021 | à faire |
| 6 | 008, 014, 015 | à faire (dépend du lot 3) |
| 7 | 016, 020 | à faire |

## Lot 1 — secrets d'exploitation et effacement réel

- **AUD-06-012** : `CLE-DE-SYNCHRONISATION-NE-PAS-PARTAGER.txt` et `backups-kv/` déplacés le 11/10/2026 de
  `…\OneDrive\Desktop\Plume` vers `C:\Secrets\Plume\`. **Reste à la charge du propriétaire (décision du 11/10/2026 : non
  fait)** : changer la clé de synchronisation et purger les anciennes versions OneDrive ; tant que ce n'est pas fait, la clé
  est à considérer comme exposée (la rotation est prévue avec la séparation des clés IA/synchro du lot 2).
- **AUD-06-013** : `scripts/migrer-kv-vers-d1.cjs` (essai à blanc, `--appliquer`, `--vider-kv --confirmer`), testé par
  `tests/vitest/lot-aud06-1-migration-kv.test.js`. Étape B (après exécution du script, accord explicite requis pour le
  déploiement) : suppression du repli KV dans le Worker.
