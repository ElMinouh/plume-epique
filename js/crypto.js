'use strict';
// Chiffrement AES-GCM + PBKDF2 (310 000 itérations, recommandation OWASP).
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
  },

  // ── Multi-profils (v7.0.0) ────────────────────────────────────────────
  // Génère une "clé de données" (DEK) aléatoire et forte, sous forme de
  // chaîne. Cette clé sert de mot de passe interne pour chiffrer les données
  // d'un profil. Elle est elle-même chiffrée ("enveloppée") par les secrets
  // de l'utilisateur (mot de passe, réponse à la question, code de récup),
  // ce qui permet plusieurs voies d'accès à la même clé sans jamais la
  // stocker en clair.
  genDataKey() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode(...bytes));
  },

  // Code de récupération lisible : 6 groupes de 4 caractères, sans les
  // caractères ambigus (0/O, 1/I) pour éviter les erreurs de recopie.
  genRecoveryCode() {
    const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const rnd = crypto.getRandomValues(new Uint8Array(24));
    let out = '';
    for (let i = 0; i < 24; i++) {
      out += ALPHABET[rnd[i] % ALPHABET.length];
      if (i % 4 === 3 && i < 23) out += '-';
    }
    return out; // ex: K7F2-9QXM-4TBP-R8WL-3ZNC-6HVD
  },

  // Normalise une réponse à la question de sécurité ou un code de
  // récupération, pour tolérer casse, espaces et accents.
  normalize(s) {
    return (s || '').trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
  },
  // Un code de récupération se compare sans tirets ni casse.
  normalizeCode(s) {
    return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
};
