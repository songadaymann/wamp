CREATE TABLE IF NOT EXISTS daily_rooms (
  date TEXT PRIMARY KEY,
  target_key TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('room', 'expanded_room')),
  content_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  room_id TEXT NOT NULL,
  room_version INTEGER NOT NULL,
  room_x INTEGER NOT NULL,
  room_y INTEGER NOT NULL,
  title TEXT NOT NULL,
  builder_user_id TEXT NOT NULL,
  builder_display_name TEXT NOT NULL,
  goal_json TEXT NOT NULL,
  cell_count INTEGER NOT NULL,
  legacy_course_id TEXT,
  picked_by TEXT NOT NULL CHECK (picked_by IN ('automatic', 'admin')),
  picked_at TEXT NOT NULL,
  notice_sent_at TEXT,
  notice_attempts INTEGER NOT NULL DEFAULT 0,
  notice_lease_token TEXT,
  notice_lease_until TEXT,
  notice_last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_daily_rooms_target_date ON daily_rooms (target_key, date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_rooms_builder_date ON daily_rooms (builder_user_id, date DESC);

ALTER TABLE builder_activity_preferences ADD COLUMN daily_features INTEGER NOT NULL DEFAULT 0 CHECK (daily_features IN (0, 1));
ALTER TABLE builder_activity_preferences ADD COLUMN daily_enabled_at TEXT;

CREATE INDEX IF NOT EXISTS idx_room_runs_daily ON room_runs (room_id, room_version, finished_at)
  WHERE result = 'completed';
CREATE INDEX IF NOT EXISTS idx_expanded_runs_daily ON expanded_room_runs (expanded_room_id, expanded_room_version, finished_at)
  WHERE result = 'completed';
CREATE INDEX IF NOT EXISTS idx_course_runs_daily ON course_runs (course_id, course_version, finished_at)
  WHERE result = 'completed';
