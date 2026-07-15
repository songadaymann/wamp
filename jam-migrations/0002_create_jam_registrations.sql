CREATE TABLE IF NOT EXISTS jam_registrations (
  id TEXT PRIMARY KEY,
  jam_slug TEXT NOT NULL,
  username TEXT NOT NULL,
  username_normalized TEXT NOT NULL,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  matched_user_id TEXT,
  rules_accepted INTEGER NOT NULL CHECK (rules_accepted = 1),
  ip_hash TEXT,
  user_agent TEXT,
  turnstile_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (jam_slug, email_normalized)
);

CREATE INDEX IF NOT EXISTS idx_jam_registrations_jam_created
  ON jam_registrations (jam_slug, created_at);

CREATE INDEX IF NOT EXISTS idx_jam_registrations_username
  ON jam_registrations (jam_slug, username_normalized);
