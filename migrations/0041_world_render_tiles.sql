CREATE TABLE IF NOT EXISTS world_tile_renderer_versions (
  version TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('building', 'active', 'retired', 'failed')),
  render_origin TEXT NOT NULL,
  renderer_contract_hash TEXT NOT NULL,
  asset_contract_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  activated_at TEXT,
  retired_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_world_tile_renderer_versions_active
  ON world_tile_renderer_versions (status)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_world_tile_renderer_versions_status_created
  ON world_tile_renderer_versions (status, created_at DESC);

CREATE TABLE IF NOT EXISTS world_render_tiles (
  renderer_version TEXT NOT NULL,
  level INTEGER NOT NULL CHECK (level BETWEEN 0 AND 4),
  tile_x INTEGER NOT NULL,
  tile_y INTEGER NOT NULL,
  desired_generation INTEGER NOT NULL DEFAULT 0 CHECK (desired_generation >= 0),
  desired_hash TEXT,
  desired_empty INTEGER NOT NULL DEFAULT 1 CHECK (desired_empty IN (0, 1)),
  ready_generation INTEGER CHECK (ready_generation IS NULL OR ready_generation >= 0),
  ready_hash TEXT,
  ready_empty INTEGER CHECK (ready_empty IS NULL OR ready_empty IN (0, 1)),
  r2_key TEXT,
  r2_etag TEXT,
  byte_length INTEGER CHECK (byte_length IS NULL OR byte_length >= 0),
  lease_owner TEXT,
  lease_generation INTEGER CHECK (lease_generation IS NULL OR lease_generation >= 0),
  lease_expires_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  desired_at TEXT NOT NULL,
  ready_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (renderer_version, level, tile_x, tile_y),
  FOREIGN KEY (renderer_version) REFERENCES world_tile_renderer_versions (version) ON DELETE CASCADE,
  CHECK (
    (
      ready_generation IS NULL
      AND ready_empty IS NULL
      AND ready_hash IS NULL
      AND r2_key IS NULL
      AND r2_etag IS NULL
      AND byte_length IS NULL
    )
    OR (
      ready_generation IS NOT NULL
      AND ready_empty = 1
      AND ready_hash IS NULL
      AND r2_key IS NULL
      AND r2_etag IS NULL
      AND byte_length IS NULL
    )
    OR (
      ready_generation IS NOT NULL
      AND ready_empty = 0
      AND ready_hash IS NOT NULL
      AND r2_key IS NOT NULL
      AND r2_etag IS NOT NULL
      AND byte_length > 0
    )
  ),
  CHECK (
    (lease_owner IS NULL AND lease_generation IS NULL AND lease_expires_at IS NULL)
    OR (lease_owner IS NOT NULL AND lease_generation IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_world_render_tiles_spatial
  ON world_render_tiles (renderer_version, level, tile_y, tile_x);

CREATE INDEX IF NOT EXISTS idx_world_render_tiles_repair
  ON world_render_tiles (renderer_version, desired_generation, ready_generation, lease_expires_at)
  WHERE ready_generation IS NULL OR ready_generation < desired_generation;

CREATE INDEX IF NOT EXISTS idx_world_render_tiles_expired_leases
  ON world_render_tiles (lease_expires_at, renderer_version, level)
  WHERE lease_owner IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_world_render_tiles_r2_key
  ON world_render_tiles (r2_key)
  WHERE r2_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS world_render_tile_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  renderer_version TEXT NOT NULL,
  level INTEGER NOT NULL CHECK (level BETWEEN 0 AND 4),
  tile_x INTEGER NOT NULL,
  tile_y INTEGER NOT NULL,
  generation INTEGER NOT NULL CHECK (generation >= 0),
  reason TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'dispatching', 'dispatched')),
  dispatch_attempts INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_attempts >= 0),
  last_dispatch_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  dispatched_at TEXT,
  FOREIGN KEY (renderer_version) REFERENCES world_tile_renderer_versions (version) ON DELETE CASCADE,
  UNIQUE (renderer_version, level, tile_x, tile_y, generation)
);

CREATE INDEX IF NOT EXISTS idx_world_render_tile_outbox_pending
  ON world_render_tile_outbox (state, created_at, id)
  WHERE state != 'dispatched';

CREATE INDEX IF NOT EXISTS idx_world_render_tile_outbox_address
  ON world_render_tile_outbox (renderer_version, level, tile_x, tile_y, generation DESC);

-- Published snapshots are the only room bytes that can invalidate immutable
-- raster tiles. Draft saves and claimed-unpublished previews intentionally do
-- not touch these tables.
CREATE TRIGGER IF NOT EXISTS trg_world_tiles_room_published_insert
AFTER INSERT ON rooms
WHEN NEW.published_json IS NOT NULL
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
    NEW.x,
    NEW.y,
    1,
    'room:' || NEW.id || ':version:' || COALESCE(CAST(json_extract(NEW.published_json, '$.version') AS TEXT), 'unknown')
      || ':updated:' || COALESCE(CAST(json_extract(NEW.published_json, '$.updatedAt') AS TEXT), 'unknown'),
    0,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM world_tile_renderer_versions AS versions
  WHERE versions.status IN ('active', 'building')
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
    'room-published-insert',
    'pending',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM world_render_tiles AS tiles
  INNER JOIN world_tile_renderer_versions AS versions
    ON versions.version = tiles.renderer_version
   AND versions.status IN ('active', 'building')
  WHERE tiles.level = 4
    AND tiles.tile_x = NEW.x
    AND tiles.tile_y = NEW.y;
END;

CREATE TRIGGER IF NOT EXISTS trg_world_tiles_room_published_update
AFTER UPDATE OF published_json ON rooms
WHEN OLD.published_json IS NOT NEW.published_json
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
    NEW.x,
    NEW.y,
    1,
    CASE
      WHEN NEW.published_json IS NULL THEN NULL
      ELSE 'room:' || NEW.id || ':version:' || COALESCE(CAST(json_extract(NEW.published_json, '$.version') AS TEXT), 'unknown')
        || ':updated:' || COALESCE(CAST(json_extract(NEW.published_json, '$.updatedAt') AS TEXT), 'unknown')
    END,
    CASE WHEN NEW.published_json IS NULL THEN 1 ELSE 0 END,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM world_tile_renderer_versions AS versions
  WHERE versions.status IN ('active', 'building')
  ON CONFLICT (renderer_version, level, tile_x, tile_y) DO UPDATE SET
    desired_generation = world_render_tiles.desired_generation + 1,
    desired_hash = excluded.desired_hash,
    desired_empty = excluded.desired_empty,
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
    CASE WHEN NEW.published_json IS NULL THEN 'room-unpublished' ELSE 'room-published-update' END,
    'pending',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM world_render_tiles AS tiles
  INNER JOIN world_tile_renderer_versions AS versions
    ON versions.version = tiles.renderer_version
   AND versions.status IN ('active', 'building')
  WHERE tiles.level = 4
    AND tiles.tile_x = NEW.x
    AND tiles.tile_y = NEW.y;
END;

CREATE TRIGGER IF NOT EXISTS trg_world_tiles_room_published_delete
AFTER DELETE ON rooms
WHEN OLD.published_json IS NOT NULL
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
    OLD.x,
    OLD.y,
    1,
    NULL,
    1,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM world_tile_renderer_versions AS versions
  WHERE versions.status IN ('active', 'building')
  ON CONFLICT (renderer_version, level, tile_x, tile_y) DO UPDATE SET
    desired_generation = world_render_tiles.desired_generation + 1,
    desired_hash = NULL,
    desired_empty = 1,
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
    'room-deleted',
    'pending',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM world_render_tiles AS tiles
  INNER JOIN world_tile_renderer_versions AS versions
    ON versions.version = tiles.renderer_version
   AND versions.status IN ('active', 'building')
  WHERE tiles.level = 4
    AND tiles.tile_x = OLD.x
    AND tiles.tile_y = OLD.y;
END;

-- Approval or revocation of a custom background is raster-visible. Invalidate
-- only currently published rooms that reference that exact upload ID.
CREATE TRIGGER IF NOT EXISTS trg_world_tiles_background_status_update
AFTER UPDATE OF status, cloudflare_deleted_at ON background_image_uploads
WHEN (OLD.status = 'approved' AND OLD.cloudflare_deleted_at IS NULL)
  IS NOT
  (NEW.status = 'approved' AND NEW.cloudflare_deleted_at IS NULL)
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
      || ':background-availability:'
      || CASE WHEN NEW.status = 'approved' AND NEW.cloudflare_deleted_at IS NULL
        THEN 'approved'
        ELSE 'unavailable'
      END,
    0,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM world_tile_renderer_versions AS versions
  CROSS JOIN rooms
  WHERE versions.status IN ('active', 'building')
    AND rooms.published_json IS NOT NULL
    AND (
      json_extract(rooms.published_json, '$.background') = 'custom:' || NEW.id
      OR json_extract(rooms.published_json, '$.background') LIKE 'custom:' || NEW.id || '?%'
    )
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
    'custom-background-availability',
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
    AND (
      json_extract(rooms.published_json, '$.background') = 'custom:' || NEW.id
      OR json_extract(rooms.published_json, '$.background') LIKE 'custom:' || NEW.id || '?%'
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_world_tiles_background_delete
AFTER DELETE ON background_image_uploads
WHEN OLD.status = 'approved' AND OLD.cloudflare_deleted_at IS NULL
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
      || ':background-availability:deleted',
    0,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM world_tile_renderer_versions AS versions
  CROSS JOIN rooms
  WHERE versions.status IN ('active', 'building')
    AND rooms.published_json IS NOT NULL
    AND (
      json_extract(rooms.published_json, '$.background') = 'custom:' || OLD.id
      OR substr(
        json_extract(rooms.published_json, '$.background'),
        1,
        length('custom:' || OLD.id || '?')
      ) = 'custom:' || OLD.id || '?'
    )
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
    'custom-background-deleted',
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
    AND (
      json_extract(rooms.published_json, '$.background') = 'custom:' || OLD.id
      OR substr(
        json_extract(rooms.published_json, '$.background'),
        1,
        length('custom:' || OLD.id || '?')
      ) = 'custom:' || OLD.id || '?'
    );
END;

-- A successful ready-pointer publication atomically dirties the parent and
-- creates its generation event. This closes the crash window between child
-- CAS success and parent propagation. Each parent job later repeats the same
-- operation for its own parent, so recursive trigger execution is unnecessary.
CREATE TRIGGER IF NOT EXISTS trg_world_tiles_ready_child_propagate
AFTER UPDATE OF ready_generation ON world_render_tiles
WHEN NEW.level > 0
  AND NEW.ready_generation IS NOT NULL
  AND NEW.ready_generation = NEW.desired_generation
  AND OLD.ready_generation IS NOT NEW.ready_generation
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
  ) VALUES (
    NEW.renderer_version,
    NEW.level - 1,
    CAST((NEW.tile_x - CASE WHEN NEW.tile_x < 0 THEN 1 ELSE 0 END) / 2 AS INTEGER),
    CAST((NEW.tile_y - CASE WHEN NEW.tile_y < 0 THEN 1 ELSE 0 END) / 2 AS INTEGER),
    1,
    NULL,
    0,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT (renderer_version, level, tile_x, tile_y) DO UPDATE SET
    desired_generation = world_render_tiles.desired_generation + 1,
    desired_hash = NULL,
    desired_empty = 0,
    desired_at = excluded.desired_at,
    lease_owner = NULL,
    lease_generation = NULL,
    lease_expires_at = NULL,
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
    parent.renderer_version,
    parent.level,
    parent.tile_x,
    parent.tile_y,
    parent.desired_generation,
    'child-ready',
    'pending',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM world_render_tiles AS parent
  WHERE parent.renderer_version = NEW.renderer_version
    AND parent.level = NEW.level - 1
    AND parent.tile_x = CAST((NEW.tile_x - CASE WHEN NEW.tile_x < 0 THEN 1 ELSE 0 END) / 2 AS INTEGER)
    AND parent.tile_y = CAST((NEW.tile_y - CASE WHEN NEW.tile_y < 0 THEN 1 ELSE 0 END) / 2 AS INTEGER);
END;
