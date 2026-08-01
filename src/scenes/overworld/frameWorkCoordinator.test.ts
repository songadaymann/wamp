import { describe, expect, it, vi } from 'vitest';
import {
  FRAME_WORK_LONG_JOB_THRESHOLD_MS,
  FrameWorkCoordinator,
  getFrameWorkBudget,
  MAX_ATOMIC_FRAME_WORK_ESTIMATE_MS,
  MAX_REDUCED_CPU_FRAME_WORK_ESTIMATE_MS,
  type FrameWorkCostKind,
  type FrameWorkJobHandle,
  type FrameWorkPriority,
} from './frameWorkCoordinator';

describe('FrameWorkCoordinator', () => {
  it('exposes the approved normal and reduced shared and CPU budgets', () => {
    expect(getFrameWorkBudget('normal')).toEqual({ sharedCeilingMs: 4, cpuSubCapMs: 2 });
    expect(getFrameWorkBudget('reduced')).toEqual({ sharedCeilingMs: 2, cpuSubCapMs: 1 });
  });

  it('runs strict priority order and FIFO within a priority', () => {
    const clock = new TestClock();
    const coordinator = createCoordinator(clock);
    const executionOrder: string[] = [];
    enqueue(coordinator, clock, executionOrder, 'preview', 'preview-cosmetic');
    enqueue(coordinator, clock, executionOrder, 'portal-a', 'portal-current-destination');
    enqueue(coordinator, clock, executionOrder, 'visual', 'predicted-visuals-objects');
    enqueue(coordinator, clock, executionOrder, 'portal-b', 'portal-current-destination');
    enqueue(coordinator, clock, executionOrder, 'collision', 'predicted-destination-collision');
    enqueue(coordinator, clock, executionOrder, 'teardown', 'teardown');

    const firstFrame = coordinator.runFrame({ profile: 'normal', criticalHeadroomMs: 4 });
    expect(executionOrder).toEqual(['portal-a', 'portal-b', 'collision', 'visual']);
    expect(firstFrame.queueDepthAfter).toBe(2);

    coordinator.runFrame({ profile: 'normal', criticalHeadroomMs: 4 });
    expect(executionOrder).toEqual([
      'portal-a',
      'portal-b',
      'collision',
      'visual',
      'teardown',
      'preview',
    ]);
  });

  it('reprioritizes queued work without jumping jobs already waiting at the new priority', () => {
    const clock = new TestClock();
    const coordinator = createCoordinator(clock);
    const executionOrder: string[] = [];
    const promoted = enqueue(
      coordinator,
      clock,
      executionOrder,
      'promoted-destination',
      'predicted-visuals-objects',
    );
    enqueue(
      coordinator,
      clock,
      executionOrder,
      'already-urgent',
      'portal-current-destination',
    );
    enqueue(
      coordinator,
      clock,
      executionOrder,
      'still-visual',
      'predicted-visuals-objects',
    );

    expect(promoted.reprioritize('portal-current-destination')).toBe(true);
    expect(promoted.priority).toBe('portal-current-destination');
    expect(coordinator.getDiagnostics().queueDepthByPriority).toMatchObject({
      'portal-current-destination': 2,
      'predicted-visuals-objects': 1,
    });

    coordinator.runFrame({ profile: 'normal', criticalHeadroomMs: 4 });
    expect(executionOrder).toEqual(['already-urgent', 'promoted-destination', 'still-visual']);
    expect(promoted.reprioritize('preview-cosmetic')).toBe(false);
  });

  it('does not reprioritize running or cancelled work', () => {
    const clock = new TestClock();
    const coordinator = createCoordinator(clock);
    let runningJob: FrameWorkJobHandle;
    runningJob = coordinator.enqueue({
      label: 'running',
      priority: 'predicted-visuals-objects',
      costKind: 'cpu',
      estimatedCostMs: 0.5,
      execute: () => {
        expect(runningJob.reprioritize('portal-current-destination')).toBe(false);
        clock.advance(0.5);
      },
    });
    const cancelledJob = coordinator.enqueue({
      label: 'cancelled',
      priority: 'preview-cosmetic',
      costKind: 'cpu',
      estimatedCostMs: 0.5,
      execute: vi.fn(),
    });
    expect(cancelledJob.cancel()).toBe(true);
    expect(cancelledJob.reprioritize('portal-current-destination')).toBe(false);

    coordinator.runFrame({ profile: 'normal', criticalHeadroomMs: 4 });
    expect(runningJob.state).toBe('completed');
    expect(runningJob.priority).toBe('predicted-visuals-objects');
  });

  it('enforces the CPU sub-cap separately from the shared ceiling', () => {
    const clock = new TestClock();
    const coordinator = createCoordinator(clock);
    const executionOrder: string[] = [];
    enqueue(coordinator, clock, executionOrder, 'cpu-a', 'portal-current-destination', 'cpu');
    enqueue(coordinator, clock, executionOrder, 'cpu-b', 'portal-current-destination', 'cpu');
    enqueue(coordinator, clock, executionOrder, 'cpu-c', 'portal-current-destination', 'cpu');

    const normal = coordinator.runFrame({ profile: 'normal', criticalHeadroomMs: 4 });
    expect(executionOrder).toEqual(['cpu-a', 'cpu-b']);
    expect(normal.chargedCpuWorkMs).toBe(2);
    expect(normal.stopReason).toBe('cpu-budget-exhausted');

    const reduced = coordinator.runFrame({ profile: 'reduced', criticalHeadroomMs: 2 });
    expect(executionOrder).toEqual(['cpu-a', 'cpu-b', 'cpu-c']);
    expect(reduced.chargedCpuWorkMs).toBe(1);
  });

  it('exposes queued urgent work without allocating diagnostics', () => {
    const clock = new TestClock();
    const coordinator = createCoordinator(clock);
    expect(coordinator.hasQueuedWorkAtPriority('portal-current-destination')).toBe(false);

    enqueue(
      coordinator,
      clock,
      [],
      'destination-runtime-shell',
      'portal-current-destination',
      'cpu',
      1,
    );

    expect(coordinator.hasQueuedWorkAtPriority('portal-current-destination')).toBe(true);
    coordinator.runFrame({ profile: 'reduced', criticalHeadroomMs: 2 });
    expect(coordinator.hasQueuedWorkAtPriority('portal-current-destination')).toBe(false);
  });

  it('rejects CPU jobs that would remain inadmissible across repeated reduced frames', () => {
    const clock = new TestClock();
    const coordinator = createCoordinator(clock);
    expect(() => coordinator.enqueue({
      label: 'permanently-blocked-cpu-stage',
      priority: 'portal-current-destination',
      costKind: 'cpu',
      estimatedCostMs: MAX_REDUCED_CPU_FRAME_WORK_ESTIMATE_MS + 0.1,
      execute: vi.fn(),
    })).toThrow(/at most 1 ms so they remain admissible in reduced frames/);

    for (let frame = 0; frame < 5; frame += 1) {
      const result = coordinator.runFrame({ profile: 'reduced', criticalHeadroomMs: 2 });
      expect(result.queueDepthAfter).toBe(0);
      expect(result.stopReason).toBe('queue-empty');
    }
    expect(coordinator.getDiagnostics()).toMatchObject({
      submittedJobs: 0,
      queueDepth: 0,
      framesRun: 5,
    });
  });

  it('shares the ceiling with already-consumed discretionary work', () => {
    const clock = new TestClock();
    const coordinator = createCoordinator(clock);
    const executionOrder: string[] = [];
    enqueue(coordinator, clock, executionOrder, 'upload-a', 'portal-current-destination');
    enqueue(coordinator, clock, executionOrder, 'upload-b', 'portal-current-destination');

    const result = coordinator.runFrame({
      profile: 'normal',
      criticalHeadroomMs: 4,
      sharedBudgetConsumedMs: 3,
    });
    expect(executionOrder).toEqual(['upload-a']);
    expect(result.stopReason).toBe('shared-budget-exhausted');
  });

  it('pauses without dequeuing when critical work leaves no headroom', () => {
    const clock = new TestClock();
    const coordinator = createCoordinator(clock);
    const executionOrder: string[] = [];
    const job = enqueue(coordinator, clock, executionOrder, 'collision', 'predicted-destination-collision');

    const result = coordinator.runFrame({ profile: 'normal', criticalHeadroomMs: 0 });
    expect(result.executed).toHaveLength(0);
    expect(result.stopReason).toBe('critical-headroom-exhausted');
    expect(job.state).toBe('queued');
    expect(coordinator.getDiagnostics().criticalHeadroomPausedFrames).toBe(1);
  });

  it('cancels older queued generations and rejects stale work with explicit state', () => {
    const clock = new TestClock();
    const coordinator = createCoordinator(clock);
    const first = coordinator.beginGeneration('room:5,7');
    const oldJob = coordinator.enqueue({
      label: 'old-room-build',
      priority: 'predicted-destination-collision',
      costKind: 'cpu',
      estimatedCostMs: 1,
      generation: first,
      execute: vi.fn(),
    });

    const second = coordinator.beginGeneration('room:5,7');
    expect(oldJob.state).toBe('cancelled');
    expect(oldJob.cancelReason).toBe('superseded-by-generation-2');

    const staleJob = coordinator.enqueue({
      label: 'late-old-stage',
      priority: 'predicted-visuals-objects',
      costKind: 'cpu',
      estimatedCostMs: 1,
      generation: first,
      execute: vi.fn(),
    });
    const latestJob = coordinator.enqueue({
      label: 'current-stage',
      priority: 'predicted-destination-collision',
      costKind: 'cpu',
      estimatedCostMs: 1,
      generation: second,
      execute: () => clock.advance(1),
    });
    expect(staleJob.state).toBe('cancelled');
    expect(coordinator.getDiagnostics()).toMatchObject({
      submittedJobs: 3,
      enqueuedJobs: 2,
      cancelledJobs: 2,
      queueDepth: 1,
    });

    coordinator.runFrame({ profile: 'normal', criticalHeadroomMs: 4 });
    expect(latestJob.state).toBe('completed');
  });

  it('assigns generation IDs globally across scopes while superseding only within a scope', () => {
    const coordinator = new FrameWorkCoordinator();

    const roomAFirst = coordinator.beginGeneration('room:a');
    const roomBFirst = coordinator.beginGeneration('room:b');
    const roomASecond = coordinator.beginGeneration('room:a');

    expect([roomAFirst.id, roomBFirst.id, roomASecond.id]).toEqual([1, 2, 3]);
    expect(new Set([roomAFirst.id, roomBFirst.id, roomASecond.id]).size).toBe(3);
    expect(coordinator.getDiagnostics().currentGenerations).toEqual({
      'room:a': 3,
      'room:b': 2,
    });
  });

  it('releases only the current generation after all queued stages drain', () => {
    const clock = new TestClock();
    const coordinator = createCoordinator(clock);
    const generation = coordinator.beginGeneration('room:release');
    coordinator.enqueue({
      label: 'release-stage',
      priority: 'predicted-destination-collision',
      costKind: 'cpu',
      estimatedCostMs: 0.5,
      generation,
      execute: () => clock.advance(0.5),
    });

    expect(coordinator.releaseGeneration(generation)).toBe(false);
    expect(coordinator.getDiagnostics().currentGenerations).toEqual({
      'room:release': generation.id,
    });

    coordinator.runFrame({ profile: 'normal', criticalHeadroomMs: 4 });

    expect(coordinator.releaseGeneration(generation)).toBe(true);
    expect(coordinator.releaseGeneration(generation)).toBe(false);
    expect(coordinator.getDiagnostics().currentGenerations).toEqual({});
  });

  it('keeps an idle current generation alive across an asynchronous stage gap', () => {
    const clock = new TestClock();
    const coordinator = createCoordinator(clock);
    const generation = coordinator.beginGeneration('room:await-custom-background');

    coordinator.runFrame({ profile: 'normal', criticalHeadroomMs: 4 });
    expect(coordinator.getDiagnostics().currentGenerations).toEqual({
      'room:await-custom-background': generation.id,
    });

    const resumed = coordinator.enqueue({
      label: 'resume-after-background-load',
      priority: 'predicted-visuals-objects',
      costKind: 'cpu',
      estimatedCostMs: 0.5,
      generation,
      execute: () => clock.advance(0.5),
    });
    coordinator.runFrame({ profile: 'normal', criticalHeadroomMs: 4 });

    expect(resumed.state).toBe('completed');
    expect(coordinator.releaseGeneration(generation)).toBe(true);
  });

  it('does not retire a newer scope when an obsolete generation is cancelled', () => {
    const coordinator = new FrameWorkCoordinator();
    const obsolete = coordinator.beginGeneration('room:shared');
    const current = coordinator.beginGeneration('room:shared');

    expect(coordinator.cancelGeneration(obsolete)).toBe(0);
    expect(coordinator.getDiagnostics().currentGenerations).toEqual({
      'room:shared': current.id,
    });
    expect(coordinator.releaseGeneration(current)).toBe(true);
  });

  it('retires cancelled and completed scopes instead of leaking diagnostic entries', () => {
    const coordinator = new FrameWorkCoordinator();

    for (let index = 0; index < 250; index += 1) {
      const generation = coordinator.beginGeneration(`preview:${index}`);
      if (index % 2 === 0) {
        expect(coordinator.releaseGeneration(generation)).toBe(true);
      } else {
        expect(coordinator.cancelGeneration(generation, 'preview-finished')).toBe(0);
      }
    }

    expect(coordinator.getDiagnostics().currentGenerations).toEqual({});
  });

  it('cancelAll retires idle generation scopes as well as queued work', () => {
    const coordinator = new FrameWorkCoordinator();
    coordinator.beginGeneration('idle:a');
    const queued = coordinator.beginGeneration('queued:b');
    coordinator.enqueue({
      label: 'queued-before-reset',
      priority: 'preview-cosmetic',
      costKind: 'cpu',
      estimatedCostMs: 0.5,
      generation: queued,
      execute: vi.fn(),
    });

    expect(coordinator.cancelAll('reset')).toBe(1);
    expect(coordinator.getDiagnostics()).toMatchObject({
      queueDepth: 0,
      cancelledJobs: 1,
      currentGenerations: {},
    });
  });

  it('supports explicit manual and generation cancellation', () => {
    const clock = new TestClock();
    const coordinator = createCoordinator(clock);
    const generation = coordinator.beginGeneration('preview:4,7');
    const manual = coordinator.enqueue({
      label: 'manual',
      priority: 'preview-cosmetic',
      costKind: 'cpu',
      estimatedCostMs: 0.5,
      execute: vi.fn(),
    });
    const generated = coordinator.enqueue({
      label: 'generated',
      priority: 'preview-cosmetic',
      costKind: 'gpu-upload',
      estimatedCostMs: 0.5,
      generation,
      execute: vi.fn(),
    });

    expect(manual.cancel('preview-left-window')).toBe(true);
    expect(manual.cancel()).toBe(false);
    expect(manual).toMatchObject({ state: 'cancelled', cancelReason: 'preview-left-window' });
    expect(coordinator.cancelGeneration(generation)).toBe(1);
    expect(generated).toMatchObject({ state: 'cancelled', cancelReason: 'generation-cancelled' });
  });

  it('uses estimates for admission and does not skip a blocked higher-priority head', () => {
    const clock = new TestClock();
    const coordinator = createCoordinator(clock);
    const executionOrder: string[] = [];
    enqueue(
      coordinator,
      clock,
      executionOrder,
      'portal',
      'portal-current-destination',
      'gpu-upload',
      2,
    );
    enqueue(coordinator, clock, executionOrder, 'preview', 'preview-cosmetic', 'gpu-upload', 0.5);

    const result = coordinator.runFrame({ profile: 'normal', criticalHeadroomMs: 1 });
    expect(result.executed).toHaveLength(0);
    expect(result.stopReason).toBe('critical-headroom-exhausted');
    expect(executionOrder).toEqual([]);
  });

  it('records actual atomic-job overshoot and stops scheduling more work', () => {
    const clock = new TestClock();
    const coordinator = createCoordinator(clock);
    const slowJob = coordinator.enqueue({
      label: 'unexpectedly-slow-stage',
      priority: 'portal-current-destination',
      costKind: 'cpu',
      estimatedCostMs: 1,
      execute: () => clock.advance(5),
    });
    const nextJob = coordinator.enqueue({
      label: 'next-stage',
      priority: 'portal-current-destination',
      costKind: 'cpu',
      estimatedCostMs: 1,
      execute: () => clock.advance(1),
    });

    const result = coordinator.runFrame({ profile: 'normal', criticalHeadroomMs: 4 });
    expect(slowJob.state).toBe('completed');
    expect(nextJob.state).toBe('queued');
    expect(result).toMatchObject({
      actualSharedWorkMs: 5,
      actualCpuWorkMs: 5,
      sharedOvershootMs: 1,
      cpuOvershootMs: 3,
      criticalHeadroomOvershootMs: 1,
      stopReason: 'shared-budget-exhausted',
    });
    expect(coordinator.getDiagnostics()).toMatchObject({
      maxActualJobDurationMs: 5,
      jobsOver50Ms: 0,
      overshootFrames: 1,
      totalSharedOvershootMs: 1,
      totalCpuOvershootMs: 3,
      totalCriticalHeadroomOvershootMs: 1,
    });
  });

  it('tracks the longest actual job and counts jobs strictly over 50 ms', () => {
    const clock = new TestClock();
    const coordinator = createCoordinator(clock);
    coordinator.enqueue({
      label: 'long-stage',
      priority: 'portal-current-destination',
      costKind: 'cpu',
      estimatedCostMs: 1,
      execute: () => clock.advance(FRAME_WORK_LONG_JOB_THRESHOLD_MS + 0.25),
    });

    coordinator.runFrame({ profile: 'normal', criticalHeadroomMs: 4 });

    coordinator.enqueue({
      label: 'threshold-stage',
      priority: 'portal-current-destination',
      costKind: 'cpu',
      estimatedCostMs: 1,
      execute: () => clock.advance(FRAME_WORK_LONG_JOB_THRESHOLD_MS),
    });
    coordinator.runFrame({ profile: 'normal', criticalHeadroomMs: 4 });

    expect(coordinator.getDiagnostics()).toMatchObject({
      maxActualJobDurationMs: FRAME_WORK_LONG_JOB_THRESHOLD_MS + 0.25,
      jobsOver50Ms: 1,
      completedJobs: 2,
    });
  });

  it('marks failures explicitly and reports them without running later jobs', () => {
    const clock = new TestClock();
    const error = new Error('texture stage failed');
    const onJobError = vi.fn();
    const coordinator = new FrameWorkCoordinator({ now: clock.now, onJobError });
    const failed = coordinator.enqueue({
      label: 'failed-stage',
      priority: 'portal-current-destination',
      costKind: 'cpu',
      estimatedCostMs: 0.5,
      execute: () => {
        clock.advance(0.25);
        throw error;
      },
    });
    const pending = coordinator.enqueue({
      label: 'pending-stage',
      priority: 'portal-current-destination',
      costKind: 'cpu',
      estimatedCostMs: 0.5,
      execute: vi.fn(),
    });

    const result = coordinator.runFrame({ profile: 'normal', criticalHeadroomMs: 4 });
    expect(result.stopReason).toBe('job-failed');
    expect(failed.state).toBe('failed');
    expect(failed.failure).toBe(error);
    expect(pending.state).toBe('queued');
    expect(onJobError).toHaveBeenCalledWith(failed, error);
  });

  it('rejects unbounded or asynchronous atomic jobs', () => {
    const clock = new TestClock();
    const coordinator = createCoordinator(clock);
    expect(() => coordinator.enqueue({
      label: 'too-large',
      priority: 'teardown',
      costKind: 'cpu',
      estimatedCostMs: MAX_ATOMIC_FRAME_WORK_ESTIMATE_MS + 0.1,
      execute: vi.fn(),
    })).toThrow(/at most 2 ms/);

    const asyncJob = coordinator.enqueue({
      label: 'async',
      priority: 'teardown',
      costKind: 'cpu',
      estimatedCostMs: 0.5,
      execute: async () => undefined,
    });
    const result = coordinator.runFrame({ profile: 'normal', criticalHeadroomMs: 4 });
    expect(result.stopReason).toBe('job-failed');
    expect(asyncJob.state).toBe('failed');
    expect(asyncJob.failure).toBeInstanceOf(TypeError);
  });
});

class TestClock {
  private currentMs = 0;
  readonly now = (): number => this.currentMs;

  advance(durationMs: number): void {
    this.currentMs += durationMs;
  }
}

function createCoordinator(clock: TestClock): FrameWorkCoordinator {
  return new FrameWorkCoordinator({ now: clock.now });
}

function enqueue(
  coordinator: FrameWorkCoordinator,
  clock: TestClock,
  executionOrder: string[],
  label: string,
  priority: FrameWorkPriority,
  costKind: FrameWorkCostKind = 'gpu-upload',
  estimatedCostMs = 1,
): FrameWorkJobHandle {
  return coordinator.enqueue({
    label,
    priority,
    costKind,
    estimatedCostMs,
    execute: () => {
      executionOrder.push(label);
      clock.advance(estimatedCostMs);
    },
  });
}
