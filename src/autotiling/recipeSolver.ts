import type { LayerName } from '../config/room';
import type { RoomTileData } from '../persistence/roomModel';
import {
  cloneRoomSmartTerrainState,
  smartOwnedOutputKey,
  smartOwnedOutputPartKey,
  smartSemanticCellKey,
  type RoomSmartTerrainState,
  type SmartBrushId,
} from './model';
import {
  applyCyberSmartBrushCells,
  applyCyberSmartBrushOutlineCells,
  resolveCyberRecipeDocument,
  type ApplySmartBrushCellsOptions,
  type ApplySmartBrushOutlineCellsOptions,
  type SmartRecipeDocument,
} from './cyberRecipeDocument';
import {
  getSmartBrushDefinition,
  type SmartBrushEngine,
} from './registry';

type SmartRecipeEngine = Exclude<SmartBrushEngine, 'legacy-terrain'>;

export interface SmartRecipeEngineAdapter {
  applyCells(
    document: SmartRecipeDocument,
    options: ApplySmartBrushCellsOptions,
  ): SmartRecipeDocument;
  applyOutlineCells(
    document: SmartRecipeDocument,
    options: ApplySmartBrushOutlineCellsOptions,
  ): SmartRecipeDocument;
  resolveDocument(document: SmartRecipeDocument): SmartRecipeDocument;
  semanticOwnerId(semanticKey: string): string;
  recipeOwnerId(instanceId: string): string;
}

const SMART_RECIPE_ENGINE_ADAPTERS: Readonly<Record<SmartRecipeEngine, SmartRecipeEngineAdapter>> = {
  'cyber-recipe': {
    applyCells: applyCyberSmartBrushCells,
    applyOutlineCells: applyCyberSmartBrushOutlineCells,
    resolveDocument: resolveCyberRecipeDocument,
    semanticOwnerId: (semanticKey) => `cyber:cell:${semanticKey}`,
    recipeOwnerId: (instanceId) => `cyber:recipe:${instanceId}`,
  },
};

export function getSmartRecipeEngineAdapter(brushId: SmartBrushId): SmartRecipeEngineAdapter {
  const brush = getSmartBrushDefinition(brushId);
  if (brush.engine === 'legacy-terrain') {
    throw new RangeError(`Smart brush ${brushId} is not backed by a recipe engine.`);
  }
  return SMART_RECIPE_ENGINE_ADAPTERS[brush.engine];
}

function cloneTileData(tileData: RoomTileData): RoomTileData {
  return {
    background: tileData.background.map((row) => [...row]),
    terrain: tileData.terrain.map((row) => [...row]),
    foreground: tileData.foreground.map((row) => [...row]),
  };
}

function getSemanticOwnerId(brushId: SmartBrushId, semanticKey: string): string {
  const brush = getSmartBrushDefinition(brushId);
  return brush.engine === 'legacy-terrain'
    ? `legacy-semantic:${semanticKey}`
    : getSmartRecipeEngineAdapter(brushId).semanticOwnerId(semanticKey);
}

function addSuppressedPart(
  state: RoomSmartTerrainState,
  ownerId: string,
  partId: string,
): void {
  const suppression = smartOwnedOutputPartKey(ownerId, partId);
  if (!state.suppressedOutputParts.includes(suppression)) {
    state.suppressedOutputParts.push(suppression);
  }
}

export function applySmartBrushCells(
  document: SmartRecipeDocument,
  options: ApplySmartBrushCellsOptions,
): SmartRecipeDocument {
  return getSmartRecipeEngineAdapter(options.brushId).applyCells(document, options);
}

export function applySmartBrushOutlineCells(
  document: SmartRecipeDocument,
  options: ApplySmartBrushOutlineCellsOptions,
): SmartRecipeDocument {
  return getSmartRecipeEngineAdapter(options.brushId).applyOutlineCells(document, options);
}

/** Runs every registered recipe-family document pass after legacy terrain resolves. */
export function resolveSmartRecipeDocument(
  document: SmartRecipeDocument,
): SmartRecipeDocument {
  return Object.values(SMART_RECIPE_ENGINE_ADAPTERS).reduce(
    (next, adapter) => adapter.resolveDocument(next),
    document,
  );
}

export function getSmartRecipeSemanticOwnerId(
  brushId: SmartBrushId,
  semanticKey: string,
): string {
  return getSmartRecipeEngineAdapter(brushId).semanticOwnerId(semanticKey);
}

export function getSmartRecipeOwnerId(
  brushId: SmartBrushId,
  instanceId: string,
): string {
  return getSmartRecipeEngineAdapter(brushId).recipeOwnerId(instanceId);
}

/** Locks a manually selected encoded value while retaining its Smart semantics. */
export function lockSmartSemanticCell(
  document: SmartRecipeDocument,
  x: number,
  y: number,
  value: number,
  layer: LayerName,
): SmartRecipeDocument {
  const tileData = cloneTileData(document.tileData);
  const smartTerrain = cloneRoomSmartTerrainState(document.smartTerrain);
  const semantic = smartTerrain.semanticCells[smartSemanticCellKey(layer, x, y)];
  if (semantic && !semantic.legacySource) semantic.lockedValue = value;
  tileData[layer][y][x] = value;
  return resolveSmartRecipeDocument({ tileData, smartTerrain });
}

/** Records a manual edit against whichever registered engine owns the output. */
export function applyManualSmartOutputEdit(
  state: RoomSmartTerrainState,
  layer: LayerName,
  x: number,
  y: number,
  value: number,
): RoomSmartTerrainState {
  const next = cloneRoomSmartTerrainState(state);
  const semanticKey = smartSemanticCellKey(layer, x, y);
  const semantic = next.semanticCells[semanticKey];
  if (semantic && !semantic.legacySource) {
    const semanticOwnerId = getSemanticOwnerId(semantic.brushId, semanticKey);
    if (value > 0) {
      semantic.lockedValue = value;
      next.suppressedOutputParts = next.suppressedOutputParts.filter(
        (entry) => entry !== smartOwnedOutputPartKey(semanticOwnerId, 'primary'),
      );
    } else {
      delete semantic.lockedValue;
    }
  }

  const outputKey = smartOwnedOutputKey(layer, x, y);
  const output = next.ownedOutputs[outputKey];
  if (output && output.kind !== 'legacy-decoration') {
    if (!(output.kind === 'semantic' && output.partId === 'primary' && value > 0)) {
      addSuppressedPart(next, output.ownerId, output.partId);
    }
    delete next.ownedOutputs[outputKey];
  }
  return next;
}

export interface SmartRecipeLayerOutputRemoval {
  key: string;
  layer: LayerName;
  x: number;
  y: number;
  value: number;
}

export interface SmartRecipeLayerClearPlan {
  smartTerrain: RoomSmartTerrainState;
  removedOutputs: SmartRecipeLayerOutputRemoval[];
}

/**
 * Plans a layer clear using registered owner identities. Editor callers can
 * remove companion tiles on other layers without knowing an engine prefix.
 */
export function planSmartRecipeLayerClear(
  state: RoomSmartTerrainState,
  layer: LayerName,
): SmartRecipeLayerClearPlan {
  const next = cloneRoomSmartTerrainState(state);
  const removedOwnerIds = new Set<string>();
  const removedOutputs: SmartRecipeLayerOutputRemoval[] = [];
  for (const key of Object.keys(next.semanticCells)) {
    const semantic = next.semanticCells[key];
    if (key.startsWith(`${layer}:`) && semantic && !semantic.legacySource) {
      removedOwnerIds.add(getSemanticOwnerId(semantic.brushId, key));
      delete next.semanticCells[key];
    }
  }
  for (const [instanceId, recipe] of Object.entries(next.recipes)) {
    if (recipe.anchor.layer === layer) {
      removedOwnerIds.add(recipe.ownerId || getSmartRecipeOwnerId(recipe.brushId, instanceId));
      delete next.recipes[instanceId];
    }
  }
  for (const [key, output] of Object.entries(next.ownedOutputs)) {
    if (output.kind === 'legacy-decoration') continue;
    if (output.layer === layer && !removedOwnerIds.has(output.ownerId)) {
      addSuppressedPart(next, output.ownerId, output.partId);
    }
    if (output.layer === layer || removedOwnerIds.has(output.ownerId)) {
      const match = /^(background|terrain|foreground):(\d+),(\d+)$/.exec(key);
      if (match) {
        removedOutputs.push({
          key,
          layer: output.layer,
          x: Number(match[2]),
          y: Number(match[3]),
          value: output.value,
        });
      }
      delete next.ownedOutputs[key];
    }
  }
  next.suppressedOutputParts = next.suppressedOutputParts.filter((entry) => (
    ![...removedOwnerIds].some((ownerId) => entry.startsWith(`${ownerId}:`))
  ));
  return { smartTerrain: next, removedOutputs };
}

/** Clears native semantic and recipe state without relying on family-specific owner prefixes. */
export function clearSmartRecipeLayerState(
  state: RoomSmartTerrainState,
  layer: LayerName,
): RoomSmartTerrainState {
  return planSmartRecipeLayerClear(state, layer).smartTerrain;
}

export type {
  ApplySmartBrushCellsOptions,
  ApplySmartBrushOutlineCellsOptions,
  SmartRecipeDocument,
};
export { isCyberSmartBrushId } from './cyberRecipeFamily';
