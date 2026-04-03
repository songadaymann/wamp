ALTER TABLE room_runs ADD COLUMN is_held INTEGER NOT NULL DEFAULT 0;
ALTER TABLE room_runs ADD COLUMN held_at TEXT;
ALTER TABLE room_runs ADD COLUMN hold_reason TEXT;

ALTER TABLE course_runs ADD COLUMN is_held INTEGER NOT NULL DEFAULT 0;
ALTER TABLE course_runs ADD COLUMN held_at TEXT;
ALTER TABLE course_runs ADD COLUMN hold_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_room_runs_room_version_result_hold
  ON room_runs (room_id, room_version, result, is_held);
CREATE INDEX IF NOT EXISTS idx_room_runs_user_result_hold
  ON room_runs (user_id, result, is_held);

CREATE INDEX IF NOT EXISTS idx_course_runs_course_version_result_hold
  ON course_runs (course_id, course_version, result, is_held);
CREATE INDEX IF NOT EXISTS idx_course_runs_user_result_hold
  ON course_runs (user_id, result, is_held);
