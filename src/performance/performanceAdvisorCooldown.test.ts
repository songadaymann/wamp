import { describe, expect, it, vi } from 'vitest';
import {
  PERFORMANCE_ADVISOR_COOLDOWN_STORAGE_KEY,
  PERFORMANCE_ADVISOR_COOLDOWN_STORAGE_VERSION,
  PERFORMANCE_ADVISOR_DISMISS_COOLDOWN_MS,
  PerformanceAdvisorCooldownStore,
  parsePerformanceAdvisorCooldown,
} from './performanceAdvisorCooldown';

describe('PerformanceAdvisorCooldownStore', () => {
  it('normalizes invalid and obsolete stored values', () => {
    expect(parsePerformanceAdvisorCooldown('invalid')).toBe(0);
    expect(parsePerformanceAdvisorCooldown(JSON.stringify({ version: 0, dismissedUntilMs: 99 })))
      .toBe(0);
    expect(parsePerformanceAdvisorCooldown(JSON.stringify({
      version: PERFORMANCE_ADVISOR_COOLDOWN_STORAGE_VERSION,
      dismissedUntilMs: -1,
    }))).toBe(0);
  });

  it('enforces the exact 24-hour boundary', () => {
    const store = new PerformanceAdvisorCooldownStore(null);
    const dismissedUntilMs = store.dismiss(1_000);
    expect(dismissedUntilMs).toBe(1_000 + PERFORMANCE_ADVISOR_DISMISS_COOLDOWN_MS);
    expect(store.isCoolingDown(dismissedUntilMs - 1)).toBe(true);
    expect(store.isCoolingDown(dismissedUntilMs)).toBe(false);
  });

  it('persists a versioned cooldown and retains it in memory after a write failure', () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => { throw new Error('quota'); }),
    };
    const store = new PerformanceAdvisorCooldownStore(storage);
    store.dismiss(500);
    expect(store.isCoolingDown(501)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(
      PERFORMANCE_ADVISOR_COOLDOWN_STORAGE_KEY,
      expect.stringContaining(`"version":${PERFORMANCE_ADVISOR_COOLDOWN_STORAGE_VERSION}`),
    );
  });
});
