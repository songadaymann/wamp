import type { DevicePerformanceMode } from './devicePerformanceMode';

export type PerformanceAdvisorMode = DevicePerformanceMode;

export type PerformanceAdvisorReason =
  | 'sustained-frame-pressure'
  | 'render-gpu-pressure'
  | 'transition-starvation'
  | 'network-contention';

export type PerformanceAdvisorState =
  | 'inactive'
  | 'warming'
  | 'observing'
  | 'candidate'
  | 'suppressed';

export type PerformanceAdvisorResetReason =
  | 'room-transition'
  | 'resize'
  | 'orientation'
  | 'visibility-restored'
  | 'scene-wake'
  | 'pause'
  | 'webgl-context-restored'
  | 'manual';

export type PerformanceAdvisorTransitionBlockReason =
  | 'locked'
  | 'unreachable'
  | 'non-cardinal'
  | 'unprepared';

export interface PerformanceAdvisorFrameSample {
  readonly atMs: number;
  readonly frameDeltaMs: number;
  readonly criticalUpdateMs: number;
  readonly schedulerHeadroomMs: number;
  readonly longTaskCount?: number;
}

export interface PerformanceAdvisorTransitionGateSample {
  readonly atMs: number;
  readonly fromRoomId: string;
  readonly toRoomId: string;
  readonly reason: PerformanceAdvisorTransitionBlockReason;
  readonly generation: number | null;
  readonly progressRevision: number | null;
  readonly urgentWorkQueued: boolean;
  readonly schedulerStarved: boolean;
}

interface PerformanceAdvisorExactSnapshotEventBase {
  readonly atMs: number;
  readonly roomId: string;
  readonly generation: number;
}

export type PerformanceAdvisorExactSnapshotEvent =
  | (PerformanceAdvisorExactSnapshotEventBase & {
      readonly phase: 'started';
      readonly optionalCompetitionObserved?: boolean;
    })
  | (PerformanceAdvisorExactSnapshotEventBase & {
      readonly phase: 'optional-competition';
    })
  | (PerformanceAdvisorExactSnapshotEventBase & {
      readonly phase: 'settled';
      readonly outcome: 'success' | 'failure' | 'cancelled';
      readonly optionalCompetitionObserved?: boolean;
    });

export interface PerformanceAdvisorBucketSnapshot {
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly frameCount: number;
  readonly approximateFps: number;
  readonly frameP95Ms: number;
  readonly criticalUpdateP95Ms: number;
  readonly over33FrameRatio: number;
  readonly lowHeadroomRatio: number;
  readonly over50FrameCount: number;
  readonly longTaskCount: number;
  readonly framePressure: boolean;
  readonly criticalCorroboration: boolean;
  readonly bad: boolean;
  readonly renderPressure: boolean;
}

export type PerformanceAdvisorSuggestionEvidence =
  | {
      readonly type: 'rolling-buckets';
      readonly badBucketCount: number;
      readonly bucketCount: number;
      readonly latestConsecutiveBadBuckets: number;
    }
  | {
      readonly type: 'render-buckets';
      readonly consecutiveBucketCount: number;
      readonly approximateFps: number;
      readonly over50FrameCount: number;
      readonly criticalUpdateP95Ms: number;
    }
  | {
      readonly type: 'transition-stall';
      readonly fromRoomId: string;
      readonly toRoomId: string;
      readonly generation: number | null;
      readonly stalledForMs: number;
      readonly progressRevision: number | null;
    }
  | {
      readonly type: 'network-incidents';
      readonly roomId: string;
      readonly generation: number;
      readonly delayedForMs: number;
      readonly incidentCount: 1 | 2;
      readonly windowMs: number;
    };

export interface PerformanceAdvisorSuggestion {
  readonly id: number;
  readonly reason: PerformanceAdvisorReason;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly evidence: PerformanceAdvisorSuggestionEvidence;
}

export type PerformanceAdvisorSuggestionClearReason =
  | 'dismissed'
  | 'mode-selected'
  | 'manual';

export type PerformanceAdvisorSuggestionEvent =
  | {
      readonly type: 'suggestion-created';
      readonly suggestion: PerformanceAdvisorSuggestion;
    }
  | {
      readonly type: 'suggestion-expired';
      readonly atMs: number;
      readonly suggestionId: number;
      readonly reason: PerformanceAdvisorReason;
    }
  | {
      readonly type: 'suggestion-cleared';
      readonly atMs: number;
      readonly suggestionId: number;
      readonly reason: PerformanceAdvisorReason;
      readonly clearReason: PerformanceAdvisorSuggestionClearReason;
    };

export interface PerformanceAdvisorTransitionDebugState {
  readonly fromRoomId: string;
  readonly toRoomId: string;
  readonly generation: number | null;
  readonly progressRevision: number | null;
  readonly noProgressSinceMs: number;
  readonly urgentWorkQueued: boolean;
  readonly schedulerStarved: boolean;
}

export interface PerformanceAdvisorDebugState {
  readonly state: PerformanceAdvisorState;
  readonly mode: PerformanceAdvisorMode;
  readonly monitoringEligible: boolean;
  readonly monitoringStartedAtMs: number | null;
  readonly evidenceEligibleAtMs: number | null;
  readonly quietRemainingMs: number;
  readonly completedBucketCount: number;
  readonly rollingBadBucketCount: number;
  readonly renderConsecutiveBucketCount: number;
  readonly rollingBuckets: readonly PerformanceAdvisorBucketSnapshot[];
  readonly activeTransition: PerformanceAdvisorTransitionDebugState | null;
  readonly activeExactSnapshotRequestCount: number;
  readonly lastNetworkIncidentAtMs: number | null;
  readonly suggestionCreatedThisSession: boolean;
  readonly suggestion: PerformanceAdvisorSuggestion | null;
  readonly droppedFrameSamples: number;
}

export interface PerformanceAdvisorOptions {
  readonly startedAtMs?: number;
  readonly mode?: PerformanceAdvisorMode;
  readonly eligible?: boolean;
  readonly onSuggestionEvent?: (event: PerformanceAdvisorSuggestionEvent) => void;
}

export const PERFORMANCE_ADVISOR_THRESHOLDS = Object.freeze({
  bucketMs: 1_000,
  rollingBucketCount: 10,
  requiredBadBucketCount: 8,
  requiredLatestBadBucketCount: 3,
  startupIgnoreMs: 15_000,
  resetQuietMs: 5_000,
  suggestionLifetimeMs: 120_000,
  frameFpsMax: 45,
  frameP95Ms: 25,
  over33FrameMs: 33.4,
  over33FrameRatio: 0.1,
  criticalUpdateP95Ms: 12,
  lowHeadroomMaxMs: 1,
  lowHeadroomRatio: 0.3,
  renderFpsMin: 25,
  renderFpsMax: 35,
  renderGapMs: 50,
  renderGapCount: 2,
  renderConsecutiveBucketCount: 3,
  transitionStallMs: 750,
  networkDelayMs: 1_500,
  networkLongDelayMs: 3_000,
  networkIncidentWindowMs: 600_000,
});

const MAX_FRAME_SAMPLES_PER_BUCKET = 512;
const ROLLING_BUCKET_COUNT = PERFORMANCE_ADVISOR_THRESHOLDS.rollingBucketCount;

interface ActiveExactSnapshotRequest {
  readonly roomId: string;
  readonly generation: number;
  readonly startedAtMs: number;
  optionalCompetitionObserved: boolean;
  shortIncidentRecorded: boolean;
  longIncidentRecorded: boolean;
}

/**
 * Pure runtime-pressure evaluator. It performs no DOM, storage, timer, or
 * PerformanceObserver work. Callers feed monotonic timestamps and can inspect
 * or subscribe to the rare suggestion lifecycle events.
 */
export class RuntimePerformanceAdvisor {
  private mode: PerformanceAdvisorMode;
  private monitoringEligible: boolean;
  private monitoringStartedAtMs: number | null;
  private evidenceEligibleAtMs: number;
  private lastAdvancedAtMs: number;
  private readonly onSuggestionEvent:
    | ((event: PerformanceAdvisorSuggestionEvent) => void)
    | null;

  private bucketStartedAtMs: number | null = null;
  private bucketFrameCount = 0;
  private bucketStoredFrameCount = 0;
  private bucketFrameDeltaTotalMs = 0;
  private bucketFramesOver33 = 0;
  private bucketFramesOver50 = 0;
  private bucketLowHeadroomFrames = 0;
  private bucketLongTaskCount = 0;
  private readonly bucketFrameDeltas = new Float64Array(MAX_FRAME_SAMPLES_PER_BUCKET);
  private readonly bucketCriticalUpdates = new Float64Array(MAX_FRAME_SAMPLES_PER_BUCKET);
  private droppedFrameSamples = 0;

  private readonly rollingStartedAtMs = new Float64Array(ROLLING_BUCKET_COUNT);
  private readonly rollingFrameCounts = new Uint16Array(ROLLING_BUCKET_COUNT);
  private readonly rollingFps = new Float64Array(ROLLING_BUCKET_COUNT);
  private readonly rollingFrameP95Ms = new Float64Array(ROLLING_BUCKET_COUNT);
  private readonly rollingUpdateP95Ms = new Float64Array(ROLLING_BUCKET_COUNT);
  private readonly rollingOver33Ratios = new Float64Array(ROLLING_BUCKET_COUNT);
  private readonly rollingLowHeadroomRatios = new Float64Array(ROLLING_BUCKET_COUNT);
  private readonly rollingOver50Counts = new Uint16Array(ROLLING_BUCKET_COUNT);
  private readonly rollingLongTaskCounts = new Uint16Array(ROLLING_BUCKET_COUNT);
  private readonly rollingFlags = new Uint8Array(ROLLING_BUCKET_COUNT);
  private rollingWriteIndex = 0;
  private rollingCount = 0;
  private rollingBadCount = 0;
  private renderConsecutiveBucketCount = 0;
  private completedBucketCount = 0;

  private transitionFromRoomId: string | null = null;
  private transitionToRoomId: string | null = null;
  private transitionGeneration: number | null = null;
  private transitionProgressRevision: number | null = null;
  private transitionNoProgressSinceMs = 0;
  private transitionStarvationSinceMs: number | null = null;
  private transitionUrgentWorkQueued = false;
  private transitionSchedulerStarved = false;

  private readonly activeExactSnapshotRequests = new Map<string, ActiveExactSnapshotRequest>();
  private lastNetworkIncidentAtMs: number | null = null;

  private nextSuggestionId = 0;
  private suggestionCreatedThisSession = false;
  private suggestion: PerformanceAdvisorSuggestion | null = null;

  constructor(options: PerformanceAdvisorOptions = {}) {
    const startedAtMs = normalizeTimestamp(options.startedAtMs ?? 0, 0);
    this.mode = options.mode ?? 'auto';
    this.monitoringEligible = options.eligible ?? true;
    this.monitoringStartedAtMs = this.monitoringEligible ? startedAtMs : null;
    this.evidenceEligibleAtMs = this.monitoringEligible && this.mode === 'auto'
      ? startedAtMs + PERFORMANCE_ADVISOR_THRESHOLDS.startupIgnoreMs
      : Number.POSITIVE_INFINITY;
    this.lastAdvancedAtMs = startedAtMs;
    this.onSuggestionEvent = options.onSuggestionEvent ?? null;
  }

  tick(atMs: number): void {
    this.advanceTime(atMs, true);
  }

  private advanceTime(atMs: number, evaluateEpisodes: boolean): void {
    const normalizedAtMs = normalizeTimestamp(atMs, this.lastAdvancedAtMs);
    if (normalizedAtMs < this.lastAdvancedAtMs) {
      return;
    }
    this.lastAdvancedAtMs = normalizedAtMs;
    this.expireSuggestion(normalizedAtMs);

    if (!this.isEvidenceEligible(normalizedAtMs)) {
      return;
    }

    this.advanceBuckets(normalizedAtMs);
    if (evaluateEpisodes) {
      this.evaluateTransitionStall(normalizedAtMs);
      this.evaluateActiveExactSnapshotRequests(normalizedAtMs);
    }
  }

  recordFrame(sample: PerformanceAdvisorFrameSample): void {
    if (!Number.isFinite(sample.atMs) || sample.atMs < this.lastAdvancedAtMs) {
      return;
    }
    this.tick(sample.atMs);
    if (!this.isEvidenceEligible(sample.atMs)) {
      return;
    }
    this.ensureBucketStarted();

    const frameDeltaMs = normalizeDuration(sample.frameDeltaMs);
    const criticalUpdateMs = normalizeDuration(sample.criticalUpdateMs);
    const schedulerHeadroomMs = normalizeDuration(sample.schedulerHeadroomMs);
    const longTaskCount = normalizeCount(sample.longTaskCount ?? 0);

    this.bucketFrameCount += 1;
    this.bucketFrameDeltaTotalMs += frameDeltaMs;
    if (frameDeltaMs > PERFORMANCE_ADVISOR_THRESHOLDS.over33FrameMs) {
      this.bucketFramesOver33 += 1;
    }
    if (frameDeltaMs > PERFORMANCE_ADVISOR_THRESHOLDS.renderGapMs) {
      this.bucketFramesOver50 += 1;
    }
    if (schedulerHeadroomMs <= PERFORMANCE_ADVISOR_THRESHOLDS.lowHeadroomMaxMs) {
      this.bucketLowHeadroomFrames += 1;
    }
    this.bucketLongTaskCount += longTaskCount;

    if (this.bucketStoredFrameCount < MAX_FRAME_SAMPLES_PER_BUCKET) {
      this.bucketFrameDeltas[this.bucketStoredFrameCount] = frameDeltaMs;
      this.bucketCriticalUpdates[this.bucketStoredFrameCount] = criticalUpdateMs;
      this.bucketStoredFrameCount += 1;
    } else {
      this.droppedFrameSamples += 1;
    }
  }

  setEligibility(eligible: boolean, atMs: number): void {
    const normalizedAtMs = normalizeTimestamp(atMs, this.lastAdvancedAtMs);
    this.advanceForLifecycleChange(normalizedAtMs);
    if (eligible === this.monitoringEligible) {
      return;
    }

    this.monitoringEligible = eligible;
    this.clearCollectedEvidence(true);
    if (!eligible) {
      this.evidenceEligibleAtMs = Number.POSITIVE_INFINITY;
      return;
    }

    if (this.monitoringStartedAtMs === null) {
      this.monitoringStartedAtMs = normalizedAtMs;
      this.evidenceEligibleAtMs = this.mode === 'auto'
        ? normalizedAtMs + PERFORMANCE_ADVISOR_THRESHOLDS.startupIgnoreMs
        : Number.POSITIVE_INFINITY;
      return;
    }

    this.evidenceEligibleAtMs = this.mode === 'auto'
      ? normalizedAtMs + PERFORMANCE_ADVISOR_THRESHOLDS.resetQuietMs
      : Number.POSITIVE_INFINITY;
  }

  setMode(mode: PerformanceAdvisorMode, atMs: number): void {
    const normalizedAtMs = normalizeTimestamp(atMs, this.lastAdvancedAtMs);
    this.advanceForLifecycleChange(normalizedAtMs);
    if (mode === this.mode) {
      return;
    }

    this.mode = mode;
    this.clearCollectedEvidence(true);
    if (mode !== 'auto') {
      this.evidenceEligibleAtMs = Number.POSITIVE_INFINITY;
      this.clearSuggestion('mode-selected', normalizedAtMs);
      return;
    }

    this.monitoringStartedAtMs = this.monitoringEligible ? normalizedAtMs : null;
    this.evidenceEligibleAtMs = this.monitoringEligible
      ? normalizedAtMs + PERFORMANCE_ADVISOR_THRESHOLDS.startupIgnoreMs
      : Number.POSITIVE_INFINITY;
  }

  resetEvidence(_reason: PerformanceAdvisorResetReason, atMs: number): void {
    const normalizedAtMs = normalizeTimestamp(atMs, this.lastAdvancedAtMs);
    this.advanceForLifecycleChange(normalizedAtMs);
    this.clearCollectedEvidence(true);
    if (this.mode === 'auto' && this.monitoringEligible) {
      const startupEligibleAtMs = this.monitoringStartedAtMs === null
        ? normalizedAtMs + PERFORMANCE_ADVISOR_THRESHOLDS.startupIgnoreMs
        : this.monitoringStartedAtMs + PERFORMANCE_ADVISOR_THRESHOLDS.startupIgnoreMs;
      this.evidenceEligibleAtMs = Math.max(
        startupEligibleAtMs,
        normalizedAtMs + PERFORMANCE_ADVISOR_THRESHOLDS.resetQuietMs,
      );
    }
  }

  recordTransitionGate(sample: PerformanceAdvisorTransitionGateSample): void {
    if (!Number.isFinite(sample.atMs) || sample.atMs < this.lastAdvancedAtMs) {
      return;
    }
    this.advanceTime(sample.atMs, false);
    if (!this.isEvidenceEligible(sample.atMs)) {
      return;
    }

    if (sample.reason !== 'unprepared') {
      this.clearTransitionStall();
      return;
    }

    const sameEpisode =
      this.transitionFromRoomId === sample.fromRoomId
      && this.transitionToRoomId === sample.toRoomId
      && this.transitionGeneration === sample.generation;
    const progressChanged = sameEpisode
      && this.transitionProgressRevision !== sample.progressRevision;
    const starvationActive = sample.urgentWorkQueued && sample.schedulerStarved;

    if (!sameEpisode || progressChanged) {
      this.transitionFromRoomId = sample.fromRoomId;
      this.transitionToRoomId = sample.toRoomId;
      this.transitionGeneration = sample.generation;
      this.transitionProgressRevision = sample.progressRevision;
      this.transitionNoProgressSinceMs = sample.atMs;
      this.transitionStarvationSinceMs = starvationActive ? sample.atMs : null;
    } else if (!starvationActive) {
      this.transitionStarvationSinceMs = null;
    } else if (this.transitionStarvationSinceMs === null) {
      this.transitionStarvationSinceMs = sample.atMs;
    }
    this.transitionUrgentWorkQueued = sample.urgentWorkQueued;
    this.transitionSchedulerStarved = sample.schedulerStarved;
    this.evaluateTransitionStall(sample.atMs);
  }

  recordDestinationProgress(
    roomId: string,
    generation: number | null,
    progressRevision: number | null,
    atMs: number,
  ): void {
    const normalizedAtMs = normalizeTimestamp(atMs, this.lastAdvancedAtMs);
    this.advanceTime(normalizedAtMs, false);
    if (
      this.transitionToRoomId !== roomId
      || this.transitionGeneration !== generation
      || this.transitionProgressRevision === progressRevision
    ) {
      return;
    }

    this.transitionProgressRevision = progressRevision;
    this.transitionNoProgressSinceMs = normalizedAtMs;
    this.transitionStarvationSinceMs =
      this.transitionUrgentWorkQueued && this.transitionSchedulerStarved
        ? normalizedAtMs
        : null;
  }

  clearTransitionGate(atMs: number): void {
    const normalizedAtMs = normalizeTimestamp(atMs, this.lastAdvancedAtMs);
    this.advanceTime(normalizedAtMs, false);
    this.clearTransitionStall();
  }

  recordExactSnapshot(event: PerformanceAdvisorExactSnapshotEvent): void {
    if (!Number.isFinite(event.atMs) || event.atMs < this.lastAdvancedAtMs) {
      return;
    }
    this.advanceTime(event.atMs, false);
    const key = exactSnapshotRequestKey(event.roomId, event.generation);

    if (event.phase === 'started') {
      if (this.mode !== 'auto' || !this.monitoringEligible) {
        this.activeExactSnapshotRequests.delete(key);
        return;
      }
      this.activeExactSnapshotRequests.set(key, {
        roomId: event.roomId,
        generation: event.generation,
        // Requests may begin during startup or a reset quiet window. Retain the
        // in-flight request, but only measure delay accumulated while evidence
        // collection is eligible.
        startedAtMs: Math.max(event.atMs, this.evidenceEligibleAtMs),
        optionalCompetitionObserved: event.optionalCompetitionObserved === true,
        shortIncidentRecorded: false,
        longIncidentRecorded: false,
      });
      this.evaluateExactSnapshotRequest(
        this.activeExactSnapshotRequests.get(key)!,
        event.atMs,
      );
      return;
    }

    const request = this.activeExactSnapshotRequests.get(key);
    if (!request) {
      return;
    }

    if (event.phase === 'optional-competition') {
      request.optionalCompetitionObserved = true;
      this.evaluateExactSnapshotRequest(request, event.atMs);
      return;
    }

    if (event.optionalCompetitionObserved === true) {
      request.optionalCompetitionObserved = true;
    }
    if (event.outcome !== 'cancelled') {
      this.evaluateExactSnapshotRequest(request, event.atMs);
    }
    this.activeExactSnapshotRequests.delete(key);
  }

  getSuggestion(atMs: number = this.lastAdvancedAtMs): PerformanceAdvisorSuggestion | null {
    this.tick(atMs);
    return this.suggestion;
  }

  dismissSuggestion(atMs: number): void {
    this.clearSuggestion('dismissed', normalizeTimestamp(atMs, this.lastAdvancedAtMs));
  }

  clearSuggestion(
    clearReason: PerformanceAdvisorSuggestionClearReason = 'manual',
    atMs: number = this.lastAdvancedAtMs,
  ): void {
    const normalizedAtMs = normalizeTimestamp(atMs, this.lastAdvancedAtMs);
    this.tick(normalizedAtMs);
    const suggestion = this.suggestion;
    if (!suggestion) {
      return;
    }

    this.suggestion = null;
    this.onSuggestionEvent?.({
      type: 'suggestion-cleared',
      atMs: normalizedAtMs,
      suggestionId: suggestion.id,
      reason: suggestion.reason,
      clearReason,
    });
  }

  getDebugState(atMs: number = this.lastAdvancedAtMs): PerformanceAdvisorDebugState {
    this.tick(atMs);
    const nowMs = this.lastAdvancedAtMs;
    return {
      state: this.resolveState(nowMs),
      mode: this.mode,
      monitoringEligible: this.monitoringEligible,
      monitoringStartedAtMs: this.monitoringStartedAtMs,
      evidenceEligibleAtMs: Number.isFinite(this.evidenceEligibleAtMs)
        ? this.evidenceEligibleAtMs
        : null,
      quietRemainingMs: this.mode === 'auto' && this.monitoringEligible
        ? Math.max(0, this.evidenceEligibleAtMs - nowMs)
        : 0,
      completedBucketCount: this.completedBucketCount,
      rollingBadBucketCount: this.rollingBadCount,
      renderConsecutiveBucketCount: this.renderConsecutiveBucketCount,
      rollingBuckets: this.buildRollingBucketSnapshots(),
      activeTransition: this.transitionFromRoomId !== null && this.transitionToRoomId !== null
        ? {
            fromRoomId: this.transitionFromRoomId,
            toRoomId: this.transitionToRoomId,
            generation: this.transitionGeneration,
            progressRevision: this.transitionProgressRevision,
            noProgressSinceMs: this.transitionNoProgressSinceMs,
            urgentWorkQueued: this.transitionUrgentWorkQueued,
            schedulerStarved: this.transitionSchedulerStarved,
          }
        : null,
      activeExactSnapshotRequestCount: this.activeExactSnapshotRequests.size,
      lastNetworkIncidentAtMs: this.lastNetworkIncidentAtMs,
      suggestionCreatedThisSession: this.suggestionCreatedThisSession,
      suggestion: this.suggestion,
      droppedFrameSamples: this.droppedFrameSamples,
    };
  }

  private resolveState(atMs: number): PerformanceAdvisorState {
    if (this.mode !== 'auto') {
      return 'suppressed';
    }
    if (this.suggestion) {
      return 'candidate';
    }
    if (!this.monitoringEligible) {
      return 'inactive';
    }
    return atMs < this.evidenceEligibleAtMs ? 'warming' : 'observing';
  }

  private advanceForLifecycleChange(atMs: number): void {
    if (atMs < this.lastAdvancedAtMs) {
      return;
    }
    this.lastAdvancedAtMs = atMs;
    this.expireSuggestion(atMs);
  }

  private isEvidenceEligible(atMs: number): boolean {
    return (
      this.mode === 'auto'
      && this.monitoringEligible
      && atMs >= this.evidenceEligibleAtMs
    );
  }

  private ensureBucketStarted(): void {
    if (this.bucketStartedAtMs === null) {
      this.bucketStartedAtMs = this.evidenceEligibleAtMs;
    }
  }

  private advanceBuckets(atMs: number): void {
    this.ensureBucketStarted();
    if (this.bucketStartedAtMs === null) {
      return;
    }
    let bucketsToComplete = Math.floor(
      (atMs - this.bucketStartedAtMs) / PERFORMANCE_ADVISOR_THRESHOLDS.bucketMs,
    );
    if (bucketsToComplete <= 0) {
      return;
    }

    this.finalizeCurrentBucket();
    this.bucketStartedAtMs += PERFORMANCE_ADVISOR_THRESHOLDS.bucketMs;
    bucketsToComplete -= 1;

    if (bucketsToComplete > ROLLING_BUCKET_COUNT) {
      const skippedEmptyBuckets = bucketsToComplete - ROLLING_BUCKET_COUNT;
      this.clearRollingBuckets();
      this.renderConsecutiveBucketCount = 0;
      this.completedBucketCount += skippedEmptyBuckets;
      this.bucketStartedAtMs +=
        skippedEmptyBuckets * PERFORMANCE_ADVISOR_THRESHOLDS.bucketMs;
      bucketsToComplete = ROLLING_BUCKET_COUNT;
    }

    while (bucketsToComplete > 0) {
      this.finalizeCurrentBucket();
      this.bucketStartedAtMs += PERFORMANCE_ADVISOR_THRESHOLDS.bucketMs;
      bucketsToComplete -= 1;
    }
  }

  private finalizeCurrentBucket(): void {
    if (this.bucketStartedAtMs === null) {
      return;
    }

    const frameCount = this.bucketFrameCount;
    const approximateFps = frameCount > 0 && this.bucketFrameDeltaTotalMs > 0
      ? 1_000 / (this.bucketFrameDeltaTotalMs / frameCount)
      : 0;
    const frameP95Ms = percentile95(
      this.bucketFrameDeltas,
      this.bucketStoredFrameCount,
    );
    const criticalUpdateP95Ms = percentile95(
      this.bucketCriticalUpdates,
      this.bucketStoredFrameCount,
    );
    const over33FrameRatio = frameCount > 0
      ? this.bucketFramesOver33 / frameCount
      : 0;
    const lowHeadroomRatio = frameCount > 0
      ? this.bucketLowHeadroomFrames / frameCount
      : 0;
    const framePressure = frameCount > 0 && (
      approximateFps <= PERFORMANCE_ADVISOR_THRESHOLDS.frameFpsMax
      || frameP95Ms >= PERFORMANCE_ADVISOR_THRESHOLDS.frameP95Ms
      || over33FrameRatio >= PERFORMANCE_ADVISOR_THRESHOLDS.over33FrameRatio
    );
    const criticalCorroboration = frameCount > 0 && (
      criticalUpdateP95Ms >= PERFORMANCE_ADVISOR_THRESHOLDS.criticalUpdateP95Ms
      || lowHeadroomRatio >= PERFORMANCE_ADVISOR_THRESHOLDS.lowHeadroomRatio
      || this.bucketLongTaskCount > 0
    );
    const bad = framePressure && criticalCorroboration;
    const renderPressure = frameCount > 0
      && approximateFps >= PERFORMANCE_ADVISOR_THRESHOLDS.renderFpsMin
      && approximateFps <= PERFORMANCE_ADVISOR_THRESHOLDS.renderFpsMax
      && this.bucketFramesOver50 >= PERFORMANCE_ADVISOR_THRESHOLDS.renderGapCount
      && criticalUpdateP95Ms < PERFORMANCE_ADVISOR_THRESHOLDS.criticalUpdateP95Ms;

    this.pushRollingBucket({
      approximateFps,
      frameP95Ms,
      criticalUpdateP95Ms,
      over33FrameRatio,
      lowHeadroomRatio,
      framePressure,
      criticalCorroboration,
      bad,
      renderPressure,
    });
    this.completedBucketCount += 1;
    this.renderConsecutiveBucketCount = renderPressure
      ? this.renderConsecutiveBucketCount + 1
      : 0;

    this.evaluateBucketSuggestions(
      this.bucketStartedAtMs + PERFORMANCE_ADVISOR_THRESHOLDS.bucketMs,
      approximateFps,
      criticalUpdateP95Ms,
      this.bucketFramesOver50,
    );
    this.resetCurrentBucket();
  }

  private pushRollingBucket(summary: {
    readonly approximateFps: number;
    readonly frameP95Ms: number;
    readonly criticalUpdateP95Ms: number;
    readonly over33FrameRatio: number;
    readonly lowHeadroomRatio: number;
    readonly framePressure: boolean;
    readonly criticalCorroboration: boolean;
    readonly bad: boolean;
    readonly renderPressure: boolean;
  }): void {
    const index = this.rollingWriteIndex;
    if (this.rollingCount === ROLLING_BUCKET_COUNT && hasFlag(this.rollingFlags[index], 1)) {
      this.rollingBadCount -= 1;
    }

    this.rollingStartedAtMs[index] = this.bucketStartedAtMs ?? 0;
    this.rollingFrameCounts[index] = Math.min(65_535, this.bucketFrameCount);
    this.rollingFps[index] = summary.approximateFps;
    this.rollingFrameP95Ms[index] = summary.frameP95Ms;
    this.rollingUpdateP95Ms[index] = summary.criticalUpdateP95Ms;
    this.rollingOver33Ratios[index] = summary.over33FrameRatio;
    this.rollingLowHeadroomRatios[index] = summary.lowHeadroomRatio;
    this.rollingOver50Counts[index] = Math.min(65_535, this.bucketFramesOver50);
    this.rollingLongTaskCounts[index] = Math.min(65_535, this.bucketLongTaskCount);
    this.rollingFlags[index] =
      (summary.bad ? 1 : 0)
      | (summary.framePressure ? 2 : 0)
      | (summary.criticalCorroboration ? 4 : 0)
      | (summary.renderPressure ? 8 : 0);
    if (summary.bad) {
      this.rollingBadCount += 1;
    }

    this.rollingWriteIndex = (index + 1) % ROLLING_BUCKET_COUNT;
    this.rollingCount = Math.min(ROLLING_BUCKET_COUNT, this.rollingCount + 1);
  }

  private evaluateBucketSuggestions(
    atMs: number,
    approximateFps: number,
    criticalUpdateP95Ms: number,
    over50FrameCount: number,
  ): void {
    if (this.suggestionCreatedThisSession || !this.isEvidenceEligible(atMs)) {
      return;
    }

    if (
      this.rollingCount === ROLLING_BUCKET_COUNT
      && this.rollingBadCount >= PERFORMANCE_ADVISOR_THRESHOLDS.requiredBadBucketCount
      && this.latestBucketsAreBad(
        PERFORMANCE_ADVISOR_THRESHOLDS.requiredLatestBadBucketCount,
      )
    ) {
      this.createSuggestion('sustained-frame-pressure', atMs, {
        type: 'rolling-buckets',
        badBucketCount: this.rollingBadCount,
        bucketCount: this.rollingCount,
        latestConsecutiveBadBuckets:
          PERFORMANCE_ADVISOR_THRESHOLDS.requiredLatestBadBucketCount,
      });
      return;
    }

    if (
      this.renderConsecutiveBucketCount
      >= PERFORMANCE_ADVISOR_THRESHOLDS.renderConsecutiveBucketCount
    ) {
      this.createSuggestion('render-gpu-pressure', atMs, {
        type: 'render-buckets',
        consecutiveBucketCount: this.renderConsecutiveBucketCount,
        approximateFps,
        over50FrameCount,
        criticalUpdateP95Ms,
      });
    }
  }

  private latestBucketsAreBad(count: number): boolean {
    if (this.rollingCount < count) {
      return false;
    }
    for (let offset = 1; offset <= count; offset += 1) {
      const index = (
        this.rollingWriteIndex - offset + ROLLING_BUCKET_COUNT
      ) % ROLLING_BUCKET_COUNT;
      if (!hasFlag(this.rollingFlags[index], 1)) {
        return false;
      }
    }
    return true;
  }

  private evaluateTransitionStall(atMs: number): void {
    if (
      this.transitionFromRoomId === null
      || this.transitionToRoomId === null
      || this.transitionStarvationSinceMs === null
      || !this.transitionUrgentWorkQueued
      || !this.transitionSchedulerStarved
      || this.suggestionCreatedThisSession
      || !this.isEvidenceEligible(atMs)
    ) {
      return;
    }

    const stalledForMs = atMs - this.transitionStarvationSinceMs;
    if (stalledForMs < PERFORMANCE_ADVISOR_THRESHOLDS.transitionStallMs) {
      return;
    }

    this.createSuggestion('transition-starvation', atMs, {
      type: 'transition-stall',
      fromRoomId: this.transitionFromRoomId,
      toRoomId: this.transitionToRoomId,
      generation: this.transitionGeneration,
      stalledForMs,
      progressRevision: this.transitionProgressRevision,
    });
  }

  private evaluateActiveExactSnapshotRequests(atMs: number): void {
    for (const request of this.activeExactSnapshotRequests.values()) {
      this.evaluateExactSnapshotRequest(request, atMs);
    }
  }

  private evaluateExactSnapshotRequest(
    request: ActiveExactSnapshotRequest,
    atMs: number,
  ): void {
    if (
      !request.optionalCompetitionObserved
      || !this.isEvidenceEligible(atMs)
    ) {
      return;
    }

    const delayedForMs = atMs - request.startedAtMs;
    if (
      delayedForMs >= PERFORMANCE_ADVISOR_THRESHOLDS.networkDelayMs
      && !request.shortIncidentRecorded
    ) {
      request.shortIncidentRecorded = true;
      const previousIncidentAtMs = this.lastNetworkIncidentAtMs;
      this.lastNetworkIncidentAtMs = atMs;
      if (
        previousIncidentAtMs !== null
        && atMs - previousIncidentAtMs
          <= PERFORMANCE_ADVISOR_THRESHOLDS.networkIncidentWindowMs
      ) {
        this.createSuggestion('network-contention', atMs, {
          type: 'network-incidents',
          roomId: request.roomId,
          generation: request.generation,
          delayedForMs,
          incidentCount: 2,
          windowMs: PERFORMANCE_ADVISOR_THRESHOLDS.networkIncidentWindowMs,
        });
      }
    }

    if (
      delayedForMs >= PERFORMANCE_ADVISOR_THRESHOLDS.networkLongDelayMs
      && !request.longIncidentRecorded
    ) {
      request.longIncidentRecorded = true;
      this.createSuggestion('network-contention', atMs, {
        type: 'network-incidents',
        roomId: request.roomId,
        generation: request.generation,
        delayedForMs,
        incidentCount: 1,
        windowMs: PERFORMANCE_ADVISOR_THRESHOLDS.networkIncidentWindowMs,
      });
    }
  }

  private createSuggestion(
    reason: PerformanceAdvisorReason,
    atMs: number,
    evidence: PerformanceAdvisorSuggestionEvidence,
  ): void {
    if (
      this.suggestionCreatedThisSession
      || this.mode !== 'auto'
      || !this.monitoringEligible
      || !this.isEvidenceEligible(atMs)
    ) {
      return;
    }

    const suggestion: PerformanceAdvisorSuggestion = Object.freeze({
      id: ++this.nextSuggestionId,
      reason,
      createdAtMs: atMs,
      expiresAtMs: atMs + PERFORMANCE_ADVISOR_THRESHOLDS.suggestionLifetimeMs,
      evidence: Object.freeze(evidence),
    });
    this.suggestion = suggestion;
    this.suggestionCreatedThisSession = true;
    this.onSuggestionEvent?.({ type: 'suggestion-created', suggestion });
  }

  private expireSuggestion(atMs: number): void {
    const suggestion = this.suggestion;
    if (!suggestion || atMs < suggestion.expiresAtMs) {
      return;
    }

    this.suggestion = null;
    this.onSuggestionEvent?.({
      type: 'suggestion-expired',
      atMs,
      suggestionId: suggestion.id,
      reason: suggestion.reason,
    });
  }

  private clearCollectedEvidence(clearActiveRequests: boolean): void {
    this.bucketStartedAtMs = null;
    this.resetCurrentBucket();
    this.clearRollingBuckets();
    this.renderConsecutiveBucketCount = 0;
    this.clearTransitionStall();
    if (clearActiveRequests) {
      this.activeExactSnapshotRequests.clear();
    }
  }

  private resetCurrentBucket(): void {
    this.bucketFrameCount = 0;
    this.bucketStoredFrameCount = 0;
    this.bucketFrameDeltaTotalMs = 0;
    this.bucketFramesOver33 = 0;
    this.bucketFramesOver50 = 0;
    this.bucketLowHeadroomFrames = 0;
    this.bucketLongTaskCount = 0;
  }

  private clearRollingBuckets(): void {
    this.rollingWriteIndex = 0;
    this.rollingCount = 0;
    this.rollingBadCount = 0;
  }

  private clearTransitionStall(): void {
    this.transitionFromRoomId = null;
    this.transitionToRoomId = null;
    this.transitionGeneration = null;
    this.transitionProgressRevision = null;
    this.transitionNoProgressSinceMs = 0;
    this.transitionStarvationSinceMs = null;
    this.transitionUrgentWorkQueued = false;
    this.transitionSchedulerStarved = false;
  }

  private buildRollingBucketSnapshots(): PerformanceAdvisorBucketSnapshot[] {
    const snapshots: PerformanceAdvisorBucketSnapshot[] = [];
    const oldestIndex = this.rollingCount === ROLLING_BUCKET_COUNT
      ? this.rollingWriteIndex
      : 0;
    for (let offset = 0; offset < this.rollingCount; offset += 1) {
      const index = (oldestIndex + offset) % ROLLING_BUCKET_COUNT;
      snapshots.push({
        startedAtMs: this.rollingStartedAtMs[index],
        endedAtMs:
          this.rollingStartedAtMs[index] + PERFORMANCE_ADVISOR_THRESHOLDS.bucketMs,
        frameCount: this.rollingFrameCounts[index],
        approximateFps: this.rollingFps[index],
        frameP95Ms: this.rollingFrameP95Ms[index],
        criticalUpdateP95Ms: this.rollingUpdateP95Ms[index],
        over33FrameRatio: this.rollingOver33Ratios[index],
        lowHeadroomRatio: this.rollingLowHeadroomRatios[index],
        over50FrameCount: this.rollingOver50Counts[index],
        longTaskCount: this.rollingLongTaskCounts[index],
        framePressure: hasFlag(this.rollingFlags[index], 2),
        criticalCorroboration: hasFlag(this.rollingFlags[index], 4),
        bad: hasFlag(this.rollingFlags[index], 1),
        renderPressure: hasFlag(this.rollingFlags[index], 8),
      });
    }
    return snapshots;
  }
}

function exactSnapshotRequestKey(roomId: string, generation: number): string {
  return `${roomId}\u0000${generation}`;
}

function hasFlag(value: number, flag: number): boolean {
  return (value & flag) !== 0;
}

function normalizeTimestamp(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(fallback, value) : fallback;
}

function normalizeDuration(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function percentile95(values: Float64Array, count: number): number {
  if (count <= 0) {
    return 0;
  }
  const targetIndex = Math.ceil(count * 0.95) - 1;
  return selectKth(values, count, targetIndex);
}

function selectKth(values: Float64Array, count: number, targetIndex: number): number {
  let left = 0;
  let right = count - 1;
  while (left < right) {
    const pivotIndex = partition(
      values,
      left,
      right,
      left + Math.floor((right - left) / 2),
    );
    if (pivotIndex === targetIndex) {
      return values[pivotIndex];
    }
    if (targetIndex < pivotIndex) {
      right = pivotIndex - 1;
    } else {
      left = pivotIndex + 1;
    }
  }
  return values[left];
}

function partition(
  values: Float64Array,
  left: number,
  right: number,
  pivotIndex: number,
): number {
  const pivotValue = values[pivotIndex];
  swap(values, pivotIndex, right);
  let storeIndex = left;
  for (let index = left; index < right; index += 1) {
    if (values[index] < pivotValue) {
      swap(values, storeIndex, index);
      storeIndex += 1;
    }
  }
  swap(values, right, storeIndex);
  return storeIndex;
}

function swap(values: Float64Array, left: number, right: number): void {
  if (left === right) {
    return;
  }
  const value = values[left];
  values[left] = values[right];
  values[right] = value;
}
