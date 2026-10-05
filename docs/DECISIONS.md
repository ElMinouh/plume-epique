# Décisions d'architecture

Chaque décision : le choix, la raison, ce qu'on a écarté. Les numéros ne sont pas ceux des anciennes mentions « ADR-n »
du code (dont l'historique est resté dans les commentaires et dans `docs/HISTORIQUE.md`).

| # | Décision | Raison | Écarté |
|---|---|---|---|
| 1 | **Scripts classiques, pas de bundler**, scope global partagé (`db`, `cur`…) | Simplicité de déploiement (fichiers statiques) ; ordre de chargement documenté dans `CLAUDE.md` | Modules ES + bundler : refonte lourde pour peu de gain à cette échelle |
| 2 | **Une clé de données (DEK) par profil**, enveloppée trois fois (mot de passe, réponse secrète, code de récupération) | Récupérer l'accès sans jamais stocker la clé en clair ; profils étanches | Mot de passe maître unique ; récupération par l'administrateur |
| 3 | **Question secrète conservée** (décision du propriétaire, 03/10/2026) | Commodité de récupération pour un usage familial | La remplacer par une phrase de secours forte (proposée, non retenue). Risque connu : réponse devinable par quelqu'un qui accède à l'index des profils |
| 4 | **Format de texte v2 (clé dérivée une fois par HKDF, plus de PBKDF2 à chaque enregistrement)**, déploiement en deux temps : étape 1 (v9.31.0) tous les appareils **lisent** v2 ; étape 2 (**v9.32.0, activée le 06/10/2026** sur confirmation du propriétaire que tous les appareils étaient à jour) : on **écrit** v2 (`Crypto.writeV2 = true`). Retour arrière : `writeV2 = false` | Un appareil sur une version plus ancienne ne sait pas lire v2 ; PBKDF2 mesuré à ~27 ms/enveloppe sur PC contre 0,1 ms en v2 (le gain concerne surtout les téléphones) | Écriture immédiate du nouveau format |
| 5 | **Synchronisation à versions** : chaque clé a un numéro croissant, écriture refusée (409) si la base est périmée ; arbitrage à trois voies côté client | Incident du 27/07/2026 | « Dernier qui écrit gagne » |
| 6 | **Envoi en ligne après une pause** (1 min, 5 min au plus), immédiat à la fermeture / changement d'onglet ; file de reprise persistée | Quota d'écritures gratuit ; l'enregistrement local, lui, reste instantané | Envoi à chaque frappe ; espacement fixe puis adaptatif (20/45/90 s) |
| 7 | **Stockage de synchro sur Cloudflare D1** (écriture conditionnelle, cohérence immédiate, Time Travel 7 j), valeurs découpées en morceaux de 600 000 caractères, transition par lecture de repli sur KV | 100 000 écritures/jour au lieu de 1 000 ; atomicité ; sauvegarde | Durable Objects (plus complexe), R2 (carte bancaire probable), envoi de différences (n'économise pas des écritures) |
| 8 | **Suppressions propagées par pierres tombales** (90 jours) dans l'index de bibliothèque | Éviter les manuscrits « fantômes » ; la fusion ne savait qu'ajouter | Suppression locale seulement |
| 9 | **Historique « espacé »** : 15 min / 3 h / 2 jours sur un mois, 20 copies maximum, instantanés manuels toujours gardés | 30 copies serrées = 2 h 30 de recul pour 95 % du poids d'un manuscrit | Plafond par taille ; séparer ou compresser l'historique (format plus lourd à faire évoluer) |
| 10 | **Images du roman graphique : chiffrées au repos** (AES-GCM, clé HKDF du profil), **synchronisées** une fois chacune via le Worker (`img_*`, budget 350 Mo), Gist par paquets de 8 Mo | Cohérence du chiffrement ; livre illustré utilisable sur plusieurs appareils | Images en clair ; synchro par Gist uniquement |
| 11 | **Aucune librairie externe** : `vendor/` (versions exactes), `script-src 'self'` | Chaîne d'approvisionnement, disponibilité, alertes de sécurité | CDN + SRI (reste une dépendance de disponibilité) |
| 12 | **CSP sans `unsafe-inline`** : ni script ni style en ligne ; couleurs via classes CSS | Défense en profondeur contre le XSS | Autoriser les styles en ligne |
| 13 | **Relais IA protégé par la clé de synchronisation**, taille bornée | Empêcher l'usage de la clé Gemini par un tiers | Relais ouvert (limité par CORS seulement) |
| 14 | **Une clé de synchronisation commune** à tous les profils d'un foyer | Usage familial ; simplicité | Un jeton par profil (plus d'isolation, plus de travail) |
| 16 | **Effacement serveur d'un manuscrit supprimé conditionné à la pierre tombale** (vérifiée par le Worker lui-même), jamais pour profils/index/réglages | Tenir la promesse « supprimé définitivement » sans qu'un client défaillant puisse effacer un manuscrit vivant | DELETE libre sur tout `doc_*` ; ne rien effacer côté serveur |
| 15 | **Les tests « en réel » restent manuels** sur copie locale (procédure du README) | Choix du propriétaire : pas d'outil de test navigateur à installer | Playwright en CI |

## Principes qui reviennent

- **Rien n'est perdu en silence** : conflits mis en pause et sauvegardés, valeur serveur `null` jamais appliquée, l'index des
  profils ne peut pas rétrécir, purge d'image seulement après recomptage des usages.
- **Local d'abord** : l'enregistrement local est instantané ; le réseau ne bloque jamais l'écriture.
- **Prouver par un test** : chaque correction d'incident a un test qui échoue sur l'ancien code.
