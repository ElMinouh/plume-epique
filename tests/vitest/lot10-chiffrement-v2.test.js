// ═══════════════════════════════════════════════════════
// LOT 10 (v9.31.0) — FORMAT DE TEXTE « v2 » (AUD-01-019), ÉTAPE 1 : LECTURE
// Tous les appareils savent LIRE v2 ; on continue d'ÉCRIRE v1 tant que Crypto.writeV2 est faux. Ces tests
// verrouillent aussi l'étape 2 (writeV2 = true) pour qu'elle soit sûre le jour venu.
// ═══════════════════════════════════════════════════════
import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const DEK = 'cle-de-donnees-de-test-lot10';

function makeCtx() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
  const ctx = dom.window; vm.createContext(ctx);
  Object.defineProperty(ctx, 'crypto', { value: globalThis.crypto, configurable: true });
  ctx.toast = vi.fn(); ctx.DOMPurify = { sanitize: x => x };
  for (const f of ['schema.js', 'crypto.js', 'router.js', 'library.js']) vm.runInContext(read('js/' + f), ctx, { filename: f });
  ctx.onload = null;
  ctx.Crypto = vm.runInContext('Crypto', ctx);
  vm.runInContext(`_dataKey = ${JSON.stringify(DEK)}; _currentProfileId = 'p1';`, ctx);
  return ctx;
}
const manuscrit = t => JSON.stringify({ _schemaVersion: 1, title: 'T', chapters: [{ id: 'c1', title: 'C', content: t }] });

describe('Format v2 : chiffrement et lecture', () => {
  const ctx = makeCtx(), C = ctx.Crypto;
  it('aller-retour, préfixe « v2: », texte accentué et gros volume', async () => {
    for (const texte of ['simple', 'Élodie « déjà » — 日本語 🪶', 'x'.repeat(3_000_000)]) {
      const c = await C.encryptV2(texte, DEK);
      expect(c.startsWith('v2:')).toBe(true);
      expect(await C.decrypt(c, DEK)).toBe(texte);   // decrypt() choisit seul le bon chemin
    }
  });
  it('deux chiffrements du même texte diffèrent (IV aléatoire) ; mauvaise clé ou altération : null', async () => {
    const a = await C.encryptV2('texte', DEK), b = await C.encryptV2('texte', DEK);
    expect(a).not.toBe(b);
    expect(await C.decrypt(a, 'autre-cle')).toBeNull();
    const octets = Uint8Array.from(atob(a.slice(3)), ch => ch.charCodeAt(0)); octets[octets.length - 1] ^= 1;
    expect(await C.decrypt('v2:' + ctx.bytesToBase64(octets), DEK)).toBeNull();
    expect(await C.decrypt('v2:pas-du-base64!!', DEK)).toBeNull();
  });
  it('le format v1 reste lu à l\'identique (aucune chaîne v1 ne peut être prise pour du v2)', async () => {
    const v1 = await C.encrypt('ancien texte', DEK);
    expect(v1.includes(':')).toBe(false);
    expect(await C.decrypt(v1, DEK)).toBe('ancien texte');
    expect(await C.decrypt(v1, 'mauvais')).toBeNull();
  });
  it('clé distincte de celle des images (séparation des domaines)', async () => {
    const octets = await C.encryptBytes(new TextEncoder().encode('image'), DEK);
    expect(await C.decrypt('v2:' + ctx.bytesToBase64(octets), DEK)).toBeNull(); // un chiffré d'image n'ouvre pas un texte
  });
});

describe('Point d\'entrée d\'écriture : encryptData et writeV2', () => {
  it('par défaut on écrit encore en v1 (étape 1) ; avec writeV2 = true on écrit en v2 (étape 2)', async () => {
    const ctx = makeCtx(), C = ctx.Crypto;
    expect(C.writeV2).toBe(false);
    expect((await C.encryptData('t', DEK)).startsWith('v2:')).toBe(false);
    C.writeV2 = true;
    expect((await C.encryptData('t', DEK)).startsWith('v2:')).toBe(true);
  });
  it('les enveloppes protégées par mot de passe (wrapPwd, wrapAnswer, wrapCode) restent en v1 quel que soit writeV2', () => {
    const src = read('js/profiles.js');
    const lignes = src.split('\n').filter(l => /(wrapPwd|wrapAnswer|wrapCode)\s*[:=]/.test(l) && /Crypto\.encrypt/.test(l));
    expect(lignes.length).toBeGreaterThanOrEqual(6);
    for (const l of lignes) { expect(l).toMatch(/Crypto\.encrypt\(/); expect(l).not.toMatch(/encryptData/); }
    expect(src).not.toMatch(/newWrap\w*\s*=\s*await Crypto\.encryptData/);
  });
  it('plus aucun chiffrement direct avec la clé de données hors du point d\'entrée', () => {
    for (const f of fs.readdirSync(path.join(ROOT, 'js')).filter(n => n.endsWith('.js'))) {
      const fautes = read('js/' + f).split('\n').filter(l => !/^\s*\/\//.test(l) && /Crypto\.encrypt\([^,()]*(\([^)]*\))?[^,()]*,\s*(_dataKey|dek)\)/.test(l));
      expect(fautes, f).toEqual([]);
    }
  });
  it('mesure : 15 chiffrements v2 sont au moins 5 fois plus rapides que 15 en v1 (PBKDF2 évité)', async () => {
    const ctx = makeCtx(), C = ctx.Crypto, texte = 'y'.repeat(90_000);
    await C.encryptV2('chauffe', DEK); // la clé est dérivée une fois, hors mesure
    let t = performance.now(); for (let i = 0; i < 15; i++) await C.encrypt(texte, DEK); const v1 = performance.now() - t;
    t = performance.now(); for (let i = 0; i < 15; i++) await C.encryptV2(texte, DEK); const v2 = performance.now() - t;
    expect(v2 * 5).toBeLessThan(v1);
  });
});

describe('Étape 2 sans risque : tout ce qui lit des données chiffrées lit v2 et v1, en mélange', () => {
  it('manuscrit : enveloppe v1, enveloppe v2, relecture croisée ; l\'empreinte du contenu est la même', async () => {
    const ctx = makeCtx(), C = ctx.Crypto;
    const env1 = await ctx.makeEncryptedEnvelope(manuscrit('même texte'));
    C.writeV2 = true;
    const env2 = await ctx.makeEncryptedEnvelope(manuscrit('même texte'));
    C.writeV2 = false;
    expect(env1.data.startsWith('v2:')).toBe(false);
    expect(env2.data.startsWith('v2:')).toBe(true);
    expect(env2._fp).toBe(env1._fp);
    for (const env of [env1, env2]) {
      await ctx.persistData('doc_p1_m1', env);
      expect((await ctx.loadManuscriptData('m1')).chapters[0].content).toBe('même texte');
    }
  });
  it('synchro : un appareil en v1 et un en v2 voient le MÊME contenu comme identique (pas de faux conflit)', async () => {
    const ctx = makeCtx(), C = ctx.Crypto;
    const env1 = await ctx.makeEncryptedEnvelope(manuscrit('texte commun'));
    C.writeV2 = true;
    const env2 = await ctx.makeEncryptedEnvelope(manuscrit('texte commun'));
    expect(await ctx.classifySyncDivergence(env1, env2, 'empreinte-de-base')).toBe('identical');
    const env3 = await ctx.makeEncryptedEnvelope(manuscrit('texte modifié'));
    expect(await ctx.classifySyncDivergence(env1, env3, env1._fp)).toBe('remote-only');
  });
  it('un manuscrit v1 resauvegardé après le passage à v2 devient v2, sans perte', async () => {
    const ctx = makeCtx(), C = ctx.Crypto;
    await ctx.persistData('doc_p1_m2', await ctx.makeEncryptedEnvelope(manuscrit('v1 d\'origine')));
    C.writeV2 = true;
    const ouvert = await ctx.loadManuscriptData('m2');
    ouvert.chapters[0].content += ' + ajout';
    await ctx.persistManuscriptData('m2', ouvert);
    expect((await ctx.readLocalOnly('doc_p1_m2')).data.startsWith('v2:')).toBe(true);
    expect((await ctx.loadManuscriptData('m2')).chapters[0].content).toBe('v1 d\'origine + ajout');
  });
  it('réglages (jeton GitHub chiffré) et contenu Gist : relus dans les deux formats', async () => {
    const ctx = makeCtx(), C = ctx.Crypto;
    for (const v2 of [false, true]) {
      C.writeV2 = v2;
      vm.runInContext("_cloudToken = 'ghp_secret_token'; _libSettings = { autoGistInterval: 15 };", ctx);
      await ctx.saveLibSettings();
      vm.runInContext("_cloudToken = '';", ctx);
      await ctx.loadLibSettings();
      expect(vm.runInContext('_cloudToken', ctx)).toBe('ghp_secret_token');
      const gist = JSON.stringify({ _enc: true, data: await C.encryptData(manuscrit('contenu gist'), DEK) });
      expect((await ctx.decryptGistContent(gist)).chapters[0].content).toBe('contenu gist');
    }
  });
});
