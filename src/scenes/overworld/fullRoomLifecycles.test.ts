import { describe, expect, it } from 'vitest';
import {
  FullRoomPreparationLifecycleCoordinator,
  FullRoomTeardownLifecycleCoordinator,
  type FullRoomPreparationLifecycleState,
  type FullRoomTeardownLifecycleState,
} from './fullRoomLifecycles';

describe('full-room preparation lifecycle', () => {
  it('keeps standard and portal activation ownership independent', () => {
    const coordinator = new FullRoomPreparationLifecycleCoordinator();
    const preparation = state('objects');

    expect(coordinator.requestActivation(preparation, 'standard')).toBe(false);
    expect(preparation).toMatchObject({
      activationRequested: true,
      standardActivationRequested: true,
      portalActivationRequested: false,
    });
    coordinator.requestActivation(preparation, 'portal');
    expect(coordinator.releaseActivation(preparation, 'standard')).toBe(true);
    expect(coordinator.releaseActivation(preparation, 'portal')).toBe(false);
  });

  it('queues activation only once ready and preserves cancellation/commit terminals', () => {
    const coordinator = new FullRoomPreparationLifecycleCoordinator();
    const preparation = state('objects');
    coordinator.requestActivation(preparation, 'standard');

    expect(coordinator.markReady(preparation)).toBe(true);
    expect(coordinator.beginCommit(preparation)).toBe(true);
    expect(coordinator.beginCommit(preparation)).toBe(false);
    coordinator.waitForTeardown(preparation);
    coordinator.returnToReady(preparation);
    coordinator.markCommitted(preparation);
    expect(coordinator.isProgressable(preparation)).toBe(true);
    coordinator.markCancelled(preparation);
    expect(coordinator.isProgressable(preparation)).toBe(false);
    coordinator.markFailed(preparation);
    expect(coordinator.isProgressable(preparation)).toBe(false);
  });
});

describe('full-room teardown lifecycle', () => {
  it('owns phase progression, retention, and one-shot deferred commit resolution', () => {
    const coordinator = new FullRoomTeardownLifecycleCoordinator();
    const teardown = teardownState<string>();
    coordinator.beginDestruction(teardown);
    coordinator.advance(teardown, 'collision');
    coordinator.retainAfterDestruction(teardown);
    coordinator.attachDeferredCommit(teardown, 'v2');

    expect(teardown).toMatchObject({
      phase: 'collision',
      destructionStarted: true,
      retainedAfterDestruction: true,
      commitAfterTeardown: 'v2',
    });
    expect(coordinator.resolveDeferredCommit(teardown, (value) => value === 'v2')).toEqual({
      action: 'commit',
      preparation: 'v2',
    });
    expect(coordinator.resolveDeferredCommit(teardown, () => true)).toEqual({
      action: 'none',
      preparation: null,
    });
  });

  it('cancels stale deferred commits and interlocks reconciliation with pending teardown', () => {
    const coordinator = new FullRoomTeardownLifecycleCoordinator();
    const teardown = teardownState<string>();
    coordinator.attachDeferredCommit(teardown, 'stale');
    expect(coordinator.resolveDeferredCommit(teardown, () => false)).toEqual({
      action: 'cancel',
      preparation: 'stale',
    });

    const requested = coordinator.requestReconciliation(7);
    const waiting = coordinator.consumeReconciliation({
      state: requested,
      pendingTeardownCount: 1,
      currentGeneration: 7,
    });
    expect(waiting).toEqual({ action: 'wait', state: requested });
    expect(coordinator.consumeReconciliation({
      state: waiting.state,
      pendingTeardownCount: 0,
      currentGeneration: 8,
    })).toEqual({
      action: 'skip-stale',
      state: { required: false, generation: null },
    });

    const generationAgnostic = coordinator.requestReconciliation(null);
    expect(coordinator.consumeReconciliation({
      state: generationAgnostic,
      pendingTeardownCount: 0,
      currentGeneration: 9,
    })).toEqual({
      action: 'reconcile',
      state: { required: false, generation: null },
    });
  });
});

function state(phase: FullRoomPreparationLifecycleState['phase']): FullRoomPreparationLifecycleState {
  return {
    phase,
    activationRequested: false,
    standardActivationRequested: false,
    portalActivationRequested: false,
  };
}

function teardownState<TPreparation>(): FullRoomTeardownLifecycleState<TPreparation> {
  return {
    phase: 'queued',
    destructionStarted: false,
    retainedAfterDestruction: false,
    commitAfterTeardown: null,
  };
}
