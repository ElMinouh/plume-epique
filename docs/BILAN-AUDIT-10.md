# Bilan de l'audit AUD-10 (pédagogie, sciences cognitives, efficacité de l'apprentissage)

Audit du 18/10/2026 : 20 constats (12 moyens, 7 faibles, 1 observation), note 55/100, niveau 3. Rapport : `Claude outputs/Audit-10/` (hors dépôt).
Tous les constats sont traités (décision du 18/10/2026), en 7 lots, protocole par lot et par push (validation avant code, version et
vérification après livraison, test réel sur copie locale après chaque push).

| Lot | Version | Constats | Contenu | État |
|---|---|---|---|---|
| 1 | 9.90.0 | 002, 003, 014 | Lisibilité en formule française (Kandel & Moles, syllabes en groupes de voyelles) ; détecteur de répétitions avec bornes Unicode (les mots en -é n'étaient jamais comptés) ; mots/min sur le temps de saisie effectif (`trackActiveTime`, pause > 60 s exclue, en mémoire) ; `lot-aud10-1-mesures.test.js` | livré |
| 2 | 9.91.0 | 004, 005, 015, 017 | Série en jours d'écriture (`db.activeDays`, 1 min de saisie, un jour de répit toléré, règle historique conservée), « Aujourd'hui » en net signé, objectif suggéré (médiane 14 jours + 15 %, à appliquer), avancement de la révision, messages factuels, date de fin en fourchette (quartiles 30 jours), sprint 15/25/45 min (préférence d'appareil) ; `activeDays` exclu de la synchro et du Gist ; `lot-aud10-2-stats-objectifs.test.js` | livré |
| 3 | 9.92.0 | 018, 010, 007 | Points d'incohérence de l'IA (une ligne par point, « [Ch.N] », « Aller au chapitre », « Ignorer » mémorisé dans `db.aiIgnored`, reconnaissance par chapitres + 60 % de mots communs, repli sur le texte brut) ; refus de seuil en information avec les chiffres ; textes de repère sur Détail et mots faibles (périphérie gelée : aucune valeur par chapitre) ; `lot-aud10-3-retours.test.js` | livré |
| 4 | 9.93.0 | 006 | Mode « Produire » (défaut) / « Coach » du chat IA : consigne, puces et boutons selon le mode (Coach : pas de réécriture, « Insérer » et « Remplacer » masqués), préférence d'appareil ; « Corriger ce passage » explique ses corrections ; `lot-aud10-4-coach.test.js`. **AUD-10-019 (résumé écrit d'abord par l'auteur) : refusé par le propriétaire le 13/11/2026, non traité** | livré |
| 5 | 9.94.0 | 008, 009 | Remarques de relecture depuis le mode Lecture (`ch.remarks`, 50 au plus, passage retrouvé par son texte, jamais inséré dans le chapitre ni les exports) ; quatre passes datées (`ch.passes`) ; statuts définis (écran, `docs/GLOSSAIRE.md`) ; information non bloquante à « Final » ; bilan de révision avec les passes ; fenêtre de saisie au-dessus du mode Lecture (z-index 9600). **Objectif hebdomadaire de passes (point 3 proposé) : refusé le 18/11/2026** ; `lot-aud10-5-relecture.test.js` | livré |
| 6 | 9.95.0 | 011, 012 | Carte « Premiers pas » de 3 missions validées par l'action (remplace les 4 bulles passives ; progression et niveau sur l'appareil, `profil.onboardingDone` réutilisé) ; niveaux d'usage Débuter / Écrire / Tout voir (défaut inchangé, masquage seul, section masquée annoncée, visite complète non filtrée) ; projet d'exemple (`js/exemple.js`, ESM à la demande) ; `lot-aud10-6-accueil-niveaux.test.js` + 2 parcours navigateur. v9.95.1 : carte des premiers pas à droite sur ordinateur (elle masquait les compteurs de la colonne des chapitres), phrase du projet d'exemple sans « jusqu'à » (le détecteur de répétitions la découpait mal) | livré |
| 7 | 9.96.0 | 013 | Repères d'échelle du curseur de tension ; modèle de plan facultatif sur la courbe (Trois actes, Arc du héros, pointillés, défaut « Aucun », préférence d'appareil, équivalent textuel avec colonne « Modèle ») ; fiche de scène facultative (`ch.scene`, but / obstacle / enjeu) ; `lot-aud10-7-plan.test.js` + 1 parcours navigateur. **AUD-10-001, -016 et -020 : refusés par le propriétaire le 19/11/2026, non traités** | livré |

## Hors lot : DOMPurify 3.4.17 (v9.90.1, 23/10/2026)

La CI a échoué sur l'étape « npm audit » (tests et parcours navigateur au vert) : nouvel avis critique sur DOMPurify ≤ 3.4.16. Mise à jour de la copie
de `vendor/` en 3.4.17 (jsDelivr `dompurify@3.4.17/dist/purify.min.js`, ligne `sourceMappingURL` finale retirée comme pour la 3.4.16, vérifié
octet pour octet sur l'ancienne version), `package.json`/`package-lock.json`, `index.html`, `sw.js`, `vendor/SHA256SUMS`, tests qui citent le nom du fichier.

## Conclusion (19/11/2026)

7 lots livrés en versions 9.90.0 → 9.96.0 (plus 9.90.1, correctif de sécurité DOMPurify hors lot, et 9.95.1, finition de l'accueil).
Sur 20 constats : **16 traités**, **4 refusés** par le propriétaire (décisions en vigueur, voir `docs/RISQUES.md`) :
- AUD-10-019 : résumé de chapitre écrit d'abord par l'auteur (13/11/2026) ;
- AUD-10-001 : objectifs d'accompagnement de l'auteur dans `docs/PRODUIT.md` (19/11/2026) ;
- AUD-10-016 : note « prochaine étape » pour reprendre après une interruption (19/11/2026) ;
- AUD-10-020 : protocole de tests avec de vraies personnes (19/11/2026). Les actions AUD-03-035 et AUD-08-025 restent ouvertes dans `docs/RISQUES.md`.
Deux propositions annexes ont aussi été refusées : l'objectif hebdomadaire de passes de relecture (lot 5) et le décompte des valeurs par chapitre sur l'écran Détail (périphérie gelée, lot 3).

Ce que les lots ont changé pour l'auteur : mesures exactes (lisibilité française, répétitions accentuées, vitesse de saisie) ; statistiques qui ne pénalisent plus la révision ;
retours de l'IA exploitables (points cliquables, ignorables) et mode Coach ; relecture outillée (remarques, passes datées, statuts définis) ;
accueil par la pratique, niveaux d'usage, projet d'exemple ; aide au plan facultative.

Nouveaux garde-fous : 8 fichiers de tests `lot-aud10-*` et 4 parcours navigateur (relecture au premier plan, premiers pas et niveaux, projet d'exemple, aide au plan).

Limites de l'audit et de la remédiation, à garder en tête :
- l'efficacité réelle sur les auteurs n'est pas mesurée (aucun test utilisateur, voir AUD-10-020 refusé) ;
- le respect de la consigne du mode Coach par le modèle d'IA et du format `[Ch.N]` des analyses n'est pas vérifiable hors connexion ;
- les références scientifiques du rapport sont citées de mémoire (auteur, année, thèse) ; les chiffres sont à vérifier à la source avant toute citation ;
- l'audit a été fait par échantillonnage : le module roman graphique n'a pas été audité sur le plan pédagogique.
