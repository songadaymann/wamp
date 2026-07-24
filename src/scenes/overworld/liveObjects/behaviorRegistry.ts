import { GHOST_OBJECT_ID } from '../../../enemies/ghost';
import { SWORDSMAN_AI_OBJECT_ID } from '../../../enemies/swordsmanAi';
import { JIMOTHY_OBJECT_ID } from '../../../npcs/model';

type FlyingEnemySettingKey = 'bat' | 'bird';

export interface FlyingEnemyBehavior {
  kind: 'flyingEnemy';
  speedSetting: FlyingEnemySettingKey;
  speedMultiplier?: number;
  waveAmplitudeSetting?: FlyingEnemySettingKey;
  waveAmplitude?: number;
  waveSpeedSetting?: FlyingEnemySettingKey;
  waveSpeed?: number;
}

export type LiveObjectBehavior =
  | FlyingEnemyBehavior
  | { kind: 'patrolEnemy' }
  | { kind: 'swordsman' }
  | { kind: 'frog' }
  | { kind: 'cannon' }
  | { kind: 'travelingProjectile' }
  | { kind: 'bomb' }
  | { kind: 'lightning' }
  | { kind: 'bouncePad' }
  | { kind: 'movingPlatform' }
  | { kind: 'blockSwitch' }
  | { kind: 'npc' }
  | { kind: 'none' };

const BEHAVIORS_BY_OBJECT_ID: Record<string, LiveObjectBehavior> = {
  bat: {
    kind: 'flyingEnemy',
    speedSetting: 'bat',
    waveAmplitudeSetting: 'bat',
    waveSpeedSetting: 'bat',
  },
  bird: {
    kind: 'flyingEnemy',
    speedSetting: 'bird',
    waveAmplitudeSetting: 'bird',
    waveSpeedSetting: 'bird',
  },
  [GHOST_OBJECT_ID]: {
    kind: 'flyingEnemy',
    speedSetting: 'bat',
    speedMultiplier: 0.62,
    waveAmplitude: 5,
    waveSpeed: 0.006,
  },
  fish: {
    kind: 'flyingEnemy',
    speedSetting: 'bird',
    speedMultiplier: 0.58,
    waveAmplitude: 3,
    waveSpeed: 0.008,
  },
  shark: {
    kind: 'flyingEnemy',
    speedSetting: 'bird',
    speedMultiplier: 0.82,
    waveAmplitude: 3,
    waveSpeed: 0.006,
  },
  crab: { kind: 'patrolEnemy' },
  slime_blue: { kind: 'patrolEnemy' },
  slime_red: { kind: 'patrolEnemy' },
  snake: { kind: 'patrolEnemy' },
  penguin: { kind: 'patrolEnemy' },
  bear_brown: { kind: 'patrolEnemy' },
  bear_polar: { kind: 'patrolEnemy' },
  chicken: { kind: 'patrolEnemy' },
  [SWORDSMAN_AI_OBJECT_ID]: { kind: 'swordsman' },
  [JIMOTHY_OBJECT_ID]: { kind: 'npc' },
  frog: { kind: 'frog' },
  cannon: { kind: 'cannon' },
  cannon_bullet: { kind: 'travelingProjectile' },
  fireball: { kind: 'travelingProjectile' },
  bomb: { kind: 'bomb' },
  lightning: { kind: 'lightning' },
  bounce_pad: { kind: 'bouncePad' },
  moving_platform: { kind: 'movingPlatform' },
  block_switch: { kind: 'blockSwitch' },
};

export function getLiveObjectBehavior(objectId: string): LiveObjectBehavior {
  return BEHAVIORS_BY_OBJECT_ID[objectId] ?? { kind: 'none' };
}

export function liveObjectBehaviorUpdatesEveryFrame(behavior: LiveObjectBehavior): boolean {
  return behavior.kind !== 'none';
}

export function liveObjectBehaviorCanSleepAtDistance(behavior: LiveObjectBehavior): boolean {
  return behavior.kind !== 'none'
    && behavior.kind !== 'movingPlatform'
    && behavior.kind !== 'blockSwitch'
    && behavior.kind !== 'bouncePad';
}
