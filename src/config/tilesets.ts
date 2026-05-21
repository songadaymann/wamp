import type { LightEmissionConfig, TileLightEmissionConfig } from '../lighting/model';

// ── Tileset Configs ──
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
  lightEmissionProfiles?: Partial<Record<number, TileLightEmissionConfig>>;
  editorTileMetadata?: Partial<Record<number, EditorTileMetadata>>;
  uiTheme?: TilesetUiThemeConfig;
}

export interface EditorTileMetadata {
  label: string;
  description?: string;
  enabled: boolean;
}

export type TilesetMusicColorRole = 'drums' | 'triangle' | 'saw' | 'square';

export interface TilesetUiThemeConfig {
  accentCool: number;
  accentWarm: number;
  accentHot: number;
  accentAlt: number;
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
    // Keep ordinary walkable tops at full height; decoration-only overlays should use the `none` profile instead.
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
  profile: TerrainCollisionProfileId,
): Partial<Record<number, TerrainCollisionProfileId>> {
  const result: Partial<Record<number, TerrainCollisionProfileId>> = {};
  for (const index of indices) {
    result[index] = profile;
  }
  return result;
}

export function createTilesetLightEmissionProfiles(
  indices: number[],
  profile: TileLightEmissionConfig,
): Partial<Record<number, TileLightEmissionConfig>> {
  const result: Partial<Record<number, TileLightEmissionConfig>> = {};
  for (const index of indices) {
    result[index] = { ...profile };
  }
  return result;
}

const DECORATED_TOP_PROFILE = 'decoratedTop' as const;
const NO_COLLISION_PROFILE = 'none' as const;
const TOP_DECOR_INDICES_STANDARD = [
  9, 11,
  14, 15, 16, 17, 20, 21, 23,
  25, 26, 27, 28, 29, 30, 33, 34, 35,
  37, 38, 39, 40, 41, 42,
  44, 45, 46,
  49, 50, 51, 52, 53, 54,
];
const TOP_DECOR_INDICES_FOREST = [
  9, 11,
  12, 14, 15, 16, 17, 19, 20, 21, 23,
  25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35,
  36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47,
  48, 49, 50, 51, 52, 53, 54, 55,
  60, 63, 64, 65, 66, 67, 58, 69, 70, 71,
];
const TOP_DECOR_INDICES_SNOW = [
  13, 14, 15, 18,
  23, 24, 25, 26, 27,
  34, 35, 36, 37, 38,
  40, 41, 42,
  45, 46, 47, 48, 49,
];
const TOP_DECOR_INDICES_LAVA = [
  17, 18, 19,
  31, 32, 33, 34, 35,
  46, 47, 48, 49, 50,
  53, 54, 55, 56, 57,
  61, 62, 63, 64,
  69, 70, 71,
  85,
];
const DECO_ONLY_INDICES_FOREST = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 10,
  13, 18, 22,
  24,
  56, 57, 58, 59,
  61, 62,
];
const DECO_ONLY_INDICES_TEXT = [
  0, 1, 2, 3, 4, 5, 6, 7,
  8, 9, 10, 11, 12, 13, 14, 15,
  16, 17, 18, 19, 20, 21, 22, 23,
  24, 25, 26, 27, 28, 29, 30, 31,
  32, 33, 34, 35, 36, 37, 38, 39,
  40, 41, 42, 43,
];
const DECO_ONLY_INDICES_SIGNS = [
  0, 1, 2, 3, 4, 5,
  6, 7, 8, 9, 10, 11,
  12, 13, 14, 15, 16, 17,
  18, 19, 20, 21, 22, 23,
  24, 25, 26, 27, 28, 29,
  30, 31, 32, 33, 34, 35,
]
const DECO_ONLY_INDICES_WATER = [1, 2, 3, 5, 13, 18];
// Snow still has three bottom-anchored cap overlays above the main platform tops.
const DECO_ONLY_INDICES_SNOW = [2, 3, 4, 8, 9, 10];
// Lava has three matching bottom-anchored cap overlays that should not block the air above the ledge.
const DECO_ONLY_INDICES_LAVA = [2, 4, 8, 10, 20];
const TOP_DECOR_INDICES_TEXT = [44, 45, 46, 47];

const DEFAULT_TILESET_UI_THEME: TilesetUiThemeConfig = {
  accentCool: 0x5dc16b,
  accentWarm: 0xd7ac63,
  accentHot: 0xff7a5c,
  accentAlt: 0x63d6cb,
};

export const SPECIAL_TILESET_KEY = 'special';
export const SPECIAL_TILESET_FIRST_GID = 669;
export type SpecialTileKind =
  | 'breakableBrick'
  | 'oneWayPlatform'
  | 'movingPlatformTile'
  | 'conveyorLeft'
  | 'conveyorRight'
  | 'ice'
  | 'sticky'
  | 'bounce'
  | 'damage'
  | 'gravityUp'
  | 'gravityDown'
  | 'gravityLeft'
  | 'gravityRight'
  | 'water'
  | 'windLeft'
  | 'windRight';

export const SPECIAL_TILE_LOCAL_INDICES = {
  breakableBrick: 0,
  oneWayPlatform: 1,
  movingPlatformTile: 2,
  conveyorLeft: 3,
  conveyorRight: 4,
  ice: 5,
  sticky: 6,
  bounce: 7,
  damage: 8,
  gravityUp: 9,
  gravityDown: 10,
  gravityLeft: 11,
  gravityRight: 12,
  water: 13,
  windLeft: 14,
  windRight: 15,
} as const satisfies Record<SpecialTileKind, number>;

export const SPECIAL_TILE_BREAKABLE_BRICK_LOCAL_INDEX =
  SPECIAL_TILE_LOCAL_INDICES.breakableBrick;
export const SPECIAL_TILE_BREAKABLE_BRICK_GID =
  SPECIAL_TILESET_FIRST_GID + SPECIAL_TILE_BREAKABLE_BRICK_LOCAL_INDEX;

const SPECIAL_TILE_KIND_BY_LOCAL_INDEX: Partial<Record<number, SpecialTileKind>> =
  Object.fromEntries(
    Object.entries(SPECIAL_TILE_LOCAL_INDICES).map(([kind, localIndex]) => [
      localIndex,
      kind as SpecialTileKind,
    ]),
  );

const SPECIAL_TILE_COUNT = 64;
const SPECIAL_TILE_NO_COLLISION_INDICES = [
  SPECIAL_TILE_LOCAL_INDICES.movingPlatformTile,
  SPECIAL_TILE_LOCAL_INDICES.damage,
  SPECIAL_TILE_LOCAL_INDICES.gravityUp,
  SPECIAL_TILE_LOCAL_INDICES.gravityDown,
  SPECIAL_TILE_LOCAL_INDICES.gravityLeft,
  SPECIAL_TILE_LOCAL_INDICES.gravityRight,
  SPECIAL_TILE_LOCAL_INDICES.water,
  SPECIAL_TILE_LOCAL_INDICES.windLeft,
  SPECIAL_TILE_LOCAL_INDICES.windRight,
  ...Array.from({ length: SPECIAL_TILE_COUNT - 16 }, (_, index) => index + 16),
];

function createSpecialTileEditorMetadata(): Partial<Record<number, EditorTileMetadata>> {
  const metadata: Partial<Record<number, EditorTileMetadata>> = {
    0: {
      label: 'Breakable Brick',
      description: 'Breakable solid tile. Player can hit it from below.',
      enabled: true,
    },
    1: {
      label: 'One-Way Platform',
      description: 'Jump-through platform. Press down+jump to drop through.',
      enabled: true,
    },
    2: {
      label: 'Moving Platform',
      description: 'Use the Moving Platform object instead.',
      enabled: false,
    },
    3: {
      label: 'Conveyor Left',
      description: 'Solid conveyor tile that pushes left.',
      enabled: true,
    },
    4: {
      label: 'Conveyor Right',
      description: 'Solid conveyor tile that pushes right.',
      enabled: true,
    },
    5: {
      label: 'Ice',
      description: 'Low-friction solid tile.',
      enabled: true,
    },
    6: {
      label: 'Sticky',
      description: 'Sticky solid tile that slows movement and jumps.',
      enabled: true,
    },
    7: {
      label: 'Bounce',
      description: 'Beach-ball bounce tile.',
      enabled: true,
    },
    8: {
      label: 'Damage',
      description: 'Hazard tile. Touching it defeats the player.',
      enabled: true,
    },
    9: {
      label: 'Gravity Up',
      description: 'Gravity plate that sets upward gravity until the player leaves the room.',
      enabled: true,
    },
    10: {
      label: 'Gravity Down',
      description: 'Gravity plate that resets gravity downward until the player leaves the room.',
      enabled: true,
    },
    11: {
      label: 'Gravity Left',
      description: 'Gravity plate that sets leftward gravity until the player leaves the room.',
      enabled: true,
    },
    12: {
      label: 'Gravity Right',
      description: 'Gravity plate that sets rightward gravity until the player leaves the room.',
      enabled: true,
    },
    13: {
      label: 'Water',
      description: 'Swim zone tile.',
      enabled: true,
    },
    14: {
      label: 'Wind Left',
      description: 'Wind zone that pushes left.',
      enabled: true,
    },
    15: {
      label: 'Wind Right',
      description: 'Wind zone that pushes right.',
      enabled: true,
    },
  };

  for (let index = 16; index < SPECIAL_TILE_COUNT; index += 1) {
    metadata[index] = {
      label: `Reserved ${index + 1}`,
      description: 'Reserved special tile slot.',
      enabled: false,
    };
  }

  return metadata;
}

const FIRE_LIGHT_FLICKER = Object.freeze({
  radiusAmplitude: 0.14,
  alphaAmplitude: 0.16,
  speedHz: 2.1,
} satisfies LightEmissionConfig['flicker']);

const FIRE_BIG_LIGHT_FLICKER = Object.freeze({
  radiusAmplitude: 0.17,
  alphaAmplitude: 0.19,
  speedHz: 1.7,
} satisfies LightEmissionConfig['flicker']);

const LAVA_LIGHT_FLICKER = Object.freeze({
  radiusAmplitude: 0.08,
  alphaAmplitude: 0.1,
  speedHz: 0.95,
} satisfies LightEmissionConfig['flicker']);

const CAVE_LANTERN_LIGHT_FLICKER = Object.freeze({
  radiusAmplitude: 0.06,
  alphaAmplitude: 0.08,
  speedHz: 1.25,
} satisfies LightEmissionConfig['flicker']);

export const FIRE_LIGHT_EMISSION = Object.freeze({
  offsetY: -2,
  revealRadiusPx: 25,
  glowRadiusPx: 37,
  glowColor: 0xffa347,
  glowAlpha: 0.52,
  flicker: FIRE_LIGHT_FLICKER,
} satisfies LightEmissionConfig);

export const FIRE_BIG_LIGHT_EMISSION = Object.freeze({
  offsetY: -6,
  revealRadiusPx: 32,
  glowRadiusPx: 51,
  glowColor: 0xffa347,
  glowAlpha: 0.62,
  flicker: FIRE_BIG_LIGHT_FLICKER,
} satisfies LightEmissionConfig);

export const LAVA_OBJECT_LIGHT_EMISSION = Object.freeze({
  offsetY: -10,
  revealRadiusPx: 38,
  glowRadiusPx: 65,
  glowColor: 0xff6a36,
  glowAlpha: 0.5,
  flicker: LAVA_LIGHT_FLICKER,
} satisfies LightEmissionConfig);

const CAVE_LANTERN_TILE_LIGHT_EMISSION = Object.freeze({
  offsetY: 2,
  revealRadiusPx: 24,
  glowRadiusPx: 40,
  glowColor: 0xffd37a,
  glowAlpha: 0.46,
  flicker: CAVE_LANTERN_LIGHT_FLICKER,
} satisfies TileLightEmissionConfig);

const GOTHIC_CANDLE_TILE_LIGHT_EMISSION = Object.freeze({
  offsetY: 0,
  revealRadiusPx: 10,
  glowRadiusPx: 25,
  glowColor: 0xdbd4ba,
  glowAlpha: 0.5,
  flicker: CAVE_LANTERN_LIGHT_FLICKER,
} satisfies TileLightEmissionConfig);

const CAVE_LANTERN_LIGHT_INDICES = [62, 64];
const GOTHIC_CANDLE_LIGHT_INDICES = [59,65]

// firstGid assignments: 0 = empty, then sequential per tileset.
// Keep existing ranges stable because persisted room tile data stores absolute gids.
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
      ...createTilesetCollisionProfiles(TOP_DECOR_INDICES_FOREST, DECORATED_TOP_PROFILE),
      ...createTilesetCollisionProfiles(DECO_ONLY_INDICES_FOREST, NO_COLLISION_PROFILE),
    },
    uiTheme: DEFAULT_TILESET_UI_THEME,
  },
  {
    key: 'desert',
    name: 'Desert',
    path: 'assets/tilesets/tileset_desert.png?v=2026-04-01-desert-tiles',
    imageWidth: 192,
    imageHeight: 96,
    columns: 12,
    rows: 6,
    tileCount: 72,
    firstGid: 73,
    terrainCollisionProfiles: {
      ...createTilesetCollisionProfiles(TOP_DECOR_INDICES_FOREST, DECORATED_TOP_PROFILE),
      ...createTilesetCollisionProfiles(DECO_ONLY_INDICES_FOREST, NO_COLLISION_PROFILE),
    },
    uiTheme: {
      accentCool: 0x62c8ad,
      accentWarm: 0xf0c06b,
      accentHot: 0xff8f60,
      accentAlt: 0xc98a54,
    },
  },
  {
    key: 'cave',
    name: 'Cave',
    path: 'assets/tilesets/tileset_cave.png',
    imageWidth: 192,
    imageHeight: 96,
    columns: 12,
    rows: 6,
    tileCount: 72,
    firstGid: 145,
    terrainCollisionProfiles: {
      ...createTilesetCollisionProfiles(TOP_DECOR_INDICES_FOREST, DECORATED_TOP_PROFILE),
      ...createTilesetCollisionProfiles(DECO_ONLY_INDICES_FOREST, NO_COLLISION_PROFILE),
    },
    lightEmissionProfiles: {
      ...createTilesetLightEmissionProfiles(
        CAVE_LANTERN_LIGHT_INDICES,
        CAVE_LANTERN_TILE_LIGHT_EMISSION,
      ),
    },
    uiTheme: {
      accentCool: 0x84b95d,
      accentWarm: 0xcd9158,
      accentHot: 0xe76f50,
      accentAlt: 0xd8b373,
    },
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
    uiTheme: {
      accentCool: 0xce6bff,
      accentWarm: 0xffb15a,
      accentHot: 0xff5f7f,
      accentAlt: 0xff8e63,
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
    uiTheme: {
      accentCool: 0x7fd4ff,
      accentWarm: 0xdfeaff,
      accentHot: 0xffb36b,
      accentAlt: 0xa4b8ff,
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
    uiTheme: {
      accentCool: 0x60d7ff,
      accentWarm: 0x91f0d0,
      accentHot: 0x5b9dff,
      accentAlt: 0x6ee6d4,
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
    uiTheme: {
      accentCool: 0x5ca9ff,
      accentWarm: 0xfbd45b,
      accentHot: 0xff7865,
      accentAlt: 0x86d54a,
    },
  },
  {
    key: 'essentials',
    name: 'Essentials',
    path: 'assets/tilesets/beginner.png',
    imageWidth: 144,
    imageHeight: 80,
    columns: 9,
    rows: 5,
    tileCount: 45,
    firstGid: 492,
    uiTheme: {
      accentCool: 0x5ca9ff,
      accentWarm: 0xfbd45b,
      accentHot: 0xff7865,
      accentAlt: 0x86d54a,
    },
  },
  {
    key: 'text white',
    name: 'Text White',
    path: 'assets/tilesets/text_white.png',
    imageWidth: 128,
    imageHeight: 96,
    columns: 8,
    rows: 6,
    tileCount: 48,
    firstGid: 537,
    terrainCollisionProfiles: {
      ...createTilesetCollisionProfiles(TOP_DECOR_INDICES_TEXT, DECORATED_TOP_PROFILE),
      ...createTilesetCollisionProfiles(DECO_ONLY_INDICES_TEXT, NO_COLLISION_PROFILE),
    },
    uiTheme: {
      accentCool: 0x5ca9ff,
      accentWarm: 0xfbd45b,
      accentHot: 0xff7865,
      accentAlt: 0x86d54a,
    },
  },
  {
    key: 'text black',
    name: 'Text Black',
    path: 'assets/tilesets/text_black.png',
    imageWidth: 128,
    imageHeight: 96,
    columns: 8,
    rows: 6,
    tileCount: 48,
    firstGid: 585,
    terrainCollisionProfiles: {
      ...createTilesetCollisionProfiles(TOP_DECOR_INDICES_TEXT, DECORATED_TOP_PROFILE),
      ...createTilesetCollisionProfiles(DECO_ONLY_INDICES_TEXT, NO_COLLISION_PROFILE),
    },
    uiTheme: {
      accentCool: 0x5ca9ff,
      accentWarm: 0xfbd45b,
      accentHot: 0xff7865,
      accentAlt: 0x86d54a,
    },
  },
  {
    key: 'signs and graffiti',
    name: 'Signs and Graffiti',
    path: 'assets/tilesets/signs.png',
    imageWidth: 96,
    imageHeight: 96,
    columns: 6,
    rows: 6,
    tileCount: 36,
    firstGid: 633,
    terrainCollisionProfiles: {
      ...createTilesetCollisionProfiles(DECO_ONLY_INDICES_SIGNS, NO_COLLISION_PROFILE),
    },
    uiTheme: {
      accentCool: 0x5ca9ff,
      accentWarm: 0xfbd45b,
      accentHot: 0xff7865,
      accentAlt: 0x86d54a,
    },
  },
  {
    key: SPECIAL_TILESET_KEY,
    name: 'Special',
    path: 'assets/tilesets/special.png?v=2026-05-12-special-tiles',
    imageWidth: 128,
    imageHeight: 128,
    columns: 8,
    rows: 8,
    tileCount: SPECIAL_TILE_COUNT,
    firstGid: SPECIAL_TILESET_FIRST_GID,
    terrainCollisionProfiles: {
      ...createTilesetCollisionProfiles(SPECIAL_TILE_NO_COLLISION_INDICES, NO_COLLISION_PROFILE),
    },
    editorTileMetadata: createSpecialTileEditorMetadata(),
    uiTheme: {
      accentCool: 0x6fd2c8,
      accentWarm: 0xf3c74f,
      accentHot: 0xff6c4a,
      accentAlt: 0x9bb0ff,
    },
  },
  {
    key: 'gothic',
    name: 'Gothic',
    path: 'assets/tilesets/gothic.png',
    imageWidth: 192,
    imageHeight: 96,
    columns: 12,
    rows: 6,
    tileCount: 72,
    firstGid: 733,
    terrainCollisionProfiles: {
      ...createTilesetCollisionProfiles(TOP_DECOR_INDICES_FOREST, DECORATED_TOP_PROFILE),
      ...createTilesetCollisionProfiles(DECO_ONLY_INDICES_FOREST, NO_COLLISION_PROFILE),
    },
    lightEmissionProfiles: {
      ...createTilesetLightEmissionProfiles(
        GOTHIC_CANDLE_LIGHT_INDICES,
        GOTHIC_CANDLE_TILE_LIGHT_EMISSION,
      ),
    },
    uiTheme: {
      accentCool: 0x84b95d,
      accentWarm: 0xcd9158,
      accentHot: 0xe76f50,
      accentAlt: 0xd8b373,
    },
  },
];

const LEGACY_TILESET_KEY_ALIASES: Record<string, string> = {
  dirt: 'cave',
};

export function getTilesetByKey(key: string): TilesetConfig | undefined {
  const normalizedKey = LEGACY_TILESET_KEY_ALIASES[key] ?? key;
  return TILESETS.find(ts => ts.key === normalizedKey);
}

export function getTilesetUiTheme(key: string | null | undefined): TilesetUiThemeConfig {
  return getTilesetByKey(key ?? '')?.uiTheme ?? DEFAULT_TILESET_UI_THEME;
}

export function colorNumberToCssHex(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}

export function colorNumberToCssRgb(value: number): string {
  const red = (value >> 16) & 0xff;
  const green = (value >> 8) & 0xff;
  const blue = value & 0xff;
  return `${red}, ${green}, ${blue}`;
}

export function colorNumberToCssRgba(value: number, alpha: number): string {
  return `rgba(${colorNumberToCssRgb(value)}, ${alpha})`;
}

export function getTilesetMusicInstrumentColor(
  key: string | null | undefined,
  role: TilesetMusicColorRole,
): number {
  const theme = getTilesetUiTheme(key);
  if (role === 'drums') {
    return theme.accentWarm;
  }
  if (role === 'triangle') {
    return theme.accentCool;
  }
  if (role === 'saw') {
    return theme.accentHot;
  }
  return theme.accentAlt;
}

export function getTilesetMusicInstrumentColorCss(
  key: string | null | undefined,
  role: TilesetMusicColorRole,
): string {
  return colorNumberToCssHex(getTilesetMusicInstrumentColor(key, role));
}

export function getTilesetMusicInstrumentColorRgbCss(
  key: string | null | undefined,
  role: TilesetMusicColorRole,
): string {
  return colorNumberToCssRgb(getTilesetMusicInstrumentColor(key, role));
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

export function getTilesetLocalTileIndex(gid: number): number | null {
  const tileset = getTilesetByGid(gid);
  if (!tileset) {
    return null;
  }

  return gid - tileset.firstGid;
}

export function isTilesetLocalTileEditorEnabled(
  tileset: TilesetConfig,
  localIndex: number,
): boolean {
  return tileset.editorTileMetadata?.[localIndex]?.enabled !== false;
}

export function isSpecialBreakableBrickGid(gid: number): boolean {
  return gid === SPECIAL_TILE_BREAKABLE_BRICK_GID;
}

export function getSpecialTileLocalIndexForGid(gid: number): number | null {
  if (gid < SPECIAL_TILESET_FIRST_GID || gid >= SPECIAL_TILESET_FIRST_GID + SPECIAL_TILE_COUNT) {
    return null;
  }

  return gid - SPECIAL_TILESET_FIRST_GID;
}

export function getSpecialTileKindForGid(gid: number): SpecialTileKind | null {
  const localIndex = getSpecialTileLocalIndexForGid(gid);
  if (localIndex === null) {
    return null;
  }

  return SPECIAL_TILE_KIND_BY_LOCAL_INDEX[localIndex] ?? null;
}

export function isSpecialTileKindGid(gid: number, kind: SpecialTileKind): boolean {
  return getSpecialTileKindForGid(gid) === kind;
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
