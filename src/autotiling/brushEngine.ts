import type { LayerName } from '../config/room';
import {
  getLegacySmartBrushIdentity,
  type SmartBrushId,
  type SmartCellCoordinate,
  type SmartStyleId,
} from './model';
import {
  getSmartRecipeEngineAdapter,
} from './recipeSolver';
import {
  getSmartBrushDefinition,
  type SmartBrushDefinition,
} from './registry';
import {
  applySmartCells,
  applySmartOutlineCells,
  type SmartTerrainDocument,
} from './solver';

export interface ApplyRegisteredSmartBrushCellsOptions {
  cells: Iterable<SmartCellCoordinate>;
  mode: 'paint' | 'erase';
  brushId: SmartBrushId;
  styleId: SmartStyleId;
  layer?: LayerName;
}

export interface ApplyRegisteredSmartBrushOutlineOptions {
  filledCells: Iterable<SmartCellCoordinate>;
  outlineCells: Iterable<SmartCellCoordinate>;
  brushId: SmartBrushId;
  styleId: SmartStyleId;
  layer?: LayerName;
}

function assertRegisteredStyle(
  brush: SmartBrushDefinition,
  styleId: SmartStyleId,
): void {
  if (!brush.supportedStyleIds.includes(styleId)) {
    throw new RangeError(`Smart brush ${brush.id} does not support style ${styleId}.`);
  }
}

function getLegacyBrushIdentity(brush: SmartBrushDefinition) {
  const identity = getLegacySmartBrushIdentity(brush.id);
  if (!identity) {
    throw new RangeError(`Legacy Smart brush ${brush.id} has no terrain identity.`);
  }
  return identity;
}

/**
 * Registry-driven solver dispatch. Editor callers do not need to know whether
 * a brush is backed by the compatible legacy terrain solver or a recipe engine.
 */
export function applyRegisteredSmartBrushCells(
  document: SmartTerrainDocument,
  options: ApplyRegisteredSmartBrushCellsOptions,
): SmartTerrainDocument {
  const brush = getSmartBrushDefinition(options.brushId);
  if (brush.engine === 'legacy-terrain') {
    const identity = getLegacyBrushIdentity(brush);
    return applySmartCells(document, {
      cells: options.cells,
      mode: options.mode,
      theme: identity.theme,
      material: identity.material,
      layer: options.layer,
    });
  }
  assertRegisteredStyle(brush, options.styleId);
  return getSmartRecipeEngineAdapter(options.brushId).applyCells(document, options);
}

export function applyRegisteredSmartBrushOutlineCells(
  document: SmartTerrainDocument,
  options: ApplyRegisteredSmartBrushOutlineOptions,
): SmartTerrainDocument {
  const brush = getSmartBrushDefinition(options.brushId);
  if (brush.engine === 'legacy-terrain') {
    const identity = getLegacyBrushIdentity(brush);
    return applySmartOutlineCells(document, {
      filledCells: options.filledCells,
      outlineCells: options.outlineCells,
      theme: identity.theme,
      material: identity.material,
      layer: options.layer,
    });
  }
  assertRegisteredStyle(brush, options.styleId);
  return getSmartRecipeEngineAdapter(options.brushId).applyOutlineCells(document, options);
}

export function constrainRegisteredSmartBrushStroke(
  brushId: SmartBrushId,
  cell: SmartCellCoordinate,
  anchor: SmartCellCoordinate,
): SmartCellCoordinate {
  switch (getSmartBrushDefinition(brushId).strokeAxis) {
    case 'horizontal':
      return { x: cell.x, y: anchor.y };
    case 'vertical':
      return { x: anchor.x, y: cell.y };
    case 'free':
      return cell;
  }
}

/** Returns a registry-defined Rectangle source, or null for the normal shape. */
export function getRegisteredSmartBrushRectangleCells(
  brushId: SmartBrushId,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): SmartCellCoordinate[] | null {
  const brush = getSmartBrushDefinition(brushId);
  if (brush.rectangleMode === 'shape') return null;
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  if (brush.rectangleMode === 'filled-shape') {
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    const cells: SmartCellCoordinate[] = [];
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) cells.push({ x, y });
    }
    return cells;
  }
  return Array.from({ length: maxX - minX + 1 }, (_, offset) => ({
    x: minX + offset,
    y: y1,
  }));
}

export function getRegisteredSmartSemanticOwnerId(
  brushId: SmartBrushId,
  semanticKey: string,
): string {
  const brush = getSmartBrushDefinition(brushId);
  return brush.engine === 'legacy-terrain'
    ? `legacy-semantic:${semanticKey}`
    : getSmartRecipeEngineAdapter(brushId).semanticOwnerId(semanticKey);
}

export function getRegisteredSmartRecipeOwnerId(
  brushId: SmartBrushId,
  instanceId: string,
): string {
  const brush = getSmartBrushDefinition(brushId);
  if (brush.engine === 'legacy-terrain') {
    throw new RangeError(`Legacy Smart brush ${brushId} cannot own a recipe instance.`);
  }
  return getSmartRecipeEngineAdapter(brushId).recipeOwnerId(instanceId);
}

/** True when this brush's registered engine supports persisted recipe instances. */
export function isRegisteredSmartRecipeBrush(brushId: SmartBrushId): boolean {
  return getSmartBrushDefinition(brushId).engine !== 'legacy-terrain';
}
