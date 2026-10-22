import type { RunResult } from './model';

/** A stalled cellular request must not leave the HUD on "Submitting run..." for minutes. */
export const RANKED_FINISH_TIMEOUT_MS = 15_000;
// Browsers reject a keepalive request whose body would exceed their 64 KiB budget; long traces do.
const KEEPALIVE_MAX_BODY_BYTES = 60_000;
/**
 * Signed-in ranked finishes resend from memory while the page is open (F351). The server records
 * its own later clock on a late resend, so the automatic retries stay quick.
 */
export const RANKED_FINISH_RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000, 10_000];

export type RankedFinishRetryState = 'waiting' | 'sending';
export interface RankedFinishRunStatus {
  submissionMessage: string | null;
  /** Set while a finish that failed to send is waiting for, or making, another attempt. */
  finishRetry?: RankedFinishRetryState | null;
}

export interface RankedFinishRetryEnvironment {
  isVisible(): boolean;
  isOnline(): boolean;
  /** Calls `wake` on the 'online' event and when the page becomes visible; returns the unsubscribe. */
  onWake(wake: () => void): () => void;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export function rankedFinishRequestInit(body: unknown): RequestInit {
  const json = JSON.stringify(body);
  return {
    method: 'POST',
    body: json,
    signal: AbortSignal.timeout(RANKED_FINISH_TIMEOUT_MS),
    // keepalive lets a short finish complete after the phone locks; a long trace sends without it.
    keepalive: new TextEncoder().encode(json).byteLength <= KEEPALIVE_MAX_BODY_BYTES,
  };
}

/**
 * Only an unanswered request, a 5xx, 408, 425 or 429 is resent. Every other 4xx (including a
 * verification 409, whose row the server has already finalized) is the final answer.
 */
export function isRetryableRankedFinishError(error: unknown): boolean {
  const status = errorStatus(error);
  return status === null || status >= 500 || status === 408 || status === 425 || status === 429;
}

const pendingDeliveries = new Set<RankedFinishDelivery>();

/** The run HUD's Retry button resends every waiting ranked finish now. */
export function retryPendingRankedFinishes(): void {
  for (const delivery of [...pendingDeliveries]) delivery.retryNow();
}

interface RankedFinishDeliveryOptions {
  onWaiting?: (error: unknown) => void;
  onRetrying?: () => void;
  env?: RankedFinishRetryEnvironment;
  delaysMs?: readonly number[];
}

/** Holds one already-built finish payload until the server answers it. */
export class RankedFinishDelivery {
  readonly done: Promise<void>;
  private readonly env: RankedFinishRetryEnvironment;
  private readonly delaysMs: readonly number[];
  private failures = 0;
  private sending = false;
  private settled = false;
  private timer: unknown = null;
  private unsubscribe: (() => void) | null = null;
  private resolve!: () => void;
  private reject!: (error: unknown) => void;

  constructor(private readonly send: () => Promise<void>, private readonly options: RankedFinishDeliveryOptions = {}) {
    this.env = options.env ?? browserRetryEnvironment();
    this.delaysMs = options.delaysMs ?? RANKED_FINISH_RETRY_DELAYS_MS;
    this.done = new Promise<void>((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    void this.attempt();
  }

  get waiting(): boolean {
    return !this.settled && !this.sending && this.failures > 0;
  }

  retryNow(): void {
    if (!this.waiting) return;
    this.clearTimer();
    void this.attempt();
  }

  private async attempt(): Promise<void> {
    this.sending = true;
    if (this.failures > 0) this.options.onRetrying?.();
    try {
      await this.send();
    } catch (error) {
      if (!isRetryableRankedFinishError(error)) {
        this.settle();
        this.reject(error);
        return;
      }
      this.sending = false;
      this.failures += 1;
      if (!this.unsubscribe) {
        pendingDeliveries.add(this);
        this.unsubscribe = this.env.onWake(() => this.retryNow());
      }
      this.options.onWaiting?.(error);
      const delay = this.delaysMs[this.failures - 1];
      if (delay !== undefined) {
        this.timer = this.env.setTimeout(() => {
          this.timer = null;
          // A hidden page waits for visibilitychange instead of spending its retries in the dark.
          if (this.env.isVisible()) this.retryNow();
        }, delay);
      }
      return;
    }
    this.settle();
    this.resolve();
  }

  private settle(): void {
    this.settled = true;
    this.sending = false;
    this.clearTimer();
    this.unsubscribe?.();
    this.unsubscribe = null;
    pendingDeliveries.delete(this);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    this.env.clearTimeout(this.timer);
    this.timer = null;
  }
}

/** Sends a ranked finish with retries, keeping `run`'s status text current for the HUD. */
export function deliverRankedFinish(
  run: RankedFinishRunStatus,
  result: Exclude<RunResult, 'active'>,
  send: () => Promise<void>,
  options: { onChange?: () => void; env?: RankedFinishRetryEnvironment } = {},
): Promise<void> {
  const env = options.env ?? browserRetryEnvironment();
  const noun = result === 'completed' ? 'clear' : 'run';
  const delivery = new RankedFinishDelivery(send, {
    env,
    onWaiting: (error) => {
      run.finishRetry = 'waiting';
      const reason = errorStatus(error) !== null ? 'server busy' : env.isOnline() ? 'connection lost' : 'no connection';
      run.submissionMessage = `Saving your ${noun}... ${reason}, will retry.`;
      options.onChange?.();
    },
    onRetrying: () => {
      run.finishRetry = 'sending';
      run.submissionMessage = `Saving your ${noun}...`;
      options.onChange?.();
    },
  });
  return delivery.done.finally(() => { run.finishRetry = null; });
}

function errorStatus(error: unknown): number | null {
  return typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
    ? error.status : null;
}

function browserRetryEnvironment(): RankedFinishRetryEnvironment {
  const win = typeof window === 'undefined' ? null : window;
  return {
    isVisible: () => win?.document?.visibilityState !== 'hidden',
    isOnline: () => win?.navigator?.onLine !== false,
    onWake: (wake) => {
      if (!win) return () => {};
      const onVisible = () => { if (win.document.visibilityState !== 'hidden') wake(); };
      win.addEventListener('online', wake);
      win.document.addEventListener('visibilitychange', onVisible);
      return () => {
        win.removeEventListener('online', wake);
        win.document.removeEventListener('visibilitychange', onVisible);
      };
    },
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}
