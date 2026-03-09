CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  draft_json TEXT NOT NULL,
  published_json TEXT,
  UNIQUE (x, y)
);

CREATE INDEX IF NOT EXISTS idx_rooms_coordinates ON rooms (x, y);

CREATE TABLE IF NOT EXISTS room_versions (
  room_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (room_id, version),
  FOREIGN KEY (room_id) REFERENCES rooms (id) ON DELETE CASCADE
);
