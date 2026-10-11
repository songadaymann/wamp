import { describe, expect, it } from 'vitest';
import { resolveFlyingEnemyMotion } from './flyingEnemyMotion';

const settings = { batSpeed: 40, birdSpeed: 55, batWaveAmplitude: 6, birdWaveAmplitude: 10, batWaveSpeed: 3, birdWaveSpeed: 2 };

describe('flying enemy motion (F012)', () => {
  it('uses the bat or bird settings, the speed multiplier and any explicit wave values', () => {
    expect(resolveFlyingEnemyMotion({ kind: 'flyingEnemy', speedSetting: 'bat' }, settings))
      .toEqual({ speed: 40, waveAmplitude: 6, waveSpeed: 3 });
    expect(resolveFlyingEnemyMotion({ kind: 'flyingEnemy', speedSetting: 'bird', speedMultiplier: 1.5 }, settings))
      .toEqual({ speed: 82.5, waveAmplitude: 10, waveSpeed: 2 });
    expect(resolveFlyingEnemyMotion({ kind: 'flyingEnemy', speedSetting: 'bird', waveAmplitudeSetting: 'bat', waveSpeed: 9 }, settings))
      .toEqual({ speed: 55, waveAmplitude: 6, waveSpeed: 9 });
  });
});
