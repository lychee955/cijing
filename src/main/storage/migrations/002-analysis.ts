export const analysisMigration = `
CREATE TABLE ai_profiles (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, protocol TEXT NOT NULL, base_url TEXT NOT NULL,
 model TEXT NOT NULL, options TEXT NOT NULL, ciphertext BLOB NOT NULL, revision INTEGER NOT NULL,
 auth_invalid INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE sentence_analyses (
 id TEXT PRIMARY KEY, record TEXT NOT NULL, reuse_key TEXT, created_at TEXT NOT NULL
);
CREATE INDEX analysis_reuse ON sentence_analyses(reuse_key, created_at DESC);
CREATE INDEX analysis_time ON sentence_analyses(created_at DESC);
`
