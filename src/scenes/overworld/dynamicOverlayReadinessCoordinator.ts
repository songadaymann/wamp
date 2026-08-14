export interface DynamicOverlayRetryTimer {
  remove(dispatchCallback?: boolean): unknown;
}

export interface DynamicOverlayReadinessWaitOptions {
  generation: number;
  isGenerationCurrent: () => boolean;
  isBrowseCutoverActive: () => boolean;
  waitForTargetLodReady: (signal: AbortSignal) => Promise<boolean>;
  onCurrentReadinessStopped: () => void;
}

export interface DynamicOverlayRetryOptions {
  generation: number;
  schedule: (delayMs: number, callback: () => void) => DynamicOverlayRetryTimer;
  isGenerationCurrent: () => boolean;
  isGenerationIdentityCurrent: () => boolean;
  isBrowseCutoverActive: () => boolean;
  onCurrentRetryStopped: () => void;
  retry: () => void;
}

const DEFAULT_RETRY_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000] as const;

export class DynamicOverlayReadinessCoordinator {
  private readinessGeneration = -1;
  private readinessAbortController: AbortController | null = null;
  private retryAttempt = 0;
  private retryTimer: DynamicOverlayRetryTimer | null = null;

  constructor(
    private readonly retryDelaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
  ) {
    if (retryDelaysMs.length === 0) {
      throw new Error('Dynamic overlay retries require at least one delay.');
    }
  }

  beginReadiness(generation: number): void {
    this.cancelReadiness();
    this.readinessGeneration = generation;
    this.readinessAbortController = new AbortController();
  }

  cancelReadiness(): void {
    this.readinessAbortController?.abort();
    this.readinessAbortController = null;
    this.readinessGeneration = -1;
  }

  async waitForTargetLod(options: DynamicOverlayReadinessWaitOptions): Promise<boolean> {
    const abortController = this.readinessAbortController;
    if (
      !abortController ||
      this.readinessGeneration !== options.generation ||
      !options.isGenerationCurrent() ||
      !options.isBrowseCutoverActive()
    ) return false;

    const ready = await options.waitForTargetLodReady(abortController.signal);
    const current = ready
      && this.readinessGeneration === options.generation
      && options.isGenerationCurrent()
      && options.isBrowseCutoverActive();
    if (!current && options.isGenerationCurrent()) {
      options.onCurrentReadinessStopped();
    }
    return current;
  }

  scheduleRetry(options: DynamicOverlayRetryOptions): boolean {
    if (this.retryTimer) return false;
    const retryIndex = Math.min(this.retryAttempt, this.retryDelaysMs.length - 1);
    const retryDelay = this.retryDelaysMs[retryIndex];
    this.retryAttempt += 1;
    this.retryTimer = options.schedule(retryDelay, () => {
      this.retryTimer = null;
      if (!options.isGenerationCurrent() || !options.isBrowseCutoverActive()) {
        if (options.isGenerationIdentityCurrent()) {
          options.onCurrentRetryStopped();
        }
        return;
      }
      options.retry();
    });
    return true;
  }

  cancelRetry(): void {
    this.retryTimer?.remove(false);
    this.retryTimer = null;
    this.retryAttempt = 0;
  }

  reset(): void {
    this.cancelReadiness();
    this.cancelRetry();
  }

  getReadinessGeneration(): number {
    return this.readinessGeneration;
  }

  getReadinessSignal(): AbortSignal | null {
    return this.readinessAbortController?.signal ?? null;
  }

  hasRetryScheduled(): boolean {
    return this.retryTimer !== null;
  }
}
