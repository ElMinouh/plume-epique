import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Un seul fichier de suite : tous les tests partagent le même contexte
    // applicatif (mêmes variables globales `db`/`cur`/etc. que l'app réelle),
    // exécuté dans l'ordre — comme l'ancienne suite tests/test-runner.html.
    fileParallelism: false,
    testTimeout: 20000
  }
});
