// ═══════════════════════════════════════════════════════
// LOT 5 de l'audit AUD-09 (v9.87.0) : vocabulaire (AUD-09-005), erreurs lisibles (AUD-09-012), icône (AUD-09-013), nom (AUD-09-014).
// Voir docs/GLOSSAIRE.md.
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const JS = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f);
// Texte visible : on retire les commentaires (// et <!-- -->) pour ne juger que les libellés.
const sansCommentaires = s => s.replace(/<!--[\s\S]*?-->/g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
const tout = JS.concat(['index.html', 'manifest.json']).map(f => [f, sansCommentaires(read(f))]);

describe('AUD-09-005 : « projet » est le mot générique, « manuscrit » est le texte', () => {
  const INTERDITS = ['Nouveau manuscrit', 'Titre du nouveau manuscrit', 'Manuscrit de destination', 'Corbeille des manuscrits',
    'Corbeille (manuscrits supprimés)', 'Exporter ce manuscrit', 'Mon manuscrit', 'Manuscrit importé', 'Manuscrit supprimé',
    'Manuscrit restauré', 'Manuscrit mis à la corbeille', 'Manuscrit introuvable', 'Ce manuscrit', 'de ce manuscrit reste en pause', 'vos manuscrits sur GitHub',
    "plur(sorted.length, 'manuscrit'", "' manuscrit' + (sorted.length"];
  for (const phrase of INTERDITS) {
    it(`« ${phrase} » n'apparaît plus dans les libellés`, () => {
      const trouves = tout.filter(([f, s]) => s.includes(phrase) && !(f === 'js/profiles.js' && /Où sont vos manuscrits/.test(phrase))).map(([f]) => f);
      expect(trouves).toEqual([]);
    });
  }
  it('les libellés propres au texte gardent « manuscrit » (éditeur)', () => {
    const html = read('index.html');
    for (const l of ['Écriture du manuscrit', 'Exporter le manuscrit…', 'Tout le manuscrit', 'Objectif du manuscrit']) expect(html).toContain(l);
    expect(read('js/schema.js')).toContain("['Exporter le manuscrit', 'Ctrl+E']");
  });
  it('le premier écran garde « Où sont vos manuscrits ? » (décision AUD-03-008 du propriétaire)', () => {
    expect(read('js/profiles.js')).toContain('Où sont vos manuscrits ?');
  });
  it('les actions génériques parlent de projet', () => {
    const html = read('index.html'), lib = read('js/library.js');
    expect(lib).toContain("uniqueDefaultTitle('Nouveau projet'");
    expect(html).toContain('Nouveau projet');
    expect(html).toContain('Corbeille (projets supprimés)');
    expect(JSON.parse(read('manifest.json')).shortcuts[0].description).toBe('Créer un nouveau projet');
  });
  it('le glossaire existe et nomme la règle', () => {
    const g = read('docs/GLOSSAIRE.md');
    for (const t of ['projet', 'manuscrit', 'roman graphique', 'Plume', 'Exception décidée par le propriétaire']) expect(g).toContain(t);
  });
});

describe('AUD-09-012 : les erreurs passent par des messages lisibles', () => {
  it('aucun toast d\'erreur ne concatène le message brut de l\'exception (hors messages propres à l\'application)', () => {
    // messages propres : library.js lit e.message produit par NOS throw (en français) — voir ouverture / restauration
    const AUTORISES = new Set(['js/library.js']);
    const re = /toast\([^;\n]*\b(e|err|error|ex)\.(message|error)\b[^;\n]*'error'/;
    const fautifs = JS.filter(f => !AUTORISES.has(f)).filter(f => sansCommentaires(read(f)).split('\n').some(l => re.test(l.replace('dictationErrorMessage(e.error)', ''))));
    expect(fautifs).toEqual([]);
  });
  it('lecture de fichier, exports du roman graphique, correction grammaticale : voix commune', () => {
    const ex = read('js/export-format-utils.js'), gn = read('js/graphicnovel.js');
    expect(ex).toContain("toastError('La lecture du fichier', err)");
    expect(ex).toContain("toastError('La lecture du fichier', reader.error)");
    for (const f of ['PDF', 'ZIP', 'DOCX', 'EPUB', 'ODT']) expect(gn).toContain(`toastError("L'export ${f}", e)`);
    expect(read('js/pluginSystem.js')).toContain("messageErreurLisible(e, 'La correction grammaticale')");
    for (const f of ['js/router.js', 'js/graphicnovel.js']) expect(read(f)).toContain('messageErreurLisible(e, "L\'enregistrement")');
  });
  it('la dictée traduit les codes d\'erreur du navigateur', () => {
    const t = read('js/tts.js');
    const m = t.slice(t.indexOf('function dictationErrorMessage'), t.indexOf('function stopDictation'));
    const fn = new Function(m + '\nreturn dictationErrorMessage;')();
    expect(fn('not-allowed')).toMatch(/micro est refusé/);
    expect(fn('service-not-allowed')).toMatch(/micro est refusé/);
    expect(fn('audio-capture')).toMatch(/aucun micro/);
    expect(fn('no-speech')).toMatch(/rien entendu/);
    expect(fn('network')).toMatch(/connexion/);
    expect(fn('autre-chose')).toMatch(/erreur inattendue/);
    for (const c of ['not-allowed', 'audio-capture', 'no-speech', 'network', 'x']) expect(fn(c)).not.toMatch(/[a-z]+-[a-z]+ ?$/);
    expect(t).toContain("e.error !== 'aborted'");
  });
});

describe('AUD-09-013 : l\'icône « étincelles » est réservée à l\'IA', () => {
  it('index.html : seulement les fonctions qui envoient du texte à l\'IA', () => {
    const html = read('index.html');
    const lignes = html.split('\n').filter(l => l.includes('href="#i-sparkles"') && !l.includes('<symbol'));
    const libelles = lignes.map(l => l.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
    const OK = /IA|Mots|Synonymes|Générateur de noms|Résumé/; // « Mots » = synonymes et antonymes (demande envoyée à l'IA)
    for (const l of libelles) expect(l, l).toMatch(OK);
  });
  it('les gabarits JS : seulement le bouton de reformulation IA du roman graphique', () => {
    const avec = JS.filter(f => /icon\('sparkles'\)/.test(read(f)));
    expect(avec).toEqual(['js/graphicnovel.js']);
    expect(read('js/profiles.js')).toContain("icon('refresh-cw')}</i> Mise à jour : profils");
  });
});

describe('AUD-09-014 : le produit s\'appelle « Plume »', () => {
  it('interface et manifeste', () => {
    expect(read('index.html')).not.toContain('Plume Épique');
    expect(read('index.html')).toContain('<title>Plume</title>');
    const mf = JSON.parse(read('manifest.json'));
    expect(mf.name).toBe('Plume');
    expect(mf.short_name).toBe('Plume');
  });
  it('README et CLAUDE.md', () => {
    expect(read('README.md').split('\n')[0]).toBe('# Plume');
    expect(read('CLAUDE.md')).toContain('**Plume** (dépôt `plume-epique`)');
  });
  it('PRODUIT.md garde plume-epique comme identifiant technique', () => {
    expect(read('docs/PRODUIT.md')).toMatch(/`plume-epique` : identifiant technique/);
  });
});
