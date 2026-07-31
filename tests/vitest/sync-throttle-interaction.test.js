// ═══════════════════════════════════════════════════════
// VÉRIFICATION CROISÉE — le plafonnement du débit d'envoi (v9.3.1,
// SYNC_PUSH_MIN_INTERVAL_MS) peut-il réintroduire les conflits de
// synchronisation déjà corrigés (v9.3.0), ou en créer de nouveaux ?
//
// Trois scénarios, chacun avec le VRAI code (router.js, library.js,
// crypto.js) et le VRAI Worker (sync-worker.js) sur une base KV simulée.
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
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
    const req = new Request(url, { method: (opts && opts.method) || 'GET', headers: (opts && opts.headers) || {}, body: (opts && opts.body) || undefined });
    return await worker.fetch(req, env);
  }
  return { kv, serverFetch };
}

function makeDevice(serverFetch) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="conflict-diff-overlay" class="hidden"></div></body></html>', { url: 'http://localhost/' });
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

  const load = f => vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), ctx, { filename: f });
  load('schema.js'); load('crypto.js'); load('router.js'); load('library.js');
  ctx.onload = null;

  ctx.setSyncKey(SYNC_KEY);
  vm.runInContext(`_dataKey = ${JSON.stringify(DEK)}; _currentProfileId = ${JSON.stringify(PROFILE_ID)};`, ctx);
  return ctx;
}

async function settle() { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0)); }
const manuscrit = texte => ({ _schemaVersion: 1, title: 'Test', chapters: [{ id: 'c1', title: 'Ch1', content: texte }] });

// Écrit SANS forcer l'envoi immédiat (simule une frappe qui reste dans la
// fenêtre d'espacement, contrairement à ecrire() de l'autre fichier de test).
async function tape(ctx, texte) {
  const env = await ctx.makeEncryptedEnvelope(JSON.stringify(manuscrit(texte)));
  await ctx.persistData(DOC_KEY, env);
  await settle();
}
// Simule le moment où l'envoi différé aurait lieu (perte de focus, ou
// simplement l'échéance des 20s) — même mécanisme que flushPendingSyncPushes()
// appelée aux points d'accroche réels (visibilitychange, beforeunload...).
async function laisseFilerLeDelai(ctx) {
  ctx.flushPendingSyncPushes();
  await settle();
}

function texteDeLEnveloppe(ctx, env) {
  if (!env || !env.data) return Promise.resolve(null);
  return vm.runInContext(`Crypto.decrypt(${JSON.stringify(env.data)}, ${JSON.stringify(DEK)})`, ctx)
    .then(plain => plain === null ? null : JSON.parse(plain).chapters[0].content);
}
async function lireLocal(ctx) { return texteDeLEnveloppe(ctx, await ctx.readLocalOnly(DOC_KEY)); }
async function lireServeur(ctx, server) {
  const brut = server.kv.get(DOC_KEY);
  return brut ? texteDeLEnveloppe(ctx, JSON.parse(brut.value)) : null;
}

describe('Le plafonnement du débit (v9.3.1) ne réintroduit pas les conflits corrigés en v9.3.0', () => {

  it("un vrai conflit (deux appareils modifiés) reste détecté même quand l'envoi perdant a été différé par le plafonnement", async () => {
    const server = makeServer();
    const a = makeDevice(server.serverFetch);
    await tape(a, 'texte de depart');
    await laisseFilerLeDelai(a);

    const b = makeDevice(server.serverFetch);
    await b.syncReconcileKey(DOC_KEY);
    await settle();

    // A tape deux fois de suite SANS perdre le focus entre les deux : la 1ʳᵉ
    // part tout de suite (nouvelle clé... non, déjà utilisée, donc DANS la
    // fenêtre d'espacement) — les deux restent en fait dans la fenêtre de 20s
    // depuis le tout premier envoi ci-dessus, donc différées.
    await tape(a, 'A ecrit une premiere fois');
    await tape(a, 'A ecrit une seconde fois, toujours sans avoir perdu le focus');

    // Pendant ce temps, B modifie aussi et PERD le focus (son envoi part tout
    // de suite, sans plafonnement au premier envoi de sa session).
    b.__toasts = [];
    await tape(b, 'B ecrit de son cote');
    await laisseFilerLeDelai(b);
    expect(await lireServeur(a, server)).toBe('B ecrit de son cote'); // le serveur a bien la version de B

    // Seulement maintenant, A perd le focus à son tour : son envoi différé
    // (le texte le plus récent, la seconde frappe) part enfin.
    a.__toasts = [];
    await laisseFilerLeDelai(a);

    // Le désaccord doit être détecté comme un VRAI conflit — ni le texte de
    // A, ni celui de B, ne doivent être silencieusement écrasés.
    expect(a.__toasts.some(t => /deux appareils/.test(t))).toBe(true);
    expect(a.isConflictPaused(DOC_KEY)).toBe(true);
    expect(await lireLocal(a)).toBe('A ecrit une seconde fois, toujours sans avoir perdu le focus'); // rien perdu localement
    expect(await lireServeur(a, server)).toBe('B ecrit de son cote'); // le serveur n'a pas été écrasé non plus
  });

  it("plusieurs frappes rapprochées sur le MÊME appareil, sans personne d'autre en jeu, ne déclenchent jamais de faux conflit malgré le différé", async () => {
    const server = makeServer();
    const a = makeDevice(server.serverFetch);
    await tape(a, 'version 1');
    await laisseFilerLeDelai(a);

    // Cinq frappes rapprochées, comme pendant une phrase en cours d'écriture.
    for (let i = 2; i <= 5; i++) await tape(a, 'version ' + i);
    a.__toasts = [];
    await laisseFilerLeDelai(a); // équivaut à la perte de focus en fin de phrase

    expect(a.__toasts).toEqual([]); // aucune alerte : personne d'autre n'a touché ce manuscrit
    expect(a.isConflictPaused(DOC_KEY)).toBe(false);
    expect(await lireServeur(a, server)).toBe('version 5'); // le texte le plus récent est bien celui envoyé, pas un intermédiaire périmé
  });

  it("après résolution d'un conflit, le prochain envoi n'hérite pas d'un délai artificiel dû à une tentative bloquée pendant la pause", async () => {
    const server = makeServer();
    const a = makeDevice(server.serverFetch);
    await tape(a, 'base');
    await laisseFilerLeDelai(a);
    const b = makeDevice(server.serverFetch);
    await b.syncReconcileKey(DOC_KEY);
    await settle();

    // Provoque un vrai conflit.
    await tape(a, 'version de A');
    await laisseFilerLeDelai(a);
    await tape(b, 'version de B');
    await laisseFilerLeDelai(b);
    expect(b.isConflictPaused(DOC_KEY)).toBe(true);

    // Pendant la pause, B continue d'écrire : ces tentatives sont bloquées
    // par syncPush() (isConflictPaused), mais le minuteur de plafonnement,
    // lui, s'exécute quand même en coulisses (voir _lastPushAt dans
    // scheduleSyncPush) — la question est : ça ne doit PAS retarder l'envoi
    // de la résolution qui arrive juste après.
    await tape(b, 'B tape encore pendant la reflexion');
    await laisseFilerLeDelai(b);

    // L'utilisateur tranche en faveur de B : resolveConflictKeepLocal()
    // envoie directement (queueSyncPush), sans repasser par le plafonnement.
    const versionServeurAvant = server.kv.get(DOC_KEY).metadata.v;
    await b.resolveConflictKeepLocal(
      (await b.listConflictBackups())[0].key,
      DOC_ID
    );
    await settle();

    expect(server.kv.get(DOC_KEY).metadata.v).toBeGreaterThan(versionServeurAvant); // parti tout de suite, pas différé
    expect(await lireServeur(b, server)).toBe('B tape encore pendant la reflexion');
    expect(b.isConflictPaused(DOC_KEY)).toBe(false);
  });

  it("v9.3.2 — écrire PENDANT une pause de conflit ne retarde pas le prochain envoi réel une fois résolu", async () => {
    // Avant ce correctif : chaque tentative bloquée par la pause faisait
    // quand même progresser le compteur d'espacement (_lastPushAt), comme si
    // un envoi avait réellement eu lieu. Résultat possible : juste après
    // avoir résolu le conflit, la frappe suivante attendait inutilement
    // jusqu'à 20s de plus, sans qu'aucune donnée ne soit en jeu.
    const server = makeServer();
    const a = makeDevice(server.serverFetch);
    await tape(a, 'base');
    await laisseFilerLeDelai(a);
    const b = makeDevice(server.serverFetch);
    await b.syncReconcileKey(DOC_KEY);
    await settle();

    await tape(a, 'version de A');
    await laisseFilerLeDelai(a);
    await tape(b, 'version de B');
    await laisseFilerLeDelai(b);
    expect(b.isConflictPaused(DOC_KEY)).toBe(true);

    // Simule un temps de réflexion réaliste (le conflit reste souvent en
    // attente plusieurs minutes, le temps que l'utilisateur remarque
    // l'alerte) : on recule artificiellement l'horloge interne, plutôt que
    // d'attendre pour de vrai dans ce test.
    vm.runInContext(`_lastPushAt[${JSON.stringify(DOC_KEY)}] = Date.now() - 5 * 60 * 1000;`, b);

    // B continue d'écrire PENDANT la pause (plusieurs tentatives bloquées).
    // AVANT le correctif v9.3.2, chacune de ces tentatives aurait remis
    // _lastPushAt à "maintenant" malgré tout, effaçant le recul ci-dessus.
    await tape(b, 'B tape 1');
    await tape(b, 'B tape 2');
    await tape(b, 'B tape 3');

    // Résolution PAR SUPPRESSION de la sauvegarde de conflit (et non via
    // "Garder cet appareil", qui envoie déjà directement de son côté) : c'est
    // le chemin le plus exposé au défaut, puisqu'aucun envoi explicite
    // n'accompagne cette action.
    const backup = (await b.listConflictBackups())[0];
    await b.removeConflictBackup(backup.key);
    b.removeConflictPausedKey(DOC_KEY);
    expect(b.isConflictPaused(DOC_KEY)).toBe(false);

    // La frappe suivante, normale, doit repartir IMMÉDIATEMENT — pas de délai
    // artificiel hérité des tentatives bloquées pendant la pause.
    const versionServeurAvant = server.kv.get(DOC_KEY).metadata.v;
    await tape(b, 'B tape juste apres avoir resolu');
    expect(server.kv.get(DOC_KEY).metadata.v).toBeGreaterThan(versionServeurAvant);
    expect(await lireServeur(b, server)).toBe('B tape juste apres avoir resolu');
  });
});
