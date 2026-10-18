# Registre des risques acceptés et des actions ouvertes

Créé le 18/10/2026 (audit AUD-09-016). Une ligne par risque : la décision, sa date, pourquoi, et **quand on la réexamine**.
Les dates de réexamen sont proposées (trois mois) et valent tant que le propriétaire ne les change pas. Cadre : `docs/PRODUIT.md`.

## Risques acceptés

| Risque | Décision | Date | Justification | Réexamen |
|---|---|---|---|---|
| Question secrète conservée : réponse devinable, enveloppe attaquable hors ligne (AUD-06-003) | Accepté, coût de dérivation relevé | 12/10/2026 | Commodité de récupération pour un usage familial (`DECISIONS` n°3) | 18/01/2027 |
| Session « Rester connecté » : clé de données et clé de synchro en clair dans `localStorage` (AUD-06-005) | Accepté ; depuis la v9.88.0 le risque est dit à l'écran (avertissement + confirmation à partir de 7 jours) | 12/10/2026 | Commodité ; appareil personnel supposé (`DECISIONS` n°37) | 18/01/2027 |
| Pas de rotation de la clé de données (AUD-06-006) | Annulé | 12/10/2026 | Un défaut de rechiffrement peut faire perdre des manuscrits ; risque jugé pire que le gain | 18/01/2027 |
| Données liées aux enveloppes sans données associées (AUD-06-007) | Annulé | 12/10/2026 | Gain faible, risque de migration | 18/01/2027 |
| Métadonnées en clair côté serveur : noms de profils, titres, statistiques (AUD-06-008) | Annulé | 12/10/2026 | Nécessaire au fonctionnement actuel de la bibliothèque | 18/01/2027 |
| **Clé de synchronisation exposée** : elle a séjourné dans un dossier synchronisé par OneDrive (versions antérieures non purgées) et **n'est pas changée** (AUD-06-012) | **Rotation refusée par le propriétaire, risque accepté ; décision en vigueur (confirmée le 18/10/2026)** | 12/10/2026 | Les données des profils sont protégées par une serrure par profil (jeton dérivé de la clé de données, v9.65.0) ; la clé seule permet surtout de lire l'annuaire des profils et de consommer les quotas | 18/01/2027 |
| Plafond CPU du plan gratuit non éprouvé en production pour les très gros contenus (AUD-07-018) | Partiellement traité (essai local 19,5 Mio OK, 21 Mio refusé) | 12/10/2026 | Un manuscrit réaliste est très en dessous | À la première erreur de synchro d'un gros manuscrit |
| Trois fichiers JS dépassent 120 Ko : `graphicnovel.js` (139 Ko), `router.js` (132 Ko), `library.js` (124 Ko). Plafond de 150 Ko vérifié par test ; découpage non fait (AUD-09-011) | Reporté | 18/10/2026 | Casse de nombreux tests qui lisent leur code source ; gain non visible tant qu'une seule personne maintient | 18/01/2027 |
| Trusted Types non activé : environ 160 `innerHTML` restent dans `js/` (AUD-06-022) | Reporté | 18/10/2026 | La CSP stricte (aucun script ni style en ligne) et DOMPurify couvrent l'essentiel ; l'activation exige d'assainir ces 160 sites | 18/01/2027 |
| Une seule personne maintient le produit | Assumé | 18/10/2026 | Projet personnel | Sans objet ; limiter la surface fonctionnelle (AUD-09-010) |

Effet cumulé à garder en tête : la clé de synchro est exposée, la clé de données peut rester en clair en session, la question
secrète est faible. Pour qu'un tiers lise des écrits, il faut cumuler l'accès au serveur ET à l'enveloppe d'un profil (ou à
l'appareil). Ce n'est pas nul, mais c'est cohérent avec un usage familial (`docs/PRODUIT.md`).

## Actions ouvertes (à la charge du propriétaire ou à vérifier)

État vérifié le 18/10/2026 quand c'est possible depuis le poste ; « non vérifiable » sinon.

| Action | Origine | État |
|---|---|---|
| Jeton Cloudflare de la CI avec droit de lire D1 | AUD-07 lot 1 | **Fait** : le workflow « Surveillance du quota D1 » réussit (exécution du 17/10/2026) |
| Moniteur de disponibilité externe (UptimeRobot) sur `/health`, mot-clé `"ok":true`, 5 min | AUD-07-016 | Non vérifiable depuis le poste : confirmer |
| Copier `C:\Secrets\Plume\PASSPHRASE-SAUVEGARDE.txt` dans un gestionnaire de mots de passe ; lancer `node scripts/sauvegarder-d1.cjs` chaque semaine | AUD-07-017 | Le fichier est présent ; la copie dans le gestionnaire est non vérifiable : confirmer |
| Purger les anciennes versions OneDrive du fichier de clé | AUD-06-012 | Non fait, lié à la décision ci-dessus (rotation refusée) |
| Tests avec 3 à 5 vraies personnes, appareils réels, lecteurs d'écran | AUD-03-035, AUD-05, AUD-08-025 | Non fait (hors code) |
| Trusted Types (rapport) : repoussé « une fois les `innerHTML` assainis » | AUD-06-022 | Non vérifié : à contrôler au lot 7 de l'AUD-09 |
| Roman graphique sur tablette : le placement libre des blocs est réservé aux écrans de plus de 900 px (AUD-09-015) ; l'aide du livre illustré l'annonce. À tester sur tablette réelle avant de coder un glisser tactile | AUD-09-015, AUD-08-025 | Non fait (hors code) |

## Comment tenir ce registre

À chaque décision « accepté / annulé / refusé » d'un audit : ajouter une ligne ici (risque, décision, date, justification,
réexamen). À chaque réexamen : confirmer ou rouvrir. Les bilans `docs/BILAN-AUDIT-0N.md` gardent le détail ; ce fichier est
la vue d'ensemble.
