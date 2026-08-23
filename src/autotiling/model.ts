export const SMART_TERRAIN_VERSION = 1 as const;

export const SMART_TERRAIN_THEMES = ['forest', 'desert', 'cave', 'gothic', 'water'] as const;
export type SmartTerrainTheme = typeof SMART_TERRAIN_THEMES[number];

export const SMART_TERRAIN_MATERIALS = ['ground', 'platform', 'feature', 'tunnel'] as const;
export type SmartTerrainMaterial = typeof SMART_TERRAIN_MATERIALS[number];

export interface SmartTerrainCellState {
  theme: SmartTerrainTheme;
  material: SmartTerrainMaterial;
  /** Exact baked gid protected from automatic re-resolution until Smart paints this cell again. */
  lockedGid?: number;
  /** Shape-derived outward-facing gid; nearby Smart edits clear this so the cell can repair normally. */
  shapeGid?: number;
}

export interface SmartGeneratedDecorationState {
  ownerKey: string;
  slot: 'top' | 'bottom' | 'left' | 'right' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
  gid: number;
}

export interface RoomSmartTerrainState {
  version: typeof SMART_TERRAIN_VERSION;
  detailsEnabled: boolean;
  /** Sparse terrain-layer cells keyed as `x,y`. */
  cells: Record<string, SmartTerrainCellState>;
  /** Sparse Behind Player cells keyed as `x,y`, currently used by the Water tunnel backdrop brush. */
  backdropCells: Record<string, SmartTerrainCellState>;
  /** Sparse engine-owned foreground cells keyed as `x,y`. */
  generatedDecorations: Record<string, SmartGeneratedDecorationState>;
  /** Sparse engine-owned background cells keyed as `x,y`, used when a feature notch needs two edges. */
  generatedBackgroundDecorations: Record<string, SmartGeneratedDecorationState>;
  /** Owner/slot keys deliberately removed by a manual edit. */
  suppressedDecorationSlots: string[];
}

export function smartCellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function smartDecorationSlotKey(ownerKey: string, slot: SmartGeneratedDecorationState['slot']): string {
  return `${ownerKey}:${slot}`;
}

export function createRoomSmartTerrainState(): RoomSmartTerrainState {
  return {
    version: SMART_TERRAIN_VERSION,
    detailsEnabled: true,
    cells: {},
    backdropCells: {},
    generatedDecorations: {},
    generatedBackgroundDecorations: {},
    suppressedDecorationSlots: [],
  };
}

function normalizeSmartCells(value: unknown, expectedLayer: 'terrain' | 'background'): Record<string, SmartTerrainCellState> {
  const cells: Record<string, SmartTerrainCellState> = {};
  if (!value || typeof value !== 'object') return cells;
  for (const [key, cell] of Object.entries(value)) {
    if (!/^\d+,\d+$/.test(key) || !cell || typeof cell !== 'object') continue;
    const entry = cell as Partial<SmartTerrainCellState>;
    if (
      !SMART_TERRAIN_THEMES.includes(entry.theme as SmartTerrainTheme)
      || !SMART_TERRAIN_MATERIALS.includes(entry.material as SmartTerrainMaterial)
      || (expectedLayer === 'background') !== (entry.material === 'tunnel')
      || (entry.theme === 'water') !== (entry.material === 'tunnel')
    ) continue;
    cells[key] = {
      theme: entry.theme as SmartTerrainTheme,
      material: entry.material as SmartTerrainMaterial,
      ...(typeof entry.lockedGid === 'number' && Number.isInteger(entry.lockedGid) && entry.lockedGid > 0
        ? { lockedGid: entry.lockedGid }
        : {}),
      ...(typeof entry.shapeGid === 'number' && Number.isInteger(entry.shapeGid) && entry.shapeGid > 0
        ? { shapeGid: entry.shapeGid }
        : {}),
    };
  }
  return cells;
}

function normalizeGeneratedDecorations(value: unknown): Record<string, SmartGeneratedDecorationState> {
  const generatedDecorations: Record<string, SmartGeneratedDecorationState> = {};
  if (!value || typeof value !== 'object') return generatedDecorations;
  for (const [key, decoration] of Object.entries(value)) {
    if (!/^\d+,\d+$/.test(key) || !decoration || typeof decoration !== 'object') continue;
    const entry = decoration as Partial<SmartGeneratedDecorationState>;
    if (
      typeof entry.ownerKey !== 'string'
      || !/^\d+,\d+$/.test(entry.ownerKey)
      || !['top', 'bottom', 'left', 'right', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight'].includes(entry.slot ?? '')
      || typeof entry.gid !== 'number'
      || !Number.isInteger(entry.gid)
      || entry.gid <= 0
    ) continue;
    generatedDecorations[key] = {
      ownerKey: entry.ownerKey,
      slot: entry.slot as SmartGeneratedDecorationState['slot'],
      gid: entry.gid,
    };
  }
  return generatedDecorations;
}

export function normalizeRoomSmartTerrainState(value: unknown): RoomSmartTerrainState {
  const fallback = createRoomSmartTerrainState();
  if (!value || typeof value !== 'object') {
    return fallback;
  }

  const candidate = value as Partial<RoomSmartTerrainState>;
  const cells = normalizeSmartCells(candidate.cells, 'terrain');
  const backdropCells = normalizeSmartCells(candidate.backdropCells, 'background');

  const generatedDecorations = normalizeGeneratedDecorations(candidate.generatedDecorations);
  const generatedBackgroundDecorations = normalizeGeneratedDecorations(candidate.generatedBackgroundDecorations);

  return {
    version: SMART_TERRAIN_VERSION,
    detailsEnabled: candidate.detailsEnabled !== false,
    cells,
    backdropCells,
    generatedDecorations,
    generatedBackgroundDecorations,
    suppressedDecorationSlots: Array.isArray(candidate.suppressedDecorationSlots)
      ? Array.from(new Set(candidate.suppressedDecorationSlots.filter(
          (entry): entry is string => typeof entry === 'string'
            && /^\d+,\d+:(top|bottom|left|right|topLeft|topRight|bottomLeft|bottomRight)$/.test(entry),
        )))
      : [],
  };
}

export function cloneRoomSmartTerrainState(value: unknown): RoomSmartTerrainState {
  const normalized = normalizeRoomSmartTerrainState(value);
  return {
    ...normalized,
    cells: Object.fromEntries(
      Object.entries(normalized.cells).map(([key, cell]) => [key, { ...cell }]),
    ),
    backdropCells: Object.fromEntries(
      Object.entries(normalized.backdropCells).map(([key, cell]) => [key, { ...cell }]),
    ),
    generatedDecorations: Object.fromEntries(
      Object.entries(normalized.generatedDecorations).map(([key, decoration]) => [key, { ...decoration }]),
    ),
    generatedBackgroundDecorations: Object.fromEntries(
      Object.entries(normalized.generatedBackgroundDecorations).map(([key, decoration]) => [key, { ...decoration }]),
    ),
    suppressedDecorationSlots: [...normalized.suppressedDecorationSlots],
  };
}
