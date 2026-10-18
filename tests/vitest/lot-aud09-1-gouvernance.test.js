// ═══════════════════════════════════════════════════════
// LOT 1 de l'audit AUD-09 (cohérence globale) : documentation et gouvernance (AUD-09-006, 007, 016).
// Garde-fou : la version citée par le README est celle de l'application, les documents de cadrage existent et
// les affirmations devenues fausses ne reviennent pas dans CLAUDE.md / DECISIONS.md.
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const version = read('js/router.js').match(/const APP_VERSION = '([^']+)'/)[1];

describe('AUD-09-006 : sources de vérité cohérentes', () => {
  it('le README décrit la version courante de l\'application', () => {
    const m = read('README.md').match(/décrit la \*\*v(\d+\.\d+\.\d+)\*\*/);
    expect(m, 'le README doit annoncer « décrit la **vX.Y.Z** »').not.toBeNull();
    expect(m[1]).toBe(version);
  });
  it('APP_VERSION, sw.js et le README concordent', () => {
    expect(read('sw.js')).toContain("'plume-epique-v" + version + "'");
  });
  it('CLAUDE.md ne contient plus les affirmations périmées', () => {
    const c = read('CLAUDE.md');
    expect(c).not.toMatch(/README\.md` est à jour \(v9\.39\.0\)/);
    expect(c).not.toMatch(/budget d'images 350 Mo/);
    expect(c).not.toMatch(/router\.js` \(~96 Ko\)/);
    expect(c).not.toMatch(/repli pendant la transition/);
  });
  it('le protocole par lot n\'est écrit qu\'une fois dans CLAUDE.md (plus un bloc par audit)', () => {
    const n = (read('CLAUDE.md').match(/RAPPEL IMPÉRATIF/g) || []).length;
    expect(n).toBe(0);
    expect(read('CLAUDE.md')).toContain('Protocole par lot (impératif');
  });
  it('la décision 10 renvoie au stockage R2', () => {
    const d = read('docs/DECISIONS.md');
    expect(d).not.toMatch(/budget 350 Mo/);
    expect(d).toMatch(/Images dans R2/);
  });
  it('le commentaire d\'en-tête du roman graphique ne dit plus « pas d\'export PDF »', () => {
    expect(read('js/graphicnovel.js').slice(0, 1800)).not.toMatch(/pas d'export PDF/);
  });
});

describe('AUD-09-007 / 016 : documents de cadrage', () => {
  it('PRODUIT.md fixe public, échelle et non-objectifs', () => {
    const p = read('docs/PRODUIT.md');
    for (const t of ['Public visé', 'Échelle maximale', 'Non-objectifs']) expect(p).toContain(t);
  });
  it('RISQUES.md donne à chaque risque une date de réexamen et enregistre la décision sur la clé de synchro', () => {
    const r = read('docs/RISQUES.md');
    expect(r).toContain('Réexamen');
    expect(r).toMatch(/Rotation refusée par le propriétaire/);
  });
  it('le README référence les deux documents', () => {
    const r = read('README.md');
    expect(r).toContain('docs/PRODUIT.md');
    expect(r).toContain('docs/RISQUES.md');
  });
  it('le bilan 06 ne présente plus la rotation comme « prévue » sans mise à jour', () => {
    expect(read('docs/BILAN-AUDIT-06.md')).toMatch(/rotation a été refusée par le propriétaire le 12\/10\/2026/);
  });
});
