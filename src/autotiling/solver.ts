import { ROOM_HEIGHT, ROOM_WIDTH } from '../config/room';
import { decodeTileDataValue, encodeTileDataValue } from '../config/editorState';
import { getTilesetByKey } from '../config/tilesets';
import type { RoomTileData } from '../persistence/roomModel';
import {
  cloneRoomSmartTerrainState,
  smartCellKey,
  smartDecorationSlotKey,
  type RoomSmartTerrainState,
  type SmartTerrainCellState,
  type SmartTerrainMaterial,
  type SmartTerrainTheme,
} from './model';

export interface SmartCellCoordinate {
  x: number;
  y: number;
}

export interface SmartTerrainDocument {
  tileData: RoomTileData;
  smartTerrain: RoomSmartTerrainState;
}

export interface ApplySmartCellsOptions {
  cells: Iterable<SmartCellCoordinate>;
  mode: 'paint' | 'erase';
  theme: SmartTerrainTheme;
  material: SmartTerrainMaterial;
}

interface FamilyRule {
  isolated: number;
  topLeft: number;
  top: number[];
  topRight: number;
  left: number[];
  center: number[];
  right: number[];
  bottomLeft: number;
  bottom: number[];
  bottomRight: number;
  concaveTopLeft?: number;
  concaveTopRight?: number;
  concaveBottomLeft?: number;
  concaveBottomRight?: number;
  platformLeft: number;
  platformMiddle: number[];
  platformRight: number;
}

interface ResolvedLocalTile {
  localIndex: number;
  flipX?: boolean;
  flipY?: boolean;
}

/**
 * Local tile slots in the 12 x 6 Forest/Desert/Cave/Gothic sheets.
 * These are intentionally centralized so art-slot corrections do not require
 * touching the topology solver. Local index = row * 12 + column (zero-based).
 */
export const SMART_TILESET_SLOTS = {
  ground: {
    isolated: 47,
    topLeft: 14,
    top: [15, 16],
    topRight: 17,
    left: [37],
    center: [27, 28, 39, 40],
    right: [42],
    bottomLeft: 49,
    bottom: [50, 51, 52, 53],
    bottomRight: 54,
    outerConcave: { topLeft: 26, topRight: 29, bottomLeft: 38, bottomRight: 41 },
    // The no-grass family at the sheet's upper-right outlines enclosed air.
    innerVoid: {
      topLeft: 33,
      top: [34],
      topRight: 35,
      left: 37,
      right: 42,
      bottomLeft: 49,
      bottom: [50, 51, 52, 53],
      bottomRight: 54,
    },
  },
  platform: {
    // 47 is the circular hole/island art, not a platform end.
    isolated: 45,
    left: 44,
    middle: [45],
    right: 46,
  },
  feature: {
    base: 12,
    border: {
      top: 0,
      bottom: 24,
      left: 1,
      right: 13,
      topLeft: 10,
      bottomRight: 22,
    },
  },
  // Conservative first-pass allowlist. These are the exact slots to tune.
  // Only one in eight eligible exposed ground cells receives one.
  groundDecoration: [2, 3, 4, 5],
} as const;

const COMMON_RULE: FamilyRule = {
  isolated: SMART_TILESET_SLOTS.ground.isolated,
  topLeft: SMART_TILESET_SLOTS.ground.topLeft,
  top: [...SMART_TILESET_SLOTS.ground.top],
  topRight: SMART_TILESET_SLOTS.ground.topRight,
  left: [...SMART_TILESET_SLOTS.ground.left],
  center: [...SMART_TILESET_SLOTS.ground.center],
  right: [...SMART_TILESET_SLOTS.ground.right],
  bottomLeft: SMART_TILESET_SLOTS.ground.bottomLeft,
  bottom: [...SMART_TILESET_SLOTS.ground.bottom],
  bottomRight: SMART_TILESET_SLOTS.ground.bottomRight,
  concaveTopLeft: SMART_TILESET_SLOTS.ground.outerConcave.topLeft,
  concaveTopRight: SMART_TILESET_SLOTS.ground.outerConcave.topRight,
  concaveBottomLeft: SMART_TILESET_SLOTS.ground.outerConcave.bottomLeft,
  concaveBottomRight: SMART_TILESET_SLOTS.ground.outerConcave.bottomRight,
  platformLeft: SMART_TILESET_SLOTS.platform.left,
  platformMiddle: [...SMART_TILESET_SLOTS.platform.middle],
  platformRight: SMART_TILESET_SLOTS.platform.right,
};

function getFamilyRule(_theme: SmartTerrainTheme, _material: SmartTerrainMaterial): FamilyRule {
  return COMMON_RULE;
}

function getFirstGid(theme: SmartTerrainTheme): number {
  return getTilesetByKey(theme)?.firstGid ?? 1;
}

function toGid(theme: SmartTerrainTheme, localIndex: number): number {
  return getFirstGid(theme) + localIndex;
}

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

function stablePick(values: number[], x: number, y: number, salt: number): number {
  const hash = Math.abs(Math.imul(x + 31, 73856093) ^ Math.imul(y + 17, 19349663) ^ salt);
  return values[hash % values.length] ?? values[0] ?? 0;
}

function getFamilyLocalIndices(theme: SmartTerrainTheme, material: SmartTerrainMaterial): Set<number> {
  if (material === 'feature') return new Set([SMART_TILESET_SLOTS.feature.base]);
  const rule = getFamilyRule(theme, material);
  return new Set([
    rule.isolated,
    rule.topLeft,
    ...rule.top,
    rule.topRight,
    ...rule.left,
    ...rule.center,
    ...rule.right,
    rule.bottomLeft,
    ...rule.bottom,
    rule.bottomRight,
    rule.concaveTopLeft,
    rule.concaveTopRight,
    rule.concaveBottomLeft,
    rule.concaveBottomRight,
    ...(material === 'platform'
      ? [rule.platformLeft, ...rule.platformMiddle, rule.platformRight]
      : []),
  ].filter((value): value is number => typeof value === 'number'));
}

export function classifySmartTerrainGid(gid: number): Omit<SmartTerrainCellState, 'lockedGid'> | null {
  for (const theme of ['forest', 'desert', 'cave', 'gothic'] as const) {
    const firstGid = getFirstGid(theme);
    const localIndex = gid - firstGid;
    if (localIndex < 0 || localIndex >= 72) {
      continue;
    }
    // Specific sub-families win when the source sheet intentionally reuses a cap
    // (notably local tile 47) for a one-cell ground island and a platform end.
    for (const material of ['feature', 'platform', 'ground'] as const) {
      if (getFamilyLocalIndices(theme, material).has(localIndex)) {
        return { theme, material };
      }
    }
  }
  return null;
}

function sameFamily(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  x: number,
  y: number,
  source: SmartTerrainCellState,
): boolean {
  if (!inBounds(x, y)) {
    return false;
  }
  const semantic = state.cells[smartCellKey(x, y)];
  if (semantic) {
    return semantic.theme === source.theme && semantic.material === source.material;
  }
  const gid = decodeTileDataValue(tileData.terrain[y]?.[x] ?? -1).gid;
  const classified = classifySmartTerrainGid(gid);
  return classified?.theme === source.theme && classified.material === source.material;
}

function findEnclosedVoidCells(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  source: SmartTerrainCellState,
): Set<string> {
  const exterior = new Set<string>();
  const queue: SmartCellCoordinate[] = [];
  const enqueue = (x: number, y: number) => {
    const key = smartCellKey(x, y);
    if (!inBounds(x, y) || exterior.has(key) || sameFamily(tileData, state, x, y, source)) return;
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
      if (!exterior.has(key) && !sameFamily(tileData, state, x, y, source)) enclosed.add(key);
    }
  }
  return enclosed;
}

function resolveGroundLocalIndex(
  rule: FamilyRule,
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  x: number,
  y: number,
  cell: SmartTerrainCellState,
  enclosedVoidCells: Set<string>,
): ResolvedLocalTile {
  const n = sameFamily(tileData, state, x, y - 1, cell);
  const e = sameFamily(tileData, state, x + 1, y, cell);
  const s = sameFamily(tileData, state, x, y + 1, cell);
  const w = sameFamily(tileData, state, x - 1, y, cell);
  if (!n && !e && !s && !w) return { localIndex: rule.isolated };
  if (!e && !w && (n || s)) return { localIndex: SMART_TILESET_SLOTS.ground.left[0] };
  const enclosedVoid = (targetX: number, targetY: number): boolean => (
    enclosedVoidCells.has(smartCellKey(targetX, targetY))
  );
  const inner = SMART_TILESET_SLOTS.ground.innerVoid;
  if (!n && enclosedVoid(x, y - 1)) {
    if (!w) return { localIndex: inner.bottomLeft, flipY: true };
    if (!e) return { localIndex: inner.bottomRight, flipY: true };
    return { localIndex: stablePick([...inner.top], x, y, 7) };
  }
  if (!s && enclosedVoid(x, y + 1)) {
    if (!w) return { localIndex: inner.bottomLeft };
    if (!e) return { localIndex: inner.bottomRight };
    return { localIndex: stablePick([...inner.bottom], x, y, 9) };
  }
  if (!w && enclosedVoid(x - 1, y)) return { localIndex: inner.left };
  if (!e && enclosedVoid(x + 1, y)) return { localIndex: inner.right };
  if (!n && !w) return { localIndex: rule.topLeft };
  if (!n && !e) return { localIndex: rule.topRight };
  if (!s && !w) return { localIndex: rule.bottomLeft };
  if (!s && !e) return { localIndex: rule.bottomRight };
  if (!n) return { localIndex: stablePick(rule.top, x, y, 11) };
  if (!s) return { localIndex: stablePick(rule.bottom, x, y, 13) };
  if (!w) return { localIndex: stablePick(rule.left, x, y, 17) };
  if (!e) return { localIndex: stablePick(rule.right, x, y, 19) };

  const nw = sameFamily(tileData, state, x - 1, y - 1, cell);
  const ne = sameFamily(tileData, state, x + 1, y - 1, cell);
  const sw = sameFamily(tileData, state, x - 1, y + 1, cell);
  const se = sameFamily(tileData, state, x + 1, y + 1, cell);
  if (!nw && enclosedVoid(x - 1, y - 1)) return { localIndex: inner.topRight };
  if (!ne && enclosedVoid(x + 1, y - 1)) return { localIndex: inner.topLeft };
  if (!sw && enclosedVoid(x - 1, y + 1)) return { localIndex: inner.topRight, flipY: true };
  if (!se && enclosedVoid(x + 1, y + 1)) return { localIndex: inner.topLeft, flipY: true };
  if (!nw && rule.concaveTopLeft !== undefined) return { localIndex: rule.concaveTopLeft };
  if (!ne && rule.concaveTopRight !== undefined) return { localIndex: rule.concaveTopRight };
  if (!sw && rule.concaveBottomLeft !== undefined) return { localIndex: rule.concaveBottomLeft };
  if (!se && rule.concaveBottomRight !== undefined) return { localIndex: rule.concaveBottomRight };
  return { localIndex: stablePick(rule.center, x, y, 23) };
}

function resolveLocalIndex(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  x: number,
  y: number,
  cell: SmartTerrainCellState,
  enclosedVoidCells: Set<string>,
): ResolvedLocalTile {
  const rule = getFamilyRule(cell.theme, cell.material);
  if (cell.material === 'feature') return { localIndex: SMART_TILESET_SLOTS.feature.base };
  if (cell.material === 'platform') {
    const left = sameFamily(tileData, state, x - 1, y, cell);
    const right = sameFamily(tileData, state, x + 1, y, cell);
    if (!left && !right) return { localIndex: SMART_TILESET_SLOTS.platform.isolated };
    if (!left) return { localIndex: rule.platformLeft };
    if (!right) return { localIndex: rule.platformRight };
    return { localIndex: stablePick(rule.platformMiddle, x, y, 29) };
  }
  return resolveGroundLocalIndex(rule, tileData, state, x, y, cell, enclosedVoidCells);
}

function clearOwnedDecorations(tileData: RoomTileData, state: RoomSmartTerrainState): void {
  const clearLayer = (
    layer: 'foreground' | 'background',
    generated: Record<string, import('./model').SmartGeneratedDecorationState>,
  ) => {
    for (const [targetKey, decoration] of Object.entries(generated)) {
      const [x, y] = targetKey.split(',').map(Number);
      if (!inBounds(x, y)) {
        delete generated[targetKey];
        continue;
      }
      if (decodeTileDataValue(tileData[layer][y]?.[x] ?? -1).gid === decoration.gid) {
        tileData[layer][y][x] = -1;
      }
      delete generated[targetKey];
    }
  };
  clearLayer('foreground', state.generatedDecorations);
  clearLayer('background', state.generatedBackgroundDecorations);
}

function resolveDocument(tileData: RoomTileData, state: RoomSmartTerrainState): void {
  clearOwnedDecorations(tileData, state);

  const enclosedVoidCache = new Map<string, Set<string>>();

  for (const [key, cell] of Object.entries(state.cells)) {
    const [x, y] = key.split(',').map(Number);
    if (!inBounds(x, y)) {
      delete state.cells[key];
      continue;
    }
    const familyKey = `${cell.theme}:${cell.material}`;
    let enclosedVoidCells = enclosedVoidCache.get(familyKey);
    if (!enclosedVoidCells) {
      enclosedVoidCells = cell.material === 'ground'
        ? findEnclosedVoidCells(tileData, state, cell)
        : new Set<string>();
      enclosedVoidCache.set(familyKey, enclosedVoidCells);
    }
    const resolved = resolveLocalIndex(tileData, state, x, y, cell, enclosedVoidCells);
    tileData.terrain[y][x] = cell.lockedGid
      ?? encodeTileDataValue(toGid(cell.theme, resolved.localIndex), resolved.flipX, resolved.flipY);
  }

  if (!state.detailsEnabled) {
    return;
  }

  const suppressed = new Set(state.suppressedDecorationSlots);
  const addDecoration = (
    ownerKey: string,
    targetX: number,
    targetY: number,
    slot: import('./model').SmartGeneratedDecorationState['slot'],
    localIndex: number,
    flipX = false,
    layer: 'foreground' | 'background' = 'foreground',
  ) => {
    if (!inBounds(targetX, targetY)) return;
    const slotKey = smartDecorationSlotKey(ownerKey, slot);
    if (suppressed.has(slotKey) || decodeTileDataValue(tileData[layer][targetY]?.[targetX] ?? -1).gid > 0) return;
    const gid = toGid(state.cells[ownerKey]!.theme, localIndex);
    tileData[layer][targetY][targetX] = encodeTileDataValue(gid, flipX, false);
    const generated = layer === 'foreground'
      ? state.generatedDecorations
      : state.generatedBackgroundDecorations;
    generated[smartCellKey(targetX, targetY)] = { ownerKey, slot, gid };
  };
  const featureCandidates = new Map<string, SmartTerrainCellState>();
  for (const [ownerKey, cell] of Object.entries(state.cells)) {
    const [x, y] = ownerKey.split(',').map(Number);
    if (!inBounds(x, y)) continue;
    if (cell.material === 'feature') {
      for (const [targetX, targetY] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]]) {
        if (inBounds(targetX, targetY) && !sameFamily(tileData, state, targetX, targetY, cell)) {
          featureCandidates.set(smartCellKey(targetX, targetY), cell);
        }
      }
      continue;
    }
    if (cell.material !== 'ground' || sameFamily(tileData, state, x, y - 1, cell)) continue;
    const decorationHash = Math.abs(Math.imul(x + 31, 73856093) ^ Math.imul(y + 17, 19349663));
    if (decorationHash % 8 !== 0) continue;
    addDecoration(
      ownerKey,
      x,
      y - 1,
      'top',
      SMART_TILESET_SLOTS.groundDecoration[
        Math.floor(decorationHash / 8) % SMART_TILESET_SLOTS.groundDecoration.length
      ]!,
    );
  }

  const border = SMART_TILESET_SLOTS.feature.border;
  for (const [targetKey, cell] of featureCandidates) {
    const [x, y] = targetKey.split(',').map(Number);
    const above = sameFamily(tileData, state, x, y - 1, cell);
    const right = sameFamily(tileData, state, x + 1, y, cell);
    const below = sameFamily(tileData, state, x, y + 1, cell);
    const left = sameFamily(tileData, state, x - 1, y, cell);
    const cardinalCount = Number(above) + Number(right) + Number(below) + Number(left);
    const adjacentOwners = [
      above && smartCellKey(x, y - 1),
      right && smartCellKey(x + 1, y),
      below && smartCellKey(x, y + 1),
      left && smartCellKey(x - 1, y),
    ].filter((key): key is string => typeof key === 'string' && state.cells[key]?.material === 'feature').sort();
    const ownerKey = adjacentOwners[0];
    if (!ownerKey) continue;
    if (cardinalCount === 1) {
      if (below) addDecoration(ownerKey, x, y, 'top', border.top);
      else if (above) addDecoration(ownerKey, x, y, 'bottom', border.bottom);
      else if (right) addDecoration(ownerKey, x, y, 'left', border.left);
      else if (left) addDecoration(ownerKey, x, y, 'right', border.right);
    } else if (cardinalCount === 2) {
      if (below && right) addDecoration(ownerKey, x, y, 'topLeft', border.topLeft);
      else if (below && left) addDecoration(ownerKey, x, y, 'topRight', border.topLeft, true);
      else if (above && right) addDecoration(ownerKey, x, y, 'bottomLeft', border.bottomRight, true);
      else if (above && left) addDecoration(ownerKey, x, y, 'bottomRight', border.bottomRight);
    } else if (cardinalCount === 3) {
      if (!right) {
        addDecoration(ownerKey, x, y, 'topRight', border.topLeft, true);
        addDecoration(ownerKey, x, y, 'bottom', border.bottom, false, 'background');
      } else if (!left) {
        addDecoration(ownerKey, x, y, 'topLeft', border.topLeft);
        addDecoration(ownerKey, x, y, 'bottom', border.bottom, false, 'background');
      } else if (!below) {
        addDecoration(ownerKey, x, y, 'bottomRight', border.bottomRight);
        addDecoration(ownerKey, x, y, 'left', border.left, false, 'background');
      } else if (!above) {
        addDecoration(ownerKey, x, y, 'topRight', border.topLeft, true);
        addDecoration(ownerKey, x, y, 'left', border.left, false, 'background');
      }
    }
  }
}

export function applySmartCells(
  document: SmartTerrainDocument,
  options: ApplySmartCellsOptions,
): SmartTerrainDocument {
  const tileData = cloneTileData(document.tileData);
  const smartTerrain = cloneRoomSmartTerrainState(document.smartTerrain);
  for (const { x, y } of options.cells) {
    if (!inBounds(x, y)) {
      continue;
    }
    const key = smartCellKey(x, y);
    if (options.mode === 'erase') {
      delete smartTerrain.cells[key];
      smartTerrain.suppressedDecorationSlots = smartTerrain.suppressedDecorationSlots.filter(
        (slot) => !slot.startsWith(`${key}:`),
      );
      tileData.terrain[y][x] = -1;
    } else {
      smartTerrain.cells[key] = { theme: options.theme, material: options.material };
      smartTerrain.suppressedDecorationSlots = smartTerrain.suppressedDecorationSlots.filter(
        (slot) => !slot.startsWith(`${key}:`),
      );
    }
  }
  resolveDocument(tileData, smartTerrain);
  return { tileData, smartTerrain };
}

export function lockSmartTerrainCell(
  document: SmartTerrainDocument,
  x: number,
  y: number,
  gid: number,
): SmartTerrainDocument {
  const tileData = cloneTileData(document.tileData);
  const smartTerrain = cloneRoomSmartTerrainState(document.smartTerrain);
  const key = smartCellKey(x, y);
  const cell = smartTerrain.cells[key];
  tileData.terrain[y][x] = gid;
  if (cell) {
    smartTerrain.cells[key] = { ...cell, lockedGid: gid };
  }
  resolveDocument(tileData, smartTerrain);
  return { tileData, smartTerrain };
}

export function setSmartTerrainDetailsEnabled(
  document: SmartTerrainDocument,
  enabled: boolean,
): SmartTerrainDocument {
  const tileData = cloneTileData(document.tileData);
  const smartTerrain = cloneRoomSmartTerrainState(document.smartTerrain);
  smartTerrain.detailsEnabled = enabled;
  resolveDocument(tileData, smartTerrain);
  return { tileData, smartTerrain };
}

export function fillEmptySmartTerrain(
  document: SmartTerrainDocument,
  theme: SmartTerrainTheme,
  material: SmartTerrainMaterial = 'ground',
): SmartTerrainDocument {
  const cells: SmartCellCoordinate[] = [];
  for (let y = 0; y < ROOM_HEIGHT; y += 1) {
    for (let x = 0; x < ROOM_WIDTH; x += 1) {
      if (decodeTileDataValue(document.tileData.terrain[y]?.[x] ?? -1).gid <= 0) {
        cells.push({ x, y });
      }
    }
  }
  return applySmartCells(document, { cells, mode: 'paint', theme, material });
}

export function suppressGeneratedDecorationAt(
  document: SmartTerrainDocument,
  x: number,
  y: number,
  requestedLayer?: 'foreground' | 'background',
): SmartTerrainDocument {
  const tileData = cloneTileData(document.tileData);
  const smartTerrain = cloneRoomSmartTerrainState(document.smartTerrain);
  const targetKey = smartCellKey(x, y);
  const layer = requestedLayer
    ?? (smartTerrain.generatedDecorations[targetKey] ? 'foreground' : 'background');
  const generatedMap = layer === 'foreground'
    ? smartTerrain.generatedDecorations
    : smartTerrain.generatedBackgroundDecorations;
  const generated = generatedMap[targetKey];
  if (!generated) {
    return { tileData, smartTerrain };
  }
  tileData[layer][y][x] = -1;
  smartTerrain.suppressedDecorationSlots = Array.from(new Set([
    ...smartTerrain.suppressedDecorationSlots,
    smartDecorationSlotKey(generated.ownerKey, generated.slot),
  ]));
  delete generatedMap[targetKey];
  return { tileData, smartTerrain };
}
