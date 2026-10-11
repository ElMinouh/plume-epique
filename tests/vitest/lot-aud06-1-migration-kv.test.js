// ═══════════════════════════════════════════════════════
// AUD-06 LOT 1 — MIGRATION KV → D1 (AUD-06-013)
// Le script scripts/migrer-kv-vers-d1.cjs copie dans D1 ce qui n'existe QUE dans KV, via l'API du VRAI Worker
// (base D1 réelle sur SQLite), sans jamais recopier un manuscrit supprimé ni toucher à KV.
// ═══════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeD1 } from './fake-d1.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { planMigration, copyKeys, loadTombstones } = require('../../scripts/migrer-kv-vers-d1.cjs');
const KEY = 'cle-de-synchro-de-test';

function makeServer() {
  const d1 = new FakeD1(); const kv = new Map();
  const env = { SYNC_KEY: KEY, DB: d1, PLUME_SYNC: {
    async getWithMetadata(k) { return kv.has(k) ? kv.get(k) : { value: null, metadata: null }; },
    async put(k, v, o) { kv.set(k, { value: v, metadata: (o && o.metadata) || null }); }
  } };
  const worker = new Function(fs.readFileSync(path.join(ROOT, 'tests', 'vitest', 'fixtures', 'sync-worker-avec-repli-kv.js'), 'utf8').replace('export default', 'return'))();
  const call = (k, { method = 'GET', body, base } = {}) => worker.fetch(new Request('https://s.test/?key=' + k, {
    method, body, headers: { Authorization: 'Bearer ' + KEY, 'CF-Connecting-IP': '1.1.1.1', ...(base != null ? { 'X-Plume-Base-Version': String(base) } : {}) }
  }), env);
  return { d1, kv, call };
}

describe('planMigration', () => {
  it('sépare : déjà dans D1, supprimés (pierre tombale), techniques, à copier', () => {
    const plan = planMigration({
      kvKeys: ['profiles', 'doc_p1_a', 'doc_p1_b', 'aichat_p1_b', 'doclist_p1', '__ping__', 'img_p1_a_x'],
      d1Keys: ['profiles'],
      tombstones: { p1: new Set(['b']) }
    });
    expect(plan.dejaDansD1).toEqual(['profiles']);
    expect(plan.supprimes.sort()).toEqual(['aichat_p1_b', 'doc_p1_b']);
    expect(plan.ignores).toEqual(['__ping__']);
    expect(plan.copier.sort()).toEqual(['doc_p1_a', 'doclist_p1', 'img_p1_a_x']);
  });
});

describe('copie réelle via le Worker', () => {
  it('une clé présente seulement dans KV est copiée dans D1 à l\'identique, KV intact, version suivante', async () => {
    const s = makeServer();
    s.kv.set('doc_p1_a', { value: '{"_enc":true,"data":"v2:abc"}', metadata: { v: 4 } });
    const r = await copyKeys(s.call, ['doc_p1_a'], () => {});
    expect(r).toMatchObject({ copiees: 1, conflits: 0, erreurs: [] });
    expect(s.d1.count('sync_meta')).toBe(1);
    const g = await s.call('doc_p1_a');
    expect(await g.text()).toBe('{"_enc":true,"data":"v2:abc"}');
    expect(g.headers.get('X-Plume-Version')).toBe('5');
    expect(s.kv.get('doc_p1_a').metadata.v).toBe(4); // KV jamais modifié
  });

  it('un manuscrit marqué supprimé dans doclist_ n\'est jamais recopié', async () => {
    const s = makeServer();
    s.kv.set('doclist_p1', { value: JSON.stringify({ documents: [], deleted: [{ id: 'b', at: 1 }] }), metadata: { v: 2 } });
    s.kv.set('doc_p1_b', { value: '{"_enc":true,"data":"v2:zzz"}', metadata: { v: 3 } });
    const tomb = await loadTombstones(s.call, ['doc_p1_b', 'doclist_p1']);
    const plan = planMigration({ kvKeys: ['doc_p1_b', 'doclist_p1'], d1Keys: [], tombstones: tomb });
    expect(plan.supprimes).toEqual(['doc_p1_b']);
    expect(plan.copier).toEqual(['doclist_p1']);
    await copyKeys(s.call, plan.copier, () => {});
    expect(s.d1.count('sync_meta')).toBe(1); // seul l'index est copié
  });
});
