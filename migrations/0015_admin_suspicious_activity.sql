CREATE TABLE IF NOT EXISTS admin_suspicious_invalidation_audit (
  id TEXT PRIMARY KEY,
  target_user_id TEXT NOT NULL,
  target_user_display_name TEXT NOT NULL,
  operator_label TEXT NOT NULL,
  reason TEXT NOT NULL,
  room_run_attempt_ids_json TEXT NOT NULL,
  course_run_attempt_ids_json TEXT NOT NULL,
  affected_point_event_ids_json TEXT NOT NULL,
  affected_playfun_sync_json TEXT NOT NULL,
  affected_creator_user_ids_json TEXT NOT NULL,
  remote_follow_up_required INTEGER NOT NULL DEFAULT 0,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (target_user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_suspicious_audit_created
  ON admin_suspicious_invalidation_audit (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_suspicious_audit_target_user
  ON admin_suspicious_invalidation_audit (target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_room_runs_finished_result_user
  ON room_runs (finished_at DESC, result, user_id);

CREATE INDEX IF NOT EXISTS idx_course_runs_finished_result_user
  ON course_runs (finished_at DESC, result, user_id);

CREATE INDEX IF NOT EXISTS idx_point_events_created_user
  ON point_events (created_at DESC, user_id);
