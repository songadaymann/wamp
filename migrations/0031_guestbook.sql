CREATE TABLE IF NOT EXISTS guestbook_entries (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  body TEXT NOT NULL,
  user_id TEXT,
  guest_session_id TEXT,
  ip_hash TEXT,
  user_agent TEXT,
  turnstile_verified_at TEXT,
  created_at TEXT NOT NULL,
  hidden_at TEXT,
  hidden_by_user_id TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (hidden_by_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_guestbook_entries_visible_created
  ON guestbook_entries (hidden_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_guestbook_entries_ip_created
  ON guestbook_entries (ip_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_guestbook_entries_session_created
  ON guestbook_entries (guest_session_id, created_at DESC);
