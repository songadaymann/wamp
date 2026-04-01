export type PlayerAnimationState =
  | 'idle'
  | 'run'
  | 'jump-rise'
  | 'jump-fall'
  | 'wall-slide'
  | 'wall-jump'
  | 'land'
  | 'ladder-climb'
  | 'crouch'
  | 'crawl'
  | 'push'
  | 'pull'
  | 'sword-slash'
  | 'air-slash-down'
  | 'gun-fire';

export type DefaultPlayerAnimationState = PlayerAnimationState;

export interface PlayerAtlasAssetEntry {
  key: string;
  texturePath: string;
  atlasPath: string;
}

export interface PlayerImageAssetEntry {
  key: string;
  path: string;
}

export interface PlayerAnimationFrameEntry {
  key: string;
  frame?: string | number;
}

export interface DefaultPlayerAnimationDefinition {
  key: string;
  frames: PlayerAnimationFrameEntry[];
  frameRate: number;
  repeat: number;
}

const PLAYER_ASSET_ROOT = 'assets/player/default';
const PLAYER_CHONK_MOTION_ASSET_ROOT = 'assets/player/chonk-motion';
const PLAYER_FRAME_PREFIX = 'Player ';
const PLAYER_COMBAT_FRAME_PREFIX = 'PlayerCombat ';
const PLAYER_FX_FRAME_PREFIX = 'Effects ';

export const DEFAULT_PLAYER_ATLAS_KEYS = {
  base: 'player-default-base-atlas',
  combat: 'player-default-combat-atlas',
  weapons: 'player-default-weapons-atlas',
  fx: 'player-default-fx-atlas',
} as const;

export const DEFAULT_PLAYER_IMAGE_KEYS = {
  'chonk-run-01': 'player-chonk-run-01',
  'chonk-run-02': 'player-chonk-run-02',
  'chonk-run-03': 'player-chonk-run-03',
  'chonk-run-04': 'player-chonk-run-04',
  'chonk-run-05': 'player-chonk-run-05',
  'chonk-run-06': 'player-chonk-run-06',
  'chonk-run-07': 'player-chonk-run-07',
  'chonk-run-08': 'player-chonk-run-08',
  'chonk-jump-rise-01': 'player-chonk-jump-rise-01',
  'chonk-jump-fall-01': 'player-chonk-jump-fall-01',
  'chonk-land-01': 'player-chonk-land-01',
} as const;

export const DEFAULT_PLAYER_ATLAS_ASSETS: PlayerAtlasAssetEntry[] = [
  {
    key: DEFAULT_PLAYER_ATLAS_KEYS.base,
    texturePath: `${PLAYER_ASSET_ROOT}/PlayerSheet.png`,
    atlasPath: `${PLAYER_ASSET_ROOT}/PlayerSheet.json`,
  },
  {
    key: DEFAULT_PLAYER_ATLAS_KEYS.combat,
    texturePath: `${PLAYER_ASSET_ROOT}/PlayerCombatActionsSheet.png`,
    atlasPath: `${PLAYER_ASSET_ROOT}/PlayerCombatActionsSheet.json`,
  },
  {
    key: DEFAULT_PLAYER_ATLAS_KEYS.weapons,
    texturePath: `${PLAYER_ASSET_ROOT}/WeaponsSheet.png`,
    atlasPath: `${PLAYER_ASSET_ROOT}/WeaponsSheet.json`,
  },
  {
    key: DEFAULT_PLAYER_ATLAS_KEYS.fx,
    texturePath: `${PLAYER_ASSET_ROOT}/FXSheet.png`,
    atlasPath: `${PLAYER_ASSET_ROOT}/FXSheet.json`,
  },
];

export const DEFAULT_PLAYER_IMAGE_ASSETS: PlayerImageAssetEntry[] = [
  {
    key: DEFAULT_PLAYER_IMAGE_KEYS['chonk-run-01'],
    path: `${PLAYER_CHONK_MOTION_ASSET_ROOT}/Run/Run01.png`,
  },
  {
    key: DEFAULT_PLAYER_IMAGE_KEYS['chonk-run-02'],
    path: `${PLAYER_CHONK_MOTION_ASSET_ROOT}/Run/Run02.png`,
  },
  {
    key: DEFAULT_PLAYER_IMAGE_KEYS['chonk-run-03'],
    path: `${PLAYER_CHONK_MOTION_ASSET_ROOT}/Run/Run03.png`,
  },
  {
    key: DEFAULT_PLAYER_IMAGE_KEYS['chonk-run-04'],
    path: `${PLAYER_CHONK_MOTION_ASSET_ROOT}/Run/Run04.png`,
  },
  {
    key: DEFAULT_PLAYER_IMAGE_KEYS['chonk-run-05'],
    path: `${PLAYER_CHONK_MOTION_ASSET_ROOT}/Run/Run05.png`,
  },
  {
    key: DEFAULT_PLAYER_IMAGE_KEYS['chonk-run-06'],
    path: `${PLAYER_CHONK_MOTION_ASSET_ROOT}/Run/Run06.png`,
  },
  {
    key: DEFAULT_PLAYER_IMAGE_KEYS['chonk-run-07'],
    path: `${PLAYER_CHONK_MOTION_ASSET_ROOT}/Run/Run07.png`,
  },
  {
    key: DEFAULT_PLAYER_IMAGE_KEYS['chonk-run-08'],
    path: `${PLAYER_CHONK_MOTION_ASSET_ROOT}/Run/Run08.png`,
  },
  {
    key: DEFAULT_PLAYER_IMAGE_KEYS['chonk-jump-rise-01'],
    path: `${PLAYER_CHONK_MOTION_ASSET_ROOT}/JumpRise/JumpRise01.png`,
  },
  {
    key: DEFAULT_PLAYER_IMAGE_KEYS['chonk-jump-fall-01'],
    path: `${PLAYER_CHONK_MOTION_ASSET_ROOT}/JumpFall/JumpFall01.png`,
  },
  {
    key: DEFAULT_PLAYER_IMAGE_KEYS['chonk-land-01'],
    path: `${PLAYER_CHONK_MOTION_ASSET_ROOT}/Land/Land01.png`,
  },
];

function buildFrameNames(prefix: string, indices: number[]): string[] {
  return indices.map((index) => `${prefix}${index}.aseprite`);
}

function buildAtlasFrames(atlasKey: string, frameNames: string[]): PlayerAnimationFrameEntry[] {
  return frameNames.map((frameName) => ({
    key: atlasKey,
    frame: frameName,
  }));
}

function buildImageFrames(keys: string[]): PlayerAnimationFrameEntry[] {
  return keys.map((key) => ({ key }));
}

const IDLE_FRAMES = buildFrameNames(PLAYER_FRAME_PREFIX, [0, 1, 2, 3, 4, 5, 6]);
const RUN_FRAMES = buildFrameNames(PLAYER_FRAME_PREFIX, [15, 16, 17, 18, 19, 20, 21, 22]);
const JUMP_RISE_FRAMES = buildFrameNames(PLAYER_FRAME_PREFIX, [32]);
const JUMP_FALL_FRAMES = buildFrameNames(PLAYER_FRAME_PREFIX, [34]);
const WALL_SLIDE_FRAMES = buildFrameNames(PLAYER_FRAME_PREFIX, [107, 108, 109, 110, 111, 112]);
const WALL_JUMP_FRAMES = buildFrameNames(PLAYER_FRAME_PREFIX, [113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123]);
const LAND_FRAMES = buildFrameNames(PLAYER_FRAME_PREFIX, [35, 36]);
const LADDER_CLIMB_FRAMES = buildFrameNames(PLAYER_FRAME_PREFIX, [124, 125, 126, 127, 128, 129, 130, 131]);
const CROUCH_FRAMES = buildFrameNames(PLAYER_FRAME_PREFIX, [51, 52, 53, 54, 55, 56]);
const CRAWL_FRAMES = buildFrameNames(PLAYER_FRAME_PREFIX, [57, 58, 59, 60, 61, 62, 63, 64]);
const PUSH_FRAMES = buildFrameNames(PLAYER_FRAME_PREFIX, [262, 263, 264, 265, 266, 267, 268, 269]);
const PULL_FRAMES = buildFrameNames(PLAYER_FRAME_PREFIX, [270, 271, 272, 273, 274, 275]);
const SWORD_SLASH_FRAMES = buildFrameNames(PLAYER_COMBAT_FRAME_PREFIX, [89, 90, 91, 92, 93]);
const AIR_SLASH_DOWN_FRAMES = buildFrameNames(PLAYER_COMBAT_FRAME_PREFIX, [107, 108, 109, 110, 111, 112]);
const GUN_FIRE_FRAMES = buildFrameNames(PLAYER_COMBAT_FRAME_PREFIX, [233, 234, 235, 236, 237]);

export const DEFAULT_PLAYER_IDLE_TEXTURE_KEY = DEFAULT_PLAYER_ATLAS_KEYS.base;
export const DEFAULT_PLAYER_IDLE_FRAME = IDLE_FRAMES[0];

export const DEFAULT_PLAYER_FX_ANIMATION_KEYS = {
  'jump-dust': 'player-default-fx-jump-dust',
  'landing-dust': 'player-default-fx-landing-dust',
  'run-dust-front': 'player-default-fx-run-dust-front',
  'run-dust-back': 'player-default-fx-run-dust-back',
  'muzzle-flash': 'player-default-fx-muzzle-flash',
  'bullet-impact': 'player-default-fx-bullet-impact',
} as const;

export const DEFAULT_PLAYER_FX_ANIMATIONS: DefaultPlayerAnimationDefinition[] = [
  {
    key: DEFAULT_PLAYER_FX_ANIMATION_KEYS['jump-dust'],
    frames: buildAtlasFrames(
      DEFAULT_PLAYER_ATLAS_KEYS.fx,
      buildFrameNames(PLAYER_FX_FRAME_PREFIX, [57, 58, 59, 60, 61, 62, 63]),
    ),
    frameRate: 18,
    repeat: 0,
  },
  {
    key: DEFAULT_PLAYER_FX_ANIMATION_KEYS['landing-dust'],
    frames: buildAtlasFrames(
      DEFAULT_PLAYER_ATLAS_KEYS.fx,
      buildFrameNames(PLAYER_FX_FRAME_PREFIX, [64, 65, 66, 67, 68, 69]),
    ),
    frameRate: 18,
    repeat: 0,
  },
  {
    key: DEFAULT_PLAYER_FX_ANIMATION_KEYS['run-dust-front'],
    frames: buildAtlasFrames(
      DEFAULT_PLAYER_ATLAS_KEYS.fx,
      buildFrameNames(PLAYER_FX_FRAME_PREFIX, [25, 26, 27, 28, 29, 30, 31, 32]),
    ),
    frameRate: 18,
    repeat: 0,
  },
  {
    key: DEFAULT_PLAYER_FX_ANIMATION_KEYS['run-dust-back'],
    frames: buildAtlasFrames(
      DEFAULT_PLAYER_ATLAS_KEYS.fx,
      buildFrameNames(PLAYER_FX_FRAME_PREFIX, [33, 34, 35, 36, 37, 38, 39, 40]),
    ),
    frameRate: 18,
    repeat: 0,
  },
  {
    key: DEFAULT_PLAYER_FX_ANIMATION_KEYS['muzzle-flash'],
    frames: buildAtlasFrames(
      DEFAULT_PLAYER_ATLAS_KEYS.fx,
      buildFrameNames(PLAYER_FX_FRAME_PREFIX, [0, 1, 2, 3, 4, 5, 6, 7, 8]),
    ),
    frameRate: 24,
    repeat: 0,
  },
  {
    key: DEFAULT_PLAYER_FX_ANIMATION_KEYS['bullet-impact'],
    frames: buildAtlasFrames(
      DEFAULT_PLAYER_ATLAS_KEYS.fx,
      buildFrameNames(PLAYER_FX_FRAME_PREFIX, [9, 10, 11, 12, 13, 14, 15, 16, 17]),
    ),
    frameRate: 24,
    repeat: 0,
  },
];

export const DEFAULT_PLAYER_ANIMATION_KEYS: Record<PlayerAnimationState, string> = {
  idle: 'player-default-idle',
  run: 'player-default-run',
  'jump-rise': 'player-default-jump-rise',
  'jump-fall': 'player-default-jump-fall',
  'wall-slide': 'player-default-wall-slide',
  'wall-jump': 'player-default-wall-jump',
  land: 'player-default-land',
  'ladder-climb': 'player-default-ladder-climb',
  crouch: 'player-default-crouch',
  crawl: 'player-default-crawl',
  push: 'player-default-push',
  pull: 'player-default-pull',
  'sword-slash': 'player-default-sword-slash',
  'air-slash-down': 'player-default-air-slash-down',
  'gun-fire': 'player-default-gun-fire',
};

export const DEFAULT_PLAYER_ANIMATIONS: DefaultPlayerAnimationDefinition[] = [
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS.idle,
    frames: buildAtlasFrames(DEFAULT_PLAYER_ATLAS_KEYS.base, IDLE_FRAMES),
    frameRate: 8,
    repeat: -1,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS.run,
    frames: buildImageFrames([
      DEFAULT_PLAYER_IMAGE_KEYS['chonk-run-01'],
      DEFAULT_PLAYER_IMAGE_KEYS['chonk-run-02'],
      DEFAULT_PLAYER_IMAGE_KEYS['chonk-run-03'],
      DEFAULT_PLAYER_IMAGE_KEYS['chonk-run-04'],
      DEFAULT_PLAYER_IMAGE_KEYS['chonk-run-05'],
      DEFAULT_PLAYER_IMAGE_KEYS['chonk-run-06'],
      DEFAULT_PLAYER_IMAGE_KEYS['chonk-run-07'],
      DEFAULT_PLAYER_IMAGE_KEYS['chonk-run-08'],
    ]),
    frameRate: 12,
    repeat: -1,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS['jump-rise'],
    frames: buildImageFrames([DEFAULT_PLAYER_IMAGE_KEYS['chonk-jump-rise-01']]),
    frameRate: 1,
    repeat: -1,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS['jump-fall'],
    frames: buildImageFrames([DEFAULT_PLAYER_IMAGE_KEYS['chonk-jump-fall-01']]),
    frameRate: 1,
    repeat: -1,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS['wall-slide'],
    frames: buildAtlasFrames(DEFAULT_PLAYER_ATLAS_KEYS.base, WALL_SLIDE_FRAMES),
    frameRate: 10,
    repeat: -1,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS['wall-jump'],
    frames: buildAtlasFrames(DEFAULT_PLAYER_ATLAS_KEYS.base, WALL_JUMP_FRAMES),
    frameRate: 14,
    repeat: -1,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS.land,
    frames: buildImageFrames([DEFAULT_PLAYER_IMAGE_KEYS['chonk-land-01']]),
    frameRate: 14,
    repeat: 0,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS['ladder-climb'],
    frames: buildAtlasFrames(DEFAULT_PLAYER_ATLAS_KEYS.base, LADDER_CLIMB_FRAMES),
    frameRate: 10,
    repeat: -1,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS.crouch,
    frames: buildAtlasFrames(DEFAULT_PLAYER_ATLAS_KEYS.base, CROUCH_FRAMES),
    frameRate: 10,
    repeat: 0,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS.crawl,
    frames: buildAtlasFrames(DEFAULT_PLAYER_ATLAS_KEYS.base, CRAWL_FRAMES),
    frameRate: 12,
    repeat: -1,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS.push,
    frames: buildAtlasFrames(DEFAULT_PLAYER_ATLAS_KEYS.base, PUSH_FRAMES),
    frameRate: 12,
    repeat: -1,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS.pull,
    frames: buildAtlasFrames(DEFAULT_PLAYER_ATLAS_KEYS.base, PULL_FRAMES),
    frameRate: 12,
    repeat: -1,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS['sword-slash'],
    frames: buildAtlasFrames(DEFAULT_PLAYER_ATLAS_KEYS.combat, SWORD_SLASH_FRAMES),
    frameRate: 18,
    repeat: 0,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS['air-slash-down'],
    frames: buildAtlasFrames(DEFAULT_PLAYER_ATLAS_KEYS.combat, AIR_SLASH_DOWN_FRAMES),
    frameRate: 18,
    repeat: 0,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS['gun-fire'],
    frames: buildAtlasFrames(DEFAULT_PLAYER_ATLAS_KEYS.combat, GUN_FIRE_FRAMES),
    frameRate: 18,
    repeat: 0,
  },
];

export const DEFAULT_PLAYER_VISUAL_FEET_OFFSET = 2;
