# Suivi de remédiation — audit n°7 « performances, scalabilité, résilience » (octobre 2026)

Base : v9.69.0 (note 64/100, niveau 3 — Production à l'échelle familiale). Rapport d'origine : `Claude outputs/Audit-07/`
(non versionné). 22 constats `AUD-07-xxx`, traités en 9 lots.

| Lot | Constats | Statut |
|---|---|---|
| 1 Détection | 016, 008, 017, 018 | 🟢 v9.70.0 (voir ci-dessous) |
| 2 Historique borné et refus d'envoi visible | 001 | 🟢 v9.71.0 (voir ci-dessous) |
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

### Reste à faire côté propriétaire (lot 1)
1. **Jeton Cloudflare de la CI** : le premier lancement du workflow `Surveillance du quota D1` (12/10/2026) a échoué avec « Authentication error [code: 10000] » : le jeton `CLOUDFLARE_API_TOKEN` n'a pas le droit de LISTER les bases D1. Dashboard → Mon profil → Jetons d'API → modifier le jeton → ajouter *Compte › D1 › Lecture* (ou Modifier), puis relancer le workflow (onglet Actions › Run workflow). Tant que ce n'est pas fait, le workflow échoue chaque jour (courriel d'échec).
2. **Moniteur de disponibilité** : créer un moniteur HTTP gratuit (UptimeRobot) sur `https://plume-epique-sync.air7841.workers.dev/health`, mot-clé `"ok":true`, intervalle 5 min, alerte par courriel.
3. **Phrase secrète de sauvegarde** : copier `C:\Secrets\Plume\PASSPHRASE-SAUVEGARDE.txt` dans un gestionnaire de mots de passe ; lancer `node scripts/sauvegarder-d1.cjs` chaque semaine.

### Vérifications faites après le push (12/10/2026)
- En ligne : `/health` 200 `{"ok":true}` ; `/client-error` 204 (origine de l'application) et 403 (origine étrangère) ; Worker IA 401 sans clé ; clé publique `?key=profiles` 401 ; `sw.js` = v9.70.0 ; application v9.70.0, aucune erreur console.
- Copie locale (Worker local port 8787, application port 18811, D1 jetable) : sans clé de synchro aucune émission ; avec clé, une erreur non interceptée et un rejet de promesse arrivent au Worker (après pré-vérification CORS) et sont consignés (`client_error`, `Chrome`) ; `__security__` les compte.
- Non couvert : tests avec un vrai profil et deux appareils (la synchro de manuscrits n'est pas modifiée par ce lot, couverte par la suite de tests) ; plafond CPU du plan gratuit en production ; navigateurs autres que Chrome.

## Lot 2 — v9.71.0

| ID | Statut | Preuve |
|---|---|---|
| 001 | 🟡 traité par la variante prudente validée le 12/10/2026 : plafond de 2 Mo de copies automatiques par chapitre/page (`HISTORY_MAX_AUTO_BYTES`, `thinSnapshots`), garde de 19 Mio avant envoi et message fixe sur refus 413 (`notifySyncTooLarge`). L'historique RESTE dans le manuscrit et synchronisé (la sortie vers une table locale, variante 2, est gardée en réserve : risque de migration sur la zone la plus sensible du projet, danger lointain — 457 Ko aujourd'hui pour 14 Mo de seuil). | `lot-aud07-2-historique.test.js` |


Vérifications après le push (12/10/2026) : en ligne, v9.71.0 (titre, `sw.js`), console sans erreur, CI verte ; copie locale (Worker local 8787 + application 18821, D1 jetable) : un envoi normal de 200 Ko arrive (version 1) ; un contenu de 20 Mio n'est pas envoyé (aucune requête au Worker), un seul message fixe « trop volumineux » apparaît (deux tentatives), la clé n'est pas en file de reprise ; 20 copies de 400 Ko sont ramenées à 5 (2 Mo). Non couvert : vrai manuscrit volumineux avec historique réel, deux appareils, refus 413 réel de la production.
