# Bilan de remédiation — audit technique n°1 (octobre 2026)

Base : v9.19.0 (note 56/100, maturité Bêta). État : **v9.32.0**. Documents d'origine : `Claude outputs/Audit-01/`
(non versionné). Les identifiants `AUD-01-xxx` sont ceux de l'audit.

## Résumé

| Statut | Nombre |
|---|---|
| 🟢 Corrigé | 24 |
| 🟡 Partiel | 1 |
| ⚪ Non traité par décision du propriétaire | 1 |
| ✅ Clos / résolu autrement | 2 |

Un constat est apparu pendant la remédiation : **AUD-01-029** (minuteur de 5 minutes qui sauvegardait le manuscrit en
mémoire même bibliothèque affichée, pouvant écraser une restauration) — corrigé en 9.21.0.

## Détail

| ID | Constat | Statut | Version | Preuve |
|---|---|---|---|---|
| 001 | Question secrète / mot de passe cassables hors ligne | ⚪ Non traité — **décision du propriétaire** (question conservée) | — | `docs/DECISIONS.md` n°3 |
| 002 | DOMPurify 3.1.6 et jsPDF 2.5.1 obsolètes | 🟢 | 9.20.0 | `lot1-securite.test.js` (vrai DOMPurify, versions cohérentes) |
| 003 | Librairies sur CDN tiers sans SRI | 🟢 | 9.27.0 (`vendor/`) | `lot6-durcissement.test.js` |
| 004 | Worker IA ouvert à tous | 🟢 | 9.20.0 | `lot1-securite.test.js` (401/403/413) ; vérifié en ligne |
| 005 | Écritures KV amplifiées | 🟢 | 9.21.0, 9.22.0, 9.23.0 (D1) | `lot2-quota-reseau`, `sync-envoi-apres-pause`, `sync-d1` ; capture Cloudflare du 03/10 |
| 006 | Annuler + corbeille détruit une image | 🟢 | 9.25.0 | `lot4-graphique-historique` (échoue sur l'ancien code) |
| 007 | Gist écrase les derniers mots | 🟢 | 9.26.0 | `lot5-integrite-sync` |
| 008 | Suppressions non propagées | 🟢 (+ contenu chiffré des manuscrits supprimés effacé du serveur) | 9.26.0, 9.30.0 | `lot5-integrite-sync`, `lot9-menage-serveur` ; test réel à deux appareils |
| 009 | Mot de passe en clair dans la session | 🟢 | 9.24.0 (+ durée 12 h) | `suite.js` (profils) |
| 010 | Worker de synchro : clé unique sans freinage | 🟢 (clé commune conservée, DECISIONS n°14) | 9.20.0 | `lot1-securite.test.js`, `sync-d1.test.js` |
| 011 | Images en clair, non synchronisées | 🟢 | 9.28.0 | `lot7-images.test.js` ; test réel à deux appareils |
| 012 | Notice de confidentialité fausse (Mistral) | 🟢 | 9.20.0 | `lot1-securite.test.js` |
| 013 | Styles en ligne bloqués par la CSP | 🟢 (+ l'alerte de conflit n'avait **jamais** été visible : variables CSS inexistantes) | 9.27.0 | `lot6-durcissement.test.js` ; capture écran locale |
| 014 | Couverture de tests inégale | 🟡 — tests ajoutés à chaque lot (≈ 300), module GN couvert pour undo/corbeille/images ; **pas de test navigateur automatisé** (décision), couverture non mesurée, vrai DOMPurify seulement dans les tests de sécurité | 9.20.0 → 9.29.0 | `tests/vitest/` |
| 015 | CI/CD : déploiement non conditionné, Node 20, actions mobiles | 🟢 | 9.29.0 | `lot8-exploitation.test.js` |
| 016 | Aucune observabilité | 🟢 (journaux sans contenu, occupation du stockage dans Système) | 9.29.0 | `lot8-exploitation.test.js` |
| 017 | Démarrage et requêtes sans délai maximal | 🟢 | 9.21.0 | `lot2-quota-reseau` |
| 018 | Versions mixtes : schéma abaissé | 🟢 | 9.26.0 | `lot5-integrite-sync` |
| 019 | PBKDF2 répété à chaque sauvegarde | 🟢 Étape 1 (lecture v2, 9.31.0) puis étape 2 (écriture v2, **activée en 9.32.0**) ; 27 ms → 0,1 ms par enveloppe (PC) | 9.31.0, 9.32.0 | `lot10-chiffrement-v2.test.js` ; test réel à deux appareils |
| 020 | Rendu HTML sans assainissement | 🟢 | 9.27.0 (`escapeHtml`) | `lot6-durcissement.test.js` |
| 021 | Documentation en dérive | 🟢 | 9.29.0 | ce dossier `docs/` + README |
| 022 | Dépendances de développement : 4 alertes | 🟢 `npm audit` : 0 alerte (dev et production) ; alerte `docx`→`nanoid` documentée dans `vendor/LISEZMOI.md` | 9.30.0 | `npm audit` |
| 023 | GN : pas de garde de fermeture, historique lourd | 🟢 | 9.25.0 | `lot4-graphique-historique` |
| 024 | En-têtes HTTP incomplets | 🟢 | 9.27.0 | `lot6-durcissement.test.js` ; en-têtes vérifiés en ligne |
| 025 | Clé de sync dans git ? | ✅ Clos : absente de l'historique | 9.20.0 | vérification faite par le propriétaire le 03/10/2026 |
| 026 | Gist : volumétrie des images | 🟢 (limites exactes de l'API GitHub non vérifiées en conditions réelles) | 9.28.0 | `lot7-images.test.js` |
| 027 | Collage non normalisé | 🟢 | 9.27.0 | `lot6-durcissement.test.js` ; test réel du collage |
| 028 | Cohérence KV / écriture non atomique | ✅ Résolu par D1 (écriture conditionnelle) | 9.23.0 | `sync-d1.test.js` (écritures simultanées) |

## Ce qui reste (pour un prochain audit)

1. **AUD-01-001** : décision du propriétaire, à revoir si l'application sort du cercle familial.
2. **Montée de version majeure de `docx`** (API différente) : la PR Dependabot #15 (7.1.0 → 9.8.1) a été fermée le 06/10/2026 ; à traiter dans un lot dédié (réécriture de `exportDocx` et de l'export DOCX du roman graphique).
3. **Tests navigateur automatisés** : procédure manuelle documentée (README).
4. **Quota D1 partagé** avec les autres projets du compte (surveiller `horizon-poi`).

## Pour relancer l'audit en mode comparaison

Fournir le document `Audit-01-Audit-technique-complet.docx` d'origine : chaque constat sera classé 🟢 Corrigé /
🟡 Persistant / 🔵 Nouveau / 🔴 Régression en s'appuyant sur ce bilan.
