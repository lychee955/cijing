export const initialMigration = `
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  credential_ref TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  auth_invalid INTEGER NOT NULL DEFAULT 0 CHECK(auth_invalid IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX one_active_profile ON profiles(active) WHERE active=1;
CREATE TABLE word_operations (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id),
  voc_id TEXT NOT NULL,
  spelling TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('submitting','added','present','not_added','uncertain','failed')),
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT,
  error_code TEXT
);
CREATE INDEX history_by_profile_time ON word_operations(profile_id, created_at DESC);
CREATE INDEX operation_by_word ON word_operations(profile_id, voc_id, created_at DESC);
CREATE INDEX pending_operations ON word_operations(profile_id, state);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`
