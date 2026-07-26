export type RenderLoopRecoveryReason =
  | 'runtime-error'
  | 'user-activity'
  | 'visibility-resume'
  | 'verification-retry';

interface TimerScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(timer: unknown): void;
}

interface RuntimeErrorDetails {
  message: string;
  source: string | null;
  line: number | null;
  column: number | null;
}

interface RenderLoopRecoveryOptions {
  restartLoop: () => void;
  isEligible: () => boolean;
  now?: () => number;
  scheduler?: TimerScheduler;
  stallThresholdMs?: number;
  verificationDelayMs?: number;
  maxConsecutiveAttempts?: number;
  log?: (
    phase: 'stalled' | 'restarted' | 'restart-failed' | 'exhausted',
    details: Record<string, unknown>,
  ) => void;
}

export interface RenderLoopRecoveryDebugState {
  lastRenderAtMs: number | null;
  lastUserActivityAtMs: number | null;
  lastRuntimeErrorAtMs: number | null;
  lastRuntimeError: RuntimeErrorDetails | null;
  restartCount: number;
  failedRestartCount: number;
  consecutiveRestartAttempts: number;
  lastRestartAtMs: number | null;
  lastRestartReason: RenderLoopRecoveryReason | null;
  exhaustedCount: number;
}

export interface RenderLoopRecoveryMonitor {
  recordRender(atMs?: number): void;
  notifyUserActivity(): void;
  notifyVisibilityResume(): void;
  notifyRuntimeError(details: RuntimeErrorDetails): void;
  getDebugState(): RenderLoopRecoveryDebugState;
  destroy(): void;
}

const DEFAULT_STALL_THRESHOLD_MS = 750;
const DEFAULT_VERIFICATION_DELAY_MS = 500;
const DEFAULT_MAX_CONSECUTIVE_ATTEMPTS = 2;

/**
 * A Phaser RAF callback that throws never schedules its successor, while both
 * TimeStep.running and RequestAnimationFrame.isRunning remain true. Watch the
 * actual POST_RENDER heartbeat and restart that orphaned RAF chain only after
 * recent user activity, a runtime error, or a visible-page resume.
 */
export function installRenderLoopRecoveryMonitor(
  options: RenderLoopRecoveryOptions,
): RenderLoopRecoveryMonitor {
  const now = options.now ?? (() => performance.now());
  const scheduler = options.scheduler ?? {
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (timer) => window.clearTimeout(timer as number),
  };
  const stallThresholdMs = options.stallThresholdMs ?? DEFAULT_STALL_THRESHOLD_MS;
  const verificationDelayMs = options.verificationDelayMs ?? DEFAULT_VERIFICATION_DELAY_MS;
  const maxConsecutiveAttempts =
    options.maxConsecutiveAttempts ?? DEFAULT_MAX_CONSECUTIVE_ATTEMPTS;
  let checkTimer: unknown = null;
  let verificationTimer: unknown = null;
  let destroyed = false;
  let restartInProgress = false;
  const debug: RenderLoopRecoveryDebugState = {
    lastRenderAtMs: null,
    lastUserActivityAtMs: null,
    lastRuntimeErrorAtMs: null,
    lastRuntimeError: null,
    restartCount: 0,
    failedRestartCount: 0,
    consecutiveRestartAttempts: 0,
    lastRestartAtMs: null,
    lastRestartReason: null,
    exhaustedCount: 0,
  };

  const clearTimer = (timer: unknown): null => {
    if (timer !== null) scheduler.clearTimeout(timer);
    return null;
  };

  const scheduleVerification = (
    previousRenderAtMs: number | null,
  ) => {
    verificationTimer = clearTimer(verificationTimer);
    verificationTimer = scheduler.setTimeout(() => {
      verificationTimer = null;
      if (destroyed || !options.isEligible()) return;
      if (
        debug.lastRenderAtMs !== null
        && (previousRenderAtMs === null || debug.lastRenderAtMs > previousRenderAtMs)
      ) {
        debug.consecutiveRestartAttempts = 0;
        return;
      }
      if (debug.consecutiveRestartAttempts >= maxConsecutiveAttempts) {
        debug.exhaustedCount += 1;
        options.log?.('exhausted', {
          attempts: debug.consecutiveRestartAttempts,
          lastRestartReason: debug.lastRestartReason,
          lastRenderAtMs: debug.lastRenderAtMs,
        });
        return;
      }
      attemptRestart('verification-retry');
    }, verificationDelayMs);
  };

  const attemptRestart = (reason: RenderLoopRecoveryReason) => {
    if (
      destroyed
      || restartInProgress
      || !options.isEligible()
      || debug.consecutiveRestartAttempts >= maxConsecutiveAttempts
    ) return;
    const restartAtMs = now();
    const previousRenderAtMs = debug.lastRenderAtMs;
    debug.consecutiveRestartAttempts += 1;
    debug.lastRestartAtMs = restartAtMs;
    debug.lastRestartReason = reason;
    options.log?.('stalled', {
      reason,
      renderAgeMs: previousRenderAtMs === null
        ? null
        : Math.max(0, Math.round(restartAtMs - previousRenderAtMs)),
      attempt: debug.consecutiveRestartAttempts,
    });
    restartInProgress = true;
    try {
      options.restartLoop();
      debug.restartCount += 1;
      options.log?.('restarted', {
        reason,
        attempt: debug.consecutiveRestartAttempts,
      });
    } catch (error) {
      debug.failedRestartCount += 1;
      options.log?.('restart-failed', {
        reason,
        attempt: debug.consecutiveRestartAttempts,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      restartInProgress = false;
    }
    scheduleVerification(previousRenderAtMs);
  };

  const scheduleStallCheck = (reason: RenderLoopRecoveryReason) => {
    if (destroyed) return;
    checkTimer = clearTimer(checkTimer);
    const currentNowMs = now();
    const renderAgeMs = debug.lastRenderAtMs === null
      ? stallThresholdMs
      : Math.max(0, currentNowMs - debug.lastRenderAtMs);
    const delayMs = Math.max(0, stallThresholdMs - renderAgeMs);
    checkTimer = scheduler.setTimeout(() => {
      checkTimer = null;
      if (destroyed || !options.isEligible()) return;
      const checkedAtMs = now();
      const currentRenderAgeMs = debug.lastRenderAtMs === null
        ? stallThresholdMs
        : Math.max(0, checkedAtMs - debug.lastRenderAtMs);
      if (currentRenderAgeMs < stallThresholdMs) return;
      attemptRestart(reason);
    }, delayMs);
  };

  return {
    recordRender: (atMs = now()) => {
      debug.lastRenderAtMs = atMs;
      debug.consecutiveRestartAttempts = 0;
      verificationTimer = clearTimer(verificationTimer);
    },
    notifyUserActivity: () => {
      debug.lastUserActivityAtMs = now();
      scheduleStallCheck('user-activity');
    },
    notifyVisibilityResume: () => {
      scheduleStallCheck('visibility-resume');
    },
    notifyRuntimeError: (details) => {
      debug.lastRuntimeErrorAtMs = now();
      debug.lastRuntimeError = { ...details };
      scheduleStallCheck('runtime-error');
    },
    getDebugState: () => ({
      ...debug,
      lastRuntimeError: debug.lastRuntimeError ? { ...debug.lastRuntimeError } : null,
    }),
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      checkTimer = clearTimer(checkTimer);
      verificationTimer = clearTimer(verificationTimer);
    },
  };
}
