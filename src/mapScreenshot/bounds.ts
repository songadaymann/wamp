import {
  GAME_TILE_PX,
  PADDING_ROOMS,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
} from './config';

export type WorldTileLevel = 0 | 1 | 2 | 3 | 4;

export interface PublishedRoomBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  roomCount: number;
}

export interface PaddedRoomBounds extends PublishedRoomBounds {
  paddingRooms: number;
}

export interface WorldPixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export function padPublishedBounds(
  bounds: PublishedRoomBounds,
  paddingRooms: number = PADDING_ROOMS,
): PaddedRoomBounds {
  return {
    minX: bounds.minX - paddingRooms,
    maxX: bounds.maxX + paddingRooms,
    minY: bounds.minY - paddingRooms,
    maxY: bounds.maxY + paddingRooms,
    roomCount: bounds.roomCount,
    paddingRooms,
  };
}

export function roomBoundsToWorldPixels(bounds: Pick<PublishedRoomBounds, 'minX' | 'maxX' | 'minY' | 'maxY'>): WorldPixelRect {
  const left = bounds.minX * ROOM_PX_WIDTH;
  const top = bounds.minY * ROOM_PX_HEIGHT;
  const width = (bounds.maxX - bounds.minX + 1) * ROOM_PX_WIDTH;
  const height = (bounds.maxY - bounds.minY + 1) * ROOM_PX_HEIGHT;
  return {
    left,
    top,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2,
  };
}

export function roomsPerAxisForLevel(level: WorldTileLevel): number {
  return 2 ** (4 - level);
}

export function pixelsPerGameTileForLevel(level: WorldTileLevel): number {
  return 2 ** level;
}

export function worldPixelsPerContentPixel(level: WorldTileLevel): number {
  return GAME_TILE_PX / pixelsPerGameTileForLevel(level);
}

export function floorDivide(value: number, divisor: number): number {
  return Math.floor(value / divisor);
}

export function roomToTileCoordinate(
  roomX: number,
  roomY: number,
  level: WorldTileLevel,
): { x: number; y: number } {
  const span = roomsPerAxisForLevel(level);
  return {
    x: floorDivide(roomX, span),
    y: floorDivide(roomY, span),
  };
}

export function chooseTileLevelForZoom(zoom: number): WorldTileLevel {
  // Match overworld LOD bands so the stitch looks like the live map.
  if (zoom < 0.10) return 0;
  if (zoom < 0.20) return 1;
  if (zoom < 0.40) return 2;
  if (zoom < 0.80) return 3;
  return 4;
}

/** Published tile PNGs are always 640x352 content (+1px gutter) at every level. */
export const TILE_CONTENT_WIDTH = 640;
export const TILE_CONTENT_HEIGHT = 352;
export const TILE_OVERLAP = 1;
export const TILE_IMAGE_WIDTH = TILE_CONTENT_WIDTH + TILE_OVERLAP * 2;
export const TILE_IMAGE_HEIGHT = TILE_CONTENT_HEIGHT + TILE_OVERLAP * 2;
