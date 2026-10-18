// Parcours navigateur (audit AUD-09-001) : `npm run e2e`. Séparé de `npm test` (Vitest, Node) pour que ce dernier reste rapide.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.js',
  timeout: 60000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:18911', serviceWorkers: 'block', locale: 'fr-FR' },
  webServer: { command: 'node tests/e2e/serveur.mjs', url: 'http://127.0.0.1:18911/index.html', reuseExistingServer: !process.env.CI }
});
