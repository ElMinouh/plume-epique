// ═══════════════════════════════════════════════════════
// AUD-07 LOT 8 (v9.78.0) — IMAGES DANS R2 (AUD-07-014)
// Vrai Worker, vraie base SQLite (FakeD1), faux bucket R2 (FakeR2).
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeD1 } from './fake-d1.js';
import { FakeR2 } from './fake-r2.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const KEY = 'cle-test-aud07-8b';
const tok = seed => crypto.createHash('sha256').update('jeton|' + seed).digest('hex');
const who = id => ({ id, token: tok(id) });
const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001', BOB = 'bbbbbbbb-0000-4000-8000-000000000002';
const entry = (id, name, role = 'user') => ({ id, name, role, wrapPwd: 'w' });

function makeServer({ withR2 = true, extraEnv = {}, d1 = new FakeD1(), r2 = new FakeR2() } = {}) {
  const env = { SYNC_KEY: KEY, DB: d1, ...(withR2 ? { IMAGES: r2 } : {}), ...extraEnv };
  const worker = new Function(read('worker/sync-worker.js').replace('export default', 'return'))();
  let n = 0;
  const call = (key, { method = 'GET', body, base, as } = {}) => worker.fetch(new Request('https://s.test/?key=' + key, {
    method, body, headers: {
      Authorization: 'Bearer ' + KEY, 'CF-Connecting-IP': '10.8.1.' + (++n % 250),
      ...(base !== undefined ? { 'X-Plume-Base-Version': String(base) } : {}),
      ...(as ? { 'X-Plume-Profile-Id': as.id, 'X-Plume-Profile-Token': as.token } : {})
    }
  }), env);
  const totals = () => Object.fromEntries(d1.db.prepare('SELECT scope, bytes, keys FROM sync_totals').all().map(r => [r.scope, [r.bytes, r.keys]]));
  const meta = k => d1.db.prepare('SELECT k, version, wid, chunks, bytes FROM sync_meta WHERE k = ?').get(k);
  const chunks = k => d1.db.prepare('SELECT COUNT(*) AS n FROM sync_chunks WHERE k = ?').get(k).n;
  return { d1, r2, call, totals, meta, chunks, env };
}
const img = n => '"' + 'x'.repeat(n - 2) + '"';

describe('014 — nouvelles images dans R2, fiche et compteurs dans D1', () => {
  it('l\'image va dans R2 : aucun morceau en D1, fiche « r2:… », lecture identique, version 1', async () => {
    const s = makeServer();
    const corps = '{"v":1,"data":"AAAA"}';
    expect((await s.call('img_pp_m1_i1', { method: 'PUT', body: corps, base: 0 })).status).toBe(200);
    expect(s.r2.objects.get('img_pp_m1_i1')).toBe(corps);
    expect(s.chunks('img_pp_m1_i1')).toBe(0);
    expect(s.meta('img_pp_m1_i1')).toMatchObject({ version: 1, chunks: 0, bytes: corps.length });
    expect(s.meta('img_pp_m1_i1').wid).toMatch(/^r2:/);
    const r = await s.call('img_pp_m1_i1');
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(corps);
    expect(r.headers.get('X-Plume-Version')).toBe('1');
  });
  it('compteurs : l\'image compte dans « img » et « pimg:<profil> », PAS dans « global » ni « p:<profil> » (hors base D1)', async () => {
    const s = makeServer();
    await s.call('doc_pp_m1', { method: 'PUT', body: img(100), base: 0 });
    await s.call('img_pp_m1_i1', { method: 'PUT', body: img(5000), base: 0 });
    expect(s.totals()).toEqual({ global: [100, 1], 'p:pp': [100, 1], img: [5000, 1], 'pimg:pp': [5000, 1] });
    expect(s.chunks('doc_pp_m1')).toBe(1); // le texte reste dans D1
  });
  it('un 409 (image déjà présente) ne change rien ; la suppression retire l\'objet, la fiche et les compteurs', async () => {
    const s = makeServer();
    await s.call('img_pp_m1_i1', { method: 'PUT', body: img(300), base: 0 });
    const avant = s.totals();
    expect((await s.call('img_pp_m1_i1', { method: 'PUT', body: img(999), base: 0 })).status).toBe(409);
    expect(s.totals()).toEqual(avant);
    expect(s.r2.objects.get('img_pp_m1_i1')).toHaveLength(300);
    expect((await s.call('img_pp_m1_i1', { method: 'DELETE' })).status).toBe(200);
    expect(s.r2.objects.has('img_pp_m1_i1')).toBe(false);
    expect(s.meta('img_pp_m1_i1')).toBeUndefined();
    expect(s.totals().img).toEqual([0, 0]);
    expect(s.totals()['pimg:pp']).toEqual([0, 0]);
    expect((await (await s.call('img_pp_m1_i1')).text())).toBe('null');
  });
  it('sans liaison R2, les images restent dans D1 comme avant', async () => {
    const s = makeServer({ withR2: false });
    await s.call('img_pp_m1_i1', { method: 'PUT', body: img(400), base: 0 });
    expect(s.chunks('img_pp_m1_i1')).toBe(1);
    expect(s.meta('img_pp_m1_i1').wid).not.toMatch(/^r2:/);
    expect(s.totals()).toEqual({ global: [400, 1], 'p:pp': [400, 1], img: [400, 1] });
  });
});

describe('014 — anciennes images (D1) et migration des compteurs', () => {
  it('une image déjà en D1 reste lisible avec la liaison R2, et se supprime proprement', async () => {
    const d1 = new FakeD1();
    const ancien = makeServer({ withR2: false, d1 });
    await ancien.call('img_pp_m1_old', { method: 'PUT', body: img(700), base: 0 });
    const s = makeServer({ d1 });
    const r = await s.call('img_pp_m1_old');
    expect((await r.text()).length).toBe(700);
    await s.call('img_pp_m1_new', { method: 'PUT', body: img(200), base: 0 });
    expect(s.totals()).toMatchObject({ global: [700, 1], 'p:pp': [700, 1], img: [900, 2], 'pimg:pp': [200, 1] });
    expect((await s.call('img_pp_m1_old', { method: 'DELETE' })).status).toBe(200);
    expect(s.totals()).toMatchObject({ global: [0, 0], 'p:pp': [0, 0], img: [200, 1], 'pimg:pp': [200, 1] });
  });
  it('réécrire une ancienne image (D1) vers R2 déplace ses octets d\'un compteur à l\'autre', async () => {
    const d1 = new FakeD1();
    await makeServer({ withR2: false, d1 }).call('img_pp_m1_old', { method: 'PUT', body: img(500), base: 0 });
    const s = makeServer({ d1 });
    expect((await s.call('img_pp_m1_old', { method: 'PUT', body: img(800), base: 1 })).status).toBe(200);
    expect(s.totals()).toMatchObject({ global: [0, 0], 'p:pp': [0, 0], img: [800, 1], 'pimg:pp': [800, 1] });
    expect(s.chunks('img_pp_m1_old')).toBe(0); // anciens morceaux retirés
    expect(s.r2.objects.get('img_pp_m1_old')).toHaveLength(800);
  });
  it('le recomptage (compteur gonflé) conserve la taille des images R2', async () => {
    const s = makeServer();
    await s.call('img_pp_m1_i1', { method: 'PUT', body: img(1234), base: 0 });
    await s.call('doc_pp_m1', { method: 'PUT', body: img(50), base: 0 });
    s.d1.db.exec("UPDATE sync_totals SET bytes = 1 WHERE scope = 'pimg:pp'"); // compteur d'images faussé
    const ins = s.d1.db.prepare("INSERT INTO sync_meta (k, version, wid, chunks, updated_at, bytes) VALUES (?, 1, ?, 1, 0, 0)");
    const chk = s.d1.db.prepare("INSERT INTO sync_chunks (k, wid, idx, data) VALUES (?, ?, 0, '')");
    for (let i = 0; i < 1999; i++) { ins.run('aichat_pp_' + i, 'w' + i); chk.run('aichat_pp_' + i, 'w' + i); } // 2 000 clés de texte réelles avec doc_pp_m1
    s.d1.db.exec("UPDATE sync_totals SET keys = 2000 WHERE scope = 'p:pp'");
    const r = await s.call('doc_pp_m2', { method: 'PUT', body: img(50), base: 0 }); // 2000 clés réelles : refus confirmé après recomptage
    expect(r.status).toBe(507);
    expect(s.totals()['pimg:pp']).toEqual([1234, 1]); // recalculé depuis la fiche, pas perdu
    expect(s.totals().img).toEqual([1234, 1]);
  });
});

describe('014 — budgets et quotas propres aux images R2', () => {
  it('budget total : refus 507 au-delà (variable IMG_R2_BUDGET_BYTES), après confirmation par recomptage', async () => {
    const s = makeServer({ extraEnv: { IMG_R2_BUDGET_BYTES: '1000' } });
    expect((await s.call('img_pp_m1_i1', { method: 'PUT', body: img(600), base: 0 })).status).toBe(200);
    const r = await s.call('img_pp_m1_i2', { method: 'PUT', body: img(600), base: 0 });
    expect(r.status).toBe(507);
    expect((await r.json()).budget).toBe(1000);
    expect(s.r2.objects.has('img_pp_m1_i2')).toBe(false); // rien d'écrit
  });
  it('quota par profil : un profil plein est refusé (507 « profile-images »), pas les autres', async () => {
    const s = makeServer({ extraEnv: { IMG_R2_PROFILE_BYTES: '1000' } });
    expect((await s.call('img_pp_m1_i1', { method: 'PUT', body: img(900), base: 0 })).status).toBe(200);
    const r = await s.call('img_pp_m1_i2', { method: 'PUT', body: img(300), base: 0 });
    expect(r.status).toBe(507);
    expect((await r.json()).quota).toBe('profile-images');
    expect((await s.call('img_qq_m1_i1', { method: 'PUT', body: img(900), base: 0 })).status).toBe(200);
  });
  it('un profil dont le texte a atteint ses quotas D1 peut quand même enregistrer des images (R2 hors base)', async () => {
    const s = makeServer();
    await s.call('doc_pp_m1', { method: 'PUT', body: img(50), base: 0 });
    const ins = s.d1.db.prepare("INSERT INTO sync_meta (k, version, wid, chunks, updated_at, bytes) VALUES (?, 1, ?, 1, 0, 0)");
    const chk = s.d1.db.prepare("INSERT INTO sync_chunks (k, wid, idx, data) VALUES (?, ?, 0, '')");
    for (let i = 0; i < 1999; i++) { ins.run('aichat_pp_' + i, 'w' + i); chk.run('aichat_pp_' + i, 'w' + i); }
    s.d1.db.exec("UPDATE sync_totals SET keys = 2000 WHERE scope = 'p:pp'");
    expect((await s.call('doc_pp_m9', { method: 'PUT', body: img(50), base: 0 })).status).toBe(507); // texte : plein
    expect((await s.call('img_pp_m1_i1', { method: 'PUT', body: img(500), base: 0 })).status).toBe(200); // image : acceptée
  });
  it('les valeurs par défaut : 5 Go au total, 2 Go par profil', () => {
    const src = read('worker/sync-worker.js');
    expect(src).toMatch(/IMG_R2_BUDGET_BYTES = 5 \* 1000 \* 1000 \* 1000/);
    expect(src).toMatch(/IMG_R2_PROFILE_BYTES = 2 \* 1000 \* 1000 \* 1000/);
  });
});

describe('014 — pannes et nettoyage', () => {
  it('fiche sans objet R2 : lecture « null » et la fiche est retirée (auto-guérison)', async () => {
    const s = makeServer();
    await s.call('img_pp_m1_i1', { method: 'PUT', body: img(400), base: 0 });
    s.r2.objects.delete('img_pp_m1_i1');
    expect(await (await s.call('img_pp_m1_i1')).text()).toBe('null');
    expect(s.meta('img_pp_m1_i1')).toBeUndefined();
    expect(s.totals().img).toEqual([0, 0]);
  });
  it('échec de R2 à l\'écriture : erreur 500, aucune fiche ni compteur créés', async () => {
    const s = makeServer();
    s.r2.failNextPut = new Error('R2 indisponible');
    const r = await s.call('img_pp_m1_i1', { method: 'PUT', body: img(400), base: 0 });
    expect(r.status).toBe(500);
    expect(s.meta('img_pp_m1_i1')).toBeUndefined();
    expect(s.totals().img).toEqual([0, 0]);
    expect((await s.call('img_pp_m1_i1', { method: 'PUT', body: img(400), base: 0 })).status).toBe(200); // la reprise réussit
  });
  it('__usage__ décrit R2 : nombre, octets, budget', async () => {
    const s = makeServer();
    await s.call('img_pp_m1_i1', { method: 'PUT', body: img(400), base: 0 });
    const u = await (await s.call('__usage__')).json();
    expect(u).toMatchObject({ r2: true, imagesR2: 1, imagesR2Bytes: 400, imagesBudget: 5000000000 });
    const sans = await (await makeServer({ withR2: false }).call('__usage__')).json();
    expect(sans).toMatchObject({ r2: false, imagesBudget: 350 * 1024 * 1024 });
  });
  it('effacer un profil supprimé efface aussi ses images dans R2 (pas celles des autres)', async () => {
    const s = makeServer();
    const editIndex = async (as, mutate) => { const g = await s.call('profiles'); const v = g.headers.get('X-Plume-Version'); const idx = JSON.parse(await g.text()); mutate(idx); return s.call('profiles', { method: 'PUT', body: JSON.stringify(idx), base: v, as }); };
    await s.call('profiles', { method: 'PUT', body: JSON.stringify({ profiles: [entry(ADMIN, 'Alice', 'admin')] }), base: 0 });
    await s.call('data_' + ADMIN, { method: 'PUT', body: '"d"', base: 0, as: who(ADMIN) });
    await editIndex(who(ADMIN), i => { i.profiles.push(entry(BOB, 'Bob')); });
    await s.call('img_' + BOB + '_m1_i1', { method: 'PUT', body: img(100), base: 0, as: who(BOB) });
    await s.call('img_' + BOB + '_m1_i2', { method: 'PUT', body: img(100), base: 0, as: who(BOB) });
    await s.call('img_' + ADMIN + '_m1_i1', { method: 'PUT', body: img(100), base: 0, as: who(ADMIN) });
    expect(s.r2.objects.size).toBe(3);
    await editIndex(who(ADMIN), i => { i.profiles = i.profiles.filter(p => p.id !== BOB); i.deletedProfiles = [{ id: BOB, at: Date.now() }]; });
    expect((await s.call('profile_' + BOB, { method: 'DELETE', as: who(ADMIN) })).status).toBe(200);
    expect([...s.r2.objects.keys()]).toEqual(['img_' + ADMIN + '_m1_i1']);
    expect(s.totals()['pimg:' + BOB]).toBeUndefined(); // compteurs reconstruits après l'effacement : plus de ligne pour ce profil
    expect(s.totals().img).toEqual([100, 1]);
  });
  it('la configuration lie le bucket privé « plume-images » sous le nom IMAGES', () => {
    expect(read('worker/wrangler-sync.toml')).toMatch(/\[\[r2_buckets\]\]\s*\nbinding = "IMAGES"\s*\nbucket_name = "plume-images"/);
  });
});
