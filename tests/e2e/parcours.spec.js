// ═══════════════════════════════════════════════════════
// PARCOURS NAVIGATEUR (audit AUD-09-001) : ce que la suite Vitest (Node) ne peut pas voir.
// Cause : la v9.84.0 est partie en ligne avec TOUTE la page inactive (`inert` posé par erreur après l'ouverture d'un
// manuscrit) alors que 1 109 tests étaient verts. Ces scénarios ouvrent un vrai Chromium sur une copie locale servie
// par tests/e2e/serveur.mjs, avec un profil de TEST créé à chaque scénario (contexte neuf, aucune donnée réelle, aucune synchro).
// Lancer : `npm run e2e`. Exécuté aussi par la CI (étape « Parcours navigateur »).
// ═══════════════════════════════════════════════════════
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const AXE = require.resolve('axe-core/axe.min.js');
const MDP_TEST = 'Essai-e2e-Plume-9482!';   // valeur de test, propre à ces scénarios, sans lien avec un vrai compte

// Erreurs de la page (exceptions + console.error), hors bruit connu du navigateur de test.
function surveillerErreurs(page) {
  const erreurs = [];
  page.on('pageerror', e => erreurs.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource|favicon|service ?worker/i.test(t)) return;
    erreurs.push('console: ' + t);
  });
  return erreurs;
}

// Écran d'accueil → « cet appareil seulement » → profil de test → bibliothèque.
async function ouvrirBibliotheque(page) {
  await page.goto('/index.html');
  await page.click('#sync-key-skip-btn');
  await page.fill('#cp-name', 'Testeur');
  await page.fill('#cp-pwd', MDP_TEST);
  await page.fill('#cp-pwd2', MDP_TEST);
  await page.fill('#cp-answer', 'reponse-test-e2e');
  await page.click('#cp-submit');
  await page.check('#rc-ack');
  await page.click('#rc-continue');
  await expect(page.locator('#library-new-btn')).toBeVisible();
}

async function creerProjet(page, libelle) {
  await page.click('#library-new-btn');
  await page.click(`text=${libelle}`);
}

const nbInert = page => page.evaluate(() => document.querySelectorAll('[inert]').length);

// Pause plus longue que le second passage du détecteur de fenêtres (240 ms, notifications.js) : on contrôle l'état STABLE.
const stabiliser = page => page.waitForTimeout(500);

const debordementHorizontal = page => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function violationsAxe(page, ecran) {
  await page.addScriptTag({ path: AXE });
  const r = await page.evaluate(async () => {
    const res = await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag22aa'] });
    if (res.passes.length < 20) throw new Error('axe-core a évalué seulement ' + res.passes.length + ' règles : contrôle non fiable');
    return res.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, cible: (v.nodes[0] && v.nodes[0].target.join(' ')) || '' }));
  });
  test.info().annotations.push({ type: 'axe ' + ecran, description: r.map(v => `${v.id}(${v.impact}) x${v.n} ${v.cible}`).join(' | ') || 'aucune violation' });
  return r;
}

test.describe('Parcours navigateur', () => {
  test('la bibliothèque se charge sans erreur', async ({ page }) => {
    const erreurs = surveillerErreurs(page);
    await ouvrirBibliotheque(page);
    expect(await page.title()).toContain('Plume');
    await stabiliser(page);
    expect(await nbInert(page)).toBe(0);
    expect(erreurs).toEqual([]);
  });

  // La régression de la v9.84.0 : après l'ouverture d'un manuscrit, la page entière restait `inert` (fenêtres fermées prises pour ouvertes).
  test('ouvrir un manuscrit laisse la page utilisable (non inerte) et les clics répondent', async ({ page }) => {
    const erreurs = surveillerErreurs(page);
    await ouvrirBibliotheque(page);
    await creerProjet(page, 'Texte seul');
    await expect(page.locator('#add-chapter-btn')).toBeVisible();
    await stabiliser(page);
    expect(await nbInert(page), 'aucun élément ne doit rester inert').toBe(0);
    const avant = await page.locator('#chapter-list > *').count();
    await page.click('#add-chapter-btn');
    await expect.poll(() => page.locator('#chapter-list > *').count()).toBeGreaterThan(avant);
    expect(erreurs).toEqual([]);
  });

  test('ouvrir puis fermer une fenêtre (recherche) rend la page à l\'état normal', async ({ page }) => {
    const erreurs = surveillerErreurs(page);
    await ouvrirBibliotheque(page);
    await creerProjet(page, 'Texte seul');
    await expect(page.locator('#add-chapter-btn')).toBeVisible();
    await stabiliser(page);
    await page.keyboard.press('Control+f');
    await expect(page.locator('#search-overlay.active')).toBeVisible();
    await stabiliser(page);
    expect(await nbInert(page), 'fenêtre ouverte : le reste de la page est inerte').toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('#search-overlay.active')).toHaveCount(0);
    await stabiliser(page);
    expect(await nbInert(page), 'fenêtre fermée : plus rien d\'inert').toBe(0);
    await page.click('#add-chapter-btn');
    expect(erreurs).toEqual([]);
  });

  test('roman graphique : l\'écran s\'ouvre, sans élément inerte ni erreur', async ({ page }) => {
    const erreurs = surveillerErreurs(page);
    await ouvrirBibliotheque(page);
    await creerProjet(page, 'Roman graphique');
    await expect(page.locator('#graphicnovel-screen')).toBeVisible();
    await expect(page.locator('#gn-add-text-btn')).toBeVisible();
    await stabiliser(page);
    expect(await nbInert(page)).toBe(0);
    await page.click('#gn-add-text-btn');
    expect(erreurs).toEqual([]);
  });

  // AUD-09-003 : Ctrl+F sur un roman graphique lisait db.chapters (inexistant pour ce type) et levait une exception.
  test('roman graphique : Ctrl+F ouvre la recherche et saisir un mot ne provoque aucune erreur', async ({ page }) => {
    const erreurs = surveillerErreurs(page);
    await ouvrirBibliotheque(page);
    await creerProjet(page, 'Roman graphique');
    await expect(page.locator('#gn-add-text-btn')).toBeVisible();
    await stabiliser(page);
    await page.keyboard.press('Control+f');
    await expect(page.locator('#search-overlay.active')).toBeVisible();
    await page.fill('#search-input', 'abc');
    await stabiliser(page);
    expect(erreurs).toEqual([]);
  });

  // AUD-09-002 : les raccourcis globaux passent par le registre des types ; aucun ne doit lever d'exception, sur les deux types.
  for (const [libelle, pret] of [['Texte seul', '#add-chapter-btn'], ['Roman graphique', '#gn-add-text-btn']]) {
    test(`raccourcis globaux (Ctrl+S, Z, Y, E, F) sans erreur : ${libelle}`, async ({ page }) => {
      const erreurs = surveillerErreurs(page);
      await ouvrirBibliotheque(page);
      await creerProjet(page, libelle);
      await expect(page.locator(pret)).toBeVisible();
      await stabiliser(page);
      for (const k of ['Control+s', 'Control+z', 'Control+y', 'Control+Shift+z']) { await page.keyboard.press(k); await page.waitForTimeout(150); }
      await page.keyboard.press('Control+e');
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+f');
      await expect(page.locator('#search-overlay.active')).toBeVisible();
      await page.keyboard.press('Escape');
      await stabiliser(page);
      expect(await nbInert(page)).toBe(0);
      expect(erreurs).toEqual([]);
    });
  }

  // AUD-09-004 : thème et aide restent accessibles dans le roman graphique, et l'aide décrit CE type de document.
  test('roman graphique : le thème bascule et l\'aide liste les raccourcis du livre illustré', async ({ page }) => {
    const erreurs = surveillerErreurs(page);
    await ouvrirBibliotheque(page);
    await creerProjet(page, 'Roman graphique');
    await expect(page.locator('#gn-theme-btn')).toBeVisible();
    await stabiliser(page);
    const sombreAvant = await page.evaluate(() => document.body.classList.contains('dark-mode'));
    await page.click('#gn-theme-btn');
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => document.body.classList.contains('dark-mode'))).toBe(!sombreAvant);
    await page.click('#gn-theme-btn');
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => document.body.classList.contains('dark-mode'))).toBe(sombreAvant);
    await page.click('#gn-help-btn');
    await expect(page.locator('#shortcuts-overlay.active')).toBeVisible();
    await expect(page.locator('#shortcuts-rows')).toContainText('Supprimer le bloc sélectionné');
    await expect(page.locator('#shortcuts-rows')).not.toContainText('Gras');
    await expect(page.locator('#help-tour-btn')).toBeHidden();
    await expect(page.locator('#shortcuts-note')).toContainText('grand écran');
    await page.keyboard.press('Escape');
    await expect(page.locator('#shortcuts-overlay.active')).toHaveCount(0);
    await stabiliser(page);
    expect(await nbInert(page)).toBe(0);
    expect(erreurs).toEqual([]);
  });

  test('texte : l\'aide liste les raccourcis de l\'éditeur et propose les visites', async ({ page }) => {
    const erreurs = surveillerErreurs(page);
    await ouvrirBibliotheque(page);
    await creerProjet(page, 'Texte seul');
    await expect(page.locator('#shortcuts-hint-btn')).toBeVisible();
    await stabiliser(page);
    await page.click('#shortcuts-hint-btn');
    await expect(page.locator('#shortcuts-overlay.active')).toBeVisible();
    await expect(page.locator('#shortcuts-rows')).toContainText('Gras');
    await expect(page.locator('#help-tour-btn')).toBeVisible();
    await page.keyboard.press('Escape');
    expect(erreurs).toEqual([]);
  });

  // AUD-09-009 : le correcteur du navigateur est actif par défaut dans l'éditeur (un choix déjà fait reste prioritaire).
  test('éditeur : la correction orthographique est activée par défaut', async ({ page }) => {
    const erreurs = surveillerErreurs(page);
    await ouvrirBibliotheque(page);
    await creerProjet(page, 'Texte seul');
    await expect(page.locator('#writer')).toBeVisible();
    expect(await page.evaluate(() => document.getElementById('writer').spellcheck)).toBe(true);
    expect(erreurs).toEqual([]);
  });

  // AUD-09-008 : une durée de connexion longue demande une confirmation qui nomme le risque ; refuser rétablit la durée précédente.
  test('Rester connecté : « Toujours » demande confirmation, refuser rétablit la durée', async ({ page }) => {
    const erreurs = surveillerErreurs(page);
    await ouvrirBibliotheque(page);
    await page.click('#setup-tour-later-btn'); // la bulle de configuration initiale recouvre le menu Compte à la première ouverture
    await page.click('#library-account-btn');
    await page.click('#library-my-profile-btn');
    await expect(page.locator('#mp-session-duration')).toBeVisible();
    expect(await page.inputValue('#mp-session-duration')).toBe('720');
    await page.selectOption('#mp-session-duration', '-1');
    await expect(page.locator('#confirm-modal-overlay.active')).toBeVisible();
    await expect(page.locator('#confirm-modal-message')).toContainText('sans mot de passe');
    await page.click('#confirm-modal-cancel-btn');
    await expect(page.locator('#confirm-modal-overlay.active')).toHaveCount(0);
    expect(await page.inputValue('#mp-session-duration')).toBe('720');
    // une durée courte ne demande rien
    await page.selectOption('#mp-session-duration', '360');
    await page.waitForTimeout(500);
    await expect(page.locator('#confirm-modal-overlay.active')).toHaveCount(0);
    // une durée longue confirmée est enregistrée
    await page.selectOption('#mp-session-duration', '10080');
    await expect(page.locator('#confirm-modal-overlay.active')).toBeVisible();
    await page.click('#confirm-modal-confirm-btn');
    await page.waitForTimeout(600);
    expect(await page.inputValue('#mp-session-duration')).toBe('10080');
    expect(erreurs).toEqual([]);
  });

  test.describe('téléphone (375 px)', () => {
    test.use({ viewport: { width: 375, height: 812 } });
    test('bibliothèque et éditeur sans défilement horizontal', async ({ page }) => {
      const erreurs = surveillerErreurs(page);
      await ouvrirBibliotheque(page);
      await stabiliser(page);
      expect(await debordementHorizontal(page), 'bibliothèque').toBeLessThanOrEqual(0);
      await creerProjet(page, 'Texte seul');
      await expect(page.locator('#fmt-bold-btn')).toBeVisible();
      await stabiliser(page);
      expect(await nbInert(page)).toBe(0);
      expect(await debordementHorizontal(page), 'éditeur').toBeLessThanOrEqual(0);
      expect(erreurs).toEqual([]);
    });
  });

  // axe-core (WCAG 2.2 AA) : on BLOQUE sur « critical » ; les autres niveaux sont listés dans le rapport (annotations) pour suivi.
  test('accessibilité (axe-core) : aucune violation critique sur la bibliothèque, l\'éditeur et le roman graphique', async ({ page }) => {
    await ouvrirBibliotheque(page);
    await stabiliser(page);
    const biblio = await violationsAxe(page, 'bibliothèque');
    await creerProjet(page, 'Texte seul');
    await expect(page.locator('#add-chapter-btn')).toBeVisible();
    await stabiliser(page);
    const editeur = await violationsAxe(page, 'éditeur');
    await page.click('#back-to-library-btn');
    await expect(page.locator('#library-new-btn')).toBeVisible();
    await creerProjet(page, 'Roman graphique');
    await expect(page.locator('#gn-add-text-btn')).toBeVisible();
    await stabiliser(page);
    const gn = await violationsAxe(page, 'roman graphique');
    const critiques = [...biblio, ...editeur, ...gn].filter(v => v.impact === 'critical');
    expect(critiques, JSON.stringify(critiques)).toEqual([]);
  });
});
