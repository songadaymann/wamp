import type { FlyingEnemyBehavior } from './behaviorRegistry';

export interface FlyingEnemyMotion {
  speed: number;
  waveAmplitude: number;
  waveSpeed: number;
}

export interface FlyingEnemyMotionSettings {
  batSpeed: number;
  birdSpeed: number;
  batWaveAmplitude: number;
  birdWaveAmplitude: number;
  batWaveSpeed: number;
  birdWaveSpeed: number;
}

/** A flying enemy's speed and wave, from its behavior and the bat/bird settings. */
export function resolveFlyingEnemyMotion(
  behavior: FlyingEnemyBehavior,
  settings: FlyingEnemyMotionSettings,
): FlyingEnemyMotion {
  const speedBase = behavior.speedSetting === 'bat' ? settings.batSpeed : settings.birdSpeed;
  const waveAmplitudeSetting = behavior.waveAmplitudeSetting ?? behavior.speedSetting;
  const waveSpeedSetting = behavior.waveSpeedSetting ?? behavior.speedSetting;
  const waveAmplitudeBase = waveAmplitudeSetting === 'bat' ? settings.batWaveAmplitude : settings.birdWaveAmplitude;
  const waveSpeedBase = waveSpeedSetting === 'bat' ? settings.batWaveSpeed : settings.birdWaveSpeed;
  return {
    speed: speedBase * (behavior.speedMultiplier ?? 1),
    waveAmplitude: behavior.waveAmplitude ?? waveAmplitudeBase,
    waveSpeed: behavior.waveSpeed ?? waveSpeedBase,
  };
}
