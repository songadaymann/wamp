import { describe, expect, it } from 'vitest';
import { buildLaneSummary, levelForXp } from './shared';

describe('progression summaries', () => {
  it('keeps level and progress boundaries internally consistent', () => {
    for (const xp of [0, 1, 99, 100, 999, 10_000]) {
      const summary = buildLaneSummary('player', xp);
      expect(summary.level).toBe(levelForXp(xp));
      expect(summary.currentLevelStartXp).toBeLessThanOrEqual(xp);
      expect(summary.nextLevelXp).toBeGreaterThan(summary.currentLevelStartXp);
      expect(summary.progressFraction).toBeGreaterThanOrEqual(0);
      expect(summary.progressFraction).toBeLessThanOrEqual(1);
    }
  });
});
