# Bilan de remédiation — audit de sécurité avancé n°6 (octobre 2026)

Base : v9.63.2 (note 55/100, maturité « Correcte »). Documents d'origine : `Claude outputs/Audit-06/` (non versionné) —
rapport `.docx`, liste `.csv`, preuve rejouable `poc-verification-worker.mjs`. Plan : 7 lots, 23 constats.

| Lot | Constats | État |
|---|---|---|
| 1 | 012, 013 | étape A livrée (v9.63.3) ; étape B : Worker sans repli KV prêt, déploiement après migration |
| 2 | 009, 010, 011, 022, 023 | codé en v9.64.0 (voir ci-dessous) |
| 3 | 001, 002, 017 | 3a (v9.65.0) et 3b (v9.65.1) codés |
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
  `tests/vitest/lot-aud06-1-migration-kv.test.js`. Étape B : repli KV supprimé du Worker (`d1Store.read/version`), binding `PLUME_SYNC` retiré de
  `wrangler-sync.toml`, tests mis à jour (`sync-d1.test.js`), ancien Worker figé en fixture pour tester la migration.
  Sauvegarde de KV faite le 11/10/2026 (48 clés) dans `C:SecretsPlumeackups-kvkv-backup-2026-10-11.json`.

## Lot 2 — durcissement des Workers, des en-têtes et du dépôt publié (v9.64.0)

- **009** : jeton IA dérivé (Worker IA + `js/ai.js`), `scripts/generer-cle.cjs`, `scripts/installer-jeton-ia.cjs`, règle de limitation de débit à créer dans Cloudflare (docs/EXPLOITATION.md §6 bis). **Reste à la charge du propriétaire** : poser `AI_TOKEN`, créer la règle, retirer `SYNC_KEY` du Worker IA une fois tous les appareils à jour, et adopter une clé aléatoire (rotation différée, §6).
- **010** : CORS limité à l'application (403 sinon), corps lu en flux avec plafond, erreurs du Worker IA génériques.
- **011** : `_routes.json` + `functions/_middleware.js` (404 sur docs, worker, tests, scripts, CLAUDE.md, README, package*.json).
- **022** : `report-uri`/`report-to` + `Reporting-Endpoints` vers `/csp-report`, `Cross-Origin-Resource-Policy: same-origin`. **Écart par rapport au plan annoncé** : Trusted Types en mode rapport n'est PAS activé (≈ 170 `innerHTML` généreraient des milliers de rapports et consommeraient le quota de requêtes) ; reporté au lot 5 (constat 018), une fois les `innerHTML` assainis.
- **023** : en-tête `X-Plume-Client-Version` (toutes les requêtes vers le Worker de synchro), 426 sous `MIN_CLIENT_VERSION`, bandeau de rechargement.
- Tests : `tests/vitest/lot-aud06-2-durcissement.test.js` (23).

## Lot 3a — serrure par profil et quotas (v9.65.0)

- **001 / 002** (données d'un profil) : jeton dérivé de la clé de données (`Crypto.authToken`), empreinte en D1 (`profile_auth`), contrôle sur GET/PUT/DELETE de `data_`, `doclist_`, `doc_`, `aichat_`, `libsettings_`, `img_` ; verrouillage progressif ; le scénario d'attaque de l'audit (pierre tombale forgée + DELETE) est rejoué et refusé (test). **Écart avec le plan annoncé** : pas de pierres tombales signées ni de suppression logique de 30 jours : la serrure rend la forge impossible, le filet reste D1 Time Travel (7 jours).
- **017** : quotas 150 Mo / 2 000 clés par profil, 20 profils, garde-fou global 90 % ; message dans l'application sur 507. Le plafond d'appels IA reste la règle Cloudflare du lot 2 (pas de stockage côté Worker IA).
- **3b** (v9.65.1) : index `profiles` (ajout/suppression/rôle d'un profil), création du rôle administrateur côté serveur. **Pour le lot 4** : la rotation de la clé de données change le jeton ; prévoir le remplacement de l'empreinte sur le serveur.
- Tests : `tests/vitest/lot-aud06-3a-serrure-profil.test.js` (22).

## Lot 3b — protection de l'index des profils (v9.65.1)

- Contrôle par le Worker de chaque écriture de `profiles` (comparaison à la version courante, droit par profil modifié : son jeton ou celui d'un administrateur), rôle `admin` fixé côté serveur (colonne `role` ; migration douce de la table de la 9.65.0, les administrateurs déjà verrouillés gardent leur rôle), création de profil libre en simple utilisateur (20 au plus), validation du JSON (structure, identifiants, 200 Ko). L'essai T3 de l'audit (s'ajouter administrateur) est rejoué et refusé. Message à l'écran sur refus (« droits insuffisants »).
- **Risque résiduel documenté** : un profil pas encore verrouillé reste modifiable, et le premier arrivé verrouille (un tiers pourrait prendre un profil avant son propriétaire pendant la fenêtre de mise en place : voir docs/EXPLOITATION.md §6 ter pour la réparation).
- **Hors lot 3 (suite)** : effacement serveur des données d'un profil supprimé (lot 6, AUD-06-015) ; enveloppes de clés encore visibles dans l'index (lot 4).
- Tests : `tests/vitest/lot-aud06-3b-index-profils.test.js` (17).
