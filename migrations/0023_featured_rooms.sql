CREATE TABLE IF NOT EXISTS featured_rooms (
  room_id TEXT PRIMARY KEY,
  room_version INTEGER NOT NULL,
  featured_at TEXT NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_featured_rooms_featured_at
  ON featured_rooms (featured_at DESC, room_id);
