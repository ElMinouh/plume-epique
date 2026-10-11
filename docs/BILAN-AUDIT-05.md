# Suivi de remédiation — audit accessibilité WCAG 2.2 n°5 (octobre 2026)

Base : v9.56.0. Document d'origine : `Audit-05` (rapport `.docx` + `.csv`, hors dépôt, dans `Claude outputs/Audit-05/`). 18 constats (3 élevés, 12 moyens, 2 faibles, 1 observation), note 64/100, plan en 7 lots.

| Lot | Version | Constats | Contenu | Statut |
|---|---|---|---|---|
| 1 | 9.57.0 | 001, 002 (+ début 017) | `label for` sur les 16 libellés des écrans de profil ; `aria-label` sur 28 champs de index.html et 2 de la récupération ; 3 labels reliés ; test garde-fou `lot34-formulaires-accessibles.test.js` | livré |
| 2 | 9.58.0 | 003, 004, 016 | Gestionnaire central des fenêtres modales (retour du focus au déclencheur, `inert` sur le reste de la page) ; noms des fenêtres connexion / recherche / Focus ; messages en pause au focus clavier. Les fenêtres du roman graphique restituaient déjà le focus (`gnWireModalA11y`) : le constat 003 les visait à tort | livré |
| 3 | 9.59.0 | 005, 012, 006 | Recopie centrale `.active` → `aria-pressed` / `aria-checked` ; groupes nommés ; `role="status"` sur le nombre de résultats et l'état de synchro (l'état « Enregistré » reste muet, pour ne pas annoncer chaque sauvegarde ; l'échec passe déjà par le message `role="alert"`) ; h1 par écran, h2 de section, lien « Aller au contenu » | livré |
| 4 | — | 010, 011 | Roman graphique : pages au clavier, texte alternatif | à venir |
| 5 | — | 007, 013, 018 | Contours de champs, bouton ⋮ tactile, mesure du zoom | à venir |
| 6 | — | 008, 009 | Graphiques et graphe de relations | à venir |
| 7 | — | 014, 015 | Confort de lecture, langue d'un passage | à venir |
