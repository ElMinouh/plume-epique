'use strict';
// ═══════════════════════════════════════════════════════
// SCHÉMA & VERSIONING
// Fichier isolé, sans dépendance au DOM, extrait de router.js en v6.1.0
// pour pouvoir être testé indépendamment de l'application
// (voir tests/test-runner.html).
// ═══════════════════════════════════════════════════════
const SCHEMA_VERSION = 17;

// Type de projet (nouveau v7.36.0, ergonomie) : adapte simplement le
// vocabulaire de l'app selon le genre du manuscrit — la structure de
// données (db.quests) ne change pas, seul le libellé affiché change.
const PROJECT_TYPES = {
  'fantasy':      { label:'Roman (fantasy / aventure)', questsLabel:'Quêtes',    questsSingular:'une quête',    questsIcon:'🎯' },
  'contemporain': { label:'Roman contemporain',          questsLabel:'Intrigues', questsSingular:'une intrigue', questsIcon:'🧵' },
  'polar':        { label:'Polar / thriller',            questsLabel:'Enquêtes',  questsSingular:'une enquête',  questsIcon:'🔎' },
  'essai':        { label:'Essai / non-fiction',         questsLabel:'Objectifs', questsSingular:'un objectif',  questsIcon:'🧭' }
};
function questsLabelFor(projectType) {
  return (PROJECT_TYPES[projectType] || PROJECT_TYPES['fantasy']).questsLabel;
}

function genChapterId() {
  return (crypto.randomUUID ? crypto.randomUUID() : 'ch_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8));
}

// ═══════════════════════════════════════════════════════
// ROMAN GRAPHIQUE / LIVRE ILLUSTRÉ (nouveau, module pages illustrées)
// Un manuscrit "roman graphique" (db.docType === 'roman_graphique') utilise
// db.pages au lieu de db.chapters : chaque page est une mise en page libre
// d'images et de blocs de texte (voir GRAPHIC_GABARITS ci-dessous pour les
// gabarits de départ). Les images elles-mêmes ne sont JAMAIS stockées ici
// (voir js/images.js) — seule une référence (imageId) l'est, pour ne pas
// alourdir le document synchronisé (localStorage + API Gist).
// ═══════════════════════════════════════════════════════
function genPageId() {
  return (crypto.randomUUID ? crypto.randomUUID() : 'pg_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8));
}
function genElementId() {
  return (crypto.randomUUID ? crypto.randomUUID() : 'el_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8));
}

function makeImageElement(x, y, w, h) {
  // focusX/focusY : position du pan à l'intérieur du cadre (0-100, 50=centré).
  // zoom : 100 = l'image couvre juste le cadre (recadrage minimal), >100 rapproche.
  // frameShape : forme du cadre visible ('rect' | 'rounded' | 'oval') — l'image
  // reste rectangulaire, seul le cadre qui la découpe change de forme.
  return { id: genElementId(), type:'image', x, y, w, h, rotation:0,
    imageId:null, imageW:0, imageH:0, fit:'cover', focusX:50, focusY:50, zoom:100, frameShape:'rect', alt:'' };
}
// GN_TEXT_FONTS : clés stables (jamais renommées, seul le libellé peut
// changer) — voir graphicnovel.js pour le mappage clé → police CSS.
function makeTextElement(x, y, w, h, extra) {
  return Object.assign({ id: genElementId(), type:'text', x, y, w, h, rotation:0,
    content:'', fontFamily:'palatino', fontSize:16, align:'left', bold:false, italic:false,
    lineHeight:1.5, letterSpacing:0, color:'', background:'', bgOpacity:0, textEffect:'none' }, extra||{});
}

// Gabarits de départ : positions/tailles en % de la page. Chaque gabarit
// instancie de vrais éléments (via makeImageElement/makeTextElement) — une
// fois posés, ils restent librement déplaçables/redimensionnables, le
// gabarit n'est qu'un point de départ, pas une contrainte figée.
const GRAPHIC_GABARITS = {
  plein: { label:'Pleine page', build: () => [
    makeImageElement(0, 0, 100, 76),
    makeTextElement(6, 80, 88, 16)
  ]},
  split: { label:'Image + texte', build: () => [
    makeImageElement(0, 0, 54, 100),
    makeTextElement(60, 10, 36, 80)
  ]},
  duo: { label:'Duo, texte sous chacune', build: () => [
    makeImageElement(0, 0, 47, 58), makeTextElement(0, 60, 47, 15),
    makeImageElement(53, 0, 47, 58), makeTextElement(53, 60, 47, 15)
  ]},
  duoEmpile: { label:'Duo empilé + texte', build: () => [
    makeImageElement(0, 0, 56, 44), makeImageElement(0, 48, 56, 44),
    makeTextElement(60, 4, 36, 92)
  ]},
  quatuor: { label:'Quatre images, texte sous chacune', build: () => [
    makeImageElement(2, 2, 46, 34), makeTextElement(2, 37, 46, 9),
    makeImageElement(52, 2, 46, 34), makeTextElement(52, 37, 46, 9),
    makeImageElement(2, 50, 46, 34), makeTextElement(2, 85, 46, 9),
    makeImageElement(52, 50, 46, 34), makeTextElement(52, 85, 46, 9)
  ]},
  texteSeul: { label:'Texte seul', build: () => [
    makeTextElement(14, 32, 72, 36, { fontSize:26, align:'center' })
  ]}
};
const GRAPHIC_GABARIT_ORDER = ['plein','split','duo','duoEmpile','quatuor','texteSeul'];

function defaultGraphicPage(gabaritKey) {
  const key = GRAPHIC_GABARITS[gabaritKey] ? gabaritKey : 'plein';
  return { id: genPageId(), background:'#f4ecd8', elements: GRAPHIC_GABARITS[key].build() };
}

function DEFAULT_DB_GRAPHIC() {
  return {
    _schemaVersion: SCHEMA_VERSION,
    docType: 'roman_graphique',
    title: '',
    pages: [ defaultGraphicPage('texteSeul') ],
    trash: [], history:{}, plugins:{}, customGabarits: [],
    darkMode:true, gistId:'', sessionStats:{},
    accentPalette:'rouge-violet', paperMode:false,
    projectType:'fantasy'
  };
}

function migrateDb(data) {
  const v = data._schemaVersion || 1;
  if (v < 2) {
    if (!data.timeline) data.timeline = [];
    if (!data.tabOrder) data.tabOrder = [];
    if (!data.weakWords) data.weakWords = ['juste','très'];
  }
  if (v < 3) {
    if (!data.history) data.history = {};
    if (!data.plugins) data.plugins = {};
    if (!data.sessionStats) data.sessionStats = {};
  }
  if (v < 4) {
    // Attribution d'un identifiant stable à chaque chapitre + migration de l'historique
    // (auparavant indexé par position, ce qui cassait tout en cas de suppression/réorganisation)
    const oldHistory = data.history || {};
    const newHistory = {};
    (data.chapters||[]).forEach((ch, idx) => {
      if (!ch.id) ch.id = genChapterId();
      if (oldHistory[String(idx)]) newHistory[ch.id] = oldHistory[String(idx)];
    });
    data.history = newHistory;
  }
  if (v < 5) {
    // Ajout du statut par chapitre (brouillon / à revoir / final)
    (data.chapters||[]).forEach(ch => { if (!ch.status) ch.status = 'draft'; });
  }
  if (v < 6) {
    // Corbeille des chapitres supprimés + objectifs hebdomadaire/mensuel
    if (!data.trash) data.trash = [];
    if (typeof data.weeklyGoal !== 'number') data.weeklyGoal = 3000;
    if (typeof data.monthlyGoal !== 'number') data.monthlyGoal = 12000;
  }
  if (v < 7) {
    // Titre du manuscrit (bibliothèque multi-manuscrits, nouveau v7.2.0)
    if (typeof data.title !== 'string') data.title = '';
  }
  if (v < 8) {
    // Regroupement des 16 anciens onglets en 7 catégories (v7.4.0) — l'ordre
    // à plat n'a plus de sens, on le remplace par le nouvel ordre par défaut.
    // Aucune donnée n'est perdue : seul l'ordre d'affichage des onglets est
    // réinitialisé (un éventuel réordonnancement manuel des onglets ne sera
    // pas conservé).
    data.tabOrder = ['tab-map','tab-sprint','tab-univers','tab-ia-memoire','tab-analysegroup','tab-systeme','tab-config'];
  }
  if (v < 9) {
    // Apparence personnalisable : palette de couleurs, thème papier, police
    // d'écriture (v7.7.0). Valeurs par défaut = rendu identique à avant.
    if (!data.accentPalette) data.accentPalette = 'rouge-violet';
    if (typeof data.paperMode !== 'boolean') data.paperMode = false;
    if (!data.editorFont) data.editorFont = 'palatino';
  }
  if (v < 10) {
    // Tags libres sur les chapitres (v7.8.0), en plus du statut fixe.
    (data.chapters||[]).forEach(ch => { if (!Array.isArray(ch.tags)) ch.tags = []; });
  }
  if (v < 11) {
    // Objectif de mots pour le manuscrit entier, affiché en barre de
    // progression sur la carte bibliothèque (v7.9.0).
    if (typeof data.wordGoal !== 'number') data.wordGoal = 0;
  }
  if (v < 12) {
    // Statistiques avancées (v7.12.0, Lot 9) : activité par heure de la
    // journée (pour "meilleur moment d'écriture").
    // Note v7.16.0 : ce palier ajoutait aussi un `data.autoGistInterval`
    // (intervalle de sauvegarde Gist par MANUSCRIT) — devenu un vestige dès
    // la v7.14.0, remplacé par `libsettings.autoGistInterval` (par PROFIL,
    // voir library.js). Le champ n'est plus jamais lu ; on ne l'écrit plus
    // non plus ici. Un `data.autoGistInterval` déjà présent dans un document
    // existant reste tel quel (inoffensif, simplement ignoré).
    if (!Array.isArray(data.hourlyActivity) || data.hourlyActivity.length !== 24) data.hourlyActivity = new Array(24).fill(0);
  }
  if (v < 13) {
    // Correction (audit) : personnages/lieux/quêtes n'avaient pas d'identifiant
    // stable, et les liens entre eux (.links[].idx) référençaient une simple
    // POSITION dans le tableau — supprimer un élément décalait les index
    // suivants et faisait pointer silencieusement les liens vers le mauvais
    // élément. Idem pour db.timeline[].chapterIdx. Même classe de bug déjà
    // corrigée pour les chapitres en v<4 (voir plus haut) ; on l'applique ici
    // à chars/places/quests et à la chronologie.
    ['chars','places','quests'].forEach(type => {
      (data[type]||[]).forEach(item => { if (!item.id) item.id = genChapterId(); });
    });
    ['chars','places','quests'].forEach(type => {
      (data[type]||[]).forEach(item => {
        if (Array.isArray(item.links)) {
          item.links = item.links.map(l => {
            if (l.id !== undefined) return l; // déjà au nouveau format
            const target = (data[l.type]||[])[l.idx];
            return target ? { type:l.type, id:target.id } : null;
          }).filter(Boolean);
        }
      });
    });
    (data.timeline||[]).forEach(evt => {
      if (evt.chapterIdx !== undefined && evt.chapterId === undefined) {
        const ch = (data.chapters||[])[evt.chapterIdx];
        if (ch) evt.chapterId = ch.id;
        delete evt.chapterIdx;
      }
    });
  }
  if (v < 14) {
    // Réorganisation des onglets (audit ergonomie v7.36.0) : Structure rejoint
    // Analyse, Sprint rejoint Config, tous deux en sous-onglets — ils ne sont
    // plus des identifiants valides de premier niveau.
    if (Array.isArray(data.tabOrder)) {
      data.tabOrder = data.tabOrder.filter(id => id !== 'tab-map' && id !== 'tab-sprint');
    }
    // Type de projet (adapte le vocabulaire de l'app, ex. "Quêtes" → "Intrigues").
    if (typeof data.projectType !== 'string') data.projectType = 'fantasy';
    // Objectif de mots et notes de recherche par chapitre (nouveau).
    (data.chapters||[]).forEach(ch => {
      if (typeof ch.wordGoal !== 'number') ch.wordGoal = 0;
      if (typeof ch.researchNotes !== 'string') ch.researchNotes = '';
    });
  }
  if (v < 15) {
    // Module Roman graphique / livre illustré (nouveau) : tout document
    // existant est un document "texte" classique — db.pages n'existe que
    // pour les nouveaux manuscrits créés en roman graphique (voir
    // DEFAULT_DB_GRAPHIC ci-dessus). Champ ajouté ici uniquement pour que
    // le reste du code puisse toujours lire data.docType sans vérifier
    // s'il existe.
    if (typeof data.docType !== 'string') data.docType = 'texte';
    if (!Array.isArray(data.pages)) data.pages = [];
  }
  if (v < 16) {
    // Cadrage avancé des images (pan/zoom/rotation/forme du cadre) : les
    // roman graphiques créés avant cette version ont des images sans ces
    // champs — on les complète avec des valeurs neutres (cadrage inchangé,
    // cadre rectangulaire) pour ne rien déplacer visuellement à l'ouverture.
    (data.pages||[]).forEach(pg => {
      (pg.elements||[]).forEach(el => {
        if (el.type !== 'image') return;
        if (typeof el.focusX !== 'number') el.focusX = 50;
        if (typeof el.focusY !== 'number') el.focusY = 50;
        if (typeof el.zoom !== 'number') el.zoom = 100;
        if (typeof el.frameShape !== 'string') el.frameShape = 'rect';
        if (typeof el.rotation !== 'number') el.rotation = 0;
      });
    });
  }
  if (v < 17) {
    // Mise en forme professionnelle du texte + déplacement libre : les
    // blocs de texte créés avant cette version n'ont pas ces champs —
    // valeurs neutres pour ne rien changer visuellement à l'ouverture.
    (data.pages||[]).forEach(pg => {
      (pg.elements||[]).forEach(el => {
        if (el.type !== 'text') return;
        if (typeof el.bold !== 'boolean') el.bold = false;
        if (typeof el.italic !== 'boolean') el.italic = false;
        if (typeof el.lineHeight !== 'number') el.lineHeight = 1.5;
        if (typeof el.letterSpacing !== 'number') el.letterSpacing = 0;
        if (typeof el.bgOpacity !== 'number') el.bgOpacity = 0;
        if (typeof el.textEffect !== 'string') el.textEffect = 'none';
      });
    });
  }
  data._schemaVersion = SCHEMA_VERSION;
  return data;
}

const DEFAULT_DB = () => ({
  _schemaVersion: SCHEMA_VERSION,
  docType: 'texte',
  pages: [],
  title: '',
  chapters: [{ id: genChapterId(), title:'Chapitre 1', content:'', tension:20, summary:'', status:'draft', tags:[], wordGoal:0, researchNotes:'' }],
  chars:[], places:[], quests:[], timeline:[], history:{}, plugins:{},
  weakWords:['juste','très'],
  tabOrder:['tab-univers','tab-ia-memoire','tab-analysegroup','tab-systeme','tab-config'],
  darkMode:true, gistId:'', dailyGoal:500, weeklyGoal:3000, monthlyGoal:12000, sessionStats:{}, sprint:null, trash:[],
  accentPalette:'rouge-violet', paperMode:false, editorFont:'palatino', wordGoal:0,
  hourlyActivity: new Array(24).fill(0),
  projectType:'fantasy'
});
