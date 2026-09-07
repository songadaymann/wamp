import { describe, expect, it } from 'vitest';
import { simulateWorldGrowth, type WorldGrowthSimulationConfig } from './growthSimulator';

const base: WorldGrowthSimulationConfig = {
  worldCount: 2,
  dailyActiveBuildersPerWorld: 4,
  claimsPerBuilderPerDay: 2,
  directionalBias: 0.4,
  maxDays: 2_000,
  trials: 12,
  seed: 129,
};

describe('World growth simulator', () => {
  it('is deterministic for a fixed seed and configuration', () => {
    expect(simulateWorldGrowth(base)).toEqual(simulateWorldGrowth(base));
  });

  it('never collides when only one World exists', () => {
    const result = simulateWorldGrowth({ ...base, worldCount: 1 });
    expect(result.collisions).toBe(0);
    expect(result.censored).toBe(base.trials);
    expect(result.medianDays).toBeNull();
    expect(result.p25Days).toBeNull();
    expect(result.p90Days).toBeNull();
  });

  it('reports percentile collision times for a strongly directed pair', () => {
    const result = simulateWorldGrowth({ ...base, directionalBias: 1, maxDays: 100 });
    expect(result.collisions).toBe(base.trials);
    expect(result.medianDays).not.toBeNull();
    expect(result.p90Days).toBeGreaterThanOrEqual(result.medianDays ?? 0);
  });
});
