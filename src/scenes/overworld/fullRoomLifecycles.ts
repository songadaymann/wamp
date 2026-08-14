export type FullRoomPreparationPhase =
  | 'textures'
  | 'uploads'
  | 'custom-tiles'
  | 'custom-background'
  | 'runtime-shell'
  | 'terrain'
  | 'terrain-collision'
  | 'terrain-insets'
  | 'lighting'
  | 'objects'
  | 'ready'
  | 'commit'
  | 'waiting-for-teardown'
  | 'committed'
  | 'cancelled'
  | 'failed';

export interface FullRoomPreparationLifecycleState {
  phase: FullRoomPreparationPhase;
  activationRequested: boolean;
  standardActivationRequested: boolean;
  portalActivationRequested: boolean;
}

export type FullRoomActivationOwner = 'standard' | 'portal';

export class FullRoomPreparationLifecycleCoordinator {
  requestActivation(
    preparation: FullRoomPreparationLifecycleState,
    owner: FullRoomActivationOwner,
  ): boolean {
    if (owner === 'portal') {
      preparation.portalActivationRequested = true;
    } else {
      preparation.standardActivationRequested = true;
    }
    this.syncActivation(preparation);
    return preparation.phase === 'ready';
  }

  releaseActivation(
    preparation: FullRoomPreparationLifecycleState,
    owner: FullRoomActivationOwner,
  ): boolean {
    if (owner === 'portal') {
      preparation.portalActivationRequested = false;
    } else {
      preparation.standardActivationRequested = false;
    }
    this.syncActivation(preparation);
    return preparation.activationRequested;
  }

  inheritActivation(
    preparation: FullRoomPreparationLifecycleState,
    standardActivationRequested: boolean,
    portalActivationRequested: boolean,
  ): void {
    preparation.standardActivationRequested ||= standardActivationRequested;
    preparation.portalActivationRequested ||= portalActivationRequested;
    this.syncActivation(preparation);
  }

  markReady(preparation: FullRoomPreparationLifecycleState): boolean {
    preparation.phase = 'ready';
    return preparation.activationRequested;
  }

  beginCommit(preparation: FullRoomPreparationLifecycleState): boolean {
    if (preparation.phase === 'commit' || preparation.phase === 'committed') return false;
    preparation.phase = 'commit';
    return true;
  }

  waitForTeardown(preparation: FullRoomPreparationLifecycleState): void {
    preparation.phase = 'waiting-for-teardown';
  }

  returnToReady(preparation: FullRoomPreparationLifecycleState): void {
    preparation.phase = 'ready';
  }

  markCommitted(preparation: FullRoomPreparationLifecycleState): void {
    preparation.phase = 'committed';
  }

  markCancelled(preparation: FullRoomPreparationLifecycleState): void {
    preparation.phase = 'cancelled';
  }

  markFailed(preparation: FullRoomPreparationLifecycleState): void {
    preparation.phase = 'failed';
  }

  isProgressable(preparation: Pick<FullRoomPreparationLifecycleState, 'phase'>): boolean {
    return preparation.phase !== 'cancelled' && preparation.phase !== 'failed';
  }

  private syncActivation(preparation: FullRoomPreparationLifecycleState): void {
    preparation.activationRequested = Boolean(
      preparation.standardActivationRequested || preparation.portalActivationRequested,
    );
  }
}

export type FullRoomTeardownPhase =
  | 'queued'
  | 'objects'
  | 'collision'
  | 'insets'
  | 'terrain'
  | 'backgrounds'
  | 'display'
  | 'finalize';

export interface FullRoomTeardownLifecycleState<TPreparation> {
  phase: FullRoomTeardownPhase;
  destructionStarted: boolean;
  retainedAfterDestruction: boolean;
  commitAfterTeardown: TPreparation | null;
}

export type DeferredPreparationResolution<TPreparation> =
  | { action: 'commit'; preparation: TPreparation }
  | { action: 'cancel'; preparation: TPreparation }
  | { action: 'none'; preparation: null };

export interface FullRoomTeardownReconciliationState {
  required: boolean;
  generation: number | null;
}

export interface FullRoomTeardownReconciliationResolution {
  action: 'wait' | 'skip-stale' | 'reconcile' | 'none';
  state: FullRoomTeardownReconciliationState;
}

export class FullRoomTeardownLifecycleCoordinator {
  beginDestruction<TPreparation>(
    teardown: FullRoomTeardownLifecycleState<TPreparation>,
  ): void {
    teardown.destructionStarted = true;
    if (teardown.phase === 'queued') teardown.phase = 'objects';
  }

  retainAfterDestruction<TPreparation>(
    teardown: FullRoomTeardownLifecycleState<TPreparation>,
  ): void {
    teardown.retainedAfterDestruction = true;
  }

  advance<TPreparation>(
    teardown: FullRoomTeardownLifecycleState<TPreparation>,
    phase: FullRoomTeardownPhase,
  ): void {
    teardown.phase = phase;
  }

  attachDeferredCommit<TPreparation>(
    teardown: FullRoomTeardownLifecycleState<TPreparation>,
    preparation: TPreparation,
  ): void {
    teardown.commitAfterTeardown = preparation;
  }

  clearDeferredCommit<TPreparation>(
    teardown: FullRoomTeardownLifecycleState<TPreparation>,
  ): TPreparation | null {
    const preparation = teardown.commitAfterTeardown;
    teardown.commitAfterTeardown = null;
    return preparation;
  }

  resolveDeferredCommit<TPreparation>(
    teardown: FullRoomTeardownLifecycleState<TPreparation>,
    canCommit: (preparation: TPreparation) => boolean,
  ): DeferredPreparationResolution<TPreparation> {
    const preparation = this.clearDeferredCommit(teardown);
    if (!preparation) return { action: 'none', preparation: null };
    return canCommit(preparation)
      ? { action: 'commit', preparation }
      : { action: 'cancel', preparation };
  }

  requestReconciliation(
    generation: number | null,
  ): FullRoomTeardownReconciliationState {
    return { required: true, generation };
  }

  consumeReconciliation(input: {
    state: FullRoomTeardownReconciliationState;
    pendingTeardownCount: number;
    currentGeneration: number | null;
  }): FullRoomTeardownReconciliationResolution {
    if (input.pendingTeardownCount > 0) {
      return { action: 'wait', state: input.state };
    }
    if (!input.state.required) {
      return { action: 'none', state: input.state };
    }
    const clearedState = this.clearReconciliation();
    if (
      input.state.generation !== null
      && input.currentGeneration !== input.state.generation
    ) return { action: 'skip-stale', state: clearedState };
    return { action: 'reconcile', state: clearedState };
  }

  clearReconciliation(): FullRoomTeardownReconciliationState {
    return { required: false, generation: null };
  }
}
