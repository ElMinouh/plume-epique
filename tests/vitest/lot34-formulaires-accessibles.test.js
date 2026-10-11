// ═══════════════════════════════════════════════════════
// LOT 1 « noms des champs de formulaire » (v9.57.0, audit AUD-05-001, 002, début de 017)
// Garde-fou : tout champ de saisie doit avoir un nom accessible (label[for], label englobant,
// aria-label ou aria-labelledby). placeholder et title ne comptent PAS : ce sont des replis fragiles.
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

// Renvoie la liste des champs (input/select/textarea visibles) dépourvus de nom accessible.
function champsSansNom(src) {
  const labelsFor = new Set([...src.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)].map(m => m[1]));
  const sans = [];
  for (const m of src.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
    const a = m[2];
    if (/type="(hidden|file)"/.test(a) && !/aria-label/.test(a) && /type="hidden"/.test(a)) continue;
    if (/aria-label=|aria-labelledby=/.test(a)) continue;
    const id = (a.match(/\bid="([^"]+)"/) || [])[1];
    if (id && labelsFor.has(id)) continue;
    // champ enveloppé par un <label> encore ouvert juste avant
    const avant = src.slice(Math.max(0, m.index - 250), m.index);
    const i = avant.lastIndexOf('<label');
    if (i !== -1 && !avant.slice(i).includes('</label>')) continue;
    sans.push(id || a.trim().slice(0, 40));
  }
  return sans;
}

describe('AUD-05-001/002 — chaque champ a un nom accessible', () => {
  it('index.html : aucun champ sans nom', () => {
    expect(champsSansNom(read('index.html'))).toEqual([]);
  });
  it('js/profiles.js (écrans de connexion, création, récupération) : aucun champ sans nom', () => {
    expect(champsSansNom(read('js/profiles.js'))).toEqual([]);
  });
  it('profiles.js : tout label.gate-label porte un for qui pointe un id existant', () => {
    const src = read('js/profiles.js');
    const labels = [...src.matchAll(/<label class="gate-label"([^>]*)>/g)];
    expect(labels.length).toBeGreaterThan(10);
    for (const l of labels) {
      const f = (l[1].match(/for="([^"]+)"/) || [])[1];
      expect(f, 'label sans for').toBeTruthy();
      expect(src.includes(`id="${f}"`), `id introuvable : ${f}`).toBe(true);
    }
  });
  it('le détecteur échoue bien sur un champ sans nom (auto-test)', () => {
    expect(champsSansNom('<input id="x" placeholder="Nom">')).toEqual(['x']);
    expect(champsSansNom('<label for="x">Nom</label><input id="x">')).toEqual([]);
  });
});

describe('Version', () => {
  it('v9.57.0 ou plus : APP_VERSION et cache du service worker identiques', () => {
    const v = read('js/router.js').match(/const APP_VERSION = '([\d.]+)'/)[1];
    const c = read('sw.js').match(/const CACHE = 'plume-epique-v([\d.]+)'/)[1];
    expect(c).toBe(v);
    const [a, b] = v.split('.').map(Number);
    expect(a > 9 || (a === 9 && b >= 57)).toBe(true);
  });
});
