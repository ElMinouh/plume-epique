// ═══════════════════════════════════════════════════════
// AUD-06 LOT 3b (v9.65.1) — PROTECTION DE L'INDEX DES PROFILS (AUD-06-001, suite)
// Le VRAI Worker de synchro sur une VRAIE base SQLite. On rejoue l'essai T3 de l'audit (s'ajouter administrateur,
// toucher au profil d'un autre) et on vérifie que le propriétaire et l'administrateur gardent leurs droits.
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeD1 } from './fake-d1.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const KEY = 'cle-de-synchro-de-test';
const tok = seed => crypto.createHash('sha256').update('jeton|' + seed).digest('hex');
const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001', BOB = 'bbbbbbbb-0000-4000-8000-000000000002', EVE = 'eeeeeeee-0000-4000-8000-000000000003', NEW = 'cccccccc-0000-4000-8000-000000000004';
const who = id => ({ id, token: tok(id) });

function makeServer(opts = {}) {
  const d1 = new FakeD1();
  if (opts.oldAuthTable) { // table telle que créée par la v9.65.0 : sans colonne « role »
    d1.db.exec('DROP TABLE profile_auth; CREATE TABLE profile_auth (pid TEXT PRIMARY KEY, verifier TEXT NOT NULL, created_at INTEGER NOT NULL)');
  }
  const env = { SYNC_KEY: KEY, DB: d1 };
  const worker = new Function(read('worker/sync-worker.js').replace('export default', 'return'))();
  let n = 0;
  const call = (key, { method = 'GET', body, base, as } = {}) => worker.fetch(new Request('https://s.test/?key=' + key, {
    method, body, headers: {
      Authorization: 'Bearer ' + KEY, 'CF-Connecting-IP': '10.2.0.' + (++n % 250),
      ...(base !== undefined ? { 'X-Plume-Base-Version': String(base) } : {}),
      ...(as ? { 'X-Plume-Profile-Id': as.id, 'X-Plume-Profile-Token': as.token } : {})
    }
  }), env);
  // Lit l'index courant, le modifie, le réécrit (comme le client : lecture, modification, écriture à la version lue).
  const editIndex = async (as, mutate) => {
    const g = await call('profiles');
    const v = g.headers.get('X-Plume-Version');
    const idx = JSON.parse(await g.text());
    mutate(idx);
    return call('profiles', { method: 'PUT', body: JSON.stringify(idx), base: v, as });
  };
  const index = async () => JSON.parse(await (await call('profiles')).text());
  return { d1, call, editIndex, index };
}
const entry = (id, name, role = 'user') => ({ id, name, role, wrapPwd: 'w' });

// Installation : l'administrateur crée l'index (avec lui-même), puis se verrouille ; Bob est créé et se verrouille.
async function installation(s, { lockBob = true } = {}) {
  expect((await s.call('profiles', { method: 'PUT', body: JSON.stringify({ version: 1, profiles: [entry(ADMIN, 'Alice', 'admin')] }), base: 0 })).status).toBe(200);
  expect((await s.call('data_' + ADMIN, { method: 'PUT', body: '"d"', base: 0, as: who(ADMIN) })).status).toBe(200); // verrouille l'admin
  expect((await s.editIndex(who(ADMIN), i => i.profiles.push(entry(BOB, 'Bob')))).status).toBe(200);
  if (lockBob) expect((await s.call('data_' + BOB, { method: 'PUT', body: '"d"', base: 0, as: who(BOB) })).status).toBe(200);
}

describe('Installation et rôle administrateur fixé côté serveur', () => {
  it('le premier profil verrouillé qui est « admin » dans l\'index devient administrateur ; le suivant, utilisateur', async () => {
    const s = makeServer();
    await installation(s);
    const roles = Object.fromEntries(s.d1.db.prepare('SELECT pid, role FROM profile_auth').all().map(r => [r.pid, r.role]));
    expect(roles).toEqual({ [ADMIN]: 'admin', [BOB]: 'user' });
  });
  it('un profil « admin » dans l\'index mais verrouillé APRÈS l\'administrateur reste utilisateur côté serveur', async () => {
    const s = makeServer();
    await installation(s, { lockBob: false });
    // Bob, tout juste créé, s'est écrit « admin » dans sa propre entrée avant de se verrouiller
    const r = await s.editIndex(who(BOB), i => { i.profiles.find(p => p.id === BOB).role = 'admin'; });
    expect(r.status).toBe(403); // le changement de rôle exige un administrateur
  });
  it('première installation : la liste est créée librement (aucune liste valide sur le serveur)', async () => {
    const s = makeServer();
    expect((await s.call('profiles', { method: 'PUT', body: JSON.stringify({ profiles: [entry(ADMIN, 'Alice', 'admin')] }), base: 0 })).status).toBe(200);
  });
});

describe('ESSAI T3 REJOUÉ — un porteur de la clé commune ne peut plus prendre le contrôle des profils', () => {
  it('s\'ajouter un profil « admin » est refusé quand un administrateur existe', async () => {
    const s = makeServer();
    await installation(s);
    for (const as of [undefined, who(EVE), who(BOB)]) {
      const r = await s.editIndex(as, i => i.profiles.push(entry(EVE, 'Mallory', 'admin')));
      expect(r.status).toBe(403);
      expect((await r.json()).error.code).toBe('profile-index');
    }
    expect((await s.index()).profiles.map(p => p.id)).toEqual([ADMIN, BOB]);
  });
  it('renommer, modifier ou supprimer le profil d\'un autre (verrouillé) est refusé, avec ou sans jeton', async () => {
    const s = makeServer();
    await installation(s);
    const attaques = [
      i => { i.profiles.find(p => p.id === BOB).name = 'Piraté'; },
      i => { i.profiles.find(p => p.id === BOB).wrapPwd = 'autre'; },
      i => { i.profiles = i.profiles.filter(p => p.id !== BOB); i.deletedProfiles = [{ id: BOB, at: Date.now() }]; },
      i => { i.deletedProfiles = [{ id: ADMIN, at: Date.now() }]; },
      i => { i.profiles.find(p => p.id === ADMIN).role = 'user'; }
    ];
    for (const m of attaques) {
      for (const as of [undefined, who(EVE), { id: BOB, token: tok('faux') }]) {
        expect((await s.editIndex(as, m)).status).toBe(403);
      }
    }
    const idx = await s.index();
    expect(idx.profiles.map(p => p.name)).toEqual(['Alice', 'Bob']);
    expect(idx.deletedProfiles).toBeUndefined();
  });
  it('un jeton faux pour un profil verrouillé est refusé dès l\'identification', async () => {
    const s = makeServer();
    await installation(s);
    const r = await s.editIndex({ id: BOB, token: tok('faux') }, i => { i.profiles.find(p => p.id === BOB).name = 'Robert'; });
    expect(r.status).toBe(403);
  });
});

describe('Le propriétaire et l\'administrateur gardent leurs droits', () => {
  it('chacun modifie sa propre entrée (nom, durée de session, notices vues…)', async () => {
    const s = makeServer();
    await installation(s);
    expect((await s.editIndex(who(BOB), i => { const p = i.profiles.find(x => x.id === BOB); p.name = 'Robert'; p.sessionMinutes = 60; p.seenThirdPartyNoticeV2 = true; })).status).toBe(200);
    expect((await s.editIndex(who(ADMIN), i => { i.profiles.find(x => x.id === ADMIN).name = 'Alice 2'; })).status).toBe(200);
  });
  it('l\'administrateur renomme un autre profil, puis le supprime avec sa pierre tombale', async () => {
    const s = makeServer();
    await installation(s);
    expect((await s.editIndex(who(ADMIN), i => { i.profiles.find(x => x.id === BOB).name = 'Bobby'; })).status).toBe(200);
    expect((await s.editIndex(who(ADMIN), i => { i.profiles = i.profiles.filter(x => x.id !== BOB); i.deletedProfiles = [{ id: BOB, at: Date.now() }]; })).status).toBe(200);
    expect((await s.index()).deletedProfiles.map(t => t.id)).toEqual([BOB]);
  });
  it('un utilisateur ne peut pas changer son propre rôle ; l\'administrateur le peut', async () => {
    const s = makeServer();
    await installation(s);
    expect((await s.editIndex(who(BOB), i => { i.profiles.find(x => x.id === BOB).role = 'admin'; })).status).toBe(403);
    expect((await s.editIndex(who(ADMIN), i => { i.profiles.find(x => x.id === BOB).role = 'admin'; })).status).toBe(200);
    expect(s.d1.db.prepare('SELECT role FROM profile_auth WHERE pid = ?').get(BOB).role).toBe('admin'); // le serveur suit
  });
  it('créer un profil reste libre pour tout le monde, en simple utilisateur', async () => {
    const s = makeServer();
    await installation(s);
    expect((await s.editIndex(undefined, i => i.profiles.push(entry(NEW, 'Nouveau')))).status).toBe(200);
    expect((await s.editIndex(who(EVE), i => i.profiles.push(entry(EVE, 'Eve')))).status).toBe(200);
  });
  it('fusion après un 409 : une écriture qui ne change que l\'entrée de l\'appelant passe même si d\'autres entrées sont déjà à jour', async () => {
    const s = makeServer();
    await installation(s);
    await s.editIndex(who(ADMIN), i => { i.profiles.find(x => x.id === ADMIN).name = 'Alice 3'; });
    expect((await s.editIndex(who(BOB), i => { i.profiles.find(x => x.id === BOB).name = 'Bob 3'; })).status).toBe(200);
  });
});

describe('Mise en place progressive et validation', () => {
  it('un profil pas encore verrouillé reste modifiable par un ancien appareil (sans jeton)', async () => {
    const s = makeServer();
    await installation(s, { lockBob: false });
    expect((await s.editIndex(undefined, i => { i.profiles.find(x => x.id === BOB).name = 'Bob tolérant'; })).status).toBe(200);
  });
  it('JSON invalide, structure fausse ou identifiant piégé : 400, la liste serveur reste intacte', async () => {
    const s = makeServer();
    await installation(s);
    const v = (await s.call('profiles')).headers.get('X-Plume-Version');
    for (const body of ['pas du json', '[]', '{"profiles":"x"}', '{"profiles":[{"id":"a b"}]}', '{"profiles":[{"id":"x\\"><img>"}]}', JSON.stringify({ profiles: [entry(ADMIN, 'A', 'admin')], deletedProfiles: 'x' })]) {
      const r = await s.call('profiles', { method: 'PUT', body, base: v, as: who(ADMIN) });
      expect(r.status, body).toBe(400);
    }
    expect((await s.call('profiles')).headers.get('X-Plume-Version')).toBe(v);
  });
  it('plus de 20 profils : 507 ; liste trop volumineuse : 413', async () => {
    const s = makeServer();
    await installation(s);
    const v = (await s.call('profiles')).headers.get('X-Plume-Version');
    const beaucoup = { profiles: Array.from({ length: 21 }, (_, i) => entry('p' + i, 'P' + i)) };
    expect((await s.call('profiles', { method: 'PUT', body: JSON.stringify(beaucoup), base: v, as: who(ADMIN) })).status).toBe(507);
    const gros = { profiles: [entry(ADMIN, 'x'.repeat(250 * 1024), 'admin')] };
    expect((await s.call('profiles', { method: 'PUT', body: JSON.stringify(gros), base: v, as: who(ADMIN) })).status).toBe(413);
  });
  it('migration : un administrateur DÉJÀ verrouillé par la 9.65.0 garde son rôle d\'administrateur', async () => {
    const s = makeServer({ oldAuthTable: true });
    // état de production après la 9.65.0 : index créé, administrateur verrouillé (ligne sans colonne role)
    await s.call('profiles', { method: 'PUT', body: JSON.stringify({ profiles: [entry(ADMIN, 'Alice', 'admin'), entry(BOB, 'Bob')] }), base: 0 });
    s.d1.db.prepare('INSERT INTO profile_auth (pid, verifier, created_at) VALUES (?, ?, 0)').run(ADMIN, crypto.createHash('sha256').update(tok(ADMIN)).digest('hex'));
    s.d1.db.prepare('INSERT INTO profile_auth (pid, verifier, created_at) VALUES (?, ?, 0)').run(BOB, crypto.createHash('sha256').update(tok(BOB)).digest('hex'));
    expect((await s.editIndex(who(ADMIN), i => { i.profiles.find(x => x.id === BOB).name = 'Bobby'; })).status).toBe(200); // droit d'administrateur
    const roles = Object.fromEntries(s.d1.db.prepare('SELECT pid, role FROM profile_auth').all().map(r => [r.pid, r.role]));
    expect(roles).toEqual({ [ADMIN]: 'admin', [BOB]: 'user' });
  });
  it('migration douce : une table profile_auth créée en 9.65.0 (sans colonne role) est complétée automatiquement', async () => {
    const s = makeServer({ oldAuthTable: true });
    await installation(s);
    const cols = s.d1.db.prepare('PRAGMA table_info(profile_auth)').all().map(c => c.name);
    expect(cols).toContain('role');
    expect(s.d1.db.prepare('SELECT role FROM profile_auth WHERE pid = ?').get(ADMIN).role).toBe('admin');
  });
});

describe('Client — message sur refus de l\'index', () => {
  it('un refus « profile-index » est expliqué une seule fois ; le code existe dans fetchWithTimeout', () => {
    const src = read('js/router.js');
    expect(src).toContain("j.error.code === 'profile-index'");
    expect(src).toContain('function onProfileIndexRefused');
  });
});
