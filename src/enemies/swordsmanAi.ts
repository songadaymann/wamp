export const SWORDSMAN_AI_OBJECT_ID = 'swordsman_ai';

export type SwordsmanAiState = 'patrol' | 'chase' | 'windup' | 'attack' | 'cooldown';

export interface SwordsmanAiSpritesheet {
  key: string;
  path: string;
  frameWidth: number;
  frameHeight: number;
}

export interface SwordsmanAiAnimation {
  key: string;
  spritesheetKey: string;
  frames: number[];
  frameRate: number;
  repeat: number;
}

export const SWORDSMAN_AI_SPRITESHEET_KEYS = {
  idle: SWORDSMAN_AI_OBJECT_ID,
  run: 'swordsman_ai_run',
  jump: 'swordsman_ai_jump',
  land: 'swordsman_ai_land',
  ladderClimb: 'swordsman_ai_ladder_climb',
  swordSlash: 'swordsman_ai_sword_slash',
  hurt: 'swordsman_ai_hurt',
  death: 'swordsman_ai_death',
} as const;

export const SWORDSMAN_AI_ANIMATION_KEYS = {
  idle: 'swordsman-ai-idle',
  run: 'swordsman-ai-run',
  'jump-rise': 'swordsman-ai-jump-rise',
  'jump-fall': 'swordsman-ai-jump-fall',
  land: 'swordsman-ai-land',
  'ladder-climb': 'swordsman-ai-ladder-climb',
  'sword-slash': 'swordsman-ai-sword-slash',
  hurt: 'swordsman-ai-hurt',
  death: 'swordsman-ai-death',
} as const;

export const SWORDSMAN_AI_EXTRA_SPRITESHEETS: SwordsmanAiSpritesheet[] = [
  {
    key: SWORDSMAN_AI_SPRITESHEET_KEYS.run,
    path: 'assets/enemies/swordsman_ai/sword_run.png',
    frameWidth: 48,
    frameHeight: 48,
  },
  {
    key: SWORDSMAN_AI_SPRITESHEET_KEYS.jump,
    path: 'assets/enemies/swordsman_ai/jump.png',
    frameWidth: 48,
    frameHeight: 48,
  },
  {
    key: SWORDSMAN_AI_SPRITESHEET_KEYS.land,
    path: 'assets/enemies/swordsman_ai/land.png',
    frameWidth: 48,
    frameHeight: 48,
  },
  {
    key: SWORDSMAN_AI_SPRITESHEET_KEYS.ladderClimb,
    path: 'assets/enemies/swordsman_ai/ladder_climb.png',
    frameWidth: 48,
    frameHeight: 48,
  },
  {
    key: SWORDSMAN_AI_SPRITESHEET_KEYS.swordSlash,
    path: 'assets/enemies/swordsman_ai/sword_slash.png',
    frameWidth: 64,
    frameHeight: 64,
  },
  {
    key: SWORDSMAN_AI_SPRITESHEET_KEYS.hurt,
    path: 'assets/enemies/swordsman_ai/hurt.png',
    frameWidth: 48,
    frameHeight: 48,
  },
  {
    key: SWORDSMAN_AI_SPRITESHEET_KEYS.death,
    path: 'assets/enemies/swordsman_ai/death.png',
    frameWidth: 48,
    frameHeight: 48,
  },
];

export const SWORDSMAN_AI_ANIMATIONS: SwordsmanAiAnimation[] = [
  {
    key: SWORDSMAN_AI_ANIMATION_KEYS.idle,
    spritesheetKey: SWORDSMAN_AI_SPRITESHEET_KEYS.idle,
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    frameRate: 8,
    repeat: -1,
  },
  {
    key: SWORDSMAN_AI_ANIMATION_KEYS.run,
    spritesheetKey: SWORDSMAN_AI_SPRITESHEET_KEYS.run,
    frames: [0, 1, 2, 3, 4, 5, 6, 7],
    frameRate: 12,
    repeat: -1,
  },
  {
    key: SWORDSMAN_AI_ANIMATION_KEYS['jump-rise'],
    spritesheetKey: SWORDSMAN_AI_SPRITESHEET_KEYS.jump,
    frames: [1],
    frameRate: 1,
    repeat: -1,
  },
  {
    key: SWORDSMAN_AI_ANIMATION_KEYS['jump-fall'],
    spritesheetKey: SWORDSMAN_AI_SPRITESHEET_KEYS.jump,
    frames: [4],
    frameRate: 1,
    repeat: -1,
  },
  {
    key: SWORDSMAN_AI_ANIMATION_KEYS.land,
    spritesheetKey: SWORDSMAN_AI_SPRITESHEET_KEYS.land,
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    frameRate: 14,
    repeat: 0,
  },
  {
    key: SWORDSMAN_AI_ANIMATION_KEYS['ladder-climb'],
    spritesheetKey: SWORDSMAN_AI_SPRITESHEET_KEYS.ladderClimb,
    frames: [0, 1, 2, 3],
    frameRate: 10,
    repeat: -1,
  },
  {
    key: SWORDSMAN_AI_ANIMATION_KEYS['sword-slash'],
    spritesheetKey: SWORDSMAN_AI_SPRITESHEET_KEYS.swordSlash,
    frames: [0, 1, 2, 3, 4, 5],
    frameRate: 18,
    repeat: 0,
  },
  {
    key: SWORDSMAN_AI_ANIMATION_KEYS.hurt,
    spritesheetKey: SWORDSMAN_AI_SPRITESHEET_KEYS.hurt,
    frames: [0, 1, 2, 3],
    frameRate: 12,
    repeat: 0,
  },
  {
    key: SWORDSMAN_AI_ANIMATION_KEYS.death,
    spritesheetKey: SWORDSMAN_AI_SPRITESHEET_KEYS.death,
    frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    frameRate: 12,
    repeat: 0,
  },
];
