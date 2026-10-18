# Suivi de remédiation — audit cohérence globale et excellence systémique n°9 (octobre 2026)

Base : v9.84.1. Document d'origine : `Audit-09` (rapport `.docx` + `.csv`, hors dépôt, dans `Claude outputs/Audit-09/`). 16 constats réels + 1 observation de couverture (1 élevée, 11 moyennes, 4 faibles), note 71/100, niveau 4 Production. Tous à traiter (décision du 18/10/2026). Protocole par lot : voir `CLAUDE.md`.

| Lot | Version | Constats | Contenu | Statut |
|---|---|---|---|---|
| 1 | 9.84.1 (inchangée) | 006, 007, 016, 017 | `docs/PRODUIT.md`, `docs/RISQUES.md`, contradictions documentaires corrigées, CLAUDE.md allégé (un seul protocole), test de cohérence `lot-aud09-1-gouvernance.test.js` | livré |
| 2 | 9.84.1 (inchangée) | 001 | Parcours navigateur Playwright + axe-core (6 scénarios, `tests/e2e/`, `npm run e2e`), étape CI ; les 6 passent au rouge sans le correctif 9.84.1 ; axe : aucune violation sur 3 écrans | livré |
| 3 | 9.85.0 | 002, 003 | Registre `DOC_TYPES` (`schema.js`) interrogé par Ctrl+S/Z/Y/E/F, ouverture, déconnexion, rafraîchissement ; 18 comparaisons de type remplacées ; Ctrl+F cherche dans les pages du roman graphique (plantage reproduit par parcours navigateur avant correctif) ; tests `lot-aud09-3-registre-types.test.js` | livré |
| 4 | 9.86.0 | 004, 015 | Boutons Thème et Aide dans l'écran du roman graphique ; aide et raccourcis par type (`DOC_TYPES.shortcuts`, `shortcutsNote`, `tours`) ; limite tactile (> 900 px) annoncée dans l'aide et inscrite dans `docs/RISQUES.md` (tactile non codé, test tablette réelle d'abord) ; `lot-aud09-4-socle-roman-graphique.test.js` + 2 parcours | livré |
| 5 | 9.87.0 | 005, 012, 013, 014 | `docs/GLOSSAIRE.md` ; « projet » comme mot générique (88 lignes de libellés, 9 fichiers ; « manuscrit » gardé pour le texte et le premier écran) ; 11 erreurs brutes passées en messages lisibles (lecture de fichier, 5 exports du roman graphique, 2 échecs d'enregistrement, dictée, correction grammaticale) ; « Plume » partout ; `lot-aud09-5-vocabulaire.test.js` (29 tests). **AUD-09-013 retiré** (erreur de l'audit : les synonymes passent par l'IA, l'icône étincelles est cohérente ; seule exception décorative corrigée, test de liste blanche ajouté) | livré |
| 6 | 9.88.0 | 008, 009 | Avertissement dans le panneau et dans la page de confidentialité, libellés « appareil personnel » et confirmation à partir de 7 jours (le défaut 12 h existait déjà : l'audit se trompait) ; correcteur du navigateur activé par défaut (option A, décision du 18/10/2026 ; le choix déjà stocké prime ; le défaut « désactivé » était un choix documenté pour les noms propres) ; `lot-aud09-6-session-correcteur.test.js` + 2 parcours | livré |
| 7 | 9.89.0 | 010, 011 | Test de détection des déclarations globales en double (a révélé `formatMo` ×2, la version française était du code mort : unifiée dans `schema.js`) ; `escapeRegExp` ×3 → 1 ; plafond de 150 Ko par fichier ; règle « nouveau module = ESM à la demande » ; « Plugins » → « Outils d'analyse » ; périphérie classée et gelée (`docs/PRODUIT.md`, option A du 18/10/2026, rien retiré) ; test « chaque cible de la visite existe » ; Trusted Types et découpage des gros fichiers consignés dans `docs/RISQUES.md` ; `lot-aud09-7-peripherie-architecture.test.js` | livré |

Décisions du propriétaire : rotation de la clé de synchro refusée (12/10/2026), maintenue le 18/10/2026 (`docs/RISQUES.md`).

## Conclusion (18/10/2026)

7 lots livrés en 7 versions (9.84.1 → 9.89.0) pour 16 constats réels + 1 observation. 15 traités, **1 retiré** (013 : les synonymes passent
par l'IA, l'icône étincelles est cohérente), 1 observation de couverture (017) traitée dans `docs/PRODUIT.md` et `docs/RISQUES.md`.

Corrections apportées à l'audit lui-même pendant les lots, vues au code ou au test réel :
- 008 : la durée de session par défaut était déjà de 12 h ; le manque était l'avertissement à l'écran ;
- 009 : le correcteur désactivé était un choix documenté (noms propres), arbitré par le propriétaire (option A, activé par défaut) ;
- 012 : 11 erreurs brutes au lieu de 3 ;
- 013 : retiré (hypothèse fausse) ;
- 011 : le test de doublons a révélé `formatMo` en deux versions (la française était du code mort), non vu par l'audit.

Nouveaux garde-fous : parcours navigateur en CI (13 scénarios, Playwright + axe-core), registre des types de document, test de
cohérence documentaire, glossaire testé, détection des déclarations globales en double, plafond de 150 Ko par fichier.

## Ce qui reste (hors code ou à décider)

1. Tests avec 3 à 5 vraies personnes, appareils réels, lecteurs d'écran (AUD-03-035, AUD-08-025) ; tablette réelle pour le glisser tactile du roman graphique (AUD-09-015).
2. Actions du propriétaire dans `docs/RISQUES.md` : moniteur de disponibilité (UptimeRobot) et copie de la phrase secrète de sauvegarde à confirmer.
3. Périphérie gelée : retrait éventuel d'une fonction = lot à demander (réexamen 18/01/2027).
4. Découpage de `graphicnovel.js`, `router.js`, `library.js` et Trusted Types : reportés, consignés dans `docs/RISQUES.md`.
5. Bulle « Configuration initiale » qui recouvre le menu « Compte » à la première ouverture : constatée, non corrigée (à demander).
6. La bande dessinée ne démarre qu'avec une entrée dans le registre `DOC_TYPES` (et un nouveau re-audit de cohérence ensuite).
