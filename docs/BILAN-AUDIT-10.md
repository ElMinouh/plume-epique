# Bilan de l'audit AUD-10 (pédagogie, sciences cognitives, efficacité de l'apprentissage)

Audit du 18/10/2026 : 20 constats (12 moyens, 7 faibles, 1 observation), note 55/100, niveau 3. Rapport : `Claude outputs/Audit-10/` (hors dépôt).
Tous les constats sont traités (décision du 18/10/2026), en 7 lots, protocole par lot et par push (validation avant code, version et
vérification après livraison, test réel sur copie locale après chaque push).

| Lot | Version | Constats | Contenu | État |
|---|---|---|---|---|
| 1 | 9.90.0 | 002, 003, 014 | Lisibilité en formule française (Kandel & Moles, syllabes en groupes de voyelles) ; détecteur de répétitions avec bornes Unicode (les mots en -é n'étaient jamais comptés) ; mots/min sur le temps de saisie effectif (`trackActiveTime`, pause > 60 s exclue, en mémoire) ; `lot-aud10-1-mesures.test.js` | livré |
| 2 | — | 004, 005, 015, 017 | Statistiques et objectifs | à valider |
| 3 | — | 018, 010, 007 | Messages, repères d'indicateurs, retours IA cliquables | à valider |
| 4 | — | 006, 019 | Mode coach de l'IA, résumé de chapitre | à valider |
| 5 | — | 008, 009 | Relecture annotée, passes de révision | à valider |
| 6 | — | 011, 012 | Accueil par missions, niveaux d'usage | à valider |
| 7 | — | 001, 016, 013, 020 | Objectifs produit, note de reprise, modèles de plan, tests utilisateurs | à valider |
