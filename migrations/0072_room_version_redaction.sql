-- A vandal's published version can be hidden after the room is restored (F189): its content and
-- title are no longer served anywhere players can see them, but the row stays for the audit trail.
ALTER TABLE room_versions ADD COLUMN redacted_at TEXT;
-- While hidden, the title column reads "Hidden by moderation" everywhere it is shown (playlists,
-- comments, activity, courses); the original is kept here so Show can put it back.
ALTER TABLE room_versions ADD COLUMN redacted_title TEXT;

-- moderation_audit (0070) learns the version hide/show actions. Nothing references this table,
-- so it is rebuilt to widen its CHECK.
CREATE TABLE moderation_audit_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL CHECK (action IN ('suspend', 'unsuspend', 'revert_edits', 'room_clear', 'version_hide', 'version_show')),
  target_user_id TEXT,
  target_room_id TEXT,
  operator_label TEXT NOT NULL,
  reason TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
INSERT INTO moderation_audit_next (id, action, target_user_id, target_room_id, operator_label, reason, details_json, created_at)
SELECT id, action, target_user_id, target_room_id, operator_label, reason, details_json, created_at FROM moderation_audit;
DROP TABLE moderation_audit;
ALTER TABLE moderation_audit_next RENAME TO moderation_audit;
CREATE INDEX idx_moderation_audit_user ON moderation_audit(target_user_id, created_at DESC);

-- Blocking or restoring a community sprite re-renders the map tiles of every room that embeds it
-- (same pattern as custom backgrounds in 0041); the renderer paints blocked art as a placeholder.
CREATE TRIGGER IF NOT EXISTS trg_world_tiles_custom_sprite_status_update
AFTER UPDATE OF status ON custom_sprites
WHEN (OLD.status = 'blocked') IS NOT (NEW.status = 'blocked')
BEGIN
  INSERT INTO world_render_tiles (
    renderer_version,
    level,
    tile_x,
    tile_y,
    desired_generation,
    desired_hash,
    desired_empty,
    desired_at,
    created_at,
    updated_at
  )
  SELECT
    versions.version,
    4,
    rooms.x,
    rooms.y,
    1,
    'room:' || rooms.id || ':version:' || COALESCE(CAST(json_extract(rooms.published_json, '$.version') AS TEXT), 'unknown')
      || ':custom-sprite:' || NEW.id || ':' || NEW.status,
    0,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM world_tile_renderer_versions AS versions
  CROSS JOIN rooms
  WHERE versions.status IN ('active', 'building')
    AND rooms.published_json IS NOT NULL
    AND instr(rooms.published_json, '"' || NEW.id || '"') > 0
  ON CONFLICT (renderer_version, level, tile_x, tile_y) DO UPDATE SET
    desired_generation = world_render_tiles.desired_generation + 1,
    desired_hash = excluded.desired_hash,
    desired_empty = 0,
    desired_at = excluded.desired_at,
    lease_owner = NULL,
    lease_generation = NULL,
    lease_expires_at = NULL,
    attempts = 0,
    last_error = NULL,
    updated_at = excluded.updated_at;

  INSERT OR IGNORE INTO world_render_tile_outbox (
    renderer_version,
    level,
    tile_x,
    tile_y,
    generation,
    reason,
    state,
    created_at,
    updated_at
  )
  SELECT
    tiles.renderer_version,
    tiles.level,
    tiles.tile_x,
    tiles.tile_y,
    tiles.desired_generation,
    'custom-sprite-status',
    'pending',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM world_render_tiles AS tiles
  INNER JOIN world_tile_renderer_versions AS versions
    ON versions.version = tiles.renderer_version
   AND versions.status IN ('active', 'building')
  INNER JOIN rooms
    ON rooms.x = tiles.tile_x
   AND rooms.y = tiles.tile_y
   AND rooms.published_json IS NOT NULL
  WHERE tiles.level = 4
    AND instr(rooms.published_json, '"' || NEW.id || '"') > 0;
END;
