-- One first completion sample per player/version; later attempts only refresh recency.
CREATE TABLE discovery_run_players (
  target_key TEXT NOT NULL,
  version_key INTEGER NOT NULL CHECK (version_key > 0),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  difficulty_choice TEXT CHECK (difficulty_choice IN ('easy', 'medium', 'hard', 'extreme')),
  sampled_at TEXT,
  last_played_at TEXT NOT NULL,
  PRIMARY KEY (target_key, version_key, user_id),
  CHECK ((difficulty_choice IS NULL) = (sampled_at IS NULL))
);
CREATE INDEX idx_discovery_run_players_recent
  ON discovery_run_players(target_key, version_key, last_played_at, user_id);

INSERT INTO discovery_run_players (target_key, version_key, user_id, difficulty_choice, sampled_at, last_played_at)
WITH outcomes AS (
    SELECT 'room:' || room_id AS target_key, room_version AS version_key, user_id AS user_id,
      attempt_id, result, finished_at, COALESCE(elapsed_ms, 0) AS elapsed_ms, COALESCE(deaths, 0) AS deaths, COALESCE(collectibles_collected, 0) AS collectibles_collected, COALESCE(enemies_defeated, 0) AS enemies_defeated, COALESCE(checkpoints_reached, 0) AS checkpoints_reached
    FROM room_runs WHERE result IN ('completed', 'failed') AND COALESCE(verification_status, 'not_required') IN ('not_required', 'passed') AND finished_at IS NOT NULL
    UNION ALL
    SELECT 'expanded_room:' || expanded_room_id AS target_key, expanded_room_version AS version_key, user_id AS user_id,
      attempt_id, result, finished_at, COALESCE(elapsed_ms, 0) AS elapsed_ms, COALESCE(deaths, 0) AS deaths, COALESCE(collectibles_collected, 0) AS collectibles_collected, COALESCE(enemies_defeated, 0) AS enemies_defeated, COALESCE(checkpoints_reached, 0) AS checkpoints_reached
    FROM expanded_room_runs WHERE result IN ('completed', 'failed') AND COALESCE(verification_status, 'not_required') IN ('not_required', 'passed') AND finished_at IS NOT NULL
    UNION ALL
    SELECT 'expanded_room:course:' || course_id AS target_key, course_version AS version_key, user_id AS user_id,
      attempt_id, result, finished_at, COALESCE(elapsed_ms, 0) AS elapsed_ms, COALESCE(deaths, 0) AS deaths, COALESCE(collectibles_collected, 0) AS collectibles_collected, COALESCE(enemies_defeated, 0) AS enemies_defeated, COALESCE(checkpoints_reached, 0) AS checkpoints_reached
    FROM course_runs WHERE result IN ('completed', 'failed') AND COALESCE(verification_status, 'not_required') IN ('not_required', 'passed') AND finished_at IS NOT NULL
    UNION ALL
    SELECT CASE content_type WHEN 'course' THEN 'expanded_room:course:' || content_id ELSE content_type || ':' || content_id END AS target_key, content_version AS version_key, claimed_user_id AS user_id,
      attempt_id, result, finished_at, COALESCE(json_extract(metrics_json, '$.elapsedMs'), 0) AS elapsed_ms, COALESCE(json_extract(metrics_json, '$.deaths'), 0) AS deaths, COALESCE(json_extract(metrics_json, '$.collectiblesCollected'), 0) AS collectibles_collected, COALESCE(json_extract(metrics_json, '$.enemiesDefeated'), 0) AS enemies_defeated, COALESCE(json_extract(metrics_json, '$.checkpointsReached'), 0) AS checkpoints_reached
    FROM guest_run_attempts WHERE claimed_user_id IS NOT NULL AND result = 'completed' AND verification_status = 'passed' AND json_valid(metrics_json) AND finished_at IS NOT NULL
), ranked AS (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY target_key, version_key, user_id
    ORDER BY (result = 'completed') DESC, finished_at ASC, attempt_id ASC
  ) AS sample_order,
  MAX(finished_at) OVER (PARTITION BY target_key, version_key, user_id) AS last_played_at
  FROM outcomes WHERE EXISTS (SELECT 1 FROM users WHERE users.id = outcomes.user_id)
), scored AS (
  SELECT *, MAX(0, elapsed_ms) / 60000.0 * 0.85 + MAX(0, deaths) * 1.35
    + MIN(MAX(0, collectibles_collected), 10) * 0.08
    + MIN(MAX(0, enemies_defeated), 8) * 0.1
    + MIN(MAX(0, checkpoints_reached), 5) * 0.14 AS difficulty_score
  FROM ranked WHERE sample_order = 1
)
SELECT target_key, version_key, user_id,
  CASE WHEN result <> 'completed' THEN NULL
    WHEN difficulty_score < 0.9 THEN 'easy'
    WHEN difficulty_score < 2.6 THEN 'medium'
    WHEN difficulty_score < 5.4 THEN 'hard'
    ELSE 'extreme' END,
  CASE WHEN result = 'completed' THEN finished_at ELSE NULL END,
  last_played_at FROM scored;

-- Feature the reviewed target version, including expanded assemblies.
ALTER TABLE featured_rooms ADD COLUMN target_key TEXT;
ALTER TABLE featured_rooms ADD COLUMN target_version INTEGER;
UPDATE featured_rooms AS featured SET
  target_key = COALESCE((
    SELECT member.target_key FROM playable_content_index_members member
    WHERE member.room_id = featured.room_id AND member.room_version = featured.room_version LIMIT 1
  ), 'room:' || featured.room_id),
  target_version = COALESCE((
    SELECT target.version_key FROM playable_content_index_members member
    INNER JOIN playable_content_index target ON target.target_key = member.target_key
    WHERE member.room_id = featured.room_id AND member.room_version = featured.room_version LIMIT 1
  ), featured.room_version);
UPDATE playable_content_index AS target SET featured_at = (
  SELECT MAX(featured.featured_at) FROM featured_rooms featured
  WHERE featured.target_key = target.target_key AND featured.target_version = target.version_key
    AND (
      (target.target_type = 'room' AND featured.room_id = target.content_id AND featured.room_version = target.version_key)
      OR (target.target_type = 'expanded_room' AND EXISTS (
        SELECT 1 FROM playable_content_index_members member
        WHERE member.target_key = target.target_key AND member.room_id = featured.room_id
          AND member.room_version = featured.room_version
      ))
    )
);
