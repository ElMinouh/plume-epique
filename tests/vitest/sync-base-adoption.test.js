// ═══════════════════════════════════════════════════════
// v9.53.1 — BASE COMMUNE ET MANUSCRIT OUVERT (test réel local du 2026-10-10)
//
// Trois défauts, tous dans la zone « adopter la version d'un autre appareil » :
//
//  1. syncPull() posait la base commune (empreintes) et le « hash connu » à chaque
//     simple LECTURE. Un rafraîchissement d'arrière-plan qui n'adoptait pas la
//     version distante (copie locale non confirmée) laissait donc la base =
//     version de l'autre appareil → l'arbitrage suivant concluait « local-only »
//     et notre copie périmée partait, écrasant son travail. La base ne se pose
//     plus qu'à l'adoption réelle ou à un envoi accepté.
//  2. Version distante adoptée pendant qu'on est DANS le manuscrit : IndexedDB
//     recevait la nouvelle version, mais `db` (mémoire) gardait l'ancienne ; la
//     frappe suivante repartait avec un numéro de version à jour, le serveur
//     l'acceptait, et la phrase de l'autre appareil disparaissait sans conflit.
//     L'éditeur recharge désormais la version adoptée ; avec des frappes non
//     enregistrées, on n'adopte rien et l'utilisateur arbitre.
//  3. L'indicateur « Synchronisé » ne reflétait que le dernier échange réseau :
//     il restait vert avec un envoi encore en attente (délai d'une minute).
//
// Même topologie que sync-conflict-arbitration.test.js : vrai client, vrai Worker,
// un contexte jsdom par appareil.
// ═══════════════════════════════════════════════════════
import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const JS_DIR = path.join(REPO_ROOT, 'js');
const WORKER_PATH = path.join(REPO_ROOT, 'worker', 'sync-worker.js');

const SYNC_KEY = 'cle-de-synchro-de-test';
const DEK = 'cle-de-donnees-du-profil-de-test';
const PROFILE_ID = 'p1';
const DOC_ID = 'm1';
const DOC_KEY = 'doc_' + PROFILE_ID + '_' + DOC_ID;

function makeServer() {
  const kv = new Map();
  const env = {
    SYNC_KEY,
    PLUME_SYNC: {
      async getWithMetadata(key) { return kv.has(key) ? kv.get(key) : { value: null, metadata: null }; },
      async put(key, value, opts) { kv.set(key, { value, metadata: (opts && opts.metadata) || null }); }
    }
  };
  const src = fs.readFileSync(WORKER_PATH, 'utf8').replace('export default', 'return');
  const worker = new Function(src)();
  async function serverFetch(url, opts = {}) {
    const req = new Request(url, {
      method: (opts && opts.method) || 'GET',
      headers: (opts && opts.headers) || {},
      body: (opts && opts.body) || undefined
    });
    return await worker.fetch(req, env);
  }
  return { kv, serverFetch };
}

function makeDevice(serverFetch) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><span id="sync-status-dot"></span><span id="sync-status-label"></span></body></html>', { url: 'http://localhost/' });
  const ctx = dom.window;
  vm.createContext(ctx);
  Object.defineProperty(ctx, 'crypto', { value: globalThis.crypto, configurable: true });
  ctx.Request = globalThis.Request;
  ctx.Response = globalThis.Response;
  ctx.fetch = (url, opts) => serverFetch(url, opts);
  delete ctx.Crypto;
  ctx.__toasts = [];
  ctx.toast = (msg) => ctx.__toasts.push(String(msg));
  ctx.DOMPurify = { sanitize: x => x };
  ctx.icon = name => '[' + name + ']'; // js/icons.js n'est pas chargé ici
  const load = f => vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), ctx, { filename: f });
  load('schema.js');
  load('crypto.js');
  load('router.js');
  load('library.js');
  ctx.onload = null;
  ctx.setSyncKey(SYNC_KEY);
  vm.runInContext(`_dataKey = ${JSON.stringify(DEK)}; _currentProfileId = ${JSON.stringify(PROFILE_ID)};`, ctx);
  return ctx;
}

async function settle() { for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r, 0)); }

const manuscrit = texte => ({
  _schemaVersion: 1,
  title: 'Manuscrit de test',
  chapters: [{ id: 'c1', title: 'Chapitre 1', content: texte }]
});

// Édition complète et isolée, envoyée tout de suite (comme dans sync-conflict-arbitration.test.js).
async function ecrire(ctx, texte, { envoyer = true } = {}) {
  const env = await ctx.makeEncryptedEnvelope(JSON.stringify(manuscrit(texte)));
  await ctx.persistData(DOC_KEY, env);
  if (envoyer) { ctx.flushPendingSyncPushes(); await settle(); }
}

const dechiffrer = (ctx, cipher) => vm.runInContext(`Crypto.decrypt(${JSON.stringify(cipher)}, ${JSON.stringify(DEK)})`, ctx);
async function texteDeLEnveloppe(ctx, env) {
  if (!env || !env.data) return null;
  const plain = await dechiffrer(ctx, env.data);
  return plain === null ? null : JSON.parse(plain).chapters[0].content;
}
const lireLocal = async ctx => texteDeLEnveloppe(ctx, await ctx.readLocalOnly(DOC_KEY));
async function lireServeur(ctx, server) {
  const brut = server.kv.get(DOC_KEY);
  return brut ? await texteDeLEnveloppe(ctx, JSON.parse(brut.value)) : null;
}

// « Ouvrir le manuscrit » comme le fait openDocument() : copie locale lue (loadData lance le
// rafraîchissement d'arrière-plan), db et _currentDocumentId posés, référence « rien tapé depuis
// le chargement » prise. `frappe` = texte que l'auteur a tapé dans l'éditeur SANS qu'il soit enregistré ;
// `ecritureDerivee` = l'application a seulement ajouté de l'historique (initApp arme un enregistrement
// différé à chaque ouverture : _unsavedChanges est vrai sans que l'auteur ait écrit).
async function ouvrir(ctx, { frappe = null, ecritureDerivee = false } = {}) {
  // Lecture strictement locale d'abord : le manuscrit est OUVERT quand le rafraîchissement d'arrière-plan
  // de loadData() répond (la course « réponse pendant le déchiffrement » est traitée dans openDocument()).
  const env = await ctx.readLocalOnly(DOC_KEY);
  const plain = await dechiffrer(ctx, env.data);
  vm.runInContext(`db = ${plain}; _currentDocumentId = ${JSON.stringify(DOC_ID)}; cur = 0; _unsavedChanges = false;`, ctx);
  const reference = ctx.markOpenDocumentBaseline(); // l'instantané est pris tout de suite (JSON.stringify synchrone)
  if (frappe) vm.runInContext(`db.chapters[0].content += ${JSON.stringify(frappe)}; _unsavedChanges = true;`, ctx);
  if (ecritureDerivee) vm.runInContext(`db.history = { c1: [{ ts: 1, content: 'instantane' }] }; _unsavedChanges = true;`, ctx);
  await reference;
  await ctx.loadData(DOC_KEY); // lance le rafraîchissement d'arrière-plan
}
const texteEnMemoire = ctx => vm.runInContext('db.chapters[0].content', ctx);
// Frappe dans l'éditeur ouvert : db (mémoire) modifiée, puis enregistrée comme le fait save().
async function taper(ctx, ajout) {
  vm.runInContext(`db.chapters[0].content += ${JSON.stringify(ajout)};`, ctx);
  const plain = vm.runInContext('JSON.stringify(db)', ctx);
  await ctx.persistData(DOC_KEY, await ctx.makeEncryptedEnvelope(plain));
  ctx.flushPendingSyncPushes(); await settle();
}

describe('syncPull est une lecture pure', () => {
  let server;
  beforeEach(() => { server = makeServer(); });

  it('une lecture ne remplace ni la base commune ni le hash connu', async () => {
    const a = makeDevice(server.serverFetch);
    await ecrire(a, 'base commune');
    const b = makeDevice(server.serverFetch);
    await b.syncReconcileKey(DOC_KEY); await settle();
    await ecrire(b, 'base commune puis la suite de B');

    const baseAvant = a.getKnownRemoteFp(DOC_KEY);
    const coeurAvant = a.getKnownRemoteCoreFp(DOC_KEY);
    const hashAvant = a.getKnownRemoteHash(DOC_KEY);
    const lu = await a.syncPull(DOC_KEY);

    expect(lu.version).not.toBeNull();
    expect(a.getKnownRemoteFp(DOC_KEY)).toBe(baseAvant);
    expect(a.getKnownRemoteCoreFp(DOC_KEY)).toBe(coeurAvant);
    expect(a.getKnownRemoteHash(DOC_KEY)).toBe(hashAvant);
  });

  it('copie locale non envoyée + rafraîchissement d’arrière-plan sans adoption : l’envoi refusé reste un VRAI conflit (rien n’écrase B)', async () => {
    const a = makeDevice(server.serverFetch);
    await ecrire(a, 'texte de depart');
    const b = makeDevice(server.serverFetch);
    await b.syncReconcileKey(DOC_KEY); await settle();
    await ecrire(b, 'texte de depart et suite ecrite par B');

    // A modifie son texte (enregistré en local, envoi différé : rien n'est parti).
    await ecrire(a, 'texte de depart et modification de A', { envoyer: false });
    // Le rafraîchissement d'arrière-plan lit le serveur mais n'adopte pas (copie locale non confirmée).
    await a.loadData(DOC_KEY); await settle();
    expect(await lireLocal(a)).toBe('texte de depart et modification de A');

    // L'envoi de A part : refusé (409), la base est celle d'AVANT → vrai conflit.
    a.flushPendingSyncPushes(); await settle();

    expect(a.isConflictPaused(DOC_KEY)).toBe(true);
    expect(await lireServeur(a, server)).toBe('texte de depart et suite ecrite par B');
    expect(await lireLocal(a)).toBe('texte de depart et modification de A');
  });
});

describe('manuscrit OUVERT : une version adoptée en arrière-plan est rechargée dans l’éditeur', () => {
  let server;
  beforeEach(() => { server = makeServer(); });

  it('LE SCÉNARIO DE LA PERTE : après adoption, la frappe suivante n’écrase plus la phrase de l’autre appareil', async () => {
    const a = makeDevice(server.serverFetch);
    await ecrire(a, 'phrase de depart');
    const b = makeDevice(server.serverFetch);
    await b.syncReconcileKey(DOC_KEY); await settle();
    await ecrire(b, 'phrase de depart. Phrase ajoutee par B.');

    // A ouvre le manuscrit (version périmée en mémoire) ; le rafraîchissement d'arrière-plan adopte celle de B.
    await ouvrir(a); await settle();
    expect(await lireLocal(a)).toBe('phrase de depart. Phrase ajoutee par B.');
    expect(texteEnMemoire(a)).toBe('phrase de depart. Phrase ajoutee par B.'); // AVANT la v9.53.1 : texte périmé

    // A tape à la suite : le serveur doit contenir les DEUX phrases.
    await taper(a, ' Phrase ajoutee par A.');
    expect(await lireServeur(a, server)).toBe('phrase de depart. Phrase ajoutee par B. Phrase ajoutee par A.');
    expect(a.isConflictPaused(DOC_KEY)).toBe(false);
  });

  it('avec une frappe de l’auteur non enregistrée : rien n’est adopté en silence, l’envoi refusé devient un conflit arbitré', async () => {
    const a = makeDevice(server.serverFetch);
    await ecrire(a, 'phrase de depart');
    const b = makeDevice(server.serverFetch);
    await b.syncReconcileKey(DOC_KEY); await settle();
    await ecrire(b, 'phrase de depart. Phrase ajoutee par B.');

    await ouvrir(a, { frappe: ' Frappe de A.' }); await settle();
    // Pas d'adoption : la copie locale est inchangée et l'éditeur garde la frappe de A.
    expect(await lireLocal(a)).toBe('phrase de depart');
    expect(texteEnMemoire(a)).toBe('phrase de depart Frappe de A.');

    // A enregistre : refusé, mis en pause, la version de B n'est pas écrasée.
    await taper(a, ' Suite de A.');
    expect(a.isConflictPaused(DOC_KEY)).toBe(true);
    expect(await lireServeur(a, server)).toBe('phrase de depart. Phrase ajoutee par B.');
    expect(await lireLocal(a)).toBe('phrase de depart Frappe de A. Suite de A.');
  });

  it('écriture seulement DÉRIVÉE (historique à l’ouverture), rien tapé : la version de B est adoptée et l’éditeur la recharge', async () => {
    const a = makeDevice(server.serverFetch);
    await ecrire(a, 'phrase de depart');
    const b = makeDevice(server.serverFetch);
    await b.syncReconcileKey(DOC_KEY); await settle();
    await ecrire(b, 'phrase de depart. Phrase ajoutee par B.');

    // Simule l'ouverture réelle : initApp() arme un enregistrement différé (historique), rien n'est tapé.
    await ouvrir(a, { ecritureDerivee: true }); await settle();

    expect(await lireLocal(a)).toBe('phrase de depart. Phrase ajoutee par B.');
    expect(texteEnMemoire(a)).toBe('phrase de depart. Phrase ajoutee par B.');
    await taper(a, ' Phrase ajoutee par A.');
    expect(await lireServeur(a, server)).toBe('phrase de depart. Phrase ajoutee par B. Phrase ajoutee par A.');
    expect(a.isConflictPaused(DOC_KEY)).toBe(false);
  });

  it('réconciliation : manuscrit ouvert et propre → rechargé ; avec frappes non enregistrées → conflit, rien d’écrasé', async () => {
    const a = makeDevice(server.serverFetch);
    await ecrire(a, 'phrase de depart');
    const b = makeDevice(server.serverFetch);
    await b.syncReconcileKey(DOC_KEY); await settle();
    await ecrire(b, 'phrase de depart. Suite de B.');

    await ouvrir(a); // le rafraîchissement d'arrière-plan n'a pas encore répondu quand on réconcilie ci-dessous
    await a.syncReconcileKey(DOC_KEY); await settle();
    expect(texteEnMemoire(a)).toBe('phrase de depart. Suite de B.');
    expect(a.isConflictPaused(DOC_KEY)).toBe(false);

    // Même chose avec frappes non enregistrées, sur un second appareil.
    const c = makeDevice(server.serverFetch);
    await c.syncReconcileKey(DOC_KEY); await settle();
    await ecrire(b, 'phrase de depart. Suite de B. Encore B.');
    await ouvrir(c, { frappe: ' Frappe de C.' });
    await c.syncReconcileKey(DOC_KEY); await settle();
    expect(c.isConflictPaused(DOC_KEY)).toBe(true);
    expect(texteEnMemoire(c)).toBe('phrase de depart. Suite de B. Frappe de C.');
    expect(await lireServeur(c, server)).toBe('phrase de depart. Suite de B. Encore B.');
  });
});

describe('indicateur de synchro : « Synchronisé » seulement s’il ne reste rien à envoyer', () => {
  it('envoi en attente → « En attente d’envoi » ; file vide → « Synchronisé » ; échec réseau → « Échec de synchro »', () => {
    const a = makeDevice(makeServer().serverFetch);
    const label = () => a.document.getElementById('sync-status-label').innerHTML;
    a.setLastSyncStatus(true);
    expect(label()).toContain('Synchronisé');

    a.addPendingSyncKey(DOC_KEY);
    expect(label()).toContain('En attente d\'envoi');
    expect(a.document.getElementById('sync-status-dot').classList.contains('sync-warn')).toBe(true);

    a.removePendingSyncKey(DOC_KEY);
    expect(label()).toContain('Synchronisé');

    a.addPendingSyncKey(DOC_KEY);
    a.setLastSyncStatus(false);
    expect(label()).toContain('Échec de synchro'); // l'échec prime sur l'attente
  });
});
