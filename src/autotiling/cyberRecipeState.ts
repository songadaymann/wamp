/** Shared Cyber recipe document types, canonicalization, and output ownership. */
import { ROOM_HEIGHT, ROOM_WIDTH, type LayerName } from '../config/room';
import type { RoomTileData } from '../persistence/roomModel';
import type { CyberResolvedTile, CyberStyleId } from './cyberProfile';
import {
  CYBER_SPAN_INSTANCE_PREFIX,
  isCyberSpanBrushId,
  isCyberStyleId,
  type CyberSpanBrushId,
} from './cyberRecipeFamily';
import {
  smartCellKey,
  smartOwnedOutputKey,
  smartOwnedOutputPartKey,
  smartRecipeOwnerId,
  type RoomSmartTerrainState,
  type SmartBrushId,
  type SmartCellCoordinate,
  type SmartRecipeInstanceState,
  type SmartSemanticCellState,
  type SmartStyleId,
} from './model';
import {
  getSmartBrushDefinition,
  resolveSmartTileValue,
} from './registry';

export interface SmartRecipeDocument {
  tileData: RoomTileData;
  smartTerrain: RoomSmartTerrainState;
}

export interface ApplySmartBrushCellsOptions {
  cells: Iterable<SmartCellCoordinate>;
  mode: 'paint' | 'erase';
  brushId: SmartBrushId;
  styleId: SmartStyleId;
  /** Advanced-mode source layer. Omitted callers retain the brush default. */
  layer?: LayerName;
}

export interface ApplySmartBrushOutlineCellsOptions {
  filledCells: Iterable<SmartCellCoordinate>;
  outlineCells: Iterable<SmartCellCoordinate>;
  brushId: SmartBrushId;
  styleId: SmartStyleId;
  /** Advanced-mode source layer. Omitted callers retain the brush default. */
  layer?: LayerName;
}

export interface CyberSemanticEntry {
  semanticKey: string;
  layer: LayerName;
  x: number;
  y: number;
  cell: SmartSemanticCellState;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export const CYBER_CELL_OWNER_PREFIX = 'cyber:cell:';

export function cloneTileData(tileData: RoomTileData): RoomTileData {
  return {
    background: tileData.background.map((row) => [...row]),
    terrain: tileData.terrain.map((row) => [...row]),
    foreground: tileData.foreground.map((row) => [...row]),
  };
}

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < ROOM_WIDTH && y >= 0 && y < ROOM_HEIGHT;
}

export function parseLayerCellKey(key: string): { layer: LayerName; x: number; y: number } | null {
  const match = /^(background|terrain|foreground):(\d+),(\d+)$/.exec(key);
  if (!match) return null;
  return {
    layer: match[1] as LayerName,
    x: Number(match[2]),
    y: Number(match[3]),
  };
}

export function getBounds(entries: readonly Pick<CyberSemanticEntry, 'x' | 'y'>[]): Bounds {
  const minX = Math.min(...entries.map(({ x }) => x));
  const minY = Math.min(...entries.map(({ y }) => y));
  const maxX = Math.max(...entries.map(({ x }) => x));
  const maxY = Math.max(...entries.map(({ y }) => y));
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

interface CyberSpanSourceEntry {
  layer: LayerName;
  x: number;
  y: number;
  styleId: CyberStyleId;
  brushId: CyberSpanBrushId;
  originIds: Set<string>;
}

export function clearOwnerSuppressions(state: RoomSmartTerrainState, ownerId: string): void {
  state.suppressedOutputParts = state.suppressedOutputParts.filter(
    (entry) => !entry.startsWith(`${ownerId}:`),
  );
}

function nextSpanInstanceId(
  brushId: CyberSpanBrushId,
  reservedIds: Set<string>,
): string {
  const prefix = CYBER_SPAN_INSTANCE_PREFIX[brushId];
  let index = 1;
  while (reservedIds.has(`${prefix}-${index}`)) index += 1;
  const instanceId = `${prefix}-${index}`;
  reservedIds.add(instanceId);
  return instanceId;
}

function sortLayerCells<T extends { layer: LayerName; x: number; y: number }>(cells: readonly T[]): T[] {
  return [...cells].sort((left, right) => (
    left.y - right.y || left.x - right.x || left.layer.localeCompare(right.layer)
  ));
}

function partitionSpanSources(
  sources: readonly CyberSpanSourceEntry[],
  brushId: CyberSpanBrushId,
): CyberSpanSourceEntry[][] {
  if (brushId === 'cyber.support') {
    const byCoordinate = new Map(sources.map((entry) => [smartCellKey(entry.x, entry.y), entry]));
    const visited = new Set<string>();
    const components: CyberSpanSourceEntry[][] = [];
    for (const source of sortLayerCells(sources)) {
      const sourceKey = smartCellKey(source.x, source.y);
      if (visited.has(sourceKey)) continue;
      const component: CyberSpanSourceEntry[] = [];
      const queue = [source];
      visited.add(sourceKey);
      for (let index = 0; index < queue.length; index += 1) {
        const current = queue[index]!;
        component.push(current);
        for (const [x, y] of [
          [current.x, current.y - 1],
          [current.x + 1, current.y],
          [current.x, current.y + 1],
          [current.x - 1, current.y],
        ]) {
          const key = smartCellKey(x, y);
          const next = byCoordinate.get(key);
          if (next && !visited.has(key)) {
            visited.add(key);
            queue.push(next);
          }
        }
      }
      components.push(sortLayerCells(component));
    }
    return components;
  }

  const rows = new Map<number, CyberSpanSourceEntry[]>();
  for (const source of sources) {
    const row = rows.get(source.y) ?? [];
    row.push(source);
    rows.set(source.y, row);
  }
  const runs: CyberSpanSourceEntry[][] = [];
  for (const y of [...rows.keys()].sort((left, right) => left - right)) {
    const row = rows.get(y)!.sort((left, right) => left.x - right.x);
    let run: CyberSpanSourceEntry[] = [];
    for (const source of row) {
      const previous = run[run.length - 1];
      if (previous && source.x !== previous.x + 1) {
        runs.push(run);
        run = [];
      }
      run.push(source);
    }
    if (run.length > 0) runs.push(run);
  }
  return runs;
}

function recipeSourceCellsEqual(
  recipe: SmartRecipeInstanceState,
  cells: readonly CyberSpanSourceEntry[],
): boolean {
  if (recipe.sourceCells.length !== cells.length) return false;
  return recipe.sourceCells.every((cell, index) => {
    const next = cells[index];
    return Boolean(next && cell.layer === next.layer && cell.x === next.x && cell.y === next.y);
  });
}

function createSpanRecipe(
  instanceId: string,
  brushId: CyberSpanBrushId,
  styleId: CyberStyleId,
  sources: readonly CyberSpanSourceEntry[],
): SmartRecipeInstanceState {
  const ordered = sortLayerCells(sources);
  const bounds = getBounds(ordered);
  const layer = ordered[0]!.layer;
  return {
    recipeId: brushId,
    ownerId: smartRecipeOwnerId(instanceId),
    brushId,
    styleId,
    anchor: { layer, x: bounds.minX, y: bounds.minY },
    bounds,
    sourceCells: ordered.map(({ x, y }) => ({ layer, x, y })),
    parameters: {
      width: bounds.width,
      height: bounds.height,
      axis: brushId === 'cyber.support' ? 'vertical' : 'horizontal',
    },
  };
}

export function canonicalizeCyberSpanRecipes(state: RoomSmartTerrainState): Set<string> {
  const resetOwnerIds = new Set<string>();
  const previous = new Map(
    Object.entries(state.recipes).filter(([, recipe]) => isCyberSpanBrushId(recipe.brushId)),
  );
  const grouped = new Map<string, Map<string, CyberSpanSourceEntry>>();
  const addSource = (
    layer: LayerName,
    x: number,
    y: number,
    styleId: CyberStyleId,
    brushId: CyberSpanBrushId,
    originId?: string,
  ): void => {
    const groupKey = `${layer}:${styleId}:${brushId}`;
    const group = grouped.get(groupKey) ?? new Map<string, CyberSpanSourceEntry>();
    const coordinateKey = smartCellKey(x, y);
    const source = group.get(coordinateKey) ?? {
      layer, x, y, styleId, brushId, originIds: new Set<string>(),
    };
    if (originId) source.originIds.add(originId);
    group.set(coordinateKey, source);
    grouped.set(groupKey, group);
  };

  for (const [instanceId, recipe] of previous) {
    if (!isCyberStyleId(recipe.styleId) || !isCyberSpanBrushId(recipe.brushId)) continue;
    for (const source of recipe.sourceCells) {
      if (!inBounds(source.x, source.y)) continue;
      addSource(source.layer, source.x, source.y, recipe.styleId, recipe.brushId, instanceId);
    }
  }
  for (const [semanticKey, cell] of Object.entries(state.semanticCells)) {
    if (!isCyberStyleId(cell.styleId) || !isCyberSpanBrushId(cell.brushId)) continue;
    const source = parseLayerCellKey(semanticKey);
    if (source && inBounds(source.x, source.y)) {
      addSource(source.layer, source.x, source.y, cell.styleId, cell.brushId);
    }
    const ownerId = `${CYBER_CELL_OWNER_PREFIX}${semanticKey}`;
    clearOwnerSuppressions(state, ownerId);
    resetOwnerIds.add(ownerId);
    delete state.semanticCells[semanticKey];
  }

  const reservedIds = new Set(Object.keys(state.recipes));
  const usedIds = new Set<string>();
  const canonical: Record<string, SmartRecipeInstanceState> = {};
  const groups = [...grouped.values()].sort((left, right) => {
    const leftFirst = sortLayerCells([...left.values()])[0]!;
    const rightFirst = sortLayerCells([...right.values()])[0]!;
    return leftFirst.layer.localeCompare(rightFirst.layer)
      || leftFirst.styleId.localeCompare(rightFirst.styleId)
      || leftFirst.brushId.localeCompare(rightFirst.brushId)
      || leftFirst.y - rightFirst.y
      || leftFirst.x - rightFirst.x;
  });
  for (const group of groups) {
    const first = group.values().next().value as CyberSpanSourceEntry;
    for (const component of partitionSpanSources([...group.values()], first.brushId)) {
      const candidateIds = Array.from(new Set(component.flatMap(({ originIds }) => [...originIds])))
        .filter((instanceId) => !usedIds.has(instanceId))
        .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
      const instanceId = candidateIds[0] ?? nextSpanInstanceId(first.brushId, reservedIds);
      usedIds.add(instanceId);
      const recipe = createSpanRecipe(instanceId, first.brushId, first.styleId, component);
      const oldRecipe = previous.get(instanceId);
      if (
        !oldRecipe
        || oldRecipe.styleId !== recipe.styleId
        || oldRecipe.brushId !== recipe.brushId
        || !recipeSourceCellsEqual(oldRecipe, component)
      ) {
        clearOwnerSuppressions(state, recipe.ownerId);
        resetOwnerIds.add(recipe.ownerId);
      }
      canonical[instanceId] = recipe;
    }
  }

  for (const [instanceId, recipe] of previous) {
    delete state.recipes[instanceId];
    if (!canonical[instanceId]) {
      clearOwnerSuppressions(state, recipe.ownerId);
      resetOwnerIds.add(recipe.ownerId);
    }
  }
  Object.assign(state.recipes, canonical);
  return resetOwnerIds;
}

export function discardOwnedOutputsForOwners(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  ownerIds: ReadonlySet<string>,
): void {
  if (ownerIds.size === 0) return;
  for (const [key, output] of Object.entries(state.ownedOutputs)) {
    if (!ownerIds.has(output.ownerId)) continue;
    const coordinate = parseLayerCellKey(key);
    if (coordinate && inBounds(coordinate.x, coordinate.y)) {
      const currentValue = tileData[output.layer][coordinate.y]?.[coordinate.x] ?? -1;
      if (currentValue === output.value) tileData[output.layer][coordinate.y][coordinate.x] = -1;
    }
    delete state.ownedOutputs[key];
  }
  ownerIds.forEach((ownerId) => clearOwnerSuppressions(state, ownerId));
}

function addSuppressedPart(state: RoomSmartTerrainState, ownerId: string, partId: string): void {
  state.suppressedOutputParts = Array.from(new Set([
    ...state.suppressedOutputParts,
    smartOwnedOutputPartKey(ownerId, partId),
  ]));
}

export function clearCyberOwnedOutputs(tileData: RoomTileData, state: RoomSmartTerrainState): void {
  for (const [key, output] of Object.entries(state.ownedOutputs)) {
    if (!output.ownerId.startsWith('cyber:')) continue;
    const coordinate = parseLayerCellKey(key);
    if (!coordinate || !inBounds(coordinate.x, coordinate.y)) {
      delete state.ownedOutputs[key];
      continue;
    }
    const currentValue = tileData[output.layer][coordinate.y]?.[coordinate.x] ?? -1;
    if (currentValue === output.value) {
      tileData[output.layer][coordinate.y][coordinate.x] = -1;
    } else if (output.kind === 'semantic' && output.partId === 'primary') {
      const semanticKey = output.ownerId.slice(CYBER_CELL_OWNER_PREFIX.length);
      const semantic = state.semanticCells[semanticKey];
      if (semantic) {
        if (currentValue > 0) {
          semantic.lockedValue = currentValue;
          state.suppressedOutputParts = state.suppressedOutputParts.filter(
            (entry) => entry !== smartOwnedOutputPartKey(output.ownerId, output.partId),
          );
        } else {
          addSuppressedPart(state, output.ownerId, output.partId);
        }
      }
    } else {
      addSuppressedPart(state, output.ownerId, output.partId);
    }
    delete state.ownedOutputs[key];
  }
}

export function addOwnedOutput(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  ownerId: string,
  partId: string,
  kind: 'semantic' | 'recipe',
  x: number,
  y: number,
  tile: CyberResolvedTile,
  force: boolean,
  placement?: { brushId: SmartBrushId; sourceLayer: LayerName },
): void {
  if (!inBounds(x, y)) return;
  if (state.suppressedOutputParts.includes(smartOwnedOutputPartKey(ownerId, partId))) return;
  const outputTile = placement
    ? retargetCyberOutputTile(tile, placement.brushId, placement.sourceLayer)
    : tile;
  const value = resolveSmartTileValue(outputTile.styleId, outputTile);
  const existingValue = tileData[outputTile.layer][y]?.[x] ?? -1;
  if (!force && existingValue > 0) return;
  tileData[outputTile.layer][y][x] = value;
  state.ownedOutputs[smartOwnedOutputKey(outputTile.layer, x, y)] = {
    ownerId,
    partId,
    kind,
    layer: outputTile.layer,
    value,
  };
}

/**
 * Advanced placement swaps the brush's authored source layer with the selected
 * layer. That moves the primary art while keeping same-cell companion overlays
 * (for example Concrete ties) on a distinct layer instead of overwriting it.
 */
function retargetCyberOutputTile(
  tile: CyberResolvedTile,
  brushId: SmartBrushId,
  sourceLayer: LayerName,
): CyberResolvedTile {
  const defaultLayer = getSmartBrushDefinition(brushId).defaultLayer;
  if (sourceLayer === defaultLayer) return tile;
  const layer = tile.layer === defaultLayer
    ? sourceLayer
    : tile.layer === sourceLayer
      ? defaultLayer
      : tile.layer;
  return layer === tile.layer ? tile : { ...tile, layer };
}
