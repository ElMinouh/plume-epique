# Glossaire des mots de l'interface

Créé le 18/10/2026 (audit AUD-09-005). Un mot, un sens : à respecter dans tout libellé, message, aide et visite. Le test
`tests/vitest/lot-aud09-5-vocabulaire.test.js` interdit le retour des formulations écartées.

## Mots retenus

| Mot | Sens | Où |
|---|---|---|
| **projet** | Un document de l'application, de n'importe quel type (texte ou roman graphique). Mot générique des actions | Nouveau projet, importer/exporter un projet, corbeille des projets, recherche dans le projet, « ce projet » dans les messages de synchro et de sauvegarde |
| **manuscrit** | Le **texte** d'un projet de type texte, vu depuis l'éditeur | Écriture du manuscrit, Titre du manuscrit, Exporter le manuscrit, Tout le manuscrit (rechercher/remplacer), Objectif du manuscrit, passages envoyés à l'IA |
| **roman graphique** | Le type de projet « livre illustré » | Choix du type à la création, écran dédié |
| **chapitre** | Une division d'un projet texte | Éditeur |
| **page** | Une division d'un roman graphique | Écran du roman graphique |
| **bibliothèque** | L'écran qui liste les projets d'un profil | Navigation |
| **profil** | Une personne qui écrit sur l'application, avec son mot de passe | Connexion |
| **Plume** | Le nom du produit affiché. `plume-epique` n'est qu'un identifiant technique (dépôt, domaine, base locale) | Titre de la page, manifeste, textes |
| **Outils d'analyse** | Les quatre outils de l'onglet Versions → « Outils d'analyse » (correction grammaticale, temps de lecture, répétitions, synopsis). Ne pas parler de « plugins » : la liste est fixe, aucun module externe n'est possible (le fichier garde son nom technique `pluginSystem.js`) | Onglet Versions, visite |
| **version** | Un état enregistré d'un chapitre ou d'une page, récupérable | Onglet « Versions » |
| **corbeille** | Éléments supprimés récupérables 30 jours | Projets, chapitres, pages |

## Exception décidée par le propriétaire

Le premier écran « Où sont vos manuscrits ? » (et son texte d'aide) garde le mot « manuscrits » : décision AUD-03-008 maintenue
le 16/10/2026 (AUD-08-001 annulé). Ne pas le modifier sans nouvelle décision.

## Voix

- Vouvoiement partout. Aucun « tu » dans l'interface (les consignes envoyées au modèle d'IA sont écrites au tutoiement : ce n'est
  pas de l'interface).
- Phrases courtes, verbes d'action (« Créer », « Exporter »), pas de jargon technique en première ligne.
- Une erreur dit **ce qui n'a pas abouti**, **pourquoi** en mots simples et **quoi faire** : elle passe par `toastError` /
  `messageErreurLisible` (`js/notifications.js`), jamais par le message brut du navigateur.
- Pluriels par `plur()`, jamais « (s) ».
- Les icônes ont un seul sens (voir `js/icons.js`) : l'icône « étincelles » désigne les fonctions qui envoient du texte à l'IA
  (résumés, synonymes, générateur de noms, reformulation).
