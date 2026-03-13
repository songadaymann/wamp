CREATE TABLE IF NOT EXISTS playfun_point_sync (
  point_event_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  ogp_id TEXT NOT NULL,
  points INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_attempted_at TEXT,
  synced_at TEXT,
  last_error TEXT,
  FOREIGN KEY (point_event_id) REFERENCES point_events (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_playfun_point_sync_user_status_created
  ON playfun_point_sync (user_id, status, created_at ASC);
