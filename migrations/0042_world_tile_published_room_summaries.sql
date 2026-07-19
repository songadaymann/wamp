-- Public, projection-only room metadata used by the tile manifest. Keeping this
-- separate from playable_content_index is intentional: expanded-room member
-- cells still need coordinate summaries for selection and interaction.
CREATE TABLE IF NOT EXISTS world_tile_published_room_summaries (
  room_id TEXT PRIMARY KEY,
  room_x INTEGER NOT NULL,
  room_y INTEGER NOT NULL,
  published_title TEXT,
  goal_type TEXT,
  published_version INTEGER NOT NULL,
  published_at TEXT,
  preview_updated_at TEXT,
  creator_user_id TEXT,
  creator_display_name TEXT,
  refreshed_at TEXT NOT NULL,
  UNIQUE (room_x, room_y),
  FOREIGN KEY (room_id) REFERENCES rooms (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_world_tile_published_room_summaries_yx
  ON world_tile_published_room_summaries (room_y, room_x, room_id);

-- Backfill every currently published room, including cells that belong to a
-- published expanded room. Draft and claimed-unpublished JSON never enters the
-- read model.
INSERT INTO world_tile_published_room_summaries (
  room_id,
  room_x,
  room_y,
  published_title,
  goal_type,
  published_version,
  published_at,
  preview_updated_at,
  creator_user_id,
  creator_display_name,
  refreshed_at
)
SELECT
  rooms.id,
  rooms.x,
  rooms.y,
  rooms.published_title,
  json_extract(rooms.published_json, '$.goal.type'),
  COALESCE(CAST(json_extract(rooms.published_json, '$.version') AS INTEGER), 0),
  json_extract(rooms.published_json, '$.publishedAt'),
  json_extract(rooms.published_json, '$.updatedAt'),
  rooms.last_published_by_user_id,
  rooms.last_published_by_display_name,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM rooms
WHERE rooms.published_json IS NOT NULL
ON CONFLICT (room_id) DO UPDATE SET
  room_x = excluded.room_x,
  room_y = excluded.room_y,
  published_title = excluded.published_title,
  goal_type = excluded.goal_type,
  published_version = excluded.published_version,
  published_at = excluded.published_at,
  preview_updated_at = excluded.preview_updated_at,
  creator_user_id = excluded.creator_user_id,
  creator_display_name = excluded.creator_display_name,
  refreshed_at = excluded.refreshed_at;

CREATE TRIGGER IF NOT EXISTS trg_world_tile_published_room_summary_insert
AFTER INSERT ON rooms
WHEN NEW.published_json IS NOT NULL
BEGIN
  INSERT INTO world_tile_published_room_summaries (
    room_id,
    room_x,
    room_y,
    published_title,
    goal_type,
    published_version,
    published_at,
    preview_updated_at,
    creator_user_id,
    creator_display_name,
    refreshed_at
  ) VALUES (
    NEW.id,
    NEW.x,
    NEW.y,
    NEW.published_title,
    json_extract(NEW.published_json, '$.goal.type'),
    COALESCE(CAST(json_extract(NEW.published_json, '$.version') AS INTEGER), 0),
    json_extract(NEW.published_json, '$.publishedAt'),
    json_extract(NEW.published_json, '$.updatedAt'),
    NEW.last_published_by_user_id,
    NEW.last_published_by_display_name,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT (room_id) DO UPDATE SET
    room_x = excluded.room_x,
    room_y = excluded.room_y,
    published_title = excluded.published_title,
    goal_type = excluded.goal_type,
    published_version = excluded.published_version,
    published_at = excluded.published_at,
    preview_updated_at = excluded.preview_updated_at,
    creator_user_id = excluded.creator_user_id,
    creator_display_name = excluded.creator_display_name,
    refreshed_at = excluded.refreshed_at;
END;

CREATE TRIGGER IF NOT EXISTS trg_world_tile_published_room_summary_update
AFTER UPDATE OF
  published_json,
  published_title,
  last_published_by_user_id,
  last_published_by_display_name,
  x,
  y
ON rooms
BEGIN
  DELETE FROM world_tile_published_room_summaries
  WHERE room_id = NEW.id
    AND NEW.published_json IS NULL;

  INSERT INTO world_tile_published_room_summaries (
    room_id,
    room_x,
    room_y,
    published_title,
    goal_type,
    published_version,
    published_at,
    preview_updated_at,
    creator_user_id,
    creator_display_name,
    refreshed_at
  )
  SELECT
    NEW.id,
    NEW.x,
    NEW.y,
    NEW.published_title,
    json_extract(NEW.published_json, '$.goal.type'),
    COALESCE(CAST(json_extract(NEW.published_json, '$.version') AS INTEGER), 0),
    json_extract(NEW.published_json, '$.publishedAt'),
    json_extract(NEW.published_json, '$.updatedAt'),
    NEW.last_published_by_user_id,
    NEW.last_published_by_display_name,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE NEW.published_json IS NOT NULL
  ON CONFLICT (room_id) DO UPDATE SET
    room_x = excluded.room_x,
    room_y = excluded.room_y,
    published_title = excluded.published_title,
    goal_type = excluded.goal_type,
    published_version = excluded.published_version,
    published_at = excluded.published_at,
    preview_updated_at = excluded.preview_updated_at,
    creator_user_id = excluded.creator_user_id,
    creator_display_name = excluded.creator_display_name,
    refreshed_at = excluded.refreshed_at;
END;

CREATE TRIGGER IF NOT EXISTS trg_world_tile_published_room_summary_delete
AFTER DELETE ON rooms
BEGIN
  DELETE FROM world_tile_published_room_summaries WHERE room_id = OLD.id;
END;
