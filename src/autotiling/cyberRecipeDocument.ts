/** Cyber-specific recipe document coordinator and editing operations. */
import type { LayerName } from '../config/room';
import type { RoomTileData } from '../persistence/roomModel';
import type { CyberStyleId } from './cyberProfile';
import {
  CYBER_PANEL_RECIPE_ID,
  isCyberSmartBrushId,
  isCyberSpanBrushId,
  isCyberStyleId,
  type CyberSpanBrushId,
} from './cyberRecipeFamily';
import { isCyberLetterBrushId } from './cyberEdgeMatcher';
import {
  cloneRoomSmartTerrainState,
  smartCellKey,
  smartOwnedOutputKey,
  smartRecipeOwnerId,
  smartSemanticCellKey,
  type RoomSmartTerrainState,
  type SmartBrushId,
  type SmartCellCoordinate,
  type SmartStyleId,
} from './model';
import { getSmartBrushDefinition } from './registry';
import {
  CYBER_CELL_OWNER_PREFIX,
  canonicalizeCyberSpanRecipes,
  clearCyberOwnedOutputs,
  clearOwnerSuppressions,
  cloneTileData,
  discardOwnedOutputsForOwners,
  inBounds,
  parseLayerCellKey,
  type ApplySmartBrushCellsOptions,
  type ApplySmartBrushOutlineCellsOptions,
  type Bounds,
  type SmartRecipeDocument,
} from './cyberRecipeState';
import {
  resolveCyberSemanticCells,
  resolveCyberStructuralOverlays,
} from './cyberSemanticResolver';
import {
  flattenLetterSpanRecipes,
  resolveCyberRecipes,
} from './cyberRecipeRenderer';

export function resolveCyberRecipeDocument(document: SmartRecipeDocument): SmartRecipeDocument {
  const tileData = cloneTileData(document.tileData);
  const smartTerrain = cloneRoomSmartTerrainState(document.smartTerrain);
  if (smartTerrain.editingDisabled) return { tileData, smartTerrain };
  flattenLetterSpanRecipes(smartTerrain);
  const resetOwnerIds = canonicalizeCyberSpanRecipes(smartTerrain);
  discardOwnedOutputsForOwners(tileData, smartTerrain, resetOwnerIds);
  clearCyberOwnedOutputs(tileData, smartTerrain);
  resolveCyberSemanticCells(tileData, smartTerrain);
  resolveCyberRecipes(tileData, smartTerrain);
  resolveCyberStructuralOverlays(tileData, smartTerrain);
  return { tileData, smartTerrain };
}

function clearCompatibilityCellAt(
  state: RoomSmartTerrainState,
  layer: LayerName,
  x: number,
  y: number,
): string | null {
  const key = smartCellKey(x, y);
  if (layer === 'terrain' && state.cells[key]) {
    delete state.cells[key];
    return key;
  }
  if (layer === 'background' && state.backdropCells[key]) {
    delete state.backdropCells[key];
    // Legacy generated decorations are owned only by Terrain compatibility
    // cells. A Background tunnel can share this coordinate with an independent
    // Ground owner, so removing the tunnel must not discard the Ground details.
    return null;
  }
  return null;
}

function discardLegacyDecorationsForOwners(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  ownerKeys: ReadonlySet<string>,
): void {
  if (ownerKeys.size === 0) return;
  for (const generated of [
    state.generatedDecorations,
    state.generatedBackgroundDecorations,
  ]) {
    for (const [targetKey, decoration] of Object.entries(generated)) {
      if (!ownerKeys.has(decoration.ownerKey)) continue;
      const [x, y] = targetKey.split(',').map(Number);
      if (inBounds(x, y)) {
        const expectedValue = decoration.value ?? decoration.gid;
        if ((tileData[decoration.layer][y]?.[x] ?? -1) === expectedValue) {
          tileData[decoration.layer][y][x] = -1;
        }
        const outputKey = smartOwnedOutputKey(decoration.layer, x, y);
        const output = state.ownedOutputs[outputKey];
        if (output?.ownerId === `legacy-cell:${decoration.ownerKey}`) {
          delete state.ownedOutputs[outputKey];
        }
      }
      delete generated[targetKey];
    }
  }
  const ownerSlotPrefixes = [...ownerKeys].map((ownerKey) => `${ownerKey}:`);
  state.suppressedDecorationSlots = state.suppressedDecorationSlots.filter(
    (slot) => !ownerSlotPrefixes.some((prefix) => slot.startsWith(prefix)),
  );
}

function clearShapeValuesAround(
  state: RoomSmartTerrainState,
  layer: LayerName,
  x: number,
  y: number,
  styleId: SmartStyleId,
  brushId: SmartBrushId,
): void {
  const offsets: readonly (readonly [number, number])[] = isCyberLetterBrushId(brushId)
    ? [
      [0, 0], [0, -1], [1, -1], [1, 0], [1, 1],
      [0, 1], [-1, 1], [-1, 0], [-1, -1],
    ]
    : [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]];
  for (const [dx, dy] of offsets) {
    const targetX = x + dx;
    const targetY = y + dy;
    const semantic = state.semanticCells[smartSemanticCellKey(layer, targetX, targetY)];
    const matches = isCyberLetterBrushId(brushId)
      ? Boolean(semantic && isCyberLetterBrushId(semantic.brushId))
      : semantic?.styleId === styleId && semantic.brushId === brushId;
    if (matches && semantic) delete semantic.shapeValue;
  }
}

function nextPanelInstanceId(state: RoomSmartTerrainState): string {
  let index = 1;
  while (state.recipes[`cyber-panel-${index}`]) index += 1;
  return `cyber-panel-${index}`;
}

function fenceCellsTouch(
  cells: ReadonlySet<string>,
  others: readonly { x: number; y: number }[],
): boolean {
  for (const { x, y } of others) {
    if (
      cells.has(`${x},${y}`)
      || cells.has(`${x - 1},${y}`)
      || cells.has(`${x + 1},${y}`)
      || cells.has(`${x},${y - 1}`)
      || cells.has(`${x},${y + 1}`)
    ) return true;
  }
  return false;
}

function fenceRecipeFromCells(
  layer: LayerName,
  cells: readonly { x: number; y: number }[],
): {
  sourceCells: Array<{ layer: LayerName; x: number; y: number }>;
  bounds: Bounds;
} {
  const bMinX = Math.min(...cells.map(({ x }) => x));
  const bMaxX = Math.max(...cells.map(({ x }) => x));
  const bMinY = Math.min(...cells.map(({ y }) => y));
  const bMaxY = Math.max(...cells.map(({ y }) => y));
  return {
    sourceCells: cells.map(({ x, y }) => ({ layer, x, y })),
    bounds: {
      minX: bMinX,
      minY: bMinY,
      maxX: bMaxX,
      maxY: bMaxY,
      width: bMaxX - bMinX + 1,
      height: bMaxY - bMinY + 1,
    },
  };
}

function removePanelRecipe(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  instanceId: string,
): void {
  const ownerId = state.recipes[instanceId]?.ownerId ?? smartRecipeOwnerId(instanceId);
  delete state.recipes[instanceId];
  for (const key of Object.keys(state.ownedOutputs)) {
    const output = state.ownedOutputs[key];
    if (output?.ownerId === ownerId) {
      const coord = parseLayerCellKey(key);
      if (coord && inBounds(coord.x, coord.y)) {
        const current = tileData[output.layer][coord.y]?.[coord.x] ?? -1;
        if (current === output.value) tileData[output.layer][coord.y][coord.x] = -1;
      }
      delete state.ownedOutputs[key];
    }
  }
  clearOwnerSuppressions(state, ownerId);
}

function applyPanelCells(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  cells: readonly SmartCellCoordinate[],
  mode: 'paint' | 'erase',
  styleId: CyberStyleId,
  layer: LayerName,
): void {
  if (mode === 'erase') {
    const erased = new Set(cells.map(({ x, y }) => `${x},${y}`));
    for (const [instanceId, recipe] of Object.entries(state.recipes)) {
      if (recipe.recipeId !== CYBER_PANEL_RECIPE_ID && recipe.recipeId !== 'cyber.framed-panel') continue;
      if (recipe.anchor.layer !== layer) continue;
      const remaining = recipe.sourceCells.filter((cell) => !erased.has(`${cell.x},${cell.y}`));
      if (remaining.length === recipe.sourceCells.length) continue;
      if (remaining.length === 0) {
        removePanelRecipe(tileData, state, instanceId);
        continue;
      }
      const next = fenceRecipeFromCells(layer, remaining);
      recipe.sourceCells = next.sourceCells;
      recipe.bounds = next.bounds;
      recipe.anchor = { layer, x: next.bounds.minX, y: next.bounds.minY };
      recipe.parameters = { width: next.bounds.width, height: next.bounds.height };
      clearOwnerSuppressions(state, recipe.ownerId);
    }
    return;
  }
  if (cells.length === 0) return;
  const cellSet = new Set(cells.map(({ x, y }) => `${x},${y}`));
  for (const [instanceId, recipe] of Object.entries(state.recipes)) {
    if (
      (recipe.recipeId !== CYBER_PANEL_RECIPE_ID && recipe.recipeId !== 'cyber.framed-panel')
      || recipe.anchor.layer !== layer
    ) continue;
    if (recipe.styleId === styleId && fenceCellsTouch(cellSet, recipe.sourceCells)) {
      for (const sc of recipe.sourceCells) cellSet.add(`${sc.x},${sc.y}`);
      removePanelRecipe(tileData, state, instanceId);
      continue;
    }
    if (recipe.styleId === styleId) continue;
    const remaining = recipe.sourceCells.filter((sc) => !cellSet.has(`${sc.x},${sc.y}`));
    if (remaining.length === recipe.sourceCells.length) continue;
    if (remaining.length === 0) {
      removePanelRecipe(tileData, state, instanceId);
      continue;
    }
    const next = fenceRecipeFromCells(layer, remaining);
    recipe.sourceCells = next.sourceCells;
    recipe.bounds = next.bounds;
    recipe.anchor = { layer, x: next.bounds.minX, y: next.bounds.minY };
    recipe.parameters = { width: next.bounds.width, height: next.bounds.height };
    clearOwnerSuppressions(state, recipe.ownerId);
  }
  const allCells: Array<{ x: number; y: number }> = [];
  for (const key of cellSet) {
    const [xStr, yStr] = key.split(',');
    allCells.push({ x: Number(xStr), y: Number(yStr) });
  }
  const instanceId = nextPanelInstanceId(state);
  const ownerId = smartRecipeOwnerId(instanceId);
  const next = fenceRecipeFromCells(layer, allCells);
  state.recipes[instanceId] = {
    recipeId: CYBER_PANEL_RECIPE_ID,
    ownerId,
    brushId: 'cyber.fence',
    styleId,
    anchor: { layer, x: next.bounds.minX, y: next.bounds.minY },
    bounds: next.bounds,
    sourceCells: next.sourceCells,
    parameters: { width: next.bounds.width, height: next.bounds.height },
  };
  clearOwnerSuppressions(state, ownerId);
}

function removeCyberSpanSourcesAt(
  state: RoomSmartTerrainState,
  layer: LayerName,
  targets: ReadonlySet<string>,
): Set<string> {
  const touchedOwnerIds = new Set<string>();
  for (const recipe of Object.values(state.recipes)) {
    if (!isCyberSpanBrushId(recipe.brushId)) continue;
    const sourceCells = recipe.sourceCells.filter((cell) => (
      cell.layer !== layer || !targets.has(smartCellKey(cell.x, cell.y))
    ));
    if (sourceCells.length === recipe.sourceCells.length) continue;
    recipe.sourceCells = sourceCells;
    clearOwnerSuppressions(state, recipe.ownerId);
    touchedOwnerIds.add(recipe.ownerId);
  }
  return touchedOwnerIds;
}

function applySpanCells(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  cells: readonly SmartCellCoordinate[],
  mode: 'paint' | 'erase',
  brushId: CyberSpanBrushId,
  styleId: CyberStyleId,
  layer: LayerName,
): void {
  const touchedOwnerIds = new Set<string>();
  const replacedLegacyOwnerKeys = new Set<string>();
  for (const { x, y } of cells) {
    const coordinateKey = smartCellKey(x, y);
    let alreadySameSource = false;
    for (const recipe of Object.values(state.recipes)) {
      if (!isCyberSpanBrushId(recipe.brushId)) continue;
      const sourceIndex = recipe.sourceCells.findIndex((source) => (
        source.layer === layer && source.x === x && source.y === y
      ));
      if (sourceIndex < 0) continue;
      if (mode === 'paint' && recipe.brushId === brushId && recipe.styleId === styleId) {
        alreadySameSource = true;
        clearOwnerSuppressions(state, recipe.ownerId);
        touchedOwnerIds.add(recipe.ownerId);
      } else {
        recipe.sourceCells.splice(sourceIndex, 1);
        clearOwnerSuppressions(state, recipe.ownerId);
        touchedOwnerIds.add(recipe.ownerId);
      }
    }

    const semanticKey = smartSemanticCellKey(layer, x, y);
    delete state.semanticCells[semanticKey];
    const replacedLegacyOwnerKey = clearCompatibilityCellAt(state, layer, x, y);
    if (replacedLegacyOwnerKey) replacedLegacyOwnerKeys.add(replacedLegacyOwnerKey);
    if (mode === 'paint' && !alreadySameSource) {
      state.semanticCells[semanticKey] = { styleId, brushId };
    } else if (mode === 'erase') {
      tileData[layer][y][x] = -1;
    }
    // Repainting is the explicit repair gesture for any manually suppressed part.
    for (const recipe of Object.values(state.recipes)) {
      if (!isCyberSpanBrushId(recipe.brushId)) continue;
      if (recipe.sourceCells.some((source) => (
        source.layer === layer && smartCellKey(source.x, source.y) === coordinateKey
      ))) {
        clearOwnerSuppressions(state, recipe.ownerId);
        touchedOwnerIds.add(recipe.ownerId);
      }
    }
  }
  discardLegacyDecorationsForOwners(tileData, state, replacedLegacyOwnerKeys);
  discardOwnedOutputsForOwners(tileData, state, touchedOwnerIds);
  const resetOwnerIds = canonicalizeCyberSpanRecipes(state);
  discardOwnedOutputsForOwners(tileData, state, resetOwnerIds);
}

export function applyCyberSmartBrushCells(
  document: SmartRecipeDocument,
  options: ApplySmartBrushCellsOptions,
): SmartRecipeDocument {
  const tileData = cloneTileData(document.tileData);
  const smartTerrain = cloneRoomSmartTerrainState(document.smartTerrain);
  if (smartTerrain.editingDisabled) return { tileData, smartTerrain };
  if (!isCyberSmartBrushId(options.brushId) || !isCyberStyleId(options.styleId)) {
    throw new RangeError(`Recipe solver cannot apply ${options.brushId}/${options.styleId}.`);
  }
  const brush = getSmartBrushDefinition(options.brushId);
  if (!brush.supportedStyleIds.includes(options.styleId)) {
    throw new RangeError(`Smart brush ${options.brushId} does not support style ${options.styleId}.`);
  }
  const cells = Array.from(options.cells).filter(({ x, y }) => inBounds(x, y));
  const layer = options.layer ?? brush.defaultLayer;
  if (!brush.supportedLayers.includes(layer)) {
    throw new RangeError(`Smart brush ${options.brushId} does not support layer ${layer}.`);
  }
  const migratedOwnerIds = canonicalizeCyberSpanRecipes(smartTerrain);
  discardOwnedOutputsForOwners(tileData, smartTerrain, migratedOwnerIds);
  if (options.brushId === 'cyber.fence') {
    applyPanelCells(tileData, smartTerrain, cells, options.mode, options.styleId, layer);
  } else if (isCyberSpanBrushId(options.brushId)) {
    applySpanCells(
      tileData,
      smartTerrain,
      cells,
      options.mode,
      options.brushId,
      options.styleId,
      layer,
    );
  } else {
    const targetKeys = new Set(cells.map(({ x, y }) => smartCellKey(x, y)));
    const replacedOwnerIds = removeCyberSpanSourcesAt(smartTerrain, layer, targetKeys);
    const replacedLegacyOwnerKeys = new Set<string>();
    discardOwnedOutputsForOwners(tileData, smartTerrain, replacedOwnerIds);
    for (const { x, y } of cells) {
      const semanticKey = smartSemanticCellKey(layer, x, y);
      clearShapeValuesAround(smartTerrain, layer, x, y, options.styleId, options.brushId);
      const replacedLegacyOwnerKey = clearCompatibilityCellAt(smartTerrain, layer, x, y);
      if (replacedLegacyOwnerKey) replacedLegacyOwnerKeys.add(replacedLegacyOwnerKey);
      if (options.mode === 'erase') {
        delete smartTerrain.semanticCells[semanticKey];
        tileData[layer][y][x] = -1;
      } else {
        const existing = smartTerrain.semanticCells[semanticKey];
        const reroll = existing
          && existing.brushId === options.brushId
          && existing.styleId === options.styleId
          && !existing.legacySource;
        smartTerrain.semanticCells[semanticKey] = {
          styleId: options.styleId,
          brushId: options.brushId,
          ...(reroll ? { varietySalt: (existing.varietySalt ?? 0) + 1 } : {}),
        };
      }
      smartTerrain.suppressedOutputParts = smartTerrain.suppressedOutputParts.filter(
        (entry) => !entry.startsWith(`${CYBER_CELL_OWNER_PREFIX}${semanticKey}:`),
      );
    }
    discardLegacyDecorationsForOwners(tileData, smartTerrain, replacedLegacyOwnerKeys);
    const resetOwnerIds = canonicalizeCyberSpanRecipes(smartTerrain);
    discardOwnedOutputsForOwners(tileData, smartTerrain, resetOwnerIds);
  }
  return resolveCyberRecipeDocument({ tileData, smartTerrain });
}

export function applyCyberSmartBrushOutlineCells(
  document: SmartRecipeDocument,
  options: ApplySmartBrushOutlineCellsOptions,
): SmartRecipeDocument {
  const outlineCells = Array.from(options.outlineCells).filter(({ x, y }) => inBounds(x, y));
  if (isCyberLetterBrushId(options.brushId)) {
    return applyCyberSmartBrushCells(document, { ...options, cells: outlineCells, mode: 'paint' });
  }
  const filledCells = Array.from(options.filledCells).filter(({ x, y }) => inBounds(x, y));
  const reference = applyCyberSmartBrushCells(document, { ...options, cells: filledCells, mode: 'paint' });
  const result = applyCyberSmartBrushCells(document, { ...options, cells: outlineCells, mode: 'paint' });
  const brush = getSmartBrushDefinition(options.brushId);
  const layer = options.layer ?? brush.defaultLayer;
  for (const { x, y } of outlineCells) {
    const key = smartSemanticCellKey(layer, x, y);
    const semantic = result.smartTerrain.semanticCells[key];
    const shapeValue = reference.tileData[layer][y]?.[x] ?? -1;
    if (semantic && shapeValue > 0) semantic.shapeValue = shapeValue;
  }
  return resolveCyberRecipeDocument(result);
}

export type {
  ApplySmartBrushCellsOptions,
  ApplySmartBrushOutlineCellsOptions,
  SmartRecipeDocument,
} from './cyberRecipeState';
