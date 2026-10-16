-- Schéma du stockage D1 du Worker de synchronisation (v9.23.0).
-- À appliquer une fois : npx wrangler d1 execute plume-sync --remote --file worker/sync-schema.sql
CREATE TABLE IF NOT EXISTS sync_meta (
  k          TEXT PRIMARY KEY,   -- clé de synchronisation (ex. doc_<profil>_<manuscrit>)
  version    INTEGER NOT NULL,   -- numéro de version croissant (arbitrage 409)
  wid        TEXT NOT NULL,      -- identifiant de l'écriture courante (ses morceaux)
  chunks     INTEGER NOT NULL,   -- nombre de morceaux de la version courante
  updated_at INTEGER NOT NULL,
  bytes      INTEGER NOT NULL DEFAULT 0  -- v9.74.0 : taille de la version courante (caractères), tenue par le Worker
);
CREATE TABLE IF NOT EXISTS sync_chunks (
  k    TEXT NOT NULL,
  wid  TEXT NOT NULL,
  idx  INTEGER NOT NULL,
  data TEXT NOT NULL,            -- morceau de la valeur (≤ 600 000 caractères)
  PRIMARY KEY (k, wid, idx)
);
-- v9.65.0 (audit AUD-06-001) — serrure par profil : empreinte (SHA-256) du jeton dérivé de la clé de données du
-- profil. Le jeton transite (HTTPS) dans chaque requête mais seul son hachage est conservé. Créée aussi à la volée par le Worker (IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS profile_auth (
  pid        TEXT PRIMARY KEY,   -- identifiant du profil
  verifier   TEXT NOT NULL,      -- SHA-256 (hex) du jeton du profil
  created_at INTEGER NOT NULL,
  role       TEXT NOT NULL DEFAULT 'user'  -- v9.65.1 : 'admin' fixé à la première connexion (voir sync-worker.js)
);
-- v9.69.0 (audit AUD-06-016) — registre des événements de sécurité (30 jours) : type, empreinte courte du profil, pays.
-- Jamais d'adresse IP, de clé, ni de contenu. Créé aussi à la volée par le Worker (IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS security_events (
  ts     INTEGER NOT NULL,   -- horodatage (ms)
  kind   TEXT NOT NULL,      -- auth_fail | rate_limit | origin_refused | profile_denied | index_denied | quota | delete | profile_erase | profile_lock | role_change
  pid    TEXT,               -- empreinte courte (10 hex) du profil concerné, non réversible sans la liste des profils
  cc     TEXT,               -- pays (en-tête Cloudflare), si connu
  detail TEXT                -- précision courte (famille de clé, code de refus…), jamais de contenu
);
CREATE INDEX IF NOT EXISTS security_events_ts ON security_events (ts);
-- v9.74.0 (audit AUD-07-007) — compteurs d'occupation (octets et nombre de clés) : 'global', 'img' et 'p:<profil>'. Tenus
-- à jour par le Worker dans la transaction de chaque écriture ; migration et recomptage automatiques (voir sync-worker.js).
CREATE TABLE IF NOT EXISTS sync_totals (
  scope TEXT PRIMARY KEY,
  bytes INTEGER NOT NULL,
  keys  INTEGER NOT NULL
);
-- v9.74.0 (audit AUD-07-015) — appels IA par jour et par profil (plafond quotidien du relais IA, plume-epique-ai). Créée
-- aussi à la volée par le Worker IA.
CREATE TABLE IF NOT EXISTS ai_usage (
  day TEXT NOT NULL,       -- AAAA-MM-JJ (UTC)
  pid TEXT NOT NULL,       -- identifiant du profil, ou 'anon'
  n   INTEGER NOT NULL,
  PRIMARY KEY (day, pid)
);
