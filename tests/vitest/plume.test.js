// ═══════════════════════════════════════════════════════
// Migration vers Vitest (dette technique repérée le 26/07/2026) — remplace
// tests/test-runner.html (harnais maison assert()/group(), résultats
// visibles seulement en ouvrant une page HTML dans un navigateur) par une
// vraie suite Vitest : rapport détaillé assertion par assertion, `npm test`
// utilisable en CI, et surtout — le problème concret qui a motivé cette
// migration — un échec individuel (ex. le bug des couleurs de couverture)
// est désormais repéré par un `it()` qui échoue nommément, plutôt que noyé
// dans un compteur global "X/Y tests réussis" qu'il faut ouvrir et lire à
// la main pour repérer lequel a échoué.
//
// Le contenu logique des tests est IDENTIQUE à l'ancienne suite (voir
// tests/vitest/suite.js, extrait tel quel de tests/test-runner.js) — seul
// le harnais change. Les groupes/assertions sont générés dynamiquement à
// partir du résultat de la suite portée, exécutée une seule fois ci-dessous
// (top-level await), car tous les tests partagent le même état applicatif
// mutable (`db`, `cur`, etc.) exécuté dans l'ordre — comme le faisait déjà
// l'ancienne suite d'une seule traite.
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { runFullSuite } from './env.js';

const results = await runFullSuite();

if (!results || !results.length) {
  // Filet de sécurité : si la suite portée n'a produit aucun résultat
  // (erreur silencieuse dans l'environnement plutôt que dans un test précis),
  // on préfère un échec explicite et lisible à une suite Vitest vide qui
  // rapporterait "0 test" sans expliquer pourquoi.
  it('la suite portée doit produire au moins un résultat', () => {
    expect(results && results.length).toBeTruthy();
  });
} else {
  const groups = new Map();
  for (const r of results) {
    if (!groups.has(r.group)) groups.set(r.group, []);
    groups.get(r.group).push(r);
  }
  for (const [groupTitle, assertions] of groups) {
    describe(groupTitle, () => {
      for (const a of assertions) {
        it(a.label, () => { expect(a.pass).toBe(true); });
      }
    });
  }
}
