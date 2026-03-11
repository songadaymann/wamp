import { DEFAULT_PLAYER_FX_ANIMATION_KEYS } from '../player/defaultPlayer';

export interface FxSpritesheetAsset {
  key: string;
  path: string;
  frameWidth: number;
  frameHeight: number;
}

export interface FxSpritesheetAnimationDefinition {
  key: string;
  spritesheetKey: string;
  startFrame: number;
  endFrame: number;
  frameRate: number;
  repeat: number;
}

const FX_ASSET_ROOT = 'assets/fx';

export const ROCKY_ROADS_FX_SPRITESHEETS: FxSpritesheetAsset[] = [
  { key: 'fx-boing-sheet', path: `${FX_ASSET_ROOT}/boing.png`, frameWidth: 32, frameHeight: 32 },
  {
    key: 'fx-bomb-explosion-sheet',
    path: `${FX_ASSET_ROOT}/bomb_explosion.png`,
    frameWidth: 32,
    frameHeight: 32,
  },
  {
    key: 'fx-coin-collect-sheet',
    path: `${FX_ASSET_ROOT}/coin_collect.png`,
    frameWidth: 16,
    frameHeight: 16,
  },
  { key: 'fx-dust-sheet', path: `${FX_ASSET_ROOT}/dust.png`, frameWidth: 48, frameHeight: 48 },
  { key: 'fx-hit-sheet', path: `${FX_ASSET_ROOT}/hit.png`, frameWidth: 48, frameHeight: 48 },
  { key: 'fx-shine-sheet', path: `${FX_ASSET_ROOT}/shine.png`, frameWidth: 16, frameHeight: 16 },
  {
    key: 'fx-shine-white-sheet',
    path: `${FX_ASSET_ROOT}/shine_white.png`,
    frameWidth: 16,
    frameHeight: 16,
  },
  {
    key: 'fx-walk-dust-sheet',
    path: `${FX_ASSET_ROOT}/walk_dust.png`,
    frameWidth: 16,
    frameHeight: 16,
  },
];

export const FX_ANIMATION_KEYS = {
  boing: 'fx-boing',
  'bomb-explosion': 'fx-bomb-explosion',
  'coin-collect': 'fx-coin-collect',
  dust: 'fx-dust',
  hit: 'fx-hit',
  shine: 'fx-shine',
  'shine-white': 'fx-shine-white',
  'walk-dust': 'fx-walk-dust',
  'player-jump-dust': DEFAULT_PLAYER_FX_ANIMATION_KEYS['jump-dust'],
  'player-landing-dust': DEFAULT_PLAYER_FX_ANIMATION_KEYS['landing-dust'],
  'player-run-dust-front': DEFAULT_PLAYER_FX_ANIMATION_KEYS['run-dust-front'],
  'player-run-dust-back': DEFAULT_PLAYER_FX_ANIMATION_KEYS['run-dust-back'],
  'player-muzzle-flash': DEFAULT_PLAYER_FX_ANIMATION_KEYS['muzzle-flash'],
  'player-bullet-impact': DEFAULT_PLAYER_FX_ANIMATION_KEYS['bullet-impact'],
} as const;

export const ROCKY_ROADS_FX_ANIMATIONS: FxSpritesheetAnimationDefinition[] = [
  {
    key: FX_ANIMATION_KEYS.boing,
    spritesheetKey: 'fx-boing-sheet',
    startFrame: 0,
    endFrame: 5,
    frameRate: 20,
    repeat: 0,
  },
  {
    key: FX_ANIMATION_KEYS['bomb-explosion'],
    spritesheetKey: 'fx-bomb-explosion-sheet',
    startFrame: 0,
    endFrame: 4,
    frameRate: 16,
    repeat: 0,
  },
  {
    key: FX_ANIMATION_KEYS['coin-collect'],
    spritesheetKey: 'fx-coin-collect-sheet',
    startFrame: 0,
    endFrame: 9,
    frameRate: 24,
    repeat: 0,
  },
  {
    key: FX_ANIMATION_KEYS.dust,
    spritesheetKey: 'fx-dust-sheet',
    startFrame: 0,
    endFrame: 7,
    frameRate: 18,
    repeat: 0,
  },
  {
    key: FX_ANIMATION_KEYS.hit,
    spritesheetKey: 'fx-hit-sheet',
    startFrame: 0,
    endFrame: 4,
    frameRate: 20,
    repeat: 0,
  },
  {
    key: FX_ANIMATION_KEYS.shine,
    spritesheetKey: 'fx-shine-sheet',
    startFrame: 0,
    endFrame: 4,
    frameRate: 20,
    repeat: 0,
  },
  {
    key: FX_ANIMATION_KEYS['shine-white'],
    spritesheetKey: 'fx-shine-white-sheet',
    startFrame: 0,
    endFrame: 4,
    frameRate: 20,
    repeat: 0,
  },
  {
    key: FX_ANIMATION_KEYS['walk-dust'],
    spritesheetKey: 'fx-walk-dust-sheet',
    startFrame: 0,
    endFrame: 7,
    frameRate: 18,
    repeat: 0,
  },
];
