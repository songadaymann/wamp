import {
  decodeTileDataValue,
  getTilesetByKey,
  getTilesetByGid,
  TILE_SIZE,
} from '../../config';
import { applyRegisteredSmartBrushCells } from '../../autotiling/brushEngine';
import {
  createRoomSmartTerrainState,
  type SmartBrushId,
  type SmartStyleId,
} from '../../autotiling/model';
import {
  getSmartBrushDefinition,
  getSmartStyleDefinition,
  type SmartBrushDefinition,
} from '../../autotiling/registry';
import { createEmptyTileData } from '../../persistence/roomModel';

export const SMART_PREVIEW_COLUMNS = 5;
export const SMART_PREVIEW_ROWS = 3;

export function getSmartPreviewSize(brush: SmartBrushDefinition): { width: number; height: number } {
  return brush.previewSize ?? { width: SMART_PREVIEW_COLUMNS, height: SMART_PREVIEW_ROWS };
}

export interface SmartPreviewTile {
  x: number;
  y: number;
  path: string;
  sourceX: number;
  sourceY: number;
  flipX: boolean;
  flipY: boolean;
}

export function getSmartPreviewCells(brush: SmartBrushDefinition): Array<[number, number]> {
  if (brush.lineAxis) {
    const { width, height } = getSmartPreviewSize(brush);
    return Array.from({ length: width }, (_, x) => [x, Math.floor(height / 2)]);
  }
  if (brush.previewSize) {
    const { width, height } = brush.previewSize;
    return Array.from({ length: width * height }, (_, index) => [index % width, Math.floor(index / width)]);
  }
  if (brush.strokeAxis === 'vertical') {
    return [[2, 0], [2, 1], [2, 2]];
  }
  if (brush.strokeAxis === 'horizontal' || brush.ruleKind === 'path') {
    return [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]];
  }
  if (brush.rectangleMode === 'filled-shape') {
    return [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [1, 2], [2, 2], [3, 2]];
  }
  return [[0, 2], [1, 1], [1, 2], [2, 1], [2, 2], [3, 0], [3, 1], [3, 2], [4, 2]];
}

function createFallbackTiles(brush: SmartBrushDefinition, styleId: SmartStyleId): SmartPreviewTile[] {
  const resolvedStyleId = brush.supportedStyleIds.includes(styleId)
    ? styleId
    : brush.supportedStyleIds[0];
  const tileset = getTilesetByKey(getSmartStyleDefinition(resolvedStyleId).tilesetKey);
  const localIndex = brush.compatibleLegacyLocalIndices[0] ?? 0;
  if (!tileset) return [];
  return getSmartPreviewCells(brush).map(([x, y]) => ({
    x,
    y,
    path: tileset.path,
    sourceX: (localIndex % tileset.columns) * TILE_SIZE,
    sourceY: Math.floor(localIndex / tileset.columns) * TILE_SIZE,
    flipX: false,
    flipY: false,
  }));
}

export function buildSmartPreviewTiles(brushId: SmartBrushId, styleId: SmartStyleId): SmartPreviewTile[] {
  const brush = getSmartBrushDefinition(brushId);
  // Water predates the registered legacy brush dispatcher. Keep its preview
  // registry-derived until the water document moves behind that same adapter.
  if (brushId === 'water.tunnel') {
    return createFallbackTiles(brush, styleId);
  }

  try {
    const originX = 4;
    const originY = 4;
    const cells = getSmartPreviewCells(brush).map(([x, y]) => ({
      x: originX + x,
      y: originY + y,
    }));
    const document = applyRegisteredSmartBrushCells({
      tileData: createEmptyTileData(),
      smartTerrain: createRoomSmartTerrainState(),
    }, {
      cells,
      mode: 'paint',
      brushId,
      styleId,
      layer: brush.defaultLayer,
    });
    const tiles: SmartPreviewTile[] = [];
    const size = getSmartPreviewSize(brush);
    for (const layer of ['background', 'terrain', 'foreground'] as const) {
      for (let y = 0; y < size.height; y += 1) {
        for (let x = 0; x < size.width; x += 1) {
          const value = document.tileData[layer][originY + y]?.[originX + x] ?? -1;
          const decoded = decodeTileDataValue(value);
          const tileset = getTilesetByGid(decoded.gid);
          if (!tileset) continue;
          const localIndex = decoded.gid - tileset.firstGid;
          tiles.push({
            x,
            y,
            path: tileset.path,
            sourceX: (localIndex % tileset.columns) * TILE_SIZE,
            sourceY: Math.floor(localIndex / tileset.columns) * TILE_SIZE,
            flipX: decoded.flipX,
            flipY: decoded.flipY,
          });
        }
      }
    }
    return tiles;
  } catch {
    return createFallbackTiles(brush, styleId);
  }
}
