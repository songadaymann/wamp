export const WORLD_TILE_RETRY_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000] as const;
export const WORLD_TILE_CRITICAL_FAILURE_LIMIT = 3;
export const WORLD_TILE_COVERAGE_TIMEOUT_MS = 10_000;

export type WorldTileFallbackReason =
  | 'manifest-incompatible'
  | 'critical-failures'
  | 'coverage-timeout';

export interface WorldTileFallbackSnapshot {
  active: boolean;
  reason: WorldTileFallbackReason | null;
  criticalFailures: number;
  coverageIncompleteSinceMs: number | null;
}

export function getWorldTileRetryDelayMs(failureCount: number): number {
  if (!Number.isSafeInteger(failureCount) || failureCount <= 0) {
    throw new RangeError('Failure count must be a positive safe integer.');
  }
  return WORLD_TILE_RETRY_DELAYS_MS[
    Math.min(failureCount - 1, WORLD_TILE_RETRY_DELAYS_MS.length - 1)
  ];
}

export class WorldTileFallbackController {
  private reason: WorldTileFallbackReason | null = null;
  private criticalFailures = 0;
  private coverageIncompleteSinceMs: number | null = null;

  markCoverageIncomplete(nowMs: number): WorldTileFallbackSnapshot {
    assertNow(nowMs);
    this.coverageIncompleteSinceMs ??= nowMs;
    this.evaluate(nowMs);
    return this.snapshot();
  }

  markCoverageComplete(): WorldTileFallbackSnapshot {
    this.coverageIncompleteSinceMs = null;
    this.criticalFailures = 0;
    return this.snapshot();
  }

  recordCriticalFailure(nowMs: number): WorldTileFallbackSnapshot {
    assertNow(nowMs);
    if (this.reason !== null) return this.snapshot();
    if (this.coverageIncompleteSinceMs !== null) {
      this.criticalFailures += 1;
      if (this.criticalFailures >= WORLD_TILE_CRITICAL_FAILURE_LIMIT) {
        this.reason = 'critical-failures';
      }
    }
    this.evaluate(nowMs);
    return this.snapshot();
  }

  recordPermanentManifestIncompatibility(): WorldTileFallbackSnapshot {
    this.reason ??= 'manifest-incompatible';
    return this.snapshot();
  }

  evaluate(nowMs: number): WorldTileFallbackSnapshot {
    assertNow(nowMs);
    if (
      this.reason === null &&
      this.coverageIncompleteSinceMs !== null &&
      nowMs - this.coverageIncompleteSinceMs >= WORLD_TILE_COVERAGE_TIMEOUT_MS
    ) {
      this.reason = 'coverage-timeout';
    }
    return this.snapshot();
  }

  snapshot(): WorldTileFallbackSnapshot {
    return {
      active: this.reason !== null,
      reason: this.reason,
      criticalFailures: this.criticalFailures,
      coverageIncompleteSinceMs: this.coverageIncompleteSinceMs,
    };
  }
}

export class CorruptWorldTileRetryTracker {
  private readonly retriedKeys = new Set<string>();

  shouldEvictAndRetry(key: string): boolean {
    if (this.retriedKeys.has(key)) return false;
    this.retriedKeys.add(key);
    return true;
  }

  markSuccessful(key: string): void {
    this.retriedKeys.delete(key);
  }
}

function assertNow(nowMs: number): void {
  if (!Number.isFinite(nowMs)) {
    throw new RangeError('Fallback controller time must be finite.');
  }
}
