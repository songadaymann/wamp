import { ROOM_HEIGHT, ROOM_WIDTH, type LayerName } from '../config/room';
import { decodeTileDataValue, encodeTileDataValue } from '../config/editorState';
import {
  AUTOTILE_EDGE_CASES_DESERT_TILESET_FIRST_GID,
  AUTOTILE_EDGE_CASES_DESERT_LOCAL_INDICES,
  getTilesetByKey,
} from '../config/tilesets';
import type { RoomTileData } from '../persistence/roomModel';
import {
  cloneRoomSmartTerrainState,
  getLegacySmartBrushIdentity,
  getSmartLegacyBrushId,
  smartCellKey,
  smartDecorationSlotKey,
  smartOwnedOutputPartKey,
  smartOwnedOutputKey,
  smartSemanticCellKey,
  type RoomSmartTerrainState,
  type SmartTerrainCellState,
  type SmartTerrainMaterial,
  type SmartTerrainTheme,
} from './model';
import { resolveSmartRecipeDocument } from './recipeSolver';

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
  /** Advanced-mode source layer. Omitted callers retain the brush default. */
  layer?: LayerName;
}

export interface ApplySmartOutlineCellsOptions {
  filledCells: Iterable<SmartCellCoordinate>;
  outlineCells: Iterable<SmartCellCoordinate>;
  theme: SmartTerrainTheme;
  material: SmartTerrainMaterial;
  /** Advanced-mode source layer. Omitted callers retain the brush default. */
  layer?: LayerName;
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
    // Gothic tunnel floors use the cleaner masonry underside selected from
    // row 5, column 3, flipped vertically to face the carved air above.
    gothicTunnelFloor: 50,
    // Artist-authored family for regions that never become two tiles thick.
    // Coordinates on every 12-column source sheet: B8/B9, C8, D8-D11, E8.
    thin: {
      verticalTop: 19,
      isolated: 20,
      verticalMiddle: [31, 43],
      horizontalLeft: 44,
      horizontalMiddle: [20, 44, 45, 46],
      horizontalRight: 46,
      verticalBottom: 55,
    },
    topLeftAlternates: [14, 25],
    topRightAlternates: [17, 30],
    // 40 is the primary fill (75%), 32 is rare (5%), and the remainder scatter evenly.
    centerScatter: [27, 28, 38, 39, 41],
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
  // Artist-approved sparse details by 12-column sheet coordinate. Each nested
  // array is one atomic variant; Desert A8+A9 must be placed left-to-right.
  // Forest: A3/A4/A5/A6/E9/E11/E12 = 2/3/4/5/56/58/59.
  // Desert: A3/A4/A5/A6 and paired A8+A9 = 2/3/4/5 and 7+8.
  // Cave: A4/A5/A6/A7/E10/F2 = 3/4/5/6/57/61 (A3/local 2 excluded).
  // Gothic remains A3/A4/A5/A6 = 2/3/4/5.
  groundDecoration: {
    forest: [[2], [3], [4], [5], [56], [58], [59]],
    desert: [[2], [3], [4], [5], [7, 8]],
    cave: [[3], [4], [5], [6], [57], [61]],
    gothic: [[2], [3], [4], [5]],
  },
} as const;

const GROUND_TOP_LOCAL_INDICES = new Set<number>([
  ...SMART_TILESET_SLOTS.ground.topLeftAlternates,
  ...SMART_TILESET_SLOTS.ground.top,
  ...SMART_TILESET_SLOTS.ground.topRightAlternates,
]);

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

function stableHash(x: number, y: number, salt: number): number {
  let hash = Math.imul(x + 0x9e3779b9, 0x85ebca6b)
    ^ Math.imul(y + 0x7f4a7c15, 0xc2b2ae35)
    ^ Math.imul(salt + 0x165667b1, 0x27d4eb2f);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function stablePick(values: readonly number[], x: number, y: number, salt: number): number {
  const hash = stableHash(x, y, salt);
  return values[hash % values.length] ?? values[0] ?? 0;
}

function pickWeightedGroundCenter(x: number, y: number): number {
  const hash = stableHash(x, y, 23);
  const bucket = hash % 100;
  if (bucket < 75) return 40;
  if (bucket < 80) return 32;
  return SMART_TILESET_SLOTS.ground.centerScatter[
    Math.floor((bucket - 80) / 4)
  ] ?? SMART_TILESET_SLOTS.ground.centerScatter[0];
}

function pickHorizontalMiddle(x: number, y: number): number {
  const bucket = stableHash(x, y, 29) % 20;
  const [sparse, leftAlternate, primary, rightAlternate] =
    SMART_TILESET_SLOTS.ground.thin.horizontalMiddle;
  if (bucket < 12) return primary;
  if (bucket < 18) return rightAlternate;
  if (bucket < 19) return leftAlternate;
  return sparse;
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
    ...(material === 'ground'
      ? [
        ...SMART_TILESET_SLOTS.ground.topLeftAlternates,
        ...SMART_TILESET_SLOTS.ground.topRightAlternates,
        ...SMART_TILESET_SLOTS.ground.centerScatter,
        SMART_TILESET_SLOTS.ground.thin.verticalTop,
        SMART_TILESET_SLOTS.ground.thin.isolated,
        ...SMART_TILESET_SLOTS.ground.thin.verticalMiddle,
        SMART_TILESET_SLOTS.ground.thin.horizontalLeft,
        ...SMART_TILESET_SLOTS.ground.thin.horizontalMiddle,
        SMART_TILESET_SLOTS.ground.thin.horizontalRight,
        SMART_TILESET_SLOTS.ground.thin.verticalBottom,
      ]
      : []),
  ].filter((value): value is number => typeof value === 'number'));
}

export function classifySmartTerrainGid(gid: number): Omit<SmartTerrainCellState, 'lockedGid'> | null {
  for (const theme of ['forest', 'desert', 'cave', 'gothic', 'water'] as const) {
    const tileset = getTilesetByKey(theme);
    const firstGid = tileset?.firstGid ?? 1;
    const localIndex = gid - firstGid;
    if (localIndex < 0 || localIndex >= (tileset?.tileCount ?? 0)) {
      continue;
    }
    // Specific sub-families win when the source sheet intentionally reuses a cap
    // (notably local tile 47) for a one-cell ground island and a platform end.
    const materials: SmartTerrainMaterial[] = theme === 'water'
      ? ['tunnel']
      : ['feature', 'ground', 'platform'];
    for (const material of materials) {
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
  if (source.sourceLayer) {
    const semantic = state.semanticCells[smartSemanticCellKey(source.sourceLayer, x, y)];
    const identity = semantic ? getLegacySmartBrushIdentity(semantic.brushId) : null;
    if (identity) {
      return identity.theme === source.theme && identity.material === source.material;
    }
    const gid = decodeTileDataValue(tileData[source.sourceLayer][y]?.[x] ?? -1).gid;
    const classified = classifySmartTerrainGid(gid);
    return classified?.theme === source.theme && classified.material === source.material;
  }
  const backdrop = source.material === 'tunnel';
  const semantic = (backdrop ? state.backdropCells : state.cells)[smartCellKey(x, y)];
  if (semantic) {
    return semantic.theme === source.theme && semantic.material === source.material;
  }
  const layer = backdrop ? tileData.background : tileData.terrain;
  const gid = decodeTileDataValue(layer[y]?.[x] ?? -1).gid;
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

function participatesInThickRegion(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  x: number,
  y: number,
  cell: SmartTerrainCellState,
): boolean {
  for (const offsetY of [-1, 0]) {
    for (const offsetX of [-1, 0]) {
      if (
        sameFamily(tileData, state, x + offsetX, y + offsetY, cell)
        && sameFamily(tileData, state, x + offsetX + 1, y + offsetY, cell)
        && sameFamily(tileData, state, x + offsetX, y + offsetY + 1, cell)
        && sameFamily(tileData, state, x + offsetX + 1, y + offsetY + 1, cell)
      ) return true;
    }
  }
  return false;
}

function isThinCell(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  x: number,
  y: number,
  cell: SmartTerrainCellState,
): boolean {
  return sameFamily(tileData, state, x, y, cell)
    && !participatesInThickRegion(tileData, state, x, y, cell);
}

interface HorizontalThinLedgeSegment {
  y: number;
  left: number;
  right: number;
  attachedLeft: boolean;
  attachedRight: boolean;
}

function findDesertHorizontalThinLedges(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
): HorizontalThinLedgeSegment[] {
  const visited = new Set<string>();
  const segments: HorizontalThinLedgeSegment[] = [];
  for (const [key, cell] of Object.entries(state.cells)) {
    if (visited.has(key) || cell.theme !== 'desert' || cell.material !== 'ground') continue;
    const [x, y] = key.split(',').map(Number);
    if (!isThinCell(tileData, state, x, y, cell)) continue;

    let left = x;
    let right = x;
    while (isThinCell(tileData, state, left - 1, y, cell)) left -= 1;
    while (isThinCell(tileData, state, right + 1, y, cell)) right += 1;
    for (let segmentX = left; segmentX <= right; segmentX += 1) {
      visited.add(smartCellKey(segmentX, y));
    }

    const isPureHorizontal = Array.from(
      { length: right - left + 1 },
      (_, index) => left + index,
    ).every((segmentX) => {
      const segmentCell = state.cells[smartCellKey(segmentX, y)];
      return segmentCell
        && !segmentCell.lockedGid
        && !segmentCell.shapeGid
        && !isThinCell(tileData, state, segmentX, y - 1, cell)
        && !isThinCell(tileData, state, segmentX, y + 1, cell);
    });
    if (!isPureHorizontal) continue;

    const attachedLeft = sameFamily(tileData, state, left - 1, y, cell)
      && participatesInThickRegion(tileData, state, left - 1, y, cell);
    const attachedRight = sameFamily(tileData, state, right + 1, y, cell)
      && participatesInThickRegion(tileData, state, right + 1, y, cell);
    if (!attachedLeft && !attachedRight) continue;
    segments.push({ y, left, right, attachedLeft, attachedRight });
  }
  return segments;
}

function resolveThinGroundLocalIndex(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  x: number,
  y: number,
  cell: SmartTerrainCellState,
): ResolvedLocalTile {
  const thin = SMART_TILESET_SLOTS.ground.thin;
  const northThin = isThinCell(tileData, state, x, y - 1, cell);
  const southThin = isThinCell(tileData, state, x, y + 1, cell);
  const westThin = isThinCell(tileData, state, x - 1, y, cell);
  const eastThin = isThinCell(tileData, state, x + 1, y, cell);
  const westBoundaryJunction = westThin
    && (isThinCell(tileData, state, x - 1, y - 1, cell) || isThinCell(tileData, state, x - 1, y + 1, cell))
    && !isThinCell(tileData, state, x - 2, y, cell);
  const eastBoundaryJunction = eastThin
    && (isThinCell(tileData, state, x + 1, y - 1, cell) || isThinCell(tileData, state, x + 1, y + 1, cell))
    && !isThinCell(tileData, state, x + 2, y, cell);
  const boundedByTwoVerticalEnds = westBoundaryJunction && eastBoundaryJunction;
  const westHorizontal = westThin && (!westBoundaryJunction || boundedByTwoVerticalEnds);
  const eastHorizontal = eastThin && (!eastBoundaryJunction || boundedByTwoVerticalEnds);

  // A vertical spine wins at side junctions (the artist's H example).
  if (northThin && southThin) {
    return { localIndex: stablePick(thin.verticalMiddle, x, y, 37) };
  }

  // Downward stems and top corners use the all-direction B8 junction tile.
  if (southThin) return { localIndex: thin.verticalTop };

  if (northThin) {
    // At the foot of an I, the uninterrupted horizontal bar remains horizontal.
    if (westHorizontal && eastHorizontal) return { localIndex: pickHorizontalMiddle(x, y) };
    // When a thin stem enters a thick region below, retain a through-running middle.
    if (sameFamily(tileData, state, x, y + 1, cell)) {
      return { localIndex: stablePick(thin.verticalMiddle, x, y, 41) };
    }
    return { localIndex: thin.verticalBottom };
  }

  if (westHorizontal || eastHorizontal) {
    if (!westHorizontal) return { localIndex: thin.horizontalLeft };
    if (!eastHorizontal) return { localIndex: thin.horizontalRight };
    return { localIndex: pickHorizontalMiddle(x, y) };
  }

  // A one-cell stem can abut a thick body without becoming part of its 2D fill.
  if (sameFamily(tileData, state, x, y + 1, cell)) return { localIndex: thin.verticalTop };
  if (sameFamily(tileData, state, x, y - 1, cell)) return { localIndex: thin.verticalBottom };
  return { localIndex: thin.isolated };
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
  if (!participatesInThickRegion(tileData, state, x, y, cell)) {
    return resolveThinGroundLocalIndex(tileData, state, x, y, cell);
  }
  const enclosedVoid = (targetX: number, targetY: number): boolean => (
    enclosedVoidCells.has(smartCellKey(targetX, targetY))
  );
  const inner = SMART_TILESET_SLOTS.ground.innerVoid;
  if (!n && enclosedVoid(x, y - 1)) {
    if (!w) return { localIndex: inner.bottomLeft, flipY: true };
    if (!e) return { localIndex: inner.bottomRight, flipY: true };
    if (cell.theme === 'gothic') {
      return { localIndex: SMART_TILESET_SLOTS.ground.gothicTunnelFloor, flipY: true };
    }
    return { localIndex: stablePick([...inner.top], x, y, 7) };
  }
  if (!s && enclosedVoid(x, y + 1)) {
    if (!w) return { localIndex: inner.bottomLeft };
    if (!e) return { localIndex: inner.bottomRight };
    return { localIndex: stablePick([...inner.bottom], x, y, 9) };
  }
  if (!w && enclosedVoid(x - 1, y)) return { localIndex: inner.left };
  if (!e && enclosedVoid(x + 1, y)) return { localIndex: inner.right };
  if (!n && !w) return { localIndex: stablePick(SMART_TILESET_SLOTS.ground.topLeftAlternates, x, y, 43) };
  if (!n && !e) return { localIndex: stablePick(SMART_TILESET_SLOTS.ground.topRightAlternates, x, y, 47) };
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
  if (!sw) return { localIndex: inner.topRight, flipY: true };
  if (!se) return { localIndex: inner.topLeft, flipY: true };
  return { localIndex: pickWeightedGroundCenter(x, y) };
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
  if (cell.material === 'tunnel') {
    const n = sameFamily(tileData, state, x, y - 1, cell);
    const e = sameFamily(tileData, state, x + 1, y, cell);
    const s = sameFamily(tileData, state, x, y + 1, cell);
    const w = sameFamily(tileData, state, x - 1, y, cell);
    const inner = SMART_TILESET_SLOTS.ground.innerVoid;
    if (!n && !e && !s && !w) return { localIndex: SMART_TILESET_SLOTS.ground.isolated };
    if (!e && !w && (n || s)) return { localIndex: inner.left };
    if (!n && !w) return { localIndex: inner.bottomLeft, flipY: true };
    if (!n && !e) return { localIndex: inner.bottomRight, flipY: true };
    if (!s && !w) return { localIndex: inner.bottomLeft };
    if (!s && !e) return { localIndex: inner.bottomRight };
    if (!n) return { localIndex: stablePick([...inner.bottom], x, y, 31), flipY: true };
    if (!s) return { localIndex: stablePick([...inner.bottom], x, y, 33) };
    if (!w) return { localIndex: inner.left };
    if (!e) return { localIndex: inner.right };
    const nw = sameFamily(tileData, state, x - 1, y - 1, cell);
    const ne = sameFamily(tileData, state, x + 1, y - 1, cell);
    const sw = sameFamily(tileData, state, x - 1, y + 1, cell);
    const se = sameFamily(tileData, state, x + 1, y + 1, cell);
    if (!nw) return { localIndex: inner.topRight };
    if (!ne) return { localIndex: inner.topLeft };
    if (!sw) return { localIndex: inner.topRight, flipY: true };
    if (!se) return { localIndex: inner.topLeft, flipY: true };
    return { localIndex: stablePick(rule.center, x, y, 35) };
  }
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
    generated: Record<string, import('./model').SmartGeneratedDecorationState>,
  ) => {
    for (const [targetKey, decoration] of Object.entries(generated)) {
      const [x, y] = targetKey.split(',').map(Number);
      if (!inBounds(x, y)) {
        delete generated[targetKey];
        continue;
      }
      const layer = decoration.layer;
      const currentValue = tileData[layer][y]?.[x] ?? -1;
      const expectedValue = decoration.value ?? decoration.gid;
      if (currentValue === expectedValue) {
        tileData[layer][y][x] = -1;
      }
      delete state.ownedOutputs[smartOwnedOutputKey(layer, x, y)];
      delete generated[targetKey];
    }
  };
  clearLayer(state.generatedDecorations);
  clearLayer(state.generatedBackgroundDecorations);
}

const LEGACY_SEMANTIC_OWNER_PREFIX = 'legacy-semantic:';

function clearNativeLegacyOutputs(tileData: RoomTileData, state: RoomSmartTerrainState): void {
  for (const [key, output] of Object.entries(state.ownedOutputs)) {
    if (!output.ownerId.startsWith(LEGACY_SEMANTIC_OWNER_PREFIX)) continue;
    const separator = key.indexOf(':');
    const layer = key.slice(0, separator) as LayerName;
    const [x, y] = key.slice(separator + 1).split(',').map(Number);
    if (inBounds(x, y)) {
      const currentValue = tileData[layer][y]?.[x] ?? -1;
      if (currentValue === output.value) tileData[layer][y][x] = -1;
    }
    delete state.ownedOutputs[key];
  }
}

function addNativeLegacyOutput(
  tileData: RoomTileData,
  state: RoomSmartTerrainState,
  semanticKey: string,
  partId: string,
  layer: LayerName,
  x: number,
  y: number,
  value: number,
  force = false,
): void {
  if (!inBounds(x, y)) return;
  const ownerId = `${LEGACY_SEMANTIC_OWNER_PREFIX}${semanticKey}`;
  if (state.suppressedOutputParts.includes(smartOwnedOutputPartKey(ownerId, partId))) return;
  if (!force && decodeTileDataValue(tileData[layer][y]?.[x] ?? -1).gid > 0) return;
  tileData[layer][y][x] = value;
  state.ownedOutputs[smartOwnedOutputKey(layer, x, y)] = {
    ownerId,
    partId,
    kind: 'semantic',
    layer,
    value,
  };
}

/** Resolves native v2 legacy-theme cells authored onto a non-default layer. */
function resolveNativeLegacySemanticCells(tileData: RoomTileData, state: RoomSmartTerrainState): void {
  const entries: Array<{
    semanticKey: string;
    layer: LayerName;
    x: number;
    y: number;
    cell: SmartTerrainCellState;
    lockedValue?: number;
    shapeValue?: number;
  }> = [];
  for (const [semanticKey, semantic] of Object.entries(state.semanticCells)) {
    if (semantic.legacySource) continue;
    const identity = getLegacySmartBrushIdentity(semantic.brushId);
    if (!identity) continue;
    const separator = semanticKey.indexOf(':');
    const layer = semanticKey.slice(0, separator) as LayerName;
    const [x, y] = semanticKey.slice(separator + 1).split(',').map(Number);
    if (!inBounds(x, y)) continue;
    entries.push({
      semanticKey,
      layer,
      x,
      y,
      cell: { ...identity, sourceLayer: layer },
      lockedValue: semantic.lockedValue,
      shapeValue: semantic.shapeValue,
    });
  }

  const enclosedVoidCache = new Map<string, Set<string>>();
  for (const entry of entries) {
    const familyKey = `${entry.layer}:${entry.cell.theme}:${entry.cell.material}`;
    let enclosedVoidCells = enclosedVoidCache.get(familyKey);
    if (!enclosedVoidCells) {
      enclosedVoidCells = entry.cell.material === 'ground'
        ? findEnclosedVoidCells(tileData, state, entry.cell)
        : new Set<string>();
      enclosedVoidCache.set(familyKey, enclosedVoidCells);
    }
    const resolved = resolveLocalIndex(
      tileData,
      state,
      entry.x,
      entry.y,
      entry.cell,
      enclosedVoidCells,
    );
    const value = entry.lockedValue ?? entry.shapeValue ?? encodeTileDataValue(
      toGid(entry.cell.theme, resolved.localIndex),
      resolved.flipX,
      resolved.flipY,
    );
    addNativeLegacyOutput(
      tileData,
      state,
      entry.semanticKey,
      'primary',
      entry.layer,
      entry.x,
      entry.y,
      value,
      true,
    );
  }
}

interface NativeLegacyEntry {
  semanticKey: string;
  layer: LayerName;
  x: number;
  y: number;
  cell: SmartTerrainCellState;
}

function getNativeLegacyEntries(state: RoomSmartTerrainState): NativeLegacyEntry[] {
  const entries: NativeLegacyEntry[] = [];
  for (const [semanticKey, semantic] of Object.entries(state.semanticCells)) {
    if (semantic.legacySource) continue;
    const identity = getLegacySmartBrushIdentity(semantic.brushId);
    if (!identity) continue;
    const separator = semanticKey.indexOf(':');
    const layer = semanticKey.slice(0, separator) as LayerName;
    const [x, y] = semanticKey.slice(separator + 1).split(',').map(Number);
    if (!inBounds(x, y)) continue;
    entries.push({ semanticKey, layer, x, y, cell: { ...identity, sourceLayer: layer } });
  }
  return entries;
}

function nativeCompanionLayer(tileData: RoomTileData, sourceLayer: LayerName, x: number, y: number): LayerName {
  const candidates = sourceLayer === 'terrain'
    ? (['background', 'foreground'] as const)
    : (['terrain', sourceLayer === 'background' ? 'foreground' : 'background'] as const);
  return candidates.find((layer) => decodeTileDataValue(tileData[layer][y]?.[x] ?? -1).gid <= 0)
    ?? candidates[0];
}

function resolveNativeLegacyDecorations(tileData: RoomTileData, state: RoomSmartTerrainState): void {
  const entries = getNativeLegacyEntries(state);
  const byCoordinate = new Map(entries.map((entry) => [
    `${entry.layer}:${smartCellKey(entry.x, entry.y)}`,
    entry,
  ]));
  const add = (
    owner: NativeLegacyEntry,
    targetX: number,
    targetY: number,
    partId: string,
    localIndex: number,
    flipX = false,
    layer: LayerName = owner.layer,
  ) => addNativeLegacyOutput(
    tileData,
    state,
    owner.semanticKey,
    `${partId}:${targetX},${targetY}`,
    layer,
    targetX,
    targetY,
    encodeTileDataValue(toGid(owner.cell.theme, localIndex), flipX),
  );

  for (const entry of entries) {
    if (entry.cell.material !== 'ground' || entry.cell.theme === 'water') continue;
    if (sameFamily(tileData, state, entry.x, entry.y - 1, entry.cell)) continue;
    const semantic = state.semanticCells[entry.semanticKey];
    if (semantic?.shapeValue) {
      const localIndex = decodeTileDataValue(semantic.shapeValue).gid - getFirstGid(entry.cell.theme);
      if (!GROUND_TOP_LOCAL_INDICES.has(localIndex)) continue;
    }
    const hash = stableHash(entry.x, entry.y, 53);
    if (hash % 8 !== 0) continue;
    const variants = SMART_TILESET_SLOTS.groundDecoration[entry.cell.theme];
    const variant = variants[Math.floor(hash / 8) % variants.length] ?? variants[0];
    if (!variant) continue;
    if (variant.length === 1) {
      add(entry, entry.x, entry.y - 1, 'detail-top', variant[0]!);
      continue;
    }
    const right = byCoordinate.get(`${entry.layer}:${smartCellKey(entry.x + 1, entry.y)}`);
    if (
      !right
      || right.cell.theme !== entry.cell.theme
      || right.cell.material !== 'ground'
      || sameFamily(tileData, state, right.x, right.y - 1, right.cell)
      || decodeTileDataValue(tileData[entry.layer][entry.y - 1]?.[entry.x] ?? -1).gid > 0
      || decodeTileDataValue(tileData[entry.layer][entry.y - 1]?.[entry.x + 1] ?? -1).gid > 0
    ) continue;
    add(entry, entry.x, entry.y - 1, 'detail-top', variant[0]!);
    add(right, right.x, right.y - 1, 'detail-top', variant[1]!);
  }

  const border = SMART_TILESET_SLOTS.feature.border;
  const candidates = new Map<string, NativeLegacyEntry>();
  for (const entry of entries) {
    if (entry.cell.material !== 'feature') continue;
    for (const [x, y] of [
      [entry.x, entry.y - 1], [entry.x + 1, entry.y],
      [entry.x, entry.y + 1], [entry.x - 1, entry.y],
    ]) {
      if (!inBounds(x, y) || sameFamily(tileData, state, x, y, entry.cell)) continue;
      const key = `${entry.layer}:${entry.cell.theme}:${smartCellKey(x, y)}`;
      const existing = candidates.get(key);
      if (!existing || entry.semanticKey.localeCompare(existing.semanticKey) < 0) {
        candidates.set(key, entry);
      }
    }
  }

  for (const [candidateKey, candidate] of candidates) {
    const coordinateKey = candidateKey.slice(candidateKey.lastIndexOf(':') + 1);
    const [x, y] = coordinateKey.split(',').map(Number);
    const same = (targetX: number, targetY: number) => sameFamily(
      tileData, state, targetX, targetY, candidate.cell,
    );
    const above = same(x, y - 1);
    const right = same(x + 1, y);
    const below = same(x, y + 1);
    const left = same(x - 1, y);
    const cardinalCount = Number(above) + Number(right) + Number(below) + Number(left);
    const owners = entries.filter((entry) => (
      entry.layer === candidate.layer
      && entry.cell.theme === candidate.cell.theme
      && entry.cell.material === 'feature'
      && ((above && entry.x === x && entry.y === y - 1)
        || (right && entry.x === x + 1 && entry.y === y)
        || (below && entry.x === x && entry.y === y + 1)
        || (left && entry.x === x - 1 && entry.y === y))
    )).sort((first, second) => first.semanticKey.localeCompare(second.semanticKey));
    const owner = owners[0] ?? candidate;
    const secondary = (
      partId: string,
      localIndex: number,
      flipX = false,
    ) => add(
      owner,
      x,
      y,
      partId,
      localIndex,
      flipX,
      nativeCompanionLayer(tileData, owner.layer, x, y),
    );
    if (cardinalCount === 1) {
      if (below) add(owner, x, y, 'top', border.top);
      else if (above) add(owner, x, y, 'bottom', border.bottom);
      else if (right) add(owner, x, y, 'left', border.left);
      else if (left) add(owner, x, y, 'right', border.right);
    } else if (cardinalCount === 2) {
      if (below && right) add(owner, x, y, 'topLeft', border.topLeft);
      else if (below && left) add(owner, x, y, 'topRight', border.topLeft, true);
      else if (above && right) add(owner, x, y, 'bottomLeft', border.bottomRight, true);
      else if (above && left) add(owner, x, y, 'bottomRight', border.bottomRight);
      else if (above && below) {
        add(owner, x, y, 'top', border.top);
        secondary('bottom', border.bottom);
      } else if (left && right) {
        add(owner, x, y, 'left', border.left);
        secondary('right', border.right);
      }
    } else if (cardinalCount === 3) {
      if (!right) {
        add(owner, x, y, 'bottomRight', border.bottomRight);
        secondary('top', border.top);
      } else if (!left) {
        add(owner, x, y, 'topLeft', border.topLeft);
        secondary('bottom', border.bottom);
      } else if (!below) {
        add(owner, x, y, 'bottomRight', border.bottomRight);
        secondary('left', border.left);
      } else if (!above) {
        add(owner, x, y, 'topLeft', border.topLeft, true);
        secondary('right', border.right);
      }
    } else if (cardinalCount === 4) {
      add(owner, x, y, 'topLeft', border.topLeft);
      secondary('bottomRight', border.bottomRight);
    }
  }
}

function resolveDocument(tileData: RoomTileData, state: RoomSmartTerrainState): void {
  clearOwnedDecorations(tileData, state);
  clearNativeLegacyOutputs(tileData, state);

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
    tileData.terrain[y][x] = cell.lockedValue ?? cell.lockedGid ?? cell.shapeValue ?? cell.shapeGid
      ?? encodeTileDataValue(toGid(cell.theme, resolved.localIndex), resolved.flipX, resolved.flipY);
  }

  for (const [key, cell] of Object.entries(state.backdropCells)) {
    const [x, y] = key.split(',').map(Number);
    if (!inBounds(x, y) || cell.material !== 'tunnel') {
      delete state.backdropCells[key];
      continue;
    }
    const resolved = resolveLocalIndex(tileData, state, x, y, cell, new Set<string>());
    tileData.background[y][x] = cell.lockedValue ?? cell.lockedGid ?? cell.shapeValue ?? cell.shapeGid
      ?? encodeTileDataValue(toGid(cell.theme, resolved.localIndex), resolved.flipX, resolved.flipY);
  }

  resolveNativeLegacySemanticCells(tileData, state);

  const suppressed = new Set(state.suppressedDecorationSlots);
  const canAddDecoration = (
    ownerKey: string,
    targetX: number,
    targetY: number,
    slot: import('./model').SmartGeneratedDecorationState['slot'],
    layer: import('./model').SmartGeneratedDecorationState['layer'] = 'terrain',
  ) => inBounds(targetX, targetY)
    && Boolean(state.cells[ownerKey])
    && !suppressed.has(smartDecorationSlotKey(ownerKey, slot))
    && decodeTileDataValue(tileData[layer][targetY]?.[targetX] ?? -1).gid <= 0;
  const addDecoration = (
    ownerKey: string,
    targetX: number,
    targetY: number,
    slot: import('./model').SmartGeneratedDecorationState['slot'],
    localIndex: number,
    flipX = false,
    flipY = false,
    layer: import('./model').SmartGeneratedDecorationState['layer'] = 'terrain',
    secondary = false,
    gidOverride?: number,
  ) => {
    if (!canAddDecoration(ownerKey, targetX, targetY, slot, layer)) return;
    const gid = gidOverride ?? toGid(state.cells[ownerKey]!.theme, localIndex);
    const value = encodeTileDataValue(gid, flipX, flipY);
    tileData[layer][targetY][targetX] = value;
    const generated = secondary
      ? state.generatedBackgroundDecorations
      : state.generatedDecorations;
    generated[smartCellKey(targetX, targetY)] = { ownerKey, slot, gid, value, layer };
    state.ownedOutputs[smartOwnedOutputKey(layer, targetX, targetY)] = {
      ownerId: `legacy-cell:${ownerKey}`,
      partId: slot,
      kind: 'legacy-decoration',
      layer,
      value,
    };
  };
  const addSecondaryDecoration = (
    ownerKey: string,
    targetX: number,
    targetY: number,
    slot: import('./model').SmartGeneratedDecorationState['slot'],
    localIndex: number,
    flipX = false,
  ) => {
    const layer = decodeTileDataValue(tileData.background[targetY]?.[targetX] ?? -1).gid > 0
      ? 'foreground'
      : 'background';
    addDecoration(ownerKey, targetX, targetY, slot, localIndex, flipX, false, layer, true);
  };

  for (const segment of findDesertHorizontalThinLedges(tileData, state)) {
    for (let x = segment.left; x <= segment.right; x += 1) {
      const isOpenLeftEnd = x === segment.left && !segment.attachedLeft;
      const isOpenRightEnd = x === segment.right && !segment.attachedRight;
      const gid = isOpenLeftEnd
        ? toGid('desert', 14) // Desert B3: original left cap.
        : isOpenRightEnd
          ? toGid('desert', 17) // Desert B6: original right cap.
          : AUTOTILE_EDGE_CASES_DESERT_TILESET_FIRST_GID + stablePick(
            [
              AUTOTILE_EDGE_CASES_DESERT_LOCAL_INDICES.horizontalLedgeMiddleB4,
              AUTOTILE_EDGE_CASES_DESERT_LOCAL_INDICES.horizontalLedgeMiddleB5,
            ],
            x,
            segment.y,
            67,
          );
      tileData.terrain[segment.y][x] = gid;
    }

    if (segment.attachedLeft) {
      addDecoration(
        smartCellKey(segment.left, segment.y),
        segment.left - 1,
        segment.y,
        'left',
        0,
        false,
        false,
        'foreground',
        false,
        AUTOTILE_EDGE_CASES_DESERT_TILESET_FIRST_GID
          + AUTOTILE_EDGE_CASES_DESERT_LOCAL_INDICES.thickBodySeamC6,
      );
    }
    if (segment.attachedRight) {
      addDecoration(
        smartCellKey(segment.right, segment.y),
        segment.right + 1,
        segment.y,
        'right',
        0,
        false,
        false,
        'foreground',
        false,
        AUTOTILE_EDGE_CASES_DESERT_TILESET_FIRST_GID
          + AUTOTILE_EDGE_CASES_DESERT_LOCAL_INDICES.thickBodySeamC3,
      );
    }
  }

  if (!state.detailsEnabled) {
    return;
  }

  const featureCandidates = new Map<string, SmartTerrainCellState>();
  const groundDecorationCandidates: Array<{
    ownerKey: string;
    cell: SmartTerrainCellState;
    x: number;
    y: number;
    hash: number;
  }> = [];
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
    const shapeValue = cell.shapeValue ?? cell.shapeGid;
    if (shapeValue) {
      const localIndex = decodeTileDataValue(shapeValue).gid - getFirstGid(cell.theme);
      if (!GROUND_TOP_LOCAL_INDICES.has(localIndex)) continue;
    }
    const decorationHash = stableHash(x, y, 53);
    if (decorationHash % 8 !== 0) continue;
    groundDecorationCandidates.push({ ownerKey, cell, x, y, hash: decorationHash });
  }

  for (const { ownerKey, cell, x, y, hash } of groundDecorationCandidates) {
    if (cell.theme === 'water') continue;
    const variants = SMART_TILESET_SLOTS.groundDecoration[cell.theme];
    const variant = variants[Math.floor(hash / 8) % variants.length] ?? variants[0];
    if (!variant) continue;
    if (variant.length === 1) {
      addDecoration(ownerKey, x, y - 1, 'top', variant[0]!);
      continue;
    }

    const rightOwnerKey = smartCellKey(x + 1, y);
    const rightOwner = state.cells[rightOwnerKey];
    const rightShapeValue = rightOwner?.shapeValue ?? rightOwner?.shapeGid;
    const rightHasExposedTop = rightOwner
      && rightOwner.theme === cell.theme
      && rightOwner.material === 'ground'
      && !sameFamily(tileData, state, x + 1, y - 1, rightOwner)
      && (!rightShapeValue || GROUND_TOP_LOCAL_INDICES.has(
        decodeTileDataValue(rightShapeValue).gid - getFirstGid(rightOwner.theme),
      ));
    if (
      !rightHasExposedTop
      || !canAddDecoration(ownerKey, x, y - 1, 'top')
      || !canAddDecoration(rightOwnerKey, x + 1, y - 1, 'top')
    ) continue;
    addDecoration(ownerKey, x, y - 1, 'top', variant[0]!);
    addDecoration(rightOwnerKey, x + 1, y - 1, 'top', variant[1]!);
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
      else if (above && below) {
        addDecoration(ownerKey, x, y, 'top', border.top);
        addSecondaryDecoration(ownerKey, x, y, 'bottom', border.bottom);
      } else if (left && right) {
        addDecoration(ownerKey, x, y, 'left', border.left);
        addSecondaryDecoration(ownerKey, x, y, 'right', border.right);
      }
    } else if (cardinalCount === 3) {
      if (!right) {
        addDecoration(ownerKey, x, y, 'bottomRight', border.bottomRight);
        addSecondaryDecoration(ownerKey, x, y, 'top', border.top);
      } else if (!left) {
        addDecoration(ownerKey, x, y, 'topLeft', border.topLeft);
        addSecondaryDecoration(ownerKey, x, y, 'bottom', border.bottom);
      } else if (!below) {
        addDecoration(ownerKey, x, y, 'bottomRight', border.bottomRight);
        addSecondaryDecoration(ownerKey, x, y, 'left', border.left);
      } else if (!above) {
        addDecoration(ownerKey, x, y, 'topLeft', border.topLeft);
        addSecondaryDecoration(ownerKey, x, y, 'right', border.right);
      }
    } else if (cardinalCount === 4) {
      addDecoration(ownerKey, x, y, 'topLeft', border.topLeft);
      addSecondaryDecoration(ownerKey, x, y, 'bottomRight', border.bottomRight);
    }
  }

  resolveNativeLegacyDecorations(tileData, state);
}

export function applySmartCells(
  document: SmartTerrainDocument,
  options: ApplySmartCellsOptions,
): SmartTerrainDocument {
  const tileData = cloneTileData(document.tileData);
  const smartTerrain = cloneRoomSmartTerrainState(document.smartTerrain);
  if (smartTerrain.editingDisabled) return { tileData, smartTerrain };
  const material: SmartTerrainMaterial = options.material === 'platform' ? 'ground' : options.material;
  const backdrop = material === 'tunnel';
  const defaultLayer: LayerName = backdrop ? 'background' : 'terrain';
  const sourceLayer = options.layer ?? defaultLayer;
  const targetCells = backdrop ? smartTerrain.backdropCells : smartTerrain.cells;
  const targetLayer = backdrop ? tileData.background : tileData.terrain;
  const canonicalTheme = backdrop ? 'water' : options.theme === 'water' ? 'forest' : options.theme;
  const brushId = getSmartLegacyBrushId(canonicalTheme, material);
  if (!brushId) return { tileData, smartTerrain };
  if (sourceLayer !== defaultLayer) {
    for (const { x, y } of options.cells) {
      if (!inBounds(x, y)) continue;
      const semanticKey = smartSemanticCellKey(sourceLayer, x, y);
      const ownerId = `${LEGACY_SEMANTIC_OWNER_PREFIX}${semanticKey}`;
      if (options.mode === 'erase') {
        delete smartTerrain.semanticCells[semanticKey];
        tileData[sourceLayer][y][x] = -1;
      } else {
        smartTerrain.semanticCells[semanticKey] = {
          styleId: canonicalTheme,
          brushId,
        };
      }
      smartTerrain.suppressedOutputParts = smartTerrain.suppressedOutputParts.filter(
        (entry) => !entry.startsWith(`${ownerId}:`),
      );
    }
    resolveDocument(tileData, smartTerrain);
    return resolveSmartRecipeDocument({ tileData, smartTerrain });
  }
  for (const { x, y } of options.cells) {
    if (!inBounds(x, y)) {
      continue;
    }
    const key = smartCellKey(x, y);
    const semanticKey = smartSemanticCellKey(backdrop ? 'background' : 'terrain', x, y);
    delete smartTerrain.semanticCells[semanticKey];
    for (const [neighborX, neighborY] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]]) {
      const neighbor = targetCells[smartCellKey(neighborX, neighborY)];
      if (neighbor?.theme === canonicalTheme && neighbor.material === material) {
        delete neighbor.shapeGid;
        delete neighbor.shapeValue;
      }
    }
    if (options.mode === 'erase') {
      delete targetCells[key];
      delete smartTerrain.semanticCells[semanticKey];
      smartTerrain.suppressedDecorationSlots = smartTerrain.suppressedDecorationSlots.filter(
        (slot) => !slot.startsWith(`${key}:`),
      );
      targetLayer[y][x] = -1;
    } else {
      targetCells[key] = {
        theme: canonicalTheme,
        material,
        styleId: canonicalTheme,
        brushId,
      };
      smartTerrain.semanticCells[semanticKey] = {
        styleId: canonicalTheme,
        brushId,
        legacySource: true,
      };
      smartTerrain.suppressedDecorationSlots = smartTerrain.suppressedDecorationSlots.filter(
        (slot) => !slot.startsWith(`${key}:`),
      );
    }
  }
  resolveDocument(tileData, smartTerrain);
  return resolveSmartRecipeDocument({ tileData, smartTerrain });
}

/**
 * Paints only a hollow shape's visible boundary, but resolves each boundary tile
 * as if the shape were filled. This gives the outline a coherent outward-facing
 * surface instead of treating it as a chain of one-cell islands.
 */
export function applySmartOutlineCells(
  document: SmartTerrainDocument,
  options: ApplySmartOutlineCellsOptions,
): SmartTerrainDocument {
  if (document.smartTerrain.editingDisabled) {
    return {
      tileData: cloneTileData(document.tileData),
      smartTerrain: cloneRoomSmartTerrainState(document.smartTerrain),
    };
  }
  const filledCells = Array.from(options.filledCells).filter(({ x, y }) => inBounds(x, y));
  const outlineCells = Array.from(options.outlineCells).filter(({ x, y }) => inBounds(x, y));
  const reference = applySmartCells(document, {
    cells: filledCells,
    mode: 'paint',
    theme: options.theme,
    material: options.material,
    layer: options.layer,
  });
  const result = applySmartCells(document, {
    cells: outlineCells,
    mode: 'paint',
    theme: options.theme,
    material: options.material,
    layer: options.layer,
  });
  const backdrop = options.material === 'tunnel';
  const defaultLayer: LayerName = backdrop ? 'background' : 'terrain';
  const layer = options.layer ?? defaultLayer;
  const targetCells = backdrop ? result.smartTerrain.backdropCells : result.smartTerrain.cells;

  for (const { x, y } of outlineCells) {
    const resolvedGid = reference.tileData[layer][y]?.[x] ?? -1;
    if (resolvedGid <= 0) continue;
    const semantic = result.smartTerrain.semanticCells[smartSemanticCellKey(layer, x, y)];
    if (semantic) semantic.shapeValue = resolvedGid;
    if (layer === defaultLayer) {
      const key = smartCellKey(x, y);
      const cell = targetCells[key];
      if (cell) targetCells[key] = { ...cell, shapeValue: resolvedGid, shapeGid: resolvedGid };
    }
  }

  resolveDocument(result.tileData, result.smartTerrain);
  return resolveSmartRecipeDocument(result);
}

export function lockSmartTerrainCell(
  document: SmartTerrainDocument,
  x: number,
  y: number,
  gid: number,
  layer: 'terrain' | 'background' = 'terrain',
): SmartTerrainDocument {
  const tileData = cloneTileData(document.tileData);
  const smartTerrain = cloneRoomSmartTerrainState(document.smartTerrain);
  if (smartTerrain.editingDisabled) return { tileData, smartTerrain };
  const key = smartCellKey(x, y);
  const cells = layer === 'background' ? smartTerrain.backdropCells : smartTerrain.cells;
  const cell = cells[key];
  tileData[layer][y][x] = gid;
  if (cell) {
    cells[key] = { ...cell, lockedValue: gid, lockedGid: gid };
    const semantic = smartTerrain.semanticCells[smartSemanticCellKey(layer, x, y)];
    if (semantic) semantic.lockedValue = gid;
  }
  resolveDocument(tileData, smartTerrain);
  return resolveSmartRecipeDocument({ tileData, smartTerrain });
}

export function setSmartTerrainDetailsEnabled(
  document: SmartTerrainDocument,
  enabled: boolean,
): SmartTerrainDocument {
  const tileData = cloneTileData(document.tileData);
  const smartTerrain = cloneRoomSmartTerrainState(document.smartTerrain);
  if (smartTerrain.editingDisabled) return { tileData, smartTerrain };
  smartTerrain.detailsEnabled = enabled;
  resolveDocument(tileData, smartTerrain);
  return resolveSmartRecipeDocument({ tileData, smartTerrain });
}

export function fillEmptySmartTerrain(
  document: SmartTerrainDocument,
  theme: SmartTerrainTheme,
  material: SmartTerrainMaterial = 'ground',
): SmartTerrainDocument {
  const cells: SmartCellCoordinate[] = [];
  const layer = material === 'tunnel' ? document.tileData.background : document.tileData.terrain;
  for (let y = 0; y < ROOM_HEIGHT; y += 1) {
    for (let x = 0; x < ROOM_WIDTH; x += 1) {
      if (decodeTileDataValue(layer[y]?.[x] ?? -1).gid <= 0) {
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
  requestedLayer?: import('./model').SmartGeneratedDecorationState['layer'],
): SmartTerrainDocument {
  const tileData = cloneTileData(document.tileData);
  const smartTerrain = cloneRoomSmartTerrainState(document.smartTerrain);
  if (smartTerrain.editingDisabled) return { tileData, smartTerrain };
  const targetKey = smartCellKey(x, y);
  const primary = smartTerrain.generatedDecorations[targetKey];
  const secondary = smartTerrain.generatedBackgroundDecorations[targetKey];
  const generatedMap = (!requestedLayer || primary?.layer === requestedLayer) && primary
    ? smartTerrain.generatedDecorations
    : (!requestedLayer || secondary?.layer === requestedLayer) && secondary
      ? smartTerrain.generatedBackgroundDecorations
      : null;
  const generated = generatedMap?.[targetKey];
  if (!generated) {
    return { tileData, smartTerrain };
  }
  const removals = [[targetKey, generated] as const];
  const ownerTheme = smartTerrain.cells[generated.ownerKey]?.theme;
  const localIndex = ownerTheme ? generated.gid - getFirstGid(ownerTheme) : -1;
  if (ownerTheme === 'desert' && (localIndex === 7 || localIndex === 8)) {
    const companionX = localIndex === 7 ? x + 1 : x - 1;
    const companionKey = smartCellKey(companionX, y);
    const companion = generatedMap?.[companionKey];
    const expectedLocal = localIndex === 7 ? 8 : 7;
    if (
      companion
      && companion.layer === generated.layer
      && companion.gid - getFirstGid(ownerTheme) === expectedLocal
    ) {
      removals.push([companionKey, companion]);
    }
  }
  for (const [removalKey, removal] of removals) {
    const [removalX, removalY] = removalKey.split(',').map(Number);
    tileData[removal.layer][removalY][removalX] = -1;
    smartTerrain.suppressedDecorationSlots.push(
      smartDecorationSlotKey(removal.ownerKey, removal.slot),
    );
    delete generatedMap![removalKey];
  }
  smartTerrain.suppressedDecorationSlots = Array.from(new Set(
    smartTerrain.suppressedDecorationSlots,
  ));
  return { tileData, smartTerrain };
}
