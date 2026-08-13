import type { PlacedObject } from '../config';

export const POLICE_PATROLMAN_OBJECT_ID = 'police_patrolman';
export const POLICEWOMAN_OBJECT_ID = 'policewoman';
export const POLICE_ENEMY_OBJECT_IDS = [
  POLICE_PATROLMAN_OBJECT_ID,
  POLICEWOMAN_OBJECT_ID,
] as const;

export type PoliceEnemyObjectId = (typeof POLICE_ENEMY_OBJECT_IDS)[number];
export const POLICE_BEHAVIOR_MODES = ['hunter', 'patrol'] as const;
export type PoliceBehaviorMode = (typeof POLICE_BEHAVIOR_MODES)[number];

export const DEFAULT_POLICE_BEHAVIOR_MODE: PoliceBehaviorMode = 'hunter';
export const DEFAULT_POLICE_PATROL_SHOOTS = false;

export const POLICE_BEHAVIOR_MODE_LABELS: Record<PoliceBehaviorMode, string> = {
  hunter: 'Hunt Player',
  patrol: 'Patrol',
};

export interface PoliceEnemySpritesheet {
  key: string;
  path: string;
  frameWidth: number;
  frameHeight: number;
}

export interface PoliceEnemyAnimation {
  key: string;
  spritesheetKey: string;
  frames: number[];
  frameRate: number;
  repeat: number;
}

type PoliceAnimationAction =
  | 'idle'
  | 'run'
  | 'jump-rise'
  | 'jump-fall'
  | 'shoot'
  | 'reload'
  | 'hurt'
  | 'death';

const POLICE_SPRITESHEETS: Record<
  PoliceEnemyObjectId,
  Record<Exclude<PoliceAnimationAction, 'idle'>, string>
> = {
  [POLICE_PATROLMAN_OBJECT_ID]: {
    run: 'police_patrolman_run',
    'jump-rise': 'police_patrolman_jump',
    'jump-fall': 'police_patrolman_jump',
    shoot: 'police_patrolman_shoot',
    reload: 'police_patrolman_reload',
    hurt: 'police_patrolman_hurt',
    death: 'police_patrolman_death',
  },
  [POLICEWOMAN_OBJECT_ID]: {
    run: 'policewoman_run',
    'jump-rise': 'policewoman_jump',
    'jump-fall': 'policewoman_jump',
    shoot: 'policewoman_shoot',
    reload: 'policewoman_reload',
    hurt: 'policewoman_hurt',
    death: 'policewoman_death',
  },
};

export function isPoliceEnemyObjectId(value: unknown): value is PoliceEnemyObjectId {
  return typeof value === 'string' && (POLICE_ENEMY_OBJECT_IDS as readonly string[]).includes(value);
}

export function normalizePoliceBehaviorMode(value: unknown): PoliceBehaviorMode | null {
  return value === 'hunter' || value === 'patrol' ? value : null;
}

export function normalizePolicePatrolShoots(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_POLICE_PATROL_SHOOTS;
}

export function getPlacedPoliceBehaviorMode(
  placed: Partial<Pick<PlacedObject, 'id' | 'policeBehaviorMode'>>,
): PoliceBehaviorMode | null {
  if (!isPoliceEnemyObjectId(placed.id)) {
    return null;
  }
  return normalizePoliceBehaviorMode(placed.policeBehaviorMode) ?? DEFAULT_POLICE_BEHAVIOR_MODE;
}

export function getPlacedPolicePatrolShoots(
  placed: Partial<Pick<PlacedObject, 'id' | 'policePatrolShoots'>>,
): boolean {
  return isPoliceEnemyObjectId(placed.id)
    ? normalizePolicePatrolShoots(placed.policePatrolShoots)
    : false;
}

export function getPoliceAnimationKey(
  objectId: string,
  action: PoliceAnimationAction,
): string | null {
  if (!isPoliceEnemyObjectId(objectId)) {
    return null;
  }
  return `${objectId}-${action}`;
}

export const POLICE_ENEMY_EXTRA_SPRITESHEETS: PoliceEnemySpritesheet[] = [
  { key: POLICE_SPRITESHEETS.police_patrolman.run, path: 'assets/enemies/police_patrolman/run.png', frameWidth: 64, frameHeight: 64 },
  { key: POLICE_SPRITESHEETS.police_patrolman['jump-rise'], path: 'assets/enemies/police_patrolman/jump.png', frameWidth: 64, frameHeight: 64 },
  { key: POLICE_SPRITESHEETS.police_patrolman.shoot, path: 'assets/enemies/police_patrolman/shoot.png', frameWidth: 64, frameHeight: 64 },
  { key: POLICE_SPRITESHEETS.police_patrolman.reload, path: 'assets/enemies/police_patrolman/reload.png', frameWidth: 64, frameHeight: 64 },
  { key: POLICE_SPRITESHEETS.police_patrolman.hurt, path: 'assets/enemies/police_patrolman/hurt.png', frameWidth: 64, frameHeight: 64 },
  { key: POLICE_SPRITESHEETS.police_patrolman.death, path: 'assets/enemies/police_patrolman/dead.png', frameWidth: 64, frameHeight: 64 },
  { key: POLICE_SPRITESHEETS.policewoman.run, path: 'assets/enemies/policewoman/run.png', frameWidth: 64, frameHeight: 64 },
  { key: POLICE_SPRITESHEETS.policewoman['jump-rise'], path: 'assets/enemies/policewoman/jump.png', frameWidth: 64, frameHeight: 64 },
  { key: POLICE_SPRITESHEETS.policewoman.shoot, path: 'assets/enemies/policewoman/shot.png', frameWidth: 64, frameHeight: 64 },
  { key: POLICE_SPRITESHEETS.policewoman.reload, path: 'assets/enemies/policewoman/recharge.png', frameWidth: 64, frameHeight: 64 },
  { key: POLICE_SPRITESHEETS.policewoman.hurt, path: 'assets/enemies/policewoman/hurt.png', frameWidth: 64, frameHeight: 64 },
  { key: POLICE_SPRITESHEETS.policewoman.death, path: 'assets/enemies/policewoman/dead.png', frameWidth: 64, frameHeight: 64 },
];

const POLICE_ANIMATION_FRAMES: Record<
  PoliceEnemyObjectId,
  Record<PoliceAnimationAction, number[]>
> = {
  [POLICE_PATROLMAN_OBJECT_ID]: {
    idle: [0, 1, 2, 3, 4, 5],
    run: [0, 1, 2, 3, 4, 5, 6, 7],
    'jump-rise': [2],
    'jump-fall': [7],
    shoot: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    reload: [0, 1, 2, 3, 4, 5, 6],
    hurt: [0, 1, 2],
    death: [0, 1, 2, 3],
  },
  [POLICEWOMAN_OBJECT_ID]: {
    idle: [0, 1, 2, 3, 4, 5],
    run: [0, 1, 2, 3, 4, 5, 6, 7],
    'jump-rise': [2],
    'jump-fall': [7],
    shoot: [0, 1, 2, 3],
    reload: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    hurt: [0, 1, 2],
    death: [0, 1, 2, 3],
  },
};

export const POLICE_ENEMY_ANIMATIONS: PoliceEnemyAnimation[] = POLICE_ENEMY_OBJECT_IDS.flatMap(
  (objectId) => {
    const sheets = POLICE_SPRITESHEETS[objectId];
    const frames = POLICE_ANIMATION_FRAMES[objectId];
    return [
      { key: `${objectId}-idle`, spritesheetKey: objectId, frames: frames.idle, frameRate: 6, repeat: -1 },
      { key: `${objectId}-run`, spritesheetKey: sheets.run, frames: frames.run, frameRate: 10, repeat: -1 },
      { key: `${objectId}-jump-rise`, spritesheetKey: sheets['jump-rise'], frames: frames['jump-rise'], frameRate: 1, repeat: -1 },
      { key: `${objectId}-jump-fall`, spritesheetKey: sheets['jump-fall'], frames: frames['jump-fall'], frameRate: 1, repeat: -1 },
      { key: `${objectId}-shoot`, spritesheetKey: sheets.shoot, frames: frames.shoot, frameRate: 18, repeat: 0 },
      { key: `${objectId}-reload`, spritesheetKey: sheets.reload, frames: frames.reload, frameRate: 16, repeat: 0 },
      { key: `${objectId}-hurt`, spritesheetKey: sheets.hurt, frames: frames.hurt, frameRate: 12, repeat: 0 },
      { key: `${objectId}-death`, spritesheetKey: sheets.death, frames: frames.death, frameRate: 10, repeat: 0 },
    ];
  },
);
