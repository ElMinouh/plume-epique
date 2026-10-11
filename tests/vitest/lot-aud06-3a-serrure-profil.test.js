// ═══════════════════════════════════════════════════════
// AUD-06 LOT 3a (v9.65.0) — SERRURE PAR PROFIL ET QUOTAS (AUD-06-001, 002, 017)
// Le VRAI Worker de synchro tourne sur une VRAIE base SQLite (FakeD1). On rejoue d'abord les attaques de l'audit
// (essais T2/T3 : suppression forgée, lecture libre) et on vérifie qu'elles échouent sur un profil verrouillé ;
// puis la mise en place progressive, les quotas et le côté client (jeton, en-têtes, message de refus).
// ═══════════════════════════════════════════════════════
import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeD1 } from './fake-d1.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const KEY = 'cle-de-synchro-de-test';
const tokenOf = seed => crypto.createHash('sha256').update('jeton|' + seed).digest('hex');
const A = 'aaaaaaaa-0000-4000-8000-000000000001', B = 'bbbbbbbb-0000-4000-8000-000000000002';

function makeServer() {
  const d1 = new FakeD1();
  const env = { SYNC_KEY: KEY, DB: d1 };
  const worker = new Function(read('worker/sync-worker.js').replace('export default', 'return'))();
  let n = 0;
  // Appel au nom d'un profil : `as` = { id, token } (omis : ancien appareil, sans jeton).
  const call = (key, { method = 'GET', body, base = '0', as } = {}) => worker.fetch(new Request('https://s.test/?key=' + key, {
    method, body, headers: {
      Authorization: 'Bearer ' + KEY, 'X-Plume-Base-Version': base, 'CF-Connecting-IP': '10.1.0.' + (++n % 250),
      ...(as ? { 'X-Plume-Profile-Id': as.id, 'X-Plume-Profile-Token': as.token } : {})
    }
  }), env);
  return { d1, call };
}
const pa = { id: A, token: tokenOf('A') }, pb = { id: B, token: tokenOf('B') };

describe('Serrure par profil — les attaques de l\'audit échouent', () => {
  it('un profil verrouillé refuse un appareil sans jeton, avec un mauvais jeton ou avec le jeton d\'un autre profil', async () => {
    const s = makeServer();
    expect((await s.call('doc_' + A + '_m1', { method: 'PUT', body: '"secret"', as: pa })).status).toBe(200); // pose la serrure
    for (const as of [undefined, { id: A, token: tokenOf('faux') }, pb, { id: B, token: pa.token }]) {
      const r = await s.call('doc_' + A + '_m1', { as });
      expect(r.status).toBe(403);
      expect((await r.json()).error.code).toBe('profile-token');
    }
    expect(await (await s.call('doc_' + A + '_m1', { as: pa })).text()).toBe('"secret"');
  });

  it('ESSAI T2 REJOUÉ : pierre tombale forgée + DELETE sur le profil d\'un autre → refusé, le manuscrit survit', async () => {
    const s = makeServer();
    await s.call('doclist_' + A, { method: 'PUT', body: JSON.stringify({ documents: [{ id: 'm1' }], deleted: [] }), as: pa });
    await s.call('doc_' + A + '_m1', { method: 'PUT', body: '{"_enc":true,"data":"v2:x"}', as: pa });
    // Mallory (profil B, porteur de la clé commune) tente de détruire le roman de A
    const forge = await s.call('doclist_' + A, { method: 'PUT', body: JSON.stringify({ documents: [], deleted: [{ id: 'm1', at: Date.now() }] }), base: '1', as: pb });
    expect(forge.status).toBe(403);
    const del = await s.call('doc_' + A + '_m1', { method: 'DELETE', as: pb });
    expect(del.status).toBe(403);
    const sansJeton = await s.call('doc_' + A + '_m1', { method: 'DELETE' });
    expect(sansJeton.status).toBe(403);
    expect(await (await s.call('doc_' + A + '_m1', { as: pa })).text()).toBe('{"_enc":true,"data":"v2:x"}');
    expect(JSON.parse(await (await s.call('doclist_' + A, { as: pa })).text()).deleted).toEqual([]);
  });

  it('le propriétaire garde tous ses droits, suppression légitime comprise (pierre tombale puis DELETE)', async () => {
    const s = makeServer();
    await s.call('doc_' + A + '_m1', { method: 'PUT', body: '"x"', as: pa });
    await s.call('doclist_' + A, { method: 'PUT', body: JSON.stringify({ documents: [], deleted: [{ id: 'm1', at: 1 }] }), as: pa });
    expect((await s.call('doc_' + A + '_m1', { method: 'DELETE', as: pa })).status).toBe(200);
    expect(await (await s.call('doc_' + A + '_m1', { as: pa })).text()).toBe('null');
  });

  it('toutes les familles de clés d\'un profil sont protégées', async () => {
    const s = makeServer();
    await s.call('data_' + A, { method: 'PUT', body: '"d"', as: pa });
    for (const k of ['data_' + A, 'doclist_' + A, 'libsettings_' + A, 'doc_' + A + '_m', 'aichat_' + A + '_m', 'img_' + A + '_m_i']) {
      expect((await s.call(k, { as: pb })).status, k).toBe(403);
      expect((await s.call(k, { method: 'PUT', body: '"x"', as: pb })).status, k).toBe(403);
    }
  });

  it('les clés techniques et l\'index des profils ne sont pas concernés (lot 3b pour l\'index)', async () => {
    const s = makeServer();
    expect((await s.call('__ping__')).status).toBe(200);
    expect((await s.call('profiles', { method: 'PUT', body: '{"profiles":[]}' })).status).toBe(200);
  });
});

describe('Mise en place progressive', () => {
  it('profil non verrouillé : un ancien appareil (sans jeton) continue de fonctionner', async () => {
    const s = makeServer();
    expect((await s.call('doc_' + A + '_m1', { method: 'PUT', body: '"v1"' })).status).toBe(200);
    expect(await (await s.call('doc_' + A + '_m1')).text()).toBe('"v1"');
    expect(s.d1.count('profile_auth')).toBe(0);
  });
  it('la première requête avec jeton verrouille le profil ; ensuite l\'ancien appareil reçoit 403 avec un message clair', async () => {
    const s = makeServer();
    await s.call('doc_' + A + '_m1', { method: 'PUT', body: '"v1"' });
    expect((await s.call('doc_' + A + '_m1', { as: pa })).status).toBe(200);
    expect(s.d1.count('profile_auth')).toBe(1);
    const vieux = await s.call('doc_' + A + '_m1');
    expect(vieux.status).toBe(403);
    expect((await vieux.json()).error.message).toMatch(/mettez Plume à jour/i);
  });
  it('un en-tête mal formé ne verrouille rien', async () => {
    const s = makeServer();
    await s.call('doc_' + A + '_m1', { method: 'PUT', body: '"v1"', as: { id: A, token: 'trop-court' } });
    await s.call('doc_' + A + '_m1', { as: { id: B, token: tokenOf('A') } }); // identifiant ≠ profil de la clé
    expect(s.d1.count('profile_auth')).toBe(0);
  });
  it('le Worker ne stocke que l\'empreinte du jeton, jamais le jeton', async () => {
    const s = makeServer();
    await s.call('data_' + A, { method: 'PUT', body: '"d"', as: pa });
    const row = s.d1.db.prepare('SELECT verifier FROM profile_auth WHERE pid = ?').get(A);
    expect(row.verifier).toBe(crypto.createHash('sha256').update(pa.token).digest('hex'));
    expect(row.verifier).not.toBe(pa.token);
  });
  it('au plus 20 profils verrouillés : le 21e reçoit 507', async () => {
    const s = makeServer();
    for (let i = 0; i < 20; i++) {
      const id = 'p' + String(i).padStart(2, '0') + '-0000-4000-8000-000000000000';
      expect((await s.call('data_' + id, { method: 'PUT', body: '"d"', as: { id, token: tokenOf(id) } })).status).toBe(200);
    }
    const id = 'pzz-0000-4000-8000-000000000000';
    const r = await s.call('data_' + id, { method: 'PUT', body: '"d"', as: { id, token: tokenOf(id) } });
    expect(r.status).toBe(507);
    expect((await r.json()).quota).toBe('profiles');
  });
  it('deux appareils qui verrouillent en même temps : un seul gagne', async () => {
    const s = makeServer();
    const [r1, r2] = await Promise.all([
      s.call('data_' + A, { method: 'PUT', body: '"1"', as: pa }),
      s.call('data_' + A, { method: 'PUT', body: '"2"', as: { id: A, token: tokenOf('autre') } })
    ]);
    expect([r1.status, r2.status].filter(x => x === 200).length).toBeGreaterThanOrEqual(1);
    expect(s.d1.count('profile_auth')).toBe(1);
  });
});

describe('Quotas (AUD-06-017)', () => {
  it('quota d\'octets par profil : refus 507 au-delà, autres profils non touchés', async () => {
    const s = makeServer();
    // 149 Mo déjà occupés par le profil A (insérés directement : le test ne génère pas 149 Mo de requêtes)
    s.d1.db.exec("INSERT INTO sync_meta (k, version, wid, chunks, updated_at) VALUES ('doc_" + A + "_gros', 1, 'w', 1, 0)");
    s.d1.db.prepare('INSERT INTO sync_chunks (k, wid, idx, data) VALUES (?, ?, 0, ?)').run('doc_' + A + '_gros', 'w', 'x'.repeat(149 * 1024 * 1024));
    expect((await s.call('doc_' + A + '_petit', { method: 'PUT', body: 'y'.repeat(500 * 1024), as: pa })).status).toBe(200);
    const r = await s.call('doc_' + A + '_autre', { method: 'PUT', body: 'y'.repeat(900 * 1024), as: pa });
    expect(r.status).toBe(507);
    expect((await r.json()).quota).toBe('profile');
    expect((await s.call('doc_' + B + '_ok', { method: 'PUT', body: 'z'.repeat(900 * 1024), as: pb })).status).toBe(200);
  });
  it('réécrire une clé existante ne compte pas deux fois son ancienne taille', async () => {
    const s = makeServer();
    s.d1.db.exec("INSERT INTO sync_meta (k, version, wid, chunks, updated_at) VALUES ('doc_" + A + "_gros', 1, 'w', 1, 0)");
    s.d1.db.prepare('INSERT INTO sync_chunks (k, wid, idx, data) VALUES (?, ?, 0, ?)').run('doc_' + A + '_gros', 'w', 'x'.repeat(149 * 1024 * 1024));
    const r = await s.call('doc_' + A + '_gros', { method: 'PUT', body: 'y'.repeat(1024 * 1024), base: '1', as: pa });
    expect(r.status).toBe(200);
  });
  it('nombre de clés par profil plafonné à 2000 (une nouvelle clé au-delà → 507)', async () => {
    const s = makeServer();
    const stmt = s.d1.db.prepare("INSERT INTO sync_meta (k, version, wid, chunks, updated_at) VALUES (?, 1, 'w', 1, 0)");
    for (let i = 0; i < 2000; i++) stmt.run('img_' + A + '_d_' + i);
    const r = await s.call('doc_' + A + '_nouveau', { method: 'PUT', body: '"x"', as: pa });
    expect(r.status).toBe(507);
    expect((await r.json()).quota).toBe('keys');
  });
  it('garde-fou global : base à plus de 90 % de la limite → toute écriture refusée (507)', async () => {
    const s = makeServer();
    s.d1.db.exec("INSERT INTO sync_meta (k, version, wid, chunks, updated_at) VALUES ('img_" + B + "_d_i', 1, 'w', 1, 0)");
    s.d1.db.prepare('INSERT INTO sync_chunks (k, wid, idx, data) VALUES (?, ?, 0, ?)').run('img_' + B + '_d_i', 'w', 'x'.repeat(455 * 1024 * 1024));
    const r = await s.call('data_' + A, { method: 'PUT', body: '"d"', as: pa });
    expect(r.status).toBe(507);
    expect((await r.json()).quota).toBe('global');
  });
});

describe('Client — jeton du profil', () => {
  const ctxCrypto = () => {
    const ctx = vm.createContext({ crypto: globalThis.crypto, TextEncoder, Uint8Array, console });
    vm.runInContext(read('js/crypto.js').replace("'use strict';", '') + '\nthis.Crypto = Crypto;', ctx);
    return ctx.Crypto;
  };
  it('le jeton est déterministe (même clé de données → même jeton sur tous les appareils), distinct par profil, 64 hex', async () => {
    const C = ctxCrypto();
    const t1 = await C.authToken('cle-de-donnees-1'), t2 = await C.authToken('cle-de-donnees-1'), t3 = await C.authToken('cle-de-donnees-2');
    expect(t1).toMatch(/^[0-9a-f]{64}$/);
    expect(t1).toBe(t2);
    expect(t1).not.toBe(t3);
  });
  it('le jeton ne laisse pas deviner la clé de données ni les clés de chiffrement (domaine HKDF distinct)', async () => {
    const C = ctxCrypto();
    const dek = 'AbCdEf123456+/=';
    const t = await C.authToken(dek);
    expect(t).not.toContain(dek);
    expect(read('js/crypto.js')).toContain("'plume-auth-v1'");
    expect(read('js/crypto.js')).toContain("'plume-text-v2'");
  });

  function makeFetchCtx({ token, profileId, status = 200, body = '{}' }) {
    const ctx = vm.createContext({ console, TextDecoder, TextEncoder, setTimeout, clearTimeout, Promise, AbortController });
    ctx.SYNC_WORKER_URL = 'https://plume-epique-sync.air7841.workers.dev'; ctx.APP_VERSION = '9.65.0';
    ctx.toast = vi.fn();
    ctx.fetch = vi.fn(async () => new Response(body, { status, headers: { 'Content-Type': 'application/json' } }));
    const rt = read('js/router.js');
    vm.runInContext(rt.slice(rt.indexOf('const DEFAULT_FETCH_TIMEOUT_MS'), rt.indexOf('function getSyncKey()')) + '\nthis.fetchWithTimeout = fetchWithTimeout; this.setProfile = (t, p) => { _profileToken = t; _currentProfileId = p; };', ctx);
    // _currentProfileId est déclaré plus loin dans router.js : on le déclare ici comme variable globale du contexte
    vm.runInContext('var _currentProfileId = null;', ctx);
    ctx.setProfile(token, profileId);
    return ctx;
  }
  it('toute requête vers le Worker de synchro porte l\'identifiant et le jeton du profil connecté', async () => {
    const ctx = makeFetchCtx({ token: 'a'.repeat(64), profileId: A });
    await ctx.fetchWithTimeout('https://plume-epique-sync.air7841.workers.dev?key=doc_x', { headers: { Authorization: 'Bearer k' } });
    const h = ctx.fetch.mock.calls[0][1].headers;
    expect(h['X-Plume-Profile-Id']).toBe(A);
    expect(h['X-Plume-Profile-Token']).toBe('a'.repeat(64));
    expect(h.Authorization).toBe('Bearer k');
  });
  it('rien n\'est envoyé aux autres sites (GitHub, LanguageTool, relais IA) ni avant la connexion', async () => {
    const ctx = makeFetchCtx({ token: 'a'.repeat(64), profileId: A });
    await ctx.fetchWithTimeout('https://api.github.com/user', { headers: { Authorization: 'token t' } });
    expect(ctx.fetch.mock.calls[0][1].headers['X-Plume-Profile-Token']).toBeUndefined();
    const avant = makeFetchCtx({ token: null, profileId: null });
    await avant.fetchWithTimeout('https://plume-epique-sync.air7841.workers.dev?key=profiles', {});
    expect(avant.fetch.mock.calls[0][1].headers['X-Plume-Profile-Token']).toBeUndefined();
  });
  it('un refus « profile-token » (403) affiche UNE explication claire, une seule fois', async () => {
    const ctx = makeFetchCtx({ token: 'a'.repeat(64), profileId: A, status: 403, body: JSON.stringify({ error: { code: 'profile-token', message: 'x' } }) });
    await ctx.fetchWithTimeout('https://plume-epique-sync.air7841.workers.dev?key=doc_x', {});
    await ctx.fetchWithTimeout('https://plume-epique-sync.air7841.workers.dev?key=doc_y', {});
    expect(ctx.toast).toHaveBeenCalledTimes(1);
    expect(ctx.toast.mock.calls[0][0]).toMatch(/rechargez la page/i);
  });
  it('un 403 sans rapport avec la serrure n\'affiche rien', async () => {
    const ctx = makeFetchCtx({ token: 'a'.repeat(64), profileId: A, status: 403, body: JSON.stringify({ error: { message: 'Origine non autorisée.' } }) });
    await ctx.fetchWithTimeout('https://plume-epique-sync.air7841.workers.dev?key=doc_x', {});
    expect(ctx.toast).not.toHaveBeenCalled();
  });
  it('openProfile pose le jeton ; syncPush ne boucle pas sur un 403/507 (retiré de la file de reprise)', () => {
    expect(read('js/profiles.js')).toMatch(/_profileToken = await Crypto\.authToken\(dek\)/);
    expect(read('js/router.js')).toMatch(/resp\.status === 400 \|\| resp\.status === 413 \|\| resp\.status === 403 \|\| resp\.status === 507/);
  });
});
