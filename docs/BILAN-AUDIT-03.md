# Bilan de remédiation — audit ergonomique (UX) n°3 (octobre 2026)

Base : v9.40.0. État : **v9.48.0**. Document d'origine : `Audit-03` (rapport `.docx` + `.csv`, hors dépôt, dans `Claude outputs/Audit-03/`).
Les identifiants `AUD-03-xxx` sont ceux de l'audit. Les 36 constats ont été traités en 8 lots (voir `CLAUDE.md`, protocole par lot).

## Résumé

| Statut | Nombre |
|---|---|
| 🟢 Corrigé | 35 |
| 🔵 Reste ouvert (hors code) | 1 — AUD-03-035 (test avec de vrais utilisateurs et appareils réels) |

Note UX de l'audit : 61/100 (niveau 3, Bêta solide). Une nouvelle note n'est pas donnée ici : elle exige un re-audit
(voir « Pour relancer l'audit en mode comparaison »).

## Détail

| Lot | Version | Constats | Contenu |
|---|---|---|---|
| A | 9.41.0 | 001, 007, 008, 010, 034 | Étape GitHub facultative et fermable (« Plus tard », rappel discret) ; une seule bulle d'aide à la fois ; premier écran « Où sont vos manuscrits ? » ; pastille de synchro vide corrigée ; création d'un projet en un clic |
| B | 9.42.0 | 019, 018, 020, 021 | Messages à durée adaptée avec ✕, échec d'enregistrement permanent (pied de page + message fixe) ; focus sur « Annuler » ; Échap ferme une seule couche, Tab piégé seulement dans les vraies modales ; onglets en accordéon ARIA |
| C | 9.43.0 | 002, 004, 005, 006, 032 | Débordement mobile corrigé ; échelle typographique relevée + réglage « Taille de l'interface » ; cibles 24 px / 44 px ; contrastes ≥ 4,5:1 ; `prefers-reduced-motion` |
| D | 9.44.0 | 027, 009, 017, 025, 023 | Sélecteur IA contenu ; « Accueil » supprimé, déconnexion honnête ; plus aucune boîte native (modales de saisie et d'information) ; vocabulaire unifié, vouvoiement ; formulaires d'accueil (Entrée, règle visible, erreur liée au champ) |
| E | 9.45.0 | 014, 026, 016 | Export depuis l'éditeur (Outils, Ctrl+E) et depuis la carte ; panneau Système en trois onglets, une seule liste de manuscrits ; ⋮ toujours visible, clic droit |
| F | 9.46.0 | 003, 013 | Volet latéral à droite du texte (largeur réglable, plein écran sur téléphone) ; sprint visible en pied de page et fin annoncée |
| G | 9.47.0 | 015, 024, 011, 012, 033, 031, 036 | Barre d'outils regroupée ; centre d'aide unique, 5 ⓘ ; invite d'écriture ; largeur du texte ; pied de page regroupé ; tension expliquée ; filtre de chapitres |
| H | 9.48.0 | 022, 028, 029, 030 | Apparence du profil par appareil ; en-tête Système · Compte · Aide ; roman graphique (libellés, « Exporter ▾ ») ; relations nommées entre fiches et sur le graphe |

Chaque lot a ses tests (`tests/vitest/lot19` à `lot26`) et a été vérifié en réel sur une copie locale (profil de test) avant et après
la mise en ligne. La suite compte 535 tests.

## Décisions du propriétaire prises pendant la remédiation

- Étape de sauvegarde GitHub : **facultative** (remet en cause la décision de la v7.37.0).
- Création de projet : un clic sur le type crée le projet directement (pas de champ titre dans la fenêtre : le titre se règle ensuite).
- Volet latéral : maquette validée avant codage ; largeur par défaut adaptative.
- Apparence : **par appareil et par profil, non synchronisée** (la synchronisation via l'index des profils est écartée pour ne pas
  toucher au format de synchro).
- Voir `docs/DECISIONS.md`, décisions 21 à 25.

## Ce qui reste (pour un prochain audit)

1. **AUD-03-035** : test avec 3 à 5 vraies personnes (première utilisation, écriture 30 minutes, export, restauration) et sur
   deux appareils réels (téléphone, tablette). Les cibles tactiles de 44 px n'ont été vérifiées qu'en émulation.
2. **Curseur « Tension »** : reste à 16 px de haut (contrôle de type curseur, hors du lot de cibles).
3. **Visite guidée de 29 étapes** avec le volet latéral : seule la fermeture de fin de visite est testée automatiquement ; le parcours
   complet n'a pas été rejoué à la main.
4. **Lecteurs d'écran** (NVDA, VoiceOver) : non testés.
5. **Apparence non synchronisée** : un thème choisi sur un appareil ne suit pas sur les autres (choix assumé).
6. Mise en page de la barre d'outils à largeur d'éditeur étroite (volet ouvert sur petit écran) : la barre passe sur trois rangées.

## Pour relancer l'audit en mode comparaison

Fournir `Audit-03` : chaque constat sera classé 🟢 Corrigé / 🟡 Persistant / 🔵 Nouveau / 🔴 Régression, en s'appuyant sur ce bilan.
