// ════════════════════════════════════════════════════════════════════
// LOT A « accueil et premiers pas » (v9.41.0, audit AUD-03-001, 007, 008, 010, 034)
// Tests de non-régression sur le code source : ces défauts étaient des pièges d'interface
// (écran sans sortie, pastille vide, bulles superposées), pas des erreurs de calcul.
// ════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('AUD-03-001 — configuration initiale facultative et fermable', () => {
  const lib = read('js/library.js');
  it('le ✕ du panneau Système n\'est plus jamais masqué', () => {
    expect(lib).not.toMatch(/library-system-close-btn'\)\.style\.display = 'none'/);
  });
  it('Échap ferme le panneau même pendant la configuration', () => {
    expect(lib).not.toMatch(/&& !_setupTourActive\) closeLibrarySystemPanel/);
  });
  it('fermer le panneau termine l\'étape (plus de bulle orpheline) et la bulle a « Plus tard »', () => {
    expect(lib).toMatch(/function closeLibrarySystemPanel\(\) \{[\s\S]*?_setupTourActive\) endSetupTour\(\)/);
    expect(read('index.html')).toContain('id="setup-tour-later-btn"');
    expect(lib).toContain("setup-tour-later-btn");
  });
  it('un rappel discret remplace la bulle bloquante', () => {
    expect(read('index.html')).toMatch(/hidden class="action-btn btn-warn btn-sm" id="library-github-reminder"/);
    expect(lib).toContain('function renderGithubReminder()');
  });
});

describe('AUD-03-007 — jamais deux bulles, jamais au-dessus d\'une fenêtre', () => {
  const css = read('css/style.css');
  it('la bulle « Sauvegarde » est masquée hors bibliothèque et sous les fenêtres modales', () => {
    expect(css).toContain('body:not(.library-mode) #setup-tour-bubble.active');
    expect(css).toMatch(/body:has\(\.gn-modal-overlay[^)]*\) #setup-tour-bubble\.active\{display:none;\}/);
  });
});

describe('AUD-03-008 — premier écran compréhensible', () => {
  const pro = read('js/profiles.js');
  it('plus de compteur « Étape x/3 » ni de bouton « Vérifier » séparé', () => {
    expect(pro).not.toMatch(/Étape [0-9]\/3 —/);
    expect(pro).not.toContain('sync-key-verify-btn');
  });
  it('deux choix de poids égal et une clé vérifiée avant enregistrement', () => {
    expect(pro).toContain('Où sont vos manuscrits ?');
    expect(pro).toContain('Écrire sur cet appareil seulement');
    expect(pro).toMatch(/const ok = await verifySyncKey\(key\);[\s\S]*?setSyncKey\(key\)/);
  });
});

describe('AUD-03-010 — pastille de synchro vide', () => {
  it('le badge utilise l\'attribut hidden, avec une règle [hidden] plus forte que la règle par id', () => {
    expect(read('index.html')).toMatch(/<button hidden id="library-sync-status-badge"/);
    expect(read('css/style.css')).toContain('[hidden]{display:none!important;}');
    const lib = read('js/library.js');
    expect(lib).toContain('badge.hidden = true');
    expect(lib).not.toMatch(/badge\.classList\.(add|remove)\('u-d-none'\)/);
  });
});

describe('AUD-03-034 — création d\'un projet en un clic', () => {
  const gn = read('js/graphicnovel.js');
  it('plus de bouton « Continuer » ; un clic sur une carte crée le projet', () => {
    expect(gn).not.toContain('gn-type-continue');
    expect(gn).toMatch(/const pick = \(\) => \{[\s\S]*?closeNewDocumentTypeModal\(\);[\s\S]*?createNewGraphicNovel\(\)[\s\S]*?createNewTextDocument\(\)/);
  });
  it('la fenêtre vouvoie', () => {
    expect(gn).not.toContain('veux-tu');
  });
});
