CREATE TABLE IF NOT EXISTS custom_sprites (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT,
  legacy_creator_label TEXT,
  definition_json TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  revision INTEGER NOT NULL DEFAULT 1,
  remixed_from_sprite_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (remixed_from_sprite_id) REFERENCES custom_sprites (id) ON DELETE SET NULL,
  CHECK (status IN ('active', 'blocked', 'deleted')),
  CHECK (kind IN ('decoration', 'collectible', 'solid', 'pushable', 'sign')),
  CHECK (size IN (16, 32))
);

CREATE INDEX IF NOT EXISTS idx_custom_sprites_active_updated
  ON custom_sprites (status, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_custom_sprites_owner_updated
  ON custom_sprites (owner_user_id, status, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_custom_sprites_kind_updated
  ON custom_sprites (kind, status, updated_at DESC, id DESC);

WITH sprite_occurrences AS (
  SELECT
    json_extract(sprite.value, '$.id') AS sprite_id,
    sprite.value AS definition_json,
    COALESCE(json_extract(sprite.value, '$.updatedAt'), json_extract(rooms.draft_json, '$.updatedAt'), '') AS definition_updated_at,
    COALESCE(json_extract(sprite.value, '$.createdAt'), json_extract(rooms.draft_json, '$.createdAt'), '') AS definition_created_at,
    rooms.claimer_user_id AS candidate_user_id,
    NULL AS candidate_guest_id,
    1 AS source_priority
  FROM rooms,
    json_each(
      CASE WHEN json_valid(rooms.draft_json) THEN rooms.draft_json ELSE '{}' END,
      '$.customSprites'
    ) AS sprite

  UNION ALL

  SELECT
    json_extract(sprite.value, '$.id'),
    sprite.value,
    COALESCE(json_extract(sprite.value, '$.updatedAt'), json_extract(rooms.published_json, '$.updatedAt'), ''),
    COALESCE(json_extract(sprite.value, '$.createdAt'), json_extract(rooms.published_json, '$.createdAt'), ''),
    rooms.last_published_by_user_id,
    NULL,
    2
  FROM rooms,
    json_each(
      CASE WHEN json_valid(rooms.published_json) THEN rooms.published_json ELSE '{}' END,
      '$.customSprites'
    ) AS sprite

  UNION ALL

  SELECT
    json_extract(sprite.value, '$.id'),
    sprite.value,
    COALESCE(json_extract(sprite.value, '$.updatedAt'), room_versions.created_at, ''),
    COALESCE(json_extract(sprite.value, '$.createdAt'), room_versions.created_at, ''),
    room_versions.published_by_user_id,
    NULL,
    3
  FROM room_versions,
    json_each(
      CASE WHEN json_valid(room_versions.snapshot_json) THEN room_versions.snapshot_json ELSE '{}' END,
      '$.customSprites'
    ) AS sprite

  UNION ALL

  SELECT
    json_extract(sprite.value, '$.id'),
    sprite.value,
    COALESCE(json_extract(sprite.value, '$.updatedAt'), guest_room_drafts.updated_at, ''),
    COALESCE(json_extract(sprite.value, '$.createdAt'), guest_room_drafts.created_at, ''),
    NULL,
    guest_room_drafts.guest_user_id,
    4
  FROM guest_room_drafts,
    json_each(
      CASE WHEN json_valid(guest_room_drafts.snapshot_json) THEN guest_room_drafts.snapshot_json ELSE '{}' END,
      '$.customSprites'
    ) AS sprite
  WHERE guest_room_drafts.status = 'active'
),
owner_candidates AS (
  SELECT
    sprite_id,
    COUNT(DISTINCT candidate_user_id) AS user_count,
    COUNT(DISTINCT candidate_guest_id) AS guest_count,
    MIN(candidate_user_id) AS only_user_id
  FROM sprite_occurrences
  WHERE sprite_id IS NOT NULL AND sprite_id <> ''
  GROUP BY sprite_id
),
ranked_definitions AS (
  SELECT
    occurrence.*,
    ROW_NUMBER() OVER (
      PARTITION BY occurrence.sprite_id
      ORDER BY occurrence.definition_updated_at DESC, occurrence.source_priority ASC, occurrence.definition_json DESC
    ) AS definition_rank
  FROM sprite_occurrences AS occurrence
  WHERE occurrence.sprite_id IS NOT NULL AND occurrence.sprite_id <> ''
)
INSERT OR IGNORE INTO custom_sprites (
  id,
  owner_user_id,
  legacy_creator_label,
  definition_json,
  name,
  normalized_name,
  kind,
  size,
  status,
  revision,
  remixed_from_sprite_id,
  created_at,
  updated_at
)
SELECT
  definition.sprite_id,
  CASE
    WHEN owners.user_count = 1
      AND owners.guest_count = 0
      AND EXISTS (SELECT 1 FROM users WHERE users.id = owners.only_user_id)
      THEN owners.only_user_id
    ELSE NULL
  END,
  CASE
    WHEN owners.user_count = 1
      AND owners.guest_count = 0
      AND EXISTS (SELECT 1 FROM users WHERE users.id = owners.only_user_id)
      THEN NULL
    ELSE 'Legacy creator'
  END,
  definition.definition_json,
  COALESCE(NULLIF(TRIM(json_extract(definition.definition_json, '$.name')), ''), 'My Sprite'),
  LOWER(COALESCE(NULLIF(TRIM(json_extract(definition.definition_json, '$.name')), ''), 'My Sprite')),
  CASE json_extract(definition.definition_json, '$.kind')
    WHEN 'collectible' THEN 'collectible'
    WHEN 'solid' THEN 'solid'
    WHEN 'pushable' THEN 'pushable'
    WHEN 'sign' THEN 'sign'
    ELSE 'decoration'
  END,
  CASE json_extract(definition.definition_json, '$.size') WHEN 32 THEN 32 ELSE 16 END,
  'active',
  1,
  NULL,
  CASE
    WHEN definition.definition_created_at <> '' THEN definition.definition_created_at
    ELSE '1970-01-01T00:00:00.000Z'
  END,
  CASE
    WHEN definition.definition_updated_at <> '' THEN definition.definition_updated_at
    ELSE '1970-01-01T00:00:00.000Z'
  END
FROM ranked_definitions AS definition
INNER JOIN owner_candidates AS owners ON owners.sprite_id = definition.sprite_id
WHERE definition.definition_rank = 1;
