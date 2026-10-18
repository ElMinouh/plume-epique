# Produit : public, échelle et limites

Écrit le 18/10/2026 (audit AUD-09-007). Ce document dit **pour qui et jusqu'où** Plume est conçu. Chaque audit et chaque
décision « risque accepté » s'y réfère : un constat est « hors périmètre » s'il sort de cette page, « accepté » s'il est dedans
et que le propriétaire a décidé de le garder (voir `docs/RISQUES.md`).

## Public visé

- **Un auteur** (le propriétaire) qui écrit des romans et des livres illustrés, **et ses proches** (usage familial,
  plusieurs profils sur la même clé de synchronisation).
- Niveau technique : aucun. L'interface est en français, au vouvoiement, sans jargon.
- Appareils : ordinateur (écriture longue, composition du roman graphique) et téléphone/tablette (lecture, relecture,
  écriture courte). Navigateurs récents, PWA installable.

## Échelle maximale prévue

- Au plus **20 profils** sur une même clé de synchronisation (un foyer), quelques manuscrits par profil.
- Un manuscrit de roman : jusqu'à quelques centaines de milliers de mots ; un livre illustré : quelques dizaines de pages
  et quelques centaines d'images au total pour tout le foyer (budget serveur actuel dans `docs/EXPLOITATION.md`).
- Services gratuits Cloudflare (Pages, Workers, D1, R2) et Google Gemini (offre gratuite) : l'architecture est dimensionnée
  pour ces quotas, pas pour un trafic public.

## Non-objectifs (volontairement hors périmètre)

- Service public ou commercial, inscription ouverte, plusieurs foyers sur un même serveur.
- Collaboration en temps réel entre auteurs.
- Conformité RGPD d'un éditeur de service (politique de confidentialité, droits des personnes, public mineur) : l'application
  n'a pas d'utilisateurs inconnus. Si le produit s'ouvrait au public, ce serait un chantier à part (isolement par foyer,
  confidentialité, quotas), pas une suite d'audits.
- Paliers de 100 à 100 000 utilisateurs (AUD-07-021 : constaté, assumé).

## Conséquences sur les critères de qualité

| Sujet | Critère retenu |
|---|---|
| Données | Ne jamais perdre un texte : corbeilles, historique borné, sauvegarde chiffrée, exports ouverts (DOCX, EPUB, ODT, PDF, JSON) |
| Sécurité | Protéger contre la perte, la fuite accidentelle et l'abus d'un tiers qui trouverait la clé ; les compromis de commodité entre proches sont assumés et listés dans `docs/RISQUES.md` |
| Performances | Ouverture et frappe fluides sur un téléphone d'entrée de gamme ; budgets de poids en CI (`npm test`) |
| Accessibilité | WCAG 2.2 AA visé ; tests avec de vraies personnes et lecteurs d'écran à faire (hors code) |
| Évolution | Une seule personne maintient : préférer peu de fonctions bien faites à beaucoup de fonctions secondaires |

## Noms

- **Plume** : nom affiché (titre de la page, manifeste, interface).
- `plume-epique` : identifiant technique seulement (dépôt, domaine `plume-epique.pages.dev`, base IndexedDB `plume_epique`).
- Le premier écran n'affiche pas de nom de produit (AUD-08-001 annulé le 16/10/2026) : décision maintenue.

## Types de document

`texte` (romans) et `roman_graphique` (livres illustrés). La bande dessinée est annoncée mais non commencée ; elle ne démarre
qu'après le registre de types de document (AUD-09-002).

## Ce que les audits n'ont pas pu couvrir

Rendu réel sur téléphones et tablettes ; usage réel des fonctions secondaires ; compréhension par un nouvel utilisateur ;
lecteurs d'écran ; navigateurs hors Chromium. À obtenir : tests avec 3 à 5 personnes (AUD-03-035, AUD-08-025), un mois de
mesures d'usage locales (AUD-09-010).

## Fonctions : cœur, soutien, périphérie (AUD-09-010, v9.89.0)

Classement décidé le 18/10/2026. Faute de mesure d'usage, **rien n'est retiré** ; la périphérie est **gelée**.

| Catégorie | Fonctions | Règle |
|---|---|---|
| **Cœur** | Éditeur de chapitres, statuts, notes, fiches (personnages, lieux, quêtes), bibliothèque, profils, enregistrement chiffré, synchronisation, sauvegarde GitHub, exports (DOCX, EPUB, ODT, PDF, JSON), corbeilles et versions, roman graphique | Toute évolution passe par les audits et les tests habituels |
| **Soutien** | Statistiques d'écriture, objectifs de mots et sprint, recherche globale et remplacer, assistant IA (résumé, continuation, incohérences), synonymes, mode Focus et mode Lecture, confort de lecture, thèmes | Évolutions possibles, une à la fois |
| **Périphérie** | Nuage de mots, Lisibilité (détail longueur et lisibilité), Dictée vocale et lecture à voix haute, Chronologie, Relations (graphe), Mémoire narrative, Outils d'analyse (correction grammaticale, temps de lecture, répétitions, synopsis), Visite complète (33 étapes) | **Gelée** : correctifs et compatibilité seulement, aucune nouvelle fonction, aucun nouveau réglage |

Décision ouverte pour le propriétaire : retirer une fonction périphérique est un lot à part, à demander (une fonction retirée se
retire de l'interface, de la visite, des tests et de la documentation). Réexamen de la périphérie : 18/01/2027.
