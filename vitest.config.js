import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Les copies de travail des sessions Claude (.claude/worktrees) contiennent des copies du dépôt : ne jamais les tester ici.
    exclude: ['**/node_modules/**', '.claude/**'],
    // Un seul fichier de suite : tous les tests partagent le même contexte
    // applicatif (mêmes variables globales `db`/`cur`/etc. que l'app réelle),
    // exécuté dans l'ordre — comme l'ancienne suite tests/test-runner.html.
    fileParallelism: false,
    testTimeout: 20000,
    // Les journaux structurés des Workers (une ligne JSON par requête) ne sont pas du bruit à afficher en test.
    onConsoleLog(log) { if (log.startsWith('{"evt":')) return false; }
  }
});
