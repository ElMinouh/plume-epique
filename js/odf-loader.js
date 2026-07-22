// v7.16.0 — Correction du bug de blocage CSP découvert sur l'export/import ODT.
// odf-kit est distribué en ESM uniquement (pas de build UMD classique), d'où
// l'usage de `<script type="module">` : exception ciblée et volontaire à
// l'ADR-1 (scripts classiques partout ailleurs). Ce petit module ne fait QUE
// charger la lib et l'exposer en global (window.odfKit), tout le reste de
// l'app reste en scripts classiques inchangés.
//
// Pourquoi un fichier séparé (et pas un <script type="module"> inline dans
// index.html, comme depuis la v7.13.0) : la Content Security Policy du
// projet (_headers) n'autorise PAS l'exécution de script inline
// (`script-src` ne contient ni 'unsafe-inline', ni nonce, ni hash — c'est
// voulu, c'est la protection principale contre le XSS). Un script inline,
// même de 3 lignes, est donc systématiquement bloqué par le navigateur, quel
// que soit le domaine des imports qu'il contient. Un script chargé via
// <script type="module" src="..."> depuis le même domaine, lui, est couvert
// par 'self' dans script-src : aucune modification de _headers n'est
// nécessaire, et aucune ouverture de sécurité n'est introduite.
import { htmlToOdt } from "https://cdn.jsdelivr.net/npm/odf-kit@0.9.2/+esm";
import { odtToHtml } from "https://cdn.jsdelivr.net/npm/odf-kit@0.9.2/odt-reader/+esm";
window.odfKit = { htmlToOdt, odtToHtml };
