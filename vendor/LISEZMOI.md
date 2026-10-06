# Librairies tierces (copies locales)

Ces fichiers sont des **copies exactes** des librairies que l'application chargeait auparavant depuis des CDN
(jsDelivr, unpkg, d3js.org). Depuis la v9.27.0 (audit AUD-01-003) elles sont servies par le site lui-même :
plus de dépendance à un site tiers, plus d'exécution de code externe, `script-src 'self'` dans `_headers`.

| Fichier | Paquet | Version |
|---|---|---|
| `dompurify-3.4.16.min.js` | dompurify | 3.4.16 |
| `chart-4.5.1.umd.min.js` | chart.js | 4.5.1 |
| `idb-8.0.3.umd.js` | idb | 8.0.3 |
| `docx-7.1.0.js` | docx | 7.1.0 |
| `file-saver-2.0.5.min.js` | file-saver | 2.0.5 |
| `d3-7.9.0.min.js` | d3 | 7.9.0 |
| `jszip-3.10.1.min.js` | jszip | 3.10.1 |
| `jspdf-4.2.1.umd.min.js` | jspdf | 4.2.1 |
| `html2canvas-1.4.1.min.js` | html2canvas | 1.4.1 |
| `mammoth-1.11.0.browser.min.js` | mammoth | 1.11.0 |
| `odf-kit-0.14.3.esm.js` | odf-kit / fflate / marked (modules ESM) | voir le nom |
| `odf-kit-reader-0.14.3.esm.js` | odf-kit / fflate / marked (modules ESM) | voir le nom |
| `odf-kit-document-0.14.3.esm.js` | odf-kit / fflate / marked (modules ESM) | voir le nom |
| `fflate-0.8.3.esm.js` | odf-kit / fflate / marked (modules ESM) | voir le nom |
| `marked-18.0.14.esm.js` | odf-kit / fflate / marked (modules ESM) | voir le nom |

Les trois modules ODT (`odf-kit-*.esm.js`) importent `fflate` et `marked` : leurs adresses `/npm/...` ont été
remplacées par des chemins relatifs vers les copies ci-dessus (c'est la seule modification apportée aux fichiers,
avec le retrait des lignes `sourceMappingURL`).

## Mettre à jour une librairie
1. Changer la version dans `package.json` (section `dependencies`) — Dependabot la propose automatiquement.
2. Télécharger le fichier de la nouvelle version (même chemin que ci-dessus sur jsDelivr/unpkg), le placer ici sous
   le nouveau nom, mettre à jour `index.html` et `sw.js` (CORE_ASSETS), puis relancer `npm test` (un test vérifie la
   cohérence index.html ↔ sw.js ↔ vendor/ ↔ package.json).

### Comment les fichiers générés par jsDelivr sont reproduits (vérifié le 06/10/2026)
Les fichiers `chart-*`, `odf-kit-*` et `marked-*` sont des versions générées par jsDelivr (en-tête « Bundled by jsDelivr »), obtenues avec :
- `https://cdn.jsdelivr.net/npm/odf-kit@VERSION/dist/index.js/+esm` (module principal) et `.../dist/reader/index.js/+esm` (lecture ODT) ;
- le module du document : `.../dist/odt/document.js/+esm` jusqu'à la 0.13.x, `.../dist/build-or-fill/build-odt/document.js/+esm` depuis la 0.14.x ;
- `https://cdn.jsdelivr.net/npm/marked@VERSION/lib/marked.esm.js/+esm` et `https://cdn.jsdelivr.net/npm/chart.js@VERSION/dist/chart.umd.min.js`.

Puis les deux seules modifications : chaque adresse `/npm/fflate…`, `/npm/marked…` ou du module du document devient le chemin relatif de la copie locale, et les lignes `//# sourceMappingURL=…` sont retirées.
Cette méthode a été rejouée sur les versions précédentes (odf-kit 0.13.10, marked 18.0.5, chart.js 4.4.0) et redonne les fichiers **à l'octet près**.
Après toute mise à jour : `npm test`, puis un essai réel d'export et d'import ODT, d'export EPUB et des graphiques (tension, statistiques).

## Alertes connues
- `mammoth@1.11.0` : `npm audit` signale (06/10/2026) 3 alertes modérées via `argparse` puis `sprintf-js` (GHSA-hp3w-g68c-fv3c, déni de service par précision illimitée). `argparse` ne sert qu'à l'outil en ligne de commande de mammoth : le fichier `mammoth-1.11.0.browser.min.js` servi par le site n'en contient pas (vérifié) et n'est pas concerné. La correction proposée par `npm audit` (`mammoth@0.3.29`) est une régression : à ne pas appliquer. À surveiller.
- `docx@7.1.0` embarque `nanoid@3.3.16` (avis GHSA-2v37-7h3g-55p8 : boucle infinie si un générateur personnalisé reçoit une taille 0). Plume ne s utilise pas de générateur personnalisé : exposition nulle. La montée de version majeure de `docx` (API différente) sera traitée avec Dependabot dans un lot dédié.
