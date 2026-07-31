import { GHOST_OBJECT_ID } from '../../../enemies/ghost';
import { SWORDSMAN_AI_OBJECT_ID } from '../../../enemies/swordsmanAi';
import { JIMOTHY_OBJECT_ID } from '../../../npcs/model';

type FlyingEnemySettingKey = 'bat' | 'bird';
export type LiveObjectUpdateDelegate =
  | 'flyingEnemy'
  | 'patrolEnemy'
  | 'swordsman'
  | 'frog'
  | 'cannon'
  | 'travelingProjectile'
  | 'bomb'
  | 'lightning'
  | 'bouncePad'
  | 'movingPlatform'
  | 'blockSwitch'
  | 'npc'
  | null;

export type LiveObjectPhysicsCategory =
  | 'enemy'
  | 'npc'
  | 'projectile'
  | 'bouncePad'
  | 'dynamicActor'
  | null;

export interface FlyingEnemyBehavior {
  kind: 'flyingEnemy';
  update: 'flyingEnemy';
  sleepable: true;
  specialTile: false;
  physicsCategory: 'enemy';
  speedSetting: FlyingEnemySettingKey;
  speedMultiplier?: number;
  waveAmplitudeSetting?: FlyingEnemySettingKey;
  waveAmplitude?: number;
  waveSpeedSetting?: FlyingEnemySettingKey;
  waveSpeed?: number;
}

export type LiveObjectBehavior =
  | FlyingEnemyBehavior
  | {
      kind: Exclude<LiveObjectUpdateDelegate, 'flyingEnemy' | null>;
      update: Exclude<LiveObjectUpdateDelegate, 'flyingEnemy' | null>;
      sleepable: boolean;
      specialTile: boolean;
      physicsCategory: LiveObjectPhysicsCategory;
    }
  | {
      kind: 'none';
      update: null;
      sleepable: false;
      specialTile: false;
      physicsCategory: null;
    };

const NO_BEHAVIOR: LiveObjectBehavior = Object.freeze({
  kind: 'none',
  update: null,
  sleepable: false,
  specialTile: false,
  physicsCategory: null,
});

function behavior<TKind extends Exclude<LiveObjectUpdateDelegate, 'flyingEnemy' | null>>(
  kind: TKind,
  metadata: {
    sleepable: boolean;
    specialTile: boolean;
    physicsCategory: LiveObjectPhysicsCategory;
  },
): LiveObjectBehavior {
  return Object.freeze({
    kind,
    update: kind,
    ...metadata,
  }) as LiveObjectBehavior;
}

const BEHAVIORS_BY_OBJECT_ID: Record<string, LiveObjectBehavior> = {
  bat: {
    kind: 'flyingEnemy',
    update: 'flyingEnemy',
    sleepable: true,
    specialTile: false,
    physicsCategory: 'enemy',
    speedSetting: 'bat',
    waveAmplitudeSetting: 'bat',
    waveSpeedSetting: 'bat',
  },
  bird: {
    kind: 'flyingEnemy',
    update: 'flyingEnemy',
    sleepable: true,
    specialTile: false,
    physicsCategory: 'enemy',
    speedSetting: 'bird',
    waveAmplitudeSetting: 'bird',
    waveSpeedSetting: 'bird',
  },
  [GHOST_OBJECT_ID]: {
    kind: 'flyingEnemy',
    update: 'flyingEnemy',
    sleepable: true,
    specialTile: false,
    physicsCategory: 'enemy',
    speedSetting: 'bat',
    speedMultiplier: 0.62,
    waveAmplitude: 5,
    waveSpeed: 0.006,
  },
  fish: {
    kind: 'flyingEnemy',
    update: 'flyingEnemy',
    sleepable: true,
    specialTile: false,
    physicsCategory: 'enemy',
    speedSetting: 'bird',
    speedMultiplier: 0.58,
    waveAmplitude: 3,
    waveSpeed: 0.008,
  },
  shark: {
    kind: 'flyingEnemy',
    update: 'flyingEnemy',
    sleepable: true,
    specialTile: false,
    physicsCategory: 'enemy',
    speedSetting: 'bird',
    speedMultiplier: 0.82,
    waveAmplitude: 3,
    waveSpeed: 0.006,
  },
  crab: behavior('patrolEnemy', { sleepable: true, specialTile: true, physicsCategory: 'enemy' }),
  slime_blue: behavior('patrolEnemy', { sleepable: true, specialTile: true, physicsCategory: 'enemy' }),
  slime_red: behavior('patrolEnemy', { sleepable: true, specialTile: true, physicsCategory: 'enemy' }),
  snake: behavior('patrolEnemy', { sleepable: true, specialTile: true, physicsCategory: 'enemy' }),
  penguin: behavior('patrolEnemy', { sleepable: true, specialTile: true, physicsCategory: 'enemy' }),
  bear_brown: behavior('patrolEnemy', { sleepable: true, specialTile: true, physicsCategory: 'enemy' }),
  bear_polar: behavior('patrolEnemy', { sleepable: true, specialTile: true, physicsCategory: 'enemy' }),
  chicken: behavior('patrolEnemy', { sleepable: true, specialTile: true, physicsCategory: 'enemy' }),
  [SWORDSMAN_AI_OBJECT_ID]: behavior('swordsman', {
    sleepable: true,
    specialTile: true,
    physicsCategory: 'enemy',
  }),
  [JIMOTHY_OBJECT_ID]: behavior('npc', {
    sleepable: true,
    specialTile: true,
    physicsCategory: 'npc',
  }),
  frog: behavior('frog', { sleepable: true, specialTile: true, physicsCategory: 'enemy' }),
  cannon: behavior('cannon', { sleepable: true, specialTile: false, physicsCategory: null }),
  cannon_bullet: behavior('travelingProjectile', {
    sleepable: true,
    specialTile: false,
    physicsCategory: 'projectile',
  }),
  fireball: behavior('travelingProjectile', {
    sleepable: true,
    specialTile: false,
    physicsCategory: 'projectile',
  }),
  bomb: behavior('bomb', { sleepable: true, specialTile: false, physicsCategory: 'dynamicActor' }),
  lightning: behavior('lightning', { sleepable: true, specialTile: false, physicsCategory: null }),
  bounce_pad: behavior('bouncePad', {
    sleepable: false,
    specialTile: false,
    physicsCategory: 'bouncePad',
  }),
  moving_platform: behavior('movingPlatform', {
    sleepable: false,
    specialTile: false,
    physicsCategory: 'dynamicActor',
  }),
  block_switch: behavior('blockSwitch', {
    sleepable: false,
    specialTile: false,
    physicsCategory: null,
  }),
};

export function getLiveObjectBehavior(objectId: string): LiveObjectBehavior {
  return BEHAVIORS_BY_OBJECT_ID[objectId] ?? NO_BEHAVIOR;
}

export function liveObjectBehaviorUpdatesEveryFrame(behavior: LiveObjectBehavior): boolean {
  return behavior.update !== null;
}

export function liveObjectBehaviorCanSleepAtDistance(behavior: LiveObjectBehavior): boolean {
  return behavior.sleepable;
}
