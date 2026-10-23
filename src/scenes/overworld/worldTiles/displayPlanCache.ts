import type { WorldTileAvailability } from './coverage';
import {
  isWorldTileTargetReplacementComplete,
  resolveWorldTileDisplayPlan,
  type WorldTileDisplayPlan,
} from './displayPlan';
import type { WorldTileAddress } from './types';

/** Availability map whose revision changes on every write, so plans built from it can be reused. */
export class WorldTileAvailabilityMap extends Map<string, WorldTileAvailability> {
  private writes = 0;

  get revision(): number {
    return this.writes;
  }

  override set(key: string, value: WorldTileAvailability): this {
    this.writes += 1;
    return super.set(key, value);
  }

  override delete(key: string): boolean {
    const deleted = super.delete(key);
    if (deleted) this.writes += 1;
    return deleted;
  }

  override clear(): void {
    if (this.size > 0) this.writes += 1;
    super.clear();
  }
}

interface CachedDisplayPlan {
  availabilityRevision: number;
  previousRendererVersion: string | null;
  plan: WorldTileDisplayPlan;
  replacementCompleteTargetCount: number | null;
}

/**
 * Reuses display plans while their target array, the availability map and the
 * previous renderer are unchanged. Coverage target arrays keep their identity
 * while the camera's tile bounds hold still, so idle frames skip replanning.
 * Callers must treat the returned plans as read-only.
 */
export class WorldTileDisplayPlanCache {
  private readonly plans = new WeakMap<readonly WorldTileAddress[], CachedDisplayPlan>();

  constructor(
    private readonly availabilityByKey: WorldTileAvailabilityMap,
    private readonly getPreviousRendererVersion: () => string | null,
  ) {}

  resolve(targets: readonly WorldTileAddress[]): WorldTileDisplayPlan {
    return this.resolveCached(targets).plan;
  }

  /** Counts the targets whose single-target plan is replacement-complete. */
  countReplacementCompleteTargets(targets: readonly WorldTileAddress[]): number {
    const cached = this.resolveCached(targets);
    cached.replacementCompleteTargetCount ??= targets.filter((target) => (
      isWorldTileTargetReplacementComplete(resolveWorldTileDisplayPlan({
        targets: [target],
        availabilityByKey: this.availabilityByKey,
        previousRendererVersion: cached.previousRendererVersion,
      }))
    )).length;
    return cached.replacementCompleteTargetCount;
  }

  private resolveCached(targets: readonly WorldTileAddress[]): CachedDisplayPlan {
    const availabilityRevision = this.availabilityByKey.revision;
    const previousRendererVersion = this.getPreviousRendererVersion();
    const cached = this.plans.get(targets);
    if (
      cached
      && cached.availabilityRevision === availabilityRevision
      && cached.previousRendererVersion === previousRendererVersion
    ) return cached;
    const next: CachedDisplayPlan = {
      availabilityRevision,
      previousRendererVersion,
      plan: resolveWorldTileDisplayPlan({
        targets,
        availabilityByKey: this.availabilityByKey,
        previousRendererVersion,
      }),
      replacementCompleteTargetCount: null,
    };
    this.plans.set(targets, next);
    return next;
  }
}
