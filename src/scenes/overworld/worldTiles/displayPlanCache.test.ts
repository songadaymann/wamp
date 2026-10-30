import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldTileAvailability } from './coverage';
import * as displayPlan from './displayPlan';
import { WorldTileAvailabilityMap, WorldTileDisplayPlanCache } from './displayPlanCache';
import { enumerateWorldTileBounds, getWorldTileParent } from './geometry';
import { worldTileAddressKey, type WorldTileAddress } from './types';

vi.mock('./displayPlan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./displayPlan')>();
  return { ...actual, resolveWorldTileDisplayPlan: vi.fn(actual.resolveWorldTileDisplayPlan) };
});

const { resolveWorldTileDisplayPlan, isWorldTileTargetReplacementComplete } = await vi.importActual<
  typeof import('./displayPlan')
>('./displayPlan');
const planSpy = vi.mocked(displayPlan.resolveWorldTileDisplayPlan);

const STATES: readonly WorldTileAvailability[] = [
  { state: 'pending' },
  { state: 'failed' },
  { state: 'ready-empty' },
  { state: 'ready-image', decoded: true, gpuReady: true },
  { state: 'ready-image', decoded: true, gpuReady: true, stale: true },
  { state: 'ready-image', decoded: false, gpuReady: false },
];

function freshPlan(
  targets: readonly WorldTileAddress[],
  availabilityByKey: ReadonlyMap<string, WorldTileAvailability>,
  previousRendererVersion: string | null,
) {
  return resolveWorldTileDisplayPlan({ targets, availabilityByKey, previousRendererVersion });
}

function freshReadyCount(
  targets: readonly WorldTileAddress[],
  availabilityByKey: ReadonlyMap<string, WorldTileAvailability>,
  previousRendererVersion: string | null,
): number {
  return targets.filter((target) => isWorldTileTargetReplacementComplete(
    freshPlan([target], availabilityByKey, previousRendererVersion),
  )).length;
}

function ancestry(targets: readonly WorldTileAddress[], rendererVersions: readonly string[]): string[] {
  const keys = new Set<string>();
  for (const target of targets) {
    for (let address: WorldTileAddress | null = target; address; address = getWorldTileParent(address)) {
      for (const rendererVersion of rendererVersions) keys.add(worldTileAddressKey({ ...address, rendererVersion }));
    }
  }
  return [...keys];
}

/** Small deterministic PRNG so the equivalence sweep is reproducible. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe('world tile availability map', () => {
  it('advances its revision on every write and only on writes', () => {
    const map = new WorldTileAvailabilityMap();
    expect(map.revision).toBe(0);
    map.set('a', { state: 'pending' });
    map.set('a', { state: 'ready-empty' });
    expect(map.revision).toBe(2);
    map.get('a');
    map.has('a');
    expect(map.delete('missing')).toBe(false);
    expect(map.revision).toBe(2);
    expect(map.delete('a')).toBe(true);
    expect(map.revision).toBe(3);
    map.clear();
    expect(map.revision).toBe(3);
    map.set('b', { state: 'failed' });
    map.clear();
    expect(map.revision).toBe(5);
    expect(map.size).toBe(0);
  });
});

describe('world tile display plan cache', () => {
  const targets = enumerateWorldTileBounds('current', 3, { minTileX: 0, maxTileX: 3, minTileY: 0, maxTileY: 2 });
  let availability: WorldTileAvailabilityMap;
  let previousRendererVersion: string | null;
  let cache: WorldTileDisplayPlanCache;

  beforeEach(() => {
    planSpy.mockClear();
    availability = new WorldTileAvailabilityMap();
    for (const key of ancestry(targets, ['current'])) availability.set(key, { state: 'ready-empty' });
    previousRendererVersion = null;
    cache = new WorldTileDisplayPlanCache(availability, () => previousRendererVersion);
  });

  it('skips replanning while the targets and availability are unchanged', () => {
    const first = cache.resolve(targets);
    const firstCount = cache.countReplacementCompleteTargets(targets);
    planSpy.mockClear();

    for (let frame = 0; frame < 60; frame += 1) {
      expect(cache.resolve(targets)).toBe(first);
      expect(cache.countReplacementCompleteTargets(targets)).toBe(firstCount);
    }

    expect(planSpy).not.toHaveBeenCalled();
    expect(first).toEqual(freshPlan(targets, availability, null));
    expect(firstCount).toBe(freshReadyCount(targets, availability, null));
  });

  it('replans after an availability write, a renderer change, or new targets', () => {
    const first = cache.resolve(targets);
    const firstKey = worldTileAddressKey(targets[0]!);

    availability.set(firstKey, { state: 'pending' });
    const afterWrite = cache.resolve(targets);
    expect(afterWrite).not.toBe(first);
    expect(afterWrite).toEqual(freshPlan(targets, availability, null));
    expect(cache.countReplacementCompleteTargets(targets)).toBe(freshReadyCount(targets, availability, null));

    // A tile only the previous renderer has drawn is covered once that renderer is known.
    const lonely = enumerateWorldTileBounds('current', 0, { minTileX: 40, maxTileX: 40, minTileY: 40, maxTileY: 40 });
    availability.set(worldTileAddressKey({ ...lonely[0]!, rendererVersion: 'previous' }), {
      state: 'ready-image', decoded: true, gpuReady: true,
    });
    expect(cache.resolve(lonely).uncoveredTargetKeys).toHaveLength(1);
    previousRendererVersion = 'previous';
    const afterRenderer = cache.resolve(lonely);
    expect(afterRenderer).toEqual(freshPlan(lonely, availability, 'previous'));
    expect(afterRenderer.uncoveredTargetKeys).toHaveLength(0);
    expect(afterRenderer.fallbackKeys).toHaveLength(1);

    const moved = enumerateWorldTileBounds('current', 3, { minTileX: 1, maxTileX: 4, minTileY: 0, maxTileY: 2 });
    planSpy.mockClear();
    expect(cache.resolve(moved)).toEqual(freshPlan(moved, availability, 'previous'));
    expect(planSpy).toHaveBeenCalledOnce();
  });

  it('matches fresh plans and per-target ready counts across random availability changes', () => {
    const random = createRandom(306);
    const guard = enumerateWorldTileBounds('current', 3, { minTileX: -1, maxTileX: 4, minTileY: -1, maxTileY: 3 });
    const keys = ancestry(guard, ['current', 'previous']);

    for (let step = 0; step < 400; step += 1) {
      const roll = random();
      if (roll < 0.6) {
        availability.set(keys[Math.floor(random() * keys.length)]!, STATES[Math.floor(random() * STATES.length)]!);
      } else if (roll < 0.75) {
        availability.delete(keys[Math.floor(random() * keys.length)]!);
      } else if (roll < 0.8) {
        previousRendererVersion = previousRendererVersion ? null : 'previous';
      }
      // Remaining steps are idle frames that must reuse the cached answer.
      for (const list of [targets, guard]) {
        expect(cache.resolve(list)).toEqual(freshPlan(list, availability, previousRendererVersion));
        expect(cache.countReplacementCompleteTargets(list))
          .toBe(freshReadyCount(list, availability, previousRendererVersion));
      }
    }
  });
});
