// Faux bucket R2 pour les tests : l'interface minimale utilisée par worker/sync-worker.js (put / get / delete).
export class FakeR2 {
  constructor() { this.objects = new Map(); this.puts = 0; this.failNextPut = null; }
  async put(key, value) {
    if (this.failNextPut) { const e = this.failNextPut; this.failNextPut = null; throw e; }
    this.puts++;
    this.objects.set(key, String(value));
    return { key };
  }
  async get(key) {
    if (!this.objects.has(key)) return null;
    const v = this.objects.get(key);
    return { key, size: v.length, async text() { return v; } };
  }
  async delete(keys) { for (const k of (Array.isArray(keys) ? keys : [keys])) this.objects.delete(k); }
}
