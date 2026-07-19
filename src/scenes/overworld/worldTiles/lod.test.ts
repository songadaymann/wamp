import { describe, expect, it } from 'vitest';
import {
  canCommitWorldTileLevel,
  getInitialWorldTileLevel,
  selectWorldTileLevel,
} from './lod';

describe('world tile LOD selection', () => {
  it('selects the initial five zoom bands', () => {
    expect(getInitialWorldTileLevel(0.08)).toBe(0);
    expect(getInitialWorldTileLevel(0.0999)).toBe(0);
    expect(getInitialWorldTileLevel(0.1)).toBe(1);
    expect(getInitialWorldTileLevel(0.1999)).toBe(1);
    expect(getInitialWorldTileLevel(0.2)).toBe(2);
    expect(getInitialWorldTileLevel(0.4)).toBe(3);
    expect(getInitialWorldTileLevel(0.8)).toBe(4);
  });

  it('does not oscillate while zoom moves between 0.17 and 0.18', () => {
    let level = selectWorldTileLevel(0.17, null).level;
    expect(level).toBe(1);
    for (const zoom of [0.18, 0.17, 0.18, 0.17, 0.18]) {
      const decision = selectWorldTileLevel(zoom, level);
      expect(decision).toEqual({ level: 1, changed: false });
      level = decision.level;
    }
  });

  it('uses separate promotion and demotion thresholds', () => {
    expect(selectWorldTileLevel(0.107, 0)).toEqual({ level: 0, changed: false });
    expect(selectWorldTileLevel(0.108, 0)).toEqual({ level: 1, changed: true });
    expect(selectWorldTileLevel(0.093, 1)).toEqual({ level: 1, changed: false });
    expect(selectWorldTileLevel(0.092, 1)).toEqual({ level: 0, changed: true });

    expect(selectWorldTileLevel(0.215, 1)).toEqual({ level: 1, changed: false });
    expect(selectWorldTileLevel(0.216, 1)).toEqual({ level: 2, changed: true });
    expect(selectWorldTileLevel(0.185, 2)).toEqual({ level: 2, changed: false });
    expect(selectWorldTileLevel(0.184, 2)).toEqual({ level: 1, changed: true });
  });

  it('can cross multiple bands after a large wheel or pinch jump', () => {
    expect(selectWorldTileLevel(1, 0)).toEqual({ level: 4, changed: true });
    expect(selectWorldTileLevel(0.08, 4)).toEqual({ level: 0, changed: true });
  });

  it('commits a replacement only after 80 ms idle and complete coverage', () => {
    expect(canCommitWorldTileLevel({
      nowMs: 179,
      lastGestureAtMs: 100,
      replacementCoverageComplete: true,
    })).toBe(false);
    expect(canCommitWorldTileLevel({
      nowMs: 180,
      lastGestureAtMs: 100,
      replacementCoverageComplete: false,
    })).toBe(false);
    expect(canCommitWorldTileLevel({
      nowMs: 180,
      lastGestureAtMs: 100,
      replacementCoverageComplete: true,
    })).toBe(true);
  });
});
