CREATE TABLE IF NOT EXISTS room_rush_run_starts (
  start_id TEXT PRIMARY KEY,
  client_run_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  start_rule TEXT NOT NULL,
  start_room_id TEXT NOT NULL,
  start_x INTEGER NOT NULL,
  start_y INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_attempt_id TEXT,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  UNIQUE (user_id, client_run_id)
);

CREATE INDEX IF NOT EXISTS idx_room_rush_run_starts_user_expires
  ON room_rush_run_starts (user_id, expires_at);
