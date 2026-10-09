CREATE TABLE room_rush_weeks (
  week_key TEXT PRIMARY KEY,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  start_room_id TEXT NOT NULL,
  start_x INTEGER NOT NULL,
  start_y INTEGER NOT NULL,
  room_version INTEGER NOT NULL CHECK (room_version > 0),
  room_title TEXT NOT NULL,
  locked_at TEXT,
  updated_at TEXT NOT NULL
);

ALTER TABLE room_rush_run_starts ADD COLUMN event_week TEXT;
ALTER TABLE room_rush_runs ADD COLUMN event_week TEXT;

CREATE INDEX idx_room_rush_runs_week_rank ON room_rush_runs (
  event_week, difficulty, start_rule, unique_rooms DESC, elapsed_ms ASC,
  deaths ASC, finished_at ASC
);
CREATE INDEX idx_room_rush_starts_week ON room_rush_run_starts (event_week, started_at);
