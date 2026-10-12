// ═══════════════════════════════════════════════════════
// AUD-06 LOT 4a (v9.66.0) — COÛT DE DÉRIVATION VERSIONNÉ ET MOTS DE PASSE TRIVIAUX (AUD-06-004)
// Format p2 : lu par tous les appareils dès cette version, écrit seulement quand Crypto.writeP2 = true (étape 2).
// La question secrète est CONSERVÉE (décision du propriétaire, 2026-10-12) : AUD-06-003 reste un risque assumé.
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

function loadCrypto() {
  const ctx = vm.createContext({ crypto: globalThis.crypto, TextEncoder, TextDecoder, Uint8Array, atob, btoa, console, parseInt });
  vm.runInContext(read('js/crypto.js').replace("'use strict';", '') + '\nthis.Crypto = Crypto;', ctx);
  return ctx.Crypto;
}
function loadWeak() {
  const src = read('js/profiles.js');
  const a = src.indexOf('const MIN_PASSWORD_LENGTH'), b = src.indexOf('const WEAK_PASSWORD_MESSAGE');
  const bloc = src.slice(a, src.indexOf('\n', b));
  const ctx = vm.createContext({ Set, String });
  vm.runInContext(bloc + '\nthis.isWeakPassword = isWeakPassword; this.MSG = WEAK_PASSWORD_MESSAGE;', ctx);
  return ctx;
}

describe('Enveloppe p2 : coût de dérivation écrit dans l\'enveloppe', () => {
  it('aller-retour p2 à 600 000 itérations ; l\'enveloppe annonce son coût', async () => {
    const C = loadCrypto();
    const env = await C.encryptP2('la-cle-de-donnees', 'motdepasse-solide-xyz');
    expect(env).toMatch(/^p2:600000:[A-Za-z0-9+/=]+$/);
    expect(await C.decrypt(env, 'motdepasse-solide-xyz')).toBe('la-cle-de-donnees');
    expect(await C.decrypt(env, 'mauvais-mot-de-passe')).toBeNull();
  });
  it('le coût est bien PLUS ÉLEVÉ qu\'avant (mesure relative, pas une valeur absolue)', async () => {
    const C = loadCrypto();
    const t = async f => { const t0 = performance.now(); await f(); return performance.now() - t0; };
    const vieux = await t(() => C.encryptLegacy('x', 'pwd-pour-mesure'));
    const neuf = await t(() => C.encryptP2('x', 'pwd-pour-mesure'));
    expect(neuf).toBeGreaterThan(vieux * 1.3);
  });
  it('les enveloppes historiques (v1) restent lisibles ; p2 à 310 000 itérations aussi (montée de coût sans casse)', async () => {
    const C = loadCrypto();
    const v1 = await C.encryptLegacy('secret', 'un-mot-de-passe-12');
    expect(v1).not.toMatch(/^(p2|v2):/);
    expect(await C.decrypt(v1, 'un-mot-de-passe-12')).toBe('secret');
    const p2bas = await C.encryptP2('secret', 'un-mot-de-passe-12', 310000);
    expect(await C.decrypt(p2bas, 'un-mot-de-passe-12')).toBe('secret');
  });
  it('itérations lues dans une enveloppe : bornées (une valeur gigantesque ne fige pas la connexion)', async () => {
    const C = loadCrypto();
    const env = await C.encryptP2('x', 'mot-de-passe-12ch', 150000);
    for (const bad of ['p2:2147483647:' + env.split(':')[2], 'p2:1:' + env.split(':')[2], 'p2:abc:' + env.split(':')[2], 'p2:' + env.split(':')[2]]) {
      const t0 = performance.now();
      expect(await C.decrypt(bad, 'mot-de-passe-12ch')).toBeNull();
      expect(performance.now() - t0).toBeLessThan(1500);
    }
  });
  it('écriture p2 ACTIVÉE (v9.66.1) : encrypt écrit p2 à 600 000 ; retour arrière possible (writeP2 = false)', async () => {
    const C = loadCrypto();
    expect(C.writeP2).toBe(true);
    expect(await C.encrypt('x', 'mot-de-passe-12ch')).toMatch(/^p2:600000:/);
    C.writeP2 = false;
    expect(await C.encrypt('x', 'mot-de-passe-12ch')).not.toMatch(/^p2:/);
  });
  it('encryptData n\'utilise JAMAIS p2 (la clé de données est déjà forte), même quand writeP2 est actif', async () => {
    const C = loadCrypto();
    C.writeP2 = true; C.writeV2 = false;
    const env = await C.encryptData('texte', 'cle-de-donnees-forte');
    expect(env).not.toMatch(/^p2:/);
    expect(await C.decrypt(env, 'cle-de-donnees-forte')).toBe('texte');
    C.writeV2 = true;
    expect((await C.encryptData('texte', 'cle-de-donnees-forte')).startsWith('v2:')).toBe(true);
  });
  it('envelopeNeedsUpgrade : faux tant que p2 n\'est pas activé ; vrai ensuite pour v1 et p2 à bas coût, faux pour p2 à jour', async () => {
    const C = loadCrypto();
    const v1 = await C.encryptLegacy('x', 'mot-de-passe-12ch'), bas = await C.encryptP2('x', 'mot-de-passe-12ch', 310000), plein = await C.encryptP2('x', 'mot-de-passe-12ch');
    C.writeP2 = false;
    expect(C.envelopeNeedsUpgrade(v1)).toBe(false); // écriture p2 désactivée : rien à ré-écrire
    C.writeP2 = true;
    expect(C.envelopeNeedsUpgrade(v1)).toBe(true);
    expect(C.envelopeNeedsUpgrade(bas)).toBe(true);
    expect(C.envelopeNeedsUpgrade(plein)).toBe(false);
  });
});

describe('Mots de passe trop simples (refusés à la création et au changement)', () => {
  const { isWeakPassword: weak } = loadWeak();
  it.each([
    'motdepasse1234', 'Motdepasse!2024', 'azertyuiop12', 'password1234', 'Password123456', 'qwertyuiop123', 'abcdefghijkl',
    'aaaaaaaaaaaa', '121212121212', '123456789012', 'abcdefgh1234', 'bonjour123456', 'iloveyou2024!', 'Plume Épique 1', 'plume-epique-12'
  ])('refuse « %s »', p => expect(weak(p, 'Alice')).toBe(true));
  it('refuse un mot de passe bâti sur le nom du profil', () => {
    expect(weak('cyril20241234', 'Cyril')).toBe(true);
    expect(weak('Cyril-Cyril-1', 'Cyril')).toBe(true);
  });
  it.each([
    'maison rouge pluie douce', 'le-chat-boit-du-lait-1', 'Tr0ubadour-vert-bleu', 'pluie-douce-matin', 'cinq petits canards 2026',
    'bibliotheque-du-grenier-42', 'xk7-Quartz-lumiere'
  ])('accepte « %s » (phrase de passe ou mot de passe varié)', p => expect(weak(p, 'Alice')).toBe(false));
  it('une phrase longue contenant le nom du profil reste acceptée', () => {
    expect(weak('cyril aime les pommes vertes du verger', 'Cyril')).toBe(false);
  });
  it('un nom très court n\'est pas utilisé pour refuser (moins de 3 caractères)', () => {
    expect(weak('Jo-le-lapin-vert-12', 'Jo')).toBe(false);
  });
});

describe('Branchements dans l\'application', () => {
  const src = read('js/profiles.js');
  it('refus à la création, à la récupération et au changement de mot de passe', () => {
    expect(src).toMatch(/isWeakPassword\(pwd, name\)\) \{ gateFail\(errEl, 'cp-pwd'/);
    expect(src).toMatch(/isWeakPassword\(pwd, profil && profil\.name\)\) \{ gateFail\(errEl, 'rec-pwd'/);
    expect(src).toMatch(/isWeakPassword\(newPwd, _currentProfile && _currentProfile\.name\)\) \{ toast\(WEAK_PASSWORD_MESSAGE/);
  });
  it('un mot de passe existant n\'est jamais bloqué à la connexion : simple rappel, ré-enveloppement en arrière-plan', () => {
    const login = src.slice(src.indexOf('async function doLogin'), src.indexOf('async function afterPasswordLogin'));
    expect(login).not.toMatch(/isWeakPassword/);
    expect(login).toContain('afterPasswordLogin(profil, pwd, dek)');
    const apres = src.slice(src.indexOf('async function afterPasswordLogin'), src.indexOf('// ── ÉCRAN 4'));
    expect(apres).toContain('Crypto.envelopeNeedsUpgrade(profil.wrapPwd)');
    expect(apres).toContain("'info', { sticky: true }");
    expect(apres).toMatch(/catch \(e\) \{ \/\* amélioration facultative/);
  });
  it('la question secrète est conservée (décision du propriétaire, AUD-06-003 accepté) : champs et enveloppe toujours là', () => {
    expect(src).toContain('wrapAnswer: await Crypto.encrypt(dek, Crypto.normalize(answer))');
    expect(src).toContain('id="cp-question"');
  });
  it('la récupération par la réponse ré-enveloppe aussi la réponse au coût actuel', () => {
    expect(src).toContain('Crypto.envelopeNeedsUpgrade(profil.wrapAnswer)');
  });
});
