// Fausse base D1 pour les tests : exécute le VRAI SQL sur SQLite (node:sqlite),
// avec l'interface minimale de D1 utilisée par worker/sync-worker.js
// (prepare().bind().first()/all()/run(), batch() transactionnel).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.resolve(__dirname, '..', '..', 'worker', 'sync-schema.sql'), 'utf8');

export class FakeD1 {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec(SCHEMA);
    this.failNextBatch = null; // Error à lever au prochain batch (simulation de panne/quota)
  }
  prepare(sql) {
    const db = this.db;
    const withParams = (...params) => ({
      sql,
      async first() { return db.prepare(sql).get(...params) ?? null; },
      async all() { return { results: db.prepare(sql).all(...params) }; },
      async run() { const r = db.prepare(sql).run(...params); return { meta: { changes: Number(r.changes) } }; }
    });
    // Comme le vrai D1 : une requête sans paramètre s'exécute directement (first/all/run), sinon via bind().
    return { bind: withParams, ...withParams() };
  }
  // Comme le vrai D1, un batch est atomique ET sérialisé : deux batch lancés en
  // même temps s'exécutent l'un après l'autre (une seule connexion SQLite ici).
  batch(stmts) {
    const run = (this._queue || Promise.resolve()).then(() => this._runBatch(stmts));
    this._queue = run.then(() => {}, () => {});
    return run;
  }
  async _runBatch(stmts) {
    if (this.failNextBatch) { const e = this.failNextBatch; this.failNextBatch = null; throw e; }
    this.db.exec('BEGIN');
    try {
      const out = [];
      for (const st of stmts) out.push(await st.run());
      this.db.exec('COMMIT');
      return out;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  count(table) { return this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n; }
}
