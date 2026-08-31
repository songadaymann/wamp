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
  type SmartRecipeInstanceState,
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
  type ApplySmartBrushCellsOptions,
  type ApplySmartBrushOutlineCellsOptions,
  type SmartRecipeDocument,
} from './cyberRecipeState';
import {
  resolveCyberSemanticCells,
  resolveCyberStructuralOverlays,
} from './cyberSemanticResolver';
import {
  flattenLetterSpanRecipes,
  recipeBounds,
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

function isPanelRecipeAt(recipe: SmartRecipeInstanceState, layer: LayerName, x: number, y: number): boolean {
  if (recipe.recipeId !== CYBER_PANEL_RECIPE_ID && recipe.recipeId !== 'cyber.framed-panel') return false;
  const bounds = recipeBounds(recipe);
  return Boolean(
    recipe.anchor.layer === layer
    && bounds
    && x >= bounds.minX
    && x <= bounds.maxX
    && y >= bounds.minY
    && y <= bounds.minY + 1,
  );
}

function removePanelRecipe(state: RoomSmartTerrainState, instanceId: string): void {
  const ownerId = state.recipes[instanceId]?.ownerId ?? smartRecipeOwnerId(instanceId);
  delete state.recipes[instanceId];
  clearOwnerSuppressions(state, ownerId);
}

function applyPanelCells(
  state: RoomSmartTerrainState,
  cells: readonly SmartCellCoordinate[],
  mode: 'paint' | 'erase',
  styleId: CyberStyleId,
  layer: LayerName,
): void {
  if (mode === 'erase') {
    const removed = new Set<string>();
    for (const cell of cells) {
      for (const [instanceId, recipe] of Object.entries(state.recipes)) {
        if (isPanelRecipeAt(recipe, layer, cell.x, cell.y)) removed.add(instanceId);
      }
    }
    for (const instanceId of removed) {
      removePanelRecipe(state, instanceId);
    }
    return;
  }
  if (cells.length === 0) return;
  const minX = Math.min(...cells.map(({ x }) => x));
  const maxX = Math.max(...cells.map(({ x }) => x));
  const anchorY = Math.min(...cells.map(({ y }) => y));
  const matching = Object.entries(state.recipes).filter(([, recipe]) => {
    if (
      recipe.recipeId !== CYBER_PANEL_RECIPE_ID
      || recipe.styleId !== styleId
      || recipe.anchor.layer !== layer
    ) return false;
    const bounds = recipeBounds(recipe);
    return Boolean(bounds
      && bounds.minY === anchorY
      && minX <= bounds.maxX + 1
      && maxX >= bounds.minX - 1);
  });
  const matchingIds = new Set(matching.map(([instanceId]) => instanceId));
  for (const [instanceId, recipe] of Object.entries(state.recipes)) {
    if (
      recipe.recipeId !== CYBER_PANEL_RECIPE_ID
      || recipe.anchor.layer !== layer
      || matchingIds.has(instanceId)
    ) continue;
    const bounds = recipeBounds(recipe);
    const overlapsOutput = Boolean(bounds
      && minX <= bounds.maxX
      && maxX >= bounds.minX
      && anchorY <= bounds.minY + 1
      && anchorY + 1 >= bounds.minY);
    if (overlapsOutput) removePanelRecipe(state, instanceId);
  }
  const instanceId = matching[0]?.[0] ?? nextPanelInstanceId(state);
  const xValues = new Set<number>();
  for (const [, recipe] of matching) {
    recipe.sourceCells.forEach(({ x }) => xValues.add(x));
  }
  for (let x = minX; x <= maxX; x += 1) xValues.add(x);
  for (const [mergedId] of matching.slice(1)) removePanelRecipe(state, mergedId);
  const orderedX = [...xValues].sort((left, right) => left - right);
  const ownerId = smartRecipeOwnerId(instanceId);
  const bounds = {
    minX: orderedX[0]!,
    minY: anchorY,
    maxX: orderedX[orderedX.length - 1]!,
    maxY: anchorY + 1,
    width: orderedX.length,
    height: 2,
  };
  state.recipes[instanceId] = {
    recipeId: CYBER_PANEL_RECIPE_ID,
    ownerId,
    brushId: 'cyber.fence',
    styleId,
    anchor: { layer, x: bounds.minX, y: bounds.minY },
    bounds,
    sourceCells: orderedX.map((x) => ({ layer, x, y: anchorY })),
    parameters: { width: orderedX.length, height: 2 },
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
    applyPanelCells(smartTerrain, cells, options.mode, options.styleId, layer);
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
