export const WEBGL_CONTEXT_LOST_EVENT = 'losewebgl';
export const WEBGL_CONTEXT_RESTORED_EVENT = 'restorewebgl';
export const WEBGL_RECOVERY_RELOAD_STORAGE_KEY = 'wamp:webgl-recovery:last-reload-at';

const DEFAULT_RECOVERY_DELAY_MS = 4_000;
const DEFAULT_RELOAD_COOLDOWN_MS = 60_000;

type WebglRecoveryStatus =
  | 'healthy'
  | 'lost'
  | 'auto-reload'
  | 'manual-recovery';

type WebglRecoveryMode = 'browse' | 'protected';

interface RendererEventSource {
  on(event: string, listener: () => void): unknown;
  off(event: string, listener: () => void): unknown;
}

interface TimerScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(timer: unknown): void;
}

interface WebglRecoveryMonitorOptions {
  renderer: RendererEventSource;
  getMode: () => WebglRecoveryMode;
  reloadPage: () => void;
  showManualRecovery: () => void;
  hideManualRecovery: () => void;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  now?: () => number;
  scheduler?: TimerScheduler;
  recoveryDelayMs?: number;
  reloadCooldownMs?: number;
  log?: (
    phase: 'lost' | 'restored' | 'auto-reload' | 'manual-recovery',
    details: Record<string, unknown>,
  ) => void;
}

export interface WebglRecoveryDebugState {
  status: WebglRecoveryStatus;
  lossCount: number;
  restoreCount: number;
  lastLostAtMs: number | null;
  lastRestoredAtMs: number | null;
  lastLossDurationMs: number | null;
  lastAutoReloadAtMs: number | null;
  autoReloadAttempts: number;
  manualRecoveryPrompts: number;
}

export interface WebglRecoveryMonitor {
  getDebugState(): WebglRecoveryDebugState;
  destroy(): void;
}

export function installWebglRecoveryMonitor(
  options: WebglRecoveryMonitorOptions,
): WebglRecoveryMonitor {
  const now = options.now ?? Date.now;
  const scheduler = options.scheduler ?? {
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (timer) => window.clearTimeout(timer as number),
  };
  const recoveryDelayMs = options.recoveryDelayMs ?? DEFAULT_RECOVERY_DELAY_MS;
  const reloadCooldownMs = options.reloadCooldownMs ?? DEFAULT_RELOAD_COOLDOWN_MS;
  let recoveryTimer: unknown = null;
  let manualRecoveryVisible = false;
  let destroyed = false;
  const debug: WebglRecoveryDebugState = {
    status: 'healthy',
    lossCount: 0,
    restoreCount: 0,
    lastLostAtMs: null,
    lastRestoredAtMs: null,
    lastLossDurationMs: null,
    lastAutoReloadAtMs: readStoredReloadAt(options.storage),
    autoReloadAttempts: 0,
    manualRecoveryPrompts: 0,
  };

  const clearRecoveryTimer = () => {
    if (recoveryTimer === null) return;
    scheduler.clearTimeout(recoveryTimer);
    recoveryTimer = null;
  };

  const showManualRecovery = (
    reason: 'protected-mode' | 'reload-cooldown' | 'reload-failed',
  ) => {
    debug.status = 'manual-recovery';
    debug.manualRecoveryPrompts += 1;
    manualRecoveryVisible = true;
    options.log?.('manual-recovery', {
      reason,
      lossCount: debug.lossCount,
      lastLostAtMs: debug.lastLostAtMs,
    });
    options.showManualRecovery();
  };

  const handleRecoveryTimeout = () => {
    recoveryTimer = null;
    if (destroyed || debug.status !== 'lost') return;
    if (options.getMode() !== 'browse') {
      showManualRecovery('protected-mode');
      return;
    }

    const reloadAt = now();
    const previousReloadAt = readStoredReloadAt(options.storage);
    if (
      previousReloadAt !== null
      && reloadAt - previousReloadAt >= 0
      && reloadAt - previousReloadAt < reloadCooldownMs
    ) {
      debug.lastAutoReloadAtMs = previousReloadAt;
      showManualRecovery('reload-cooldown');
      return;
    }

    debug.status = 'auto-reload';
    debug.autoReloadAttempts += 1;
    debug.lastAutoReloadAtMs = reloadAt;
    storeReloadAt(options.storage, reloadAt);
    options.log?.('auto-reload', {
      lossCount: debug.lossCount,
      lastLostAtMs: debug.lastLostAtMs,
      reloadAtMs: reloadAt,
    });
    try {
      options.reloadPage();
    } catch {
      showManualRecovery('reload-failed');
    }
  };

  const handleContextLost = () => {
    if (destroyed || debug.status === 'lost') return;
    clearRecoveryTimer();
    const lostAt = now();
    debug.status = 'lost';
    debug.lossCount += 1;
    debug.lastLostAtMs = lostAt;
    debug.lastRestoredAtMs = null;
    debug.lastLossDurationMs = null;
    options.log?.('lost', {
      lossCount: debug.lossCount,
      lostAtMs: lostAt,
      mode: options.getMode(),
    });
    recoveryTimer = scheduler.setTimeout(handleRecoveryTimeout, recoveryDelayMs);
  };

  const handleContextRestored = () => {
    if (destroyed) return;
    const restoredAt = now();
    clearRecoveryTimer();
    if (manualRecoveryVisible) {
      manualRecoveryVisible = false;
      options.hideManualRecovery();
    }
    debug.status = 'healthy';
    debug.restoreCount += 1;
    debug.lastRestoredAtMs = restoredAt;
    debug.lastLossDurationMs = debug.lastLostAtMs === null
      ? null
      : Math.max(0, restoredAt - debug.lastLostAtMs);
    options.log?.('restored', {
      restoreCount: debug.restoreCount,
      restoredAtMs: restoredAt,
      lossDurationMs: debug.lastLossDurationMs,
    });
  };

  options.renderer.on(WEBGL_CONTEXT_LOST_EVENT, handleContextLost);
  options.renderer.on(WEBGL_CONTEXT_RESTORED_EVENT, handleContextRestored);

  return {
    getDebugState: () => ({ ...debug }),
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      clearRecoveryTimer();
      options.renderer.off(WEBGL_CONTEXT_LOST_EVENT, handleContextLost);
      options.renderer.off(WEBGL_CONTEXT_RESTORED_EVENT, handleContextRestored);
    },
  };
}

function readStoredReloadAt(
  storage: Pick<Storage, 'getItem'> | null | undefined,
): number | null {
  try {
    const value = storage?.getItem(WEBGL_RECOVERY_RELOAD_STORAGE_KEY);
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  } catch {
    return null;
  }
}

function storeReloadAt(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  reloadAt: number,
): void {
  try {
    storage?.setItem(WEBGL_RECOVERY_RELOAD_STORAGE_KEY, String(reloadAt));
  } catch {
    // A blocked sessionStorage must not prevent graphics recovery.
  }
}
