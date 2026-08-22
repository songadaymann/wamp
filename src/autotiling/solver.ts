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
    left: [25, 37],
    center: [27, 28, 39, 40],
    right: [30, 42],
    bottomLeft: 49,
    bottom: [50, 51, 52, 53],
    bottomRight: 54,
    outerConcave: { topLeft: 26, topRight: 29, bottomLeft: 38, bottomRight: 41 },
    // The compact family at the sheet's upper-right makes an inside outline
    // around a void that is enclosed by underground terrain.
    innerVoid: {
      topLeft: 19,
      top: [20, 21],
      topRight: 23,
      left: 31,
      right: 35,
      bottomLeft: 43,
      bottom: [44, 45, 46],
      bottomRight: 47,
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
  groundDecoration: [3, 18],
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
  const enclosedVoid = (targetX: number, targetY: number): boolean => {
    if (!inBounds(targetX, targetY) || sameFamily(tileData, state, targetX, targetY, cell)) return false;
    let surrounding = 0;
    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        if ((ox !== 0 || oy !== 0) && sameFamily(tileData, state, targetX + ox, targetY + oy, cell)) surrounding += 1;
      }
    }
    return surrounding >= 5;
  };
  const inner = SMART_TILESET_SLOTS.ground.innerVoid;
  if (!n && enclosedVoid(x, y - 1)) {
    if (!w) return inner.topLeft;
    if (!e) return inner.topRight;
    return stablePick([...inner.top], x, y, 7);
  }
  if (!s && enclosedVoid(x, y + 1)) {
    if (!w) return inner.bottomLeft;
    if (!e) return inner.bottomRight;
    return stablePick([...inner.bottom], x, y, 9);
  }
  if (!w && enclosedVoid(x - 1, y)) return inner.left;
  if (!e && enclosedVoid(x + 1, y)) return inner.right;
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
  if (!nw && enclosedVoid(x - 1, y - 1)) return inner.topLeft;
  if (!ne && enclosedVoid(x + 1, y - 1)) return inner.topRight;
  if (!sw && enclosedVoid(x - 1, y + 1)) return inner.bottomLeft;
  if (!se && enclosedVoid(x + 1, y + 1)) return inner.bottomRight;
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
  if (cell.material === 'feature') return SMART_TILESET_SLOTS.feature.base;
  if (cell.material === 'platform') {
    const left = sameFamily(tileData, state, x - 1, y, cell);
    const right = sameFamily(tileData, state, x + 1, y, cell);
    if (!left && !right) return SMART_TILESET_SLOTS.platform.isolated;
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
  const addDecoration = (
    ownerKey: string,
    targetX: number,
    targetY: number,
    slot: import('./model').SmartGeneratedDecorationState['slot'],
    localIndex: number,
    flipX = false,
  ) => {
    if (!inBounds(targetX, targetY)) return;
    const slotKey = smartDecorationSlotKey(ownerKey, slot);
    if (suppressed.has(slotKey) || decodeTileDataValue(tileData.foreground[targetY]?.[targetX] ?? -1).gid > 0) return;
    const gid = toGid(state.cells[ownerKey]!.theme, localIndex);
    tileData.foreground[targetY][targetX] = encodeTileDataValue(gid, flipX, false);
    state.generatedDecorations[smartCellKey(targetX, targetY)] = { ownerKey, slot, gid };
  };
  for (const [ownerKey, cell] of Object.entries(state.cells)) {
    const [x, y] = ownerKey.split(',').map(Number);
    if (!inBounds(x, y)) continue;
    if (cell.material === 'feature') {
      const border = SMART_TILESET_SLOTS.feature.border;
      const n = sameFamily(tileData, state, x, y - 1, cell);
      const e = sameFamily(tileData, state, x + 1, y, cell);
      const s = sameFamily(tileData, state, x, y + 1, cell);
      const w = sameFamily(tileData, state, x - 1, y, cell);
      if (!n) addDecoration(ownerKey, x, y - 1, 'top', border.top);
      if (!s) addDecoration(ownerKey, x, y + 1, 'bottom', border.bottom);
      if (!w) addDecoration(ownerKey, x - 1, y, 'left', border.left);
      if (!e) addDecoration(ownerKey, x + 1, y, 'right', border.right);
      if (!n && !w) addDecoration(ownerKey, x - 1, y - 1, 'topLeft', border.topLeft);
      if (!n && !e) addDecoration(ownerKey, x + 1, y - 1, 'topRight', border.topLeft, true);
      if (!s && !w) addDecoration(ownerKey, x - 1, y + 1, 'bottomLeft', border.bottomRight, true);
      if (!s && !e) addDecoration(ownerKey, x + 1, y + 1, 'bottomRight', border.bottomRight);
      continue;
    }
    if (cell.material !== 'ground' || sameFamily(tileData, state, x, y - 1, cell)) continue;
    const eligibility = Math.abs(Math.imul(x + 31, 73856093) ^ Math.imul(y + 17, 19349663)) % 8;
    if (eligibility !== 0) continue;
    addDecoration(
      ownerKey,
      x,
      y - 1,
      'top',
      stablePick([...SMART_TILESET_SLOTS.groundDecoration], x, y, 31),
    );
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
