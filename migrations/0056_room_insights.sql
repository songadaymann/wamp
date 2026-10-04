-- Durable, private per-attempt projection. Public routes expose aggregates only.
-- Unplayed starts are excluded; clears must have accepted server verification.
-- Death locations are new, optional and capped at 50 by the finalization owner.
ALTER TABLE room_runs ADD COLUMN insight_deaths_json TEXT;
ALTER TABLE room_runs ADD COLUMN insight_play_ms INTEGER;
ALTER TABLE expanded_room_runs ADD COLUMN insight_deaths_json TEXT;
ALTER TABLE expanded_room_runs ADD COLUMN insight_play_ms INTEGER;
ALTER TABLE course_runs ADD COLUMN insight_deaths_json TEXT;
ALTER TABLE course_runs ADD COLUMN insight_play_ms INTEGER;
ALTER TABLE guest_run_attempts ADD COLUMN insight_deaths_json TEXT;
CREATE TABLE room_insight_attempts (
  attempt_key TEXT PRIMARY KEY,
  target_key TEXT NOT NULL,
  version_key INTEGER NOT NULL,
  player_key TEXT NOT NULL,
  user_id TEXT,
  guest_user_id TEXT,
  result TEXT NOT NULL CHECK (result IN ('completed','failed','abandoned')),
  elapsed_ms INTEGER NOT NULL,
  deaths INTEGER NOT NULL,
  finished_at TEXT NOT NULL,
  death_positions_json TEXT
);
CREATE INDEX idx_room_insights_target_version ON room_insight_attempts(target_key,version_key,result);
CREATE INDEX idx_room_insights_guest ON room_insight_attempts(guest_user_id) WHERE guest_user_id IS NOT NULL;

INSERT OR IGNORE INTO room_insight_attempts (attempt_key, target_key, version_key, player_key, user_id, guest_user_id, result, elapsed_ms, deaths, finished_at, death_positions_json)
SELECT 'expanded:' || r.attempt_id, 'expanded_room:' || r.expanded_room_id, r.expanded_room_version, 'u:' || r.user_id, r.user_id, NULL, r.result, COALESCE(r.insight_play_ms,r.elapsed_ms), MAX(0, r.deaths), r.finished_at, r.insight_deaths_json FROM expanded_room_runs r WHERE r.finished_at IS NOT NULL AND COALESCE(r.insight_play_ms,r.elapsed_ms) > 0 AND (r.result IN ('failed','abandoned') OR (r.result = 'completed' AND COALESCE(r.verification_status,'not_required') IN ('passed','not_required'))) ;
CREATE TRIGGER room_insights_expanded_room_insert AFTER INSERT ON expanded_room_runs BEGIN
  DELETE FROM room_insight_attempts WHERE attempt_key = 'expanded:' || NEW.attempt_id;
  DELETE FROM room_insight_attempts WHERE attempt_key = 'course:' || NEW.attempt_id;
  INSERT OR REPLACE INTO room_insight_attempts (attempt_key, target_key, version_key, player_key, user_id, guest_user_id, result, elapsed_ms, deaths, finished_at, death_positions_json)
  SELECT 'expanded:' || r.attempt_id, 'expanded_room:' || r.expanded_room_id, r.expanded_room_version, 'u:' || r.user_id, r.user_id, NULL, r.result, COALESCE(r.insight_play_ms,r.elapsed_ms), MAX(0, r.deaths), r.finished_at, r.insight_deaths_json FROM expanded_room_runs r WHERE r.finished_at IS NOT NULL AND COALESCE(r.insight_play_ms,r.elapsed_ms) > 0 AND (r.result IN ('failed','abandoned') OR (r.result = 'completed' AND COALESCE(r.verification_status,'not_required') IN ('passed','not_required')))  AND r.attempt_id = NEW.attempt_id;
END;
CREATE TRIGGER room_insights_expanded_room_update AFTER UPDATE ON expanded_room_runs BEGIN
  DELETE FROM room_insight_attempts WHERE attempt_key = 'expanded:' || NEW.attempt_id;
  DELETE FROM room_insight_attempts WHERE attempt_key = 'course:' || NEW.attempt_id;
  INSERT OR REPLACE INTO room_insight_attempts (attempt_key, target_key, version_key, player_key, user_id, guest_user_id, result, elapsed_ms, deaths, finished_at, death_positions_json)
  SELECT 'expanded:' || r.attempt_id, 'expanded_room:' || r.expanded_room_id, r.expanded_room_version, 'u:' || r.user_id, r.user_id, NULL, r.result, COALESCE(r.insight_play_ms,r.elapsed_ms), MAX(0, r.deaths), r.finished_at, r.insight_deaths_json FROM expanded_room_runs r WHERE r.finished_at IS NOT NULL AND COALESCE(r.insight_play_ms,r.elapsed_ms) > 0 AND (r.result IN ('failed','abandoned') OR (r.result = 'completed' AND COALESCE(r.verification_status,'not_required') IN ('passed','not_required')))  AND r.attempt_id = NEW.attempt_id;
END;

INSERT OR IGNORE INTO room_insight_attempts (attempt_key, target_key, version_key, player_key, user_id, guest_user_id, result, elapsed_ms, deaths, finished_at, death_positions_json)
SELECT 'room:' || r.attempt_id, 'room:' || r.room_id, r.room_version, 'u:' || r.user_id, r.user_id, NULL, r.result, COALESCE(r.insight_play_ms,r.elapsed_ms), MAX(0, r.deaths), r.finished_at, r.insight_deaths_json FROM room_runs r WHERE r.finished_at IS NOT NULL AND COALESCE(r.insight_play_ms,r.elapsed_ms) > 0 AND (r.result IN ('failed','abandoned') OR (r.result = 'completed' AND COALESCE(r.verification_status,'not_required') IN ('passed','not_required'))) ;
CREATE TRIGGER room_insights_room_insert AFTER INSERT ON room_runs BEGIN
  DELETE FROM room_insight_attempts WHERE attempt_key = 'room:' || NEW.attempt_id;
  INSERT OR REPLACE INTO room_insight_attempts (attempt_key, target_key, version_key, player_key, user_id, guest_user_id, result, elapsed_ms, deaths, finished_at, death_positions_json)
  SELECT 'room:' || r.attempt_id, 'room:' || r.room_id, r.room_version, 'u:' || r.user_id, r.user_id, NULL, r.result, COALESCE(r.insight_play_ms,r.elapsed_ms), MAX(0, r.deaths), r.finished_at, r.insight_deaths_json FROM room_runs r WHERE r.finished_at IS NOT NULL AND COALESCE(r.insight_play_ms,r.elapsed_ms) > 0 AND (r.result IN ('failed','abandoned') OR (r.result = 'completed' AND COALESCE(r.verification_status,'not_required') IN ('passed','not_required')))  AND r.attempt_id = NEW.attempt_id;
END;
CREATE TRIGGER room_insights_room_update AFTER UPDATE ON room_runs BEGIN
  DELETE FROM room_insight_attempts WHERE attempt_key = 'room:' || NEW.attempt_id;
  INSERT OR REPLACE INTO room_insight_attempts (attempt_key, target_key, version_key, player_key, user_id, guest_user_id, result, elapsed_ms, deaths, finished_at, death_positions_json)
  SELECT 'room:' || r.attempt_id, 'room:' || r.room_id, r.room_version, 'u:' || r.user_id, r.user_id, NULL, r.result, COALESCE(r.insight_play_ms,r.elapsed_ms), MAX(0, r.deaths), r.finished_at, r.insight_deaths_json FROM room_runs r WHERE r.finished_at IS NOT NULL AND COALESCE(r.insight_play_ms,r.elapsed_ms) > 0 AND (r.result IN ('failed','abandoned') OR (r.result = 'completed' AND COALESCE(r.verification_status,'not_required') IN ('passed','not_required')))  AND r.attempt_id = NEW.attempt_id;
END;

INSERT OR IGNORE INTO room_insight_attempts (attempt_key, target_key, version_key, player_key, user_id, guest_user_id, result, elapsed_ms, deaths, finished_at, death_positions_json)
SELECT 'course:' || r.attempt_id, 'expanded_room:' || COALESCE((SELECT id FROM expanded_rooms WHERE legacy_course_id = r.course_id), 'course:' || r.course_id), r.course_version, 'u:' || r.user_id, r.user_id, NULL, r.result, COALESCE(r.insight_play_ms,r.elapsed_ms), MAX(0, r.deaths), r.finished_at, r.insight_deaths_json FROM course_runs r WHERE r.finished_at IS NOT NULL AND COALESCE(r.insight_play_ms,r.elapsed_ms) > 0 AND (r.result IN ('failed','abandoned') OR (r.result = 'completed' AND COALESCE(r.verification_status,'not_required') IN ('passed','not_required'))) AND NOT EXISTS (SELECT 1 FROM expanded_room_runs e WHERE e.attempt_id = r.attempt_id);
CREATE TRIGGER room_insights_course_insert AFTER INSERT ON course_runs BEGIN
  DELETE FROM room_insight_attempts WHERE attempt_key = 'course:' || NEW.attempt_id;
  INSERT OR REPLACE INTO room_insight_attempts (attempt_key, target_key, version_key, player_key, user_id, guest_user_id, result, elapsed_ms, deaths, finished_at, death_positions_json)
  SELECT 'course:' || r.attempt_id, 'expanded_room:' || COALESCE((SELECT id FROM expanded_rooms WHERE legacy_course_id = r.course_id), 'course:' || r.course_id), r.course_version, 'u:' || r.user_id, r.user_id, NULL, r.result, COALESCE(r.insight_play_ms,r.elapsed_ms), MAX(0, r.deaths), r.finished_at, r.insight_deaths_json FROM course_runs r WHERE r.finished_at IS NOT NULL AND COALESCE(r.insight_play_ms,r.elapsed_ms) > 0 AND (r.result IN ('failed','abandoned') OR (r.result = 'completed' AND COALESCE(r.verification_status,'not_required') IN ('passed','not_required'))) AND NOT EXISTS (SELECT 1 FROM expanded_room_runs e WHERE e.attempt_id = r.attempt_id) AND r.attempt_id = NEW.attempt_id;
END;
CREATE TRIGGER room_insights_course_update AFTER UPDATE ON course_runs BEGIN
  DELETE FROM room_insight_attempts WHERE attempt_key = 'course:' || NEW.attempt_id;
  INSERT OR REPLACE INTO room_insight_attempts (attempt_key, target_key, version_key, player_key, user_id, guest_user_id, result, elapsed_ms, deaths, finished_at, death_positions_json)
  SELECT 'course:' || r.attempt_id, 'expanded_room:' || COALESCE((SELECT id FROM expanded_rooms WHERE legacy_course_id = r.course_id), 'course:' || r.course_id), r.course_version, 'u:' || r.user_id, r.user_id, NULL, r.result, COALESCE(r.insight_play_ms,r.elapsed_ms), MAX(0, r.deaths), r.finished_at, r.insight_deaths_json FROM course_runs r WHERE r.finished_at IS NOT NULL AND COALESCE(r.insight_play_ms,r.elapsed_ms) > 0 AND (r.result IN ('failed','abandoned') OR (r.result = 'completed' AND COALESCE(r.verification_status,'not_required') IN ('passed','not_required'))) AND NOT EXISTS (SELECT 1 FROM expanded_room_runs e WHERE e.attempt_id = r.attempt_id) AND r.attempt_id = NEW.attempt_id;
END;

INSERT OR IGNORE INTO room_insight_attempts (attempt_key, target_key, version_key, player_key, user_id, guest_user_id, result, elapsed_ms, deaths, finished_at, death_positions_json)
SELECT 'guest:' || r.attempt_id, CASE r.content_type WHEN 'room' THEN 'room:' || r.content_id WHEN 'expanded_room' THEN 'expanded_room:' || r.content_id ELSE 'expanded_room:' || COALESCE((SELECT id FROM expanded_rooms WHERE legacy_course_id = r.content_id), 'course:' || r.content_id) END, r.content_version, CASE WHEN r.claimed_user_id IS NOT NULL THEN 'u:' || r.claimed_user_id ELSE 'g:' || r.guest_user_id END, r.claimed_user_id, r.guest_user_id, r.result, json_extract(r.metrics_json, '$.elapsedMs'), MAX(0, json_extract(r.metrics_json, '$.deaths')), r.finished_at, r.insight_deaths_json FROM guest_run_attempts r WHERE r.finished_at IS NOT NULL AND json_extract(r.metrics_json, '$.elapsedMs') > 0 AND (r.result IN ('failed','abandoned') OR (r.result = 'completed' AND r.verification_status = 'passed')) ;
CREATE TRIGGER room_insights_guest_insert AFTER INSERT ON guest_run_attempts BEGIN
  DELETE FROM room_insight_attempts WHERE attempt_key = 'guest:' || NEW.attempt_id;
  INSERT OR REPLACE INTO room_insight_attempts (attempt_key, target_key, version_key, player_key, user_id, guest_user_id, result, elapsed_ms, deaths, finished_at, death_positions_json)
  SELECT 'guest:' || r.attempt_id, CASE r.content_type WHEN 'room' THEN 'room:' || r.content_id WHEN 'expanded_room' THEN 'expanded_room:' || r.content_id ELSE 'expanded_room:' || COALESCE((SELECT id FROM expanded_rooms WHERE legacy_course_id = r.content_id), 'course:' || r.content_id) END, r.content_version, CASE WHEN r.claimed_user_id IS NOT NULL THEN 'u:' || r.claimed_user_id ELSE 'g:' || r.guest_user_id END, r.claimed_user_id, r.guest_user_id, r.result, json_extract(r.metrics_json, '$.elapsedMs'), MAX(0, json_extract(r.metrics_json, '$.deaths')), r.finished_at, r.insight_deaths_json FROM guest_run_attempts r WHERE r.finished_at IS NOT NULL AND json_extract(r.metrics_json, '$.elapsedMs') > 0 AND (r.result IN ('failed','abandoned') OR (r.result = 'completed' AND r.verification_status = 'passed'))  AND r.attempt_id = NEW.attempt_id;
END;
CREATE TRIGGER room_insights_guest_update AFTER UPDATE ON guest_run_attempts BEGIN
  DELETE FROM room_insight_attempts WHERE attempt_key = 'guest:' || NEW.attempt_id;
  INSERT OR REPLACE INTO room_insight_attempts (attempt_key, target_key, version_key, player_key, user_id, guest_user_id, result, elapsed_ms, deaths, finished_at, death_positions_json)
  SELECT 'guest:' || r.attempt_id, CASE r.content_type WHEN 'room' THEN 'room:' || r.content_id WHEN 'expanded_room' THEN 'expanded_room:' || r.content_id ELSE 'expanded_room:' || COALESCE((SELECT id FROM expanded_rooms WHERE legacy_course_id = r.content_id), 'course:' || r.content_id) END, r.content_version, CASE WHEN r.claimed_user_id IS NOT NULL THEN 'u:' || r.claimed_user_id ELSE 'g:' || r.guest_user_id END, r.claimed_user_id, r.guest_user_id, r.result, json_extract(r.metrics_json, '$.elapsedMs'), MAX(0, json_extract(r.metrics_json, '$.deaths')), r.finished_at, r.insight_deaths_json FROM guest_run_attempts r WHERE r.finished_at IS NOT NULL AND json_extract(r.metrics_json, '$.elapsedMs') > 0 AND (r.result IN ('failed','abandoned') OR (r.result = 'completed' AND r.verification_status = 'passed'))  AND r.attempt_id = NEW.attempt_id;
END;

-- Link all retained attempts from a known guest identity to the account, without
-- adding a replay. This also merges that guest into the account's unique count.
CREATE TRIGGER room_insights_guest_claim AFTER UPDATE OF claimed_user_id ON guest_run_attempts
WHEN NEW.claimed_user_id IS NOT NULL BEGIN
  UPDATE room_insight_attempts SET user_id = NEW.claimed_user_id, player_key = 'u:' || NEW.claimed_user_id
  WHERE guest_user_id = NEW.guest_user_id AND user_id IS NULL;
END;
