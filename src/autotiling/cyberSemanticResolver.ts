/** Cyber semantic topology and structural-overlay rendering. */
import { ROOM_HEIGHT, ROOM_WIDTH, type LayerName } from '../config/room';
import { decodeTileDataValue } from '../config/editorState';
import type { RoomTileData } from '../persistence/roomModel';
import {
  CYBER_STYLE_PROFILES,
  applyCyberRubbleVariety,
  cyberRubbleEdgeFlipAxes,
  resolveCyberRubbleBorderTile,
  resolveCyberStructureTieTile,
  resolveCyberTunnelOutlineTile,
  type CyberFamilyId,
  type CyberResolvedTile,
  type CyberStyleId,
  type CyberTunnelOutlineRole,
} from './cyberProfile';
import {
  getCyberFamilyId,
  isCyberSmartBrushId,
  isCyberSpanBrushId,
  isCyberStyleId,
} from './cyberRecipeFamily';
import {
  getCyberFamilyMinimumWidth,
  resolveCyberLinearFamilyTiles,
} from './cyberSpanResolver';
import { resolveCyberRubbleBorderPlacements } from './cyberRubbleResolver';
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
  smartCellKey,
  smartOwnedOutputKey,
  smartSemanticCellKey,
  type RoomSmartTerrainState,
  type SmartBrushId,
  type SmartCellCoordinate,
} from './model';
import {
  getSmartBrushDefinition,
  getSmartStyleDefinition,
} from './registry';
import {
  CYBER_CELL_OWNER_PREFIX,
  addOwnedOutput,
  getBounds,
  inBounds,
  parseLayerCellKey,
  type CyberSemanticEntry,
} from './cyberRecipeState';

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

export function contiguousRuns(
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

export function extendRunThroughLegacy(
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
  if (
    (familyId === 'platform' || familyId === 'neon-strip')
    && totalLength < getCyberFamilyMinimumWidth(familyId)
  ) return;
  const resolved = resolveCyberLinearFamilyTiles(
    familyId,
    first.cell.styleId as CyberStyleId,
    totalLength,
    supportTransforms,
  );
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

export function resolveCyberSemanticCells(tileData: RoomTileData, state: RoomSmartTerrainState): void {
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
    const adjacentOwners = entries.filter((entry) => (
      entry.cell.brushId === 'cyber.rubble'
      && ((above && entry.x === x && entry.y === y - 1)
        || (right && entry.x === x + 1 && entry.y === y)
        || (below && entry.x === x && entry.y === y + 1)
        || (left && entry.x === x - 1 && entry.y === y))
    )).sort((first, second) => first.semanticKey.localeCompare(second.semanticKey));
    const owner = adjacentOwners[0] ?? candidate;
    for (const placement of resolveCyberRubbleBorderPlacements({ above, right, below, left })) {
      addBorder(
        owner,
        x,
        y,
        placement.part,
        placement.flipX ?? false,
        placement.layer ?? 'foreground',
      );
    }
  }
}

export function resolveCyberStructuralOverlays(tileData: RoomTileData, state: RoomSmartTerrainState): void {
  const entries = getCyberEntries(state);
  // Rubble outlines are part of its basic shape grammar, not optional decor.
  resolveCyberRubbleBorders(
    tileData,
    state,
    entries.filter(({ cell }) => cell.brushId === 'cyber.rubble'),
  );
}
