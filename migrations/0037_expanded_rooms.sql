CREATE TABLE IF NOT EXISTS expanded_rooms (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  owner_display_name TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'standalone_room',
  legacy_course_id TEXT UNIQUE,
  anchor_room_id TEXT NOT NULL,
  anchor_x INTEGER NOT NULL,
  anchor_y INTEGER NOT NULL,
  draft_json TEXT NOT NULL,
  published_json TEXT,
  draft_title TEXT,
  published_title TEXT,
  draft_version INTEGER NOT NULL DEFAULT 1,
  published_version INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  archived_at TEXT,
  FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_expanded_rooms_owner
  ON expanded_rooms (owner_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_expanded_rooms_anchor
  ON expanded_rooms (anchor_x, anchor_y);

CREATE TABLE IF NOT EXISTS expanded_room_versions (
  expanded_room_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL,
  published_by_user_id TEXT,
  published_by_display_name TEXT,
  legacy_course_id TEXT,
  legacy_course_version INTEGER,
  PRIMARY KEY (expanded_room_id, version),
  FOREIGN KEY (expanded_room_id) REFERENCES expanded_rooms (id) ON DELETE CASCADE,
  FOREIGN KEY (published_by_user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_expanded_room_versions_publisher
  ON expanded_room_versions (published_by_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS expanded_room_cells (
  expanded_room_id TEXT NOT NULL,
  expanded_room_version INTEGER NOT NULL,
  cell_order INTEGER NOT NULL,
  room_id TEXT NOT NULL,
  room_x INTEGER NOT NULL,
  room_y INTEGER NOT NULL,
  room_version INTEGER NOT NULL,
  room_title TEXT,
  protected_minted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (expanded_room_id, expanded_room_version, cell_order),
  UNIQUE (expanded_room_id, expanded_room_version, room_id),
  FOREIGN KEY (expanded_room_id, expanded_room_version)
    REFERENCES expanded_room_versions (expanded_room_id, version) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES rooms (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_expanded_room_cells_room
  ON expanded_room_cells (room_id, room_version);

CREATE INDEX IF NOT EXISTS idx_expanded_room_cells_coordinates
  ON expanded_room_cells (room_x, room_y);

CREATE TABLE IF NOT EXISTS expanded_room_runs (
  attempt_id TEXT PRIMARY KEY,
  expanded_room_id TEXT NOT NULL,
  expanded_room_version INTEGER NOT NULL,
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
  legacy_course_attempt_id TEXT UNIQUE,
  verification_status TEXT NOT NULL DEFAULT 'not_required',
  verification_reason TEXT,
  verification_nonce TEXT,
  verification_snapshot_hash TEXT,
  FOREIGN KEY (expanded_room_id, expanded_room_version)
    REFERENCES expanded_room_versions (expanded_room_id, version) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_expanded_room_runs_room_version_result
  ON expanded_room_runs (expanded_room_id, expanded_room_version, result);

CREATE INDEX IF NOT EXISTS idx_expanded_room_runs_user_result
  ON expanded_room_runs (user_id, result);

CREATE INDEX IF NOT EXISTS idx_expanded_room_runs_verification_status
  ON expanded_room_runs (verification_status, result, expanded_room_id, expanded_room_version);

CREATE TABLE IF NOT EXISTS expanded_room_ratings (
  expanded_room_id TEXT NOT NULL,
  lineage_key TEXT NOT NULL,
  version_key INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  quality_stars INTEGER,
  difficulty_choice TEXT,
  auto_difficulty_choice TEXT,
  trust_weight REAL NOT NULL DEFAULT 1,
  completed_attempt_id TEXT,
  first_rated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  rewarded_at TEXT,
  legacy_course_id TEXT,
  PRIMARY KEY (expanded_room_id, version_key, user_id),
  FOREIGN KEY (expanded_room_id, version_key)
    REFERENCES expanded_room_versions (expanded_room_id, version) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_expanded_room_ratings_room_version
  ON expanded_room_ratings (expanded_room_id, version_key, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_expanded_room_ratings_user
  ON expanded_room_ratings (user_id, updated_at DESC);

ALTER TABLE user_progress
  ADD COLUMN builder_expanded_room_cell_limit_override INTEGER;

INSERT OR IGNORE INTO expanded_rooms (
  id,
  owner_user_id,
  owner_display_name,
  source_type,
  legacy_course_id,
  anchor_room_id,
  anchor_x,
  anchor_y,
  draft_json,
  published_json,
  draft_title,
  published_title,
  draft_version,
  published_version,
  created_at,
  updated_at,
  published_at
)
WITH published_courses AS (
  SELECT *
  FROM courses
  WHERE published_json IS NOT NULL
    AND published_version IS NOT NULL
),
anchor_refs AS (
  SELECT
    c.id AS course_id,
    COALESCE(
      json_extract(c.published_json, '$.startPoint.roomId'),
      (
        SELECT room_id
        FROM course_room_refs refs
        WHERE refs.course_id = c.id
          AND refs.course_version = c.published_version
        ORDER BY refs.room_y ASC, refs.room_x ASC, refs.room_id ASC
        LIMIT 1
      )
    ) AS anchor_room_id
  FROM published_courses c
)
SELECT
  'course:' || c.id AS id,
  c.owner_user_id,
  c.owner_display_name,
  'legacy_course' AS source_type,
  c.id AS legacy_course_id,
  COALESCE(anchor.room_id, fallback.room_id) AS anchor_room_id,
  COALESCE(anchor.room_x, fallback.room_x) AS anchor_x,
  COALESCE(anchor.room_y, fallback.room_y) AS anchor_y,
  c.draft_json,
  c.published_json,
  c.draft_title,
  c.published_title,
  c.draft_version,
  c.published_version,
  c.created_at,
  c.updated_at,
  c.published_at
FROM published_courses c
JOIN anchor_refs anchor_ref
  ON anchor_ref.course_id = c.id
LEFT JOIN course_room_refs anchor
  ON anchor.course_id = c.id
 AND anchor.course_version = c.published_version
 AND anchor.room_id = anchor_ref.anchor_room_id
LEFT JOIN course_room_refs fallback
  ON fallback.course_id = c.id
 AND fallback.course_version = c.published_version
 AND fallback.room_order = (
   SELECT MIN(room_order)
   FROM course_room_refs refs
   WHERE refs.course_id = c.id
     AND refs.course_version = c.published_version
 );

INSERT OR IGNORE INTO expanded_room_versions (
  expanded_room_id,
  version,
  snapshot_json,
  title,
  created_at,
  published_by_user_id,
  published_by_display_name,
  legacy_course_id,
  legacy_course_version
)
SELECT
  'course:' || course_id AS expanded_room_id,
  version,
  snapshot_json,
  title,
  created_at,
  published_by_user_id,
  published_by_display_name,
  course_id AS legacy_course_id,
  version AS legacy_course_version
FROM course_versions
WHERE EXISTS (
  SELECT 1
  FROM courses c
  WHERE c.id = course_versions.course_id
    AND c.published_json IS NOT NULL
);

INSERT OR IGNORE INTO expanded_room_cells (
  expanded_room_id,
  expanded_room_version,
  cell_order,
  room_id,
  room_x,
  room_y,
  room_version,
  room_title,
  protected_minted
)
SELECT
  'course:' || refs.course_id AS expanded_room_id,
  refs.course_version AS expanded_room_version,
  refs.room_order AS cell_order,
  refs.room_id,
  refs.room_x,
  refs.room_y,
  refs.room_version,
  refs.room_title,
  CASE WHEN rooms.minted_token_id IS NOT NULL THEN 1 ELSE 0 END AS protected_minted
FROM course_room_refs refs
JOIN courses c
  ON c.id = refs.course_id
 AND c.published_json IS NOT NULL
LEFT JOIN rooms
  ON rooms.id = refs.room_id;

INSERT OR IGNORE INTO expanded_room_runs (
  attempt_id,
  expanded_room_id,
  expanded_room_version,
  goal_type,
  goal_json,
  user_id,
  user_display_name,
  started_at,
  finished_at,
  result,
  elapsed_ms,
  deaths,
  score,
  collectibles_collected,
  enemies_defeated,
  checkpoints_reached,
  legacy_course_attempt_id,
  verification_status,
  verification_reason,
  verification_nonce,
  verification_snapshot_hash
)
SELECT
  attempt_id,
  'course:' || course_id,
  course_version,
  goal_type,
  goal_json,
  user_id,
  user_display_name,
  started_at,
  finished_at,
  result,
  elapsed_ms,
  deaths,
  score,
  collectibles_collected,
  enemies_defeated,
  checkpoints_reached,
  attempt_id,
  verification_status,
  verification_reason,
  verification_nonce,
  verification_snapshot_hash
FROM course_runs
WHERE EXISTS (
  SELECT 1
  FROM expanded_room_versions version
  WHERE version.expanded_room_id = 'course:' || course_runs.course_id
    AND version.version = course_runs.course_version
);

INSERT OR IGNORE INTO expanded_room_ratings (
  expanded_room_id,
  lineage_key,
  version_key,
  user_id,
  quality_stars,
  difficulty_choice,
  auto_difficulty_choice,
  trust_weight,
  completed_attempt_id,
  first_rated_at,
  updated_at,
  rewarded_at,
  legacy_course_id
)
SELECT
  'course:' || course_id,
  lineage_key,
  version_key,
  user_id,
  quality_stars,
  difficulty_choice,
  auto_difficulty_choice,
  trust_weight,
  completed_attempt_id,
  first_rated_at,
  updated_at,
  rewarded_at,
  course_id
FROM course_ratings
WHERE EXISTS (
  SELECT 1
  FROM expanded_room_versions version
  WHERE version.expanded_room_id = 'course:' || course_ratings.course_id
    AND version.version = course_ratings.version_key
);

INSERT OR IGNORE INTO content_trophies (
  content_type,
  content_id,
  version_key,
  trophy_type,
  metric_value,
  weighted_vote_count,
  awarded_at
)
SELECT
  'expanded_room',
  'course:' || content_id,
  version_key,
  trophy_type,
  metric_value,
  weighted_vote_count,
  awarded_at
FROM content_trophies legacy_course_trophies
WHERE content_type = 'course'
  AND EXISTS (
    SELECT 1
    FROM expanded_room_versions version
    WHERE version.expanded_room_id = 'course:' || legacy_course_trophies.content_id
      AND version.version = legacy_course_trophies.version_key
  );
