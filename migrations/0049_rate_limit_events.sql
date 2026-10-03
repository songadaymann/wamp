-- Hashed per-key event log for abuse limits (sign-in emails, code guesses, mention emails).
CREATE TABLE IF NOT EXISTS rate_limit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_lookup
  ON rate_limit_events (bucket, key_hash, created_at);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_created
  ON rate_limit_events (created_at);
