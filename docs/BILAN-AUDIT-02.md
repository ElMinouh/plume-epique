# Bilan de remédiation — audit fonctionnel n°2 (octobre 2026)

Base : v9.32.0. État : **v9.39.0**. Document d'origine : `Audit-02-audit-fonctionnel.docx` (hors dépôt). Les identifiants
`AUD-02-xxx` sont ceux de l'audit. Les 22 constats ont été traités en 7 lots (voir `CLAUDE.md`, protocole par lot).

## Résumé

| Statut | Nombre |
|---|---|
| 🟢 Corrigé | 22 |

Aucun constat n'est resté ouvert. Les limites qui subsistent sont dans `README.md`, section « Limites connues ».

## Détail

| ID | Constat | Lot | Version | Preuve |
|---|---|---|---|---|
| 001 | Mode Focus : rien d'enregistré avant la sortie (un flush lisait l'ancien éditeur) | 1 | 9.33.0 | `suite.js` (Focus) |
| 008 | Copies automatiques seulement pour le chapitre affiché | 1 | 9.33.0 | `suite.js` (copie en quittant un chapitre) |
| 009 | Restauration sans copie de l'état écrasé | 1 | 9.33.0 | `suite.js` (« Avant restauration ») |
| 005 | Comptage de mots faux en français (œ, apostrophes, `&nbsp;`) + recalage de l'historique | 2 | 9.34.0 | `suite.js` (`getWordCount`, `rebaseWordStats`) |
| 006 | Jour des statistiques en UTC | 2 | 9.34.0 | `suite.js` (`dateKey`) |
| 007 | Mots faibles : accents, caractères spéciaux, HTML brut | 2 | 9.34.0 | `suite.js` (`analyzeStyle`) |
| 020 | Objectifs remis à la valeur par défaut quand on efface le champ | 2 | 9.34.0 | `suite.js` (`readGoalInput`) |
| 021 | Surlignages d'analyse enregistrés et exportés | 2 | 9.34.0 | `suite.js` (`stripAnalysisMarks`) |
| 003 | DOCX et PDF en texte brut | 3 | 9.35.0 (+9.35.1 PDF compressé) | `lot13-exports.test.js` |
| 013 | « Chapitre 1 : Chapitre 1 », nom de fichier unique | 3 | 9.35.0 | `lot13-exports.test.js` |
| 016 | Roman graphique : import et export Système | 3 | 9.35.0 | `lot13-exports.test.js` |
| 017 | Messages « vérifiez la connexion » périmés | 3 | 9.35.0 | `lot13-exports.test.js` |
| 004 | Import en un seul chapitre ; pas de scinder / fusionner | 4 | 9.36.0 | `suite.js` (`splitImportedHtml`, scinder, fusionner) ; test réel d'un .docx |
| 010 | Remplacer limité au chapitre courant, sans options | 4 | 9.36.0 | `suite.js` (options, remplacement global) |
| 018 | Duplication sans objectif ni notes | 4 | 9.36.0 | `suite.js` |
| 019 | Restauration de corbeille en fin de liste | 4 | 9.36.0 | `suite.js` |
| 002 | IA : 650 mots du roman, 500 mots du chapitre, sans le dire | 5 | 9.37.0 | `lot15-ia.test.js` |
| 011 | Quêtes non supprimables | 6 | 9.38.0 | `suite.js` (`deleteQuest`) |
| 012 | Chronologie non modifiable, non triée, suppression sans confirmation | 6 | 9.38.0 | `suite.js` (chronologie) |
| 014 | Suppression de manuscrit sans corbeille | 7 | 9.39.0 | `lot17-corbeille.test.js` ; test réel à deux appareils |
| 015 | Profil supprimé qui réapparaît | 7 | 9.39.0 | `lot17-corbeille.test.js` ; test réel à deux appareils |
| 022 | Réimport : doublons systématiques | 7 | 9.39.0 | `lot17-corbeille.test.js` ; test réel |

## Décisions du propriétaire prises pendant la remédiation

- Police du PDF : Times 12 pt avec numéros de page ; PDF mis en forme dans le même lot que le DOCX.
- Fusion de chapitres : le chapitre absorbé va à la corbeille ; remplacer : « chapitre courant » par défaut.
- IA : analyse du roman entier en deux temps livrée tout de suite (plafond de 40 appels, confirmation, annulation).
- Chronologie : boutons ◀ ▶ et tri selon les chapitres, pas de glisser-déposer.
- Manuscrits : corbeille de 30 jours, sans retaper le titre pour la mise à la corbeille ; profils : pierre tombale seule,
  sans effacement des données sur le serveur ; réimport : doublons ignorés par défaut.

## Ce qui reste (pour un prochain audit)

1. **Effacement serveur des données d'un profil supprimé** : demanderait d'autoriser `DELETE` des clés du profil dans le Worker
   de synchro (déploiement avec accord explicite). Option B écartée pour l'instant.
2. **Analyse du roman entier** : qualité réelle des réponses Gemini non mesurée ; comparaison par groupes sur un roman très long.
3. **Plugins, synthèse vocale, nuage de mots, lisibilité, tour guidé, canevas du roman graphique** : non audités (voir l'audit).
4. **Tests navigateur automatisés** : toujours manuels (décision n°15).

## Pour relancer l'audit en mode comparaison

Fournir `Audit-02-audit-fonctionnel.docx` : chaque constat sera classé 🟢 Corrigé / 🟡 Persistant / 🔵 Nouveau / 🔴 Régression
en s'appuyant sur ce bilan.
