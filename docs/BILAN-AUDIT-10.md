# Bilan de l'audit AUD-10 (pédagogie, sciences cognitives, efficacité de l'apprentissage)

Audit du 18/10/2026 : 20 constats (12 moyens, 7 faibles, 1 observation), note 55/100, niveau 3. Rapport : `Claude outputs/Audit-10/` (hors dépôt).
Tous les constats sont traités (décision du 18/10/2026), en 7 lots, protocole par lot et par push (validation avant code, version et
vérification après livraison, test réel sur copie locale après chaque push).

| Lot | Version | Constats | Contenu | État |
|---|---|---|---|---|
| 1 | 9.90.0 | 002, 003, 014 | Lisibilité en formule française (Kandel & Moles, syllabes en groupes de voyelles) ; détecteur de répétitions avec bornes Unicode (les mots en -é n'étaient jamais comptés) ; mots/min sur le temps de saisie effectif (`trackActiveTime`, pause > 60 s exclue, en mémoire) ; `lot-aud10-1-mesures.test.js` | livré |
| 2 | 9.91.0 | 004, 005, 015, 017 | Série en jours d'écriture (`db.activeDays`, 1 min de saisie, un jour de répit toléré, règle historique conservée), « Aujourd'hui » en net signé, objectif suggéré (médiane 14 jours + 15 %, à appliquer), avancement de la révision, messages factuels, date de fin en fourchette (quartiles 30 jours), sprint 15/25/45 min (préférence d'appareil) ; `activeDays` exclu de la synchro et du Gist ; `lot-aud10-2-stats-objectifs.test.js` | livré |
| 3 | 9.92.0 | 018, 010, 007 | Points d'incohérence de l'IA (une ligne par point, « [Ch.N] », « Aller au chapitre », « Ignorer » mémorisé dans `db.aiIgnored`, reconnaissance par chapitres + 60 % de mots communs, repli sur le texte brut) ; refus de seuil en information avec les chiffres ; textes de repère sur Détail et mots faibles (périphérie gelée : aucune valeur par chapitre) ; `lot-aud10-3-retours.test.js` | livré |
| 4 | — | 006, 019 | Mode coach de l'IA, résumé de chapitre | à valider |
| 5 | — | 008, 009 | Relecture annotée, passes de révision | à valider |
| 6 | — | 011, 012 | Accueil par missions, niveaux d'usage | à valider |
| 7 | — | 001, 016, 013, 020 | Objectifs produit, note de reprise, modèles de plan, tests utilisateurs | à valider |

## Hors lot : DOMPurify 3.4.17 (v9.90.1, 23/10/2026)

La CI a échoué sur l'étape « npm audit » (tests et parcours navigateur au vert) : nouvel avis critique sur DOMPurify ≤ 3.4.16. Mise à jour de la copie
de `vendor/` en 3.4.17 (jsDelivr `dompurify@3.4.17/dist/purify.min.js`, ligne `sourceMappingURL` finale retirée comme pour la 3.4.16, vérifié
octet pour octet sur l'ancienne version), `package.json`/`package-lock.json`, `index.html`, `sw.js`, `vendor/SHA256SUMS`, tests qui citent le nom du fichier.
