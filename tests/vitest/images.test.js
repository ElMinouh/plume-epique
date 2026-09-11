// ═══════════════════════════════════════════════════════
// Tests dédiés à js/images.js (Lot 9, audit #28) — stockage et
// déduplication des images du roman graphique (Lot 8, audit #26/#27).
//
// Fichier isolé, séparé de la suite portée (env.js/suite.js/plume.test.js) :
// images.js n'a AUCUNE dépendance sur le reste de l'app (voir l'en-tête de
// ce fichier) — inutile de partager le contexte fragile `db`/`cur` de
// l'ancienne suite, un contexte jsdom+vm dédié et plus léger suffit.
//
// compressImageFile() (redimensionnement/compression réels via canvas +
// createImageBitmap) n'est PAS couvert ici : ni jsdom ni Node ne
// fournissent ces API sans dépendance native supplémentaire (le paquet
// "canvas", fragile à installer). On substitue une version minimale après
// chargement du fichier (voir loadImagesModule ci-dessous) pour
// pouvoir tester ce qui compte réellement dans ce lot : le stockage, la
// déduplication par contenu et le compteur de références. La vérification
// visuelle du redimensionnement reste manuelle (déjà le cas jusqu'ici).
// ═══════════════════════════════════════════════════════
import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as idb from 'idb';
import 'fake-indexeddb/auto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const IMAGES_JS_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'js', 'images.js'), 'utf8');
let _dbNameCounter = 0;

// Un contexte jsdom+vm frais ET une base IndexedDB (fake-indexeddb) au nom
// UNIQUE par appel : plus simple et plus fiable qu'une remise à zéro entre
// tests (deleteDatabase() sur une base encore "ouverte" par le contexte du
// test précédent peut rester bloquée indéfiniment côté fake-indexeddb) —
// chaque test a ainsi sa propre base, sans aucun risque de pollution croisée.
function loadImagesModule() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
  const context = dom.window;
  vm.createContext(context);
  // Mêmes polyfills que tests/vitest/env.js pour crypto (window.crypto est
  // un accesseur lecture-seule sous jsdom, sans `subtle`).
  Object.defineProperty(context, 'crypto', { value: globalThis.crypto, configurable: true });
  // indexedDB : jsdom ne l'implémente pas — fake-indexeddb (importé en 'auto'
  // plus haut, qui l'installe sur `globalThis`) fournit une base en mémoire
  // fidèle à la vraie API.
  context.indexedDB = globalThis.indexedDB;
  context.IDBKeyRange = globalThis.IDBKeyRange;
  // idb : bibliothèque chargée via CDN en production (voir sw.js,
  // CDN_ASSETS) — ici la même bibliothèque, depuis npm.
  context.idb = idb;
  // genElementId (js/schema.js) : storeGraphicImage() en dépend pour générer
  // l'id d'un nouvel enregistrement — la seule dépendance réelle d'images.js
  // sur le reste de l'app (l'en-tête du fichier dit "aucune", légèrement
  // inexact). Stub minimal plutôt que de charger schema.js en entier, pour
  // garder ce fichier de test aussi isolé que possible.
  context.genElementId = () => (context.crypto.randomUUID ? context.crypto.randomUUID() : 'el_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  // Nom de base rendu unique par test (voir commentaire ci-dessus).
  const uniqueSource = IMAGES_JS_SOURCE.replace(
    "const PLUME_IMAGES_DB = 'plume_epique_images';",
    `const PLUME_IMAGES_DB = 'plume_epique_images_test_${++_dbNameCounter}';`
  );
  vm.runInContext(uniqueSource, context, { filename: 'images.js' });
  // Substitut de compressImageFile (voir note d'en-tête) : pas de vraie
  // compression, le "fichier" passé par les tests EST déjà le blob final —
  // seul le comportement de stockage/déduplication est sous test ici.
  context.compressImageFile = async file => ({ blob: file, width: 800, height: 600 });
  return context;
}

// Fabrique un Blob de contenu déterministe — deux appels avec le même
// argument `seed` produisent un contenu strictement identique (donc le même
// hash SHA-256), ce que les tests de déduplication ont besoin de vérifier.
// Blob NATIF de Node (pas context.Blob, celui de jsdom) : fake-indexeddb
// tourne dans le même contexte que ce fichier de test, pas dans le vm créé
// pour images.js — avec un Blob jsdom, son clonage structuré ne reconnaît
// pas la classe et le stocke comme un objet vide (bug de test constaté,
// pas un bug de l'app : un vrai navigateur n'a qu'un seul Blob).
function fakeFile(context, seed) {
  return new Blob([`contenu-image-${seed}`], { type: 'image/webp' });
}

describe('images.js — stockage et déduplication (Lot 8/9, audit #26/#27)', () => {
  let ctx;
  beforeEach(() => { ctx = loadImagesModule(); });

  it('computeImageHash : même contenu → même hash', async () => {
    const a = await ctx.computeImageHash(fakeFile(ctx, 'x'));
    const b = await ctx.computeImageHash(fakeFile(ctx, 'x'));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('computeImageHash : contenu différent → hash différent', async () => {
    const a = await ctx.computeImageHash(fakeFile(ctx, 'x'));
    const b = await ctx.computeImageHash(fakeFile(ctx, 'y'));
    expect(a).not.toBe(b);
  });

  it('storeGraphicImage : premier import crée un enregistrement avec refCount 1', async () => {
    const ref = await ctx.storeGraphicImage(fakeFile(ctx, 'a'), 'doc1');
    expect(ref.imageId).toBeTruthy();
    const list = await ctx.getAllGraphicImagesForDocument('doc1');
    expect(list.length).toBe(1);
    expect(list[0].refCount).toBe(1);
  });

  it('storeGraphicImage : réimporter le même contenu dans le même manuscrit déduplique (même id, refCount incrémenté)', async () => {
    const ref1 = await ctx.storeGraphicImage(fakeFile(ctx, 'a'), 'doc1');
    const ref2 = await ctx.storeGraphicImage(fakeFile(ctx, 'a'), 'doc1');
    expect(ref2.imageId).toBe(ref1.imageId);
    const list = await ctx.getAllGraphicImagesForDocument('doc1');
    expect(list.length).toBe(1); // pas de copie stockée
    expect(list[0].refCount).toBe(2);
  });

  it('storeGraphicImage : contenu différent dans le même manuscrit crée un second enregistrement', async () => {
    await ctx.storeGraphicImage(fakeFile(ctx, 'a'), 'doc1');
    await ctx.storeGraphicImage(fakeFile(ctx, 'b'), 'doc1');
    const list = await ctx.getAllGraphicImagesForDocument('doc1');
    expect(list.length).toBe(2);
  });

  it('storeGraphicImage : la déduplication est scopée par manuscrit — même contenu, manuscrit différent = pas de partage', async () => {
    const ref1 = await ctx.storeGraphicImage(fakeFile(ctx, 'a'), 'doc1');
    const ref2 = await ctx.storeGraphicImage(fakeFile(ctx, 'a'), 'doc2');
    expect(ref2.imageId).not.toBe(ref1.imageId);
    expect((await ctx.getAllGraphicImagesForDocument('doc1')).length).toBe(1);
    expect((await ctx.getAllGraphicImagesForDocument('doc2')).length).toBe(1);
  });

  it('duplicateGraphicImage : réutilise le même id et incrémente refCount (pas de copie de stockage)', async () => {
    const ref = await ctx.storeGraphicImage(fakeFile(ctx, 'a'), 'doc1');
    const dup = await ctx.duplicateGraphicImage(ref.imageId, 'doc1');
    expect(dup.imageId).toBe(ref.imageId);
    const list = await ctx.getAllGraphicImagesForDocument('doc1');
    expect(list.length).toBe(1);
    expect(list[0].refCount).toBe(2);
  });

  it('deleteGraphicImage : décrémente sans supprimer tant qu\'il reste des références', async () => {
    const ref = await ctx.storeGraphicImage(fakeFile(ctx, 'a'), 'doc1');
    await ctx.duplicateGraphicImage(ref.imageId, 'doc1'); // refCount → 2
    await ctx.deleteGraphicImage(ref.imageId); // refCount → 1
    const list = await ctx.getAllGraphicImagesForDocument('doc1');
    expect(list.length).toBe(1); // toujours là : encore référencée ailleurs
    expect(list[0].refCount).toBe(1);
  });

  it('deleteGraphicImage : supprime réellement quand plus aucune référence ne subsiste', async () => {
    const ref = await ctx.storeGraphicImage(fakeFile(ctx, 'a'), 'doc1');
    await ctx.duplicateGraphicImage(ref.imageId, 'doc1'); // refCount → 2
    await ctx.deleteGraphicImage(ref.imageId); // refCount → 1
    await ctx.deleteGraphicImage(ref.imageId); // refCount → 0 : suppression réelle
    const list = await ctx.getAllGraphicImagesForDocument('doc1');
    expect(list.length).toBe(0);
  });

  it('deleteAllGraphicImagesForDocument : supprime tout un manuscrit sans laisser d\'orphelines, même avec des refCount > 1', async () => {
    const ref = await ctx.storeGraphicImage(fakeFile(ctx, 'a'), 'doc1');
    await ctx.duplicateGraphicImage(ref.imageId, 'doc1'); // refCount → 2 : ne doit pas empêcher la suppression forcée
    await ctx.deleteAllGraphicImagesForDocument('doc1');
    const list = await ctx.getAllGraphicImagesForDocument('doc1');
    expect(list.length).toBe(0);
  });

  it('getGraphicImagesTotalSize : ne compte le poids d\'une image dédupliquée qu\'une seule fois', async () => {
    const ref = await ctx.storeGraphicImage(fakeFile(ctx, 'a'), 'doc1');
    await ctx.storeGraphicImage(fakeFile(ctx, 'a'), 'doc1'); // dédupliqué, ne doit rien ajouter au poids
    const rec = (await ctx.getAllGraphicImagesForDocument('doc1'))[0];
    const total = await ctx.getGraphicImagesTotalSize('doc1');
    expect(total).toBe(rec.blob.size);
    expect(ref.imageId).toBe(rec.id);
  });
});
