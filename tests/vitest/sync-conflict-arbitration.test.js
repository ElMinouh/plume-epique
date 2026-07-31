// ═══════════════════════════════════════════════════════
// TESTS DE NON-RÉGRESSION — INCIDENT DU 29/07/2026 (un manuscrit enrichi sur
// un appareil revenait sans cesse à sa version courte, et des « conflits de
// sauvegarde » étaient signalés à chaque connexion sans jamais se résoudre).
//
// Même topologie que sync-versioning.test.js : le vrai code client
// (js/router.js, js/library.js, js/crypto.js) et le vrai code serveur
// (worker/sync-worker.js) tournent ENSEMBLE sur une base KV simulée. Deux
// contextes jsdom = deux appareils, chacun avec son localStorage.
//
// Trois défauts distincts sont verrouillés ici :
//
//  1. La réponse à un refus serveur (409) repoussait TOUJOURS la version
//     locale, neutralisant la protection du serveur : le dernier appareil
//     connecté gagnait, même avec le contenu le plus ancien.
//  2. Crypto.encrypt() tire un sel et un IV aléatoires : le même texte produit
//     un chiffré différent à chaque sauvegarde. Faute de pouvoir comparer les
//     contenus, toute sauvegarde automatique passait pour un conflit.
//  3. Un vrai conflit était tranché d'office en faveur de l'appareil courant,
//     sans que l'utilisateur puisse choisir — et sa version partait quand même
//     pendant qu'il « réfléchissait ».
//
// Ces tests échouent sur le code d'avant la v9.3.0 et passent après.
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

// ── Serveur simulé : le VRAI Worker, branché sur une base KV en mémoire ──
function makeServer() {
  const kv = new Map();
  const env = {
    SYNC_KEY,
    PLUME_SYNC: {
      async getWithMetadata(key) {
        return kv.has(key) ? kv.get(key) : { value: null, metadata: null };
      },
      async put(key, value, opts) {
        kv.set(key, { value, metadata: (opts && opts.metadata) || null });
      }
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

// ── Un appareil = un contexte jsdom neuf (localStorage propre) ──
function makeDevice(serverFetch) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
  const ctx = dom.window;
  vm.createContext(ctx);
  Object.defineProperty(ctx, 'crypto', { value: globalThis.crypto, configurable: true });
  ctx.Request = globalThis.Request;
  ctx.Response = globalThis.Response;
  ctx.fetch = (url, opts) => serverFetch(url, opts);
  // jsdom expose une interface globale nommée Crypto : on la retire pour que
  // le `const Crypto` de js/crypto.js s'applique, comme dans un vrai
  // navigateur (où un script classique masque la propriété du même nom).
  delete ctx.Crypto;
  // Messages destinés à l'utilisateur : router.js n'appelle toast() que si
  // elle existe. On les collecte pour vérifier ce qui est signalé — et
  // surtout ce qui ne doit PAS l'être.
  ctx.__toasts = [];
  ctx.toast = (msg) => ctx.__toasts.push(String(msg));
  ctx.DOMPurify = { sanitize: x => x };

  const load = f => vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), ctx, { filename: f });
  load('schema.js');
  load('crypto.js');
  load('router.js');
  load('library.js');
  ctx.onload = null; // neutralise le bootstrap complet de l'app

  ctx.setSyncKey(SYNC_KEY);
  // _dataKey et _currentProfileId sont déclarés avec `let` dans router.js :
  // ce sont des liaisons lexicales, pas des propriétés du global. Les affecter
  // depuis l'extérieur (ctx._dataKey = …) créerait une propriété homonyme que
  // le code ne verrait jamais — il faut donc écrire DANS le contexte.
  vm.runInContext(`_dataKey = ${JSON.stringify(DEK)}; _currentProfileId = ${JSON.stringify(PROFILE_ID)};`, ctx);
  return ctx;
}

// Laisse se terminer les envois lancés en arrière-plan par persistData().
async function settle() { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0)); }

const manuscrit = texte => ({
  _schemaVersion: 1,
  title: 'Manuscrit de test',
  chapters: [{ id: 'c1', title: 'Chapitre 1', content: texte }]
});

// Écrit un manuscrit comme le ferait l'application (chiffrement + envoi).
// v9.3.1 — Depuis le plafonnement du débit d'envoi (SYNC_PUSH_MIN_INTERVAL_MS,
// router.js), persistData() sur une clé de manuscrit ('doc_*') n'envoie plus
// forcément tout de suite : au-delà du premier envoi, les suivants sont
// différés de 20s pour éviter d'épuiser le quota gratuit Cloudflare KV (voir
// incident du 31/07/2026). Chaque appel à ecrire() représente ici une
// édition COMPLÈTE et isolée (pas une frappe continue) : on force donc
// l'envoi immédiat après coup, exactement comme le ferait l'application
// quand l'utilisateur change de manuscrit ou perd le focus de l'onglet (voir
// flushPendingSyncPushes(), appelée à ces mêmes moments dans le vrai code).
async function ecrire(ctx, texte) {
  const env = await ctx.makeEncryptedEnvelope(JSON.stringify(manuscrit(texte)));
  await ctx.persistData(DOC_KEY, env);
  ctx.flushPendingSyncPushes();
  await settle();
}

// Déchiffre en appelant le VRAI Crypto de js/crypto.js. Il est déclaré avec
// `const` : c'est une liaison lexicale du contexte, invisible depuis
// l'extérieur (ctx.Crypto vaut undefined) — d'où l'évaluation dans le
// contexte plutôt qu'un accès direct.
function dechiffrerDansContexte(ctx, cipher) {
  return vm.runInContext(
    `Crypto.decrypt(${JSON.stringify(cipher)}, ${JSON.stringify(DEK)})`,
    ctx
  );
}
async function texteDeLEnveloppe(ctx, env) {
  if (!env || !env.data) return null;
  const plain = await dechiffrerDansContexte(ctx, env.data);
  return plain === null ? null : JSON.parse(plain).chapters[0].content;
}

// Relit le texte réellement stocké sur un appareil.
async function lireLocal(ctx) {
  return await texteDeLEnveloppe(ctx, await ctx.readLocalOnly(DOC_KEY));
}

// Relit le texte détenu par le serveur, via n'importe quel appareil.
async function lireServeur(ctx, server) {
  const brut = server.kv.get(DOC_KEY);
  return brut ? await texteDeLEnveloppe(ctx, JSON.parse(brut.value)) : null;
}

describe('Arbitrage des conflits de synchro — incident du 29/07/2026', () => {
  let server;
  beforeEach(() => { server = makeServer(); });

  it('LE SCÉNARIO DE L’INCIDENT : un appareil en retard n’écrase plus le texte enrichi de l’autre', async () => {
    const court = 'un deux trois';
    const long = 'un deux trois quatre cinq six sept huit';

    // — A écrit un premier jet, B le récupère : les deux sont alignés.
    const a = makeDevice(server.serverFetch);
    await ecrire(a, court);
    const b = makeDevice(server.serverFetch);
    await b.syncReconcileKey(DOC_KEY);
    await settle();
    expect(await lireLocal(b)).toBe(court);

    // — L'utilisateur enrichit son texte sur A.
    await ecrire(a, long);
    expect(await lireServeur(a, server)).toBe(long);

    // — B est rouvert. Il n'a rien modifié : il était simplement en retard.
    //   AVANT la v9.3.0, la connexion repoussait sa copie périmée, le serveur
    //   la refusait (409), et le client la reforçait quand même — le texte
    //   enrichi de A disparaissait.
    await b.syncReconcileKey(DOC_KEY);
    await settle();

    expect(await lireLocal(b)).toBe(long);
    expect(await lireServeur(b, server)).toBe(long);
    // Ce n'est pas un conflit : rien ne doit être signalé à l'utilisateur.
    expect(b.__toasts).toEqual([]);
    expect(b.getConflictPausedKeys()).toEqual([]);
  });

  it('une sauvegarde sans aucune modification ne crée pas de faux conflit', async () => {
    // Le piège : Crypto.encrypt() produit des octets DIFFÉRENTS pour un texte
    // IDENTIQUE (sel et IV aléatoires). Avant la v9.3.0, chaque sauvegarde
    // automatique passait donc pour une divergence, et créait une sauvegarde
    // de conflit — d'où les alertes en boucle à chaque connexion.
    const texte = 'le texte ne change pas du tout';

    const a = makeDevice(server.serverFetch);
    await ecrire(a, texte);

    const b = makeDevice(server.serverFetch);
    await b.syncReconcileKey(DOC_KEY);
    await settle();
    b.__toasts = [];

    // B réenregistre exactement le même texte (sauvegarde automatique).
    await ecrire(b, texte);

    expect(b.__toasts).toEqual([]);
    expect(b.getConflictPausedKeys()).toEqual([]);
    expect(await lireServeur(b, server)).toBe(texte);
  });

  it('un vrai conflit met la synchro en pause au lieu d’écraser l’un des deux textes', async () => {
    const base = 'texte de depart commun';
    const surA = 'version ecrite uniquement sur A';
    const surB = 'version totalement differente ecrite sur B';

    const a = makeDevice(server.serverFetch);
    await ecrire(a, base);
    const b = makeDevice(server.serverFetch);
    await b.syncReconcileKey(DOC_KEY);
    await settle();

    // Les deux appareils modifient chacun de leur côté, sans synchro entre-temps.
    await ecrire(a, surA);
    b.__toasts = [];
    await ecrire(b, surB);

    // B constate le désaccord : il prévient, met CE manuscrit en pause, et
    // n'écrase rien — ni sa version locale, ni celle de A sur le serveur.
    expect(b.__toasts.some(t => /deux appareils/.test(t))).toBe(true);
    expect(b.isConflictPaused(DOC_KEY)).toBe(true);
    expect(await lireLocal(b)).toBe(surB);
    expect(await lireServeur(b, server)).toBe(surA);
  });

  it('pendant la réflexion de l’utilisateur, rien ne part vers le serveur', async () => {
    const base = 'texte de depart commun';
    const a = makeDevice(server.serverFetch);
    await ecrire(a, base);
    const b = makeDevice(server.serverFetch);
    await b.syncReconcileKey(DOC_KEY);
    await settle();

    await ecrire(a, 'version de A');
    await ecrire(b, 'version de B');
    expect(b.isConflictPaused(DOC_KEY)).toBe(true);

    const versionServeurAvant = server.kv.get(DOC_KEY).metadata.v;

    // L'utilisateur continue d'écrire sur B pendant qu'il réfléchit : ses
    // frappes sont bien enregistrées EN LOCAL, mais rien ne part — sinon la
    // version de A serait écrasée avant même qu'il ait choisi.
    await ecrire(b, 'B continue d ecrire pendant sa reflexion');
    expect(await lireLocal(b)).toBe('B continue d ecrire pendant sa reflexion');
    expect(server.kv.get(DOC_KEY).metadata.v).toBe(versionServeurAvant);

    // Une fois le conflit tranché en faveur de B, la synchro reprend.
    b.removeConflictPausedKey(DOC_KEY);
    await b.queueSyncPush(DOC_KEY, await b.readLocalOnly(DOC_KEY));
    await settle();
    expect(server.kv.get(DOC_KEY).metadata.v).toBeGreaterThan(versionServeurAvant);
    expect(await lireServeur(b, server)).toBe('B continue d ecrire pendant sa reflexion');
  });

  it('l’index des manuscrits fusionne au lieu de s’écraser (compteurs de mots)', async () => {
    // Les nombres de mots affichés dans la bibliothèque viennent de cet index.
    // Poussé en bloc, un appareil en retard y réimposait ses anciens
    // compteurs — l'écart restait visible avant même d'ouvrir un manuscrit.
    const a = makeDevice(server.serverFetch);
    const listeA = { version: 1, documents: [
      { id: 'm1', title: 'Roman', lastModified: 2000, wordCount: 850 },
      { id: 'm2', title: 'Nouvelle', lastModified: 1000, wordCount: 120 }
    ] };
    const listePerimeeB = { version: 1, documents: [
      { id: 'm1', title: 'Roman', lastModified: 1000, wordCount: 300 }
    ] };

    const fusion = a.mergeDocList(listePerimeeB, listeA);
    const parId = Object.fromEntries(fusion.documents.map(d => [d.id, d]));

    // L'entrée la plus récemment modifiée l'emporte…
    expect(parId.m1.wordCount).toBe(850);
    // …et aucun manuscrit ne peut disparaître par fusion.
    expect(Object.keys(parId).sort()).toEqual(['m1', 'm2']);
  });
});
