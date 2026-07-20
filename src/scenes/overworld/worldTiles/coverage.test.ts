import { describe, expect, it } from 'vitest';
import {
  planWorldTileSiblingReplacement,
  resolveVisibleWorldTileCoverage,
  type WorldTileAvailability,
} from './coverage';
import { getWorldTileChildren } from './geometry';
import { worldTileAddressKey, type WorldTileAddress } from './types';

describe('world tile replacement coverage', () => {
  it('retains a parent until every child is decoded and GPU-ready or empty', () => {
    const parent = address(3, 0, 0);
    const children = getWorldTileChildren(parent);
    const availability = new Map<string, WorldTileAvailability>([
      [worldTileAddressKey(children[0]), readyImage()],
      [worldTileAddressKey(children[1]), readyImage()],
      [worldTileAddressKey(children[2]), readyImage()],
      [worldTileAddressKey(children[3]), { state: 'pending' }],
    ]);

    expect(planWorldTileSiblingReplacement({
      parent,
      availabilityByKey: availability,
      parentIsAttached: true,
    })).toMatchObject({
      canCommit: false,
      keepParent: true,
      attachChildKeys: [],
      detachKeys: [],
      missingChildKeys: [worldTileAddressKey(children[3])],
    });

    availability.set(worldTileAddressKey(children[3]), { state: 'ready-empty' });
    expect(planWorldTileSiblingReplacement({
      parent,
      availabilityByKey: availability,
      parentIsAttached: true,
    })).toMatchObject({
      canCommit: true,
      keepParent: false,
      attachChildKeys: children.slice(0, 3).map(worldTileAddressKey),
      readyEmptyChildKeys: [worldTileAddressKey(children[3])],
      detachKeys: [worldTileAddressKey(parent)],
    });
  });

  it('does not count decoded-but-not-uploaded imagery as displayable', () => {
    const parent = address(3, 0, 0);
    const children = getWorldTileChildren(parent);
    const availability = new Map<string, WorldTileAvailability>(
      children.map((child) => [worldTileAddressKey(child), readyImage()]),
    );
    availability.set(worldTileAddressKey(children[1]), {
      state: 'ready-image',
      decoded: true,
      gpuReady: false,
    });

    expect(planWorldTileSiblingReplacement({
      parent,
      availabilityByKey: availability,
      parentIsAttached: true,
    }).canCommit).toBe(false);
  });

  it('uses the nearest displayable ancestor as coverage without detaching it', () => {
    const firstTarget = address(4, 0, 0);
    const secondTarget = address(4, 1, 0);
    const parent = address(3, 0, 0);
    const result = resolveVisibleWorldTileCoverage({
      visibleTargets: [firstTarget, secondTarget],
      availabilityByKey: new Map([
        [worldTileAddressKey(firstTarget), { state: 'pending' }],
        [worldTileAddressKey(secondTarget), readyImage(true)],
        [worldTileAddressKey(parent), readyImage()],
      ]),
    });

    expect(result).toEqual({
      visibleCount: 2,
      coveredCount: 2,
      staleCount: 1,
      coveragePercentage: 100,
      fallbackKeys: [worldTileAddressKey(parent)],
      uncoveredKeys: [],
    });
  });

  it('reports a true coverage gap when neither target nor ancestors are ready', () => {
    const target = address(4, -1, -1);
    expect(resolveVisibleWorldTileCoverage({
      visibleTargets: [target],
      availabilityByKey: new Map(),
    })).toMatchObject({
      coveredCount: 0,
      coveragePercentage: 0,
      uncoveredKeys: [worldTileAddressKey(target)],
    });
  });
});

function address(level: 0 | 1 | 2 | 3 | 4, x: number, y: number): WorldTileAddress {
  return { rendererVersion: 'renderer-v1', level, x, y };
}

function readyImage(stale: boolean = false): WorldTileAvailability {
  return { state: 'ready-image', decoded: true, gpuReady: true, stale };
}
