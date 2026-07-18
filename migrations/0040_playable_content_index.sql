CREATE TABLE IF NOT EXISTS playable_content_index (
  target_key TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('room', 'expanded_room')),
  content_id TEXT NOT NULL,
  version_key INTEGER NOT NULL,
  representative_room_id TEXT NOT NULL,
  room_x INTEGER NOT NULL,
  room_y INTEGER NOT NULL,
  builder_user_id TEXT,
  builder_display_name TEXT,
  title TEXT,
  goal_type TEXT,
  published_at TEXT NOT NULL,
  first_published_at TEXT NOT NULL,
  cell_count INTEGER NOT NULL DEFAULT 1,
  anchor_x INTEGER NOT NULL,
  anchor_y INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  legacy_course_id TEXT,
  canonical_room_version INTEGER,
  featured_at TEXT,
  quality_adjusted_average REAL,
  quality_vote_count INTEGER NOT NULL DEFAULT 0,
  consensus_difficulty TEXT,
  difficulty_vote_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE (target_type, content_id, version_key)
);

CREATE INDEX IF NOT EXISTS idx_playable_content_newest
  ON playable_content_index (published_at DESC, target_key ASC);

CREATE INDEX IF NOT EXISTS idx_playable_content_featured
  ON playable_content_index (featured_at DESC, published_at DESC, target_key ASC)
  WHERE featured_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_playable_content_quality
  ON playable_content_index (quality_adjusted_average DESC, quality_vote_count DESC, published_at DESC, target_key ASC);

CREATE INDEX IF NOT EXISTS idx_playable_content_difficulty
  ON playable_content_index (consensus_difficulty, published_at DESC, target_key ASC);

CREATE INDEX IF NOT EXISTS idx_playable_content_builder
  ON playable_content_index (builder_user_id, published_at DESC, target_key ASC);

CREATE TABLE IF NOT EXISTS playable_content_index_members (
  target_key TEXT NOT NULL,
  room_id TEXT NOT NULL,
  room_version INTEGER NOT NULL,
  PRIMARY KEY (target_key, room_id),
  FOREIGN KEY (target_key) REFERENCES playable_content_index (target_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_playable_content_members_room
  ON playable_content_index_members (room_id, target_key);

DELETE FROM playable_content_index_members;
DELETE FROM playable_content_index;

INSERT INTO playable_content_index (
  target_key, target_type, content_id, version_key, representative_room_id,
  room_x, room_y, builder_user_id, builder_display_name, title, goal_type,
  published_at, first_published_at, cell_count, anchor_x, anchor_y, source_type,
  legacy_course_id, canonical_room_version, featured_at,
  quality_adjusted_average, quality_vote_count, consensus_difficulty,
  difficulty_vote_count, updated_at
)
WITH room_rating_aggregates AS (
  SELECT
    room_id,
    version_key,
    SUM(CASE WHEN quality_stars IS NOT NULL THEN 1 ELSE 0 END) AS quality_vote_count,
    SUM(CASE WHEN quality_stars IS NOT NULL THEN quality_stars * trust_weight ELSE 0 END) AS weighted_quality_sum,
    SUM(CASE WHEN quality_stars IS NOT NULL THEN trust_weight ELSE 0 END) AS weighted_quality_votes,
    SUM(CASE WHEN difficulty_choice IS NOT NULL THEN 1 ELSE 0 END) AS difficulty_vote_count,
    SUM(CASE WHEN difficulty_choice = 'easy' THEN trust_weight ELSE 0 END) AS easy_weight,
    SUM(CASE WHEN difficulty_choice = 'medium' THEN trust_weight ELSE 0 END) AS medium_weight,
    SUM(CASE WHEN difficulty_choice = 'hard' THEN trust_weight ELSE 0 END) AS hard_weight,
    SUM(CASE WHEN difficulty_choice = 'extreme' THEN trust_weight ELSE 0 END) AS extreme_weight
  FROM room_ratings
  GROUP BY room_id, version_key
),
published_expanded_targets AS (
  SELECT expanded.id, expanded.published_version
  FROM expanded_rooms expanded
  INNER JOIN expanded_room_cells cells
    ON cells.expanded_room_id = expanded.id
   AND cells.expanded_room_version = expanded.published_version
  WHERE expanded.published_json IS NOT NULL
    AND expanded.published_version IS NOT NULL
    AND expanded.archived_at IS NULL
  GROUP BY expanded.id, expanded.published_version
  HAVING COUNT(cells.room_id) > 1
),
published_expanded_members AS (
  SELECT cells.room_id
  FROM published_expanded_targets targets
  INNER JOIN expanded_room_cells cells
    ON cells.expanded_room_id = targets.id
   AND cells.expanded_room_version = targets.published_version
)
SELECT
  'room:' || rooms.id,
  'room',
  rooms.id,
  CAST(json_extract(rooms.published_json, '$.version') AS INTEGER),
  rooms.id,
  rooms.x,
  rooms.y,
  rooms.last_published_by_user_id,
  rooms.last_published_by_display_name,
  COALESCE(rooms.published_title, json_extract(rooms.published_json, '$.title')),
  json_extract(rooms.published_json, '$.goal.type'),
  COALESCE(json_extract(rooms.published_json, '$.publishedAt'), versions.created_at),
  COALESCE(first_versions.first_published_at, versions.created_at),
  1,
  rooms.x,
  rooms.y,
  'standalone_room',
  NULL,
  rooms.canonical_version,
  featured.featured_at,
  CASE
    WHEN ratings.weighted_quality_votes > 0
      THEN ROUND(((3.5 * 5) + ratings.weighted_quality_sum) / (5 + ratings.weighted_quality_votes), 3)
    ELSE NULL
  END,
  COALESCE(ratings.quality_vote_count, 0),
  CASE
    WHEN COALESCE(ratings.difficulty_vote_count, 0) = 0 THEN NULL
    WHEN ratings.extreme_weight >= ratings.hard_weight
      AND ratings.extreme_weight >= ratings.medium_weight
      AND ratings.extreme_weight >= ratings.easy_weight THEN 'extreme'
    WHEN ratings.hard_weight >= ratings.medium_weight
      AND ratings.hard_weight >= ratings.easy_weight THEN 'hard'
    WHEN ratings.medium_weight >= ratings.easy_weight THEN 'medium'
    ELSE 'easy'
  END,
  COALESCE(ratings.difficulty_vote_count, 0),
  COALESCE(json_extract(rooms.published_json, '$.publishedAt'), versions.created_at)
FROM rooms
INNER JOIN room_versions versions
  ON versions.room_id = rooms.id
 AND versions.version = CAST(json_extract(rooms.published_json, '$.version') AS INTEGER)
LEFT JOIN (
  SELECT room_id, MIN(created_at) AS first_published_at
  FROM room_versions
  GROUP BY room_id
) first_versions ON first_versions.room_id = rooms.id
LEFT JOIN room_rating_aggregates ratings
  ON ratings.room_id = rooms.id
 AND ratings.version_key = versions.version
LEFT JOIN featured_rooms featured ON featured.room_id = rooms.id
WHERE rooms.published_json IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM published_expanded_members members WHERE members.room_id = rooms.id
  );

INSERT INTO playable_content_index (
  target_key, target_type, content_id, version_key, representative_room_id,
  room_x, room_y, builder_user_id, builder_display_name, title, goal_type,
  published_at, first_published_at, cell_count, anchor_x, anchor_y, source_type,
  legacy_course_id, canonical_room_version, featured_at,
  quality_adjusted_average, quality_vote_count, consensus_difficulty,
  difficulty_vote_count, updated_at
)
WITH expanded_rating_aggregates AS (
  SELECT
    expanded_room_id,
    version_key,
    SUM(CASE WHEN quality_stars IS NOT NULL THEN 1 ELSE 0 END) AS quality_vote_count,
    SUM(CASE WHEN quality_stars IS NOT NULL THEN quality_stars * trust_weight ELSE 0 END) AS weighted_quality_sum,
    SUM(CASE WHEN quality_stars IS NOT NULL THEN trust_weight ELSE 0 END) AS weighted_quality_votes,
    SUM(CASE WHEN difficulty_choice IS NOT NULL THEN 1 ELSE 0 END) AS difficulty_vote_count,
    SUM(CASE WHEN difficulty_choice = 'easy' THEN trust_weight ELSE 0 END) AS easy_weight,
    SUM(CASE WHEN difficulty_choice = 'medium' THEN trust_weight ELSE 0 END) AS medium_weight,
    SUM(CASE WHEN difficulty_choice = 'hard' THEN trust_weight ELSE 0 END) AS hard_weight,
    SUM(CASE WHEN difficulty_choice = 'extreme' THEN trust_weight ELSE 0 END) AS extreme_weight
  FROM expanded_room_ratings
  GROUP BY expanded_room_id, version_key
),
expanded_metadata AS (
  SELECT
    expanded.id,
    expanded.published_version,
    COUNT(cells.room_id) AS cell_count,
    MAX(featured.featured_at) AS featured_at
  FROM expanded_rooms expanded
  INNER JOIN expanded_room_cells cells
    ON cells.expanded_room_id = expanded.id
   AND cells.expanded_room_version = expanded.published_version
  LEFT JOIN featured_rooms featured ON featured.room_id = cells.room_id
  WHERE expanded.published_json IS NOT NULL
    AND expanded.published_version IS NOT NULL
    AND expanded.archived_at IS NULL
  GROUP BY expanded.id, expanded.published_version
  HAVING COUNT(cells.room_id) > 1
)
SELECT
  'expanded_room:' || expanded.id,
  'expanded_room',
  expanded.id,
  expanded.published_version,
  expanded.anchor_room_id,
  expanded.anchor_x,
  expanded.anchor_y,
  expanded.owner_user_id,
  expanded.owner_display_name,
  COALESCE(expanded.published_title, json_extract(expanded.published_json, '$.title')),
  json_extract(expanded.published_json, '$.goal.type'),
  COALESCE(expanded.published_at, versions.created_at),
  COALESCE(first_versions.first_published_at, versions.created_at),
  metadata.cell_count,
  expanded.anchor_x,
  expanded.anchor_y,
  expanded.source_type,
  expanded.legacy_course_id,
  NULL,
  metadata.featured_at,
  CASE
    WHEN ratings.weighted_quality_votes > 0
      THEN ROUND(((3.5 * 5) + ratings.weighted_quality_sum) / (5 + ratings.weighted_quality_votes), 3)
    ELSE NULL
  END,
  COALESCE(ratings.quality_vote_count, 0),
  CASE
    WHEN COALESCE(ratings.difficulty_vote_count, 0) = 0 THEN NULL
    WHEN ratings.extreme_weight >= ratings.hard_weight
      AND ratings.extreme_weight >= ratings.medium_weight
      AND ratings.extreme_weight >= ratings.easy_weight THEN 'extreme'
    WHEN ratings.hard_weight >= ratings.medium_weight
      AND ratings.hard_weight >= ratings.easy_weight THEN 'hard'
    WHEN ratings.medium_weight >= ratings.easy_weight THEN 'medium'
    ELSE 'easy'
  END,
  COALESCE(ratings.difficulty_vote_count, 0),
  COALESCE(expanded.updated_at, expanded.published_at, versions.created_at)
FROM expanded_rooms expanded
INNER JOIN expanded_metadata metadata
  ON metadata.id = expanded.id
 AND metadata.published_version = expanded.published_version
INNER JOIN expanded_room_versions versions
  ON versions.expanded_room_id = expanded.id
 AND versions.version = expanded.published_version
LEFT JOIN (
  SELECT expanded_room_id, MIN(created_at) AS first_published_at
  FROM expanded_room_versions
  GROUP BY expanded_room_id
) first_versions ON first_versions.expanded_room_id = expanded.id
LEFT JOIN expanded_rating_aggregates ratings
  ON ratings.expanded_room_id = expanded.id
 AND ratings.version_key = expanded.published_version;

INSERT INTO playable_content_index_members (target_key, room_id, room_version)
SELECT
  'expanded_room:' || expanded.id,
  cells.room_id,
  cells.room_version
FROM expanded_rooms expanded
INNER JOIN expanded_room_cells cells
  ON cells.expanded_room_id = expanded.id
 AND cells.expanded_room_version = expanded.published_version
INNER JOIN playable_content_index index_row
  ON index_row.target_key = 'expanded_room:' || expanded.id;
