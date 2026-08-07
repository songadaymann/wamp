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
  editorPaletteBackgroundColor?: string;
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
  60, 63, 64, 65, 66, 67, 68, 69, 70, 71,
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
const TOP_DECOR_INDICES_BACKROOMS = [
  0, 1, 9,
  12, 13, 21,
  24, 25, 33,
  36, 37, 38, 39, 40, 41, 42, 46,
  48, 49, 50, 51, 52, 53, 54, 55, 59,
  60, 61, 62, 63, 64, 65, 66, 67, 71,
  73, 74, 75, 76, 77, 78, 79, 80,
  90, 91,
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
];
const DECO_ONLY_INDICES_BACKROOMS = [
  2, 3, 4, 5, 6, 7, 8, 10, 11,
  14, 15, 16, 17, 18, 19, 20, 22, 23,
  26, 27, 28, 29, 30, 31, 32, 34, 35,
  43, 44, 45, 47,
  56, 57, 58,
  68, 69, 70, 71,
  72, 81, 82, 83,
  84, 85, 86, 87, 88, 89, 92, 93, 94, 95,
  96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107,
  108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119,
];
const TOP_DECOR_INDICES_WAMPOS95 = [
  4, 5, 6, 7, 8, 9,
  12, 21,
  24, 25, 26, 27, 28, 29, 30, 31, 32, 33,
  36, 37, 38, 39, 40, 41, 42, 43, 44, 45,
  48, 49, 50, 51, 52, 53, 54, 55, 56, 57,
  60, 61, 62, 63, 64, 65, 66, 67, 68, 69,
  72, 73, 74, 75, 76, 77, 78, 79, 80, 81,
  84, 85, 86, 88, 89, 90, 91, 92, 93,
  96, 97, 98, 99, 100, 101, 102, 103, 104,
  115, 116, 117, 118, 119,
  120, 121, 122, 123, 124, 125, 126, 127, 128, 129,
  132, 133, 134, 135, 136, 137, 138, 139, 140, 141,
  160, 164, 165, 166, 167,
  168, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179,
  180, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191,
  192, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203,
  204, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215,
  216, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227,
  228, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239,
  240, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251,
  253, 254, 255, 256, 257, 258, 259, 260, 261, 262, 263,
  264, 265, 266, 267, 268, 269, 270, 271, 272, 273, 274, 275,
  276, 277, 278, 279, 280, 281, 282, 283, 284, 285, 286, 287,
  288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299,
];
const DECO_ONLY_INDICES_WAMPOS95 = [
  0, 1, 2, 3, 10, 11,
  13, 14, 15, 16, 17, 18, 19, 20, 22, 23,
  34, 35,
  46, 47,
  58, 59,
  70, 71,
  82, 83,
  87, 94, 95,
  105, 106, 107,
  108, 109, 110, 111, 112, 113, 114,
  130, 131,
  142, 143,
  144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155,
  156, 157, 158, 159, 161, 162, 163,
  169,
  181,
  193,
  205,
  217,
  229,
  241,
  252,
  300, 301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311,
  312, 313, 314, 315, 316, 317, 318, 319, 320, 321, 322, 323,
];
const DECO_ONLY_INDICES_WATER = [1, 2, 3, 5, 13, 18];
// Snow still has three bottom-anchored cap overlays above the main platform tops.
const DECO_ONLY_INDICES_SNOW = [2, 3, 4, 8, 9, 10];
// Lava has three matching bottom-anchored cap overlays that should not block the air above the ledge.
const DECO_ONLY_INDICES_LAVA = [2, 4, 8, 10, 20];
const TOP_DECOR_INDICES_TEXT = [44, 45, 46, 47];
const DECO_ONLY_INDICES_MICROMONO = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
  32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47,
  48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63,
  64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79,
  80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95,
  96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111,
  112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127,
  128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143,
  144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159,
  160, 161, 162, 163, 164, 165, 166, 167,
];
const TOP_DECOR_INDICES_CYBERCITY = [
  9, 11,
  12, 14, 15, 16, 17, 19, 20, 21, 23,
  25, 26, 27, 28, 29, 30, 31, 33, 34, 35,
  36, 37, 38, 39, 40, 41, 42, 43,
  48, 49, 50, 51, 52, 53, 54, 55,
  60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71,
];
const DECO_ONLY_INDICES_CYBERCITY = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 10,
  13, 18, 22,
  24, 32,
  44, 45, 46, 47,
  56, 57, 58, 59,
];

const DEFAULT_TILESET_UI_THEME: TilesetUiThemeConfig = {
  accentCool: 0x5dc16b,
  accentWarm: 0xd7ac63,
  accentHot: 0xff7a5c,
  accentAlt: 0x63d6cb,
};
export const DEFAULT_TILESET_EDITOR_PALETTE_BACKGROUND_COLOR = '#0b0b0b';

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

const GARGOYLE_LIGHT_FLICKER = Object.freeze({
  radiusAmplitude: 0.08,
  alphaAmplitude: 0.08,
  speedHz: 0.3,
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
  offsetY: -5,
  revealRadiusPx: 10,
  glowRadiusPx: 25,
  glowColor: 0xffe28a,
  glowAlpha: 0.5,
  flicker: CAVE_LANTERN_LIGHT_FLICKER,
} satisfies TileLightEmissionConfig);

const GOTHIC_GARGOYLE_TILE_LIGHT_EMISSION = Object.freeze({
  offsetY: -2,
  offsetX: 3,
  revealRadiusPx: 6,
  glowRadiusPx: 10,
  glowColor: 0xe45b8d,
  glowAlpha: 0.25,
  flicker: GARGOYLE_LIGHT_FLICKER,
} satisfies TileLightEmissionConfig);

const TEXTGLOW_EMISSION = Object.freeze({
  offsetY: 0,
  offsetX: 0,
  revealRadiusPx: 16,
  glowRadiusPx: 16,
  glowColor: 0x6df7c1,
  glowAlpha: 0.25,
} satisfies TileLightEmissionConfig);

const CYBERCITY_LIGHT_EMISSION = Object.freeze({
  offsetY: 0,
  offsetX: 0,
  revealRadiusPx: 16,
  glowRadiusPx: 16,
  glowColor: 0xffffff,
  glowAlpha: 0.25,
} satisfies TileLightEmissionConfig);

const CAVE_LANTERN_LIGHT_INDICES = [62, 64];
const GOTHIC_CANDLE_LIGHT_INDICES = [59];
const GOTHIC_GARGOYLE_LIGHT_INDICES = [65];
const TEXTGLOW_INDICES = [
  0, 1, 2, 3, 4, 5, 6, 7,
  8, 9, 10, 11, 12, 13, 14, 15,
  16, 17, 18, 19, 20, 21, 22, 23,
  24, 25, 26, 27, 28, 29, 30, 31,
  32, 33, 34, 35, 36, 37, 38, 39,
  40, 41, 42, 43,
];
const CYBERCITY_LIGHT_INDICES = [2,3,7,32];

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
    editorPaletteBackgroundColor: '#f3eee2',
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
    path: 'assets/tilesets/special.png',
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
      ...createTilesetLightEmissionProfiles(GOTHIC_CANDLE_LIGHT_INDICES, GOTHIC_CANDLE_TILE_LIGHT_EMISSION),
      ...createTilesetLightEmissionProfiles(GOTHIC_GARGOYLE_LIGHT_INDICES, GOTHIC_GARGOYLE_TILE_LIGHT_EMISSION),
    },
    uiTheme: {
      accentCool: 0x84b95d,
      accentWarm: 0xcd9158,
      accentHot: 0xe76f50,
      accentAlt: 0xd8b373,
    },
  },
  {
    key: 'backrooms',
    name: 'Backrooms',
    path: 'assets/tilesets/backrooms.png',
    imageWidth: 192,
    imageHeight: 160,
    columns: 12,
    rows: 10,
    tileCount: 120,
    firstGid: 805,
    terrainCollisionProfiles: {
      ...createTilesetCollisionProfiles(TOP_DECOR_INDICES_BACKROOMS, DECORATED_TOP_PROFILE),
      ...createTilesetCollisionProfiles(DECO_ONLY_INDICES_BACKROOMS, NO_COLLISION_PROFILE),
    },
    uiTheme: {
      accentCool: 0x5ca9ff,
      accentWarm: 0xfbd45b,
      accentHot: 0xff7865,
      accentAlt: 0x86d54a,
    },
  },
  {
    key: 'wampos95',
    name: 'WampOS 95',
    path: 'assets/tilesets/wampos95.png',
    imageWidth: 192,
    imageHeight: 432,
    columns: 12,
    rows: 27,
    tileCount: 324,
    firstGid: 925,
    terrainCollisionProfiles: {
      ...createTilesetCollisionProfiles(TOP_DECOR_INDICES_WAMPOS95, DECORATED_TOP_PROFILE),
      ...createTilesetCollisionProfiles(DECO_ONLY_INDICES_WAMPOS95, NO_COLLISION_PROFILE),
    },
    uiTheme: {
      accentCool: 0x5ca9ff,
      accentWarm: 0xfbd45b,
      accentHot: 0xff7865,
      accentAlt: 0x86d54a,
    },
  },
  {
    key: 'micromono',
    name: 'MicroMono',
    path: 'assets/tilesets/MicroMono.png',
    imageWidth: 128,
    imageHeight: 336,
    columns: 8,
    rows: 21,
    tileCount: 168,
    firstGid: 1249,
    terrainCollisionProfiles: {
      ...createTilesetCollisionProfiles(DECO_ONLY_INDICES_MICROMONO, NO_COLLISION_PROFILE),
    },
    editorPaletteBackgroundColor: '#f3eee2',
    uiTheme: {
      accentCool: 0x5ca9ff,
      accentWarm: 0xfbd45b,
      accentHot: 0xff7865,
      accentAlt: 0x86d54a,
    },
  },
  {
    key: 'micromonobold',
    name: 'MicroMonoBold',
    path: 'assets/tilesets/MicroMonoBold.png',
    imageWidth: 128,
    imageHeight: 336,
    columns: 8,
    rows: 21,
    tileCount: 168,
    firstGid: 1417,
    terrainCollisionProfiles: {
      ...createTilesetCollisionProfiles(DECO_ONLY_INDICES_MICROMONO, NO_COLLISION_PROFILE),
    },
    editorPaletteBackgroundColor: '#878682',
    uiTheme: {
      accentCool: 0x5ca9ff,
      accentWarm: 0xfbd45b,
      accentHot: 0xff7865,
      accentAlt: 0x86d54a,
    },
  },
  {
    key: 'cybertext',
    name: 'Cyber Text',
    path: 'assets/tilesets/CyberText.png',
    imageWidth: 128,
    imageHeight: 96,
    columns: 8,
    rows: 6,
    tileCount: 48,
    firstGid: 1585,
    terrainCollisionProfiles: {
      ...createTilesetCollisionProfiles(TOP_DECOR_INDICES_TEXT, DECORATED_TOP_PROFILE),
      ...createTilesetCollisionProfiles(DECO_ONLY_INDICES_TEXT, NO_COLLISION_PROFILE),
    },
    editorPaletteBackgroundColor: '#f3eee2',
    lightEmissionProfiles: {
      ...createTilesetLightEmissionProfiles(TEXTGLOW_INDICES, TEXTGLOW_EMISSION),
    },
    uiTheme: {
      accentCool: 0x5ca9ff,
      accentWarm: 0xfbd45b,
      accentHot: 0xff7865,
      accentAlt: 0x86d54a,
    },
  },
  {
    key: 'cybercity yellow',
    name: 'Cybercity Yellow',
    path: 'assets/tilesets/cybercity_yellow.png',
    imageWidth: 192,
    imageHeight: 96,
    columns: 12,
    rows: 6,
    tileCount: 72,
    firstGid: 1633,
    terrainCollisionProfiles: {
      ...createTilesetCollisionProfiles(TOP_DECOR_INDICES_CYBERCITY, DECORATED_TOP_PROFILE),
      ...createTilesetCollisionProfiles(DECO_ONLY_INDICES_CYBERCITY, NO_COLLISION_PROFILE),
    },
    lightEmissionProfiles: {
      ...createTilesetLightEmissionProfiles(CYBERCITY_LIGHT_INDICES, CYBERCITY_LIGHT_EMISSION),
    },
    uiTheme: {
      accentCool: 0x84b95d,
      accentWarm: 0xcd9158,
      accentHot: 0xe76f50,
      accentAlt: 0xd8b373,
    },
  }
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

function normalizeTilesetEditorPaletteBackgroundColor(color: string | null | undefined): string {
  const trimmed = color?.trim();
  return trimmed && trimmed.length > 0
    ? trimmed
    : DEFAULT_TILESET_EDITOR_PALETTE_BACKGROUND_COLOR;
}

export function getTilesetEditorPaletteBackgroundColor(key: string | null | undefined): string {
  return normalizeTilesetEditorPaletteBackgroundColor(
    getTilesetByKey(key ?? '')?.editorPaletteBackgroundColor,
  );
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
