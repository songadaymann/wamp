CREATE TABLE IF NOT EXISTS room_difficulty_votes (
  room_id TEXT NOT NULL,
  room_version INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  carried_from_version INTEGER,
  PRIMARY KEY (room_id, room_version, user_id),
  FOREIGN KEY (room_id, room_version)
    REFERENCES room_versions (room_id, version) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_room_difficulty_votes_room_version
  ON room_difficulty_votes (room_id, room_version, difficulty);

CREATE INDEX IF NOT EXISTS idx_room_difficulty_votes_user
  ON room_difficulty_votes (user_id, updated_at DESC);
