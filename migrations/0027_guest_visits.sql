CREATE TABLE IF NOT EXISTS guest_visits (
  session_id TEXT PRIMARY KEY,
  guest_user_id TEXT NOT NULL,
  guest_display_name TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_path TEXT,
  referrer TEXT,
  user_agent TEXT,
  mode TEXT NOT NULL,
  room_id TEXT,
  room_x INTEGER,
  room_y INTEGER,
  heartbeat_count INTEGER NOT NULL DEFAULT 0,
  browse_seconds INTEGER NOT NULL DEFAULT 0,
  play_seconds INTEGER NOT NULL DEFAULT 0,
  edit_seconds INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_guest_visits_guest_user_id
  ON guest_visits (guest_user_id);

CREATE INDEX IF NOT EXISTS idx_guest_visits_last_seen_at
  ON guest_visits (last_seen_at);

CREATE INDEX IF NOT EXISTS idx_guest_visits_mode
  ON guest_visits (mode);
