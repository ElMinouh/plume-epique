# Librairies tierces (copies locales)

Ces fichiers sont des **copies exactes** des librairies que l'application chargeait auparavant depuis des CDN
(jsDelivr, unpkg, d3js.org). Depuis la v9.27.0 (audit AUD-01-003) elles sont servies par le site lui-même :
plus de dépendance à un site tiers, plus d'exécution de code externe, `script-src 'self'` dans `_headers`.

| Fichier | Paquet | Version |
|---|---|---|
| `dompurify-3.4.16.min.js` | dompurify | 3.4.16 |
| `chart-4.4.0.umd.min.js` | chart.js | 4.4.0 |
| `idb-8.0.3.umd.js` | idb | 8.0.3 |
| `docx-7.1.0.js` | docx | 7.1.0 |
| `file-saver-2.0.5.min.js` | file-saver | 2.0.5 |
| `d3-7.9.0.min.js` | d3 | 7.9.0 |
| `jszip-3.10.1.min.js` | jszip | 3.10.1 |
| `jspdf-4.2.1.umd.min.js` | jspdf | 4.2.1 |
| `html2canvas-1.4.1.min.js` | html2canvas | 1.4.1 |
| `mammoth-1.11.0.browser.min.js` | mammoth | 1.11.0 |
| `odf-kit-0.13.10.esm.js` | odf-kit / fflate / marked (modules ESM) | voir le nom |
| `odf-kit-reader-0.13.10.esm.js` | odf-kit / fflate / marked (modules ESM) | voir le nom |
| `odf-kit-document-0.13.10.esm.js` | odf-kit / fflate / marked (modules ESM) | voir le nom |
| `fflate-0.8.3.esm.js` | odf-kit / fflate / marked (modules ESM) | voir le nom |
| `marked-18.0.5.esm.js` | odf-kit / fflate / marked (modules ESM) | voir le nom |

Les trois modules ODT (`odf-kit-*.esm.js`) importent `fflate` et `marked` : leurs adresses `/npm/...` ont été
remplacées par des chemins relatifs vers les copies ci-dessus (c'est la seule modification apportée aux fichiers,
avec le retrait des lignes `sourceMappingURL`).

## Mettre à jour une librairie
1. Changer la version dans `package.json` (section `dependencies`) — Dependabot la propose automatiquement.
2. Télécharger le fichier de la nouvelle version (même chemin que ci-dessus sur jsDelivr/unpkg), le placer ici sous
   le nouveau nom, mettre à jour `index.html` et `sw.js` (CORE_ASSETS), puis relancer `npm test` (un test vérifie la
   cohérence index.html ↔ sw.js ↔ vendor/ ↔ package.json).

## Alertes connues
- `docx@7.1.0` embarque `nanoid@3.3.16` (avis GHSA-2v37-7h3g-55p8 : boucle infinie si un générateur personnalisé reçoit une taille 0). Plume ne s utilise pas de générateur personnalisé : exposition nulle. La montée de version majeure de `docx` (API différente) sera traitée avec Dependabot dans un lot dédié.
