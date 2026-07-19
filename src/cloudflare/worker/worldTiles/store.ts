import type { RoomGoalType } from '../../../goals/roomGoals';
import {
  WORLD_TILE_MAX_LEVEL,
  type WorldTileAddress,
  type WorldTileCoordinate,
  type WorldTileLevel,
  type WorldTileRoomBounds,
  type WorldTileRoomSummary,
} from '../../../worldTiles/model';
import type { D1Database, Env } from '../core/types';

export type WorldTileRendererStatus = 'building' | 'active' | 'retired' | 'failed';

export interface WorldTileRendererVersionRow {
  version: string;
  status: WorldTileRendererStatus;
  render_origin: string;
  renderer_contract_hash: string;
  asset_contract_hash: string;
  created_at: string;
  activated_at: string | null;
  retired_at: string | null;
}

export interface WorldRenderTileRow {
  renderer_version: string;
  level: WorldTileLevel;
  tile_x: number;
  tile_y: number;
  desired_generation: number;
  desired_hash: string | null;
  desired_empty: 0 | 1;
  ready_generation: number | null;
  ready_hash: string | null;
  ready_empty: 0 | 1 | null;
  r2_key: string | null;
  r2_etag: string | null;
  byte_length: number | null;
  lease_owner: string | null;
  lease_generation: number | null;
  lease_expires_at: string | null;
  attempts: number;
  last_error: string | null;
  desired_at: string;
  ready_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorldRenderTileLeafChangeRow {
  tile_x: number;
  tile_y: number;
  desired_generation: number;
  desired_empty: 0 | 1;
  ready_generation: number | null;
  ready_empty: 0 | 1 | null;
  desired_at: string;
  ready_at: string | null;
}

export interface WorldRenderTileOutboxRow {
  id: number;
  renderer_version: string;
  level: WorldTileLevel;
  tile_x: number;
  tile_y: number;
  generation: number;
  reason: string;
  state: 'pending' | 'dispatching' | 'dispatched';
  dispatch_attempts: number;
  last_dispatch_error: string | null;
  created_at: string;
  updated_at: string;
  dispatched_at: string | null;
}

export interface WorldTileRendererStatusCounts {
  total: number;
  ready: number;
  pending: number;
  leased: number;
  failed: number;
  outboxPending: number;
}

export interface WorldTileObjectPointer {
  key: string;
  etag: string;
  byteLength: number;
}

export interface WorldTileLeafParityCounts {
  publishedRooms: number;
  matchingLeaves: number;
  missingLeaves: number;
  staleLeaves: number;
  extraContentLeaves: number;
}

export interface WorldTileAncestorParityLevel {
  level: 0 | 1 | 2 | 3;
  expected: number;
  matching: number;
  missing: number;
  stale: number;
}

export async function loadActiveWorldTileRendererVersion(
  env: Pick<Env, 'DB'>,
): Promise<WorldTileRendererVersionRow | null> {
  return env.DB.prepare(
    `
      SELECT
        version,
        status,
        render_origin,
        renderer_contract_hash,
        asset_contract_hash,
        created_at,
        activated_at,
        retired_at
      FROM world_tile_renderer_versions
      WHERE status = 'active'
      ORDER BY activated_at DESC, created_at DESC, version ASC
      LIMIT 1
    `,
  ).first<WorldTileRendererVersionRow>();
}

export async function loadWorldTileRendererVersion(
  env: Pick<Env, 'DB'>,
  version: string,
): Promise<WorldTileRendererVersionRow | null> {
  return env.DB.prepare(
    `
      SELECT
        version,
        status,
        render_origin,
        renderer_contract_hash,
        asset_contract_hash,
        created_at,
        activated_at,
        retired_at
      FROM world_tile_renderer_versions
      WHERE version = ?
      LIMIT 1
    `,
  ).bind(version).first<WorldTileRendererVersionRow>();
}

export async function loadWorldTileRendererVersions(
  env: Pick<Env, 'DB'>,
): Promise<WorldTileRendererVersionRow[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        version,
        status,
        render_origin,
        renderer_contract_hash,
        asset_contract_hash,
        created_at,
        activated_at,
        retired_at
      FROM world_tile_renderer_versions
      ORDER BY
        CASE status WHEN 'active' THEN 0 WHEN 'building' THEN 1 WHEN 'retired' THEN 2 ELSE 3 END,
        created_at DESC,
        version ASC
    `,
  ).all<WorldTileRendererVersionRow>();
  return result.results;
}

export async function loadWorldRenderTiles(
  env: Pick<Env, 'DB'>,
  rendererVersion: string,
  coordinates: WorldTileCoordinate[],
): Promise<WorldRenderTileRow[]> {
  if (coordinates.length === 0) return [];
  const statements = chunkArray(coordinates, 30).map((chunk) => env.DB.prepare(
    `
      SELECT
        renderer_version,
        level,
        tile_x,
        tile_y,
        desired_generation,
        desired_hash,
        desired_empty,
        ready_generation,
        ready_hash,
        ready_empty,
        r2_key,
        r2_etag,
        byte_length,
        lease_owner,
        lease_generation,
        lease_expires_at,
        attempts,
        last_error,
        desired_at,
        ready_at,
        created_at,
        updated_at
      FROM world_render_tiles
      WHERE renderer_version = ?
        AND (level, tile_x, tile_y) IN (${chunk.map(() => '(?, ?, ?)').join(', ')})
      ORDER BY level ASC, tile_y ASC, tile_x ASC
    `,
  ).bind(
    rendererVersion,
    ...chunk.flatMap((coordinate) => [coordinate.level, coordinate.x, coordinate.y]),
  ));
  const results = await env.DB.batch<{ results: WorldRenderTileRow[] }>(statements);
  return results.flatMap((result) => result?.results ?? []);
}

export async function loadWorldRenderTileLeafChanges(
  env: Pick<Env, 'DB'>,
  rendererVersion: string,
  bounds: WorldTileRoomBounds,
): Promise<WorldRenderTileLeafChangeRow[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        tile_x,
        tile_y,
        desired_generation,
        desired_empty,
        ready_generation,
        ready_empty,
        desired_at,
        ready_at
      FROM world_render_tiles
      WHERE renderer_version = ?
        AND level = 4
        AND tile_x BETWEEN ? AND ?
        AND tile_y BETWEEN ? AND ?
      ORDER BY tile_y ASC, tile_x ASC
    `,
  ).bind(
    rendererVersion,
    bounds.minRoomX,
    bounds.maxRoomX,
    bounds.minRoomY,
    bounds.maxRoomY,
  ).all<WorldRenderTileLeafChangeRow>();
  return result.results;
}

export async function loadPublishedWorldTileRoomSummaries(
  env: Pick<Env, 'DB'>,
  bounds: WorldTileRoomBounds,
): Promise<WorldTileRoomSummary[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        id,
        x,
        y,
        published_title,
        json_extract(published_json, '$.goal.type') AS goal_type,
        CAST(json_extract(published_json, '$.version') AS INTEGER) AS version,
        json_extract(published_json, '$.publishedAt') AS published_at,
        json_extract(published_json, '$.updatedAt') AS preview_updated_at,
        last_published_by_user_id,
        last_published_by_display_name
      FROM rooms
      WHERE published_json IS NOT NULL
        AND x BETWEEN ? AND ?
        AND y BETWEEN ? AND ?
      ORDER BY y ASC, x ASC, id ASC
    `,
  ).bind(
    bounds.minRoomX,
    bounds.maxRoomX,
    bounds.minRoomY,
    bounds.maxRoomY,
  ).all<{
    id: string;
    x: number;
    y: number;
    published_title: string | null;
    goal_type: RoomGoalType | null;
    version: number;
    published_at: string | null;
    preview_updated_at: string | null;
    last_published_by_user_id: string | null;
    last_published_by_display_name: string | null;
  }>();

  return result.results.map((row) => ({
    id: row.id,
    coordinates: { x: Number(row.x), y: Number(row.y) },
    title: row.published_title,
    state: 'published',
    goalType: row.goal_type,
    version: Number(row.version),
    publishedAt: row.published_at,
    previewUpdatedAt: row.preview_updated_at,
    creatorUserId: row.last_published_by_user_id,
    creatorDisplayName: row.last_published_by_display_name,
  }));
}

export async function createWorldTileRendererVersion(
  env: Pick<Env, 'DB'>,
  input: {
    version: string;
    renderOrigin: string;
    rendererContractHash: string;
    assetContractHash: string;
    createdAt?: string;
  },
): Promise<void> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  await env.DB.prepare(
    `
      INSERT INTO world_tile_renderer_versions (
        version,
        status,
        render_origin,
        renderer_contract_hash,
        asset_contract_hash,
        created_at
      ) VALUES (?, 'building', ?, ?, ?, ?)
    `,
  ).bind(
    input.version,
    input.renderOrigin,
    input.rendererContractHash,
    input.assetContractHash,
    createdAt,
  ).all();
}

export async function backfillWorldTileRendererLeaves(
  env: Pick<Env, 'DB'>,
  rendererVersion: string,
  reason = 'renderer-backfill',
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `
        UPDATE world_tile_renderer_versions
        SET status = 'building', retired_at = NULL
        WHERE version = ? AND status = 'retired'
      `,
    ).bind(rendererVersion),
    env.DB.prepare(
      `
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
          ?,
          4,
          rooms.x,
          rooms.y,
          1,
          'room:' || rooms.id || ':version:' || COALESCE(CAST(json_extract(rooms.published_json, '$.version') AS TEXT), 'unknown')
            || ':updated:' || COALESCE(CAST(json_extract(rooms.published_json, '$.updatedAt') AS TEXT), 'unknown'),
          0,
          ?,
          ?,
          ?
        FROM rooms
        INNER JOIN world_tile_renderer_versions AS versions
          ON versions.version = ?
         AND versions.status IN ('building', 'active')
        WHERE rooms.published_json IS NOT NULL
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
          updated_at = excluded.updated_at
      `,
    ).bind(rendererVersion, now, now, now, rendererVersion),
    env.DB.prepare(
      `
        UPDATE world_render_tiles AS tiles
        SET
          desired_generation = desired_generation + 1,
          desired_hash = NULL,
          desired_empty = 1,
          desired_at = ?,
          lease_owner = NULL,
          lease_generation = NULL,
          lease_expires_at = NULL,
          attempts = 0,
          last_error = NULL,
          updated_at = ?
        WHERE renderer_version = ?
          AND level = 4
          AND EXISTS (
            SELECT 1
            FROM world_tile_renderer_versions AS versions
            WHERE versions.version = tiles.renderer_version
              AND versions.status IN ('building', 'active')
          )
          AND NOT EXISTS (
            SELECT 1
            FROM rooms
            WHERE rooms.x = tiles.tile_x
              AND rooms.y = tiles.tile_y
              AND rooms.published_json IS NOT NULL
          )
      `,
    ).bind(now, now, rendererVersion),
    env.DB.prepare(
      `
        INSERT INTO world_render_tile_outbox (
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
          ?,
          'pending',
          ?,
          ?
        FROM world_render_tiles AS tiles
        INNER JOIN world_tile_renderer_versions AS versions
          ON versions.version = tiles.renderer_version
         AND versions.status IN ('building', 'active')
        WHERE tiles.renderer_version = ?
          AND tiles.level = 4
        ON CONFLICT (renderer_version, level, tile_x, tile_y, generation) DO UPDATE SET
          reason = excluded.reason,
          state = 'pending',
          last_dispatch_error = NULL,
          dispatched_at = NULL,
          updated_at = excluded.updated_at
      `,
    ).bind(reason, now, now, rendererVersion),
  ]);
}

export async function invalidateWorldTileAddress(
  env: Pick<Env, 'DB'>,
  address: WorldTileAddress,
  input: {
    desiredHash: string | null;
    desiredEmpty: boolean;
    reason: string;
    now?: string;
  },
): Promise<void> {
  const now = input.now ?? new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `
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
        ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
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
          updated_at = excluded.updated_at
      `,
    ).bind(
      address.rendererVersion,
      address.level,
      address.x,
      address.y,
      input.desiredHash,
      input.desiredEmpty ? 1 : 0,
      now,
      now,
      now,
    ),
    env.DB.prepare(
      `
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
          renderer_version,
          level,
          tile_x,
          tile_y,
          desired_generation,
          ?,
          'pending',
          ?,
          ?
        FROM world_render_tiles
        WHERE renderer_version = ?
          AND level = ?
          AND tile_x = ?
          AND tile_y = ?
      `,
    ).bind(
      input.reason,
      now,
      now,
      address.rendererVersion,
      address.level,
      address.x,
      address.y,
    ),
  ]);
}

export async function loadPendingWorldTileOutbox(
  env: Pick<Env, 'DB'>,
  limit: number,
): Promise<WorldRenderTileOutboxRow[]> {
  const normalizedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const result = await env.DB.prepare(
    `
      SELECT
        id,
        renderer_version,
        level,
        tile_x,
        tile_y,
        generation,
        reason,
        state,
        dispatch_attempts,
        last_dispatch_error,
        created_at,
        updated_at,
        dispatched_at
      FROM world_render_tile_outbox
      WHERE state = 'pending'
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `,
  ).bind(normalizedLimit).all<WorldRenderTileOutboxRow>();
  return result.results;
}

export async function markWorldTileOutboxDispatching(
  env: Pick<Env, 'DB'>,
  ids: number[],
  now = new Date().toISOString(),
): Promise<Set<number>> {
  const claimed = new Set<number>();
  for (const chunk of chunkArray(ids, 75)) {
    const result = await env.DB.prepare(
      `
        UPDATE world_render_tile_outbox
        SET
          state = 'dispatching',
          dispatch_attempts = dispatch_attempts + 1,
          last_dispatch_error = NULL,
          updated_at = ?
        WHERE id IN (${chunk.map(() => '?').join(', ')})
          AND state = 'pending'
        RETURNING id
      `,
    ).bind(now, ...chunk).all<{ id: number }>();
    result.results.forEach((row) => claimed.add(Number(row.id)));
  }
  return claimed;
}

export async function markWorldTileOutboxDispatched(
  env: Pick<Env, 'DB'>,
  ids: number[],
  now = new Date().toISOString(),
): Promise<void> {
  if (ids.length === 0) return;
  for (const chunk of chunkArray(ids, 80)) {
    await env.DB.prepare(
      `
        UPDATE world_render_tile_outbox
        SET state = 'dispatched', dispatched_at = ?, updated_at = ?, last_dispatch_error = NULL
        WHERE id IN (${chunk.map(() => '?').join(', ')})
          AND state = 'dispatching'
      `,
    ).bind(now, now, ...chunk).all();
  }
}

export async function markWorldTileOutboxDispatchFailed(
  env: Pick<Env, 'DB'>,
  ids: number[],
  message: string,
  now = new Date().toISOString(),
): Promise<void> {
  if (ids.length === 0) return;
  const normalizedMessage = message.slice(0, 2_000);
  for (const chunk of chunkArray(ids, 75)) {
    await env.DB.prepare(
      `
        UPDATE world_render_tile_outbox
        SET
          state = 'pending',
          last_dispatch_error = ?,
          updated_at = ?
        WHERE id IN (${chunk.map(() => '?').join(', ')})
          AND state = 'dispatching'
      `,
    ).bind(normalizedMessage, now, ...chunk).all();
  }
}

export async function activateWorldTileRendererVersion(
  env: Pick<Env, 'DB'>,
  rendererVersion: string,
  now = new Date().toISOString(),
): Promise<boolean> {
  await env.DB.batch([
    env.DB.prepare(
      `
        UPDATE world_tile_renderer_versions
        SET status = 'retired', retired_at = ?, activated_at = COALESCE(activated_at, ?)
        WHERE status = 'active'
          AND version != ?
          AND EXISTS (
            SELECT 1
            FROM world_tile_renderer_versions AS target
            WHERE target.version = ?
              AND target.status = 'building'
          )
      `,
    ).bind(now, now, rendererVersion, rendererVersion),
    env.DB.prepare(
      `
        UPDATE world_tile_renderer_versions
        SET status = 'active', activated_at = ?, retired_at = NULL
        WHERE version = ? AND status = 'building'
      `,
    ).bind(now, rendererVersion),
  ]);
  const target = await env.DB.prepare(
    `SELECT status FROM world_tile_renderer_versions WHERE version = ? LIMIT 1`,
  ).bind(rendererVersion).first<{ status: WorldTileRendererStatus }>();
  return target?.status === 'active';
}

export async function repairWorldTileOutbox(
  env: Pick<Env, 'DB'>,
  rendererVersion: string,
  now = new Date().toISOString(),
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `
        UPDATE world_render_tiles
        SET lease_owner = NULL, lease_generation = NULL, lease_expires_at = NULL, updated_at = ?
        WHERE renderer_version = ?
          AND lease_owner IS NOT NULL
          AND lease_expires_at <= ?
      `,
    ).bind(now, rendererVersion, now),
    env.DB.prepare(
      `
        INSERT INTO world_render_tile_outbox (
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
          renderer_version,
          level,
          tile_x,
          tile_y,
          desired_generation,
          'repair',
          'pending',
          ?,
          ?
        FROM world_render_tiles
        WHERE renderer_version = ?
          AND (ready_generation IS NULL OR ready_generation < desired_generation)
          AND (lease_owner IS NULL OR lease_expires_at <= ?)
        ON CONFLICT (renderer_version, level, tile_x, tile_y, generation) DO UPDATE SET
          state = 'pending',
          reason = 'repair',
          last_dispatch_error = NULL,
          dispatched_at = NULL,
          updated_at = excluded.updated_at
      `,
    ).bind(now, now, rendererVersion, now),
    env.DB.prepare(
      `
        UPDATE world_render_tile_outbox
        SET state = 'pending', updated_at = ?
        WHERE renderer_version = ?
          AND state = 'dispatching'
          AND julianday(updated_at) <= julianday(?) - (1.0 / 1440.0)
      `,
    ).bind(now, rendererVersion, now),
  ]);
}

export async function loadWorldTileRendererStatusCounts(
  env: Pick<Env, 'DB'>,
  rendererVersion: string,
): Promise<WorldTileRendererStatusCounts> {
  const [tilesResult, outboxResult] = await env.DB.batch<{ results: Array<Record<string, number>> }>([
    env.DB.prepare(
      `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN ready_generation = desired_generation THEN 1 ELSE 0 END) AS ready,
          SUM(CASE WHEN ready_generation IS NULL OR ready_generation < desired_generation THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN lease_owner IS NOT NULL THEN 1 ELSE 0 END) AS leased,
          SUM(CASE WHEN last_error IS NOT NULL THEN 1 ELSE 0 END) AS failed
        FROM world_render_tiles
        WHERE renderer_version = ?
      `,
    ).bind(rendererVersion),
    env.DB.prepare(
      `
        SELECT COUNT(*) AS outbox_pending
        FROM world_render_tile_outbox
        WHERE renderer_version = ? AND state != 'dispatched'
      `,
    ).bind(rendererVersion),
  ]);
  const tiles = tilesResult?.results[0] ?? {};
  const outbox = outboxResult?.results[0] ?? {};
  return {
    total: Number(tiles.total ?? 0),
    ready: Number(tiles.ready ?? 0),
    pending: Number(tiles.pending ?? 0),
    leased: Number(tiles.leased ?? 0),
    failed: Number(tiles.failed ?? 0),
    outboxPending: Number(outbox.outbox_pending ?? 0),
  };
}

export async function loadWorldTileLeafParityCounts(
  env: Pick<Env, 'DB'>,
  rendererVersion: string,
): Promise<WorldTileLeafParityCounts> {
  const [publishedResult, extraResult] = await env.DB.batch<{ results: Array<Record<string, number>> }>([
    env.DB.prepare(
      `
        SELECT
          COUNT(*) AS published_rooms,
          SUM(CASE WHEN tiles.renderer_version IS NULL THEN 1 ELSE 0 END) AS missing_leaves,
          SUM(CASE
            WHEN tiles.renderer_version IS NOT NULL AND (
              tiles.desired_empty != 0
              OR tiles.ready_generation IS NULL
              OR tiles.ready_generation != tiles.desired_generation
              OR tiles.ready_empty != 0
              OR tiles.ready_hash IS NULL
              OR tiles.r2_key IS NULL
              OR tiles.r2_etag IS NULL
              OR tiles.byte_length IS NULL
              OR tiles.byte_length <= 0
            ) THEN 1 ELSE 0 END
          ) AS stale_leaves
        FROM rooms
        LEFT JOIN world_render_tiles AS tiles
          ON tiles.renderer_version = ?
         AND tiles.level = 4
         AND tiles.tile_x = rooms.x
         AND tiles.tile_y = rooms.y
        WHERE rooms.published_json IS NOT NULL
      `,
    ).bind(rendererVersion),
    env.DB.prepare(
      `
        SELECT COUNT(*) AS extra_content_leaves
        FROM world_render_tiles AS tiles
        LEFT JOIN rooms
          ON rooms.x = tiles.tile_x
         AND rooms.y = tiles.tile_y
         AND rooms.published_json IS NOT NULL
        WHERE tiles.renderer_version = ?
          AND tiles.level = 4
          AND rooms.id IS NULL
          AND (tiles.desired_empty = 0 OR tiles.ready_empty = 0)
      `,
    ).bind(rendererVersion),
  ]);
  const published = publishedResult?.results[0] ?? {};
  const extra = extraResult?.results[0] ?? {};
  const publishedRooms = Number(published.published_rooms ?? 0);
  const missingLeaves = Number(published.missing_leaves ?? 0);
  const staleLeaves = Number(published.stale_leaves ?? 0);
  return {
    publishedRooms,
    matchingLeaves: Math.max(0, publishedRooms - missingLeaves - staleLeaves),
    missingLeaves,
    staleLeaves,
    extraContentLeaves: Number(extra.extra_content_leaves ?? 0),
  };
}

export async function loadWorldTileAncestorParity(
  env: Pick<Env, 'DB'>,
  rendererVersion: string,
): Promise<WorldTileAncestorParityLevel[]> {
  const result = await env.DB.prepare(
    `
      WITH RECURSIVE expected(level, tile_x, tile_y) AS (
        SELECT 4, x, y
        FROM rooms
        WHERE published_json IS NOT NULL
        UNION
        SELECT
          level - 1,
          CAST((tile_x - CASE WHEN tile_x < 0 THEN 1 ELSE 0 END) / 2 AS INTEGER),
          CAST((tile_y - CASE WHEN tile_y < 0 THEN 1 ELSE 0 END) / 2 AS INTEGER)
        FROM expected
        WHERE level > 0
      )
      SELECT
        expected.level,
        COUNT(*) AS expected_count,
        SUM(CASE WHEN tiles.renderer_version IS NULL THEN 1 ELSE 0 END) AS missing_count,
        SUM(CASE
          WHEN tiles.renderer_version IS NOT NULL AND (
            tiles.desired_empty != 0
            OR tiles.ready_generation IS NULL
            OR tiles.ready_generation != tiles.desired_generation
            OR tiles.ready_empty != 0
            OR tiles.ready_hash IS NULL
            OR tiles.r2_key IS NULL
            OR tiles.r2_etag IS NULL
            OR tiles.byte_length IS NULL
            OR tiles.byte_length <= 0
          ) THEN 1 ELSE 0 END
        ) AS stale_count
      FROM expected
      LEFT JOIN world_render_tiles AS tiles
        ON tiles.renderer_version = ?
       AND tiles.level = expected.level
       AND tiles.tile_x = expected.tile_x
       AND tiles.tile_y = expected.tile_y
      WHERE expected.level BETWEEN 0 AND 3
      GROUP BY expected.level
      ORDER BY expected.level ASC
    `,
  ).bind(rendererVersion).all<{
    level: number;
    expected_count: number;
    missing_count: number;
    stale_count: number;
  }>();
  const byLevel = new Map(result.results.map((row) => [Number(row.level), row]));
  return ([0, 1, 2, 3] as const).map((level) => {
    const row = byLevel.get(level);
    const expected = Number(row?.expected_count ?? 0);
    const missing = Number(row?.missing_count ?? 0);
    const stale = Number(row?.stale_count ?? 0);
    return {
      level,
      expected,
      matching: Math.max(0, expected - missing - stale),
      missing,
      stale,
    };
  });
}

export async function loadReferencedWorldTileObjectPointers(
  database: D1Database,
  rendererVersion: string,
): Promise<WorldTileObjectPointer[]> {
  const result = await database.prepare(
    `
      SELECT DISTINCT r2_key, r2_etag, byte_length
      FROM world_render_tiles
      WHERE renderer_version = ?
        AND r2_key IS NOT NULL
        AND r2_etag IS NOT NULL
        AND byte_length IS NOT NULL
      ORDER BY r2_key ASC, r2_etag ASC, byte_length ASC
    `,
  ).bind(rendererVersion).all<{ r2_key: string; r2_etag: string; byte_length: number }>();
  return result.results.map((row) => ({
    key: row.r2_key,
    etag: row.r2_etag,
    byteLength: Number(row.byte_length),
  }));
}

export async function loadAllReferencedWorldTileObjectKeys(
  database: D1Database,
): Promise<Set<string>> {
  const result = await database.prepare(
    `
      SELECT DISTINCT r2_key
      FROM world_render_tiles
      WHERE r2_key IS NOT NULL
      ORDER BY r2_key ASC
    `,
  ).all<{ r2_key: string }>();
  return new Set(result.results.map((row) => row.r2_key));
}

export function isWorldRenderTileCurrent(row: WorldRenderTileRow): boolean {
  return row.ready_generation !== null && row.ready_generation === row.desired_generation;
}

export function isWorldRenderLeaf(row: Pick<WorldRenderTileRow, 'level'>): boolean {
  return row.level === WORLD_TILE_MAX_LEVEL;
}

function chunkArray<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}
