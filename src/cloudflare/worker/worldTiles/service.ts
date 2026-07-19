import {
  WORLD_TILE_IMAGE_HEIGHT,
  WORLD_TILE_IMAGE_WIDTH,
  WORLD_TILE_OVERLAP,
  WORLD_TILE_SCHEMA_VERSION,
  assertWorldTileBounds,
  compareWorldTileCoordinates,
  expandWorldTileManifestCoordinates,
  getWorldTileRoomBounds,
  worldTileCoordinateKey,
  type WorldTileAddress,
  type WorldTileBounds,
  type WorldTileConfig,
  type WorldTileCoordinate,
  type WorldTileLevel,
  type WorldTileManifest,
  type WorldTileManifestEntry,
  type WorldTileManifestReady,
  type WorldTileRoomBounds,
  type WorldTileRoomSummary,
} from '../../../worldTiles/model';
import type { Env } from '../core/types';
import {
  loadActiveWorldTileRendererVersion,
  loadPendingWorldTileOutbox,
  loadWorldTileManifestReadSet,
  markWorldTileOutboxDispatchFailed,
  markWorldTileOutboxDispatching,
  markWorldTileOutboxDispatched,
  type WorldRenderTileManifestRow,
  type WorldRenderTileOutboxRow,
  type WorldRenderTileStaleLeafRow,
} from './store';

export interface WorldTileEnvironmentFlags {
  WORLD_TILE_GENERATION_ENABLED?: string;
  TILED_OVERWORLD_READS?: string;
  TILED_OVERWORLD_ROLLOUT_PERCENT?: string;
  WORLD_TILE_PUBLIC_BASE_URL?: string;
}

export type WorldTileServiceEnv = Pick<Env, 'DB'> & WorldTileEnvironmentFlags;

export interface WorldTileManifestLoadResult {
  manifest: WorldTileManifest;
  etag: string;
}

export interface WorldTileGenerationJob {
  schemaVersion: 1;
  rendererVersion: string;
  level: WorldTileLevel;
  x: number;
  y: number;
  generation: number;
  reason: string;
  enqueuedAt: string;
}

export interface WorldTileQueueBinding {
  sendBatch(messages: Array<{ body: WorldTileGenerationJob }>): Promise<void>;
}

export async function loadWorldTileConfig(
  env: WorldTileServiceEnv,
): Promise<WorldTileConfig> {
  const activeRenderer = await loadActiveWorldTileRendererVersion(env);
  const publicBaseUrl = normalizeWorldTilePublicBaseUrl(env.WORLD_TILE_PUBLIC_BASE_URL);
  return {
    schemaVersion: WORLD_TILE_SCHEMA_VERSION,
    available: worldTileReadsEnabled(env) && activeRenderer !== null && publicBaseUrl !== null,
    rolloutPercentage: parseWorldTileRolloutPercentage(env.TILED_OVERWORLD_ROLLOUT_PERCENT),
    activeRendererVersion: activeRenderer?.version ?? null,
  };
}

export async function loadWorldTileManifest(
  env: WorldTileServiceEnv,
  level: WorldTileLevel,
  targetBounds: WorldTileBounds,
): Promise<WorldTileManifestLoadResult | null> {
  assertWorldTileBounds(targetBounds);
  if (!worldTileReadsEnabled(env)) return null;
  const publicBaseUrl = normalizeWorldTilePublicBaseUrl(env.WORLD_TILE_PUBLIC_BASE_URL);
  if (!publicBaseUrl) return null;
  const coordinates = expandWorldTileManifestCoordinates(level, targetBounds);
  const coverageRoomBounds = getCoordinateRoomBounds(coordinates);
  const targetRoomBounds = getTargetRoomBounds(level, targetBounds);
  const readSet = await loadWorldTileManifestReadSet(
    env,
    coordinates,
    coverageRoomBounds,
    targetRoomBounds,
  );
  if (!readSet.rendererVersion) return null;
  const manifest = buildWorldTileManifest({
    rendererVersion: readSet.rendererVersion,
    level,
    targetBounds,
    coordinates,
    tileRows: readSet.tileRows,
    leafChanges: readSet.leafChanges,
    rooms: readSet.rooms,
    publicBaseUrl,
  });
  return {
    manifest,
    etag: createWorldTileManifestEtag(manifest),
  };
}

export function buildWorldTileManifest(input: {
  rendererVersion: string;
  level: WorldTileLevel;
  targetBounds: WorldTileBounds;
  coordinates: WorldTileCoordinate[];
  tileRows: WorldRenderTileManifestRow[];
  leafChanges: WorldRenderTileStaleLeafRow[];
  rooms: WorldTileRoomSummary[];
  publicBaseUrl: string;
}): WorldTileManifest {
  assertWorldTileBounds(input.targetBounds);
  const rowByCoordinate = new Map(
    input.tileRows.map((row) => [
      worldTileCoordinateKey({ level: row.level, x: row.tile_x, y: row.tile_y }),
      row,
    ]),
  );
  const entries = [...input.coordinates]
    .sort(compareWorldTileCoordinates)
    .map((coordinate) => buildWorldTileManifestEntry(
      input.rendererVersion,
      coordinate,
      rowByCoordinate.get(worldTileCoordinateKey(coordinate)) ?? null,
      input.leafChanges,
      input.publicBaseUrl,
    ));
  const rooms = [...input.rooms].sort(compareWorldTileRoomSummaries);
  return {
    schemaVersion: WORLD_TILE_SCHEMA_VERSION,
    rendererVersion: input.rendererVersion,
    level: input.level,
    targetBounds: { ...input.targetBounds },
    entries,
    rooms,
  };
}

export function buildWorldTileManifestEntry(
  rendererVersion: string,
  coordinate: WorldTileCoordinate,
  row: WorldRenderTileManifestRow | null,
  leafChanges: WorldRenderTileStaleLeafRow[],
  publicBaseUrl: string,
): WorldTileManifestEntry {
  if (!row) {
    return {
      address: { rendererVersion, ...coordinate },
      desiredGeneration: 0,
      desiredEmpty: true,
      readyEmptyGeneration: 0,
      ready: null,
      staleRoomIds: [],
    };
  }
  return {
    address: { rendererVersion, ...coordinate },
    desiredGeneration: Number(row.desired_generation),
    desiredEmpty: row.desired_empty === 1,
    readyEmptyGeneration: row.ready_generation !== null && row.ready_empty === 1
      ? Number(row.ready_generation)
      : null,
    ready: buildReadyWorldTile(row, publicBaseUrl),
    staleRoomIds: findStaleRoomIds(row, coordinate, leafChanges),
  };
}

export function buildWorldTileGenerationJob(
  row: WorldRenderTileOutboxRow,
  enqueuedAt = new Date().toISOString(),
): WorldTileGenerationJob {
  return {
    schemaVersion: 1,
    rendererVersion: row.renderer_version,
    level: row.level,
    x: Number(row.tile_x),
    y: Number(row.tile_y),
    generation: Number(row.generation),
    reason: row.reason,
    enqueuedAt,
  };
}

export async function dispatchPendingWorldTileOutbox(
  env: Pick<Env, 'DB'>,
  queue: WorldTileQueueBinding,
  limit = 100,
): Promise<number> {
  const rows = await loadPendingWorldTileOutbox(env, limit);
  if (rows.length === 0) return 0;
  const enqueuedAt = new Date().toISOString();
  const claimedIds = await markWorldTileOutboxDispatching(
    env,
    rows.map((row) => row.id),
    enqueuedAt,
  );
  const claimedRows = rows.filter((row) => claimedIds.has(row.id));
  if (claimedRows.length === 0) return 0;
  try {
    await queue.sendBatch(claimedRows.map((row) => ({
      body: buildWorldTileGenerationJob(row, enqueuedAt),
    })));
    await markWorldTileOutboxDispatched(env, claimedRows.map((row) => row.id), enqueuedAt);
    return claimedRows.length;
  } catch (error) {
    await markWorldTileOutboxDispatchFailed(
      env,
      claimedRows.map((row) => row.id),
      error instanceof Error ? error.message : String(error),
      enqueuedAt,
    );
    throw error;
  }
}

export function worldTileReadsEnabled(env: WorldTileEnvironmentFlags): boolean {
  const normalized = env.TILED_OVERWORLD_READS?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'on';
}

export function worldTileGenerationEnabled(env: WorldTileEnvironmentFlags): boolean {
  const normalized = env.WORLD_TILE_GENERATION_ENABLED?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'on';
}

export function parseWorldTileRolloutPercentage(value: string | undefined): number {
  if (!value?.trim()) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed * 100) / 100));
}

export function normalizeWorldTilePublicBaseUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function createWorldTileManifestEtag(manifest: WorldTileManifest): string {
  const serialized = JSON.stringify(manifest);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `W/"world-tiles-${(hash >>> 0).toString(16).padStart(8, '0')}"`;
}

function buildReadyWorldTile(
  row: WorldRenderTileManifestRow,
  publicBaseUrl: string,
): WorldTileManifestReady | null {
  if (
    row.ready_generation === null
    || row.ready_empty !== 0
    || !row.ready_hash
    || !row.r2_key
    || row.byte_length === null
    || row.byte_length < 0
  ) {
    return null;
  }
  return {
    generation: Number(row.ready_generation),
    contentHash: row.ready_hash,
    url: `${publicBaseUrl}/${encodeR2Key(row.r2_key)}`,
    width: WORLD_TILE_IMAGE_WIDTH,
    height: WORLD_TILE_IMAGE_HEIGHT,
    overlap: WORLD_TILE_OVERLAP,
    byteLength: Number(row.byte_length),
  };
}

function findStaleRoomIds(
  row: WorldRenderTileManifestRow,
  coordinate: WorldTileCoordinate,
  leafChanges: WorldRenderTileStaleLeafRow[],
): string[] {
  if (
    row.ready_generation === null
    || row.ready_empty !== 0
    || !row.ready_at
  ) {
    return [];
  }
  const bounds = getWorldTileRoomBounds(coordinate);
  return leafChanges
    .filter((leaf) => (
      leaf.tile_x >= bounds.minRoomX
      && leaf.tile_x <= bounds.maxRoomX
      && leaf.tile_y >= bounds.minRoomY
      && leaf.tile_y <= bounds.maxRoomY
      && leaf.desired_empty === 1
      && leaf.desired_at > row.ready_at!
    ))
    .map((leaf) => `${leaf.tile_x},${leaf.tile_y}`)
    .sort(compareRoomIdsByCoordinates);
}

function getTargetRoomBounds(level: WorldTileLevel, targetBounds: WorldTileBounds): WorldTileRoomBounds {
  const first = getWorldTileRoomBounds({ level, x: targetBounds.minTileX, y: targetBounds.minTileY });
  const last = getWorldTileRoomBounds({ level, x: targetBounds.maxTileX, y: targetBounds.maxTileY });
  return {
    minRoomX: first.minRoomX,
    maxRoomX: last.maxRoomX,
    minRoomY: first.minRoomY,
    maxRoomY: last.maxRoomY,
  };
}

function getCoordinateRoomBounds(coordinates: WorldTileCoordinate[]): WorldTileRoomBounds {
  if (coordinates.length === 0) {
    throw new RangeError('A world tile manifest must contain at least one coordinate.');
  }
  const initial = getWorldTileRoomBounds(coordinates[0]);
  return coordinates.slice(1).reduce<WorldTileRoomBounds>((bounds, coordinate) => {
    const next = getWorldTileRoomBounds(coordinate);
    return {
      minRoomX: Math.min(bounds.minRoomX, next.minRoomX),
      maxRoomX: Math.max(bounds.maxRoomX, next.maxRoomX),
      minRoomY: Math.min(bounds.minRoomY, next.minRoomY),
      maxRoomY: Math.max(bounds.maxRoomY, next.maxRoomY),
    };
  }, initial);
}

function encodeR2Key(key: string): string {
  return key.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function compareWorldTileRoomSummaries(
  left: WorldTileRoomSummary,
  right: WorldTileRoomSummary,
): number {
  return left.coordinates.y - right.coordinates.y
    || left.coordinates.x - right.coordinates.x
    || left.id.localeCompare(right.id);
}

function compareRoomIdsByCoordinates(left: string, right: string): number {
  const [leftX, leftY] = left.split(',').map(Number);
  const [rightX, rightY] = right.split(',').map(Number);
  return leftY - rightY || leftX - rightX || left.localeCompare(right);
}

export function worldTileAddressFromOutbox(row: WorldRenderTileOutboxRow): WorldTileAddress {
  return {
    rendererVersion: row.renderer_version,
    level: row.level,
    x: Number(row.tile_x),
    y: Number(row.tile_y),
  };
}
