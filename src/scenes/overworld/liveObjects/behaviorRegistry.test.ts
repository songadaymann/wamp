import { describe, expect, it } from 'vitest';
import {
  getLiveObjectBehavior,
  liveObjectBehaviorCanSleepAtDistance,
  liveObjectBehaviorUpdatesEveryFrame,
} from './behaviorRegistry';

describe('live-object behavior registry', () => {
  it('classifies behavior update ownership and physics metadata', () => {
    const flyingEnemy = getLiveObjectBehavior('bat');
    const projectile = getLiveObjectBehavior('cannon_bullet');
    const movingPlatform = getLiveObjectBehavior('moving_platform');

    expect(flyingEnemy).toMatchObject({
      update: 'flyingEnemy',
      sleepable: true,
      specialTile: false,
      physicsCategory: 'enemy',
    });
    expect(projectile).toMatchObject({
      update: 'travelingProjectile',
      physicsCategory: 'projectile',
    });
    expect(movingPlatform).toMatchObject({
      update: 'movingPlatform',
      sleepable: false,
      physicsCategory: 'dynamicActor',
    });
  });

  it('returns one static no-op behavior for unregistered objects', () => {
    const first = getLiveObjectBehavior('sign_post');
    const second = getLiveObjectBehavior('unknown-object');

    expect(first).toBe(second);
    expect(liveObjectBehaviorUpdatesEveryFrame(first)).toBe(false);
    expect(liveObjectBehaviorCanSleepAtDistance(first)).toBe(false);
  });
});
