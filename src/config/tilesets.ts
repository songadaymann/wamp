export interface TilesetConfig {
  key: string;
  name: string;
  path: string;
  imageWidth: number;
  imageHeight: number;
  columns: number;
  rows: number;
  tileCount: number;
  firstGid: number;
  terrainCollisionProfiles?: Partial<Record<number, TerrainCollisionProfileId>>;
}

export type TerrainCollisionProfileId = 'full' | 'decoratedTop' | 'none';

export interface TerrainCollisionProfileConfig {
  id: TerrainCollisionProfileId;
  hasCollision: boolean;
  topInset: number;
}

export const TERRAIN_COLLISION_PROFILES: Record<
  TerrainCollisionProfileId,
  TerrainCollisionProfileConfig
> = {
  full: {
    id: 'full',
    hasCollision: true,
    topInset: 0,
  },
  decoratedTop: {
    id: 'decoratedTop',
    hasCollision: true,
    topInset: 0,
  },
  none: {
    id: 'none',
    hasCollision: false,
    topInset: 0,
  },
};

function createTilesetCollisionProfiles(
  indices: number[],
  profile: TerrainCollisionProfileId
): Partial<Record<number, TerrainCollisionProfileId>> {
  const result: Partial<Record<number, TerrainCollisionProfileId>> = {};
  for (const index of indices) {
    result[index] = profile;
  }
  return result;
}

const DECORATED_TOP_PROFILE = 'decoratedTop' as const;
const NO_COLLISION_PROFILE = 'none' as const;
const TOP_DECOR_INDICES_STANDARD = [
  9,
  11,
  14,
  15,
  16,
  17,
  20,
  21,
  23,
  25,
  26,
  27,
  28,
  29,
  30,
  33,
  34,
  35,
  37,
  38,
  39,
  40,
  41,
  42,
  44,
  45,
  46,
  49,
  50,
  51,
  52,
  53,
  54,
];
const TOP_DECOR_INDICES_SNOW = [
  13,
  14,
  15,
  18,
  23,
  24,
  25,
  26,
  27,
  34,
  35,
  36,
  37,
  38,
  40,
  41,
  42,
  45,
  46,
  47,
  48,
  49,
];
const TOP_DECOR_INDICES_LAVA = [
  17,
  18,
  19,
  31,
  32,
  33,
  34,
  35,
  46,
  47,
  48,
  49,
  50,
  53,
  54,
  55,
  56,
  57,
  61,
  62,
  63,
  64,
  69,
  70,
  71,
  85,
];
const DECO_ONLY_INDICES_FOREST = [2, 3, 5, 18];
const DECO_ONLY_INDICES_DESERT = [3, 4, 18];
const DECO_ONLY_INDICES_WATER = [1, 2, 3, 5, 13, 18];
const DECO_ONLY_INDICES_SNOW = [8, 9, 10];
const DECO_ONLY_INDICES_LAVA = [8, 10];

export const TILESETS: TilesetConfig[] = [
  {
    key: 'forest',
    name: 'Forest',
    path: 'assets/tilesets/tileset_forest.png',
    imageWidth: 192,
    imageHeight: 96,
    columns: 12,
    rows: 6,
    tileCount: 72,
    firstGid: 1,
    terrainCollisionProfiles: {
      ...createTilesetCollisionProfiles(TOP_DECOR_INDICES_STANDARD, DECORATED_TOP_PROFILE),
      ...createTilesetCollisionProfiles(DECO_ONLY_INDICES_FOREST, NO_COLLISION_PROFILE),
    },
  },
  {
    key: 'desert',
    name: 'Desert',
    path: 'assets/tilesets/tileset_desert.png',
    imageWidth: 192,
    imageHeight: 96,
    columns: 12,
    rows: 6,
    tileCount: 72,
    firstGid: 73,
    terrainCollisionProfiles: {
      ...createTilesetCollisionProfiles(TOP_DECOR_INDICES_STANDARD, DECORATED_TOP_PROFILE),
      ...createTilesetCollisionProfiles(DECO_ONLY_INDICES_DESERT, NO_COLLISION_PROFILE),
    },
  },
  {
    key: 'dirt',
    name: 'Dirt',
    path: 'assets/tilesets/tileset_dirt.png',
    imageWidth: 192,
    imageHeight: 96,
    columns: 12,
    rows: 6,
    tileCount: 72,
    firstGid: 145,
    terrainCollisionProfiles: createTilesetCollisionProfiles(
      TOP_DECOR_INDICES_STANDARD,
      DECORATED_TOP_PROFILE
    ),
  },
  {
    key: 'lava',
    name: 'Lava',
    path: 'assets/tilesets/tileset_lava.png',
    imageWidth: 240,
    imageHeight: 112,
    columns: 15,
    rows: 7,
    tileCount: 105,
    firstGid: 217,
    terrainCollisionProfiles: {
      ...createTilesetCollisionProfiles(TOP_DECOR_INDICES_LAVA, DECORATED_TOP_PROFILE),
      ...createTilesetCollisionProfiles(DECO_ONLY_INDICES_LAVA, NO_COLLISION_PROFILE),
    },
  },
  {
    key: 'snow',
    name: 'Snow',
    path: 'assets/tilesets/tileset_snow.png',
    imageWidth: 176,
    imageHeight: 96,
    columns: 11,
    rows: 6,
    tileCount: 66,
    firstGid: 322,
    terrainCollisionProfiles: {
      ...createTilesetCollisionProfiles(TOP_DECOR_INDICES_SNOW, DECORATED_TOP_PROFILE),
      ...createTilesetCollisionProfiles(DECO_ONLY_INDICES_SNOW, NO_COLLISION_PROFILE),
    },
  },
  {
    key: 'water',
    name: 'Water',
    path: 'assets/tilesets/tileset_water.png',
    imageWidth: 192,
    imageHeight: 96,
    columns: 12,
    rows: 6,
    tileCount: 72,
    firstGid: 388,
    terrainCollisionProfiles: {
      ...createTilesetCollisionProfiles(TOP_DECOR_INDICES_STANDARD, DECORATED_TOP_PROFILE),
      ...createTilesetCollisionProfiles(DECO_ONLY_INDICES_WATER, NO_COLLISION_PROFILE),
    },
  },
  {
    key: 'smb_lvl1_3_5',
    name: 'SMB2-1',
    path: 'assets/tilesets/tileset_smb_lvl1_3_5.png',
    imageWidth: 128,
    imageHeight: 64,
    columns: 8,
    rows: 4,
    tileCount: 32,
    firstGid: 460,
  },
];

export function getTilesetByKey(key: string): TilesetConfig | undefined {
  return TILESETS.find((tileset) => tileset.key === key);
}

export function getTilesetByGid(gid: number): TilesetConfig | undefined {
  if (gid <= 0) {
    return undefined;
  }

  for (const tileset of TILESETS) {
    const maxGid = tileset.firstGid + tileset.tileCount - 1;
    if (gid >= tileset.firstGid && gid <= maxGid) {
      return tileset;
    }
  }

  return undefined;
}

export function getTerrainCollisionProfileForGid(gid: number): TerrainCollisionProfileConfig {
  const tileset = getTilesetByGid(gid);
  if (!tileset) {
    return TERRAIN_COLLISION_PROFILES.full;
  }

  const localIndex = gid - tileset.firstGid;
  const profileId = tileset.terrainCollisionProfiles?.[localIndex] ?? 'full';
  return TERRAIN_COLLISION_PROFILES[profileId];
}
