import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../../config';
import type {
  WorldRoomBounds,
  WorldTileAddress,
  WorldTileBounds,
  WorldTileCoordinate,
  WorldTileLevel,
} from './types';

export const WORLD_TILE_MIN_LEVEL: WorldTileLevel = 0;
export const WORLD_TILE_MAX_LEVEL: WorldTileLevel = 4;
export const WORLD_TILE_LEVELS: readonly WorldTileLevel[] = [0, 1, 2, 3, 4];
export const WORLD_TILE_CONTENT_WIDTH = 640;
export const WORLD_TILE_CONTENT_HEIGHT = 352;
export const WORLD_TILE_OVERLAP = 1;
export const WORLD_TILE_IMAGE_WIDTH = WORLD_TILE_CONTENT_WIDTH + WORLD_TILE_OVERLAP * 2;
export const WORLD_TILE_IMAGE_HEIGHT = WORLD_TILE_CONTENT_HEIGHT + WORLD_TILE_OVERLAP * 2;

export function assertWorldTileLevel(value: number): asserts value is WorldTileLevel {
  if (!Number.isInteger(value) || value < WORLD_TILE_MIN_LEVEL || value > WORLD_TILE_MAX_LEVEL) {
    throw new RangeError(`World tile level must be an integer from 0 through 4; received ${value}.`);
  }
}

export function floorDivide(dividend: number, divisor: number): number {
  if (!Number.isSafeInteger(dividend)) {
    throw new RangeError(`Dividend must be a safe integer; received ${dividend}.`);
  }
  if (!Number.isSafeInteger(divisor) || divisor <= 0) {
    throw new RangeError(`Divisor must be a positive safe integer; received ${divisor}.`);
  }
  return Math.floor(dividend / divisor);
}

export function getRoomsPerWorldTile(level: WorldTileLevel): number {
  return 2 ** (WORLD_TILE_MAX_LEVEL - level);
}

export function getPixelsPerGameTile(level: WorldTileLevel): number {
  return 2 ** level;
}

export function getWorldTileSpan(level: WorldTileLevel): { width: number; height: number } {
  const roomSpan = getRoomsPerWorldTile(level);
  return {
    width: roomSpan * ROOM_PX_WIDTH,
    height: roomSpan * ROOM_PX_HEIGHT,
  };
}

export function getWorldTileCorePlacement(
  tile: Pick<WorldTileCoordinate, 'level' | 'x' | 'y'>,
): { x: number; y: number; width: number; height: number } {
  const span = getWorldTileSpan(tile.level);
  return {
    x: tile.x * span.width,
    y: tile.y * span.height,
    width: span.width,
    height: span.height,
  };
}

export function roomToWorldTileCoordinate(
  level: WorldTileLevel,
  roomX: number,
  roomY: number,
): WorldTileCoordinate {
  const roomSpan = getRoomsPerWorldTile(level);
  return {
    level,
    x: floorDivide(roomX, roomSpan),
    y: floorDivide(roomY, roomSpan),
  };
}

export function worldTileToRoomBounds(tile: WorldTileCoordinate): WorldRoomBounds {
  const roomSpan = getRoomsPerWorldTile(tile.level);
  const minRoomX = tile.x * roomSpan;
  const minRoomY = tile.y * roomSpan;
  return {
    minRoomX,
    maxRoomX: minRoomX + roomSpan - 1,
    minRoomY,
    maxRoomY: minRoomY + roomSpan - 1,
  };
}

export function getWorldTileParent(tile: WorldTileAddress): WorldTileAddress | null;
export function getWorldTileParent(tile: WorldTileCoordinate): WorldTileCoordinate | null;
export function getWorldTileParent(
  tile: WorldTileAddress | WorldTileCoordinate,
): WorldTileAddress | WorldTileCoordinate | null {
  if (tile.level === WORLD_TILE_MIN_LEVEL) {
    return null;
  }

  const parent = {
    level: (tile.level - 1) as WorldTileLevel,
    x: floorDivide(tile.x, 2),
    y: floorDivide(tile.y, 2),
  };
  return 'rendererVersion' in tile
    ? { ...parent, rendererVersion: tile.rendererVersion }
    : parent;
}

export function getWorldTileChildren(tile: WorldTileAddress): WorldTileAddress[];
export function getWorldTileChildren(tile: WorldTileCoordinate): WorldTileCoordinate[];
export function getWorldTileChildren(
  tile: WorldTileAddress | WorldTileCoordinate,
): Array<WorldTileAddress | WorldTileCoordinate> {
  if (tile.level === WORLD_TILE_MAX_LEVEL) {
    return [];
  }

  const childLevel = (tile.level + 1) as WorldTileLevel;
  const baseX = tile.x * 2;
  const baseY = tile.y * 2;
  const children: WorldTileCoordinate[] = [
    { level: childLevel, x: baseX, y: baseY },
    { level: childLevel, x: baseX + 1, y: baseY },
    { level: childLevel, x: baseX, y: baseY + 1 },
    { level: childLevel, x: baseX + 1, y: baseY + 1 },
  ];

  return 'rendererVersion' in tile
    ? children.map((child) => ({ ...child, rendererVersion: tile.rendererVersion }))
    : children;
}

export function worldRectToTileBounds(
  level: WorldTileLevel,
  rect: { left: number; top: number; right: number; bottom: number },
): WorldTileBounds {
  if (![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite)) {
    throw new RangeError('World rectangle values must be finite.');
  }
  if (rect.right <= rect.left || rect.bottom <= rect.top) {
    throw new RangeError('World rectangle must have positive width and height.');
  }

  const span = getWorldTileSpan(level);
  return {
    minTileX: Math.floor(rect.left / span.width),
    maxTileX: Math.ceil(rect.right / span.width) - 1,
    minTileY: Math.floor(rect.top / span.height),
    maxTileY: Math.ceil(rect.bottom / span.height) - 1,
  };
}

export function enumerateWorldTileBounds(
  rendererVersion: string,
  level: WorldTileLevel,
  bounds: WorldTileBounds,
): WorldTileAddress[] {
  if (bounds.maxTileX < bounds.minTileX || bounds.maxTileY < bounds.minTileY) {
    return [];
  }

  const result: WorldTileAddress[] = [];
  for (let y = bounds.minTileY; y <= bounds.maxTileY; y += 1) {
    for (let x = bounds.minTileX; x <= bounds.maxTileX; x += 1) {
      result.push({ rendererVersion, level, x, y });
    }
  }
  return result;
}
