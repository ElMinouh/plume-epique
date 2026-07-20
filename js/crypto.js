'use strict';
// Correction sécurité V56 : PBKDF2 passé de 100 000 à 310 000 itérations
// (recommandation OWASP 2023 pour PBKDF2-SHA256)
const Crypto = {
  async deriveKey(password, salt) {
    const enc = new TextEncoder();
    const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name:'PBKDF2', salt, iterations:310000, hash:'SHA-256' }, km, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']);
  },
  async encrypt(plaintext, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await this.deriveKey(password, salt);
    const ct = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
    const buf = new Uint8Array(16 + 12 + ct.byteLength);
    buf.set(salt); buf.set(iv, 16); buf.set(new Uint8Array(ct), 28);
    return btoa(String.fromCharCode(...buf));
  },
  async decrypt(b64, password) {
    try {
      const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const key = await this.deriveKey(password, buf.slice(0,16));
      const dec = await crypto.subtle.decrypt({ name:'AES-GCM', iv:buf.slice(16,28) }, key, buf.slice(28));
      return new TextDecoder().decode(dec);
    } catch { return null; }
  }
};
