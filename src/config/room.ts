// ── Room Dimensions, editor layers, and tile encoding ──
export const TILE_SIZE = 16;
export const ROOM_WIDTH = 40;   // tiles
export const ROOM_HEIGHT = 22;  // tiles
export const ROOM_PX_WIDTH = ROOM_WIDTH * TILE_SIZE;   // 640
export const ROOM_PX_HEIGHT = ROOM_HEIGHT * TILE_SIZE;  // 352

// ── Layer Names ──
export const LAYER_NAMES = ['background', 'terrain', 'foreground'] as const;
export type LayerName = typeof LAYER_NAMES[number];

// ── Tools ──
export const TOOLS = ['pencil', 'rect', 'ellipse', 'line', 'fill', 'eraser', 'copy'] as const;
export type ToolName = typeof TOOLS[number];
export const ERASER_BRUSH_SIZES = [1, 3, 5] as const;
export type EraserBrushSize = typeof ERASER_BRUSH_SIZES[number];

// ── Palette Modes ──
export type PaletteMode = 'smart' | 'tiles' | 'objects';

// ── Tile Selection (multi-tile from palette) ──
export interface TileSelection {
  tilesetKey: string;
  startCol: number;
  startRow: number;
  width: number;   // in tiles
  height: number;  // in tiles
  occupiedMask: boolean[][];
}

export const TILE_FLIP_X_FLAG = 1 << 20;
export const TILE_FLIP_Y_FLAG = 1 << 21;

export interface DecodedTileDataValue {
  gid: number;
  flipX: boolean;
  flipY: boolean;
}
