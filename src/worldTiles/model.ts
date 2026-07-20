import type { RoomGoalType } from '../goals/roomGoals';

export type WorldTileLevel = 0 | 1 | 2 | 3 | 4;

export const WORLD_TILE_SCHEMA_VERSION = 1;
export const WORLD_TILE_MIN_LEVEL: WorldTileLevel = 0;
export const WORLD_TILE_MAX_LEVEL: WorldTileLevel = 4;
export const WORLD_TILE_CONTENT_WIDTH = 640;
export const WORLD_TILE_CONTENT_HEIGHT = 352;
export const WORLD_TILE_OVERLAP = 1;
export const WORLD_TILE_IMAGE_WIDTH = WORLD_TILE_CONTENT_WIDTH + (WORLD_TILE_OVERLAP * 2);
export const WORLD_TILE_IMAGE_HEIGHT = WORLD_TILE_CONTENT_HEIGHT + (WORLD_TILE_OVERLAP * 2);
export const WORLD_TILE_MAX_MANIFEST_AXIS = 16;
export const WORLD_TILE_R2_PREFIX = 'world-tiles/';

const ROOMS_PER_AXIS_BY_LEVEL: Readonly<Record<WorldTileLevel, number>> = {
  0: 16,
  1: 8,
  2: 4,
  3: 2,
  4: 1,
};

const PIXELS_PER_GAME_TILE_BY_LEVEL: Readonly<Record<WorldTileLevel, number>> = {
  0: 1,
  1: 2,
  2: 4,
  3: 8,
  4: 16,
};

export interface WorldTileAddress {
  rendererVersion: string;
  level: WorldTileLevel;
  x: number;
  y: number;
}

export interface WorldTileCoordinate {
  level: WorldTileLevel;
  x: number;
  y: number;
}

export interface WorldTileBounds {
  minTileX: number;
  maxTileX: number;
  minTileY: number;
  maxTileY: number;
}

export interface WorldTileRoomBounds {
  minRoomX: number;
  maxRoomX: number;
  minRoomY: number;
  maxRoomY: number;
}

export interface WorldTileManifestReady {
  generation: number;
  contentHash: string;
  url: string;
  width: typeof WORLD_TILE_IMAGE_WIDTH;
  height: typeof WORLD_TILE_IMAGE_HEIGHT;
  overlap: typeof WORLD_TILE_OVERLAP;
  byteLength: number;
}

export interface WorldTileManifestEntry {
  address: WorldTileAddress;
  desiredGeneration: number;
  desiredEmpty: boolean;
  /** A ready empty marker is complete coverage without an R2 object. */
  readyEmptyGeneration: number | null;
  ready: WorldTileManifestReady | null;
  staleRoomIds: string[];
}

export interface WorldTileRoomSummary {
  id: string;
  coordinates: { x: number; y: number };
  title: string | null;
  state: 'published';
  goalType: RoomGoalType | null;
  version: number;
  publishedAt: string | null;
  previewUpdatedAt: string | null;
  creatorUserId: string | null;
  creatorDisplayName: string | null;
}

export interface WorldTileManifest {
  schemaVersion: typeof WORLD_TILE_SCHEMA_VERSION;
  rendererVersion: string;
  level: WorldTileLevel;
  targetBounds: WorldTileBounds;
  entries: WorldTileManifestEntry[];
  rooms: WorldTileRoomSummary[];
}

export interface WorldTileConfig {
  schemaVersion: typeof WORLD_TILE_SCHEMA_VERSION;
  available: boolean;
  rolloutPercentage: number;
  activeRendererVersion: string | null;
}

export function isWorldTileLevel(value: number): value is WorldTileLevel {
  return Number.isInteger(value) && value >= WORLD_TILE_MIN_LEVEL && value <= WORLD_TILE_MAX_LEVEL;
}

export function assertWorldTileLevel(value: number): asserts value is WorldTileLevel {
  if (!isWorldTileLevel(value)) {
    throw new RangeError('World tile level must be an integer between 0 and 4.');
  }
}

export function getWorldTileRoomsPerAxis(level: WorldTileLevel): number {
  return ROOMS_PER_AXIS_BY_LEVEL[level];
}

export function getWorldTilePixelsPerGameTile(level: WorldTileLevel): number {
  return PIXELS_PER_GAME_TILE_BY_LEVEL[level];
}

export function floorDivide(value: number, divisor: number): number {
  if (!Number.isSafeInteger(value) || !Number.isSafeInteger(divisor) || divisor <= 0) {
    throw new RangeError('World tile floor division requires a safe integer and a positive divisor.');
  }
  return Math.floor(value / divisor);
}

export function roomToWorldTileCoordinate(
  room: { x: number; y: number },
  level: WorldTileLevel,
): WorldTileCoordinate {
  const roomsPerAxis = getWorldTileRoomsPerAxis(level);
  return {
    level,
    x: floorDivide(room.x, roomsPerAxis),
    y: floorDivide(room.y, roomsPerAxis),
  };
}

export function getWorldTileRoomBounds(
  tile: Pick<WorldTileCoordinate, 'level' | 'x' | 'y'>,
): WorldTileRoomBounds {
  const roomsPerAxis = getWorldTileRoomsPerAxis(tile.level);
  const minRoomX = tile.x * roomsPerAxis;
  const minRoomY = tile.y * roomsPerAxis;
  return {
    minRoomX,
    maxRoomX: minRoomX + roomsPerAxis - 1,
    minRoomY,
    maxRoomY: minRoomY + roomsPerAxis - 1,
  };
}

export function getWorldTileParent(
  tile: Pick<WorldTileCoordinate, 'level' | 'x' | 'y'>,
): WorldTileCoordinate | null {
  if (tile.level === WORLD_TILE_MIN_LEVEL) return null;
  const level = (tile.level - 1) as WorldTileLevel;
  return {
    level,
    x: floorDivide(tile.x, 2),
    y: floorDivide(tile.y, 2),
  };
}

export function getWorldTileChildren(
  tile: Pick<WorldTileCoordinate, 'level' | 'x' | 'y'>,
): WorldTileCoordinate[] {
  if (tile.level === WORLD_TILE_MAX_LEVEL) return [];
  const level = (tile.level + 1) as WorldTileLevel;
  const minX = tile.x * 2;
  const minY = tile.y * 2;
  return [
    { level, x: minX, y: minY },
    { level, x: minX + 1, y: minY },
    { level, x: minX, y: minY + 1 },
    { level, x: minX + 1, y: minY + 1 },
  ];
}

export function getWorldTileSiblingClosure(
  tile: Pick<WorldTileCoordinate, 'level' | 'x' | 'y'>,
): WorldTileCoordinate[] {
  const parent = getWorldTileParent(tile);
  return parent ? getWorldTileChildren(parent) : [{ ...tile }];
}

export function getWorldTileAncestors(
  tile: Pick<WorldTileCoordinate, 'level' | 'x' | 'y'>,
): WorldTileCoordinate[] {
  const ancestors: WorldTileCoordinate[] = [];
  let cursor = getWorldTileParent(tile);
  while (cursor) {
    ancestors.push(cursor);
    cursor = getWorldTileParent(cursor);
  }
  return ancestors;
}

export function worldTileCoordinateKey(
  tile: Pick<WorldTileCoordinate, 'level' | 'x' | 'y'>,
): string {
  return `${tile.level}:${tile.x}:${tile.y}`;
}

export function compareWorldTileCoordinates(
  left: Pick<WorldTileCoordinate, 'level' | 'x' | 'y'>,
  right: Pick<WorldTileCoordinate, 'level' | 'x' | 'y'>,
): number {
  return left.level - right.level || left.y - right.y || left.x - right.x;
}

export function expandWorldTileManifestCoordinates(
  level: WorldTileLevel,
  bounds: WorldTileBounds,
): WorldTileCoordinate[] {
  assertWorldTileBounds(bounds);
  const coordinates = new Map<string, WorldTileCoordinate>();
  const add = (tile: WorldTileCoordinate) => coordinates.set(worldTileCoordinateKey(tile), tile);
  let frontier: WorldTileCoordinate[] = [];
  for (let y = bounds.minTileY; y <= bounds.maxTileY; y += 1) {
    for (let x = bounds.minTileX; x <= bounds.maxTileX; x += 1) {
      frontier.push({ level, x, y });
    }
  }

  while (frontier.length > 0) {
    const closure = new Map<string, WorldTileCoordinate>();
    for (const tile of frontier) {
      for (const sibling of getWorldTileSiblingClosure(tile)) {
        add(sibling);
        closure.set(worldTileCoordinateKey(sibling), sibling);
      }
    }

    const parents = new Map<string, WorldTileCoordinate>();
    for (const tile of closure.values()) {
      const parent = getWorldTileParent(tile);
      if (parent) parents.set(worldTileCoordinateKey(parent), parent);
    }
    frontier = [...parents.values()];
  }

  return [...coordinates.values()].sort(compareWorldTileCoordinates);
}

export function assertWorldTileBounds(bounds: WorldTileBounds): void {
  const values = [bounds.minTileX, bounds.maxTileX, bounds.minTileY, bounds.maxTileY];
  if (!values.every(Number.isSafeInteger)) {
    throw new RangeError('World tile bounds must contain safe integers.');
  }
  if (bounds.minTileX > bounds.maxTileX || bounds.minTileY > bounds.maxTileY) {
    throw new RangeError('World tile bounds must be ordered.');
  }
  const width = bounds.maxTileX - bounds.minTileX + 1;
  const height = bounds.maxTileY - bounds.minTileY + 1;
  if (width > WORLD_TILE_MAX_MANIFEST_AXIS || height > WORLD_TILE_MAX_MANIFEST_AXIS) {
    throw new RangeError('World tile manifest windows may not exceed 16 by 16 tiles.');
  }
}
