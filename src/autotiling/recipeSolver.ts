import { ROOM_HEIGHT, ROOM_WIDTH, TILE_FLIP_X_FLAG, TILE_FLIP_Y_FLAG, type LayerName } from '../config/room';
import { decodeTileDataValue } from '../config/editorState';
import type { RoomTileData } from '../persistence/roomModel';
import {
  CYBERCITY_EXTRAS_TILESET_FIRST_GID,
  CYBERCITY_EXTRAS_TILESET_KEY,
} from '../config/tilesets';
import {
  CYBER_FAMILY_DEFINITIONS,
  CYBER_NEIGHBOR,
  CYBER_STYLE_PROFILES,
  resolveCyberFenceCell,
  resolveCyberNeonStrip,
  resolveCyberPlatformSpan,
  applyCyberRubbleVariety,
  cyberRubbleEdgeFlipAxes,
  resolveCyberRubbleBorderTile,
  resolveCyberRubbleColumn,
  resolveCyberStructureUnderground,
  resolveCyberStructureTile8,
  resolveCyberSupportSpan,
  resolveCyberTunnelOutlineTile,
  resolveCyberStructureTieTile,
  type CyberFamilyId,
  type CyberResolvedTile,
  type CyberStyleId,
  type CyberTunnelOutlineRole,
} from './cyberProfile';
import {
  isCyberLetterBrushId,
  isCyberLetterCatalogLocalIndex,
  letterCellKey,
  orientCyberA10Overlay,
  resolveCyberLetterField,
} from './cyberEdgeMatcher';
import {
  CYBER_EDGE_CATALOG,
  edgesForOrientedCatalogTile,
  type CyberLetterBrushId,
} from './cyberEdgeCatalog';
import {
  cloneRoomSmartTerrainState,
  smartCellKey,
  smartOwnedOutputKey,
  smartOwnedOutputPartKey,
  smartRecipeOwnerId,
  smartSemanticCellKey,
  type RoomSmartTerrainState,
  type SmartBrushId,
  type SmartCellCoordinate,
  type SmartRecipeInstanceState,
  type SmartSemanticCellState,
  type SmartStyleId,
} from './model';
import {
  getSmartBrushDefinition,
  getSmartStyleDefinition,
  resolveSmartTileValue,
} from './registry';

/**
 * Neon Smart indices 4, 6, 7 live on the extras tileset, not the style tileset.
 * Yellow uses extras rows 0-2, pink uses extras rows 12-14.
 * Map: Smart 7 → extras 0/12, Smart 4 → extras 1/13, Smart 6 → extras 2/14.
 */
const NEON_EXTRAS_LOCAL_INDEX: Readonly<Record<number, number>> = { 7: 0, 4: 1, 6: 2 };
const NEON_EXTRAS_PINK_OFFSET = 12;

function resolveNeonExtrasTileValue(
  styleId: CyberStyleId,
  localIndex: number,
  flipX: boolean,
  flipY: boolean,
): number | null {
  const base = NEON_EXTRAS_LOCAL_INDEX[localIndex];
  if (base === undefined) return null;
  const extrasIndex = styleId === 'cyber-pink' ? base + NEON_EXTRAS_PINK_OFFSET : base;
  return CYBERCITY_EXTRAS_TILESET_FIRST_GID
    + extrasIndex
    + (flipX ? TILE_FLIP_X_FLAG : 0)
    + (flipY ? TILE_FLIP_Y_FLAG : 0);
}

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

interface CyberSemanticEntry {
  semanticKey: string;
  layer: LayerName;
  x: number;
  y: number;
  cell: SmartSemanticCellState;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

const CYBER_CELL_OWNER_PREFIX = 'cyber:cell:';
const LEGACY_SEMANTIC_OWNER_PREFIX = 'legacy-semantic:';
const CYBER_PANEL_RECIPE_ID = 'cyber.fence';
const CYBER_BRUSH_PREFIX = 'cyber.';

type CyberSpanBrushId = 'cyber.support';

const CYBER_SPAN_BRUSH_IDS: readonly CyberSpanBrushId[] = [
  'cyber.support',
];

const CYBER_SPAN_INSTANCE_PREFIX: Readonly<Record<CyberSpanBrushId, string>> = {
  'cyber.support': 'cyber-support',
};

const CYBER_FAMILY_BY_BRUSH: Partial<Record<SmartBrushId, CyberFamilyId>> = {
  'cyber.concrete': 'structure',
  'cyber.windows': 'structure',
  'cyber.shell': 'structure',
  'cyber.neon': 'neon-strip',
  'cyber.rubble': 'rubble',
  'cyber.support': 'support',
  'cyber.fence': 'framed-panel',
};

function cloneTileData(tileData: RoomTileData): RoomTileData {
  return {
    background: tileData.background.map((row) => [...row]),
    terrain: tileData.terrain.map((row) => [...row]),
    foreground: tileData.foreground.map((row) => [...row]),
  };
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < ROOM_WIDTH && y >= 0 && y < ROOM_HEIGHT;
}

function parseLayerCellKey(key: string): { layer: LayerName; x: number; y: number } | null {
  const match = /^(background|terrain|foreground):(\d+),(\d+)$/.exec(key);
  if (!match) return null;
  return {
    layer: match[1] as LayerName,
    x: Number(match[2]),
    y: Number(match[3]),
  };
}

function isCyberStyleId(styleId: SmartStyleId): styleId is CyberStyleId {
  return styleId === 'cyber-yellow' || styleId === 'cyber-pink';
}

function isCyberSpanBrushId(brushId: SmartBrushId): brushId is CyberSpanBrushId {
  return CYBER_SPAN_BRUSH_IDS.includes(brushId as CyberSpanBrushId);
}

export function isCyberSmartBrushId(brushId: SmartBrushId): boolean {
  return brushId.startsWith(CYBER_BRUSH_PREFIX);
}

function getCyberFamilyId(brushId: SmartBrushId): CyberFamilyId {
  const familyId = CYBER_FAMILY_BY_BRUSH[brushId];
  if (!familyId) throw new RangeError(`Smart brush ${brushId} is not a Cyber recipe.`);
  return familyId;
}

function getBounds(entries: readonly Pick<CyberSemanticEntry, 'x' | 'y'>[]): Bounds {
  const minX = Math.min(...entries.map(({ x }) => x));
  const minY = Math.min(...entries.map(({ y }) => y));
  const maxX = Math.max(...entries.map(({ x }) => x));
  const maxY = Math.max(...entries.map(({ y }) => y));
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function getCyberEntries(state: RoomSmartTerrainState): CyberSemanticEntry[] {
  const entries: CyberSemanticEntry[] = [];
  for (const [semanticKey, cell] of Object.entries(state.semanticCells)) {
    if (!isCyberSmartBrushId(cell.brushId) || !isCyberStyleId(cell.styleId)) continue;
    const coordinate = parseLayerCellKey(semanticKey);
    if (!coordinate || !inBounds(coordinate.x, coordinate.y)) continue;
    entries.push({ semanticKey, ...coordinate, cell });
  }
  return entries;
}

function sameCyberLegacyTile(
  tileData: RoomTileData,
  layer: LayerName,
  x: number,
  y: number,
  styleId: CyberStyleId,
  brushId: SmartBrushId,
): boolean {
  if (!inBounds(x, y)) return false;
  const decoded = decodeTileDataValue(tileData[layer][y]?.[x] ?? -1);
  if (decoded.gid <= 0) return false;
  const style = getSmartStyleDefinition(styleId);
  const localIndex = decoded.gid - style.firstGid;
  return localIndex >= 0
    && localIndex < style.tileCount
    && getSmartBrushDefinition(brushId).compatibleLegacyLocalIndices.includes(localIndex);
}

function isCyberLetterOccupant(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  layer: LayerName,
  x: number,
  y: number,
  styleId: CyberStyleId,
): boolean {
  if (!inBounds(x, y)) return false;
  const semantic = state.semanticCells[smartSemanticCellKey(layer, x, y)];
  if (semantic?.styleId === styleId && isCyberLetterBrushId(semantic.brushId)) {
    return true;
  }
  for (const recipe of Object.values(state.recipes)) {
    if (recipe.styleId !== styleId || !isCyberLetterBrushId(recipe.brushId)) continue;
    if (recipe.sourceCells.some((cell) => cell.layer === layer && cell.x === x && cell.y === y)) {
      return true;
    }
  }
  const decoded = decodeTileDataValue(tileData[layer][y]?.[x] ?? -1);
  if (decoded.gid <= 0) return false;
  const style = getSmartStyleDefinition(styleId);
  const localIndex = decoded.gid - style.firstGid;
  return localIndex >= 0
    && localIndex < style.tileCount
    && isCyberLetterCatalogLocalIndex(localIndex);
}

function sameCyberFamily(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  layer: LayerName,
  x: number,
  y: number,
  styleId: CyberStyleId,
  brushId: SmartBrushId,
): boolean {
  if (!inBounds(x, y)) return false;
  if (isCyberLetterBrushId(brushId) && !isCyberSpanBrushId(brushId)) {
    return isCyberLetterOccupant(tileData, state, layer, x, y, styleId);
  }
  const semantic = state.semanticCells[smartSemanticCellKey(layer, x, y)];
  if (semantic) {
    if (brushId === 'cyber.rubble') {
      return semantic.brushId === 'cyber.rubble' && isCyberStyleId(semantic.styleId);
    }
    return semantic.styleId === styleId && semantic.brushId === brushId;
  }
  for (const recipe of Object.values(state.recipes)) {
    if (brushId === 'cyber.rubble') {
      if (recipe.brushId !== 'cyber.rubble' || !isCyberStyleId(recipe.styleId)) continue;
    } else if (recipe.styleId !== styleId || recipe.brushId !== brushId) {
      continue;
    }
    if (recipe.sourceCells.some((cell) => cell.layer === layer && cell.x === x && cell.y === y)) {
      return true;
    }
  }
  if (brushId === 'cyber.rubble') {
    return sameCyberLegacyTile(tileData, layer, x, y, 'cyber-yellow', brushId)
      || sameCyberLegacyTile(tileData, layer, x, y, 'cyber-pink', brushId);
  }
  return sameCyberLegacyTile(tileData, layer, x, y, styleId, brushId);
}

function hasCyberSmartSourceAt(
  state: RoomSmartTerrainState,
  layer: LayerName,
  x: number,
  y: number,
): boolean {
  if (state.semanticCells[smartSemanticCellKey(layer, x, y)]) return true;
  return Object.values(state.recipes).some((recipe) => (
    recipe.sourceCells.some((cell) => cell.layer === layer && cell.x === x && cell.y === y)
  ));
}

function componentEntries(entries: readonly CyberSemanticEntry[]): CyberSemanticEntry[][] {
  const byCoordinate = new Map(entries.map((entry) => [smartCellKey(entry.x, entry.y), entry]));
  const visited = new Set<string>();
  const components: CyberSemanticEntry[][] = [];
  for (const entry of entries) {
    const startKey = smartCellKey(entry.x, entry.y);
    if (visited.has(startKey)) continue;
    const component: CyberSemanticEntry[] = [];
    const queue = [entry];
    visited.add(startKey);
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
    components.push(component);
  }
  return components;
}

interface CyberSpanSourceEntry {
  layer: LayerName;
  x: number;
  y: number;
  styleId: CyberStyleId;
  brushId: CyberSpanBrushId;
  originIds: Set<string>;
}

function clearOwnerSuppressions(state: RoomSmartTerrainState, ownerId: string): void {
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

function canonicalizeCyberSpanRecipes(state: RoomSmartTerrainState): Set<string> {
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

function discardOwnedOutputsForOwners(
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

function clearCyberOwnedOutputs(tileData: RoomTileData, state: RoomSmartTerrainState): void {
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

function addOwnedOutput(
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
  const neonExtrasValue = placement?.brushId === 'cyber.neon'
    ? resolveNeonExtrasTileValue(
      outputTile.styleId as CyberStyleId,
      outputTile.localIndex,
      outputTile.flipX ?? false,
      outputTile.flipY ?? false,
    )
    : null;
  const value = neonExtrasValue ?? resolveSmartTileValue(outputTile.styleId, outputTile);
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

function neighborMask8(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  entry: CyberSemanticEntry,
): number {
  let mask = 0;
  const has = (dx: number, dy: number) => sameCyberFamily(
    tileData,
    state,
    entry.layer,
    entry.x + dx,
    entry.y + dy,
    entry.cell.styleId as CyberStyleId,
    entry.cell.brushId,
  );
  if (has(0, -1)) mask |= CYBER_NEIGHBOR.north;
  if (has(1, -1)) mask |= CYBER_NEIGHBOR.northEast;
  if (has(1, 0)) mask |= CYBER_NEIGHBOR.east;
  if (has(1, 1)) mask |= CYBER_NEIGHBOR.southEast;
  if (has(0, 1)) mask |= CYBER_NEIGHBOR.south;
  if (has(-1, 1)) mask |= CYBER_NEIGHBOR.southWest;
  if (has(-1, 0)) mask |= CYBER_NEIGHBOR.west;
  if (has(-1, -1)) mask |= CYBER_NEIGHBOR.northWest;
  return mask;
}

function findEnclosedCyberVoidCells(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  entry: CyberSemanticEntry,
): Set<string> {
  const exterior = new Set<string>();
  const queue: SmartCellCoordinate[] = [];
  const enqueue = (x: number, y: number): void => {
    if (!inBounds(x, y)) return;
    const key = smartCellKey(x, y);
    if (exterior.has(key) || sameCyberFamily(
      tileData,
      state,
      entry.layer,
      x,
      y,
      entry.cell.styleId as CyberStyleId,
      entry.cell.brushId,
    )) return;
    exterior.add(key);
    queue.push({ x, y });
  };
  for (let x = 0; x < ROOM_WIDTH; x += 1) {
    enqueue(x, 0);
    enqueue(x, ROOM_HEIGHT - 1);
  }
  for (let y = 0; y < ROOM_HEIGHT; y += 1) {
    enqueue(0, y);
    enqueue(ROOM_WIDTH - 1, y);
  }
  for (let index = 0; index < queue.length; index += 1) {
    const { x, y } = queue[index]!;
    enqueue(x, y - 1);
    enqueue(x + 1, y);
    enqueue(x, y + 1);
    enqueue(x - 1, y);
  }
  const enclosed = new Set<string>();
  for (let y = 0; y < ROOM_HEIGHT; y += 1) {
    for (let x = 0; x < ROOM_WIDTH; x += 1) {
      const key = smartCellKey(x, y);
      if (exterior.has(key) || sameCyberFamily(
        tileData,
        state,
        entry.layer,
        x,
        y,
        entry.cell.styleId as CyberStyleId,
        entry.cell.brushId,
      )) continue;
      enclosed.add(key);
    }
  }
  return enclosed;
}

function getCyberTunnelOutlineRole(
  enclosedVoidCells: ReadonlySet<string>,
  x: number,
  y: number,
  isSolid: (x: number, y: number) => boolean,
): CyberTunnelOutlineRole | null {
  const enclosed = (dx: number, dy: number) => enclosedVoidCells.has(smartCellKey(x + dx, y + dy));
  const south = enclosed(0, 1);
  const east = enclosed(1, 0);
  const west = enclosed(-1, 0);
  const north = enclosed(0, -1);
  const cardinalVoids = [south, east, west, north].filter(Boolean).length;
  const isExterior = (dx: number, dy: number) => !enclosed(dx, dy) && !isSolid(x + dx, y + dy);
  const southExt = isExterior(0, 1);
  const eastExt = isExterior(1, 0);
  const westExt = isExterior(-1, 0);
  const northExt = isExterior(0, -1);
  // 21 / 23 / 34 are letter-identical art for straight inner walls (A on the
  // void, B on the rim, C behind). The solver may swap to them only when the
  // matcher already picked those same four letters. A pinch with two void
  // sides is ABBA/AABB/BBAA — 14 / 25 / 30 / 61 — and must keep that.
  if (cardinalVoids === 1) {
    if (south && (eastExt || westExt)) return null;
    if (north && (eastExt || westExt)) return null;
    if (east && (southExt || northExt)) return null;
    if (west && (southExt || northExt)) return null;
    if (south && isSolid(x, y - 1)) return 'ceiling';
    if (east && isSolid(x - 1, y)) return 'left';
    if (west && isSolid(x + 1, y)) return 'right';
    if (north && isSolid(x, y + 1)) return 'floor';
  }
  return null;
}

function resolveStructureComponent(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  component: readonly CyberSemanticEntry[],
  enclosedVoidCells: ReadonlySet<string>,
): void {
  const bounds = getBounds(component);
  for (const entry of component) {
    const styleId = entry.cell.styleId as CyberStyleId;
    const ownerId = `${CYBER_CELL_OWNER_PREFIX}${entry.semanticKey}`;
    const mask8 = neighborMask8(tileData, state, entry);
    const tunnelRole = getCyberTunnelOutlineRole(
      enclosedVoidCells,
      entry.x,
      entry.y,
      (nx, ny) => sameCyberFamily(
        tileData,
        state,
        entry.layer,
        nx,
        ny,
        styleId,
        entry.cell.brushId,
      ),
    );
    const tunnelTile = tunnelRole ? resolveCyberTunnelOutlineTile(styleId, tunnelRole) : null;
    const resolved = tunnelTile?.layer === 'terrain'
      ? tunnelTile
      : tunnelTile
        ? resolveCyberStructureUnderground(styleId, entry.x, entry.y)
        : resolveCyberStructureTile8({
            styleId,
            neighborMask8: mask8,
            facade: 'plain',
            x: entry.x - bounds.minX,
            y: entry.y - bounds.minY,
            width: bounds.width,
            height: bounds.height,
            worldX: entry.x,
            worldY: entry.y,
          });
    const lockedValue = entry.cell.lockedValue ?? entry.cell.shapeValue;
    if (lockedValue !== undefined) {
      tileData[entry.layer][entry.y][entry.x] = lockedValue;
      state.ownedOutputs[smartOwnedOutputKey(entry.layer, entry.x, entry.y)] = {
        ownerId,
        partId: 'primary',
        kind: 'semantic',
        layer: entry.layer,
        value: lockedValue,
      };
    } else {
      addOwnedOutput(
        tileData, state, ownerId, 'primary', 'semantic', entry.x, entry.y, resolved, true,
        { brushId: entry.cell.brushId, sourceLayer: entry.layer },
      );
    }
  }
}

function contiguousRuns(
  entries: readonly CyberSemanticEntry[],
  axis: 'horizontal' | 'vertical',
): CyberSemanticEntry[][] {
  const buckets = new Map<number, CyberSemanticEntry[]>();
  for (const entry of entries) {
    const bucketKey = axis === 'horizontal' ? entry.y : entry.x;
    const bucket = buckets.get(bucketKey) ?? [];
    bucket.push(entry);
    buckets.set(bucketKey, bucket);
  }
  const runs: CyberSemanticEntry[][] = [];
  for (const bucket of buckets.values()) {
    bucket.sort((left, right) => axis === 'horizontal' ? left.x - right.x : left.y - right.y);
    let run: CyberSemanticEntry[] = [];
    for (const entry of bucket) {
      const previous = run[run.length - 1];
      const contiguous = !previous || (axis === 'horizontal'
        ? entry.x === previous.x + 1
        : entry.y === previous.y + 1);
      if (!contiguous) {
        if (run.length > 0) runs.push(run);
        run = [];
      }
      run.push(entry);
    }
    if (run.length > 0) runs.push(run);
  }
  return runs;
}

function extendRunThroughLegacy(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  run: readonly CyberSemanticEntry[],
  axis: 'horizontal' | 'vertical',
): { before: number; after: number } {
  const first = run[0]!;
  const last = run[run.length - 1]!;
  let before = 0;
  let after = 0;
  const isSame = (x: number, y: number) => sameCyberFamily(
    tileData, state, first.layer, x, y, first.cell.styleId as CyberStyleId, first.cell.brushId,
  );
  while (before < (axis === 'horizontal' ? ROOM_WIDTH : ROOM_HEIGHT)) {
    const x = axis === 'horizontal' ? first.x - before - 1 : first.x;
    const y = axis === 'vertical' ? first.y - before - 1 : first.y;
    if (!isSame(x, y) || hasCyberSmartSourceAt(state, first.layer, x, y)) break;
    before += 1;
  }
  while (after < (axis === 'horizontal' ? ROOM_WIDTH : ROOM_HEIGHT)) {
    const x = axis === 'horizontal' ? last.x + after + 1 : last.x;
    const y = axis === 'vertical' ? last.y + after + 1 : last.y;
    if (!isSame(x, y) || hasCyberSmartSourceAt(state, first.layer, x, y)) break;
    after += 1;
  }
  return { before, after };
}

function resolveRun(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  run: readonly CyberSemanticEntry[],
  familyId: Exclude<CyberFamilyId, 'structure' | 'framed-panel'>,
  supportTransforms?: { flipX: boolean; capFlipX: boolean },
): void {
  const first = run[0]!;
  const axis = familyId === 'support' ? 'vertical' : 'horizontal';
  const { before, after } = extendRunThroughLegacy(tileData, state, run, axis);
  const totalLength = before + run.length + after;
  let resolved: CyberResolvedTile[];
  if (familyId === 'platform') {
    if (totalLength < CYBER_FAMILY_DEFINITIONS.platform.minimumWidth) return;
    resolved = resolveCyberPlatformSpan(first.cell.styleId as CyberStyleId, totalLength);
  } else if (familyId === 'support') {
    resolved = resolveCyberSupportSpan(
      first.cell.styleId as CyberStyleId,
      totalLength,
      supportTransforms?.flipX ?? false,
      supportTransforms?.capFlipX,
    );
  } else if (familyId === 'neon-strip') {
    if (totalLength < CYBER_FAMILY_DEFINITIONS['neon-strip'].minimumWidth) return;
    resolved = resolveCyberNeonStrip(first.cell.styleId as CyberStyleId, totalLength);
  } else {
    resolved = resolveCyberRubbleColumn(first.cell.styleId as CyberStyleId, totalLength);
  }
  run.forEach((entry, index) => {
    const ownerId = `${CYBER_CELL_OWNER_PREFIX}${entry.semanticKey}`;
    const lockedValue = entry.cell.lockedValue ?? entry.cell.shapeValue;
    if (lockedValue !== undefined) {
      tileData[entry.layer][entry.y][entry.x] = lockedValue;
      state.ownedOutputs[smartOwnedOutputKey(entry.layer, entry.x, entry.y)] = {
        ownerId,
        partId: 'primary',
        kind: 'semantic',
        layer: entry.layer,
        value: lockedValue,
      };
      return;
    }
    const tile = familyId === 'rubble'
      ? applyCyberRubbleVariety(
        resolved[before + index]!,
        entry.x,
        entry.y,
        entry.cell.varietySalt ?? 0,
        0,
      )
      : resolved[before + index]!;
    addOwnedOutput(
      tileData,
      state,
      ownerId,
      'primary',
      'semantic',
      entry.x,
      entry.y,
      tile,
      true,
      { brushId: entry.cell.brushId, sourceLayer: entry.layer },
    );
  });
}

function resolveSupportComponent(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  component: readonly CyberSemanticEntry[],
): void {
  const bounds = getBounds(component);
  const isMultiColumn = bounds.width > 1;
  for (const run of contiguousRuns(component, 'vertical')) {
    const normalizedColumn = run[0]!.x - bounds.minX;
    const pairIndex = Math.floor(normalizedColumn / 2);
    const pairColumn = normalizedColumn % 2;
    // The v13 reference uses normal/mirrored body and base pairs. Its cap
    // vocabulary alternates N/X then X/N per normalized pair.
    const flipX = isMultiColumn && pairColumn === 1;
    const capFlipX = isMultiColumn && ((pairColumn === 1) !== (pairIndex % 2 === 1));
    resolveRun(tileData, state, run, 'support', { flipX, capFlipX });
  }
}

function resolveCyberLetterCells(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  entries: readonly CyberSemanticEntry[],
): void {
  if (entries.length === 0) return;
  const groups = new Map<string, CyberSemanticEntry[]>();
  for (const entry of entries) {
    const key = `${entry.layer}:${entry.cell.styleId}`;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const styleId = group[0]!.cell.styleId as CyberStyleId;
    const layer = group[0]!.layer;
    const concreteEntry = group.find((entry) => entry.cell.brushId === 'cyber.concrete');
    const enclosedVoidCells = concreteEntry
      ? findEnclosedCyberVoidCells(tileData, state, concreteEntry)
      : new Set<string>();
    const fieldCells = new Map<string, {
      x: number;
      y: number;
      brushId: CyberLetterBrushId;
      varietySalt?: number;
    }>();
    for (const entry of group) {
      fieldCells.set(letterCellKey(entry.x, entry.y), {
        x: entry.x,
        y: entry.y,
        brushId: entry.cell.brushId as CyberLetterBrushId,
        varietySalt: entry.cell.varietySalt,
      });
    }
    const style = getSmartStyleDefinition(styleId);
    for (let y = 0; y < ROOM_HEIGHT; y += 1) {
      for (let x = 0; x < ROOM_WIDTH; x += 1) {
        const key = letterCellKey(x, y);
        if (fieldCells.has(key) || hasCyberSmartSourceAt(state, layer, x, y)) continue;
        const decoded = decodeTileDataValue(tileData[layer][y]?.[x] ?? -1);
        const localIndex = decoded.gid - style.firstGid;
        if (localIndex < 0 || localIndex >= style.tileCount) continue;
        const catalogEntry = CYBER_EDGE_CATALOG.find((entry) => entry.localIndex === localIndex);
        if (!catalogEntry) continue;
        if (localIndex === 36 || localIndex === 48 || localIndex === 60 || localIndex === 72) continue;
        fieldCells.set(key, { x, y, brushId: catalogEntry.brushId });
      }
    }
    const picks = resolveCyberLetterField(
      [...fieldCells.values()].sort((left, right) => (
        left.y - right.y || left.x - right.x || left.brushId.localeCompare(right.brushId)
      )),
      inBounds,
    );
    for (const entry of [...group].sort((left, right) => (
      left.y - right.y || left.x - right.x || left.cell.brushId.localeCompare(right.cell.brushId)
    ))) {
      const styleId = entry.cell.styleId as CyberStyleId;
      const ownerId = `${CYBER_CELL_OWNER_PREFIX}${entry.semanticKey}`;
      const pick = picks.get(letterCellKey(entry.x, entry.y));
      const isConcreteSolid = (nx: number, ny: number) => sameCyberFamily(
        tileData,
        state,
        layer,
        nx,
        ny,
        styleId,
        'cyber.concrete',
      );
      const tunnelRole = entry.cell.brushId === 'cyber.concrete'
        ? getCyberTunnelOutlineRole(
          enclosedVoidCells,
          entry.x,
          entry.y,
          isConcreteSolid,
        )
        : null;
      const tunnelTile = tunnelRole ? resolveCyberTunnelOutlineTile(styleId, tunnelRole) : null;
      const tunnelEdges = tunnelTile?.layer === 'terrain'
        ? edgesForOrientedCatalogTile(
          tunnelTile.localIndex,
          tunnelTile.flipX,
          tunnelTile.flipY,
          'cyber.concrete',
        )
        : null;
      // Tunnel 21 / 23 / 34 is only an art swap among letter-identical catalog
      // rows (same four sides). Never stamp a tile whose letters disagree with
      // the matcher — A faces voids, and occupied sides must match neighbors.
      const useTunnelArt = Boolean(
        tunnelTile
        && tunnelEdges
        && pick
        && tunnelEdges === pick.edges,
      );
      const resolved: CyberResolvedTile = useTunnelArt && tunnelTile
        ? tunnelTile
        : {
            tilesetKey: CYBER_STYLE_PROFILES[styleId].tilesetKey,
            localIndex: pick?.localIndex ?? 64,
            flipX: pick?.flipX ?? false,
            flipY: pick?.flipY ?? false,
            layer: 'terrain',
            styleId,
          };
      const lockedValue = entry.cell.lockedValue;
      if (lockedValue !== undefined) {
        tileData[entry.layer][entry.y][entry.x] = lockedValue;
        state.ownedOutputs[smartOwnedOutputKey(entry.layer, entry.x, entry.y)] = {
          ownerId,
          partId: 'primary',
          kind: 'semantic',
          layer: entry.layer,
          value: lockedValue,
        };
      } else {
        addOwnedOutput(
          tileData, state, ownerId, 'primary', 'semantic', entry.x, entry.y, resolved, true,
          { brushId: entry.cell.brushId, sourceLayer: entry.layer },
        );
        const tieOrient = pick
          ? orientCyberA10Overlay(entry.x, entry.y, pick, picks)
          : null;
        if (tieOrient) {
          const corner = tieOrient.flipX && tieOrient.flipY
            ? 'topLeft'
            : tieOrient.flipY
              ? 'topRight'
              : tieOrient.flipX
                ? 'bottomLeft'
                : 'bottomRight';
          addOwnedOutput(
            tileData,
            state,
            ownerId,
            'tie',
            'semantic',
            entry.x,
            entry.y,
            resolveCyberStructureTieTile(styleId, corner),
            true,
            { brushId: entry.cell.brushId, sourceLayer: entry.layer },
          );
        }
      }
    }
  }
}

function resolveCyberSemanticCells(tileData: RoomTileData, state: RoomSmartTerrainState): void {
  const entries = getCyberEntries(state);
  resolveCyberLetterCells(
    tileData,
    state,
    entries.filter((entry) => (
      isCyberLetterBrushId(entry.cell.brushId) && !isCyberSpanBrushId(entry.cell.brushId)
    )),
  );
  const groups = new Map<string, CyberSemanticEntry[]>();
  for (const entry of entries) {
    if (isCyberLetterBrushId(entry.cell.brushId) && !isCyberSpanBrushId(entry.cell.brushId)) continue;
    const familyId = getCyberFamilyId(entry.cell.brushId);
    const key = familyId === 'rubble'
      ? `${entry.layer}:rubble`
      : `${entry.layer}:${entry.cell.styleId}:${entry.cell.brushId}`;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const familyId = getCyberFamilyId(group[0]!.cell.brushId);
    if (familyId === 'framed-panel') {
      continue;
    } else if (familyId === 'support') {
      componentEntries(group).forEach((component) => resolveSupportComponent(tileData, state, component));
    } else if (familyId === 'rubble') {
      contiguousRuns(group, 'horizontal').forEach((run) => resolveRun(tileData, state, run, familyId));
    }
  }
}

function recipeBounds(recipe: SmartRecipeInstanceState): Bounds | null {
  return recipe.sourceCells.length > 0 ? recipe.bounds : null;
}

function recipeEntries(recipe: SmartRecipeInstanceState): CyberSemanticEntry[] {
  return recipe.sourceCells.map(({ layer, x, y }) => ({
    semanticKey: smartSemanticCellKey(layer, x, y),
    layer,
    x,
    y,
    cell: { styleId: recipe.styleId, brushId: recipe.brushId },
  }));
}

function horizontalSpanMiddleTile(
  familyId: 'platform' | 'neon-strip',
  styleId: CyberStyleId,
  sourceOffset: number,
): CyberResolvedTile {
  const cycleLength = familyId === 'platform'
    ? 1
    : 5;
  const sample = familyId === 'platform'
    ? resolveCyberPlatformSpan(styleId, cycleLength + 2)
    : resolveCyberNeonStrip(styleId, cycleLength + 2);
  const cycleOffset = Math.max(0, sourceOffset - 1) % cycleLength;
  return sample[1 + cycleOffset]!;
}

function resolveHorizontalSpanRecipe(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  recipe: SmartRecipeInstanceState,
  familyId: 'platform' | 'neon-strip',
): void {
  const bounds = recipe.bounds;
  for (const run of contiguousRuns(recipeEntries(recipe), 'horizontal')) {
    const { before, after } = extendRunThroughLegacy(tileData, state, run, 'horizontal');
    const totalLength = before + run.length + after;
    const minimum = CYBER_FAMILY_DEFINITIONS[familyId].minimumWidth;
    if (totalLength < minimum) continue;
    const resolved = familyId === 'platform'
      ? resolveCyberPlatformSpan(recipe.styleId as CyberStyleId, totalLength)
      : resolveCyberNeonStrip(recipe.styleId as CyberStyleId, totalLength);
    run.forEach((entry, index) => {
      const isLeftEnd = index === 0 && before === 0;
      const isRightEnd = index === run.length - 1 && after === 0;
      const sourceOffset = entry.x - bounds.minX;
      const tile = isLeftEnd
        ? resolved[0]!
        : isRightEnd
          ? resolved[resolved.length - 1]!
          : horizontalSpanMiddleTile(
              familyId,
              recipe.styleId as CyberStyleId,
              sourceOffset,
            );
      addOwnedOutput(
        tileData,
        state,
        recipe.ownerId,
        `row-${entry.y - bounds.minY}:column-${sourceOffset}`,
        'recipe',
        entry.x,
        entry.y,
        tile,
        true,
        { brushId: recipe.brushId, sourceLayer: recipe.anchor.layer },
      );
    });
  }
}

function resolveSupportRecipe(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  recipe: SmartRecipeInstanceState,
): void {
  const bounds = recipe.bounds;
  const entries = recipeEntries(recipe);
  const isMultiColumn = bounds.width > 1;
  for (const run of contiguousRuns(entries, 'vertical')) {
    const normalizedColumn = run[0]!.x - bounds.minX;
    const pairIndex = Math.floor(normalizedColumn / 2);
    const pairColumn = normalizedColumn % 2;
    const flipX = isMultiColumn && pairColumn === 1;
    const capFlipX = isMultiColumn && ((pairColumn === 1) !== (pairIndex % 2 === 1));
    const { before, after } = extendRunThroughLegacy(tileData, state, run, 'vertical');
    const resolved = resolveCyberSupportSpan(
      recipe.styleId as CyberStyleId,
      before + run.length + after,
      flipX,
      capFlipX,
    );
    run.forEach((entry, index) => addOwnedOutput(
      tileData,
      state,
      recipe.ownerId,
      `row-${entry.y - bounds.minY}:column-${normalizedColumn}`,
      'recipe',
      entry.x,
      entry.y,
      resolved[before + index]!,
      true,
      { brushId: recipe.brushId, sourceLayer: recipe.anchor.layer },
    ));
  }
}

function flattenLetterSpanRecipes(state: RoomSmartTerrainState): void {
  for (const [instanceId, recipe] of Object.entries(state.recipes)) {
    if (
      !isCyberStyleId(recipe.styleId)
      || !isCyberLetterBrushId(recipe.brushId)
      || isCyberSpanBrushId(recipe.brushId)
    ) continue;
    for (const source of recipe.sourceCells) {
      if (!inBounds(source.x, source.y)) continue;
      const semanticKey = smartSemanticCellKey(source.layer, source.x, source.y);
      if (!state.semanticCells[semanticKey]) {
        state.semanticCells[semanticKey] = {
          styleId: recipe.styleId,
          brushId: recipe.brushId,
        };
      }
    }
    clearOwnerSuppressions(state, recipe.ownerId);
    delete state.recipes[instanceId];
  }
}

function resolveCyberRecipes(tileData: RoomTileData, state: RoomSmartTerrainState): void {
  for (const recipe of Object.values(state.recipes)) {
    if (!isCyberStyleId(recipe.styleId)) continue;
    if (recipe.brushId === 'cyber.support') {
      resolveSupportRecipe(tileData, state, recipe);
      continue;
    }
    if (recipe.brushId === 'cyber.neon') {
      resolveHorizontalSpanRecipe(tileData, state, recipe, 'neon-strip');
      continue;
    }
    if (recipe.brushId !== 'cyber.fence' && recipe.recipeId !== CYBER_PANEL_RECIPE_ID && recipe.recipeId !== 'cyber.framed-panel') {
      continue;
    }
    const occupancy = fenceOccupancy(state, recipe.styleId, recipe.anchor.layer);
    for (const cell of recipe.sourceCells) {
      addOwnedOutput(
        tileData,
        state,
        recipe.ownerId,
        `row-${cell.y - recipe.bounds.minY}:column-${cell.x - recipe.bounds.minX}`,
        'recipe',
        cell.x,
        cell.y,
        resolveCyberFenceCell(recipe.styleId, {
          left: occupancy.has(`${cell.x - 1},${cell.y}`),
          right: occupancy.has(`${cell.x + 1},${cell.y}`),
          above: occupancy.has(`${cell.x},${cell.y - 1}`),
        }),
        true,
        { brushId: recipe.brushId, sourceLayer: recipe.anchor.layer },
      );
    }
  }
}

function resolveCyberRubbleBorders(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  entries: readonly CyberSemanticEntry[],
): void {
  const candidates = new Map<string, CyberSemanticEntry>();
  for (const entry of entries) {
    for (const [targetX, targetY] of [
      [entry.x, entry.y - 1],
      [entry.x + 1, entry.y],
      [entry.x, entry.y + 1],
      [entry.x - 1, entry.y],
    ]) {
      if (!inBounds(targetX, targetY) || sameCyberFamily(
        tileData,
        state,
        entry.layer,
        targetX,
        targetY,
        entry.cell.styleId as CyberStyleId,
        entry.cell.brushId,
      )) continue;
      const key = smartCellKey(targetX, targetY);
      const existing = candidates.get(key);
      if (!existing || entry.semanticKey.localeCompare(existing.semanticKey) < 0) {
        candidates.set(key, entry);
      }
    }
  }

  const addBorder = (
    owner: CyberSemanticEntry,
    x: number,
    y: number,
    part: Parameters<typeof resolveCyberRubbleBorderTile>[1],
    flipX = false,
    layer: Extract<LayerName, 'foreground' | 'background'> = 'foreground',
  ): void => addOwnedOutput(
    tileData,
    state,
    `${CYBER_CELL_OWNER_PREFIX}${owner.semanticKey}`,
    `rubble-${part}`,
    'semantic',
    x,
    y,
    applyCyberRubbleVariety(
      resolveCyberRubbleBorderTile(owner.cell.styleId as CyberStyleId, part, flipX, layer),
      x,
      y,
      owner.cell.varietySalt ?? 0,
      part.charCodeAt(0) + (layer === 'background' ? 32 : 0),
      cyberRubbleEdgeFlipAxes(part),
    ),
    false,
    { brushId: owner.cell.brushId, sourceLayer: owner.layer },
  );

  for (const [targetKey, candidate] of candidates) {
    const [x, y] = targetKey.split(',').map(Number) as [number, number];
    const same = (targetX: number, targetY: number) => sameCyberFamily(
      tileData,
      state,
      candidate.layer,
      targetX,
      targetY,
      candidate.cell.styleId as CyberStyleId,
      candidate.cell.brushId,
    );
    const above = same(x, y - 1);
    const right = same(x + 1, y);
    const below = same(x, y + 1);
    const left = same(x - 1, y);
    const cardinalCount = Number(above) + Number(right) + Number(below) + Number(left);
    const adjacentOwners = entries.filter((entry) => (
      entry.cell.brushId === 'cyber.rubble'
      && ((above && entry.x === x && entry.y === y - 1)
        || (right && entry.x === x + 1 && entry.y === y)
        || (below && entry.x === x && entry.y === y + 1)
        || (left && entry.x === x - 1 && entry.y === y))
    )).sort((first, second) => first.semanticKey.localeCompare(second.semanticKey));
    const owner = adjacentOwners[0] ?? candidate;
    if (cardinalCount === 1) {
      if (below) addBorder(owner, x, y, 'top');
      else if (above) addBorder(owner, x, y, 'bottom');
      else if (right) addBorder(owner, x, y, 'left');
      else if (left) addBorder(owner, x, y, 'right');
    } else if (cardinalCount === 2) {
      if (below && right) addBorder(owner, x, y, 'topLeft');
      else if (below && left) addBorder(owner, x, y, 'topLeft', true);
      else if (above && right) addBorder(owner, x, y, 'bottomRight', true);
      else if (above && left) addBorder(owner, x, y, 'bottomRight');
    } else if (cardinalCount === 3) {
      if (!right) {
        addBorder(owner, x, y, 'topLeft', true);
        addBorder(owner, x, y, 'bottom', false, 'background');
      } else if (!left) {
        addBorder(owner, x, y, 'topLeft');
        addBorder(owner, x, y, 'bottom', false, 'background');
      } else if (!below) {
        addBorder(owner, x, y, 'bottomRight');
        addBorder(owner, x, y, 'left', false, 'background');
      } else if (!above) {
        addBorder(owner, x, y, 'topLeft', true);
        addBorder(owner, x, y, 'left', false, 'background');
      }
    }
  }
}

function resolveCyberStructuralOverlays(tileData: RoomTileData, state: RoomSmartTerrainState): void {
  const entries = getCyberEntries(state);
  // Rubble outlines are part of its basic shape grammar, not optional decor.
  resolveCyberRubbleBorders(
    tileData,
    state,
    entries.filter(({ cell }) => cell.brushId === 'cyber.rubble'),
  );
}

export function resolveSmartRecipeDocument(document: SmartRecipeDocument): SmartRecipeDocument {
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
  return recipe.anchor.layer === layer
    && recipe.sourceCells.some((cell) => cell.x === x && cell.y === y);
}

function fenceOccupancy(
  state: RoomSmartTerrainState,
  styleId: CyberStyleId,
  layer: LayerName,
): Set<string> {
  const occupancy = new Set<string>();
  for (const recipe of Object.values(state.recipes)) {
    if (
      recipe.recipeId !== CYBER_PANEL_RECIPE_ID && recipe.recipeId !== 'cyber.framed-panel'
    ) continue;
    if (recipe.styleId !== styleId || recipe.anchor.layer !== layer) continue;
    for (const cell of recipe.sourceCells) occupancy.add(`${cell.x},${cell.y}`);
  }
  return occupancy;
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

export function applySmartBrushCells(
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
  return resolveSmartRecipeDocument({ tileData, smartTerrain });
}

export function applySmartBrushOutlineCells(
  document: SmartRecipeDocument,
  options: ApplySmartBrushOutlineCellsOptions,
): SmartRecipeDocument {
  const outlineCells = Array.from(options.outlineCells).filter(({ x, y }) => inBounds(x, y));
  if (isCyberLetterBrushId(options.brushId)) {
    return applySmartBrushCells(document, { ...options, cells: outlineCells, mode: 'paint' });
  }
  const filledCells = Array.from(options.filledCells).filter(({ x, y }) => inBounds(x, y));
  const reference = applySmartBrushCells(document, { ...options, cells: filledCells, mode: 'paint' });
  const result = applySmartBrushCells(document, { ...options, cells: outlineCells, mode: 'paint' });
  const brush = getSmartBrushDefinition(options.brushId);
  const layer = options.layer ?? brush.defaultLayer;
  for (const { x, y } of outlineCells) {
    const key = smartSemanticCellKey(layer, x, y);
    const semantic = result.smartTerrain.semanticCells[key];
    const shapeValue = reference.tileData[layer][y]?.[x] ?? -1;
    if (semantic && shapeValue > 0) semantic.shapeValue = shapeValue;
  }
  return resolveSmartRecipeDocument(result);
}

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
    const semanticOwnerId = isCyberSmartBrushId(semantic.brushId)
      ? `${CYBER_CELL_OWNER_PREFIX}${semanticKey}`
      : `${LEGACY_SEMANTIC_OWNER_PREFIX}${semanticKey}`;
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
  if (
    output?.ownerId.startsWith('cyber:')
    || output?.ownerId.startsWith(LEGACY_SEMANTIC_OWNER_PREFIX)
  ) {
    if (!(output.kind === 'semantic' && output.partId === 'primary' && value > 0)) {
      addSuppressedPart(next, output.ownerId, output.partId);
    }
    delete next.ownedOutputs[outputKey];
  }
  return next;
}

export function clearSmartRecipeLayerState(
  state: RoomSmartTerrainState,
  layer: LayerName,
): RoomSmartTerrainState {
  const next = cloneRoomSmartTerrainState(state);
  const removedOwnerIds = new Set<string>();
  for (const key of Object.keys(next.semanticCells)) {
    if (key.startsWith(`${layer}:`) && !next.semanticCells[key]?.legacySource) {
      const brushId = next.semanticCells[key]!.brushId;
      removedOwnerIds.add(isCyberSmartBrushId(brushId)
        ? `${CYBER_CELL_OWNER_PREFIX}${key}`
        : `${LEGACY_SEMANTIC_OWNER_PREFIX}${key}`);
      delete next.semanticCells[key];
    }
  }
  for (const [instanceId, recipe] of Object.entries(next.recipes)) {
    if (recipe.anchor.layer === layer) {
      removedOwnerIds.add(recipe.ownerId);
      delete next.recipes[instanceId];
    }
  }
  for (const [key, output] of Object.entries(next.ownedOutputs)) {
    if (
      !output.ownerId.startsWith('cyber:')
      && !output.ownerId.startsWith(LEGACY_SEMANTIC_OWNER_PREFIX)
    ) continue;
    if (output.layer === layer && !removedOwnerIds.has(output.ownerId)) {
      addSuppressedPart(next, output.ownerId, output.partId);
    }
    if (output.layer === layer || removedOwnerIds.has(output.ownerId)) delete next.ownedOutputs[key];
  }
  next.suppressedOutputParts = next.suppressedOutputParts.filter((entry) => (
    ![...removedOwnerIds].some((ownerId) => entry.startsWith(`${ownerId}:`))
  ));
  return next;
}

void findEnclosedCyberVoidCells;
void resolveStructureComponent;
void resolveHorizontalSpanRecipe;
