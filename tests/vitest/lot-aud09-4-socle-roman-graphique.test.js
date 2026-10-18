// ═══════════════════════════════════════════════════════
// LOT 4 de l'audit AUD-09 (v9.86.0) : socle commun du roman graphique (AUD-09-004) et limite tactile documentée (AUD-09-015).
// Thème et aide accessibles depuis l'écran du livre illustré ; l'aide liste les raccourcis du TYPE de document ouvert.
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const schema = read('js/schema.js'), notif = read('js/notifications.js'), html = read('index.html');

function charger(libraryMode, docType) {
  const dom = new JSDOM(`<body class="${libraryMode ? 'library-mode' : ''}"><div id="shortcuts-overlay"></div><div id="shortcuts-rows"></div><p id="shortcuts-note"></p>
    <button id="help-onboarding-btn"></button><button id="help-tour-btn"></button></body>`, { runScripts: 'outside-only' });
  const ctx = dom.getInternalVMContext();
  const registre = schema.slice(schema.indexOf('function _docPlainText'), schema.indexOf('\n', schema.indexOf('function isGraphicDoc')) + 1);
  const aide = notif.slice(notif.indexOf('function renderShortcutsHelp'), notif.indexOf('function closeShortcutsHelp'));
  new vm.Script(`var db = { docType: ${JSON.stringify(docType)} };\n${registre}\n${aide}`).runInContext(ctx);
  return { doc: dom.window.document, run: s => new vm.Script(s).runInContext(ctx) };
}
const lignes = doc => [...doc.querySelectorAll('#shortcuts-rows .shortcut-row')].map(r => r.children[0].textContent + '|' + r.children[1].textContent);

describe('AUD-09-004 : l\'aide liste les raccourcis du type ouvert', () => {
  it('texte : raccourcis de l\'éditeur, visites disponibles, pas de note', () => {
    const { doc, run } = charger(false, 'texte'); run('openShortcutsHelp()');
    const l = lignes(doc);
    expect(l).toContain('Gras|Ctrl+B');
    expect(l).toContain('Réordonner un chapitre (focus dessus)|Alt+↑/↓');
    expect(l).toContain('Fermer la fenêtre active|Échap');
    expect(l[l.length - 1]).toBe('Afficher cette aide|?');
    expect(doc.getElementById('help-tour-btn').hidden).toBe(false);
    expect(doc.getElementById('help-onboarding-btn').hidden).toBe(false);
    expect(doc.getElementById('shortcuts-note').hidden).toBe(true);
    expect(doc.getElementById('shortcuts-overlay').classList.contains('active')).toBe(true);
  });
  it('roman graphique : ses raccourcis (flèches, Suppr, Alt+↑/↓ des pages), plus ceux du texte, visites masquées, note sur le grand écran', () => {
    const { doc, run } = charger(false, 'roman_graphique'); run('openShortcutsHelp()');
    const l = lignes(doc);
    expect(l).toContain('Supprimer le bloc sélectionné|Suppr');
    expect(l).toContain('Déplacer une page (focus sur son numéro)|Alt+↑/↓');
    expect(l).toContain('Rechercher dans le texte des pages|Ctrl+F');
    expect(l.some(x => /Gras|chapitre/.test(x))).toBe(false);
    expect(doc.getElementById('help-tour-btn').hidden).toBe(true);
    expect(doc.getElementById('help-onboarding-btn').hidden).toBe(true);
    expect(doc.getElementById('shortcuts-note').hidden).toBe(false);
    expect(doc.getElementById('shortcuts-note').textContent).toMatch(/grand écran/);
  });
  it('bibliothèque : l\'aide présente les raccourcis du texte même si le dernier document ouvert était un roman graphique', () => {
    const { doc, run } = charger(true, 'roman_graphique'); run('openShortcutsHelp()');
    expect(lignes(doc)).toContain('Gras|Ctrl+B');
    expect(doc.getElementById('help-tour-btn').hidden).toBe(false);
  });
  it('index.html ne code plus les lignes de raccourcis en dur', () => {
    expect(html).toContain('id="shortcuts-rows"');
    expect(html).toContain('id="shortcuts-note"');
    expect(html).not.toContain('<span>Gras</span>');
  });
  it('chaque type déclare shortcuts, shortcutsNote et tours', () => {
    expect(schema.match(/shortcuts: \[\[/g).length).toBe(2);
    expect(schema.match(/shortcutsNote:/g).length).toBe(2);
    expect(schema.match(/tours: (true|false)/g).length).toBe(2);
  });
});

describe('AUD-09-004 : thème et aide dans l\'écran du roman graphique', () => {
  const gn = read('js/graphicnovel.js'), db = read('js/database.js');
  it('la barre propose un bouton thème et un bouton aide, câblés', () => {
    expect(gn).toContain('id="gn-theme-btn"');
    expect(gn).toContain('id="gn-help-btn"');
    expect(gn).toMatch(/gn-theme-btn'\)\.addEventListener\('click', \(\) => toggleMode\(\)\)/);
    expect(gn).toMatch(/gn-help-btn'\)\.addEventListener\('click', \(\) => openShortcutsHelp\(\)\)/);
  });
  it('le thème enregistre via le type (le roman graphique n\'a pas de chapitres) et le bouton annonce la cible du clic', () => {
    const t = db.slice(db.indexOf('function toggleMode()'), db.indexOf('function addItem'));
    expect(t).toContain('docTypeOf(db).saveNow()');
    expect(t).not.toMatch(/\bsave\(\)/);
    expect(db).toContain("getElementById('gn-theme-btn')");
  });
});

describe('AUD-09-015 : limite tactile du roman graphique documentée', () => {
  it('la note d\'aide l\'annonce et le registre des risques la suit', () => {
    expect(schema).toMatch(/placement libre[^']*grand écran/);
    expect(read('docs/RISQUES.md')).toMatch(/tablette réelle/);
  });
});
