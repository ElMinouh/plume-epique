// ═══════════════════════════════════════════════════════
// AUD-06 LOT 7 (v9.69.0) — DÉTECTION ET CHAÎNE D'APPROVISIONNEMENT (AUD-06-016, 020)
// Registre des événements de sécurité du VRAI Worker (VRAIE base SQLite) ; empreintes de vendor/ ; CI. Pas d'alerte ntfy
// (refusée par le propriétaire, 12/10/2026).
// ═══════════════════════════════════════════════════════
import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeD1 } from './fake-d1.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const KEY = 'cle-de-synchro-de-test';
const tok = seed => crypto.createHash('sha256').update('jeton|' + seed).digest('hex');
const who = id => ({ id, token: tok(id) });
const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001', BOB = 'bbbbbbbb-0000-4000-8000-000000000002';
const entry = (id, name, role = 'user') => ({ id, name, role, wrapPwd: 'w' });
const pseudo = id => crypto.createHash('sha256').update('plume-evt|' + id).digest('hex').slice(0, 10);

function makeServer() {
  const d1 = new FakeD1();
  const env = { SYNC_KEY: KEY, DB: d1 };
  const worker = new Function(read('worker/sync-worker.js').replace('export default', 'return'))();
  let n = 0;
  const call = (key, { method = 'GET', body, base, as, auth = KEY, ip, country } = {}) => {
    const req = new Request('https://s.test/?key=' + key, {
      method, body, headers: {
        Authorization: 'Bearer ' + auth, 'CF-Connecting-IP': ip || '10.7.0.' + (++n % 250),
        ...(base !== undefined ? { 'X-Plume-Base-Version': String(base) } : {}),
        ...(as ? { 'X-Plume-Profile-Id': as.id, 'X-Plume-Profile-Token': as.token } : {})
      }
    });
    if (country) Object.defineProperty(req, 'cf', { value: { country } });
    return worker.fetch(req, env);
  };
  const events = () => d1.db.prepare('SELECT * FROM security_events ORDER BY ts, rowid').all();
  return { d1, call, events };
}
async function installation(s) {
  await s.call('profiles', { method: 'PUT', body: JSON.stringify({ profiles: [entry(ADMIN, 'Alice', 'admin'), entry(BOB, 'Bob')] }), base: 0 });
  await s.call('data_' + ADMIN, { method: 'PUT', body: '"d"', base: 0, as: who(ADMIN) });
  await s.call('data_' + BOB, { method: 'PUT', body: '"d"', base: 0, as: who(BOB) });
}

describe('016 — registre des événements de sécurité', () => {
  it('une clé refusée est enregistrée (type, pays) — sans la clé essayée, sans adresse IP', async () => {
    const s = makeServer();
    const r = await s.call('profiles', { auth: 'clé-essayée-secrète-123', ip: '203.0.113.77', country: 'FR' });
    expect(r.status).toBe(401);
    const e = s.events();
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ kind: 'auth_fail', cc: 'FR' });
    const brut = JSON.stringify(e);
    expect(brut).not.toContain('clé-essayée');
    expect(brut).not.toContain('203.0.113.77');
  });
  it('un refus de la serrure d\'un profil est enregistré avec l\'empreinte du profil visé, jamais son identifiant', async () => {
    const s = makeServer(); await installation(s);
    const r = await s.call('doc_' + BOB + '_m1', { as: who(ADMIN) });
    expect(r.status).toBe(403);
    const e = s.events().filter(x => x.kind === 'profile_denied');
    expect(e).toHaveLength(1);
    expect(e[0].pid).toBe(pseudo(BOB));
    expect(e[0].detail).toBe('profile-token');
    expect(JSON.stringify(e)).not.toContain(BOB);
  });
  it('suppression, verrouillage de profil et changement de rôle sont enregistrés', async () => {
    const s = makeServer(); await installation(s);
    await s.call('doc_' + BOB + '_m1', { method: 'PUT', body: '"x"', base: 0, as: who(BOB) });
    await s.call('doclist_' + BOB, { method: 'PUT', body: JSON.stringify({ documents: [], deleted: [{ id: 'm1', at: 1 }] }), base: 0, as: who(BOB) });
    expect((await s.call('doc_' + BOB + '_m1', { method: 'DELETE', as: who(BOB) })).status).toBe(200);
    const g = await s.call('profiles'); const v = g.headers.get('X-Plume-Version'); const idx = JSON.parse(await g.text());
    idx.profiles.find(p => p.id === BOB).role = 'admin';
    expect((await s.call('profiles', { method: 'PUT', body: JSON.stringify(idx), base: v, as: who(ADMIN) })).status).toBe(200);
    const kinds = s.events().map(x => x.kind);
    expect(kinds).toContain('profile_lock');
    expect(kinds).toContain('delete');
    expect(kinds).toContain('role_change');
    expect(s.events().find(x => x.kind === 'delete')).toMatchObject({ pid: pseudo(BOB), detail: 'doc' });
  });
  it('l\'effacement d\'un profil et le refus de modifier la liste des profils sont enregistrés', async () => {
    const s = makeServer(); await installation(s);
    const g = await s.call('profiles'); const v = g.headers.get('X-Plume-Version'); const idx = JSON.parse(await g.text());
    const attaque = JSON.parse(JSON.stringify(idx)); attaque.profiles.find(p => p.id === ADMIN).name = 'Piraté';
    expect((await s.call('profiles', { method: 'PUT', body: JSON.stringify(attaque), base: v, as: who(BOB) })).status).toBe(403);
    idx.profiles = idx.profiles.filter(p => p.id !== BOB); idx.deletedProfiles = [{ id: BOB, at: Date.now() }];
    await s.call('profiles', { method: 'PUT', body: JSON.stringify(idx), base: v, as: who(ADMIN) });
    expect((await s.call('profile_' + BOB, { method: 'DELETE', as: who(ADMIN) })).status).toBe(200);
    const kinds = s.events().map(x => x.kind);
    expect(kinds).toContain('index_denied');
    expect(kinds).toContain('profile_erase');
    expect(s.events().find(x => x.kind === 'profile_erase').pid).toBe(pseudo(BOB));
  });
  it('plafond : une rafale de clés refusées n\'écrit que 10 lignes par minute (la base partagée ne peut pas être saturée)', async () => {
    const s = makeServer();
    for (let i = 0; i < 40; i++) await s.call('profiles', { auth: 'essai-' + i, ip: '198.51.100.' + i });
    const n = s.events().filter(x => x.kind === 'auth_fail').length;
    expect(n).toBeLessThanOrEqual(10);
    expect(n).toBeGreaterThanOrEqual(1);
  });
  it('un usage normal n\'écrit RIEN dans le registre (lectures, écritures autorisées)', async () => {
    const s = makeServer();
    await s.call('doc_x_y', { method: 'PUT', body: '"v"', base: 0 });
    await s.call('doc_x_y');
    await s.call('__ping__');
    expect(s.events()).toEqual([]);
  });
  it('lecture du registre : résumé 24 h et derniers événements ; refusée sans clé', async () => {
    const s = makeServer();
    await s.call('profiles', { auth: 'faux' });
    const sans = await s.call('__security__', { auth: 'faux' });
    expect(sans.status).toBe(401);
    const r = await s.call('__security__');
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.retentionDays).toBe(30);
    expect(j.last24h.auth_fail).toBeGreaterThanOrEqual(1);
    expect(j.last[0]).toHaveProperty('kind');
  });
  it('conservation 30 jours : les événements plus anciens sont purgés', async () => {
    const s = makeServer();
    await s.call('profiles', { auth: 'x' }); // crée la table
    s.d1.db.prepare("INSERT INTO security_events (ts, kind) VALUES (?, 'delete')").run(Date.now() - 31 * 24 * 3600 * 1000);
    const alea = vi.spyOn(Math, 'random').mockReturnValue(0); // force la purge occasionnelle
    for (let i = 0; i < 3; i++) await s.call('profiles', { auth: 'y' + i, ip: '192.0.2.' + i });
    alea.mockRestore();
    expect(s.events().find(x => Date.now() - x.ts > 30 * 24 * 3600 * 1000)).toBeUndefined();
  });
  it('journal Workers Logs : empreinte du profil et pays ajoutés, jamais l\'identifiant ni l\'adresse', async () => {
    const lignes = [];
    const spy = vi.spyOn(console, 'log').mockImplementation(m => lignes.push(m));
    const s = makeServer();
    await s.call('data_' + BOB, { method: 'PUT', body: '"d"', base: 0, as: who(BOB), country: 'BE', ip: '198.18.0.9' });
    spy.mockRestore();
    const evt = lignes.map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(x => x && x.evt === 'sync').pop();
    expect(evt).toMatchObject({ pid: pseudo(BOB), cc: 'BE', fam: 'data', st: 200 });
    expect(lignes.join('\n')).not.toContain(BOB);
    expect(lignes.join('\n')).not.toContain('198.18.0.9');
  });
  it('un échec d\'écriture dans le registre ne casse JAMAIS la requête', async () => {
    const s = makeServer();
    s.d1.db.exec('DROP TABLE IF EXISTS security_events; CREATE VIEW security_events AS SELECT 1 AS ts, 1 AS kind, 1 AS pid, 1 AS cc, 1 AS detail');
    const r = await s.call('profiles', { auth: 'faux' });
    expect(r.status).toBe(401);
  });
  it('script de lecture : met en forme sans rien inventer', () => {
    const { formater } = require('../../scripts/evenements-securite.cjs');
    const txt = formater({ retentionDays: 30, last24h: { auth_fail: 12, delete: 1 }, last: [{ ts: 1760000000000, kind: 'auth_fail', pid: null, cc: 'FR', detail: 'profiles' }] });
    expect(txt).toContain('auth_fail');
    expect(txt).toContain('clé de synchronisation refusée');
    expect(txt).toMatch(/12\s+auth_fail/);
    expect(formater({ retentionDays: 30, last24h: {}, last: [] })).toContain('aucun événement');
  });
});

describe('020 — intégrité des bibliothèques de vendor/', () => {
  const emp = require('../../scripts/vendor-empreintes.cjs');
  it('chaque fichier de vendor/ correspond à son empreinte enregistrée dans vendor/SHA256SUMS (aucun ajout, retrait ni octet modifié)', () => {
    const c = emp.comparer();
    expect(c).toEqual({ modifies: [], manquants: [], nouveaux: [], invalides: [] });
  });
  it('SHA256SUMS couvre les 15 bibliothèques, les modules ESM et les polices', () => {
    const chemins = emp.lireSommes().map(x => x.chemin);
    for (const f of ['dompurify-3.4.16.min.js', 'jspdf-4.2.1.umd.min.js', 'docx-9.8.1.js', 'mammoth-1.11.0.browser.min.js', 'odf-kit-0.14.3.esm.js', 'marked-18.0.14.esm.js']) expect(chemins, f).toContain(f);
    expect(chemins.some(c => c.startsWith('fonts/') && c.endsWith('.woff2'))).toBe(true);
    expect(chemins.length).toBeGreaterThanOrEqual(24);
  });
  it('la comparaison détecte une modification d\'un seul octet, un fichier retiré et un fichier ajouté', () => {
    const reel = emp.calculer();
    const att = emp.lireSommes();
    const alt = reel.map((x, i) => i === 0 ? { ...x, empreinte: 'f'.repeat(64) } : x);
    expect(emp.comparer(alt, att).modifies).toEqual([reel[0].chemin]);
    expect(emp.comparer(reel.slice(1), att).manquants).toEqual([reel[0].chemin]);
    expect(emp.comparer([...reel, { chemin: 'intrus.js', empreinte: 'a'.repeat(64) }], att).nouveaux).toEqual(['intrus.js']);
  });
  it('les bibliothèques « copies exactes » sont IDENTIQUES aux paquets npm officiels (seule la ligne sourceMappingURL est retirée)', () => {
    const { comparer } = require('../../scripts/vendor-compare-npm.cjs');
    const r = comparer();
    expect(r.length).toBe(9);
    expect(r.filter(x => x.etat !== 'identique'), JSON.stringify(r.filter(x => x.etat !== 'identique'))).toEqual([]);
  });
});

describe('020 — chaîne de publication (CI)', () => {
  const test = read('.github/workflows/test.yml'), deploy = read('.github/workflows/deploy-workers.yml');
  it('droits minimaux du jeton GitHub (lecture seule) dans les deux workflows', () => {
    for (const w of [test, deploy]) expect(w).toMatch(/^permissions:\s*\n\s+contents: read/m);
    expect(test + deploy).not.toMatch(/contents: write|pull-requests: write|id-token: write/);
  });
  it('audit des dépendances de production BLOQUANT (plus de continue-on-error), signatures npm et intégrité de vendor/ vérifiées', () => {
    expect(test).toContain('npm audit --omit=dev --audit-level=high');
    expect(test).not.toMatch(/continue-on-error/);
    expect(test).toContain('npm audit signatures');
    expect(test).toContain('node scripts/vendor-empreintes.cjs');
    expect(test).toContain('node scripts/vendor-compare-npm.cjs');
  });
  it('toutes les actions restent épinglées par empreinte de commit (jamais par étiquette mouvante)', () => {
    for (const w of [test, deploy]) {
      const uses = w.match(/uses:\s*\S+/g) || [];
      expect(uses.length).toBeGreaterThan(0);
      for (const u of uses) expect(u, u).toMatch(/@[0-9a-f]{40}\b/);
    }
  });
});

describe('020 — les workflows restent du YAML valide (régression : un « : » dans un nom d\'étape a invalidé le workflow du 12/10/2026)', () => {
  it('aucun nom d\'étape ni de job ne contient « : » (indicateur de clé YAML dans une valeur non guillemetée)', () => {
    for (const f of ['.github/workflows/test.yml', '.github/workflows/deploy-workers.yml']) {
      const noms = read(f).split('\n').filter(l => /^\s*(- )?name:/.test(l)).map(l => l.replace(/^\s*(- )?name:\s*/, '').replace(/\s+#.*$/, ''));
      expect(noms.length, f).toBeGreaterThan(0);
      for (const n of noms) {
        if (/^["'].*["']$/.test(n)) continue; // guillemeté : permis
        expect(n, f + ' : ' + n).not.toMatch(/:(\s|$)/);
      }
    }
  });
});
