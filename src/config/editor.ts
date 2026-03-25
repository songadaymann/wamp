import { encodeTileDataValue, type LayerName } from './room';
import type { PlacedObject } from './objects';
import { getTilesetByKey } from './tilesets';

export const TOOLS = ['pencil', 'rect', 'fill', 'eraser', 'copy'] as const;
export type ToolName = (typeof TOOLS)[number];
export const ERASER_BRUSH_SIZES = [1, 3, 5] as const;
export type EraserBrushSize = (typeof ERASER_BRUSH_SIZES)[number];

export type PaletteMode = 'tiles' | 'objects';

export interface TileSelection {
  tilesetKey: string;
  startCol: number;
  startRow: number;
  width: number;
  height: number;
  occupiedMask: boolean[][];
}

export interface EditorState {
  activeTool: ToolName;
  activeLayer: LayerName;
  selectedTilesetKey: string;
  selectedTileGid: number;
  eraserBrushSize: EraserBrushSize;
  tileFlipX: boolean;
  tileFlipY: boolean;
  showLayerGuides: boolean;
  selection: TileSelection;
  zoom: number;
  isPlaying: boolean;
  paletteMode: PaletteMode;
  selectedObjectId: string | null;
  objectFacing: 'left' | 'right';
  selectedBackground: string;
  placedObjects: PlacedObject[];
}

export const editorState: EditorState = {
  activeTool: 'pencil',
  activeLayer: 'terrain',
  selectedTilesetKey: 'forest',
  selectedTileGid: 1,
  eraserBrushSize: 1,
  tileFlipX: false,
  tileFlipY: false,
  showLayerGuides: false,
  selection: {
    tilesetKey: 'forest',
    startCol: 0,
    startRow: 0,
    width: 1,
    height: 1,
    occupiedMask: [[true]],
  },
  zoom: 2,
  isPlaying: false,
  paletteMode: 'tiles',
  selectedObjectId: null,
  objectFacing: 'right',
  selectedBackground: 'none',
  placedObjects: [],
};

export function selectionCellIsOccupied(dx: number, dy: number): boolean {
  const row = editorState.selection.occupiedMask[dy];
  if (!row) {
    return true;
  }
  return row[dx] ?? true;
}

export function getSelectionGid(dx: number, dy: number): number {
  const tileset = getTilesetByKey(editorState.selection.tilesetKey);
  if (!tileset) {
    return editorState.selectedTileGid;
  }
  if (!selectionCellIsOccupied(dx, dy)) {
    return -1;
  }
  const col = editorState.selection.startCol + dx;
  const row = editorState.selection.startRow + dy;
  return tileset.firstGid + row * tileset.columns + col;
}

export function getSelectionTileValue(dx: number, dy: number): number {
  const selectionDx = editorState.tileFlipX ? editorState.selection.width - 1 - dx : dx;
  const selectionDy = editorState.tileFlipY ? editorState.selection.height - 1 - dy : dy;
  const gid = getSelectionGid(selectionDx, selectionDy);
  return encodeTileDataValue(gid, editorState.tileFlipX, editorState.tileFlipY);
}
