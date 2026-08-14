'use strict';
// ═══════════════════════════════════════════════════════
// VISITE GUIDÉE COMPLÈTE (nouveau v7.39.0)
// Distincte du tour "premiers pas" (notifications.js, 4 bulles, montré une
// seule fois automatiquement à la 1ère ouverture d'un manuscrit). Celle-ci
// ne s'affiche JAMAIS toute seule : elle se relance à volonté depuis les
// boutons de la bibliothèque (voir library.js). Elle est exhaustive (une
// étape par fonction ou groupe de fonctions apparentées) et NAVIGUE
// réellement dans l'app pour chaque étape : bon onglet ouvert, bon
// sous-onglet ou menu déroulant déplié, reste de l'écran assombri autour
// de l'élément mis en valeur ("spotlight"), bulle ancrée juste en dessous.
//
// Chaque étape peut définir :
//   subtab      : id de sous-onglet à ouvrir via openTabOrSubtab() (tabs.js)
//   clickFirst  : sélecteur d'un bouton à cliquer avant de chercher la cible
//                 (ex. ouvrir un menu déroulant de la barre d'outils) — un
//                 clic réel est simulé, l'app gère elle-même l'ouverture,
//                 exactement comme si l'utilisateur avait cliqué.
//   target      : sélecteur de l'élément à mettre en valeur.
//   title, text : contenu de la bulle, rédigé pour un néophyte complet.
// ═══════════════════════════════════════════════════════

const LIBRARY_TOUR_STEPS = [
  { target:'#library-new-btn, #library-new-btn-shelf', title:'📚 Vos manuscrits',
    text:"Chaque roman que vous écrivez est un « manuscrit » séparé : ses propres chapitres, personnages et réglages, indépendants des autres. Ce bouton en crée un tout nouveau, vierge. Les manuscrits déjà commencés apparaissent juste en dessous sous forme de couvertures — un clic dessus les rouvre là où vous les avez laissés." },
  // v9.0.0 — Bug rapporté : sur mobile, ces boutons sont cachés derrière le
  // menu "⋯" (chantier Responsive Mobile, écran 2/N) — la cible était donc
  // invisible, l'étape sautée, et de même pour l'étape suivante, ce qui
  // terminait la visite d'un coup après l'étape 1/3. ensureLibraryMenuOpen
  // ouvre le menu "⋯" si besoin (sans effet sur desktop, où il reste
  // masqué), et le sélecteur de cible liste aussi l'équivalent qui y
  // apparaît.
  { ensureVisible:ensureLibraryMenuOpen, target:'#library-system-btn, #ltop-system', title:'💾 Système',
    text:"Ce bouton regroupe tout ce qui protège votre travail : la sauvegarde automatique sur GitHub (un service gratuit de stockage en ligne, indépendant de cet ordinateur), la synchronisation si vous écrivez depuis plusieurs appareils, et l'export ou l'import de vos manuscrits sous forme de fichier." },
  { ensureVisible:ensureLibraryMenuOpen, target:'#library-manage-profiles-btn, #ltop-manage-profiles', title:'👤 Gérer les profils',
    text:"Si plusieurs personnes se servent de cet ordinateur pour écrire, chacune peut avoir son propre profil protégé par mot de passe : ses manuscrits restent invisibles pour les autres. Ce bouton, réservé au compte administrateur, permet d'ajouter ou de retirer des profils." }
];

// v9.2.3 — Repositionnement de fonctions selon l'appareil : sur PC, la barre
// d'outils garde Synonymes/Antonymes ; sur mobile, faute de place, ce bloc a
// rejoint IA & Mémoire → IA, aux côtés du Résumé de chapitre et de "Discuter
// de la sélection" (qui, eux, ont quitté la barre d'outils pour de bon, sur
// les deux appareils). La visite complète pointe donc vers des emplacements
// différents selon l'appareil utilisé.
function isMobileDevice() { return window.innerWidth <= 768; }

const FULL_TOUR_TOOLBAR_STEPS_COMMON = [
  { target:'.toolbar', title:'🛠️ La barre d\'outils',
    text:"Juste au-dessus de votre texte, et qui vous suit désormais au défilement : les boutons G (gras), I (italique) et S (souligné) mettent en forme la sélection en cours, 🖍️ Surligner colore le passage sélectionné (8 couleurs au choix), et les flèches courbes annulent ou rétablissent votre dernière action. Les menus déroulants à droite en couvrent bien plus — on les découvre juste après." },
  { clickFirst:'.toolbar-dropdown-btn.u-bg-h34495e', target:'.toolbar-dropdown-btn.u-bg-h34495e', title:'¶ Paragraphe',
    text:"Ce menu transforme la ligne où se trouve votre curseur : « Titre » pour un sous-titre de section, « Paragraphe normal » pour revenir à du texte simple." },
  { clickFirst:'.toolbar-dropdown-btn.u-bg-hc0392b', target:'.toolbar-dropdown-btn.u-bg-hc0392b', title:'🛠️ Outils d\'écriture',
    text:"Ce menu regroupe six aides à l'écriture : insérer la date et l'heure actuelles à l'endroit du curseur (premier bouton du menu), surligner les mots que vous répétez trop souvent, nettoyer ces surlignages, passer en Mode Focus (plein écran, sans distraction), relire tout le roman à la suite comme un vrai lecteur (Mode Lecture), et écrire ou vous faire lire le texte à voix haute (dictée)." },
  { clickFirst:'.toolbar-dropdown-btn.u-bg-h1a1a2e', target:'.toolbar-dropdown-btn.u-bg-h1a1a2e', title:'🔎 Rechercher',
    text:"Deux façons de retrouver du texte : dans tout le projet à la fois (tous les chapitres), ou seulement dans le chapitre actuel avec possibilité de remplacer le mot trouvé par un autre." }
];
// PC uniquement : Synonymes/Antonymes reste visible en permanence dans la
// barre d'outils (pas sur mobile, où ce bloc a rejoint IA & Mémoire → IA).
const FULL_TOUR_TOOLBAR_STEP_LEX_DESKTOP =
  { ensureVisible:ensureLexToolsOpen, target:'#search-btn', title:'✨ Synonymes & antonymes',
    text:"Toujours visible dans la barre d'outils (PC uniquement) : tapez un mot dans le petit champ, choisissez « Synonymes » ou « Antonymes » dans le menu, puis cliquez sur GO pour obtenir des suggestions." };

const FULL_TOUR_AI_STEP_DESKTOP =
  { subtab:'tab-ai', title:'🤖 Assistant IA (page dédiée)',
    text:"Cinq aides à la demande : un résumé automatique du chapitre en cours, la possibilité de discuter d'un passage sélectionné avec l'assistant, des idées pour poursuivre le chapitre, une vérification des incohérences avec vos fiches Personnages, et un générateur de noms de personnages selon le genre de votre histoire." };
const FULL_TOUR_AI_STEP_MOBILE =
  { subtab:'tab-ai', title:'🤖 Assistant IA (page dédiée)',
    text:"Sur mobile, toutes les aides IA sont regroupées ici, faute de place dans la barre d'outils : résumé automatique du chapitre, discuter d'un passage sélectionné, idées pour poursuivre le chapitre, vérification des incohérences, générateur de noms de personnages, et les synonymes/antonymes." };

const FULL_TOUR_STEPS_REST = [
  { subtab:'tab-chars', title:'👥 Personnages',
    text:"Une fiche par personnage de votre histoire : description, apparence, tout ce que vous voulez garder en mémoire à leur sujet. L'assistant IA peut ensuite vérifier que votre texte ne les contredit pas (voir l'onglet IA)." },
  { subtab:'tab-places', title:'🏰 Lieux',
    text:"Le même principe que les personnages, mais pour les lieux de votre histoire : une fiche par endroit, pour ne jamais perdre le fil d'un décor déjà décrit." },
  { subtab:'tab-quests', title:'🎯 Quêtes',
    text:"Suivez ici les fils narratifs de votre histoire — les intrigues en cours, résolues, ou encore en suspens — pour ne pas en perdre le fil au fil des chapitres." },
  { subtab:'tab-timeline', title:'🕐 Chronologie',
    text:"Une frise du temps qui passe dans votre histoire : ajoutez un événement, une date ou un moment, et reliez-le si besoin à un chapitre précis. Utile pour garder une cohérence temporelle sur un roman long." },
  { subtab:'tab-graph', title:'🕸️ Relations',
    text:"Un schéma visuel qui relie automatiquement vos personnages, lieux et quêtes entre eux, à partir de ce qui est mentionné dans votre texte. Pratique pour voir d'un coup d'œil qui est lié à quoi." },
  { subtab:'tab-memory', title:'🧠 Mémoire narrative',
    text:"Indexez tout votre roman en un clic, puis posez n'importe quelle question dessus en langage naturel — par exemple « que portait Léa au chapitre 3 ? ». L'assistant IA retrouve le passage concerné pour vous." },
  { subtab:'tab-stats', title:'📊 Statistiques',
    text:"Vos chiffres d'écriture : nombre de mots total, progression du jour, et l'historique de vos séances d'écriture sous forme de graphique." },
  { subtab:'tab-wordcloud', title:'☁️ Nuage de mots',
    text:"Un nuage visuel des mots les plus utilisés dans votre texte — utile pour repérer un tic de langage ou un mot que vous employez sans vous en rendre compte." },
  { subtab:'tab-analytics', title:'📈 Détail (longueur & lisibilité)',
    text:"La longueur de chaque chapitre comparée aux autres, un score de lisibilité (à quel point votre texte est facile à lire), et la part de dialogue par rapport à la narration." },
  { subtab:'tab-map', title:'🏗️ Structure (tension narrative)',
    text:"Une courbe qui représente la tension de votre histoire chapitre après chapitre. Le curseur « Tension » dans la colonne de gauche règle la valeur du chapitre que vous êtes en train d'écrire." },
  { subtab:'tab-history', title:'🔖 Versions',
    text:"Plume enregistre automatiquement des copies de chaque chapitre au fil de l'écriture (« snapshots »). Cet onglet permet de consulter ou de restaurer une version antérieure si vous changez d'avis, ou de comparer deux versions entre elles." },
  { subtab:'tab-plugins', title:'🔌 Plugins',
    text:"Des modules complémentaires que vous pouvez activer ou désactiver selon vos besoins, sans jamais toucher au reste de l'application." },
  { subtab:'tab-config-main', title:'⚙️ Réglages',
    text:"L'apparence de l'app (couleurs, thème clair/sombre/papier, police d'écriture), le type de votre projet (roman, polar, essai...), vos objectifs de mots, et les mots que vous voulez traquer comme « faibles »." },
  { subtab:'tab-sprint', title:'⏱️ Sprint',
    text:"Un chronomètre pour une session d'écriture concentrée et minutée — utile pour se fixer un temps d'écriture court et s'y tenir." },
  { target:'#tab-menu', title:'🗂️ Réorganiser les onglets',
    text:"Ces cinq onglets peuvent être réordonnés selon vos habitudes : faites-les glisser, ou utilisez Alt + flèche gauche/droite au clavier une fois un onglet sélectionné." },
  { target:'#mode-bar', title:'📍 Le bandeau du bas',
    text:"Toujours visible, quel que soit l'endroit où vous êtes : l'état de l'enregistrement automatique, le thème clair/sombre, la dictée vocale, le chat avec l'assistant IA, et l'état de la synchronisation entre appareils." },
  { target:'#toggle-dark-btn', title:'🌙 Thème clair / sombre',
    text:"Bascule instantanément entre un fond clair et un fond sombre, pour écrire confortablement de jour comme de nuit. Un réglage plus complet (palette de couleurs, thème papier, police) se trouve dans Config → Réglages." },
  { target:'#dictate-btn', title:'🎤 Dictée vocale',
    text:"Écrivez à voix haute : votre micro transcrit automatiquement ce que vous dites directement dans le chapitre en cours." },
  { target:'#ai-chat-btn', title:'💬 Discuter avec l\'assistant IA',
    text:"Ouvre une conversation libre avec l'assistant IA, qui a accès au contexte de votre roman pour répondre à vos questions ou vous aider à réfléchir à la suite." },
  { target:'#shortcuts-hint-btn', title:'❔ Raccourcis clavier',
    text:"Un aide-mémoire de tous les raccourcis clavier disponibles (Ctrl+B pour le gras, la touche « ? » pour rouvrir cette aide, et bien d'autres)." }
];

// Point d'entrée unique : reconstruit la liste d'étapes selon l'appareil au
// moment où la visite est lancée (et non une fois pour toutes au chargement),
// pour rester correct même si la fenêtre a été redimensionnée depuis.
function getFullTourSteps() {
  const mobile = isMobileDevice();
  const toolbarSteps = mobile
    ? FULL_TOUR_TOOLBAR_STEPS_COMMON
    : [...FULL_TOUR_TOOLBAR_STEPS_COMMON, FULL_TOUR_TOOLBAR_STEP_LEX_DESKTOP];
  return [
    { target:'#chapter-sidebar', title:'📖 Vos chapitres',
      text:"Cette colonne liste, dans l'ordre, tous les chapitres de votre manuscrit. Cliquez sur l'un d'eux pour l'ouvrir et l'écrire. Vous pouvez les faire glisser pour changer leur ordre ; la petite icône de corbeille en haut retrouve les chapitres supprimés pendant 30 jours, au cas où." },
    { target:'#chapter-title-row', title:'✏️ Titre, statut et notes du chapitre',
      text:"Le grand titre en haut de la page se modifie en cliquant simplement dessus. Le menu déroulant à côté (Brouillon / À revoir / Final) indique où en est ce chapitre. Le bouton « Notes » ouvre un espace pour un objectif de mots et des notes de recherche propres à ce seul chapitre." },
    ...toolbarSteps,
    ...FULL_TOUR_STEPS_REST.slice(0, 5), // Personnages → Relations
    mobile ? FULL_TOUR_AI_STEP_MOBILE : FULL_TOUR_AI_STEP_DESKTOP,
    ...FULL_TOUR_STEPS_REST.slice(5) // Mémoire narrative → Raccourcis clavier
  ];
}

// ═══════════════════════════════════════════════════════
// MOTEUR — commun aux deux tours ci-dessus
// ═══════════════════════════════════════════════════════
let _fullTourSteps = [], _fullTourIdx = 0, _fullTourActive = false;
let _tourPrevActiveTabId = null;

function startFullTour(steps) {
  if (!steps || !steps.length) return;
  // v9.0.0 — Bug rapporté : à la fin de la visite complète, l'onglet
  // "Config" (dernière catégorie traversée par les étapes) restait affiché
  // au lieu de revenir à ce qui était ouvert avant de lancer la visite. On
  // mémorise ici l'onglet actif d'origine (s'il y en avait un) pour le
  // restaurer dans endFullTour().
  const prevBtn = document.querySelector('.tab-btn.active');
  _tourPrevActiveTabId = prevBtn ? prevBtn.dataset.tabId : null;
  _fullTourSteps = steps;
  _fullTourIdx = 0;
  _fullTourActive = true;
  document.getElementById('full-tour-spotlight').classList.add('active');
  document.getElementById('full-tour-bubble').classList.add('active');
  showFullTourStep();
}

// v9.0.0 — Ouverture GARANTIE (jamais une fermeture) des deux menus repliés
// sur mobile dont la visite a besoin. N'agit que si le déclencheur est
// visible (mobile) ET que le menu n'est pas déjà ouvert ; ne fait rien sur
// desktop (déclencheur masqué par CSS, cible déjà visible directement).
function ensureLibraryMenuOpen() {
  const menu = document.getElementById('library-topbar-overflow-menu');
  const btn = document.getElementById('library-topbar-more-btn');
  if (!menu || !btn || !isVisible(btn)) return;
  if (!menu.classList.contains('open')) btn.click();
}
function ensureLexToolsOpen() {
  const group = document.getElementById('lex-tools-group');
  const btn = document.getElementById('lex-tools-toggle-btn');
  if (!group || !btn || !isVisible(btn)) return;
  if (!group.classList.contains('open')) btn.click();
}

function isVisible(el) {
  return !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

// v9.0.0 — Un sélecteur d'étape peut désormais lister plusieurs candidats
// séparés par une virgule (ex. bouton desktop + équivalent du menu "⋯" sur
// mobile) : on retient le premier RÉELLEMENT VISIBLE, pas juste le premier
// trouvé dans l'ordre du document (qui pouvait être un bouton caché par une
// media query mobile, voir bug de la visite bibliothèque).
function resolveVisibleTarget(selector) {
  if (!selector) return null;
  const candidates = document.querySelectorAll(selector);
  for (const el of candidates) { if (isVisible(el)) return el; }
  return null;
}

function showFullTourStep() {
  // Ferme un éventuel menu déroulant resté ouvert depuis l'étape précédente
  // (même mécanisme qu'un clic réel en dehors du menu).
  document.body.click();

  const step = _fullTourSteps[_fullTourIdx];
  if (!step) { endFullTour(); return; }

  if (step.subtab) openTabOrSubtab(step.subtab);
  // v9.0.0 — clickFirst ne déclenche le clic que si l'élément est
  // réellement visible : le bouton "⋯" de la bibliothèque existe toujours
  // dans le DOM sur desktop (juste masqué par CSS), le cliquer quand même
  // ouvrirait inutilement son menu déroulant en plein écran desktop.
  if (step.clickFirst) { const trig = document.querySelector(step.clickFirst); if (trig && isVisible(trig)) trig.click(); }
  // v9.0.0 — Bug rapporté : clickFirst sur un bouton "bascule" (ouvre/ferme)
  // pouvait, selon l'état déjà en cours, le REFERMER au lieu de l'ouvrir —
  // une étape sur deux se retrouvait alors sautée (bibliothèque : 1/3 puis
  // 3/3 ; visite complète : Synonymes & antonymes sauté). ensureVisible
  // vérifie l'état actuel et ne clique QUE si c'est nécessaire pour ouvrir,
  // jamais pour fermer — résultat toujours prévisible.
  if (step.ensureVisible) step.ensureVisible();

  requestAnimationFrame(() => {
    // Correction (bug rapporté) : les étapes "sous-onglet" (Personnages,
    // Lieux, Statistiques...) ne définissent qu'un `subtab`, pas de
    // `target` — document.querySelector(undefined) ne trouvait donc jamais
    // rien, et l'étape était aussitôt sautée (visible dans le compteur :
    // un saut direct de 8/29 à 24/29). On dérive ici le même sélecteur que
    // celui déjà utilisé pour les icônes ⓘ (voir helpIconAnchorFor
    // ci-dessous), qui cible le bouton du sous-onglet lui-même.
    const targetSelector = step.target || (step.subtab ? `.subtab-btn[data-subtab="${step.subtab}"]` : null);
    const target = targetSelector ? resolveVisibleTarget(targetSelector) : null;
    if (!target) { fullTourNext(); return; }
    target.scrollIntoView({ block:'center' });
    requestAnimationFrame(() => positionFullTourStep(target, step));
  });
}

function positionFullTourStep(target, step) {
  const r = target.getBoundingClientRect();
  const pad = 6;
  const spot = document.getElementById('full-tour-spotlight');
  spot.style.top = (r.top - pad) + 'px'; spot.style.left = (r.left - pad) + 'px';
  spot.style.width = (r.width + pad*2) + 'px'; spot.style.height = (r.height + pad*2) + 'px';

  document.getElementById('full-tour-title').textContent = step.title;
  document.getElementById('full-tour-text').textContent = step.text;
  document.getElementById('full-tour-counter').textContent = `${_fullTourIdx+1} / ${_fullTourSteps.length}`;
  document.getElementById('full-tour-prev-btn').style.visibility = _fullTourIdx === 0 ? 'hidden' : 'visible';
  document.getElementById('full-tour-next-btn').textContent = _fullTourIdx === _fullTourSteps.length-1 ? 'Terminer' : 'Suivant';

  const bubble = document.getElementById('full-tour-bubble');
  const margin = 12;
  // v9.0.0 — Bug rapporté : la hauteur de la bulle était supposée fixe
  // (160px) pour décider de la placer au-dessus ou en dessous de la cible,
  // alors qu'elle varie selon la longueur du texte de chaque étape — au-delà
  // de cette hauteur supposée, la bulle débordait en bas de l'écran sans que
  // le calcul de bascule ne s'en aperçoive (repéré sur les étapes au texte
  // le plus long : 1, 25, 26, 28, 29). Le texte étant déjà posé ci-dessus,
  // on mesure ici la hauteur RÉELLEMENT rendue de la bulle.
  const bh = bubble.offsetHeight || 160;
  const bw = bubble.offsetWidth || 300;
  let top = r.bottom + margin, left = r.left;
  if (top + bh > window.innerHeight - margin) top = Math.max(margin, r.top - bh - margin);
  // Filet de sécurité : si même bascule au-dessus ne suffit pas (cible très
  // proche du haut ET bulle très grande), on la plaque au plus bas possible
  // sans déborder, plutôt que de dépasser l'écran.
  top = Math.max(margin, Math.min(top, window.innerHeight - bh - margin));
  left = Math.max(margin, Math.min(window.innerWidth - bw - margin, left));
  bubble.style.top = top + 'px'; bubble.style.left = left + 'px';
}

function fullTourNext() {
  _fullTourIdx++;
  if (_fullTourIdx >= _fullTourSteps.length) { endFullTour(); return; }
  showFullTourStep();
}
function fullTourPrev() {
  if (_fullTourIdx === 0) return;
  _fullTourIdx--;
  showFullTourStep();
}
function endFullTour() {
  _fullTourActive = false;
  document.body.click();
  document.getElementById('full-tour-spotlight').classList.remove('active');
  document.getElementById('full-tour-bubble').classList.remove('active');
  // v9.0.0 — Restaure l'onglet actif d'avant la visite, ou referme tout
  // s'il n'y en avait pas (voir startFullTour). Sans effet sur la visite
  // de la bibliothèque (pas d'onglet dans cet écran, _tourPrevActiveTabId
  // reste null).
  document.querySelectorAll('.tab-btn.active,.tab-content.active').forEach(e => e.classList.remove('active'));
  const restoreBtn = _tourPrevActiveTabId ? document.querySelector(`.tab-btn[data-tab-id="${_tourPrevActiveTabId}"]`) : null;
  if (restoreBtn) { toggleTab(_tourPrevActiveTabId, restoreBtn, true); }
  else { document.getElementById('tab-container').classList.remove('open'); }
}

// ═══════════════════════════════════════════════════════
// LANCEMENT DEPUIS LA BIBLIOTHÈQUE (boutons câblés dans library.js)
// ═══════════════════════════════════════════════════════
function launchLibraryTour() {
  startFullTour(LIBRARY_TOUR_STEPS);
}
async function launchEditorFullTour() {
  const list = await loadDocList();
  if (!list.documents.length) {
    toast('Créez ou ouvrez d\'abord un manuscrit pour lancer cette visite.', 'info');
    return;
  }
  const sorted = list.documents.slice().sort((a,b) => b.lastModified - a.lastModified);
  // Correction (bug rapporté, v7.40.0) : openDocument() ci-dessous appelle
  // initApp(), qui déclenche aussi (sans le vouloir) le parcours "premiers
  // pas" automatique (notifications.js) s'il n'a jamais été vu — les deux
  // visites tournaient alors en même temps, et seules les 4 bulles
  // "premiers pas" étaient visibles à la place des 29 étapes attendues.
  // On désactive ce parcours pour CETTE ouverture précise (voir
  // _suppressOnboardingOnce, notifications.js) : la visite complète couvre
  // de toute façon largement ce qu'il montre.
  _suppressOnboardingOnce = true;
  await openDocument(sorted[0].id);
  startFullTour(getFullTourSteps());
}

// ═══════════════════════════════════════════════════════
// ICÔNES D'AIDE CONTEXTUELLE ⓘ (nouveau v7.39.0)
// S'AJOUTENT aux infobulles natives existantes (attribut title, au survol),
// sans les remplacer — utile en particulier sur écran tactile, où le survol
// n'existe pas. Réutilisent le MÊME texte que la visite guidée ci-dessus
// (une seule source de contenu à tenir à jour). Posées automatiquement à
// côté de chaque sous-onglet, menu déroulant de la barre d'outils et bouton
// du bandeau du bas — pas sur les gros conteneurs déjà couverts par le tour
// (sidebar, barre d'outils entière, bandeau entier), pour rester lisible.
// ═══════════════════════════════════════════════════════
function helpIconAnchorFor(step) {
  if (step.subtab) return document.querySelector(`.subtab-btn[data-subtab="${step.subtab}"]`);
  if (step.clickFirst) return document.querySelector(step.clickFirst);
  if (step.target && ['#search-btn','#toggle-dark-btn','#dictate-btn','#ai-chat-btn','#shortcuts-hint-btn',
                       '#library-new-btn','#library-system-btn','#library-manage-profiles-btn'].includes(step.target)) {
    return document.querySelector(step.target);
  }
  return null;
}
function showInfoPopover(anchor, title, text) {
  const pop = document.getElementById('info-popover');
  document.getElementById('info-popover-title').textContent = title;
  document.getElementById('info-popover-text').textContent = text;
  pop.classList.add('active');
  const r = anchor.getBoundingClientRect();
  const bw = 280, margin = 8;
  let top = r.bottom + margin, left = Math.max(margin, Math.min(window.innerWidth - bw - margin, r.left));
  if (top + 140 > window.innerHeight) top = Math.max(margin, r.top - 140 - margin);
  pop.style.top = top + 'px'; pop.style.left = left + 'px';
}
function hideInfoPopover() { document.getElementById('info-popover').classList.remove('active'); }

function wireContextualHelpIcons() {
  [...LIBRARY_TOUR_STEPS, ...getFullTourSteps()].forEach(step => {
    const anchor = helpIconAnchorFor(step);
    if (!anchor || anchor.dataset.helpWired) return;
    anchor.dataset.helpWired = '1';
    const icon = document.createElement('button');
    icon.className = 'contextual-help-icon';
    icon.type = 'button';
    icon.textContent = 'ⓘ';
    icon.setAttribute('aria-label', 'Aide : ' + step.title);
    icon.addEventListener('click', e => {
      e.stopPropagation();
      const already = document.getElementById('info-popover').classList.contains('active')
        && document.getElementById('info-popover-title').textContent === step.title;
      hideInfoPopover();
      if (!already) showInfoPopover(icon, step.title, step.text);
    });
    anchor.insertAdjacentElement('afterend', icon);
  });
}
