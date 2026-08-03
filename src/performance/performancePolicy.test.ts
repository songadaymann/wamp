import { describe, expect, it } from 'vitest';
import { resolvePerformancePolicy } from './performancePolicy';

describe('resolvePerformancePolicy', () => {
  it('preserves automatic device and room-pressure decisions', () => {
    expect(resolvePerformancePolicy({
      selectedMode: 'auto',
      deviceProfile: 'default',
      localPlayPressure: 'normal',
    })).toMatchObject({
      visualDataProfile: 'default',
      activeRuntimeProfile: 'default',
      memoryProfile: 'default',
      source: 'automatic',
    });
    expect(resolvePerformancePolicy({
      selectedMode: 'auto',
      deviceProfile: 'default',
      localPlayPressure: 'reduced',
    })).toMatchObject({
      visualDataProfile: 'reduced',
      activeRuntimeProfile: 'reduced',
      memoryProfile: 'default',
      reason: 'automatic-room-pressure',
    });
  });

  it('separates Battery Saver visual/runtime work from memory capability', () => {
    expect(resolvePerformancePolicy({
      selectedMode: 'battery-saver',
      deviceProfile: 'default',
    })).toMatchObject({
      visualDataProfile: 'reduced',
      activeRuntimeProfile: 'reduced',
      memoryProfile: 'default',
      reason: 'user-battery-saver',
    });
  });

  it('lets Full Quality enrich visuals without defeating runtime or memory safety', () => {
    expect(resolvePerformancePolicy({
      selectedMode: 'full-quality',
      deviceProfile: 'reduced',
      localPlayPressure: 'reduced',
    })).toMatchObject({
      visualDataProfile: 'default',
      activeRuntimeProfile: 'reduced',
      memoryProfile: 'reduced',
      reason: 'safety-room-pressure',
      source: 'safety',
    });
    expect(resolvePerformancePolicy({
      selectedMode: 'full-quality',
      deviceProfile: 'reduced',
      localPlayPressure: 'normal',
    })).toMatchObject({
      visualDataProfile: 'default',
      activeRuntimeProfile: 'reduced',
      memoryProfile: 'reduced',
      reason: 'safety-device-profile',
      source: 'safety',
    });
  });

  it('marks seam preparation independently of the selected quality mode', () => {
    expect(resolvePerformancePolicy({
      selectedMode: 'battery-saver',
      deviceProfile: 'reduced',
      seamPreparationUrgent: true,
    }).transitionUrgency).toBe('seam-critical');
  });
});
