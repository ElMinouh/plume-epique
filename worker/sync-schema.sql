-- Schéma du stockage D1 du Worker de synchronisation (v9.23.0).
-- À appliquer une fois : npx wrangler d1 execute plume-sync --remote --file worker/sync-schema.sql
CREATE TABLE IF NOT EXISTS sync_meta (
  k          TEXT PRIMARY KEY,   -- clé de synchronisation (ex. doc_<profil>_<manuscrit>)
  version    INTEGER NOT NULL,   -- numéro de version croissant (arbitrage 409)
  wid        TEXT NOT NULL,      -- identifiant de l'écriture courante (ses morceaux)
  chunks     INTEGER NOT NULL,   -- nombre de morceaux de la version courante
  updated_at INTEGER NOT NULL
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
