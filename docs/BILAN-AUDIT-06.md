# Bilan de remédiation — audit de sécurité avancé n°6 (octobre 2026)

Base : v9.63.2 (note 55/100, maturité « Correcte »). Documents d'origine : `Claude outputs/Audit-06/` (non versionné) —
rapport `.docx`, liste `.csv`, preuve rejouable `poc-verification-worker.mjs`. Plan : 7 lots, 23 constats.

| Lot | Constats | État |
|---|---|---|
| 1 | 012, 013 | étape A livrée (v9.63.3) ; étape B : Worker sans repli KV prêt, déploiement après migration |
| 2 | 009, 010, 011, 022, 023 | codé en v9.64.0 (voir ci-dessous) |
| 3 | 001, 002, 017 | 3a (v9.65.0) et 3b (v9.65.1) codés |
| 4 | 003, 004, 006, 007 | 4a (004) codé en v9.66.0, écriture p2 activée en v9.66.1 ; 003 **accepté** (question conservée) ; 007 **annulé** ; 4b (006, rotation de la clé de données) **annulé** (12/10/2026) |
| 5 | 005, 018, 019, 021 | codé en v9.67.0 (005 **accepté**) |
| 6 | 008, 014, 015 | 014 et 015 codés en v9.68.0 ; 008 **annulé** |
| 7 | 016, 020 | codé en v9.69.0 (pas d'alerte ntfy) |

## Lot 1 — secrets d'exploitation et effacement réel

- **AUD-06-012** : `CLE-DE-SYNCHRONISATION-NE-PAS-PARTAGER.txt` et `backups-kv/` déplacés le 11/10/2026 de
  `…\OneDrive\Desktop\Plume` vers `C:\Secrets\Plume\`. **Reste à la charge du propriétaire (décision du 11/10/2026 : non
  fait)** : changer la clé de synchronisation et purger les anciennes versions OneDrive ; tant que ce n'est pas fait, la clé
  est à considérer comme exposée (la rotation est prévue avec la séparation des clés IA/synchro du lot 2).
- **AUD-06-013** : `scripts/migrer-kv-vers-d1.cjs` (essai à blanc, `--appliquer`, `--vider-kv --confirmer`), testé par
  `tests/vitest/lot-aud06-1-migration-kv.test.js`. Étape B : repli KV supprimé du Worker (`d1Store.read/version`), binding `PLUME_SYNC` retiré de
  `wrangler-sync.toml`, tests mis à jour (`sync-d1.test.js`), ancien Worker figé en fixture pour tester la migration.
  Sauvegarde de KV faite le 11/10/2026 (48 clés) dans `C:SecretsPlumeackups-kvkv-backup-2026-10-11.json`.

## Lot 2 — durcissement des Workers, des en-têtes et du dépôt publié (v9.64.0)

- **009** : jeton IA dérivé (Worker IA + `js/ai.js`), `scripts/generer-cle.cjs`, `scripts/installer-jeton-ia.cjs`, règle de limitation de débit à créer dans Cloudflare (docs/EXPLOITATION.md §6 bis). **Reste à la charge du propriétaire** : poser `AI_TOKEN`, créer la règle, retirer `SYNC_KEY` du Worker IA une fois tous les appareils à jour, et adopter une clé aléatoire (rotation différée, §6).
- **010** : CORS limité à l'application (403 sinon), corps lu en flux avec plafond, erreurs du Worker IA génériques.
- **011** : `_routes.json` + `functions/_middleware.js` (404 sur docs, worker, tests, scripts, CLAUDE.md, README, package*.json).
- **022** : `report-uri`/`report-to` + `Reporting-Endpoints` vers `/csp-report`, `Cross-Origin-Resource-Policy: same-origin`. **Écart par rapport au plan annoncé** : Trusted Types en mode rapport n'est PAS activé (≈ 170 `innerHTML` généreraient des milliers de rapports et consommeraient le quota de requêtes) ; reporté au lot 5 (constat 018), une fois les `innerHTML` assainis.
- **023** : en-tête `X-Plume-Client-Version` (toutes les requêtes vers le Worker de synchro), 426 sous `MIN_CLIENT_VERSION`, bandeau de rechargement.
- Tests : `tests/vitest/lot-aud06-2-durcissement.test.js` (23).

## Lot 3a — serrure par profil et quotas (v9.65.0)

- **001 / 002** (données d'un profil) : jeton dérivé de la clé de données (`Crypto.authToken`), empreinte en D1 (`profile_auth`), contrôle sur GET/PUT/DELETE de `data_`, `doclist_`, `doc_`, `aichat_`, `libsettings_`, `img_` ; verrouillage progressif ; le scénario d'attaque de l'audit (pierre tombale forgée + DELETE) est rejoué et refusé (test). **Écart avec le plan annoncé** : pas de pierres tombales signées ni de suppression logique de 30 jours : la serrure rend la forge impossible, le filet reste D1 Time Travel (7 jours).
- **017** : quotas 150 Mo / 2 000 clés par profil, 20 profils, garde-fou global 90 % ; message dans l'application sur 507. Le plafond d'appels IA reste la règle Cloudflare du lot 2 (pas de stockage côté Worker IA).
- **3b** (v9.65.1) : index `profiles` (ajout/suppression/rôle d'un profil), création du rôle administrateur côté serveur. **Pour le lot 4** : la rotation de la clé de données change le jeton ; prévoir le remplacement de l'empreinte sur le serveur.
- Tests : `tests/vitest/lot-aud06-3a-serrure-profil.test.js` (22).

## Lot 3b — protection de l'index des profils (v9.65.1)

- Contrôle par le Worker de chaque écriture de `profiles` (comparaison à la version courante, droit par profil modifié : son jeton ou celui d'un administrateur), rôle `admin` fixé côté serveur (colonne `role` ; migration douce de la table de la 9.65.0, les administrateurs déjà verrouillés gardent leur rôle), création de profil libre en simple utilisateur (20 au plus), validation du JSON (structure, identifiants, 200 Ko). L'essai T3 de l'audit (s'ajouter administrateur) est rejoué et refusé. Message à l'écran sur refus (« droits insuffisants »).
- **Risque résiduel documenté** : un profil pas encore verrouillé reste modifiable, et le premier arrivé verrouille (un tiers pourrait prendre un profil avant son propriétaire pendant la fenêtre de mise en place : voir docs/EXPLOITATION.md §6 ter pour la réparation).
- **Hors lot 3 (suite)** : effacement serveur des données d'un profil supprimé (lot 6, AUD-06-015) ; enveloppes de clés encore visibles dans l'index (lot 4).
- Tests : `tests/vitest/lot-aud06-3b-index-profils.test.js` (17).

## Lot 4a — coût de dérivation et mots de passe triviaux (v9.66.0)

- **004** : format `p2:` (coût écrit dans l'enveloppe, lu par tous dès la 9.66.0, écrit après activation : docs/EXPLOITATION.md §12) ; itérations lues bornées ; mots de passe triviaux refusés (création, récupération, changement), rappel non bloquant à la connexion ; ré-enveloppement automatique à la connexion quand l'écriture p2 sera activée.
- **003** : **risque accepté par le propriétaire (12/10/2026)** — la question secrète est conservée. Pistes non retenues : retirer la question, exiger une réponse plus longue. Le risque résiduel est atténué par 004 et sera refermé par la rotation de la clé de données (4b) pour les copies déjà prises.
- **007** : **annulé par le propriétaire (12/10/2026)** ; le risque (retour arrière ou échange d'enveloppes par qui contrôle le stockage) est réduit par la serrure par profil du lot 3.
- Tests : `tests/vitest/lot-aud06-4a-mots-de-passe.test.js` (36).

- **Activation (v9.66.1, 12/10/2026)** : `Crypto.writeP2 = true` sur confirmation du propriétaire ; chaque profil ré-enveloppe `wrapPwd` à 600 000 itérations à sa prochaine connexion par mot de passe.

## Lot 4b — rotation de la clé de données : ANNULÉ (12/10/2026)

**AUD-06-006 : risque accepté / reporté par le propriétaire.** Après présentation (probabilité faible mais gravité élevée : un défaut du rechiffrement peut faire perdre des manuscrits ; code jamais éprouvé sur de vraies données), le propriétaire a annulé le lot. Mesures retenues à la place : rotation de la clé de synchronisation (docs/EXPLOITATION.md §6, à la main du propriétaire), suppression des anciennes sauvegardes de `C:\Secrets\Plume\backups-kv\` quand elles ne servent plus, et réexamen en fin d'audit (éventuellement pour le seul profil du propriétaire, avec sauvegarde obligatoire et test de panne à chaque étape). Rappel : changer le mot de passe ne change pas la clé de données ; une copie d'enveloppe prise par le passé reste exploitable (réponse secrète faible, AUD-06-003).

## Lot 5 — saisies et jeton GitHub (v9.67.0)

- **005** : **risque accepté par le propriétaire (12/10/2026)**. La clé de données (session « Rester connecté », 12 h par défaut, option « Toujours ») et la clé de synchronisation restent stockées en clair dans le navigateur. Mesures proposées et non retenues : retirer « Toujours » (plafond 7 jours), chiffrer ces secrets par une clé d'appareil (gain modeste : sans effet contre un script déjà dans la page), verrouillage par inactivité. Recommandation : verrouiller la session du système d'exploitation, ne pas utiliser « Toujours » sur un appareil partagé.
- **018** : toute valeur insérée dans un ATTRIBUT HTML passe par `escapeHtml` (jamais DOMPurify, qui assainit du HTML de contenu) ; identifiants (`d.id`, `p.id`, `l.id`…) échappés. Test qui interdit le motif (`lot-aud06-5-saisies.test.js`). Trusted Types toujours non activé (≈ 170 `innerHTML`, voir lot 2).
- **019** : limites d'import larges (3 × les usages réels, demandé par le propriétaire) : Word/ODT 300 Mo, contenu décompressé 3 Go (anti-bombe de décompression, lecture de l'annuaire du ZIP seulement), JSON de bibliothèque 900 Mo ; forme de chaque manuscrit importé vérifiée ; messages avec la taille et un conseil. **Réserve** : au-delà d'environ 500 Mo, la lecture d'un JSON en texte peut échouer d'elle-même dans le navigateur (limite de taille d'une chaîne de caractères) ; l'erreur de lecture est alors affichée.
- **021** : aide sous le champ du jeton (granularité fine, droit « Gists » seul, 90 jours), avertissement non bloquant si le jeton classique donne accès aux dépôts/administration (`X-OAuth-Scopes`), en-tête `Authorization: Bearer` partout.
- Tests : `tests/vitest/lot-aud06-5-saisies.test.js` (14).

## Lot 6 — vie privée et conformité (v9.68.0)

- **008** : **annulé par le propriétaire (12/10/2026)**. Les titres, nombres de mots, couvertures et dates des manuscrits, les prénoms des profils et la question de sécurité restent en clair sur le serveur ; la politique de confidentialité le dit. Solution étudiée : chiffrer `doclist_*` à la frontière réseau (identifiants des manuscrits supprimés laissés en clair pour le Worker), activation en deux temps (un appareil ancien verrait une bibliothèque vide).
- **014** : consentement refusable (écran Accepter / Refuser, champ `externalServices` par profil, réglage dans Mon profil), appliqué à l'IA (×5), la mémoire narrative, le lexique, la reformulation du roman graphique, le correcteur LanguageTool et la dictée vocale ; notice nommant la dictée ; les profils ayant vu l'ancienne notice sont re-sollicités une fois. **Non inclus** : aperçu du texte avant envoi, changement de fournisseur IA (offre payante / européenne : coût, décision du propriétaire).
- **015** : effacement serveur d'un profil supprimé (opération dédiée vérifiée par le Worker, reprise hors ligne), écritures refusées pour un profil supprimé, page « Politique de confidentialité » (usage personnel et familial, pas de mineurs sans adulte responsable), durées de conservation documentées (docs/EXPLOITATION.md §6 quater). Mineurs / usage scolaire : **non applicable aujourd'hui**, bloquant avant tout usage scolaire (consentement parental, hébergement UE, contrats avec les sous-traitants).
- Tests : `tests/vitest/lot-aud06-6-vie-privee.test.js` (17) ; trois tests existants adaptés au nouveau consentement.
- **v9.68.1** (corrections constatées au test réel local) : un profil supprimé ne pouvait pas être « re-verrouillé » par une simple lecture avec jeton (le Worker refuse désormais TOUTE requête d'un profil portant une pierre tombale, code `profile-deleted`) ; la politique de confidentialité s'ouvre et se ferme aussi depuis la bibliothèque (menu Aide, bureau et mobile) ; test de non-régression ajouté (18 tests dans `lot-aud06-6-vie-privee.test.js`).
- **v9.68.2** (signalé par le propriétaire : « impossible de fermer la politique de confidentialité ») : la fenêtre n'avait AUCUNE règle CSS (`#privacy-overlay` absent de `style.css`) : elle s'affichait en permanence à la suite de la page et le bouton Fermer n'avait donc aucun effet visible. Ajoutée à toutes les règles partagées avec `#shortcuts-overlay` (masquage, affichage `.active`, animations) + test de non-régression. **Leçon** : un test qui ne regarde que l'état (`classList`) ne voit pas une fenêtre sans CSS ; les parcours qui ajoutent une fenêtre doivent être contrôlés à l'écran (capture), ce que j'ai omis à la 9.68.0.

## Lot 7 — surveillance et chaîne d'approvisionnement (v9.69.0)

- **016** : journal Workers Logs enrichi (`pid` = empreinte du profil qui agit, `cc` = pays), registre D1 `security_events` (30 jours, plafonné, événements : échecs de clé, frein, refus de serrure, refus de la liste des profils, quotas, suppressions, effacements de profil, verrouillages, changements de rôle), lecture `?key=__security__` et `scripts/evenements-securite.cjs`. **Alertes automatiques non retenues** (ntfy refusé par le propriétaire, 12/10/2026) : le registre se consulte à la demande.
- **020** : `vendor/SHA256SUMS` (25 fichiers) + test + CI ; **9 bibliothèques sur 9 vérifiées identiques aux paquets npm officiels** (seule la ligne `sourceMappingURL` est retirée) ; CI à droits minimaux, audit « élevé » bloquant, `npm audit signatures` (179 paquets signés) ; protection de `main` contre le push forcé et la suppression ; liste de contrôle du propriétaire (2FA GitHub et Cloudflare, jeton Cloudflare à droits minimaux avec expiration) dans docs/EXPLOITATION.md §6 quinquies. **Non retenu** : isolation des bibliothèques dans un cadre étanche (risque assumé).
- Tests : `tests/vitest/lot-aud06-7-surveillance.test.js` (18).

## Bilan de l'audit AUD-06 (12/10/2026)

23 constats : **18 traités** (001, 002, 004, 009, 010, 011, 012, 013, 014, 015, 016, 017, 018, 019, 020, 021, 022, 023 ; **012 et 013 sont à finir à la main** : rotation de la clé de synchronisation et vidage de l'ancien KV ; **022** : Trusted Types non activé, voir lot 2), **5 acceptés ou annulés par le propriétaire** (003 question secrète conservée ; 005 session en clair ; 006 rotation de la clé de données ; 007 liaison des données à leur emplacement ; 008 titres de manuscrits en clair). Les alertes automatiques (ntfy) ont aussi été refusées (volet de 016).

**Mise à jour du 12/10/2026 (fin d'audit)** : l'ancien KV de synchronisation est **supprimé** (tableau de bord Cloudflare ; le jeton `wrangler` du poste n'a pas le droit d'y supprimer, ce qui est voulu ; contrôle préalable en lecture seule : 48 clés, 9 « null », aucune donnée absente de D1 ; sauvegarde du 11/10 conservée dans `C:\Secrets\Plume\backups-kv\`). **013 est donc clos.** Restent à la main du propriétaire : rotation de la clé de synchronisation (**012**), suppression des secrets `SYNC_KEY` (Worker IA) et `MISTRAL_API_KEY`, liste de contrôle de `docs/EXPLOITATION.md` §6 quinquies.
