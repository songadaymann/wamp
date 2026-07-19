import { describe, expect, it, vi } from 'vitest';
import {
  clearWorldReplacementCoverage,
  getWorldReplacementCoverageState,
  publishWorldReplacementCoverageReady,
  type WorldReplacementCoverageEventTarget,
} from './worldReplacementCoverage';

describe('world replacement coverage state', () => {
  it('publishes a readable keyed state before notifying listeners', () => {
    const target = createTarget();
    target.dispatchEvent = vi.fn(() => {
      expect(getWorldReplacementCoverageState(target)?.key).toBe('tiled:7');
      return true;
    });

    expect(publishWorldReplacementCoverageReady({
      schemaVersion: 1,
      key: 'tiled:7',
      source: 'tiled',
      generation: 7,
      readyAtMs: 123,
    }, target)).toBe(true);
    expect(target.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'wamp:world-tiles-replacement-ready',
    }));
  });

  it('does not let a stale owner clear a newer replacement', () => {
    const target = createTarget();
    publishWorldReplacementCoverageReady({
      schemaVersion: 1,
      key: 'compact:4',
      source: 'compact',
      generation: 4,
      readyAtMs: 100,
    }, target);
    publishWorldReplacementCoverageReady({
      schemaVersion: 1,
      key: 'tiled:9',
      source: 'tiled',
      generation: 9,
      readyAtMs: 200,
    }, target);

    expect(clearWorldReplacementCoverage('compact:4', target)).toBe(false);
    expect(getWorldReplacementCoverageState(target)?.key).toBe('tiled:9');
    expect(clearWorldReplacementCoverage('tiled:9', target)).toBe(true);
    expect(getWorldReplacementCoverageState(target)).toBeNull();
  });
});

function createTarget(): WorldReplacementCoverageEventTarget {
  return {
    dispatchEvent: vi.fn(() => true),
    __wampWorldReplacementCoverage: null,
  };
}
