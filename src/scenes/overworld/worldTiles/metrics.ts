import type { WorldTileFallbackReason } from './retryFallback';
import type { WorldTileLevel } from './types';

export interface WorldTileQueueDepths {
  manifest: number;
  fetch: number;
  decode: number;
  gpuUpload: number;
  replacementGroups: number;
}

export interface WorldTileDebugMetrics {
  targetLevel: WorldTileLevel;
  visibleCount: number;
  readyCount: number;
  staleCount: number;
  coveragePercentage: number;
  queueDepths: WorldTileQueueDepths;
  replacementGapFrames: number;
  fallbackReason: WorldTileFallbackReason | null;
}

const EMPTY_QUEUE_DEPTHS: WorldTileQueueDepths = {
  manifest: 0,
  fetch: 0,
  decode: 0,
  gpuUpload: 0,
  replacementGroups: 0,
};

export class WorldTileDebugMetricsTracker {
  private metrics: WorldTileDebugMetrics = {
    targetLevel: 0,
    visibleCount: 0,
    readyCount: 0,
    staleCount: 0,
    coveragePercentage: 100,
    queueDepths: { ...EMPTY_QUEUE_DEPTHS },
    replacementGapFrames: 0,
    fallbackReason: null,
  };
  private hasReachedCompleteCoverage = false;

  update(input: {
    targetLevel?: WorldTileLevel;
    visibleCount?: number;
    readyCount?: number;
    staleCount?: number;
    queueDepths?: Partial<WorldTileQueueDepths>;
    fallbackReason?: WorldTileFallbackReason | null;
  }): WorldTileDebugMetrics {
    const visibleCount = input.visibleCount ?? this.metrics.visibleCount;
    const readyCount = input.readyCount ?? this.metrics.readyCount;
    const staleCount = input.staleCount ?? this.metrics.staleCount;
    assertCount(visibleCount, 'visible');
    assertCount(readyCount, 'ready');
    assertCount(staleCount, 'stale');
    if (readyCount > visibleCount || staleCount > visibleCount) {
      throw new RangeError('Ready and stale tile counts cannot exceed visible tile count.');
    }

    const coveragePercentage = visibleCount === 0 ? 100 : (readyCount / visibleCount) * 100;
    this.metrics = {
      ...this.metrics,
      targetLevel: input.targetLevel ?? this.metrics.targetLevel,
      visibleCount,
      readyCount,
      staleCount,
      coveragePercentage,
      queueDepths: {
        ...this.metrics.queueDepths,
        ...input.queueDepths,
      },
      fallbackReason: input.fallbackReason === undefined
        ? this.metrics.fallbackReason
        : input.fallbackReason,
    };
    for (const [name, value] of Object.entries(this.metrics.queueDepths)) {
      assertCount(value, `${name} queue`);
    }
    return this.snapshot();
  }

  recordFrame(): WorldTileDebugMetrics {
    const complete = this.metrics.visibleCount > 0 && this.metrics.coveragePercentage === 100;
    if (this.hasReachedCompleteCoverage && !complete) {
      this.metrics.replacementGapFrames += 1;
    }
    if (complete) {
      this.hasReachedCompleteCoverage = true;
    }
    return this.snapshot();
  }

  snapshot(): WorldTileDebugMetrics {
    return {
      ...this.metrics,
      queueDepths: { ...this.metrics.queueDepths },
    };
  }
}

function assertCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} count must be a non-negative safe integer.`);
  }
}
