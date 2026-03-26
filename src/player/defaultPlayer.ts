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

export interface DefaultPlayerAnimationDefinition {
  key: string;
  atlasKey: string;
  frameNames: string[];
  frameRate: number;
  repeat: number;
}

const PLAYER_BASE_ASSET_ROOT = 'assets/player/punk4495';
const PLAYER_SHARED_ASSET_ROOT = 'assets/player/default';
const PLAYER_COMBAT_FRAME_PREFIX = 'PlayerCombat ';
const PLAYER_FX_FRAME_PREFIX = 'Effects ';

export const DEFAULT_PLAYER_ATLAS_KEYS = {
  base: 'player-default-base-atlas',
  combat: 'player-default-combat-atlas',
  weapons: 'player-default-weapons-atlas',
  fx: 'player-default-fx-atlas',
} as const;

export const DEFAULT_PLAYER_ATLAS_ASSETS: PlayerAtlasAssetEntry[] = [
  {
    key: DEFAULT_PLAYER_ATLAS_KEYS.base,
    texturePath: `${PLAYER_BASE_ASSET_ROOT}/Punk4495Base.png`,
    atlasPath: `${PLAYER_BASE_ASSET_ROOT}/Punk4495Base.json`,
  },
  {
    key: DEFAULT_PLAYER_ATLAS_KEYS.combat,
    texturePath: `${PLAYER_SHARED_ASSET_ROOT}/PlayerCombatActionsSheet.png`,
    atlasPath: `${PLAYER_SHARED_ASSET_ROOT}/PlayerCombatActionsSheet.json`,
  },
  {
    key: DEFAULT_PLAYER_ATLAS_KEYS.weapons,
    texturePath: `${PLAYER_SHARED_ASSET_ROOT}/WeaponsSheet.png`,
    atlasPath: `${PLAYER_SHARED_ASSET_ROOT}/WeaponsSheet.json`,
  },
  {
    key: DEFAULT_PLAYER_ATLAS_KEYS.fx,
    texturePath: `${PLAYER_SHARED_ASSET_ROOT}/FXSheet.png`,
    atlasPath: `${PLAYER_SHARED_ASSET_ROOT}/FXSheet.json`,
  },
];

function buildAtlasFrameNames(prefix: string, indices: number[]): string[] {
  return indices.map((index) => `${prefix}${index}.aseprite`);
}

const IDLE_FRAMES = Array.from({ length: 8 }, (_, index) => `punk-idle-${index}.png`);
const RUN_FRAMES = Array.from({ length: 8 }, (_, index) => `punk-run-${index}.png`);
const JUMP_RISE_FRAMES = ['punk-jump-rise.png'];
const JUMP_FALL_FRAMES = ['punk-jump-fall.png'];
const WALL_SLIDE_FRAMES = ['punk-jump-fall.png'];
const WALL_JUMP_FRAMES = ['punk-jump-rise.png', 'punk-jump-fall.png'];
const LAND_FRAMES = ['punk-land-0.png', 'punk-land-1.png'];
const LADDER_CLIMB_FRAMES = ['punk-idle-1.png', 'punk-idle-2.png', 'punk-idle-3.png', 'punk-idle-4.png'];
const CROUCH_FRAMES = ['punk-idle-0.png'];
const CRAWL_FRAMES = RUN_FRAMES;
const PUSH_FRAMES = RUN_FRAMES;
const PULL_FRAMES = RUN_FRAMES;
const SWORD_SLASH_FRAMES = buildAtlasFrameNames(PLAYER_COMBAT_FRAME_PREFIX, [89, 90, 91, 92, 93]);
const AIR_SLASH_DOWN_FRAMES = buildAtlasFrameNames(PLAYER_COMBAT_FRAME_PREFIX, [107, 108, 109, 110, 111, 112]);
const GUN_FIRE_FRAMES = buildAtlasFrameNames(PLAYER_COMBAT_FRAME_PREFIX, [233, 234, 235, 236, 237]);

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
    atlasKey: DEFAULT_PLAYER_ATLAS_KEYS.fx,
    frameNames: buildAtlasFrameNames(PLAYER_FX_FRAME_PREFIX, [57, 58, 59, 60, 61, 62, 63]),
    frameRate: 18,
    repeat: 0,
  },
  {
    key: DEFAULT_PLAYER_FX_ANIMATION_KEYS['landing-dust'],
    atlasKey: DEFAULT_PLAYER_ATLAS_KEYS.fx,
    frameNames: buildAtlasFrameNames(PLAYER_FX_FRAME_PREFIX, [64, 65, 66, 67, 68, 69]),
    frameRate: 18,
    repeat: 0,
  },
  {
    key: DEFAULT_PLAYER_FX_ANIMATION_KEYS['run-dust-front'],
    atlasKey: DEFAULT_PLAYER_ATLAS_KEYS.fx,
    frameNames: buildAtlasFrameNames(PLAYER_FX_FRAME_PREFIX, [25, 26, 27, 28, 29, 30, 31, 32]),
    frameRate: 18,
    repeat: 0,
  },
  {
    key: DEFAULT_PLAYER_FX_ANIMATION_KEYS['run-dust-back'],
    atlasKey: DEFAULT_PLAYER_ATLAS_KEYS.fx,
    frameNames: buildAtlasFrameNames(PLAYER_FX_FRAME_PREFIX, [33, 34, 35, 36, 37, 38, 39, 40]),
    frameRate: 18,
    repeat: 0,
  },
  {
    key: DEFAULT_PLAYER_FX_ANIMATION_KEYS['muzzle-flash'],
    atlasKey: DEFAULT_PLAYER_ATLAS_KEYS.fx,
    frameNames: buildAtlasFrameNames(PLAYER_FX_FRAME_PREFIX, [0, 1, 2, 3, 4, 5, 6, 7, 8]),
    frameRate: 24,
    repeat: 0,
  },
  {
    key: DEFAULT_PLAYER_FX_ANIMATION_KEYS['bullet-impact'],
    atlasKey: DEFAULT_PLAYER_ATLAS_KEYS.fx,
    frameNames: buildAtlasFrameNames(PLAYER_FX_FRAME_PREFIX, [9, 10, 11, 12, 13, 14, 15, 16, 17]),
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
    atlasKey: DEFAULT_PLAYER_ATLAS_KEYS.base,
    frameNames: IDLE_FRAMES,
    frameRate: 6,
    repeat: -1,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS.run,
    atlasKey: DEFAULT_PLAYER_ATLAS_KEYS.base,
    frameNames: RUN_FRAMES,
    frameRate: 10,
    repeat: -1,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS['jump-rise'],
    atlasKey: DEFAULT_PLAYER_ATLAS_KEYS.base,
    frameNames: JUMP_RISE_FRAMES,
    frameRate: 1,
    repeat: -1,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS['jump-fall'],
    atlasKey: DEFAULT_PLAYER_ATLAS_KEYS.base,
    frameNames: JUMP_FALL_FRAMES,
    frameRate: 1,
    repeat: -1,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS['wall-slide'],
    atlasKey: DEFAULT_PLAYER_ATLAS_KEYS.base,
    frameNames: WALL_SLIDE_FRAMES,
    frameRate: 10,
    repeat: -1,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS['wall-jump'],
    atlasKey: DEFAULT_PLAYER_ATLAS_KEYS.base,
    frameNames: WALL_JUMP_FRAMES,
    frameRate: 14,
    repeat: -1,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS.land,
    atlasKey: DEFAULT_PLAYER_ATLAS_KEYS.base,
    frameNames: LAND_FRAMES,
    frameRate: 14,
    repeat: 0,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS['ladder-climb'],
    atlasKey: DEFAULT_PLAYER_ATLAS_KEYS.base,
    frameNames: LADDER_CLIMB_FRAMES,
    frameRate: 10,
    repeat: -1,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS.crouch,
    atlasKey: DEFAULT_PLAYER_ATLAS_KEYS.base,
    frameNames: CROUCH_FRAMES,
    frameRate: 10,
    repeat: 0,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS.crawl,
    atlasKey: DEFAULT_PLAYER_ATLAS_KEYS.base,
    frameNames: CRAWL_FRAMES,
    frameRate: 12,
    repeat: -1,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS.push,
    atlasKey: DEFAULT_PLAYER_ATLAS_KEYS.base,
    frameNames: PUSH_FRAMES,
    frameRate: 12,
    repeat: -1,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS.pull,
    atlasKey: DEFAULT_PLAYER_ATLAS_KEYS.base,
    frameNames: PULL_FRAMES,
    frameRate: 12,
    repeat: -1,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS['sword-slash'],
    atlasKey: DEFAULT_PLAYER_ATLAS_KEYS.combat,
    frameNames: SWORD_SLASH_FRAMES,
    frameRate: 18,
    repeat: 0,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS['air-slash-down'],
    atlasKey: DEFAULT_PLAYER_ATLAS_KEYS.combat,
    frameNames: AIR_SLASH_DOWN_FRAMES,
    frameRate: 18,
    repeat: 0,
  },
  {
    key: DEFAULT_PLAYER_ANIMATION_KEYS['gun-fire'],
    atlasKey: DEFAULT_PLAYER_ATLAS_KEYS.combat,
    frameNames: GUN_FIRE_FRAMES,
    frameRate: 18,
    repeat: 0,
  },
];

export const DEFAULT_PLAYER_VISUAL_FEET_OFFSET = 2;
