'use strict';
// ═══════════════════════════════════════════════════════
// ICÔNES VECTORIELLES (v9.51.0, audit AUD-04-002/003/023)
// Remplace les emojis de l'interface : trait fin monochrome (currentColor), donc cohérent sur tous les appareils,
// qui suit le thème, la palette et la couleur du bouton qui le porte.
// · Le sprite <symbol id="i-NOM"> est dans index.html (généré par scripts/build-icons.cjs depuis lucide-static,
//   version figée dans package.json, licence ISC) — aucune requête réseau, aucune modification de la CSP.
// · Dans un gabarit HTML écrit en JavaScript : icon('search') ; avec une classe : icon('chevron-down', 'icon-caret').
// · Les emojis restent réservés au CONTENU choisi par l'auteur ; ni boutons, ni titres, ni messages.
//
// LEXIQUE — un nom = un sens, jamais réutilisé pour autre chose :
//   x fermer/effacer · search rechercher/filtrer · plus ajouter · trash-2 supprimer · pencil renommer/modifier
//   upload exporter · download importer/installer · save sauvegarder · refresh-cw synchroniser/régénérer
//   focus mode Focus · target quête/objectif · book-open chapitre/manuscrit · library bibliothèque
//   user compte/personnage · users personnages · castle lieux · network relations · bot assistant IA
//   sparkles synonymes/génération · circle-help aide · info information · triangle-alert avertissement
//   circle-check validé/succès · circle-x erreur · cloud synchro/GitHub · key-round clé · lock confidentialité
//   shield sécurité · history/clock versions/heure · moon thème sombre · sun thème clair · scroll-text thème papier
// ═══════════════════════════════════════════════════════
const ICON_NAMES = ["archive","arrow-left","arrow-left-right","arrow-right","arrow-up-down","book","book-open","bookmark","bot","brain","calendar","camera","castle","chart-column","chart-line","check","chevron-down","chevron-right","chevron-up","circle","circle-alert","circle-check","circle-help","circle-x","clipboard-copy","clock","cloud","compass","copy","database","download","ellipsis-vertical","eraser","eye","eye-off","feather","file","file-down","file-text","files","focus","folder","folder-open","globe","graduation-cap","grip-vertical","hard-drive","highlighter","history","image","image-plus","images","info","key-round","laptop","layers","layout-grid","library","life-buoy","lightbulb","link","list-tree","lock","lock-open","log-out","maximize","menu","message-square","mic","minimize","moon","move","network","notebook","palette","party-popper","pause","pen-line","pencil","play","plug","plus","rectangle-horizontal","redo-2","refresh-cw","replace","rotate-ccw","route","save","scissors","scroll-text","search","send","settings","share-2","shield","smartphone","sparkles","square","square-round-corner","sun","tag","target","timer","trash-2","triangle-alert","type","undo-2","upload","user","users","wand-sparkles","wifi-off","wrench","x"];
function icon(name, cls) {
  return '<svg class="icon' + (cls ? ' ' + cls : '') + '" aria-hidden="true" focusable="false"><use href="#i-' + name + '"></use></svg>';
}
