import {
  getChildAddresses,
  type WorldRenderTileRow,
  type WorldTileAddress,
  type WorldTileRendererVersionRow,
} from './contracts';
import type { D1Database } from './runtimeTypes';

export interface PublishedRoomRow {
  id: string;
  published_json: string | null;
}

export interface WorldTileOutboxRow {
  id: number;
  renderer_version: string;
  level: number;
  tile_x: number;
  tile_y: number;
  generation: number;
  reason: string;
  dispatch_attempts: number;
  updated_at: string;
}

const TILE_COLUMNS = `
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
`;

export async function loadRendererVersion(
  db: D1Database,
  version: string
): Promise<WorldTileRendererVersionRow | null> {
  return db.prepare(
    `
      SELECT version, status, render_origin, renderer_contract_hash, asset_contract_hash
      FROM world_tile_renderer_versions
      WHERE version = ?
      LIMIT 1
    `
  ).bind(version).first<WorldTileRendererVersionRow>();
}

export async function loadRenderTile(
  db: D1Database,
  address: WorldTileAddress
): Promise<WorldRenderTileRow | null> {
  return db.prepare(
    `SELECT ${TILE_COLUMNS} FROM world_render_tiles
     WHERE renderer_version = ? AND level = ? AND tile_x = ? AND tile_y = ?
     LIMIT 1`
  ).bind(address.rendererVersion, address.level, address.x, address.y).first<WorldRenderTileRow>();
}

export async function acquireRenderLease(
  db: D1Database,
  input: {
    address: WorldTileAddress;
    generation: number;
    leaseExpiresAt: string;
    leaseOwner: string;
    now: string;
  }
): Promise<WorldRenderTileRow | null> {
  const { address } = input;
  return db.prepare(
    `
      UPDATE world_render_tiles
      SET
        lease_owner = ?,
        lease_generation = ?,
        lease_expires_at = ?,
        attempts = attempts + 1,
        last_error = NULL,
        updated_at = ?
      WHERE renderer_version = ?
        AND level = ?
        AND tile_x = ?
        AND tile_y = ?
        AND desired_generation = ?
        AND (
          ready_generation IS NULL
          OR ready_generation != desired_generation
          OR ready_empty IS NULL
          OR ready_empty != desired_empty
          OR (
            ready_empty = 0
            AND (
              ready_hash IS NULL
              OR r2_key IS NULL
              OR r2_etag IS NULL
              OR byte_length IS NULL
              OR byte_length <= 0
            )
          )
        )
        AND (
          lease_expires_at IS NULL
          OR lease_expires_at < ?
          OR (lease_owner = ? AND lease_generation = ?)
        )
      RETURNING ${TILE_COLUMNS}
    `
  ).bind(
    input.leaseOwner,
    input.generation,
    input.leaseExpiresAt,
    input.now,
    address.rendererVersion,
    address.level,
    address.x,
    address.y,
    input.generation,
    input.now,
    input.leaseOwner,
    input.generation
  ).first<WorldRenderTileRow>();
}

export async function updateDesiredRenderState(
  db: D1Database,
  input: {
    address: WorldTileAddress;
    desiredEmpty: boolean;
    desiredHash: string | null;
    generation: number;
    leaseOwner: string;
    now: string;
  }
): Promise<boolean> {
  const result = await db.prepare(
    `
      UPDATE world_render_tiles
      SET desired_empty = ?, desired_hash = ?, desired_at = ?, updated_at = ?
      WHERE renderer_version = ?
        AND level = ?
        AND tile_x = ?
        AND tile_y = ?
        AND desired_generation = ?
        AND lease_owner = ?
        AND lease_generation = ?
    `
  ).bind(
    input.desiredEmpty ? 1 : 0,
    input.desiredHash,
    input.now,
    input.now,
    input.address.rendererVersion,
    input.address.level,
    input.address.x,
    input.address.y,
    input.generation,
    input.leaseOwner,
    input.generation
  ).run();
  return changed(result.meta?.changes);
}

export async function publishReadyEmpty(
  db: D1Database,
  input: PublishReadyBase
): Promise<boolean> {
  const result = await db.prepare(
    `
      UPDATE world_render_tiles
      SET
        desired_empty = 1,
        ready_generation = ?,
        ready_hash = NULL,
        ready_empty = 1,
        r2_key = NULL,
        r2_etag = NULL,
        byte_length = NULL,
        lease_owner = NULL,
        lease_generation = NULL,
        lease_expires_at = NULL,
        last_error = NULL,
        ready_at = ?,
        updated_at = ?
      WHERE renderer_version = ?
        AND level = ?
        AND tile_x = ?
        AND tile_y = ?
        AND desired_generation = ?
        AND lease_owner = ?
        AND lease_generation = ?
    `
  ).bind(
    input.generation,
    input.now,
    input.now,
    input.address.rendererVersion,
    input.address.level,
    input.address.x,
    input.address.y,
    input.generation,
    input.leaseOwner,
    input.generation
  ).run();
  return changed(result.meta?.changes);
}

export async function publishReadyObject(
  db: D1Database,
  input: PublishReadyBase & {
    byteLength: number;
    contentHash: string;
    r2Etag: string;
    r2Key: string;
  }
): Promise<boolean> {
  const result = await db.prepare(
    `
      UPDATE world_render_tiles
      SET
        desired_empty = 0,
        ready_generation = ?,
        ready_hash = ?,
        ready_empty = 0,
        r2_key = ?,
        r2_etag = ?,
        byte_length = ?,
        lease_owner = NULL,
        lease_generation = NULL,
        lease_expires_at = NULL,
        last_error = NULL,
        ready_at = ?,
        updated_at = ?
      WHERE renderer_version = ?
        AND level = ?
        AND tile_x = ?
        AND tile_y = ?
        AND desired_generation = ?
        AND lease_owner = ?
        AND lease_generation = ?
    `
  ).bind(
    input.generation,
    input.contentHash,
    input.r2Key,
    input.r2Etag,
    input.byteLength,
    input.now,
    input.now,
    input.address.rendererVersion,
    input.address.level,
    input.address.x,
    input.address.y,
    input.generation,
    input.leaseOwner,
    input.generation
  ).run();
  return changed(result.meta?.changes);
}

export async function releaseRenderLease(
  db: D1Database,
  input: {
    address: WorldTileAddress;
    error: string;
    generation: number;
    leaseOwner: string;
    now: string;
  }
): Promise<void> {
  await db.prepare(
    `
      UPDATE world_render_tiles
      SET
        lease_owner = NULL,
        lease_generation = NULL,
        lease_expires_at = NULL,
        last_error = ?,
        updated_at = ?
      WHERE renderer_version = ?
        AND level = ?
        AND tile_x = ?
        AND tile_y = ?
        AND lease_owner = ?
        AND lease_generation = ?
    `
  ).bind(
    input.error.slice(0, 2_000),
    input.now,
    input.address.rendererVersion,
    input.address.level,
    input.address.x,
    input.address.y,
    input.leaseOwner,
    input.generation
  ).run();
}

export async function loadPublishedRoomAt(
  db: D1Database,
  coordinates: { x: number; y: number }
): Promise<PublishedRoomRow | null> {
  return db.prepare(
    `SELECT id, published_json FROM rooms WHERE x = ? AND y = ? LIMIT 1`
  ).bind(coordinates.x, coordinates.y).first<PublishedRoomRow>();
}

export async function isCustomBackgroundApproved(
  db: D1Database,
  id: string
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS approved
     FROM background_image_uploads
     WHERE id = ? AND status = 'approved' AND cloudflare_deleted_at IS NULL
     LIMIT 1`
  ).bind(id).first<{ approved: number }>();
  return row?.approved === 1;
}

export async function loadChildRenderTiles(
  db: D1Database,
  address: WorldTileAddress
): Promise<WorldRenderTileRow[]> {
  const children = getChildAddresses(address);
  if (children.length === 0) {
    return [];
  }
  const predicates = children.map(() => '(tile_x = ? AND tile_y = ?)').join(' OR ');
  const values = children.flatMap((child) => [child.x, child.y]);
  const response = await db.prepare(
    `
      SELECT ${TILE_COLUMNS}
      FROM world_render_tiles
      WHERE renderer_version = ? AND level = ? AND (${predicates})
    `
  ).bind(address.rendererVersion, children[0].level, ...values).all<WorldRenderTileRow>();
  return response.results;
}

export async function listDispatchableOutbox(
  db: D1Database,
  staleDispatchBefore: string,
  limit: number
): Promise<WorldTileOutboxRow[]> {
  const response = await db.prepare(
    `
      SELECT id, renderer_version, level, tile_x, tile_y, generation, reason, dispatch_attempts, updated_at
      FROM world_render_tile_outbox
      WHERE state = 'pending' OR (state = 'dispatching' AND updated_at < ?)
      ORDER BY id ASC
      LIMIT ?
    `
  ).bind(staleDispatchBefore, limit).all<WorldTileOutboxRow>();
  return response.results;
}

export async function markOutboxDispatching(
  db: D1Database,
  id: number,
  staleDispatchBefore: string,
  now: string
): Promise<boolean> {
  const result = await db.prepare(
    `
      UPDATE world_render_tile_outbox
      SET state = 'dispatching', dispatch_attempts = dispatch_attempts + 1,
          last_dispatch_error = NULL, updated_at = ?
      WHERE id = ?
        AND (state = 'pending' OR (state = 'dispatching' AND updated_at < ?))
    `
  ).bind(now, id, staleDispatchBefore).run();
  return changed(result.meta?.changes);
}

export async function markOutboxDispatched(db: D1Database, id: number, now: string): Promise<void> {
  await db.prepare(
    `
      UPDATE world_render_tile_outbox
      SET state = 'dispatched', dispatched_at = ?, updated_at = ?
      WHERE id = ? AND state = 'dispatching'
    `
  ).bind(now, now, id).run();
}

export async function markOutboxDispatchFailed(
  db: D1Database,
  id: number,
  error: string,
  now: string
): Promise<void> {
  await db.prepare(
    `
      UPDATE world_render_tile_outbox
      SET state = 'pending', last_dispatch_error = ?, updated_at = ?
      WHERE id = ? AND state = 'dispatching'
    `
  ).bind(error.slice(0, 2_000), now, id).run();
}

export async function requeueCurrentWorldTileGeneration(
  db: D1Database,
  input: {
    address: WorldTileAddress;
    generation: number;
    now: string;
    reason: string;
  }
): Promise<boolean> {
  const result = await db.prepare(
    `
      INSERT INTO world_render_tile_outbox (
        renderer_version, level, tile_x, tile_y, generation, reason,
        state, dispatch_attempts, last_dispatch_error,
        created_at, updated_at, dispatched_at
      )
      SELECT
        renderer_version, level, tile_x, tile_y, desired_generation, ?,
        'pending', 0, NULL, ?, ?, NULL
      FROM world_render_tiles
      WHERE renderer_version = ? AND level = ? AND tile_x = ? AND tile_y = ?
        AND desired_generation = ?
      ON CONFLICT (renderer_version, level, tile_x, tile_y, generation) DO UPDATE SET
        state = 'pending',
        reason = excluded.reason,
        last_dispatch_error = NULL,
        dispatched_at = NULL,
        updated_at = excluded.updated_at
    `
  ).bind(
    input.reason.slice(0, 160),
    input.now,
    input.now,
    input.address.rendererVersion,
    input.address.level,
    input.address.x,
    input.address.y,
    input.generation
  ).run();
  return changed(result.meta?.changes);
}

export async function recoverExpiredLeases(
  db: D1Database,
  now: string
): Promise<number> {
  const [, leaseResult] = await db.batch([
    db.prepare(
      `
        INSERT INTO world_render_tile_outbox (
          renderer_version, level, tile_x, tile_y, generation, reason,
          state, dispatch_attempts, last_dispatch_error,
          created_at, updated_at, dispatched_at
        )
        SELECT
          renderer_version, level, tile_x, tile_y, desired_generation,
          'expired-lease-repair', 'pending', 0, 'expired lease recovered', ?, ?, NULL
        FROM world_render_tiles
        WHERE rowid IN (
          SELECT rowid
          FROM world_render_tiles
          WHERE lease_expires_at IS NOT NULL
            AND lease_expires_at < ?
            AND (ready_generation IS NULL OR ready_generation != desired_generation)
          ORDER BY updated_at ASC
          LIMIT 256
        )
        ON CONFLICT (renderer_version, level, tile_x, tile_y, generation) DO UPDATE SET
          state = 'pending',
          reason = 'expired-lease-repair',
          last_dispatch_error = 'expired lease recovered',
          dispatched_at = NULL,
          updated_at = excluded.updated_at
      `
    ).bind(now, now, now),
    db.prepare(
      `
        UPDATE world_render_tiles
        SET lease_owner = NULL, lease_generation = NULL, lease_expires_at = NULL,
            last_error = 'expired lease recovered', updated_at = ?
        WHERE rowid IN (
          SELECT rowid
          FROM world_render_tiles
          WHERE lease_expires_at IS NOT NULL
            AND lease_expires_at < ?
            AND (ready_generation IS NULL OR ready_generation != desired_generation)
          ORDER BY updated_at ASC
          LIMIT 256
        )
      `
    ).bind(now, now),
  ]);
  return Number(leaseResult?.meta?.changes ?? 0);
}

export async function listReferencedR2Keys(db: D1Database): Promise<Set<string>> {
  const response = await db.prepare(
    `SELECT DISTINCT r2_key FROM world_render_tiles WHERE r2_key IS NOT NULL ORDER BY r2_key`
  ).all<{ r2_key: string }>();
  return new Set(response.results.map((row) => row.r2_key));
}

interface PublishReadyBase {
  address: WorldTileAddress;
  generation: number;
  leaseOwner: string;
  now: string;
}

function changed(value: number | undefined): boolean {
  return typeof value === 'number' && value > 0;
}
