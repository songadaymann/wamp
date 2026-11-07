import { TILE_SIZE, type TileFlipMode, type TileSelection } from './room';
import { getTilesetByGid, getTilesetByKey } from './tilesets';
import { diagonalPatternIndex, resolveSelectionPatternOrder } from './selectionPattern';

export type TriangleTileMode = 'wrap' | 'pattern' | 'shuffle';

export interface TriangleTilePaint {
  fill: boolean;
  mode: TriangleTileMode;
  slopeOnly: boolean;
  flipX: TileFlipMode;
  flipY: TileFlipMode;
  gids: number[];
  instanceKey: string;
}

export interface TriangleTileFields {
  triangleTileFill: boolean;
  triangleTileMode: TriangleTileMode;
  triangleTileSlopeOnly: boolean;
  triangleTileFlipX: TileFlipMode;
  triangleTileFlipY: TileFlipMode;
  triangleTileGids: number[];
}

const MAX_TRIANGLE_TILES = 512;

function normalizeTriangleTileMode(value: unknown): TriangleTileMode {
  return value === 'pattern' || value === 'shuffle' ? value : 'wrap';
}

function normalizeTriangleTileFlip(value: unknown): TileFlipMode {
  return value === 'on' || value === 'rand' ? value : 'off';
}

function normalizeTriangleTileGids(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const gids: number[] = [];
  for (const gid of value) {
    if (!Number.isInteger(gid) || gid <= 0) continue;
    gids.push(gid);
    if (gids.length >= MAX_TRIANGLE_TILES) break;
  }
  return gids;
}

export function normalizeTriangleTilePaint(placed: {
  instanceId?: string | null;
  triangleTileFill?: boolean | null;
  triangleTileMode?: string | null;
  triangleTileSlopeOnly?: boolean | null;
  triangleTileFlipX?: string | null;
  triangleTileFlipY?: string | null;
  triangleTileGids?: readonly number[] | null;
}): TriangleTilePaint {
  return {
    fill: placed.triangleTileFill === true,
    mode: normalizeTriangleTileMode(placed.triangleTileMode),
    slopeOnly: placed.triangleTileSlopeOnly === true,
    flipX: normalizeTriangleTileFlip(placed.triangleTileFlipX),
    flipY: normalizeTriangleTileFlip(placed.triangleTileFlipY),
    gids: normalizeTriangleTileGids(placed.triangleTileGids),
    instanceKey: placed.instanceId || 'triangle',
  };
}

export function triangleTileFieldsFromPaint(paint: TriangleTilePaint, fill = paint.fill): TriangleTileFields {
  return {
    triangleTileFill: fill,
    triangleTileMode: paint.mode,
    triangleTileSlopeOnly: paint.slopeOnly,
    triangleTileFlipX: paint.flipX,
    triangleTileFlipY: paint.flipY,
    triangleTileGids: paint.gids,
  };
}

export function orderedSelectionGids(selection: TileSelection): number[] {
  const tileset = getTilesetByKey(selection.tilesetKey);
  if (!tileset) return [];
  return resolveSelectionPatternOrder(selection).map((cell) => (
    tileset.firstGid + cell.row * tileset.columns + cell.col
  ));
}

export function editorSelectionFromGids(gids: number[]): {
  selectedTilesetKey: string;
  selectedTileGid: number;
  selection: TileSelection;
} | null {
  const tileset = gids.length > 0 ? getTilesetByGid(gids[0]) : null;
  if (!tileset) return null;
  const cells: Array<{ col: number; row: number }> = [];
  for (const gid of gids) {
    const owner = getTilesetByGid(gid);
    if (!owner || owner.key !== tileset.key) continue;
    const localIndex = gid - owner.firstGid;
    cells.push({
      col: localIndex % owner.columns,
      row: Math.floor(localIndex / owner.columns),
    });
  }
  if (cells.length === 0) return null;
  const startCol = Math.min(...cells.map((cell) => cell.col));
  const startRow = Math.min(...cells.map((cell) => cell.row));
  const width = Math.max(...cells.map((cell) => cell.col)) - startCol + 1;
  const height = Math.max(...cells.map((cell) => cell.row)) - startRow + 1;
  const occupiedMask = Array.from({ length: height }, () => Array.from({ length: width }, () => false));
  for (const cell of cells) occupiedMask[cell.row - startRow][cell.col - startCol] = true;
  return {
    selectedTilesetKey: tileset.key,
    selectedTileGid: tileset.firstGid + cells[0].row * tileset.columns + cells[0].col,
    selection: {
      tilesetKey: tileset.key,
      startCol,
      startRow,
      width,
      height,
      occupiedMask,
      patternOrder: cells,
    },
  };
}

export function triangleWrapDistance(cellX: number, cellY: number, legX: number, legY: number): number {
  if (legX === 0 || legY === 0) return 0;
  const rowTop = cellY * TILE_SIZE;
  const rowBottom = rowTop + TILE_SIZE;
  const yMin = Math.min(0, legY);
  const yMax = Math.max(0, legY);
  const hypAt = (y: number) => {
    const clamped = Math.min(yMax, Math.max(yMin, y));
    return legX - (clamped * legX) / legY;
  };
  const xTop = hypAt(rowTop + 0.01);
  const xBottom = hypAt(rowBottom - 0.01);
  // Start the wrap at the end of this row's hypotenuse closer to the vertical
  // edge. Every cell the line still crosses farther out stays on the first tile.
  const innerX = legX >= 0 ? Math.min(xTop, xBottom) : Math.max(xTop, xBottom);
  const onTheLine = innerX + (legX >= 0 ? 0.001 : -0.001);
  const hypCell = Math.floor(onTheLine / TILE_SIZE);
  const distance = legX >= 0 ? hypCell - cellX : cellX - hypCell;
  return Math.max(0, distance);
}

function stableIndex(key: string, cellX: number, cellY: number, count: number): number {
  if (count <= 0) return 0;
  let hash = 2166136261;
  const text = `${key}:${cellX}:${cellY}`;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  }
  return (hash >>> 0) % count;
}

export function triangleTilePoolIndex(
  mode: TriangleTileMode,
  cellX: number,
  cellY: number,
  legX: number,
  legY: number,
  count: number,
  instanceKey: string,
  slopeOnly = false,
): number {
  if (count <= 0) return 0;
  const reserveSlope = slopeOnly && count > 1;
  if (reserveSlope && triangleWrapDistance(cellX, cellY, legX, legY) === 0) return 0;
  const poolCount = reserveSlope ? count - 1 : count;
  const poolOffset = reserveSlope ? 1 : 0;
  if (mode === 'pattern') return poolOffset + diagonalPatternIndex(cellX, cellY, poolCount);
  if (mode === 'shuffle') return poolOffset + stableIndex(`${instanceKey}:shuffle`, cellX, cellY, poolCount);
  const step = reserveSlope
    ? triangleWrapDistance(cellX, cellY, legX, legY) - 1
    : triangleWrapDistance(cellX, cellY, legX, legY);
  return poolOffset + ((step % poolCount) + poolCount) % poolCount;
}

export function triangleCellFlip(
  mode: TileFlipMode,
  instanceKey: string,
  axis: 'x' | 'y',
  cellX: number,
  cellY: number,
): boolean {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return stableIndex(`${instanceKey}:${axis}`, cellX, cellY, 2) === 1;
}

export function trianglePixelLayer(nearestEdge: number, tileAlpha: number | null): 'stroke' | 'tile' | 'background' {
  if (nearestEdge < 1) return 'stroke';
  if (tileAlpha === null || tileAlpha < 16) return 'background';
  return 'tile';
}

export function triangleTileTextureToken(paint: TriangleTilePaint | null | undefined): string {
  if (!paint?.fill || paint.gids.length === 0) return 'solid';
  const random = paint.mode === 'shuffle' || paint.flipX === 'rand' || paint.flipY === 'rand';
  // wrap2 rebuilds cached textures after the hypotenuse measurement moved to the inner edge of each row.
  const mode = paint.mode === 'wrap' ? 'wrap2' : paint.mode;
  const slope = paint.slopeOnly ? ':slope' : '';
  return `${mode}${slope}:${paint.flipX}:${paint.flipY}:${paint.gids.join('.')}${random ? `:${paint.instanceKey}` : ''}`;
}
