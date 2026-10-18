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
