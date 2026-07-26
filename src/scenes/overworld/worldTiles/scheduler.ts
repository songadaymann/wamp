import { worldTileAddressKey, type WorldTileAddress } from './types';

export type WorldTilePerformanceProfile = 'normal' | 'reduced';

export interface WorldTileStreamingBudgets {
  fetchConcurrency: number;
  decodeConcurrency: number;
  gpuUploadsPerFrame: number;
  gpuUploadBudgetMs: number;
  maxGpuUploadBacklog: number;
  persistentByteBudgetMb: number;
  gpuTextureBudgetMb: number;
}

export interface WorldTileRequestCandidate {
  address: WorldTileAddress;
  uncoveredVisibleAncestor?: boolean;
  visibleTarget?: boolean;
  siblingClosure?: boolean;
  guard?: boolean;
  predictedMovement?: boolean;
  pointerDistance?: number | null;
  centerDistance?: number | null;
  predictedDistance?: number | null;
}

export interface RankedWorldTileRequest extends WorldTileRequestCandidate {
  key: string;
  priorityTier: number;
  proximityScore: number;
}

export interface ManifestRefreshDecision {
  generation: number;
  issueNow: boolean;
  dueAtMs: number;
}

export interface WorldTileQueuedTask {
  taskKey: string;
  retainAcrossCoverage: boolean;
}

export interface WorldTileQueueReconciliation<T extends WorldTileQueuedTask> {
  queue: T[];
  removed: T[];
  missingTaskKeys: string[];
}

export function reconcileWorldTileQueuedTasks<T extends WorldTileQueuedTask>(
  queued: readonly T[],
  orderedCoverageTaskKeys: readonly string[],
): WorldTileQueueReconciliation<T> {
  const orderedCoverage = new Set(orderedCoverageTaskKeys);
  const retainedKeys = new Set<string>();
  const sticky: T[] = [];
  const coverageByKey = new Map<string, T>();
  const removed: T[] = [];

  for (const task of queued) {
    if (retainedKeys.has(task.taskKey)) {
      removed.push(task);
      continue;
    }
    if (task.retainAcrossCoverage) {
      retainedKeys.add(task.taskKey);
      if (orderedCoverage.has(task.taskKey)) {
        coverageByKey.set(task.taskKey, task);
      } else {
        sticky.push(task);
      }
      continue;
    }
    if (orderedCoverage.has(task.taskKey)) {
      retainedKeys.add(task.taskKey);
      coverageByKey.set(task.taskKey, task);
    } else {
      removed.push(task);
    }
  }

  const coverage = orderedCoverageTaskKeys.flatMap((taskKey) => {
    const task = coverageByKey.get(taskKey);
    return task ? [task] : [];
  });
  return {
    queue: [...coverage, ...sticky],
    removed,
    missingTaskKeys: orderedCoverageTaskKeys.filter((taskKey) => !retainedKeys.has(taskKey)),
  };
}

const BYTES_PER_MEBIBYTE = 1_024 * 1_024;

const NORMAL_BUDGETS: WorldTileStreamingBudgets = {
  fetchConcurrency: 6,
  decodeConcurrency: 2,
  gpuUploadsPerFrame: 2,
  gpuUploadBudgetMs: 4,
  maxGpuUploadBacklog: 8,
  persistentByteBudgetMb: 128,
  gpuTextureBudgetMb: 96,
};

const REDUCED_BUDGETS: WorldTileStreamingBudgets = {
  fetchConcurrency: 3,
  decodeConcurrency: 1,
  gpuUploadsPerFrame: 1,
  gpuUploadBudgetMs: 2,
  maxGpuUploadBacklog: 4,
  persistentByteBudgetMb: 48,
  gpuTextureBudgetMb: 40,
};

export function getWorldTileStreamingBudgets(
  profile: WorldTilePerformanceProfile,
): WorldTileStreamingBudgets {
  return { ...(profile === 'reduced' ? REDUCED_BUDGETS : NORMAL_BUDGETS) };
}

export function getPersistentWorldTileByteBudget(
  profile: WorldTilePerformanceProfile,
  storageQuotaBytes: number | null,
): number {
  const configuredBytes = getWorldTileStreamingBudgets(profile).persistentByteBudgetMb * BYTES_PER_MEBIBYTE;
  if (storageQuotaBytes === null) {
    return configuredBytes;
  }
  if (!Number.isFinite(storageQuotaBytes) || storageQuotaBytes < 0) {
    throw new RangeError('Storage quota must be a finite non-negative number or null.');
  }
  return Math.floor(Math.min(configuredBytes, storageQuotaBytes * 0.1));
}

export function getGpuWorldTileByteBudget(profile: WorldTilePerformanceProfile): number {
  return getWorldTileStreamingBudgets(profile).gpuTextureBudgetMb * BYTES_PER_MEBIBYTE;
}

export function rankWorldTileRequests(
  candidates: readonly WorldTileRequestCandidate[],
): RankedWorldTileRequest[] {
  const merged = new Map<string, WorldTileRequestCandidate>();
  for (const candidate of candidates) {
    const key = worldTileAddressKey(candidate.address);
    const existing = merged.get(key);
    merged.set(key, existing ? mergeCandidates(existing, candidate) : candidate);
  }

  return Array.from(merged.entries())
    .map(([key, candidate]) => ({
      ...candidate,
      key,
      priorityTier: getPriorityTier(candidate),
      proximityScore: getProximityScore(candidate),
    }))
    .sort((left, right) =>
      left.priorityTier - right.priorityTier ||
      left.proximityScore - right.proximityScore ||
      left.address.level - right.address.level ||
      left.address.y - right.address.y ||
      left.address.x - right.address.x ||
      left.address.rendererVersion.localeCompare(right.address.rendererVersion)
    );
}

export class ManifestRefreshSchedule {
  private readonly intervalMs: number;
  private nextGeneration = 0;
  private lastIssuedAtMs = Number.NEGATIVE_INFINITY;
  private pendingGeneration: number | null = null;
  private pendingDueAtMs: number | null = null;

  constructor(maxRequestsPerSecond: number = 10) {
    if (!Number.isFinite(maxRequestsPerSecond) || maxRequestsPerSecond <= 0) {
      throw new RangeError('Manifest refresh frequency must be positive.');
    }
    this.intervalMs = 1_000 / maxRequestsPerSecond;
  }

  schedule(nowMs: number): ManifestRefreshDecision {
    assertNow(nowMs);
    const generation = ++this.nextGeneration;
    const earliestIssueAt = this.lastIssuedAtMs + this.intervalMs;
    if (nowMs >= earliestIssueAt) {
      this.lastIssuedAtMs = nowMs;
      this.pendingGeneration = null;
      this.pendingDueAtMs = null;
      return { generation, issueNow: true, dueAtMs: nowMs };
    }

    this.pendingGeneration = generation;
    this.pendingDueAtMs = earliestIssueAt;
    return { generation, issueNow: false, dueAtMs: earliestIssueAt };
  }

  flush(nowMs: number): ManifestRefreshDecision | null {
    assertNow(nowMs);
    if (
      this.pendingGeneration === null ||
      this.pendingDueAtMs === null ||
      nowMs < this.pendingDueAtMs
    ) {
      return null;
    }

    const decision: ManifestRefreshDecision = {
      generation: this.pendingGeneration,
      issueNow: true,
      dueAtMs: nowMs,
    };
    this.lastIssuedAtMs = nowMs;
    this.pendingGeneration = null;
    this.pendingDueAtMs = null;
    return decision;
  }

  hasTrailingRefresh(): boolean {
    return this.pendingGeneration !== null;
  }

  reset(): void {
    this.lastIssuedAtMs = Number.NEGATIVE_INFINITY;
    this.pendingGeneration = null;
    this.pendingDueAtMs = null;
  }
}

function getPriorityTier(candidate: WorldTileRequestCandidate): number {
  if (candidate.uncoveredVisibleAncestor) return 0;
  if (candidate.visibleTarget) return 1;
  if (candidate.siblingClosure) return 2;
  if (hasFiniteDistance(candidate.pointerDistance) || hasFiniteDistance(candidate.centerDistance)) return 3;
  if (candidate.predictedMovement) return 4;
  if (candidate.guard) return 5;
  return 6;
}

function getProximityScore(candidate: WorldTileRequestCandidate): number {
  const distances = [candidate.pointerDistance, candidate.centerDistance, candidate.predictedDistance]
    .filter(hasFiniteDistance);
  return distances.length > 0 ? Math.min(...distances) : Number.POSITIVE_INFINITY;
}

function mergeCandidates(
  left: WorldTileRequestCandidate,
  right: WorldTileRequestCandidate,
): WorldTileRequestCandidate {
  return {
    address: left.address,
    uncoveredVisibleAncestor: left.uncoveredVisibleAncestor || right.uncoveredVisibleAncestor,
    visibleTarget: left.visibleTarget || right.visibleTarget,
    siblingClosure: left.siblingClosure || right.siblingClosure,
    guard: left.guard || right.guard,
    predictedMovement: left.predictedMovement || right.predictedMovement,
    pointerDistance: minimumDistance(left.pointerDistance, right.pointerDistance),
    centerDistance: minimumDistance(left.centerDistance, right.centerDistance),
    predictedDistance: minimumDistance(left.predictedDistance, right.predictedDistance),
  };
}

function minimumDistance(left: number | null | undefined, right: number | null | undefined): number | null {
  const values = [left, right].filter(hasFiniteDistance);
  return values.length > 0 ? Math.min(...values) : null;
}

function hasFiniteDistance(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function assertNow(nowMs: number): void {
  if (!Number.isFinite(nowMs)) {
    throw new RangeError('Scheduler time must be finite.');
  }
}
