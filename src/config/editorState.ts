import {
  DEFAULT_ROOM_LIGHTING_DARKNESS,
  DEFAULT_ROOM_LIGHTING_RADIUS,
  type RoomLightingMode,
} from '../lighting/model';
import {
  DEFAULT_ROOM_WEATHER_INTENSITY,
  type RoomWeatherMode,
} from '../weather/model';
import { getTilesetByKey } from './tilesets';
import {
  TILE_FLIP_X_FLAG,
  TILE_FLIP_Y_FLAG,
  type DecodedTileDataValue,
  type EraserBrushSize,
  type LayerName,
  type PaletteMode,
  type TileSelection,
  type ToolName,
} from './room';
import type { PlacedObject } from './objects';

// ── Editor State (shared between Phaser and HTML UI) ──
export interface EditorState {
  activeTool: ToolName;
  activeLayer: LayerName;
  selectedTilesetKey: string;
  selectedTileGid: number;  // global tile ID of top-left of selection
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
  selectedBackground: string;        // BackgroundGroup.id or solid:#RRGGBB
  selectedSolidBackgroundColor: string;
  selectedLightingMode: RoomLightingMode;
  selectedLightingDarkness: number;
  selectedLightingRadius: number;
  selectedWeatherMode: RoomWeatherMode;
  selectedWeatherIntensity: number;
  placedObjects: PlacedObject[];
}

const DEFAULT_EDITOR_TILESET_KEY = 'essentials';
const DEFAULT_EDITOR_SELECTION_START_COL = 0;
const DEFAULT_EDITOR_SELECTION_START_ROW = 0;
const DEFAULT_EDITOR_TILESET = getTilesetByKey(DEFAULT_EDITOR_TILESET_KEY);
const DEFAULT_EDITOR_SELECTED_TILE_GID =
  (DEFAULT_EDITOR_TILESET?.firstGid ?? 1) +
  DEFAULT_EDITOR_SELECTION_START_ROW * (DEFAULT_EDITOR_TILESET?.columns ?? 0) +
  DEFAULT_EDITOR_SELECTION_START_COL;

export function createDefaultEditorTileSelection(): TileSelection {
  return {
    tilesetKey: DEFAULT_EDITOR_TILESET_KEY,
    startCol: DEFAULT_EDITOR_SELECTION_START_COL,
    startRow: DEFAULT_EDITOR_SELECTION_START_ROW,
    width: 1,
    height: 1,
    occupiedMask: [[true]],
  };
}

export const editorState: EditorState = {
  activeTool: 'pencil',
  activeLayer: 'terrain',
  selectedTilesetKey: DEFAULT_EDITOR_TILESET_KEY,
  selectedTileGid: DEFAULT_EDITOR_SELECTED_TILE_GID,
  eraserBrushSize: 1,
  tileFlipX: false,
  tileFlipY: false,
  showLayerGuides: false,
  selection: createDefaultEditorTileSelection(),
  zoom: 2,
  isPlaying: false,
  paletteMode: 'tiles',
  selectedObjectId: null,
  objectFacing: 'right',
  selectedBackground: 'none',
  selectedSolidBackgroundColor: '#24324a',
  selectedLightingMode: 'off',
  selectedLightingDarkness: DEFAULT_ROOM_LIGHTING_DARKNESS,
  selectedLightingRadius: DEFAULT_ROOM_LIGHTING_RADIUS,
  selectedWeatherMode: 'off',
  selectedWeatherIntensity: DEFAULT_ROOM_WEATHER_INTENSITY,
  placedObjects: [],
};

export function resetEditorPaletteSelection(): void {
  editorState.selectedTilesetKey = DEFAULT_EDITOR_TILESET_KEY;
  editorState.selectedTileGid = DEFAULT_EDITOR_SELECTED_TILE_GID;
  editorState.selection = createDefaultEditorTileSelection();
}

export function selectEditorPaletteTile(
  tilesetKey: string,
  startCol: number,
  startRow: number,
): void {
  const tileset = getTilesetByKey(tilesetKey);
  if (!tileset) return;
  editorState.selectedTilesetKey = tilesetKey;
  editorState.selectedTileGid = tileset.firstGid + startRow * tileset.columns + startCol;
  editorState.selection = {
    tilesetKey,
    startCol,
    startRow,
    width: 1,
    height: 1,
    occupiedMask: [[true]],
  };
}

export function selectionCellIsOccupied(dx: number, dy: number): boolean {
  const row = editorState.selection.occupiedMask[dy];
  if (!row) return true;
  return row[dx] ?? true;
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
  const gid =
    value -
    (flipX ? TILE_FLIP_X_FLAG : 0) -
    (flipY ? TILE_FLIP_Y_FLAG : 0);

  return { gid, flipX, flipY };
}

// Helper: get the GID for a position within the current selection
export function getSelectionGid(dx: number, dy: number): number {
  const ts = getTilesetByKey(editorState.selection.tilesetKey);
  if (!ts) return editorState.selectedTileGid;
  if (!selectionCellIsOccupied(dx, dy)) return -1;
  const col = editorState.selection.startCol + dx;
  const row = editorState.selection.startRow + dy;
  return ts.firstGid + row * ts.columns + col;
}

export function getSelectionTileValue(dx: number, dy: number): number {
  const selectionDx = editorState.tileFlipX ? editorState.selection.width - 1 - dx : dx;
  const selectionDy = editorState.tileFlipY ? editorState.selection.height - 1 - dy : dy;
  const gid = getSelectionGid(selectionDx, selectionDy);
  return encodeTileDataValue(gid, editorState.tileFlipX, editorState.tileFlipY);
}
