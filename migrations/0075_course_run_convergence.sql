-- F270: additive compatibility backfill before routing course APIs to Expanded Rooms.
-- Existing projections/runs are never overwritten. Legacy tables and dual writes remain.
-- Historical finalize_seq values are table-local and are deliberately not copied.

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
WITH legacy_courses AS (
  SELECT *
  FROM courses
  WHERE EXISTS (SELECT 1 FROM course_versions v WHERE v.course_id = courses.id)
),
anchor_refs AS (
  SELECT
    c.id AS course_id,
    COALESCE(
      json_extract(COALESCE(c.published_json, (SELECT v.snapshot_json FROM course_versions v WHERE v.course_id = c.id ORDER BY v.version DESC LIMIT 1)), '$.startPoint.roomId'),
      (
        SELECT room_id
        FROM course_room_refs refs
        WHERE refs.course_id = c.id
          AND refs.course_version = COALESCE(c.published_version, (SELECT MAX(v.version) FROM course_versions v WHERE v.course_id = c.id))
        ORDER BY refs.room_y ASC, refs.room_x ASC, refs.room_id ASC
        LIMIT 1
      )
    ) AS anchor_room_id
  FROM legacy_courses c
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
FROM legacy_courses c
JOIN anchor_refs anchor_ref
  ON anchor_ref.course_id = c.id
LEFT JOIN course_room_refs anchor
  ON anchor.course_id = c.id
 AND anchor.course_version = COALESCE(c.published_version, (SELECT MAX(v.version) FROM course_versions v WHERE v.course_id = c.id))
 AND anchor.room_id = anchor_ref.anchor_room_id
LEFT JOIN course_room_refs fallback
  ON fallback.course_id = c.id
 AND fallback.course_version = COALESCE(c.published_version, (SELECT MAX(v.version) FROM course_versions v WHERE v.course_id = c.id))
 AND fallback.room_order = (
   SELECT MIN(room_order)
   FROM course_room_refs refs
   WHERE refs.course_id = c.id
     AND refs.course_version = COALESCE(c.published_version, (SELECT MAX(v.version) FROM course_versions v WHERE v.course_id = c.id))
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
WHERE EXISTS (SELECT 1 FROM expanded_rooms e WHERE e.id = 'course:' || course_versions.course_id);

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
  CASE WHEN rooms.minted_chain_id IS NOT NULL OR rooms.minted_contract_address IS NOT NULL
    OR rooms.minted_token_id IS NOT NULL THEN 1 ELSE 0 END AS protected_minted
FROM course_room_refs refs
JOIN expanded_room_versions v
  ON v.expanded_room_id = 'course:' || refs.course_id
 AND v.version = refs.course_version
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
  verification_snapshot_hash,
  insight_deaths_json,
  insight_play_ms
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
  verification_snapshot_hash,
  insight_deaths_json,
  insight_play_ms
FROM course_runs
WHERE EXISTS (
  SELECT 1
  FROM expanded_room_versions version
  WHERE version.expanded_room_id = 'course:' || course_runs.course_id
    AND version.version = course_runs.course_version
);


-- A completed legacy attempt that already settled must never be rewarded again.
INSERT OR IGNORE INTO run_settlements (attempt_kind, attempt_id, settled_at)
SELECT 'expanded_room', s.attempt_id, s.settled_at
FROM run_settlements s
JOIN expanded_room_runs e ON e.legacy_course_attempt_id = s.attempt_id
WHERE s.attempt_kind = 'course';
