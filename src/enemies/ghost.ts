export const GHOST_OBJECT_ID = 'ghost';

export interface GhostSpritesheet {
  key: string;
  path: string;
  frameWidth: number;
  frameHeight: number;
}

export interface GhostAnimation {
  key: string;
  spritesheetKey: string;
  frames: number[];
  frameRate: number;
  repeat: number;
}

export const GHOST_SPRITESHEET_KEYS = {
  idle: GHOST_OBJECT_ID,
  walk: 'ghost_walk',
  jumping: 'ghost_jumping',
  falling: 'ghost_falling',
  hurt: 'ghost_hurt',
  death: 'ghost_death',
} as const;

export const GHOST_ANIMATION_KEYS = {
  idle: 'ghost-idle',
  walk: 'ghost-walk',
  jumping: 'ghost-jumping',
  falling: 'ghost-falling',
  hurt: 'ghost-hurt',
  death: 'ghost-death',
} as const;

export const GHOST_EXTRA_SPRITESHEETS: GhostSpritesheet[] = [
  {
    key: GHOST_SPRITESHEET_KEYS.walk,
    path: 'assets/enemies/ghost/walk.png',
    frameWidth: 48,
    frameHeight: 48,
  },
  {
    key: GHOST_SPRITESHEET_KEYS.jumping,
    path: 'assets/enemies/ghost/jumping.png',
    frameWidth: 48,
    frameHeight: 48,
  },
  {
    key: GHOST_SPRITESHEET_KEYS.falling,
    path: 'assets/enemies/ghost/falling.png',
    frameWidth: 48,
    frameHeight: 48,
  },
  {
    key: GHOST_SPRITESHEET_KEYS.hurt,
    path: 'assets/enemies/ghost/hurt.png',
    frameWidth: 48,
    frameHeight: 48,
  },
  {
    key: GHOST_SPRITESHEET_KEYS.death,
    path: 'assets/enemies/ghost/death.png',
    frameWidth: 48,
    frameHeight: 48,
  },
];

export const GHOST_ANIMATIONS: GhostAnimation[] = [
  {
    key: GHOST_ANIMATION_KEYS.idle,
    spritesheetKey: GHOST_SPRITESHEET_KEYS.idle,
    frames: [0, 1, 2, 3, 4, 5, 6, 7],
    frameRate: 8,
    repeat: -1,
  },
  {
    key: GHOST_ANIMATION_KEYS.walk,
    spritesheetKey: GHOST_SPRITESHEET_KEYS.walk,
    frames: [0, 1, 2, 3],
    frameRate: 8,
    repeat: -1,
  },
  {
    key: GHOST_ANIMATION_KEYS.jumping,
    spritesheetKey: GHOST_SPRITESHEET_KEYS.jumping,
    frames: [0, 1, 2],
    frameRate: 8,
    repeat: -1,
  },
  {
    key: GHOST_ANIMATION_KEYS.falling,
    spritesheetKey: GHOST_SPRITESHEET_KEYS.falling,
    frames: [0, 1, 2],
    frameRate: 8,
    repeat: -1,
  },
  {
    key: GHOST_ANIMATION_KEYS.hurt,
    spritesheetKey: GHOST_SPRITESHEET_KEYS.hurt,
    frames: [0, 1, 2, 3],
    frameRate: 12,
    repeat: 0,
  },
  {
    key: GHOST_ANIMATION_KEYS.death,
    spritesheetKey: GHOST_SPRITESHEET_KEYS.death,
    frames: [0, 1, 2, 3, 4, 5],
    frameRate: 12,
    repeat: 0,
  },
];
