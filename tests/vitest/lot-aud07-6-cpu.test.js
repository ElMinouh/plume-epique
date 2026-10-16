// ═══════════════════════════════════════════════════════
// AUD-07 LOT 6 (v9.75.0) — COÛT CPU À LA FRAPPE ET À L'ENREGISTREMENT (AUD-07-003, 002)
//  • comptage de mots mis en cache par chapitre ;
//  • conversion base64 native (chemin rapide) identique à l'ancien chemin.
// Code réel de schema.js, crypto.js, images.js.
// ═══════════════════════════════════════════════════════
import { describe, it, expect, vi } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');

function load(files) {
  const ctx = vm.createContext({ console, crypto: webcrypto, TextEncoder, TextDecoder, atob, btoa, Uint8Array, Date, Math, JSON, WeakMap, Map, Set, Promise });
  for (const f of files) vm.runInContext(read(f), ctx, { filename: f });
  return ctx;
}
const lire = (ctx, expr) => vm.runInContext(expr, ctx);

describe('003 — comptage de mots en cache par chapitre (schema.js)', () => {
  const ctx = load(['schema.js']);
  const chap = (n, id) => ({ id: 'c' + id, content: '<p>' + 'mot '.repeat(n) + '</p>' });

  it('donne exactement le même résultat que getWordCount', () => {
    const c = { content: "<p>L'homme, cœur&nbsp;: peut-être</p><p>— </p>" };
    expect(ctx.chapterWordCount(c)).toBe(ctx.getWordCount(c.content));
    const chapters = [chap(10, 1), chap(7, 2), { id: 'x' }, { id: 'y', content: null }, { id: 'z', content: 42 }];
    expect(ctx.chaptersTotalWords(chapters)).toBe(chapters.reduce((t, c) => t + ctx.getWordCount(c.content), 0)); // même sémantique qu'avant, y compris contenu absent, nul ou numérique
    expect(ctx.chaptersTotalWords(undefined)).toBe(0);
    expect(ctx.chapterWordCount(null)).toBe(0);
  });
  it('ne recompte jamais un chapitre inchangé ; ne recompte que celui qui a changé', () => {
    const chapters = Array.from({ length: 50 }, (_, i) => chap(20, i));
    const espion = vi.fn(ctx.getWordCount);
    ctx.getWordCount = espion;
    ctx.chaptersTotalWords(chapters);
    expect(espion).toHaveBeenCalledTimes(50);
    ctx.chaptersTotalWords(chapters); ctx.chaptersTotalWords(chapters);
    expect(espion).toHaveBeenCalledTimes(50); // deux sommes de plus : aucun recomptage
    chapters[7].content = '<p>un deux trois</p>';
    expect(ctx.chaptersTotalWords(chapters)).toBe(49 * 20 + 3);
    expect(espion).toHaveBeenCalledTimes(51); // un seul chapitre recompté
  });
  it('suit une modification, un remplacement par une chaîne égale et une réutilisation de l\'objet', () => {
    const c = { content: '<p>a b c</p>' };
    expect(ctx.chapterWordCount(c)).toBe(3);
    c.content = '<p>a b c d</p>';
    expect(ctx.chapterWordCount(c)).toBe(4);
    c.content = '<p>a b c ' + 'd</p>'; // chaîne différente par construction, même texte
    expect(ctx.chapterWordCount(c)).toBe(4);
    c.content = '';
    expect(ctx.chapterWordCount(c)).toBe(0);
  });
  it('n\'ajoute rien à l\'objet chapitre : le manuscrit enregistré reste identique', () => {
    const c = chap(5, 1);
    const avant = JSON.stringify(c);
    ctx.chapterWordCount(c);
    expect(JSON.stringify(c)).toBe(avant);
    expect(Object.keys(c)).toEqual(['id', 'content']);
  });
  it('une somme sur un gros manuscrit déjà compté est quasi gratuite (200 chapitres × 1 000 frappes)', () => {
    const chapters = Array.from({ length: 200 }, (_, i) => chap(700, i));
    ctx.chaptersTotalWords(chapters); // première passe
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) ctx.chaptersTotalWords(chapters);
    expect(performance.now() - t0).toBeLessThan(500);
  });
  it('les sommes de la frappe et de l\'enregistrement passent toutes par le cache (stats, index, éditeur…)', () => {
    for (const f of ['stats.js', 'library.js', 'editor.js', 'router.js', 'readability.js', 'pluginSystem.js', 'profiles.js']) {
      expect(read(f), f).not.toMatch(/\.reduce\(\([^)]*\)\s*=>[^)]*getWordCount\(/);
    }
    expect(read('stats.js')).toMatch(/chaptersTotalWords\(db\.chapters\)/);
    expect(read('library.js')).toMatch(/entry\.wordCount = chaptersTotalWords\(db\.chapters\)/);
  });
});

describe('002 — base64 natif : mêmes chaînes que l\'ancien chemin (crypto.js, images.js)', () => {
  const anciennePourBytes = bytes => { let b = ''; for (let i = 0; i < bytes.length; i += 0x8000) b += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(b); };
  const aleatoire = n => { const b = new Uint8Array(n); for (let i = 0; i < n; i += 65536) webcrypto.getRandomValues(b.subarray(i, Math.min(n, i + 65536))); return b; };
  const tailles = [0, 1, 2, 3, 4, 5, 100, 32767, 32768, 32769, 100003, 400000];

  for (const [nom, fichiers, enc, dec] of [
    ['crypto.js', ['crypto.js'], 'bytesToBase64', 'base64ToBytes'],
    ['images.js', ['images.js'], 'imgBytesToBase64', 'imgBase64ToBytes']
  ]) {
    it(`${nom} : chemin natif = ancien chemin, aller-retour exact (tailles ${tailles.length})`, () => {
      const ctx = load(fichiers);
      for (const n of tailles) {
        const b = aleatoire(n);
        const attendu = anciennePourBytes(b);
        expect(lire(ctx, enc)(b), nom + ' ' + n).toBe(attendu);
        expect(Array.from(lire(ctx, dec)(attendu))).toEqual(Array.from(b));
      }
    });
    it(`${nom} : sans conversion native (navigateur plus ancien), résultat identique`, () => {
      const ctx = load(fichiers);
      const proto = lire(ctx, 'Uint8Array.prototype');
      const sauv = [proto.toBase64, lire(ctx, 'Uint8Array').fromBase64];
      proto.toBase64 = undefined; ctx.Uint8Array.fromBase64 = undefined;
      try {
        for (const n of [0, 1, 2, 3, 40000, 100003]) {
          const b = aleatoire(n);
          const attendu = anciennePourBytes(b);
          expect(lire(ctx, enc)(b)).toBe(attendu);
          expect(Array.from(lire(ctx, dec)(attendu))).toEqual(Array.from(b));
        }
      } finally { proto.toBase64 = sauv[0]; ctx.Uint8Array.fromBase64 = sauv[1]; }
    });
  }
  it('une entrée invalide échoue comme avant (déchiffrement : null, jamais une exception)', async () => {
    const ctx = load(['crypto.js']);
    const C = lire(ctx, 'Crypto');
    expect(await C.decryptV2('!!!pas-du-base64***', 'cle')).toBeNull();
    expect(await C.decrypt('###', 'mot de passe')).toBeNull();
  });
  it('chiffrement v2 : aller-retour, et un texte chiffré par l\'ancien chemin se déchiffre toujours', async () => {
    const ctx = load(['crypto.js']);
    const C = lire(ctx, 'Crypto');
    const texte = JSON.stringify({ chapitres: 'é à ç ' .repeat(50000) });
    const enc = await C.encryptData(texte, 'dek-de-test');
    expect(enc.startsWith('v2:')).toBe(true);
    expect(await C.decryptData ? await C.decryptData(enc, 'dek-de-test') : await C.decrypt(enc, 'dek-de-test')).toBe(texte);
    // chaîne « v2: » fabriquée avec l'ANCIEN encodage : doit se déchiffrer avec le nouveau code
    const dec = Uint8Array.from(atob(enc.slice(3)), c => c.charCodeAt(0));
    const reencodee = 'v2:' + anciennePourBytes(dec);
    expect(reencodee).toBe(enc);
    expect(await C.decrypt(reencodee, 'dek-de-test')).toBe(texte);
  });
});
