CREATE TABLE guest_replay_sessions (
  id TEXT PRIMARY KEY,
  write_token TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  entry_path TEXT NOT NULL,
  referrer_host TEXT NOT NULL,
  viewport TEXT NOT NULL,
  played INTEGER NOT NULL DEFAULT 0,
  moved INTEGER NOT NULL DEFAULT 0,
  signup INTEGER NOT NULL DEFAULT 0,
  signed_in INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX guest_replay_expiry ON guest_replay_sessions(expires_at);
CREATE INDEX guest_replay_visitors ON guest_replay_sessions(visitor_id, started_at);
CREATE INDEX guest_replay_recent ON guest_replay_sessions(started_at);
CREATE TABLE guest_replay_samples (
  session_id TEXT NOT NULL REFERENCES guest_replay_sessions(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK(sequence BETWEEN 0 AND 299),
  payload TEXT NOT NULL,
  PRIMARY KEY(session_id, sequence)
);
