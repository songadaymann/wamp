export const FRAME_WORK_PRIORITIES = [
  'portal-current-destination',
  'predicted-destination-collision',
  'predicted-visuals-objects',
  'teardown',
  'preview-cosmetic',
] as const;

export type FrameWorkPriority = typeof FRAME_WORK_PRIORITIES[number];
export type FrameWorkPerformanceProfile = 'normal' | 'reduced';
export type FrameWorkCostKind = 'cpu' | 'gpu-upload';
export type FrameWorkJobState = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';

export interface FrameWorkBudget {
  readonly sharedCeilingMs: number;
  readonly cpuSubCapMs: number;
}

export interface FrameWorkGeneration {
  readonly scope: string;
  readonly id: number;
}

export interface FrameWorkJobSpec {
  label: string;
  priority: FrameWorkPriority;
  costKind: FrameWorkCostKind;
  estimatedCostMs: number;
  generation?: FrameWorkGeneration;
  execute: () => void;
}

export interface FrameWorkJobHandle {
  readonly id: number;
  readonly label: string;
  readonly priority: FrameWorkPriority;
  readonly costKind: FrameWorkCostKind;
  readonly estimatedCostMs: number;
  readonly generation: FrameWorkGeneration | null;
  readonly state: FrameWorkJobState;
  readonly queuedAtMs: number;
  readonly startedAtMs: number | null;
  readonly settledAtMs: number | null;
  readonly cancelReason: string | null;
  readonly failure: unknown;
  /** Moves queued work to the tail of another priority queue. Settled or running jobs cannot move. */
  reprioritize(priority: FrameWorkPriority): boolean;
  cancel(reason?: string): boolean;
}

export interface RunFrameWorkInput {
  profile: FrameWorkPerformanceProfile;
  /** Remaining frame time after simulation, input, networking, and other critical work. */
  criticalHeadroomMs: number;
  /** Shared discretionary work already charged outside this coordinator during this frame. */
  sharedBudgetConsumedMs?: number;
  /** CPU discretionary work already charged outside this coordinator during this frame. */
  cpuBudgetConsumedMs?: number;
}

export type FrameWorkStopReason =
  | 'queue-empty'
  | 'critical-headroom-exhausted'
  | 'shared-budget-exhausted'
  | 'cpu-budget-exhausted'
  | 'job-failed';

export interface FrameWorkExecutionRecord {
  readonly jobId: number;
  readonly label: string;
  readonly priority: FrameWorkPriority;
  readonly costKind: FrameWorkCostKind;
  readonly estimatedCostMs: number;
  readonly actualDurationMs: number;
  readonly chargedDurationMs: number;
  readonly state: 'completed' | 'failed';
}

export interface RunFrameWorkResult {
  readonly profile: FrameWorkPerformanceProfile;
  readonly budget: FrameWorkBudget;
  readonly criticalHeadroomMs: number;
  readonly sharedBudgetConsumedBeforeMs: number;
  readonly cpuBudgetConsumedBeforeMs: number;
  readonly queueDepthBefore: number;
  readonly queueDepthAfter: number;
  readonly executed: readonly FrameWorkExecutionRecord[];
  readonly actualSharedWorkMs: number;
  readonly actualCpuWorkMs: number;
  readonly chargedSharedWorkMs: number;
  readonly chargedCpuWorkMs: number;
  readonly sharedOvershootMs: number;
  readonly cpuOvershootMs: number;
  readonly criticalHeadroomOvershootMs: number;
  readonly stopReason: FrameWorkStopReason;
}

export interface FrameWorkCoordinatorDiagnostics {
  readonly queueDepth: number;
  readonly queueDepthByPriority: Readonly<Record<FrameWorkPriority, number>>;
  readonly maxQueueDepth: number;
  readonly currentGenerations: Readonly<Record<string, number>>;
  readonly submittedJobs: number;
  readonly enqueuedJobs: number;
  readonly completedJobs: number;
  readonly cancelledJobs: number;
  readonly failedJobs: number;
  /** Longest measured synchronous job execution since coordinator creation. */
  readonly maxActualJobDurationMs: number;
  /** Number of measured synchronous job executions strictly over 50 ms. */
  readonly jobsOver50Ms: number;
  readonly framesRun: number;
  readonly criticalHeadroomPausedFrames: number;
  readonly overshootFrames: number;
  readonly totalSharedOvershootMs: number;
  readonly totalCpuOvershootMs: number;
  readonly totalCriticalHeadroomOvershootMs: number;
  readonly lastFrame: RunFrameWorkResult | null;
}

export interface FrameWorkCoordinatorOptions {
  now?: () => number;
  onJobError?: (job: FrameWorkJobHandle, error: unknown) => void;
}

export const MAX_ATOMIC_FRAME_WORK_ESTIMATE_MS = 2;
export const FRAME_WORK_LONG_JOB_THRESHOLD_MS = 50;

const FRAME_WORK_BUDGETS: Readonly<Record<FrameWorkPerformanceProfile, FrameWorkBudget>> = {
  normal: Object.freeze({ sharedCeilingMs: 4, cpuSubCapMs: 2 }),
  reduced: Object.freeze({ sharedCeilingMs: 2, cpuSubCapMs: 1 }),
};

export const MAX_REDUCED_CPU_FRAME_WORK_ESTIMATE_MS =
  FRAME_WORK_BUDGETS.reduced.cpuSubCapMs;

const COST_EPSILON_MS = 0.000_001;

export function getFrameWorkBudget(profile: FrameWorkPerformanceProfile): FrameWorkBudget {
  return FRAME_WORK_BUDGETS[profile];
}

export class FrameWorkCoordinator {
  private readonly now: () => number;
  private readonly onJobError: ((job: FrameWorkJobHandle, error: unknown) => void) | null;
  private readonly queues = createPriorityQueues();
  private readonly currentGenerations = new Map<string, number>();
  private nextJobId = 0;
  private nextGenerationId = 0;
  private queueDepth = 0;
  private maxQueueDepth = 0;
  private submittedJobs = 0;
  private enqueuedJobs = 0;
  private completedJobs = 0;
  private cancelledJobs = 0;
  private failedJobs = 0;
  private maxActualJobDurationMs = 0;
  private jobsOver50Ms = 0;
  private framesRun = 0;
  private criticalHeadroomPausedFrames = 0;
  private overshootFrames = 0;
  private totalSharedOvershootMs = 0;
  private totalCpuOvershootMs = 0;
  private totalCriticalHeadroomOvershootMs = 0;
  private lastFrame: RunFrameWorkResult | null = null;

  constructor(options: FrameWorkCoordinatorOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.onJobError = options.onJobError ?? null;
  }

  /**
   * Starts the latest generation for one independently replaceable stream of work.
   * Queued work from older generations in the same scope is cancelled immediately.
   * A synchronously running atomic job cannot be preempted and is allowed to settle.
   */
  beginGeneration(scope: string): FrameWorkGeneration {
    const normalizedScope = assertScope(scope);
    const id = ++this.nextGenerationId;
    this.currentGenerations.set(normalizedScope, id);
    this.cancelQueuedJobs(
      (job) => job.generation?.scope === normalizedScope && job.generation.id < id,
      `superseded-by-generation-${id}`,
    );
    return Object.freeze({ scope: normalizedScope, id });
  }

  enqueue(spec: FrameWorkJobSpec): FrameWorkJobHandle {
    assertJobSpec(spec);
    this.submittedJobs += 1;

    const handle = new InternalFrameWorkJobHandle(
      ++this.nextJobId,
      spec,
      this.now(),
      (job, reason) => this.cancelHandle(job, reason),
      (job, priority) => this.reprioritizeHandle(job, priority),
    );

    if (spec.generation) {
      const currentGeneration = this.currentGenerations.get(spec.generation.scope);
      if (currentGeneration === undefined || spec.generation.id > currentGeneration) {
        throw new RangeError('Frame-work generations must come from beginGeneration().');
      }
      if (spec.generation.id < currentGeneration) {
        this.settleCancelled(handle, `superseded-by-generation-${currentGeneration}`);
        return handle;
      }
    }

    this.queues[spec.priority].push(handle);
    this.queueDepth += 1;
    this.enqueuedJobs += 1;
    this.maxQueueDepth = Math.max(this.maxQueueDepth, this.queueDepth);
    return handle;
  }

  cancelGeneration(generation: FrameWorkGeneration, reason = 'generation-cancelled'): number {
    const cancelled = this.cancelQueuedJobs(
      (job) => job.generation?.scope === generation.scope && job.generation.id === generation.id,
      reason,
    );
    if (this.currentGenerations.get(generation.scope) === generation.id) {
      this.currentGenerations.delete(generation.scope);
    }
    return cancelled;
  }

  /**
   * Retires a completed generation without cancelling any work. A generation
   * can only be released while it is still current and after all of its queued
   * stages have drained. This keeps scopes alive across intentional async waits
   * between stages while allowing completed streams to leave no diagnostic
   * bookkeeping behind.
   */
  releaseGeneration(generation: FrameWorkGeneration): boolean {
    if (this.currentGenerations.get(generation.scope) !== generation.id) {
      return false;
    }
    if (this.hasQueuedJobsForGeneration(generation)) {
      return false;
    }
    this.currentGenerations.delete(generation.scope);
    return true;
  }

  cancelAll(reason = 'coordinator-cancelled'): number {
    const cancelled = this.cancelQueuedJobs(() => true, reason);
    this.currentGenerations.clear();
    return cancelled;
  }

  hasQueuedWorkAtPriority(priority: FrameWorkPriority): boolean {
    assertPriority(priority);
    return this.queues[priority].length > 0;
  }

  runFrame(input: RunFrameWorkInput): RunFrameWorkResult {
    assertRunInput(input);
    const budget = getFrameWorkBudget(input.profile);
    const criticalHeadroomMs = input.criticalHeadroomMs;
    const sharedConsumedBeforeMs = input.sharedBudgetConsumedMs ?? 0;
    const cpuConsumedBeforeMs = input.cpuBudgetConsumedMs ?? 0;
    const queueDepthBefore = this.queueDepth;
    const executed: FrameWorkExecutionRecord[] = [];
    const availableSharedWorkMs = Math.max(0, Math.min(
      budget.sharedCeilingMs - sharedConsumedBeforeMs,
      criticalHeadroomMs,
    ));
    const availableCpuWorkMs = Math.max(0, budget.cpuSubCapMs - cpuConsumedBeforeMs);
    let actualSharedWorkMs = 0;
    let actualCpuWorkMs = 0;
    let chargedSharedWorkMs = 0;
    let chargedCpuWorkMs = 0;
    let stopReason: FrameWorkStopReason = 'queue-empty';

    while (this.queueDepth > 0) {
      const nextJob = this.peekNextJob();
      if (!nextJob) break;

      const sharedRemainingMs = availableSharedWorkMs - chargedSharedWorkMs;
      if (nextJob.estimatedCostMs > sharedRemainingMs + COST_EPSILON_MS) {
        stopReason = criticalHeadroomMs < budget.sharedCeilingMs - sharedConsumedBeforeMs
          ? 'critical-headroom-exhausted'
          : 'shared-budget-exhausted';
        break;
      }

      if (
        nextJob.costKind === 'cpu'
        && nextJob.estimatedCostMs > availableCpuWorkMs - chargedCpuWorkMs + COST_EPSILON_MS
      ) {
        stopReason = 'cpu-budget-exhausted';
        break;
      }

      this.dequeue(nextJob);
      nextJob.markRunning(this.now());
      const startedAtMs = this.now();
      let didFail = false;
      let failure: unknown = null;
      try {
        const executionResult = nextJob.execute() as unknown;
        if (isPromiseLike(executionResult)) {
          throw new TypeError('Frame-work jobs must execute synchronously and atomically.');
        }
      } catch (error) {
        didFail = true;
        failure = error;
      }
      const finishedAtMs = this.now();
      const actualDurationMs = Math.max(0, finishedAtMs - startedAtMs);
      this.maxActualJobDurationMs = Math.max(this.maxActualJobDurationMs, actualDurationMs);
      if (actualDurationMs > FRAME_WORK_LONG_JOB_THRESHOLD_MS) {
        this.jobsOver50Ms += 1;
      }
      const chargedDurationMs = Math.max(nextJob.estimatedCostMs, actualDurationMs);
      actualSharedWorkMs += actualDurationMs;
      chargedSharedWorkMs += chargedDurationMs;
      if (nextJob.costKind === 'cpu') {
        actualCpuWorkMs += actualDurationMs;
        chargedCpuWorkMs += chargedDurationMs;
      }

      if (!didFail) {
        nextJob.markCompleted(finishedAtMs);
        this.completedJobs += 1;
      } else {
        nextJob.markFailed(finishedAtMs, failure);
        this.failedJobs += 1;
        this.reportJobError(nextJob, failure);
      }
      executed.push({
        jobId: nextJob.id,
        label: nextJob.label,
        priority: nextJob.priority,
        costKind: nextJob.costKind,
        estimatedCostMs: nextJob.estimatedCostMs,
        actualDurationMs,
        chargedDurationMs,
        state: didFail ? 'failed' : 'completed',
      });

      if (didFail) {
        stopReason = 'job-failed';
        break;
      }
      stopReason = this.queueDepth === 0 ? 'queue-empty' : stopReason;
    }

    if (
      queueDepthBefore > 0
      && executed.length === 0
      && criticalHeadroomMs <= COST_EPSILON_MS
    ) {
      stopReason = 'critical-headroom-exhausted';
      this.criticalHeadroomPausedFrames += 1;
    }

    const sharedOvershootMs = Math.max(
      0,
      sharedConsumedBeforeMs + actualSharedWorkMs - budget.sharedCeilingMs,
    );
    const cpuOvershootMs = Math.max(
      0,
      cpuConsumedBeforeMs + actualCpuWorkMs - budget.cpuSubCapMs,
    );
    const criticalHeadroomOvershootMs = Math.max(0, actualSharedWorkMs - criticalHeadroomMs);
    const result: RunFrameWorkResult = {
      profile: input.profile,
      budget,
      criticalHeadroomMs,
      sharedBudgetConsumedBeforeMs: sharedConsumedBeforeMs,
      cpuBudgetConsumedBeforeMs: cpuConsumedBeforeMs,
      queueDepthBefore,
      queueDepthAfter: this.queueDepth,
      executed,
      actualSharedWorkMs,
      actualCpuWorkMs,
      chargedSharedWorkMs,
      chargedCpuWorkMs,
      sharedOvershootMs,
      cpuOvershootMs,
      criticalHeadroomOvershootMs,
      stopReason,
    };

    this.framesRun += 1;
    if (
      executed.length > 0
      && (sharedOvershootMs > 0 || cpuOvershootMs > 0 || criticalHeadroomOvershootMs > 0)
    ) {
      this.overshootFrames += 1;
      this.totalSharedOvershootMs += sharedOvershootMs;
      this.totalCpuOvershootMs += cpuOvershootMs;
      this.totalCriticalHeadroomOvershootMs += criticalHeadroomOvershootMs;
    }
    this.lastFrame = result;
    return result;
  }

  getDiagnostics(): FrameWorkCoordinatorDiagnostics {
    return {
      queueDepth: this.queueDepth,
      queueDepthByPriority: countQueuesByPriority(this.queues),
      maxQueueDepth: this.maxQueueDepth,
      currentGenerations: Object.fromEntries(this.currentGenerations),
      submittedJobs: this.submittedJobs,
      enqueuedJobs: this.enqueuedJobs,
      completedJobs: this.completedJobs,
      cancelledJobs: this.cancelledJobs,
      failedJobs: this.failedJobs,
      maxActualJobDurationMs: this.maxActualJobDurationMs,
      jobsOver50Ms: this.jobsOver50Ms,
      framesRun: this.framesRun,
      criticalHeadroomPausedFrames: this.criticalHeadroomPausedFrames,
      overshootFrames: this.overshootFrames,
      totalSharedOvershootMs: this.totalSharedOvershootMs,
      totalCpuOvershootMs: this.totalCpuOvershootMs,
      totalCriticalHeadroomOvershootMs: this.totalCriticalHeadroomOvershootMs,
      lastFrame: this.lastFrame,
    };
  }

  private peekNextJob(): InternalFrameWorkJobHandle | null {
    for (const priority of FRAME_WORK_PRIORITIES) {
      const job = this.queues[priority][0];
      if (job) return job;
    }
    return null;
  }

  private dequeue(job: InternalFrameWorkJobHandle): void {
    const head = this.queues[job.priority].shift();
    if (head !== job) {
      throw new Error('Frame-work queue ordering invariant failed.');
    }
    this.queueDepth -= 1;
  }

  private cancelHandle(job: InternalFrameWorkJobHandle, reason: string): boolean {
    if (job.state !== 'queued') return false;
    const queue = this.queues[job.priority];
    const index = queue.indexOf(job);
    if (index < 0) return false;
    queue.splice(index, 1);
    this.queueDepth -= 1;
    this.settleCancelled(job, normalizeReason(reason));
    return true;
  }

  private reprioritizeHandle(
    job: InternalFrameWorkJobHandle,
    priority: FrameWorkPriority,
  ): boolean {
    assertPriority(priority);
    if (job.state !== 'queued' || job.priority === priority) return false;

    const previousQueue = this.queues[job.priority];
    const index = previousQueue.indexOf(job);
    if (index < 0) return false;

    previousQueue.splice(index, 1);
    job.markReprioritized(priority);
    // A promoted job joins behind work that was already waiting at the new
    // priority. This preserves FIFO within each queue without letting a late
    // promotion jump an equally urgent destination.
    this.queues[priority].push(job);
    return true;
  }

  private cancelQueuedJobs(
    predicate: (job: InternalFrameWorkJobHandle) => boolean,
    reason: string,
  ): number {
    let cancelled = 0;
    for (const priority of FRAME_WORK_PRIORITIES) {
      const queue = this.queues[priority];
      for (let index = queue.length - 1; index >= 0; index -= 1) {
        const job = queue[index];
        if (!predicate(job)) continue;
        queue.splice(index, 1);
        this.queueDepth -= 1;
        this.settleCancelled(job, normalizeReason(reason));
        cancelled += 1;
      }
    }
    return cancelled;
  }

  private hasQueuedJobsForGeneration(generation: FrameWorkGeneration): boolean {
    for (const priority of FRAME_WORK_PRIORITIES) {
      if (this.queues[priority].some((job) => (
        job.generation?.scope === generation.scope
        && job.generation.id === generation.id
      ))) {
        return true;
      }
    }
    return false;
  }

  private settleCancelled(job: InternalFrameWorkJobHandle, reason: string): void {
    job.markCancelled(this.now(), reason);
    this.cancelledJobs += 1;
  }

  private reportJobError(job: InternalFrameWorkJobHandle, error: unknown): void {
    if (!this.onJobError) return;
    try {
      this.onJobError(job, error);
    } catch {
      // Error reporting must not destabilize the frame coordinator.
    }
  }
}

class InternalFrameWorkJobHandle implements FrameWorkJobHandle {
  readonly id: number;
  readonly label: string;
  readonly costKind: FrameWorkCostKind;
  readonly estimatedCostMs: number;
  readonly generation: FrameWorkGeneration | null;
  readonly queuedAtMs: number;
  private readonly executeJob: () => unknown;
  private readonly requestCancel: (job: InternalFrameWorkJobHandle, reason: string) => boolean;
  private readonly requestReprioritize: (
    job: InternalFrameWorkJobHandle,
    priority: FrameWorkPriority,
  ) => boolean;
  private currentState: FrameWorkJobState = 'queued';
  private currentPriority: FrameWorkPriority;
  private currentStartedAtMs: number | null = null;
  private currentSettledAtMs: number | null = null;
  private currentCancelReason: string | null = null;
  private currentFailure: unknown = null;

  constructor(
    id: number,
    spec: FrameWorkJobSpec,
    queuedAtMs: number,
    requestCancel: (job: InternalFrameWorkJobHandle, reason: string) => boolean,
    requestReprioritize: (
      job: InternalFrameWorkJobHandle,
      priority: FrameWorkPriority,
    ) => boolean,
  ) {
    this.id = id;
    this.label = spec.label;
    this.currentPriority = spec.priority;
    this.costKind = spec.costKind;
    this.estimatedCostMs = spec.estimatedCostMs;
    this.generation = spec.generation ?? null;
    this.executeJob = spec.execute;
    this.queuedAtMs = queuedAtMs;
    this.requestCancel = requestCancel;
    this.requestReprioritize = requestReprioritize;
  }

  get priority(): FrameWorkPriority {
    return this.currentPriority;
  }

  get state(): FrameWorkJobState {
    return this.currentState;
  }

  get startedAtMs(): number | null {
    return this.currentStartedAtMs;
  }

  get settledAtMs(): number | null {
    return this.currentSettledAtMs;
  }

  get cancelReason(): string | null {
    return this.currentCancelReason;
  }

  get failure(): unknown {
    return this.currentFailure;
  }

  cancel(reason = 'cancelled-by-caller'): boolean {
    return this.requestCancel(this, reason);
  }

  reprioritize(priority: FrameWorkPriority): boolean {
    return this.requestReprioritize(this, priority);
  }

  execute(): unknown {
    return this.executeJob();
  }

  markRunning(startedAtMs: number): void {
    this.currentState = 'running';
    this.currentStartedAtMs = startedAtMs;
  }

  markReprioritized(priority: FrameWorkPriority): void {
    this.currentPriority = priority;
  }

  markCompleted(settledAtMs: number): void {
    this.currentState = 'completed';
    this.currentSettledAtMs = settledAtMs;
  }

  markCancelled(settledAtMs: number, reason: string): void {
    this.currentState = 'cancelled';
    this.currentSettledAtMs = settledAtMs;
    this.currentCancelReason = reason;
  }

  markFailed(settledAtMs: number, failure: unknown): void {
    this.currentState = 'failed';
    this.currentSettledAtMs = settledAtMs;
    this.currentFailure = failure;
  }
}

function createPriorityQueues(): Record<FrameWorkPriority, InternalFrameWorkJobHandle[]> {
  return {
    'portal-current-destination': [],
    'predicted-destination-collision': [],
    'predicted-visuals-objects': [],
    teardown: [],
    'preview-cosmetic': [],
  };
}

function countQueuesByPriority(
  queues: Readonly<Record<FrameWorkPriority, readonly InternalFrameWorkJobHandle[]>>,
): Record<FrameWorkPriority, number> {
  return {
    'portal-current-destination': queues['portal-current-destination'].length,
    'predicted-destination-collision': queues['predicted-destination-collision'].length,
    'predicted-visuals-objects': queues['predicted-visuals-objects'].length,
    teardown: queues.teardown.length,
    'preview-cosmetic': queues['preview-cosmetic'].length,
  };
}

function assertJobSpec(spec: FrameWorkJobSpec): void {
  if (!spec.label.trim()) {
    throw new RangeError('Frame-work jobs require a non-empty label.');
  }
  assertPriority(spec.priority);
  if (spec.costKind !== 'cpu' && spec.costKind !== 'gpu-upload') {
    throw new RangeError(`Unknown frame-work cost kind: ${spec.costKind}.`);
  }
  if (
    !Number.isFinite(spec.estimatedCostMs)
    || spec.estimatedCostMs <= 0
    || spec.estimatedCostMs > MAX_ATOMIC_FRAME_WORK_ESTIMATE_MS
  ) {
    throw new RangeError(
      `Atomic frame-work estimates must be greater than 0 and at most ${MAX_ATOMIC_FRAME_WORK_ESTIMATE_MS} ms.`,
    );
  }
  if (
    spec.costKind === 'cpu'
    && spec.estimatedCostMs > MAX_REDUCED_CPU_FRAME_WORK_ESTIMATE_MS
  ) {
    throw new RangeError(
      `CPU frame-work estimates must be at most ${MAX_REDUCED_CPU_FRAME_WORK_ESTIMATE_MS} ms so they remain admissible in reduced frames.`,
    );
  }
}

function assertPriority(priority: FrameWorkPriority): void {
  if (!FRAME_WORK_PRIORITIES.includes(priority)) {
    throw new RangeError(`Unknown frame-work priority: ${priority}.`);
  }
}

function assertRunInput(input: RunFrameWorkInput): void {
  assertNonNegativeFinite(input.criticalHeadroomMs, 'Critical headroom');
  assertNonNegativeFinite(input.sharedBudgetConsumedMs ?? 0, 'Consumed shared budget');
  assertNonNegativeFinite(input.cpuBudgetConsumedMs ?? 0, 'Consumed CPU budget');
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative number.`);
  }
}

function assertScope(scope: string): string {
  const normalizedScope = scope.trim();
  if (!normalizedScope) {
    throw new RangeError('Frame-work generation scopes cannot be empty.');
  }
  return normalizedScope;
}

function normalizeReason(reason: string): string {
  return reason.trim() || 'cancelled';
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object'
    && value !== null
    && 'then' in value
    && typeof value.then === 'function'
  );
}
