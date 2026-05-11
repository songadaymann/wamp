CREATE TABLE IF NOT EXISTS room_comments (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  room_version INTEGER NOT NULL,
  room_x INTEGER NOT NULL,
  room_y INTEGER NOT NULL,
  body TEXT NOT NULL,
  author_user_id TEXT NOT NULL,
  author_display_name TEXT NOT NULL,
  builder_user_id TEXT,
  builder_display_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review',
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by_label TEXT,
  review_reason TEXT,
  notified_at TEXT,
  notification_error TEXT,
  ip_hash TEXT,
  user_agent TEXT,
  FOREIGN KEY (author_user_id) REFERENCES users(id),
  FOREIGN KEY (builder_user_id) REFERENCES users(id),
  CHECK (status IN ('pending_review', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_room_comments_public_room
  ON room_comments (room_id, room_version, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_room_comments_status_created
  ON room_comments (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_room_comments_author_created
  ON room_comments (author_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_room_comments_builder_created
  ON room_comments (builder_user_id, created_at DESC);
