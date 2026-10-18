// ═══════════════════════════════════════════════════════
// LOT 2 de l'audit AUD-09 (AUD-09-001) : le dispositif de parcours navigateur ne doit pas disparaître en silence.
// Le parcours lui-même s'exécute avec `npm run e2e` (Playwright, tests/e2e) ; ici on garde seulement son câblage.
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('AUD-09-001 : câblage du parcours navigateur', () => {
  it('le script npm, la configuration et les scénarios existent', () => {
    expect(JSON.parse(read('package.json')).scripts.e2e).toBe('playwright test');
    expect(fs.existsSync(path.join(ROOT, 'playwright.config.js'))).toBe(true);
    const spec = read('tests/e2e/parcours.spec.js');
    // la régression qui a motivé le dispositif (v9.84.0 : page entière inerte)
    expect(spec).toContain('[inert]');
    expect(spec).toMatch(/axe-core/);
    expect((spec.match(/^\s*test\(/gm) || []).length).toBeGreaterThanOrEqual(6);
  });
  it('Playwright et axe-core sont des dépendances de développement (jamais servies au public)', () => {
    const p = JSON.parse(read('package.json'));
    expect(p.devDependencies['@playwright/test']).toBeTruthy();
    expect(p.devDependencies['axe-core']).toBeTruthy();
    expect(p.dependencies['@playwright/test']).toBeUndefined();
    expect(read('sw.js')).not.toMatch(/playwright|axe-core/);
  });
  it('Vitest n\'exécute pas les scénarios Playwright', () => {
    expect(read('vitest.config.js')).toContain("'tests/e2e/**'");
  });
  it('la CI installe Chromium et lance les parcours', () => {
    const w = read('.github/workflows/test.yml');
    expect(w).toContain('npx playwright install --with-deps chromium');
    expect(w).toContain('npm run e2e');
  });
  it('playwright.config.js n'est pas publié avec le site (404 par _routes.json)', () => {
    expect(JSON.parse(read('_routes.json')).include).toContain('/playwright.config.js');
  });
  it('la décision 15 mentionne le parcours automatisé', () => {
    expect(read('docs/DECISIONS.md')).toMatch(/\| 15 \|[^\n]*npm run e2e/);
  });
});
