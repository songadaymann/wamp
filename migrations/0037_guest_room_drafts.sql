CREATE TABLE IF NOT EXISTS guest_room_drafts (
  id TEXT PRIMARY KEY,
  guest_user_id TEXT NOT NULL,
  guest_display_name TEXT NOT NULL,
  recovery_token_hash TEXT NOT NULL,
  room_id TEXT NOT NULL,
  room_x INTEGER NOT NULL,
  room_y INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT,
  last_prompted_at TEXT,
  prompt_count INTEGER NOT NULL DEFAULT 0,
  claimed_by_user_id TEXT,
  claimed_room_id TEXT,
  claimed_at TEXT,
  submitted_at TEXT,
  hidden_at TEXT,
  hidden_by_user_id TEXT,
  moderation_status TEXT NOT NULL DEFAULT 'private',
  FOREIGN KEY (claimed_by_user_id) REFERENCES users(id),
  FOREIGN KEY (hidden_by_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_guest_room_drafts_guest_updated
  ON guest_room_drafts (guest_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_guest_room_drafts_room_active
  ON guest_room_drafts (room_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_guest_room_drafts_status_updated
  ON guest_room_drafts (status, updated_at DESC);
