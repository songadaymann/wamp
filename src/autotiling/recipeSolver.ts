import { ROOM_HEIGHT, ROOM_WIDTH, type LayerName } from '../config/room';
import { decodeTileDataValue } from '../config/editorState';
import type { RoomTileData } from '../persistence/roomModel';
import {
  CYBER_DETAIL_ALLOWLIST,
  CYBER_FAMILY_DEFINITIONS,
  CYBER_NEIGHBOR,
  resolveCyberFramedPanel,
  resolveCyberNeonStrip,
  resolveCyberPlatformSpan,
  resolveCyberRubbleColumn,
  resolveCyberRubbleDetail,
  resolveCyberStructureTile8,
  resolveCyberSupportSpan,
  selectCyberDetailCandidates,
  type CyberDetailCandidate,
  type CyberFamilyId,
  type CyberResolvedTile,
  type CyberStyleId,
} from './cyberProfile';
import {
  cloneRoomSmartTerrainState,
  smartCellKey,
  smartOwnedOutputKey,
  smartOwnedOutputPartKey,
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

export interface SmartRecipeDocument {
  tileData: RoomTileData;
  smartTerrain: RoomSmartTerrainState;
}

export interface ApplySmartBrushCellsOptions {
  cells: Iterable<SmartCellCoordinate>;
  mode: 'paint' | 'erase';
  brushId: SmartBrushId;
  styleId: SmartStyleId;
}

export interface ApplySmartBrushOutlineCellsOptions {
  filledCells: Iterable<SmartCellCoordinate>;
  outlineCells: Iterable<SmartCellCoordinate>;
  brushId: SmartBrushId;
  styleId: SmartStyleId;
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
const CYBER_RECIPE_OWNER_PREFIX = 'cyber:recipe:';
const CYBER_PANEL_RECIPE_ID = 'cyber.framed-panel';
const CYBER_BRUSH_PREFIX = 'cyber.';

const CYBER_FAMILY_BY_BRUSH: Partial<Record<SmartBrushId, CyberFamilyId>> = {
  'cyber.structure': 'structure',
  'cyber.platform': 'platform',
  'cyber.rubble': 'rubble',
  'cyber.support': 'support',
  'cyber.neon-strip': 'neon-strip',
  'cyber.framed-panel': 'framed-panel',
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
  const semantic = state.semanticCells[smartSemanticCellKey(layer, x, y)];
  if (semantic) return semantic.styleId === styleId && semantic.brushId === brushId;
  return sameCyberLegacyTile(tileData, layer, x, y, styleId, brushId);
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
): void {
  if (!inBounds(x, y)) return;
  if (state.suppressedOutputParts.includes(smartOwnedOutputPartKey(ownerId, partId))) return;
  const value = resolveSmartTileValue(tile.styleId, tile);
  const existingValue = tileData[tile.layer][y]?.[x] ?? -1;
  if (!force && existingValue > 0) return;
  tileData[tile.layer][y][x] = value;
  state.ownedOutputs[smartOwnedOutputKey(tile.layer, x, y)] = {
    ownerId,
    partId,
    kind,
    layer: tile.layer,
    value,
  };
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

function resolveStructureComponent(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  component: readonly CyberSemanticEntry[],
): void {
  const bounds = getBounds(component);
  for (const entry of component) {
    const styleId = entry.cell.styleId as CyberStyleId;
    const ownerId = `${CYBER_CELL_OWNER_PREFIX}${entry.semanticKey}`;
    const resolved = resolveCyberStructureTile8({
      styleId,
      neighborMask8: neighborMask8(tileData, state, entry),
      facade: 'tower',
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
      addOwnedOutput(tileData, state, ownerId, 'primary', 'semantic', entry.x, entry.y, resolved, true);
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
    if (!isSame(x, y) || state.semanticCells[smartSemanticCellKey(first.layer, x, y)]) break;
    before += 1;
  }
  while (after < (axis === 'horizontal' ? ROOM_WIDTH : ROOM_HEIGHT)) {
    const x = axis === 'horizontal' ? last.x + after + 1 : last.x;
    const y = axis === 'vertical' ? last.y + after + 1 : last.y;
    if (!isSame(x, y) || state.semanticCells[smartSemanticCellKey(first.layer, x, y)]) break;
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
    addOwnedOutput(
      tileData,
      state,
      ownerId,
      'primary',
      'semantic',
      entry.x,
      entry.y,
      resolved[before + index]!,
      true,
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

function resolveCyberSemanticCells(tileData: RoomTileData, state: RoomSmartTerrainState): void {
  const entries = getCyberEntries(state);
  const groups = new Map<string, CyberSemanticEntry[]>();
  for (const entry of entries) {
    const key = `${entry.layer}:${entry.cell.styleId}:${entry.cell.brushId}`;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const familyId = getCyberFamilyId(group[0]!.cell.brushId);
    if (familyId === 'structure') {
      componentEntries(group).forEach((component) => resolveStructureComponent(tileData, state, component));
    } else if (familyId === 'framed-panel') {
      continue;
    } else if (familyId === 'support') {
      componentEntries(group).forEach((component) => resolveSupportComponent(tileData, state, component));
    } else {
      contiguousRuns(group, 'horizontal').forEach((run) => resolveRun(tileData, state, run, familyId));
    }
  }
}

function recipeBounds(recipe: SmartRecipeInstanceState): Bounds | null {
  if (recipe.sourceCells.length === 0) return null;
  return getBounds(recipe.sourceCells.map(({ x, y }) => ({ x, y })) as CyberSemanticEntry[]);
}

function resolveCyberRecipes(tileData: RoomTileData, state: RoomSmartTerrainState): void {
  for (const [instanceId, recipe] of Object.entries(state.recipes)) {
    if (recipe.recipeId !== CYBER_PANEL_RECIPE_ID || recipe.brushId !== 'cyber.framed-panel') continue;
    if (!isCyberStyleId(recipe.styleId)) continue;
    const bounds = recipeBounds(recipe);
    if (!bounds || bounds.width < CYBER_FAMILY_DEFINITIONS['framed-panel'].minimumWidth) continue;
    const rows = resolveCyberFramedPanel(recipe.styleId, bounds.width);
    if (state.detailsEnabled && bounds.width > 2) {
      const detailColumn = Math.floor((bounds.width - 1) / 2);
      rows[1]![detailColumn] = {
        ...rows[1]![detailColumn]!,
        localIndex: 59,
        flipX: false,
        flipY: false,
      };
    }
    const ownerId = `${CYBER_RECIPE_OWNER_PREFIX}${instanceId}`;
    for (let row = 0; row < rows.length; row += 1) {
      for (let column = 0; column < rows[row]!.length; column += 1) {
        addOwnedOutput(
          tileData,
          state,
          ownerId,
          `row-${row}:column-${column}`,
          'recipe',
          bounds.minX + column,
          bounds.minY + row,
          rows[row]![column]!,
          true,
        );
      }
    }
  }
}

function stableDetailTile(entry: CyberSemanticEntry): CyberResolvedTile {
  const hash = Math.abs(
    Math.imul(entry.x + 31, 73856093)
      ^ Math.imul(entry.y + 17, 19349663),
  );
  const localIndex = CYBER_DETAIL_ALLOWLIST[hash % CYBER_DETAIL_ALLOWLIST.length]!;
  const styleId = entry.cell.styleId as CyberStyleId;
  return {
    tilesetKey: getSmartStyleDefinition(styleId).tilesetKey,
    localIndex,
    layer: 'foreground',
    flipX: (hash & 2) !== 0,
    flipY: (hash & 4) !== 0,
    styleId,
  };
}

function resolveCyberDetails(tileData: RoomTileData, state: RoomSmartTerrainState): void {
  if (!state.detailsEnabled) return;
  const entries = getCyberEntries(state);
  const structureEntries = entries.filter(({ cell }) => cell.brushId === 'cyber.structure');
  const detailCandidates: CyberDetailCandidate[] = structureEntries
    .filter((entry) => {
      const hash = Math.abs(Math.imul(entry.x + 31, 73856093) ^ Math.imul(entry.y + 17, 19349663));
      return hash % 8 === 0;
    })
    .map((entry) => ({ x: entry.x, y: entry.y, tile: stableDetailTile(entry) }));
  for (const candidate of selectCyberDetailCandidates(detailCandidates, structureEntries.length)) {
    const semanticKey = smartSemanticCellKey('terrain', candidate.x, candidate.y);
    addOwnedOutput(
      tileData,
      state,
      `${CYBER_CELL_OWNER_PREFIX}${semanticKey}`,
      'detail',
      'semantic',
      candidate.x,
      candidate.y,
      candidate.tile,
      false,
    );
  }

  for (const entry of entries.filter(({ cell }) => cell.brushId === 'cyber.rubble')) {
    const hash = Math.abs(Math.imul(entry.x + 31, 73856093) ^ Math.imul(entry.y + 17, 19349663));
    if (hash % 8 !== 0) continue;
    addOwnedOutput(
      tileData,
      state,
      `${CYBER_CELL_OWNER_PREFIX}${entry.semanticKey}`,
      'rubble-detail',
      'semantic',
      entry.x,
      entry.y,
      resolveCyberRubbleDetail(entry.cell.styleId as CyberStyleId, entry.x, entry.y),
      false,
    );
  }
}

export function resolveSmartRecipeDocument(document: SmartRecipeDocument): SmartRecipeDocument {
  const tileData = cloneTileData(document.tileData);
  const smartTerrain = cloneRoomSmartTerrainState(document.smartTerrain);
  if (smartTerrain.editingDisabled) return { tileData, smartTerrain };
  clearCyberOwnedOutputs(tileData, smartTerrain);
  resolveCyberSemanticCells(tileData, smartTerrain);
  resolveCyberRecipes(tileData, smartTerrain);
  resolveCyberDetails(tileData, smartTerrain);
  return { tileData, smartTerrain };
}

function clearCompatibilityCellAt(
  state: RoomSmartTerrainState,
  layer: LayerName,
  x: number,
  y: number,
): void {
  const key = smartCellKey(x, y);
  if (layer === 'terrain') delete state.cells[key];
  if (layer === 'background') delete state.backdropCells[key];
}

function clearShapeValuesAround(
  state: RoomSmartTerrainState,
  layer: LayerName,
  x: number,
  y: number,
  styleId: SmartStyleId,
  brushId: SmartBrushId,
): void {
  const offsets: readonly (readonly [number, number])[] = brushId === 'cyber.structure'
    ? [
      [0, 0], [0, -1], [1, -1], [1, 0], [1, 1],
      [0, 1], [-1, 1], [-1, 0], [-1, -1],
    ]
    : [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]];
  for (const [dx, dy] of offsets) {
    const targetX = x + dx;
    const targetY = y + dy;
    const semantic = state.semanticCells[smartSemanticCellKey(layer, targetX, targetY)];
    const matches = brushId === 'cyber.structure'
      ? semantic?.brushId === brushId
      : semantic?.styleId === styleId && semantic.brushId === brushId;
    if (matches && semantic) delete semantic.shapeValue;
  }
}

function nextPanelInstanceId(state: RoomSmartTerrainState): string {
  let index = 1;
  while (state.recipes[`cyber-panel-${index}`]) index += 1;
  return `cyber-panel-${index}`;
}

function isPanelRecipeAt(recipe: SmartRecipeInstanceState, x: number, y: number): boolean {
  if (recipe.recipeId !== CYBER_PANEL_RECIPE_ID) return false;
  const bounds = recipeBounds(recipe);
  return Boolean(bounds && x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.minY + 1);
}

function removePanelRecipe(state: RoomSmartTerrainState, instanceId: string): void {
  delete state.recipes[instanceId];
  const ownerId = `${CYBER_RECIPE_OWNER_PREFIX}${instanceId}`;
  state.suppressedOutputParts = state.suppressedOutputParts.filter(
    (entry) => !entry.startsWith(`${ownerId}:`),
  );
}

function applyPanelCells(
  state: RoomSmartTerrainState,
  cells: readonly SmartCellCoordinate[],
  mode: 'paint' | 'erase',
  styleId: CyberStyleId,
): void {
  if (mode === 'erase') {
    const removed = new Set<string>();
    for (const cell of cells) {
      for (const [instanceId, recipe] of Object.entries(state.recipes)) {
        if (isPanelRecipeAt(recipe, cell.x, cell.y)) removed.add(instanceId);
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
    if (recipe.recipeId !== CYBER_PANEL_RECIPE_ID || recipe.styleId !== styleId) return false;
    const bounds = recipeBounds(recipe);
    return Boolean(bounds
      && bounds.minY === anchorY
      && minX <= bounds.maxX + 1
      && maxX >= bounds.minX - 1);
  });
  const matchingIds = new Set(matching.map(([instanceId]) => instanceId));
  for (const [instanceId, recipe] of Object.entries(state.recipes)) {
    if (recipe.recipeId !== CYBER_PANEL_RECIPE_ID || matchingIds.has(instanceId)) continue;
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
  state.recipes[instanceId] = {
    recipeId: CYBER_PANEL_RECIPE_ID,
    brushId: 'cyber.framed-panel',
    styleId,
    anchor: { layer: 'foreground', x: orderedX[0]!, y: anchorY },
    sourceCells: orderedX.map((x) => ({ layer: 'foreground', x, y: anchorY })),
    parameters: { width: orderedX.length, height: 2 },
  };
  const ownerId = `${CYBER_RECIPE_OWNER_PREFIX}${instanceId}`;
  state.suppressedOutputParts = state.suppressedOutputParts.filter(
    (entry) => !entry.startsWith(`${ownerId}:`),
  );
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
  if (options.brushId === 'cyber.framed-panel') {
    applyPanelCells(smartTerrain, cells, options.mode, options.styleId);
  } else {
    const layer = brush.defaultLayer;
    for (const { x, y } of cells) {
      const semanticKey = smartSemanticCellKey(layer, x, y);
      clearShapeValuesAround(smartTerrain, layer, x, y, options.styleId, options.brushId);
      clearCompatibilityCellAt(smartTerrain, layer, x, y);
      if (options.mode === 'erase') {
        delete smartTerrain.semanticCells[semanticKey];
        tileData[layer][y][x] = -1;
      } else {
        smartTerrain.semanticCells[semanticKey] = {
          styleId: options.styleId,
          brushId: options.brushId,
        };
      }
      smartTerrain.suppressedOutputParts = smartTerrain.suppressedOutputParts.filter(
        (entry) => !entry.startsWith(`${CYBER_CELL_OWNER_PREFIX}${semanticKey}:`),
      );
    }
  }
  return resolveSmartRecipeDocument({ tileData, smartTerrain });
}

export function applySmartBrushOutlineCells(
  document: SmartRecipeDocument,
  options: ApplySmartBrushOutlineCellsOptions,
): SmartRecipeDocument {
  const filledCells = Array.from(options.filledCells).filter(({ x, y }) => inBounds(x, y));
  const outlineCells = Array.from(options.outlineCells).filter(({ x, y }) => inBounds(x, y));
  const reference = applySmartBrushCells(document, { ...options, cells: filledCells, mode: 'paint' });
  const result = applySmartBrushCells(document, { ...options, cells: outlineCells, mode: 'paint' });
  const brush = getSmartBrushDefinition(options.brushId);
  for (const { x, y } of outlineCells) {
    const key = smartSemanticCellKey(brush.defaultLayer, x, y);
    const semantic = result.smartTerrain.semanticCells[key];
    const shapeValue = reference.tileData[brush.defaultLayer][y]?.[x] ?? -1;
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
    const semanticOwnerId = `${CYBER_CELL_OWNER_PREFIX}${semanticKey}`;
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
  if (output?.ownerId.startsWith('cyber:')) {
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
      removedOwnerIds.add(`${CYBER_CELL_OWNER_PREFIX}${key}`);
      delete next.semanticCells[key];
    }
  }
  for (const [instanceId, recipe] of Object.entries(next.recipes)) {
    if (recipe.anchor.layer === layer) {
      removedOwnerIds.add(`${CYBER_RECIPE_OWNER_PREFIX}${instanceId}`);
      delete next.recipes[instanceId];
    }
  }
  for (const [key, output] of Object.entries(next.ownedOutputs)) {
    if (!output.ownerId.startsWith('cyber:')) continue;
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
