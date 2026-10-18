// ═══════════════════════════════════════════════════════
// LOT 6 de l'audit AUD-09 (v9.88.0) : « Rester connecté » dit son risque (AUD-09-008) ; le correcteur du navigateur est actif par
// défaut (AUD-09-009). Le comportement dans le navigateur est couvert par tests/e2e/parcours.spec.js.
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html'), prof = read('js/profiles.js'), notif = read('js/notifications.js');

describe('AUD-09-008 : « Rester connecté » nomme le risque', () => {
  it('le panneau avertit que le navigateur donne accès aux textes sans mot de passe', () => {
    const panneau = html.slice(html.indexOf('Rester connecté sur cet appareil'), html.indexOf('id="mp-session-duration"'));
    expect(panneau).toMatch(/toute personne qui utilise ce navigateur peut ouvrir vos textes sans mot de passe/);
  });
  it('les durées longues sont étiquetées appareil personnel ; le défaut reste 12 h', () => {
    expect(html).toContain('<option value="10080">7 jours (appareil personnel)</option>');
    expect(html).toContain('<option value="43200">1 mois (appareil personnel)</option>');
    expect(html).toContain('<option value="-1">Toujours (appareil strictement personnel)</option>');
    expect(html).toContain('<option value="720">12 heures (par défaut)</option>');
    expect(prof).toContain('const DEFAULT_SESSION_MINUTES = 720;');
  });
  it('la page de confidentialité précise : même navigateur = même accès, même avec des profils séparés', () => {
    expect(html).toMatch(/en clair dans le navigateur : toute personne qui utilise le même navigateur peut alors ouvrir vos textes sans mot de passe, même si vos profils sont séparés/);
  });
  it('la confirmation ne concerne que 7 jours et plus ; refuser rétablit la durée précédente', () => {
    const m = prof.slice(prof.indexOf('const LONG_SESSION_MINUTES'), prof.indexOf('async function saveMyName'));
    const fn = new Function(m.slice(0, m.indexOf('async function saveMySessionDuration')) + '\nreturn isLongSession;')();
    for (const court of [0, 60, 360, 720, 1440]) expect(fn(court), String(court)).toBe(false);
    for (const long of [10080, 43200, -1]) expect(fn(long), String(long)).toBe(true);
    expect(m).toContain('if (isLongSession(minutes) && minutes !== avant)');
    expect(m).toContain('await showConfirmModal({');
    expect(m).toContain("if (!ok) { sel.value = String(avant); return; }");
    // la confirmation précède l'enregistrement
    expect(m.indexOf('showConfirmModal')).toBeLessThan(m.indexOf('mutateProfilesIndex'));
  });
});

describe('AUD-09-009 : correcteur du navigateur actif par défaut', () => {
  it('défaut « on » ; la valeur stockée prime (test de comportement dans lot40-confort-lecture)', () => {
    expect(notif).toMatch(/spell:\s+\{ key: 'plume_spellcheck',\s+vals: \['off', 'on'\],\s+def: 'on'/);
  });
  it('le réglage explique les noms inventés et le dictionnaire du navigateur', () => {
    expect(html).toMatch(/Les noms inventés[^<]*soulignés[^<]*clic droit/);
    expect(html).toMatch(/vérification améliorée/);
  });
  it('le registre des risques tient compte de la durée de session affichée', () => {
    expect(read('docs/RISQUES.md')).toMatch(/Rester connecté[^\n]*(avertissement|confirmation)/);
  });
});
