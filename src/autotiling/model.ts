export const SMART_TERRAIN_VERSION = 1 as const;

export const SMART_TERRAIN_THEMES = ['forest', 'desert', 'cave', 'gothic'] as const;
export type SmartTerrainTheme = typeof SMART_TERRAIN_THEMES[number];

export const SMART_TERRAIN_MATERIALS = ['ground', 'platform', 'feature'] as const;
export type SmartTerrainMaterial = typeof SMART_TERRAIN_MATERIALS[number];

export interface SmartTerrainCellState {
  theme: SmartTerrainTheme;
  material: SmartTerrainMaterial;
  /** Exact baked gid protected from automatic re-resolution until Smart paints this cell again. */
  lockedGid?: number;
}

export interface SmartGeneratedDecorationState {
  ownerKey: string;
  slot: 'top';
  gid: number;
}

export interface RoomSmartTerrainState {
  version: typeof SMART_TERRAIN_VERSION;
  detailsEnabled: boolean;
  /** Sparse terrain-layer cells keyed as `x,y`. */
  cells: Record<string, SmartTerrainCellState>;
  /** Sparse engine-owned foreground cells keyed as `x,y`. */
  generatedDecorations: Record<string, SmartGeneratedDecorationState>;
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
    generatedDecorations: {},
    suppressedDecorationSlots: [],
  };
}

export function normalizeRoomSmartTerrainState(value: unknown): RoomSmartTerrainState {
  const fallback = createRoomSmartTerrainState();
  if (!value || typeof value !== 'object') {
    return fallback;
  }

  const candidate = value as Partial<RoomSmartTerrainState>;
  const cells: Record<string, SmartTerrainCellState> = {};
  if (candidate.cells && typeof candidate.cells === 'object') {
    for (const [key, cell] of Object.entries(candidate.cells)) {
      if (!/^\d+,\d+$/.test(key) || !cell || typeof cell !== 'object') {
        continue;
      }
      const entry = cell as Partial<SmartTerrainCellState>;
      if (
        !SMART_TERRAIN_THEMES.includes(entry.theme as SmartTerrainTheme)
        || !SMART_TERRAIN_MATERIALS.includes(entry.material as SmartTerrainMaterial)
      ) {
        continue;
      }
      cells[key] = {
        theme: entry.theme as SmartTerrainTheme,
        material: entry.material as SmartTerrainMaterial,
        ...(typeof entry.lockedGid === 'number' && Number.isInteger(entry.lockedGid) && entry.lockedGid > 0
          ? { lockedGid: entry.lockedGid }
          : {}),
      };
    }
  }

  const generatedDecorations: Record<string, SmartGeneratedDecorationState> = {};
  if (candidate.generatedDecorations && typeof candidate.generatedDecorations === 'object') {
    for (const [key, decoration] of Object.entries(candidate.generatedDecorations)) {
      if (!/^\d+,\d+$/.test(key) || !decoration || typeof decoration !== 'object') {
        continue;
      }
      const entry = decoration as Partial<SmartGeneratedDecorationState>;
      if (
        typeof entry.ownerKey !== 'string'
        || !/^\d+,\d+$/.test(entry.ownerKey)
        || entry.slot !== 'top'
        || typeof entry.gid !== 'number'
        || !Number.isInteger(entry.gid)
        || entry.gid <= 0
      ) {
        continue;
      }
      generatedDecorations[key] = {
        ownerKey: entry.ownerKey,
        slot: entry.slot,
        gid: entry.gid,
      };
    }
  }

  return {
    version: SMART_TERRAIN_VERSION,
    detailsEnabled: candidate.detailsEnabled !== false,
    cells,
    generatedDecorations,
    suppressedDecorationSlots: Array.isArray(candidate.suppressedDecorationSlots)
      ? Array.from(new Set(candidate.suppressedDecorationSlots.filter(
          (entry): entry is string => typeof entry === 'string' && /^\d+,\d+:(top)$/.test(entry),
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
    generatedDecorations: Object.fromEntries(
      Object.entries(normalized.generatedDecorations).map(([key, decoration]) => [key, { ...decoration }]),
    ),
    suppressedDecorationSlots: [...normalized.suppressedDecorationSlots],
  };
}

