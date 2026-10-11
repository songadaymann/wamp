import { afterEach, describe, expect, it } from 'vitest';
import { setDevicePerformanceMode } from '../performance/devicePerformanceMode';
import { resolveWeatherFogBandCount, resolveWeatherParticleCount } from './controller';

afterEach(() => { setDevicePerformanceMode('auto'); });

describe('Battery Saver weather (F011)', () => {
  it('draws half the rain, snow and fog when the player picks Battery Saver', () => {
    const rain = { mode: 'rain', intensity: 50 } as const;
    const snow = { mode: 'snow', intensity: 100 } as const;
    const fog = { mode: 'fog', intensity: 50 } as const;
    setDevicePerformanceMode('auto');
    const full = [resolveWeatherParticleCount(rain), resolveWeatherParticleCount(snow), resolveWeatherFogBandCount(fog), resolveWeatherFogBandCount(rain)];
    expect(full).toEqual([82, 100, 19, 3]);
    setDevicePerformanceMode('battery-saver');
    expect([resolveWeatherParticleCount(rain), resolveWeatherParticleCount(snow), resolveWeatherFogBandCount(fog), resolveWeatherFogBandCount(rain)])
      .toEqual([41, 50, 10, 1]);
    setDevicePerformanceMode('full-quality');
    expect(resolveWeatherParticleCount(rain)).toBe(82);
  });

  it('keeps at least one fog band and draws nothing when weather is off', () => {
    setDevicePerformanceMode('battery-saver');
    expect(resolveWeatherFogBandCount({ mode: 'rain', intensity: 0 })).toBe(1);
    expect(resolveWeatherParticleCount({ mode: 'off', intensity: 50 })).toBe(0);
    expect(resolveWeatherFogBandCount({ mode: 'off', intensity: 50 })).toBe(0);
  });
});
