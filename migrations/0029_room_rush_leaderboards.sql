CREATE TABLE IF NOT EXISTS room_rush_runs (
  attempt_id TEXT PRIMARY KEY,
  client_run_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_display_name TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  start_rule TEXT NOT NULL,
  result TEXT NOT NULL,
  unique_rooms INTEGER NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  deaths INTEGER NOT NULL DEFAULT 0,
  start_room_id TEXT NOT NULL,
  start_x INTEGER NOT NULL,
  start_y INTEGER NOT NULL,
  finish_room_id TEXT NOT NULL,
  finish_x INTEGER NOT NULL,
  finish_y INTEGER NOT NULL,
  route_json TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  UNIQUE (user_id, client_run_id)
);

CREATE INDEX IF NOT EXISTS idx_room_rush_runs_mode_rank
  ON room_rush_runs (
    difficulty,
    start_rule,
    unique_rooms DESC,
    elapsed_ms ASC,
    deaths ASC,
    finished_at ASC
  );

CREATE INDEX IF NOT EXISTS idx_room_rush_runs_user_mode
  ON room_rush_runs (user_id, difficulty, start_rule);
