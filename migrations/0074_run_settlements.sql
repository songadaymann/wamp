-- F351: a signed-in ranked finish can be resent after a dropped reply. The finish's reward step
-- writes its attempt here last; a recent resend re-runs that step only when the row is missing.
CREATE TABLE IF NOT EXISTS run_settlements (
  attempt_kind TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  settled_at TEXT NOT NULL,
  PRIMARY KEY (attempt_kind, attempt_id)
);

-- Finishes that were already rewarded before this table existed count as settled.
INSERT OR IGNORE INTO run_settlements (attempt_kind, attempt_id, settled_at)
  SELECT 'room', r.attempt_id, e.created_at
  FROM room_runs r
  JOIN point_events e ON e.event_type = 'run_finalized' AND e.source_key = r.attempt_id;
INSERT OR IGNORE INTO run_settlements (attempt_kind, attempt_id, settled_at)
  SELECT 'course', c.attempt_id, e.created_at
  FROM course_runs c
  JOIN point_events e ON e.event_type = 'run_finalized' AND e.source_key = c.attempt_id;
INSERT OR IGNORE INTO run_settlements (attempt_kind, attempt_id, settled_at)
  SELECT 'expanded_room', x.attempt_id, e.created_at
  FROM expanded_room_runs x
  JOIN point_events e ON e.event_type = 'run_finalized' AND e.source_key = x.attempt_id;

-- An unmerged draft kept that marker as a 0-point point event; none should remain.
DELETE FROM point_events WHERE event_type = 'run_settled' AND points = 0;

-- The order finalizes commit in, per table. First-clear and personal-best checks compare by it,
-- because the server's finish time is taken before verification and so does not follow commits.
-- Runs finalized before this column have none and count as earlier than every numbered run.
ALTER TABLE room_runs ADD COLUMN finalize_seq INTEGER;
ALTER TABLE course_runs ADD COLUMN finalize_seq INTEGER;
ALTER TABLE expanded_room_runs ADD COLUMN finalize_seq INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_room_runs_finalize_seq
  ON room_runs (finalize_seq) WHERE finalize_seq IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_course_runs_finalize_seq
  ON course_runs (finalize_seq) WHERE finalize_seq IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_expanded_room_runs_finalize_seq
  ON expanded_room_runs (finalize_seq) WHERE finalize_seq IS NOT NULL;
