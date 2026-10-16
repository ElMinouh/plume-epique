// ═══════════════════════════════════════════════════════
// AUD-06 LOT 5 (v9.67.0) — SAISIES ET JETON GITHUB (AUD-06-018, 019, 021)
// 005 (session en clair) : risque ACCEPTÉ par le propriétaire (12/10/2026), rien n'est modifié de ce côté.
// ═══════════════════════════════════════════════════════
import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const jsFiles = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'));

describe('018 — valeurs d\'attribut échappées (escapeHtml), jamais DOMPurify', () => {
  it('aucun gabarit n\'insère le résultat de DOMPurify.sanitize DANS un attribut HTML', () => {
    const motif = /[a-z-]+="[^"<>]*\$\{DOMPurify\.sanitize\([^)]*\)[^"]*"/g;
    for (const f of jsFiles) expect(read('js/' + f).match(motif) || [], f).toEqual([]);
  });
  it('les identifiants insérés dans un ATTRIBUT HTML passent par escapeHtml (les sélecteurs CSS querySelector ne sont pas concernés)', () => {
    const motif = /="\$\{(?!escapeHtml)[A-Za-z_]+\.id\}"/;
    for (const f of jsFiles) {
      const fautives = read('js/' + f).split('\n').filter(l => motif.test(l) && !/querySelector/.test(l));
      expect(fautives, f).toEqual([]);
    }
  });
  it('escapeHtml neutralise guillemets, chevrons et esperluette : un nom piégé ne crée plus d\'attribut', () => {
    const { window } = new JSDOM('<body></body>');
    const ctx = vm.createContext({ ensureLib: () => Promise.resolve(true), });
    vm.runInContext(read('js/schema.js').slice(read('js/schema.js').indexOf('function escapeHtml'), read('js/schema.js').indexOf('function escapeHtml') + 260) + '\nthis.escapeHtml = escapeHtml;', ctx);
    const piege = 'x" autofocus onfocus="alert(1)" data-y="';
    const div = window.document.createElement('div');
    div.innerHTML = '<span title="' + ctx.escapeHtml(piege) + '">t</span>';
    expect([...div.firstChild.attributes].map(a => a.name)).toEqual(['title']);
    expect(div.firstChild.getAttribute('title')).toBe(piege);
  });
});

describe('019 — limites d\'import (3 fois les usages réels)', () => {
  const src = read('js/export-format-utils.js');
  const bloc = src.slice(src.indexOf('// ── LIMITES D\'IMPORT'), src.indexOf('// ── fin des limites d\'import'));
  function charger() {
    const ctx = vm.createContext({ ensureLib: () => Promise.resolve(true),  JSZip: require('jszip'), Promise, Math, Number, String, console });
    vm.runInContext(bloc + '\nthis.api = { IMPORT_MAX_DOC_BYTES, IMPORT_MAX_UNZIPPED_BYTES, IMPORT_MAX_JSON_BYTES, formatMo, zipUnzippedSize, assertZipNotBomb, isValidImportedEnvelope };', ctx);
    return ctx.api;
  }
  it('valeurs : 300 Mo (Word/ODT), 3 Go (décompressé), 900 Mo (JSON)', () => {
    const a = charger();
    expect(a.IMPORT_MAX_DOC_BYTES).toBe(300 * 1024 * 1024);
    expect(a.IMPORT_MAX_UNZIPPED_BYTES).toBe(3 * 1024 * 1024 * 1024);
    expect(a.IMPORT_MAX_JSON_BYTES).toBe(900 * 1024 * 1024);
  });
  it('formatMo : lisible', () => {
    const a = charger();
    expect(a.formatMo(3 * 1048576)).toBe('3 Mo');
    expect(a.formatMo(1.5 * 1048576)).toBe('1.5 Mo');
    expect(a.formatMo(300 * 1048576)).toBe('300 Mo');
  });
  it('archive normale : acceptée ; archive qui se décompresserait au-delà de la limite : refusée avec un message clair', async () => {
    const a = charger();
    const JSZip = require('jszip');
    const zip = new JSZip();
    zip.file('word/document.xml', 'a'.repeat(2 * 1024 * 1024)); // 2 Mo décompressés, quelques Ko compressés (taux énorme)
    const buf = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    expect(buf.length).toBeLessThan(50 * 1024);
    expect(await a.zipUnzippedSize(buf)).toBe(2 * 1024 * 1024);
    await expect(a.assertZipNotBomb(buf)).resolves.toBeUndefined();
    await expect(a.assertZipNotBomb(buf, 1024 * 1024)).rejects.toThrow(/décompresserait en 2 Mo \(limite 1 Mo\)/);
  });
  it('enveloppe importée : forme vérifiée', () => {
    const a = charger();
    expect(a.isValidImportedEnvelope({ _enc: true, data: 'v2:abc' })).toBe(true);
    for (const mauvaise of [null, undefined, 'x', 5, {}, { _enc: false, data: 'x' }, { _enc: true }, { _enc: true, data: '' }, { _enc: true, data: 42 }]) {
      expect(a.isValidImportedEnvelope(mauvaise)).toBe(false);
    }
  });

  function chargerImport(fichier) {
    const msgs = [];
    const ctx = vm.createContext({ ensureLib: () => Promise.resolve(true),  Promise, Math, Number, String, console, JSZip: require('jszip'), mammoth: { convertToHtml: vi.fn() }, window: { odfKit: { odtToHtml: vi.fn() } }, EXPORT_LIB_MISSING: 'lib', toast: (m, t) => msgs.push([m, t]), sanitizeManuscriptHtml: h => h, openDocxImportModal: vi.fn() });
    const debut = src.indexOf('// ── LIMITES D\'IMPORT'), fin = src.indexOf('async function openDocxImportModal');
    vm.runInContext(src.slice(debut, fin).replace('function splitImportedHtml', 'function splitImportedHtml_') + '\nthis.importManuscriptFile = importManuscriptFile;', ctx);
    const input = { files: [fichier], value: 'x' };
    return { ctx, input, msgs };
  }
  it('un Word/ODT trop gros est refusé AVANT toute lecture, avec sa taille et un conseil', () => {
    const lu = vi.fn();
    const { ctx, input, msgs } = chargerImport({ name: 'roman.docx', size: 301 * 1024 * 1024, arrayBuffer: lu });
    ctx.importManuscriptFile(input);
    expect(lu).not.toHaveBeenCalled();
    expect(msgs[0][0]).toMatch(/301 Mo.*limite d'import \(300 Mo\).*sans les images/);
    expect(msgs[0][1]).toBe('error');
    expect(input.value).toBe('');
  });
  it('un fichier de taille normale est lu normalement (pas de refus)', async () => {
    const JSZip = require('jszip');
    const z = new JSZip(); z.file('a.txt', 'bonjour');
    const buf = await z.generateAsync({ type: 'arraybuffer' });
    const { ctx, input, msgs } = chargerImport({ name: 'petit.odt', size: buf.byteLength, arrayBuffer: async () => buf });
    ctx.importManuscriptFile(input);
    await new Promise(r => setTimeout(r, 50));
    expect(msgs.filter(m => /limite/.test(m[0]))).toEqual([]);
  });
  it('l\'import de bibliothèque JSON vérifie la taille avant de lire, et la forme de chaque manuscrit', () => {
    const i = src.indexOf('function importProjectLibrary');
    const corps = src.slice(i, src.indexOf('reader.readAsText(file);', i));
    expect(corps).toContain('file.size > IMPORT_MAX_JSON_BYTES');
    expect(corps.indexOf('file.size > IMPORT_MAX_JSON_BYTES')).toBeLessThan(corps.indexOf('new FileReader()'));
    expect(corps).toContain('isValidImportedEnvelope(envelope)');
  });
});

describe('021 — jeton GitHub : aide, avertissement, en-tête moderne', () => {
  const lib = read('js/library.js');
  function chargerScopes() {
    const a = lib.indexOf('function tokenScopesTooBroad');
    const ctx = vm.createContext({ ensureLib: () => Promise.resolve(true),  String });
    vm.runInContext(lib.slice(a, lib.indexOf('async function libVerifyToken')) + '\nthis.f = tokenScopesTooBroad;', ctx);
    return ctx.f;
  }
  it('détecte les droits trop larges (dépôts, administration, workflows), pas le seul droit gist', () => {
    const f = chargerScopes();
    for (const large of ['repo', 'gist, repo', 'read:user, repo, gist', 'admin:org', 'workflow', 'delete_repo', 'repo, workflow']) expect(f(large), large).toBe(true);
    for (const ok of ['gist', '', null, undefined, 'gist, read:user', 'read:org']) expect(f(ok), String(ok)).toBe(false);
  });
  it('l\'aide est affichée sous le champ et liée au champ (accessibilité)', () => {
    const html = read('index.html');
    expect(html).toContain('id="lib-token-help"');
    expect(html).toMatch(/aria-describedby="lib-token-help"/);
    expect(html).toContain('granularité fine');
    expect(html).toContain('« Gists »');
    expect(html).toContain('90 jours');
  });
  it('plus aucun en-tête « Authorization: token … » : schéma Bearer partout', () => {
    expect(lib).not.toMatch(/Authorization'?:\s*`token /);
    expect(lib.match(/Authorization'?:\s*`Bearer \$\{_cloudToken\}`/g).length).toBeGreaterThanOrEqual(6);
  });
  it('l\'avertissement est affiché à la vérification du jeton, sans jamais bloquer', () => {
    expect(lib).toContain('_tokenScopesTooBroad = tokenScopesTooBroad(resp.headers.get(\'X-OAuth-Scopes\'))');
    expect(lib).toMatch(/if \(_tokenScopesTooBroad\) \{[^}]*Recréez-en un limité au seul droit « Gists »/);
  });
});

describe('019 — l\'utilisateur est informé des manuscrits ignorés', () => {
  it('le message d\'import mentionne les manuscrits au format invalide (jamais « déjà présents » à tort)', () => {
    const src = read('js/export-format-utils.js');
    expect(src).toContain('else if (!added && invalidCount)');
    expect(src).toContain("'manuscrit ignoré', 'manuscrits ignorés') + ' : format invalide");
  });
});
