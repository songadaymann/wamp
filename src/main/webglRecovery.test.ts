import { describe, expect, it, vi } from 'vitest';
import {
  installWebglRecoveryMonitor,
  WEBGL_CONTEXT_LOST_EVENT,
  WEBGL_CONTEXT_RESTORED_EVENT,
  WEBGL_RECOVERY_RELOAD_STORAGE_KEY,
} from './webglRecovery';

describe('WebGL recovery monitor', () => {
  it('lets a native restoration recover without reloading', () => {
    const harness = createHarness();
    harness.renderer.emit(WEBGL_CONTEXT_LOST_EVENT);
    expect(harness.monitor.getDebugState()).toMatchObject({
      status: 'lost',
      lossCount: 1,
    });

    harness.clock.nowMs = 1_250;
    harness.renderer.emit(WEBGL_CONTEXT_RESTORED_EVENT);
    harness.scheduler.flush();

    expect(harness.reloadPage).not.toHaveBeenCalled();
    expect(harness.monitor.getDebugState()).toMatchObject({
      status: 'healthy',
      restoreCount: 1,
      lastLossDurationMs: 250,
    });
  });

  it('reloads a browse page when the context stays lost', () => {
    const harness = createHarness();
    harness.renderer.emit(WEBGL_CONTEXT_LOST_EVENT);
    harness.clock.nowMs = 5_000;
    harness.scheduler.flush();

    expect(harness.reloadPage).toHaveBeenCalledOnce();
    expect(harness.storage.getItem(WEBGL_RECOVERY_RELOAD_STORAGE_KEY)).toBe('5000');
    expect(harness.monitor.getDebugState()).toMatchObject({
      status: 'auto-reload',
      autoReloadAttempts: 1,
      lastAutoReloadAtMs: 5_000,
    });
  });

  it('protects play and editor work by offering a manual refresh', () => {
    const harness = createHarness({ mode: 'protected' });
    harness.renderer.emit(WEBGL_CONTEXT_LOST_EVENT);
    harness.scheduler.flush();

    expect(harness.reloadPage).not.toHaveBeenCalled();
    expect(harness.showManualRecovery).toHaveBeenCalledOnce();
    expect(harness.monitor.getDebugState()).toMatchObject({
      status: 'manual-recovery',
      manualRecoveryPrompts: 1,
    });
  });

  it('prevents a repeated automatic reload loop', () => {
    const storage = createStorage({
      [WEBGL_RECOVERY_RELOAD_STORAGE_KEY]: '900',
    });
    const harness = createHarness({ storage });
    harness.renderer.emit(WEBGL_CONTEXT_LOST_EVENT);
    harness.scheduler.flush();

    expect(harness.reloadPage).not.toHaveBeenCalled();
    expect(harness.showManualRecovery).toHaveBeenCalledOnce();
    expect(harness.monitor.getDebugState()).toMatchObject({
      status: 'manual-recovery',
      lastAutoReloadAtMs: 900,
    });
  });

  it('detaches renderer listeners and timers when destroyed', () => {
    const harness = createHarness();
    harness.renderer.emit(WEBGL_CONTEXT_LOST_EVENT);
    harness.monitor.destroy();
    harness.scheduler.flush();
    harness.renderer.emit(WEBGL_CONTEXT_LOST_EVENT);

    expect(harness.reloadPage).not.toHaveBeenCalled();
    expect(harness.renderer.listenerCount()).toBe(0);
  });
});

function createHarness(options: {
  mode?: 'browse' | 'protected';
  storage?: ReturnType<typeof createStorage>;
} = {}) {
  const renderer = new FakeRenderer();
  const scheduler = new FakeScheduler();
  const storage = options.storage ?? createStorage();
  const clock = { nowMs: 1_000 };
  const reloadPage = vi.fn();
  const showManualRecovery = vi.fn();
  const hideManualRecovery = vi.fn();
  const monitor = installWebglRecoveryMonitor({
    renderer,
    scheduler,
    storage,
    now: () => clock.nowMs,
    getMode: () => options.mode ?? 'browse',
    reloadPage,
    showManualRecovery,
    hideManualRecovery,
  });
  return {
    renderer,
    scheduler,
    storage,
    clock,
    reloadPage,
    showManualRecovery,
    hideManualRecovery,
    monitor,
  };
}

class FakeRenderer {
  private readonly listeners = new Map<string, Set<() => void>>();

  on(event: string, listener: () => void): void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event: string, listener: () => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0);
  }
}

class FakeScheduler {
  private readonly callbacks = new Set<() => void>();

  setTimeout(callback: () => void): () => void {
    this.callbacks.add(callback);
    return callback;
  }

  clearTimeout(callback: unknown): void {
    this.callbacks.delete(callback as () => void);
  }

  flush(): void {
    const callbacks = [...this.callbacks];
    this.callbacks.clear();
    for (const callback of callbacks) callback();
  }
}

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}
