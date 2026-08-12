import type { PublishedRoomBounds, WorldTileLevel } from './bounds';
import {
  roomToTileCoordinate,
  roomsPerAxisForLevel,
  TILE_CONTENT_HEIGHT,
  TILE_CONTENT_WIDTH,
  TILE_OVERLAP,
} from './bounds';
import { MAX_STITCH_TILES } from './config';

export interface MapScreenshotDb {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
      all<T>(): Promise<{ results: T[] }>;
    };
  };
}

export interface StitchTile {
  level: WorldTileLevel;
  tileX: number;
  tileY: number;
  url: string;
  /** World-pixel origin of the tile's content rectangle (excludes gutter). */
  worldX: number;
  worldY: number;
  worldWidth: number;
  worldHeight: number;
}

interface BoundsRow {
  min_x: number | null;
  max_x: number | null;
  min_y: number | null;
  max_y: number | null;
  room_count: number | null;
}

interface RendererRow {
  version: string;
}

interface TileRow {
  tile_x: number;
  tile_y: number;
  r2_key: string | null;
  ready_empty: number | null;
  ready_generation: number | null;
}

export async function loadPublishedRoomBounds(db: MapScreenshotDb): Promise<PublishedRoomBounds | null> {
  const row = await db.prepare(
    `
      SELECT
        MIN(x) AS min_x,
        MAX(x) AS max_x,
        MIN(y) AS min_y,
        MAX(y) AS max_y,
        COUNT(*) AS room_count
      FROM rooms
      WHERE published_json IS NOT NULL
    `,
  ).bind().first<BoundsRow>();

  if (
    !row
    || row.min_x === null
    || row.max_x === null
    || row.min_y === null
    || row.max_y === null
    || !row.room_count
  ) {
    return null;
  }

  return {
    minX: Number(row.min_x),
    maxX: Number(row.max_x),
    minY: Number(row.min_y),
    maxY: Number(row.max_y),
    roomCount: Number(row.room_count),
  };
}

export async function loadActiveRendererVersion(db: MapScreenshotDb): Promise<string | null> {
  const row = await db.prepare(
    `
      SELECT version
      FROM world_tile_renderer_versions
      WHERE status = 'active'
      ORDER BY activated_at DESC, created_at DESC, version ASC
      LIMIT 1
    `,
  ).bind().first<RendererRow>();
  return row?.version ?? null;
}

export async function loadStitchTiles(input: {
  db: MapScreenshotDb;
  rendererVersion: string;
  level: WorldTileLevel;
  roomMinX: number;
  roomMaxX: number;
  roomMinY: number;
  roomMaxY: number;
  publicBaseUrl: string;
}): Promise<StitchTile[]> {
  const minTile = roomToTileCoordinate(input.roomMinX, input.roomMinY, input.level);
  const maxTile = roomToTileCoordinate(input.roomMaxX, input.roomMaxY, input.level);
  const tileCount = (maxTile.x - minTile.x + 1) * (maxTile.y - minTile.y + 1);
  if (tileCount > MAX_STITCH_TILES) {
    throw new Error(
      `Stitch requires ${tileCount} tiles at L${input.level}; max is ${MAX_STITCH_TILES}. `
      + 'Increase MAX_STITCH_TILES or wait for a coarser zoom.',
    );
  }

  const rows = await input.db.prepare(
    `
      SELECT
        tile_x,
        tile_y,
        r2_key,
        ready_empty,
        ready_generation
      FROM world_render_tiles
      WHERE renderer_version = ?
        AND level = ?
        AND tile_x BETWEEN ? AND ?
        AND tile_y BETWEEN ? AND ?
        AND ready_generation IS NOT NULL
    `,
  ).bind(
    input.rendererVersion,
    input.level,
    minTile.x,
    maxTile.x,
    minTile.y,
    maxTile.y,
  ).all<TileRow>();

  const span = roomsPerAxisForLevel(input.level);
  const worldWidth = span * 640;
  const worldHeight = span * 352;
  const tiles: StitchTile[] = [];

  for (const row of rows.results) {
    if (row.ready_empty === 1 || !row.r2_key) continue;
    const tileX = Number(row.tile_x);
    const tileY = Number(row.tile_y);
    tiles.push({
      level: input.level,
      tileX,
      tileY,
      url: `${stripTrailingSlash(input.publicBaseUrl)}/${encodeR2Key(row.r2_key)}`,
      worldX: tileX * worldWidth,
      worldY: tileY * worldHeight,
      worldWidth,
      worldHeight,
    });
  }

  return tiles;
}

export function encodeR2Key(key: string): string {
  return key.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}

export {
  TILE_CONTENT_WIDTH,
  TILE_CONTENT_HEIGHT,
  TILE_OVERLAP,
};
