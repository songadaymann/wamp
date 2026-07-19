import { describe, expect, it } from 'vitest';
import {
  calculateDirectionalGuardRect,
  calculateWorldTileViewportCoverage,
  getWorldTileSiblingClosure,
} from './viewport';
import type { WorldTileAddress } from './types';

describe('world tile viewport coverage', () => {
  it('extends 25% around the viewport and 50% plus projection toward movement', () => {
    expect(calculateDirectionalGuardRect({
      viewport: { left: 0, top: 0, right: 640, bottom: 352 },
      velocity: { x: 100, y: -40 },
    })).toEqual({
      left: -160,
      right: 1_145,
      top: -274,
      bottom: 440,
    });
  });

  it('adds sibling and all-level ancestor closure around a visible leaf', () => {
    const result = calculateWorldTileViewportCoverage({
      rendererVersion: 'renderer-v1',
      level: 4,
      viewport: { left: 0, top: 0, right: 640, bottom: 352 },
      velocity: { x: 0, y: 0 },
    });

    expect(result.visibleTiles).toEqual([address(4, 0, 0)]);
    expect(result.siblingClosure).toEqual([
      address(4, 1, 0),
      address(4, 0, 1),
      address(4, 1, 1),
    ]);
    expect(result.ancestorClosure.map((entry) => entry.level)).toEqual([0, 1, 2, 3]);
  });

  it('calculates sibling closure correctly across negative coordinates', () => {
    expect(getWorldTileSiblingClosure([address(4, -1, -1)])).toEqual([
      address(4, -2, -2),
      address(4, -1, -2),
      address(4, -2, -1),
    ]);
  });
});

function address(level: 0 | 1 | 2 | 3 | 4, x: number, y: number): WorldTileAddress {
  return { rendererVersion: 'renderer-v1', level, x, y };
}
