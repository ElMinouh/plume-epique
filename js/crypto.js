'use strict';
// Chiffrement AES-GCM + PBKDF2 (310 000 itérations, recommandation OWASP).
// v9.4.3 — Incident du 14/08/2026 : String.fromCharCode(...buf) fait planter
// le moteur JS ("RangeError: Maximum call stack size exceeded") dès que
// `buf` dépasse environ 65 000 octets (chaque octet devient un argument de
// fonction séparé — limite du moteur, pas de la mémoire). Un manuscrit assez
// volumineux (texte chiffré + IV/sel) suffit à dépasser ce seuil : la
// sauvegarde échouait alors silencieusement, quelle que soit la taille du
// reste de l'app. bytesToBase64() traite désormais les octets par blocs de
// 32 768, bien en dessous de la limite, quelle que soit la taille du texte.
function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000; // 32768
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
// v9.66.0 (audit AUD-06-004) — COÛT DE DÉRIVATION VERSIONNÉ. Le format historique (« v1 », base64 pur) fige PBKDF2 à
// 310 000 itérations (valeur OWASP 2021 ; la recommandation actuelle pour PBKDF2-HMAC-SHA256 est de 600 000).
// Le format « p2: » des enveloppes protégées par mot de passe (wrapPwd, wrapAnswer, wrapCode) écrit le nombre
// d'itérations dans l'enveloppe : p2:<itérations>:base64(sel 16 octets + iv 12 octets + chiffré). Le coût pourra donc
// encore monter sans casser la lecture des anciennes enveloppes. Les données chiffrées par la clé de données (« v2: »
// ou v1 avec la clé de données comme mot de passe) ne sont pas concernées.
const PBKDF2_ITERATIONS_LEGACY = 310000;
const PBKDF2_ITERATIONS = 600000;
// Une itération lue dans une enveloppe vient du stockage (non fiable) : bornée, sinon une valeur gigantesque ferait
// geler la connexion (déni de service par un porteur de la clé de synchro).
const PBKDF2_ITERATIONS_MIN = 100000, PBKDF2_ITERATIONS_MAX = 2000000;
const Crypto = {
  // ACTIVATION EN DEUX TEMPS (comme le format de texte v2, docs/EXPLOITATION.md §11) : un appareil d'avant la v9.66.0
  // ne sait pas lire « p2: » (il afficherait « Mot de passe incorrect »). Étape 1 (v9.66.0) : tous les appareils LISENT
  // p2, on continue d'ÉCRIRE l'ancien format (writeP2 = false). Étape 2 : writeP2 = true une fois tous les appareils
  // en ≥ 9.66.0 ; chaque profil est alors ré-enveloppé à 600 000 itérations à sa prochaine connexion.
  writeP2: false,
  PBKDF2_ITERATIONS, PBKDF2_ITERATIONS_LEGACY,
  async deriveKey(password, salt, iterations = PBKDF2_ITERATIONS_LEGACY) {
    const enc = new TextEncoder();
    const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name:'PBKDF2', salt, iterations, hash:'SHA-256' }, km, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']);
  },
  // Format historique (v1) : 310 000 itérations, sans marquage.
  async encryptLegacy(plaintext, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await this.deriveKey(password, salt);
    const ct = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
    const buf = new Uint8Array(16 + 12 + ct.byteLength);
    buf.set(salt); buf.set(iv, 16); buf.set(new Uint8Array(ct), 28);
    return bytesToBase64(buf);
  },
  async encryptP2(plaintext, password, iterations = PBKDF2_ITERATIONS) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await this.deriveKey(password, salt, iterations);
    const ct = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
    const buf = new Uint8Array(16 + 12 + ct.byteLength);
    buf.set(salt); buf.set(iv, 16); buf.set(new Uint8Array(ct), 28);
    return 'p2:' + iterations + ':' + bytesToBase64(buf);
  },
  async decryptP2(rest, password) {
    try {
      const sep = rest.indexOf(':');
      const iterations = parseInt(rest.slice(0, sep), 10);
      if (!(iterations >= PBKDF2_ITERATIONS_MIN && iterations <= PBKDF2_ITERATIONS_MAX)) return null;
      const buf = Uint8Array.from(atob(rest.slice(sep + 1)), c => c.charCodeAt(0));
      const key = await this.deriveKey(password, buf.slice(0, 16), iterations);
      const dec = await crypto.subtle.decrypt({ name:'AES-GCM', iv:buf.slice(16, 28) }, key, buf.slice(28));
      return new TextDecoder().decode(dec);
    } catch { return null; }
  },
  // Chiffrement par MOT DE PASSE (enveloppes de clé) : p2 si activé, sinon format historique.
  async encrypt(plaintext, password) {
    return this.writeP2 ? this.encryptP2(plaintext, password) : this.encryptLegacy(plaintext, password);
  },
  // Cette enveloppe est-elle à ré-écrire au coût actuel ? (seulement quand l'écriture p2 est activée)
  envelopeNeedsUpgrade(b64) {
    if (!this.writeP2 || typeof b64 !== 'string') return false;
    if (b64.startsWith('v2:')) return false;
    if (!b64.startsWith('p2:')) return true;
    return (parseInt(b64.slice(3), 10) || 0) < PBKDF2_ITERATIONS;
  },
  async decrypt(b64, password) {
    if (typeof b64 === 'string' && b64.startsWith('v2:')) return this.decryptV2(b64.slice(3), password); // v9.31.0 : format v2 (clé de données)
    if (typeof b64 === 'string' && b64.startsWith('p2:')) return this.decryptP2(b64.slice(3), password); // v9.66.0 : coût de dérivation écrit dans l'enveloppe
    try {
      const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const key = await this.deriveKey(password, buf.slice(0,16));
      const dec = await crypto.subtle.decrypt({ name:'AES-GCM', iv:buf.slice(16,28) }, key, buf.slice(28));
      return new TextDecoder().decode(dec);
    } catch { return null; }
  },

  // ═══════════════════════════════════════════════════════════════════════
  // FORMAT DE TEXTE « v2 » (v9.31.0, audit AUD-01-019)
  // Jusqu'ici, chaque enregistrement d'un manuscrit refaisait un PBKDF2 à 310 000 itérations (sel aléatoire)
  // — un calcul conçu pour des mots de passe faibles, inutile avec la clé de données (aléatoire, 256 bits) :
  // ~30 ms par opération sur un PC (mesuré le 05/10/2026), bien plus sur un téléphone, ~160 ms de plus à
  // l'ouverture d'un manuscrit de 3 Mo. Le format v2 dérive la clé UNE fois (HKDF) puis ne fait qu'un AES-GCM.
  //
  // Format : « v2: » + base64(iv 12 octets + texte chiffré). Le préfixe rend la chaîne auto-descriptive : aucune
  // chaîne v1 (base64 pur, jamais de « : ») ne peut être confondue avec elle, et decrypt() choisit seul le bon
  // chemin — tous les sites qui lisent des données chiffrées avec la clé de données lisent donc v2 sans changement.
  //
  // DÉPLOIEMENT EN DEUX TEMPS (un appareil resté sur une version plus ancienne ne sait PAS lire v2) :
  //   • étape 1 (v9.31.0) : tous les appareils LISENT v2 ; on continue d'ÉCRIRE v1 (writeV2 = false) ;
  //   • étape 2 (v9.32.0, ACTIVÉE le 06/10/2026 sur confirmation du propriétaire que tous les appareils sont
  //     en ≥ 9.31.0) : writeV2 = true. Retour arrière : le repasser à false (les v2 existants restent lisibles). Chaque
  //     manuscrit passe alors en v2 à son prochain enregistrement (aucune migration en masse).
  // Les enveloppes de clé protégées par MOT DE PASSE (wrapPwd, wrapAnswer, wrapCode) restent en v1 : PBKDF2 y est utile.
  // ═══════════════════════════════════════════════════════════════════════
  writeV2: true,
  async encryptV2(plaintext, dek) {
    const key = await this.derive(dek, 'plume-text-v2');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv); out.set(ct, 12);
    return 'v2:' + bytesToBase64(out);
  },
  async decryptV2(b64, dek) {
    try {
      const buf = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
      const key = await this.derive(dek, 'plume-text-v2');
      return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12)));
    } catch (e) { return null; }
  },
  // Point d'entrée UNIQUE pour chiffrer une donnée avec la clé de données du profil (manuscrits, historique du
  // chat IA, réglages, Gist…) : le format dépend de `writeV2`.
  encryptData(plaintext, dek) {
    return this.writeV2 ? this.encryptV2(plaintext, dek) : this.encryptLegacy(plaintext, dek); // jamais p2 : la clé de données est déjà forte
  },

  // ── Chiffrement d'OCTETS (images du roman graphique, v9.28.0) ──────────────
  // La clé AES-GCM est dérivée UNE FOIS de la clé de données du profil (HKDF-SHA256) et gardée
  // en mémoire : pas de PBKDF2 à 310 000 itérations par image (inutile : la clé de données est
  // déjà aléatoire et forte). Format : iv (12 octets) + texte chiffré.
  // Dérivation HKDF-SHA256 d'une clé AES-GCM à partir de la clé de données, par « domaine » (info) : une clé
  // distincte pour les images et pour les textes (v2). Gardée en mémoire tant que la clé de données ne change pas.
  _derived: {},
  async derive(dek, info) {
    const hit = this._derived[info];
    if (hit && hit.dek === dek) return hit.key;
    const ikm = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dek));
    const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode(info) },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    this._derived[info] = { dek, key };
    return key;
  },
  imageKey(dek) { return this.derive(dek, 'plume-image-v1'); },
  // v9.65.0 (audit AUD-06-001) — JETON D'AUTHENTIFICATION DU PROFIL auprès du Worker de synchro : 256 bits dérivés
  // (HKDF, domaine distinct de ceux des textes et des images) de la clé de données ; le Worker n'en garde que
  // l'empreinte SHA-256. Un jeton ne permet pas de remonter à la clé de données (dérivation à sens unique).
  async authToken(dek) {
    const ikm = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dek));
    const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode('plume-auth-v1') }, base, 256);
    return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  },
  async encryptBytes(bytes, dek) {
    const key = await this.imageKey(dek);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv); out.set(ct, 12);
    return out;
  },
  async decryptBytes(buf, dek) {
    try {
      const key = await this.imageKey(dek);
      const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, key, b.slice(12)));
    } catch (e) { return null; }
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
    return bytesToBase64(bytes);
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
