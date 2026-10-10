// Génère le sprite d'icônes (index.html) et la liste des noms (js/icons.js) à partir de lucide-static (version figée dans
// package.json, licence ISC). Usage : node scripts/build-icons.cjs
// Ajouter une icône = ajouter son nom à ICONS ci-dessous, relancer ce script, committer index.html et js/icons.js.
// Le test tests/vitest/lot29-icones.test.js vérifie que le sprite correspond exactement aux fichiers de lucide-static.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ICON_DIR = path.join(ROOT, 'node_modules', 'lucide-static', 'icons');

// Lexique : un nom = un sens (voir la table dans js/icons.js).
const ICONS = [
  'x', 'search', 'chevron-down', 'library', 'sparkles', 'trash-2', 'refresh-cw', 'user', 'graduation-cap', 'clock', 'save', 'circle-help',
  'book-open', 'upload', 'download', 'menu', 'shield', 'cloud', 'circle-check', 'smartphone', 'layout-grid', 'focus', 'target', 'bot',
  'log-out', 'key-round', 'pencil', 'timer', 'mic', 'play', 'file-text', 'notebook', 'moon', 'plug', 'palette', 'laptop', 'triangle-alert',
  'folder', 'life-buoy', 'eye', 'files', 'plus', 'undo-2', 'redo-2', 'compass', 'lock', 'file', 'book', 'pause', 'calendar', 'highlighter',
  'scissors', 'wrench', 'eraser', 'clipboard-copy', 'replace', 'send', 'users', 'castle', 'network', 'arrow-up-down', 'brain',
  'message-square', 'lightbulb', 'chart-column', 'chart-line', 'list-tree', 'bookmark', 'camera', 'arrow-left-right', 'settings', 'sun',
  'scroll-text', 'tag', 'globe', 'archive', 'hard-drive', 'ellipsis-vertical', 'move', 'info', 'check', 'copy', 'history', 'folder-open',
  'circle-x', 'grip-vertical', 'arrow-left', 'chevron-right', 'image', 'images', 'layers', 'pen-line', 'share-2', 'database', 'wand-sparkles',
  'route', 'square', 'file-down',
  'eye-off', 'lock-open', 'wifi-off', 'party-popper', 'link', 'arrow-right', 'type', 'image-plus', 'circle-alert',
  'feather', 'rectangle-horizontal', 'circle', 'maximize', 'minimize', 'chevron-up', 'rotate-ccw', 'square-round-corner',
];

function symbol(name) {
  const file = path.join(ICON_DIR, name + '.svg');
  if (!fs.existsSync(file)) throw new Error('Icône Lucide introuvable : ' + name);
  const svg = fs.readFileSync(file, 'utf8');
  const inner = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/<svg[\s\S]*?>/, '').replace(/<\/svg>\s*$/, '')
    .split('\n').map(l => l.trim()).filter(Boolean).join('');
  return `<symbol id="i-${name}" viewBox="0 0 24 24">${inner}</symbol>`;
}

const sorted = [...new Set(ICONS)].sort();
const sprite = sorted.map(symbol).join('\n');

function edit(file, fn) {
  const p = path.join(ROOT, file);
  const t = fs.readFileSync(p, 'utf8');
  const eol = t.includes('\r\n') ? '\r\n' : '\n';
  const out = fn(t.replace(/\r\n/g, '\n'));
  fs.writeFileSync(p, out.replace(/\n/g, eol));
}

edit('index.html', s => {
  const a = '<!-- ICONES:DEBUT (généré par scripts/build-icons.cjs — ne pas modifier à la main) -->';
  const b = '<!-- ICONES:FIN -->';
  if (!s.includes(a)) throw new Error('Marqueur ICONES:DEBUT absent de index.html');
  return s.slice(0, s.indexOf(a) + a.length) + '\n' + sprite + '\n' + s.slice(s.indexOf(b));
});

edit('js/icons.js', s => s.replace(/const ICON_NAMES = \[[\s\S]*?\];/, 'const ICON_NAMES = ' + JSON.stringify(sorted) + ';'));
console.log(sorted.length + ' icônes, sprite de ' + sprite.length + ' octets');
