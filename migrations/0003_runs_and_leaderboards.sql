ALTER TABLE rooms ADD COLUMN draft_goal_type TEXT;
ALTER TABLE rooms ADD COLUMN draft_goal_json TEXT;
ALTER TABLE rooms ADD COLUMN draft_spawn_x REAL;
ALTER TABLE rooms ADD COLUMN draft_spawn_y REAL;
ALTER TABLE rooms ADD COLUMN published_goal_type TEXT;
ALTER TABLE rooms ADD COLUMN published_goal_json TEXT;
ALTER TABLE rooms ADD COLUMN published_spawn_x REAL;
ALTER TABLE rooms ADD COLUMN published_spawn_y REAL;

ALTER TABLE room_versions ADD COLUMN goal_type TEXT;
ALTER TABLE room_versions ADD COLUMN goal_json TEXT;
ALTER TABLE room_versions ADD COLUMN spawn_x REAL;
ALTER TABLE room_versions ADD COLUMN spawn_y REAL;

CREATE TABLE IF NOT EXISTS room_runs (
  attempt_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  room_x INTEGER NOT NULL,
  room_y INTEGER NOT NULL,
  room_version INTEGER NOT NULL,
  goal_type TEXT NOT NULL,
  goal_json TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_display_name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  result TEXT NOT NULL,
  elapsed_ms INTEGER,
  deaths INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  collectibles_collected INTEGER NOT NULL DEFAULT 0,
  enemies_defeated INTEGER NOT NULL DEFAULT 0,
  checkpoints_reached INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (room_id) REFERENCES rooms (id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_room_runs_room_version_result
  ON room_runs (room_id, room_version, result);
CREATE INDEX IF NOT EXISTS idx_room_runs_user_result
  ON room_runs (user_id, result);
CREATE INDEX IF NOT EXISTS idx_room_runs_room_coordinates
  ON room_runs (room_x, room_y);

CREATE TABLE IF NOT EXISTS user_stats (
  user_id TEXT PRIMARY KEY,
  user_display_name TEXT NOT NULL,
  total_score INTEGER NOT NULL DEFAULT 0,
  completed_runs INTEGER NOT NULL DEFAULT 0,
  failed_runs INTEGER NOT NULL DEFAULT 0,
  abandoned_runs INTEGER NOT NULL DEFAULT 0,
  best_score INTEGER NOT NULL DEFAULT 0,
  fastest_clear_ms INTEGER,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_stats_total_score
  ON user_stats (total_score DESC, completed_runs DESC);
