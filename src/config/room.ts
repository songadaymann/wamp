export const TILE_SIZE = 16;
export const ROOM_WIDTH = 40; // tiles
export const ROOM_HEIGHT = 22; // tiles
export const ROOM_PX_WIDTH = ROOM_WIDTH * TILE_SIZE; // 640
export const ROOM_PX_HEIGHT = ROOM_HEIGHT * TILE_SIZE; // 352

export const LAYER_NAMES = ['background', 'terrain', 'foreground'] as const;
export type LayerName = (typeof LAYER_NAMES)[number];

export const TILE_FLIP_X_FLAG = 1 << 20;
export const TILE_FLIP_Y_FLAG = 1 << 21;

export interface DecodedTileDataValue {
  gid: number;
  flipX: boolean;
  flipY: boolean;
}

export function encodeTileDataValue(gid: number, flipX = false, flipY = false): number {
  if (gid <= 0) {
    return -1;
  }

  let encoded = gid;
  if (flipX) {
    encoded += TILE_FLIP_X_FLAG;
  }
  if (flipY) {
    encoded += TILE_FLIP_Y_FLAG;
  }
  return encoded;
}

export function decodeTileDataValue(value: number): DecodedTileDataValue {
  if (value <= 0) {
    return { gid: -1, flipX: false, flipY: false };
  }

  const flipX = value >= TILE_FLIP_X_FLAG && Math.floor(value / TILE_FLIP_X_FLAG) % 2 === 1;
  const flipY = value >= TILE_FLIP_Y_FLAG && Math.floor(value / TILE_FLIP_Y_FLAG) % 2 === 1;
  const gid = value - (flipX ? TILE_FLIP_X_FLAG : 0) - (flipY ? TILE_FLIP_Y_FLAG : 0);

  return { gid, flipX, flipY };
}
