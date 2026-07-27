// ═══════════════════════════════════════════════════════
// TESTS DE NON-RÉGRESSION — INCIDENT DU 27/07/2026 (perte de tous les
// profils sauf un, sur tous les appareils simultanément).
//
// Ces tests font tourner ENSEMBLE le vrai code client (js/router.js) et le
// vrai code serveur (worker/sync-worker.js), reliés par une base KV simulée
// en mémoire. Deux contextes jsdom séparés = deux appareils distincts, avec
// chacun son propre localStorage (donc ses propres numéros de version), qui
// partagent le même serveur — exactement la topologie de l'incident.
//
// Le scénario central (« un appareil resté en arrière ne peut plus effacer
// les profils des autres ») échoue sur le code d'avant la v8.1.0 et passe
// après : c'est lui qui garde la correction verrouillée dans le temps.
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

// ── Serveur simulé : le VRAI Worker, branché sur une base KV en mémoire ──
// La KV simulée est volontairement immédiatement cohérente : on teste ici la
// logique de versionnage, pas le délai de propagation de Cloudflare (lequel
// est couvert séparément par le garde-fou de fusion, voir le dernier test).
function makeServer() {
  const kv = new Map(); // clé -> { value, metadata }
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
function makeDevice(serverFetch, { syncKey = SYNC_KEY } = {}) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
  const ctx = dom.window;
  vm.createContext(ctx);
  Object.defineProperty(ctx, 'crypto', { value: globalThis.crypto, configurable: true });
  ctx.Request = globalThis.Request;
  ctx.Response = globalThis.Response;
  ctx.fetch = (url, opts) => serverFetch(url, opts);

  vm.runInContext(fs.readFileSync(path.join(JS_DIR, 'schema.js'), 'utf8'), ctx, { filename: 'schema.js' });
  vm.runInContext(fs.readFileSync(path.join(JS_DIR, 'router.js'), 'utf8'), ctx, { filename: 'router.js' });
  ctx.onload = null; // neutralise le bootstrap complet de l'app (voir harness-before.js)

  if (syncKey) ctx.setSyncKey(syncKey);
  return ctx;
}

// Laisse se terminer le rafraîchissement en arrière-plan lancé par loadData()
// (volontairement non attendu par l'appelant, pour rester instantané).
async function settle() { for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 0)); }

const IDX = (...noms) => ({ version: 1, profiles: noms.map(n => ({ id: 'id_' + n, name: n })) });
const noms = idx => (idx && idx.profiles ? idx.profiles.map(p => p.name).sort() : null);

describe('Versionnage de la synchro — incident du 27/07/2026', () => {
  let server;
  beforeEach(() => { server = makeServer(); });

  it('LE SCÉNARIO DE L’INCIDENT : un appareil resté en arrière n’efface plus les profils des autres', async () => {
    // — Appareil A : l'index de départ, avec le seul profil Cyril.
    const a = makeDevice(server.serverFetch);
    await a.persistData('profiles', IDX('Cyril'));
    await settle();

    // — Sur A, l'utilisateur crée ensuite deux profils supplémentaires.
    await a.persistData('profiles', IDX('Cyril', 'Soren', 'Elia'));
    await settle();

    // — Appareil B : mis de côté depuis la première version. On reproduit son
    //   état exact plutôt que de le déduire (le test doit échouer sur le
    //   défaut visé, pas sur un aléa de mise en place) : copie locale périmée
    //   à {Cyril}, et souvenir d'avoir vu la version 1 du serveur.
    const b = makeDevice(server.serverFetch);
    b.localStorage.setItem('plume_profiles', JSON.stringify(IDX('Cyril')));
    b.localStorage.setItem('plume_syncver_profiles', '1');

    // — B est rouvert. Sa copie locale est périmée ({Cyril} seul) et, comme
    //   dans l'incident, la connexion pousse cette copie AVANT d'avoir
    //   assimilé la version du serveur (syncPushEntireLibrary, library.js).
    await b.persistData('profiles', IDX('Cyril'));
    await settle();

    // AVANT la v8.1.0 : le serveur acceptait cette écriture périmée, et tous
    // les profils sauf Cyril disparaissaient partout.
    const surLeServeur = JSON.parse((await server.kv.get('profiles')).value);
    expect(noms(surLeServeur)).toEqual(['Cyril', 'Elia', 'Soren']);

    // B s'est réparé tout seul au lieu de détruire.
    expect(noms(await b.loadData('profiles'))).toEqual(['Cyril', 'Elia', 'Soren']);

    // Et A, qui n'a rien fait, conserve ses profils.
    expect(noms(await a.loadData('profiles'))).toEqual(['Cyril', 'Elia', 'Soren']);
  });

  it('une réponse périmée du serveur n’écrase plus une copie locale plus récente', async () => {
    const a = makeDevice(server.serverFetch);
    await a.persistData('profiles', IDX('Cyril', 'Soren'));
    await settle();

    // Le serveur se met à répondre une version ANCIENNE (numéro inférieur) —
    // c'est le symptôme de la cohérence différée de Cloudflare KV.
    const vraiFetch = a.fetch;
    a.fetch = async (url, opts) => {
      if (!opts || !opts.method || opts.method === 'GET') {
        return new Response(JSON.stringify(IDX('Cyril')), {
          status: 200, headers: { 'Content-Type': 'application/json', 'X-Plume-Version': '1' }
        });
      }
      return vraiFetch(url, opts);
    };

    await a.loadData('profiles');
    await settle();

    expect(noms(await a.loadData('profiles'))).toEqual(['Cyril', 'Soren']);
  });

  it('une version réellement plus récente est bien appliquée (la synchro fonctionne toujours)', async () => {
    const a = makeDevice(server.serverFetch);
    await a.persistData('profiles', IDX('Cyril'));
    await settle();

    const b = makeDevice(server.serverFetch);
    expect(noms(await b.loadData('profiles'))).toEqual(['Cyril']);
    await settle();

    await a.persistData('profiles', IDX('Cyril', 'Soren'));
    await settle();

    await b.loadData('profiles'); // 1er appel : renvoie le local, rapatrie en fond
    await settle();
    expect(noms(await b.loadData('profiles'))).toEqual(['Cyril', 'Soren']);
  });

  it('le serveur refuse une écriture qui ne se base pas sur la version courante', async () => {
    const url = 'https://exemple/?key=test';
    const h = { 'Authorization': 'Bearer ' + SYNC_KEY, 'Content-Type': 'application/json' };

    const r1 = await server.serverFetch(url, { method: 'PUT', headers: { ...h, 'X-Plume-Base-Version': '0' }, body: '{"a":1}' });
    expect(r1.status).toBe(200);
    expect(r1.headers.get('X-Plume-Version')).toBe('1');

    // Un appareil encore persuadé d'être en version 0 : refusé.
    const r2 = await server.serverFetch(url, { method: 'PUT', headers: { ...h, 'X-Plume-Base-Version': '0' }, body: '{"a":2}' });
    expect(r2.status).toBe(409);

    // Le contenu n'a pas bougé.
    const r3 = await server.serverFetch(url, { headers: h });
    expect(await r3.json()).toEqual({ a: 1 });
  });

  it('dernier filet : la fusion de l’index ne laisse jamais un profil disparaître', async () => {
    const a = makeDevice(server.serverFetch);
    // Même si une version distante amputée franchissait tous les contrôles,
    // un profil présent en local ne peut pas être retiré par la fusion.
    const fusionne = a.mergeProfilesIndex(IDX('Cyril', 'Soren'), IDX('Cyril'));
    expect(noms(fusionne)).toEqual(['Cyril', 'Soren']);
  });
});
