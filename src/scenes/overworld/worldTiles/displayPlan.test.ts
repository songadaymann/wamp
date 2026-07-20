import { describe, expect, it } from 'vitest';
import type { WorldTileAvailability } from './coverage';
import { getWorldTileChildren } from './geometry';
import {
  isWorldTileTargetReplacementComplete,
  resolveWorldTileDisplayPlan,
  shouldUseWorldTileBrowseCutover,
} from './displayPlan';
import { WorldTileFallbackController } from './retryFallback';
import { worldTileAddressKey, type WorldTileAddress } from './types';

describe('world tile display plan', () => {
  it('retains the parent until a complete four-child sibling group is GPU-ready', () => {
    const parent = address('current', 3, 0, 0);
    const target = getWorldTileChildren(parent)[0];
    const children = getWorldTileChildren(parent);
    const availability = new Map<string, WorldTileAvailability>([
      [worldTileAddressKey(parent), ready()],
      ...children.slice(0, 3).map((child) => [worldTileAddressKey(child), ready()] as const),
      [worldTileAddressKey(children[3]), { state: 'pending' }],
    ]);
    const parentFallback = resolveWorldTileDisplayPlan({ targets: [target], availabilityByKey: availability });
    expect(parentFallback)
      .toMatchObject({ displayImageKeys: [worldTileAddressKey(parent)], uncoveredTargetKeys: [] });
    expect(isWorldTileTargetReplacementComplete(parentFallback)).toBe(false);

    availability.set(worldTileAddressKey(children[3]), { state: 'ready-empty' });
    const targetReplacement = resolveWorldTileDisplayPlan({ targets: [target], availabilityByKey: availability });
    expect(targetReplacement.displayImageKeys)
      .toEqual(children.slice(0, 3).map(worldTileAddressKey).sort());
    expect(isWorldTileTargetReplacementComplete(targetReplacement)).toBe(true);
  });

  it('retains previous-renderer imagery until the active renderer has complete coverage', () => {
    const current = address('current', 0, 0, 0);
    const previous = address('previous', 0, 0, 0);
    const plan = resolveWorldTileDisplayPlan({
      targets: [current],
      availabilityByKey: new Map([[worldTileAddressKey(previous), ready()]]),
      previousRendererVersion: 'previous',
    });
    expect(plan.displayImageKeys).toEqual([worldTileAddressKey(previous)]);
    expect(plan.fallbackKeys).toEqual([worldTileAddressKey(previous)]);
  });

  it('keeps tiled browse active through a transient uncovered pan', () => {
    const base = {
      rolloutEnabled: true,
      shadow: false,
      browse: true,
    };
    const fallback = new WorldTileFallbackController();

    expect(shouldUseWorldTileBrowseCutover({
      ...base,
      coarseCoverageComplete: false,
      fallbackActive: fallback.snapshot().active,
    })).toBe(false);

    fallback.markCoverageIncomplete(1_000);
    expect(shouldUseWorldTileBrowseCutover({
      ...base,
      coarseCoverageComplete: true,
      fallbackActive: fallback.snapshot().active,
    })).toBe(true);

    fallback.evaluate(10_999);
    expect(shouldUseWorldTileBrowseCutover({
      ...base,
      coarseCoverageComplete: true,
      fallbackActive: fallback.snapshot().active,
    })).toBe(true);

    fallback.evaluate(11_000);
    expect(shouldUseWorldTileBrowseCutover({
      ...base,
      coarseCoverageComplete: true,
      fallbackActive: fallback.snapshot().active,
    })).toBe(false);
  });

  it('returns to compact imagery only after the critical-failure threshold', () => {
    const fallback = new WorldTileFallbackController();
    fallback.markCoverageIncomplete(0);
    const isCutoverActive = () => shouldUseWorldTileBrowseCutover({
      rolloutEnabled: true,
      shadow: false,
      browse: true,
      coarseCoverageComplete: true,
      fallbackActive: fallback.snapshot().active,
    });

    expect(isCutoverActive()).toBe(true);
    fallback.recordCriticalFailure(100);
    expect(isCutoverActive()).toBe(true);
    fallback.recordCriticalFailure(200);
    expect(isCutoverActive()).toBe(true);
    fallback.recordCriticalFailure(300);
    expect(isCutoverActive()).toBe(false);
  });
});

function ready(): WorldTileAvailability {
  return { state: 'ready-image', decoded: true, gpuReady: true };
}

function address(
  rendererVersion: string,
  level: 0 | 1 | 2 | 3 | 4,
  x: number,
  y: number,
): WorldTileAddress {
  return { rendererVersion, level, x, y };
}
