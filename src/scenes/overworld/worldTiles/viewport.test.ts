import { describe, expect, it } from 'vitest';
import {
  calculateDirectionalGuardRect,
  calculateWorldTileViewportCoverage,
  clampWorldTileManifestBounds,
  getWorldTileSiblingClosure,
  selectWorldTileBoundedDisplayLevel,
  worldTileBoundsFitWithinManifestLimit,
} from './viewport';
import { worldRectToTileBounds } from './geometry';
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

  it('clamps extreme directional guard projection to 16x16 while retaining the visible cover', () => {
    expect(clampWorldTileManifestBounds({
      visible: { minTileX: -2, maxTileX: 1, minTileY: -1, maxTileY: 1 },
      guard: { minTileX: -40, maxTileX: 80, minTileY: -60, maxTileY: 70 },
    })).toEqual({ minTileX: -2, maxTileX: 13, minTileY: -3, maxTileY: 12 });
  });

  it('bridges a rapid zoom-out to the finest display level that still fits the manifest bound', () => {
    const viewport = {
      left: -8_000,
      right: 8_000,
      top: -4_400,
      bottom: 4_400,
    };

    const level = selectWorldTileBoundedDisplayLevel({
      viewport,
      committedLevel: 4,
      desiredLevel: 0,
    });

    expect(level).toBe(3);
    expect(worldTileBoundsFitWithinManifestLimit(
      worldRectToTileBounds(level, viewport),
    )).toBe(true);
    expect(worldTileBoundsFitWithinManifestLimit(
      worldRectToTileBounds(4, viewport),
    )).toBe(false);
  });

  it('keeps the committed display level when the viewport already fits', () => {
    expect(selectWorldTileBoundedDisplayLevel({
      viewport: { left: -640, right: 640, top: -352, bottom: 352 },
      committedLevel: 4,
      desiredLevel: 0,
    })).toBe(4);
  });
});

function address(level: 0 | 1 | 2 | 3 | 4, x: number, y: number): WorldTileAddress {
  return { rendererVersion: 'renderer-v1', level, x, y };
}
