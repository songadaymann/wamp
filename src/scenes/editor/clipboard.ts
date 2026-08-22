import { ROOM_HEIGHT, ROOM_WIDTH, type LayerName } from '../../config';
import type { SmartTerrainCellState } from '../../autotiling/model';

export interface EditorClipboardState {
  sourceLayer: LayerName;
  width: number;
  height: number;
  tiles: number[][];
  occupiedMask: boolean[][];
  smartCells?: Record<string, SmartTerrainCellState>;
}

export interface ClipboardTileWrite {
  x: number;
  y: number;
  encodedTileValue: number;
}

export function cloneEditorClipboardState(
  state: EditorClipboardState | null,
): EditorClipboardState | null {
  return state
    ? {
        sourceLayer: state.sourceLayer,
        width: state.width,
        height: state.height,
        tiles: state.tiles.map((row) => [...row]),
        occupiedMask: state.occupiedMask.map((row) => [...row]),
        smartCells: state.smartCells
          ? Object.fromEntries(Object.entries(state.smartCells).map(([key, cell]) => [key, { ...cell }]))
          : undefined,
      }
    : null;
}

export function buildEditorClipboardState(
  sourceLayer: LayerName,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  getEncodedTileValue: (x: number, y: number) => number,
  getSmartCell?: (x: number, y: number) => SmartTerrainCellState | undefined,
): EditorClipboardState | null {
  const minX = Math.max(0, Math.min(x1, x2));
  const minY = Math.max(0, Math.min(y1, y2));
  const maxX = Math.min(ROOM_WIDTH - 1, Math.max(x1, x2));
  const maxY = Math.min(ROOM_HEIGHT - 1, Math.max(y1, y2));
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  if (width <= 0 || height <= 0) return null;

  const tiles: number[][] = [];
  const occupiedMask: boolean[][] = [];
  let hasOccupiedTiles = false;
  const smartCells: Record<string, SmartTerrainCellState> = {};
  for (let dy = 0; dy < height; dy += 1) {
    const tileRow: number[] = [];
    const occupiedRow: boolean[] = [];
    for (let dx = 0; dx < width; dx += 1) {
      const encodedTileValue = getEncodedTileValue(minX + dx, minY + dy);
      const occupied = encodedTileValue >= 0;
      tileRow.push(encodedTileValue);
      occupiedRow.push(occupied);
      hasOccupiedTiles ||= occupied;
      const smartCell = getSmartCell?.(minX + dx, minY + dy);
      if (smartCell) smartCells[`${dx},${dy}`] = { ...smartCell };
    }
    tiles.push(tileRow);
    occupiedMask.push(occupiedRow);
  }

  return hasOccupiedTiles
    ? {
        sourceLayer, width, height, tiles, occupiedMask,
        ...(Object.keys(smartCells).length > 0 ? { smartCells } : {}),
      }
    : null;
}

export function planEditorClipboardPaste(
  state: EditorClipboardState,
  baseTileX: number,
  baseTileY: number,
): ClipboardTileWrite[] {
  const writes: ClipboardTileWrite[] = [];
  for (let dy = 0; dy < state.height; dy += 1) {
    for (let dx = 0; dx < state.width; dx += 1) {
      if (!state.occupiedMask[dy]?.[dx]) continue;
      const x = baseTileX + dx;
      const y = baseTileY + dy;
      if (x < 0 || x >= ROOM_WIDTH || y < 0 || y >= ROOM_HEIGHT) continue;
      const encodedTileValue = state.tiles[dy]?.[dx] ?? -1;
      if (encodedTileValue < 0) continue;
      writes.push({ x, y, encodedTileValue });
    }
  }
  return writes;
}
