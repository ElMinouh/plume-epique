# Suivi de remédiation — audit n°7 « performances, scalabilité, résilience » (octobre 2026)

Base : v9.69.0 (note 64/100, niveau 3 — Production à l'échelle familiale). Rapport d'origine : `Claude outputs/Audit-07/`
(non versionné). 22 constats `AUD-07-xxx`, traités en 9 lots.

| Lot | Constats | Statut |
|---|---|---|
| 1 Détection | 016, 008, 017, 018 | 🟢 v9.70.0 (voir ci-dessous) |
| 2 Historique borné et refus d'envoi visible | 001 | 🟢 v9.71.0 (voir ci-dessous) |
| 3 Réseau de synchro | 011, 012, 020 | 🟢 v9.72.0 (voir ci-dessous) |
| 4 Écritures évitables | 009, 010 | 🟢 v9.73.0 (voir ci-dessous) |
| 5 Worker D1 / IA | 007, 015 | 🟢 v9.74.0 (voir ci-dessous) |
| 6 CPU à la frappe | 003, 002, 022 | 🟢 v9.75.0 (voir ci-dessous) |
| 7 Chargement et cache | 004, 005, 006 | 🟢 v9.76.0 (voir ci-dessous) |
| 8 Images et export | 013, 014 | 013 🟢 v9.77.0 · 014 en cours (R2) |
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

## Lot 3 — v9.72.0

| ID | Statut | Preuve |
|---|---|---|
| 011 | 🟢 `X-Plume-Known-Version` : le Worker répond 304 sans corps ; le client ne l'envoie que pour le rafraîchissement de fond (`syncPull(key, { ifVersion: true })`), jamais pour le premier accès ni l'arbitrage de conflit | `lot-aud07-3-reseau.test.js` |
| 012 | 🟢 délai d'envoi 30 s + 10 s par Mo (`syncPushTimeoutMs`). Envoi par morceaux reprenables : non fait (décision du lot : seulement si les gros manuscrits deviennent réels) | `lot-aud07-3-reseau.test.js` |
| 020 | 🟢 `fetchWithTimeout(..., { bodyTimeout: true })` (40 s par défaut) pour syncPull et pullGraphicImage ; flux IA inchangés | `lot-aud07-3-reseau.test.js` |


Vérifications après le push (16/10/2026) : en ligne, `/health` 200, Worker de synchro et Worker IA 401 sans clé, pré-vérification CORS acceptant `X-Plume-Known-Version`, `sw.js` v9.72.0, CI et déploiement du Worker verts ; copie locale (Worker local 8787, application 18831, D1 jetable) : envoi du manuscrit (version 1), rafraîchissement de fond sans changement = GET 304, après écriture d'un autre appareil (version 2) = GET 200 complet puis 304. Non couvert : délai proportionnel sur une vraie liaison lente, coupure réseau en cours de lecture, deux appareils réels avec profil.

## Lot 4 — v9.73.0

| ID | Statut | Preuve |
|---|---|---|
| 009 | 🟢 empreinte du manuscrit (`gistFingerprint`, sans gistId / images déjà envoyées / compteurs) mémorisée localement après un envoi RÉUSSI ; la sauvegarde automatique saute un manuscrit inchangé, le bouton manuel envoie toujours ; `lastGistSync` hors de l'index (valeur locale `plume_gistsync_<id>`, l'ancienne valeur de l'index reste lue) | `lot-aud07-4-ecritures.test.js` |
| 010 | 🟢 variante PLUS SIMPLE que celle présentée (cache local fusionné avec l'index) : l'index garde les mêmes champs mais son écriture est différée (ouverture, donnée d'auteur, 5 min, sortie) ; `mergeDocList` et le format de l'index sont INCHANGÉS, aucune fusion nouvelle. Écart assumé : un plantage brutal peut laisser date/nombre de mots en retard jusqu'à la réouverture | `lot-aud07-4-ecritures.test.js` |

Vérifications après le push (16/10/2026) : en ligne v9.73.0 (titre, `sw.js`), console sans erreur, `/health` 200, Workers 401 sans clé, CI verte ; copie locale à deux appareils (Worker local 8787, applications 18841 et 18842, D1 jetable) : 10 enregistrements successifs = 1 seule écriture d'index locale (avant : 10), nombre de mots de l'index mis à jour à la sortie (6 puis 51), 1 PUT d'index et 1 PUT de manuscrit reçus par le serveur ; l'appareil B voit le manuscrit avec 51 mots. Non couvert : écriture continue de plus de 5 minutes, vraie sauvegarde GitHub (essayée seulement par la suite de tests avec un faux GitHub), roman graphique réel, plantage brutal du navigateur.

## Lot 5 — v9.74.0

| ID | Statut | Preuve |
|---|---|---|
| 007 | 🟢 colonne `sync_meta.bytes` + table `sync_totals` ('global', 'img', 'p:<profil>') mises à jour dans la transaction d'écriture (EXISTS sur le wid : un conflit 409 ne les touche pas) ; contrôle de quota = lecture de 1 à 2 lignes ; recomptage par balayage AVANT tout refus (un compteur gonflé ne bloque jamais) ; migration automatique et idempotente ; `__usage__` expose `counterBytes` à côté de `totalBytes` | `lot-aud07-5-quotas-ia.test.js` ; essai sur une copie de la vraie base (sauvegarde du 16/10) : 43 clés, 5 888 633 octets, compteur = balayage, écart 0 |
| 015 | 🟢 plafond quotidien par profil (200, `AI_DAILY_LIMIT`), délai de réponse de 25 s (504), une nouvelle tentative après 2 s sur 429/503, appel refusé = compteur rendu ; Worker IA lié à D1 (`wrangler-ai.toml`), en-tête `X-Plume-Profile-Id` envoyé par `ai.js` | `lot-aud07-5-quotas-ia.test.js` |

Vérifications après le push (16/10/2026) : sauvegarde chiffrée de la base faite avant le push (`plume-sync-2026-10-16.sql.enc`) ; déploiement CI des deux Workers vert ; en ligne : `/health` 200, Workers 401 sans clé, pré-vérification CORS du Worker IA acceptant `X-Plume-Profile-Id`, `sw.js` v9.74.0 ; **base de production migrée seule à la première requête** : `sync_totals` créée, compteur global 5 888 633 octets / 43 clés = balayage = somme des `bytes` (écart nul) ; copie locale sur une base ANCIENNE (Worker local 8787, application 18851) : migration au premier PUT, compteurs égaux au balayage (804 puis 302 après suppression d'une image), 409 sans effet sur les compteurs, aucune erreur 500. Non couvert : relais IA réel avec la clé Gemini (le plafond et les délais sont couverts par la suite de tests avec un faux fournisseur), plafond atteint en conditions réelles (200 appels), deux appareils avec profils.

## Lot 6 — v9.75.0

Mesures dans Chrome 152 (copie locale de l'application, textes synthétiques ; poste de développement, pas un téléphone).

| ID | Statut | Preuve |
|---|---|---|
| 003 | 🟢 cache du décompte par chapitre (WeakMap, rien n'est ajouté à l'objet enregistré) : somme sur 150 000 mots 6,8 ms → 0,1 ms ; sur 400 000 mots 18,1 ms → 0,1 ms (un chapitre modifié) | `lot-aud07-6-cpu.test.js` ; mesure navigateur |
| 002 | 🟢 PARTIEL, SUFFISANT : la conversion base64 était 97 % du coût de chiffrement ; chemin natif (`toBase64`/`fromBase64`, repli identique à l'ancien code) : enveloppe de 150 000 mots 23,6 → 10 ms, de 400 000 mots 66,8 → 25,8 ms ; chiffrements croisés ancien/natif vérifiés (mêmes chaînes, mêmes empreintes). Web Worker NON fait : la chaîne complète reste sous 50 ms (critère fixé) | `lot-aud07-6-cpu.test.js` ; mesure navigateur |
| 022 | 🟢 mesuré, aucun correctif : par frappe, 0,1 ms (8 000 mots), 1,1 ms (50 000 mots), 3,6 ms (100 000 mots) | mesure navigateur |

Incident évité : le nom `manuscriptWordCount` existait déjà dans `library.js` (autre signature) et masquait la nouvelle fonction ; les tests de l'index (nombre de mots à 0) l'ont révélé avant livraison. Nouveau nom : `chaptersTotalWords`.

Vérifications après le push (16/10/2026) : CI verte ; en ligne v9.75.0 (titre, `sw.js`), console sans erreur, `/health` 200, Workers 401 sans clé ; copie locale à deux appareils (Worker local 8787, applications 18871 et 18872, D1 jetable) : l'appareil A enregistre un manuscrit de 905 mots (chiffrement natif) et l'envoie ; l'appareil B le lit et le déchiffre, avec le chemin natif puis avec un navigateur simulé SANS conversion native : 905 mots, accents intacts, index à 905 mots, aucune erreur 500. Non couvert : téléphone ou navigateur réellement ancien (Firefox < 133, Safari < 18.2, Chrome < 140 : repli testé par simulation seulement), manuscrits de plus de 400 000 mots.

## Lot 7 — v9.76.0

| ID | Statut | Preuve |
|---|---|---|
| 004 | 🟢 six librairies chargées à la demande (`ensureLib`, `VENDOR_LIBS`) : au démarrage ne restent que DOMPurify, idb et file-saver (+ les modules ODF) ; mesuré dans Chrome avec la CSP réelle : aucune des six au chargement, chacune se charge en 8 à 62 ms au premier usage et fonctionne (ZIP, PDF, d3, Chart, mammoth, html2canvas). Le refus d'un fichier Word trop gros reste AVANT tout chargement | `lot-aud07-7-chargement.test.js` ; mesure navigateur |
| 005 | 🟢 `/vendor/*` : `Cache-Control: public, max-age=31536000, immutable` ; le service worker sert `vendor/` depuis le cache sans revalidation. `js/` et `css/` inchangés (pas de build, donc pas d'empreinte dans le nom) | `lot-aud07-7-chargement.test.js` |
| 006 | 🟢 précache fichier par fichier (`Promise.allSettled`), liste des manquants dans `precache-status.json` (même cache), nouvelle tentative par message `RETRY_PRECACHE` (au chargement et au retour du réseau), état affiché dans Système | `lot-aud07-7-chargement.test.js` |

Vérifications après le push (16/10/2026) : CI verte ; en production, mise à jour complète du service worker observée de bout en bout dans le navigateur intégré (ancienne version → v9.76.0, rechargement automatique) : un seul cache `plume-epique-v9.76.0` (l'ancien supprimé), état du précache 61 fichiers sur 61, aucun fichier manquant, aucune des six librairies lourdes au démarrage, 37 scripts et 1,09 Mo de JavaScript décodé (avant : 42 scripts, 2,96 Mo), DOMContentLoaded 1 213 ms (avant 1 349 ms, chargement chaud), console sans erreur ; `Cache-Control: immutable` sur `/vendor/*` et `max-age=0, must-revalidate` ailleurs ; `/health` 200, Workers 401 sans clé. Copie locale (serveur de test avec la CSP réelle, Chrome) : les six librairies se chargent à la demande en 8 à 62 ms et fonctionnent (ZIP, PDF, d3, Chart, mammoth, html2canvas), un second appel ne recharge rien. Non couvert : le service worker ne peut pas s'enregistrer depuis un serveur local dans le navigateur intégré (sa mise à jour a donc été vérifiée en production, plus la suite de tests avec un faux cache) ; export réel PDF/ZIP/EPUB et import DOCX de bout en bout avec un profil ; téléphone ; échec réel du précache (simulé en tests).

## Lot 8 — 013 en v9.77.0 (014 : voir plus bas quand il sera livré)

| ID | Statut | Preuve |
|---|---|---|
| 013 | 🟢 cache d'URL d'images LRU borné à 80 Mo (révocation des URL libérées) ; canvas de page ramenés à zéro dès qu'ils ont servi ; PDF découpé en parties (budget de 120 Mo estimés par fichier : ≈ 32 pages en 300 dpi, 20 × 25 cm + 3 mm), ZIP en archives de 40 pages ; message clair après une annulation (« N fichiers déjà enregistrés »). EPUB et DOCX du roman graphique non découpés | `lot-aud07-8a-memoire.test.js` ; essai navigateur (voir ci-dessous) |

Vérifications après le push du 013 (16/10/2026) : CI verte ; en production v9.77.0, un seul cache `plume-epique-v9.77.0`, précache 61/61, console sans erreur, plafond d'images de 80 Mo et découpage des exports présents. Copie locale (Chrome, CSP réelle, rendu des pages simulé pour la logique des parties) : un album de 5 pages passe de « 1 fichier » à « 3 fichiers » quand la taille de partie est forcée à 2 pages (message explicite) ; export ZIP de 45 pages → 2 archives (`…-partie-1-sur-2.zip`, `…-partie-2-sur-2.zip`), de 12 pages → 1 archive au nom inchangé, de 85 pages annulé après 44 pages → « 1 archive déjà enregistrée ». Non couvert : mesure du pic de mémoire sur une vraie tablette avec 100 pages illustrées, noms de fichiers PDF des parties dans le navigateur (vérifiés par la suite de tests, pas par un téléchargement réel), EPUB/DOCX du roman graphique (non découpés).
