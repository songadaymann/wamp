import type { OverworldMode } from '../sceneData';

interface BrowseRealtimeStartupGateOptions {
  getMode(): OverworldMode;
  waitForBrowseReady(signal: AbortSignal): Promise<boolean>;
  applySubscriptions(): void;
  onWaitError?(error: unknown): void;
}

interface PendingBrowseReadiness {
  controller: AbortController;
  generation: number;
}

/**
 * Keeps the initial browse presence/chat fan-out off the critical tile path.
 * Once startup is released, later subscription updates remain synchronous.
 */
export class BrowseRealtimeStartupGate {
  private generation = 0;
  private pending: PendingBrowseReadiness | null = null;
  private released = false;

  constructor(private readonly options: BrowseRealtimeStartupGateOptions) {}

  request(): void {
    if (this.released) {
      this.options.applySubscriptions();
      return;
    }

    if (this.options.getMode() !== 'browse') {
      this.cancelPending();
      this.released = true;
      this.options.applySubscriptions();
      return;
    }

    if (this.pending) return;

    const pending: PendingBrowseReadiness = {
      controller: new AbortController(),
      generation: ++this.generation,
    };
    this.pending = pending;
    void this.options.waitForBrowseReady(pending.controller.signal).then(
      (ready) => this.handleReady(pending, ready),
      (error) => this.handleWaitError(pending, error),
    );
  }

  reset(): void {
    this.cancelPending();
    this.released = false;
  }

  destroy(): void {
    this.reset();
  }

  private handleReady(pending: PendingBrowseReadiness, ready: boolean): void {
    if (!this.isCurrent(pending)) return;
    this.pending = null;
    if (!ready) return;

    this.released = true;
    this.options.applySubscriptions();
  }

  private handleWaitError(pending: PendingBrowseReadiness, error: unknown): void {
    if (!this.isCurrent(pending)) return;
    this.pending = null;
    if (!pending.controller.signal.aborted) this.options.onWaitError?.(error);
  }

  private isCurrent(pending: PendingBrowseReadiness): boolean {
    return (
      this.pending === pending
      && pending.generation === this.generation
      && !pending.controller.signal.aborted
    );
  }

  private cancelPending(): void {
    this.generation += 1;
    this.pending?.controller.abort();
    this.pending = null;
  }
}
