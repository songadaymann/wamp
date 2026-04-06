ALTER TABLE room_runs
  ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'not_required';
ALTER TABLE room_runs
  ADD COLUMN verification_reason TEXT;
ALTER TABLE room_runs
  ADD COLUMN verification_nonce TEXT;
ALTER TABLE room_runs
  ADD COLUMN verification_snapshot_hash TEXT;

ALTER TABLE course_runs
  ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'not_required';
ALTER TABLE course_runs
  ADD COLUMN verification_reason TEXT;
ALTER TABLE course_runs
  ADD COLUMN verification_nonce TEXT;
ALTER TABLE course_runs
  ADD COLUMN verification_snapshot_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_room_runs_verification_status
  ON room_runs (verification_status, result, room_id, room_version);

CREATE INDEX IF NOT EXISTS idx_course_runs_verification_status
  ON course_runs (verification_status, result, course_id, course_version);

CREATE TABLE IF NOT EXISTS run_verification_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id TEXT NOT NULL,
  run_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  trigger_reason TEXT NOT NULL,
  verification_reason TEXT,
  summary_json TEXT NOT NULL,
  trace_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_verification_audit_created_at
  ON run_verification_audit (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_run_verification_audit_attempt_id
  ON run_verification_audit (attempt_id);
