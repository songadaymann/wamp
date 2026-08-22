import { ROOM_HEIGHT, ROOM_WIDTH } from '../config/room';
import { decodeTileDataValue } from '../config/editorState';
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
  detailTop: number[];
}

const COMMON_RULE: FamilyRule = {
  isolated: 47,
  topLeft: 14,
  top: [15, 16],
  topRight: 17,
  left: [25, 37],
  center: [27, 28, 39, 40],
  right: [30, 42],
  bottomLeft: 49,
  bottom: [50, 51, 52, 53],
  bottomRight: 54,
  concaveTopLeft: 26,
  concaveTopRight: 29,
  concaveBottomLeft: 38,
  concaveBottomRight: 41,
  platformLeft: 44,
  platformMiddle: [45, 46],
  platformRight: 47,
  detailTop: [2, 3, 4, 5, 6, 7, 8, 10],
};

const GOTHIC_RULE: FamilyRule = {
  ...COMMON_RULE,
  platformLeft: 68,
  platformMiddle: [69, 70],
  platformRight: 71,
  detailTop: [1, 2, 3, 4, 5, 6, 7, 8],
};

const FEATURE_COMMON_RULE: FamilyRule = {
  ...COMMON_RULE,
  isolated: 35,
  topLeft: 19,
  top: [20, 21],
  topRight: 23,
  left: [31],
  center: [32, 33],
  right: [35],
  bottomLeft: 43,
  bottom: [55],
  bottomRight: 55,
  concaveTopLeft: 31,
  concaveTopRight: 35,
  concaveBottomLeft: 43,
  concaveBottomRight: 55,
};

function getFamilyRule(theme: SmartTerrainTheme, material: SmartTerrainMaterial): FamilyRule {
  if (material === 'feature') {
    return theme === 'gothic'
      ? { ...FEATURE_COMMON_RULE, detailTop: GOTHIC_RULE.detailTop }
      : FEATURE_COMMON_RULE;
  }
  return theme === 'gothic' ? GOTHIC_RULE : COMMON_RULE;
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

function resolveGroundLocalIndex(
  rule: FamilyRule,
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  x: number,
  y: number,
  cell: SmartTerrainCellState,
): number {
  const n = sameFamily(tileData, state, x, y - 1, cell);
  const e = sameFamily(tileData, state, x + 1, y, cell);
  const s = sameFamily(tileData, state, x, y + 1, cell);
  const w = sameFamily(tileData, state, x - 1, y, cell);
  if (!n && !e && !s && !w) return rule.isolated;
  if (!n && !w) return rule.topLeft;
  if (!n && !e) return rule.topRight;
  if (!s && !w) return rule.bottomLeft;
  if (!s && !e) return rule.bottomRight;
  if (!n) return stablePick(rule.top, x, y, 11);
  if (!s) return stablePick(rule.bottom, x, y, 13);
  if (!w) return stablePick(rule.left, x, y, 17);
  if (!e) return stablePick(rule.right, x, y, 19);

  const nw = sameFamily(tileData, state, x - 1, y - 1, cell);
  const ne = sameFamily(tileData, state, x + 1, y - 1, cell);
  const sw = sameFamily(tileData, state, x - 1, y + 1, cell);
  const se = sameFamily(tileData, state, x + 1, y + 1, cell);
  if (!nw && rule.concaveTopLeft !== undefined) return rule.concaveTopLeft;
  if (!ne && rule.concaveTopRight !== undefined) return rule.concaveTopRight;
  if (!sw && rule.concaveBottomLeft !== undefined) return rule.concaveBottomLeft;
  if (!se && rule.concaveBottomRight !== undefined) return rule.concaveBottomRight;
  return stablePick(rule.center, x, y, 23);
}

function resolveLocalIndex(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  x: number,
  y: number,
  cell: SmartTerrainCellState,
): number {
  const rule = getFamilyRule(cell.theme, cell.material);
  if (cell.material === 'platform') {
    const left = sameFamily(tileData, state, x - 1, y, cell);
    const right = sameFamily(tileData, state, x + 1, y, cell);
    if (!left && !right) return rule.platformRight;
    if (!left) return rule.platformLeft;
    if (!right) return rule.platformRight;
    return stablePick(rule.platformMiddle, x, y, 29);
  }
  return resolveGroundLocalIndex(rule, tileData, state, x, y, cell);
}

function clearOwnedDecorations(tileData: RoomTileData, state: RoomSmartTerrainState): void {
  for (const [targetKey, decoration] of Object.entries(state.generatedDecorations)) {
    const [x, y] = targetKey.split(',').map(Number);
    if (!inBounds(x, y)) {
      delete state.generatedDecorations[targetKey];
      continue;
    }
    if (decodeTileDataValue(tileData.foreground[y]?.[x] ?? -1).gid === decoration.gid) {
      tileData.foreground[y][x] = -1;
    }
    delete state.generatedDecorations[targetKey];
  }
}

function resolveDocument(tileData: RoomTileData, state: RoomSmartTerrainState): void {
  clearOwnedDecorations(tileData, state);

  for (const [key, cell] of Object.entries(state.cells)) {
    const [x, y] = key.split(',').map(Number);
    if (!inBounds(x, y)) {
      delete state.cells[key];
      continue;
    }
    tileData.terrain[y][x] = cell.lockedGid
      ?? toGid(cell.theme, resolveLocalIndex(tileData, state, x, y, cell));
  }

  if (!state.detailsEnabled) {
    return;
  }

  const suppressed = new Set(state.suppressedDecorationSlots);
  for (const [ownerKey, cell] of Object.entries(state.cells)) {
    const [x, y] = ownerKey.split(',').map(Number);
    if (!inBounds(x, y) || sameFamily(tileData, state, x, y - 1, cell)) {
      continue;
    }
    const targetY = y - 1;
    if (!inBounds(x, targetY)) {
      continue;
    }
    const slotKey = smartDecorationSlotKey(ownerKey, 'top');
    if (suppressed.has(slotKey) || decodeTileDataValue(tileData.foreground[targetY]?.[x] ?? -1).gid > 0) {
      continue;
    }
    const rule = getFamilyRule(cell.theme, cell.material);
    const gid = toGid(cell.theme, stablePick(rule.detailTop, x, y, 31));
    tileData.foreground[targetY][x] = gid;
    state.generatedDecorations[smartCellKey(x, targetY)] = { ownerKey, slot: 'top', gid };
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
): SmartTerrainDocument {
  const tileData = cloneTileData(document.tileData);
  const smartTerrain = cloneRoomSmartTerrainState(document.smartTerrain);
  const targetKey = smartCellKey(x, y);
  const generated = smartTerrain.generatedDecorations[targetKey];
  if (!generated) {
    return { tileData, smartTerrain };
  }
  tileData.foreground[y][x] = -1;
  smartTerrain.suppressedDecorationSlots = Array.from(new Set([
    ...smartTerrain.suppressedDecorationSlots,
    smartDecorationSlotKey(generated.ownerKey, generated.slot),
  ]));
  delete smartTerrain.generatedDecorations[targetKey];
  return { tileData, smartTerrain };
}
