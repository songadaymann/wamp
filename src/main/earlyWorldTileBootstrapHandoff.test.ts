import { afterEach, describe, expect, it, vi } from 'vitest';
import { installEarlyWorldTileBootstrapHandoff } from './earlyWorldTileBootstrapHandoff';

describe('early world tile bootstrap handoff', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retains the cover until sharp Phaser replacement and two painted frames', () => {
    const environment = createEnvironment(false);
    installEarlyWorldTileBootstrapHandoff(environment);

    environment.dispatchReady();
    expect(environment.alignToGameContainer).toHaveBeenCalledOnce();
    expect(environment.release).not.toHaveBeenCalled();
    environment.flushFrame();
    expect(environment.release).not.toHaveBeenCalled();
    environment.dispatchReplacementReady();
    environment.flushFrame();
    expect(environment.release).not.toHaveBeenCalled();
    environment.flushFrame();
    expect(environment.release).toHaveBeenCalledOnce();
    expect(environment.release).toHaveBeenCalledWith('phaser-coverage-painted');

    environment.dispatchReady();
    environment.flushFrame();
    expect(environment.release).toHaveBeenCalledOnce();
  });

  it('handles an already-ready compact or tiled renderer without a same-task detach', () => {
    const environment = createEnvironment(true);
    installEarlyWorldTileBootstrapHandoff(environment);
    expect(environment.alignToGameContainer).toHaveBeenCalledOnce();
    expect(environment.release).not.toHaveBeenCalled();
    environment.dispatchReplacementReady();
    environment.flushFrame();
    expect(environment.release).not.toHaveBeenCalled();
    environment.flushFrame();
    expect(environment.release).toHaveBeenCalledOnce();
  });

  it('cancels a pending release when its owner is disposed', () => {
    const environment = createEnvironment(false);
    const dispose = installEarlyWorldTileBootstrapHandoff(environment);
    environment.dispatchReady();
    environment.dispatchReplacementReady();
    dispose();
    environment.flushFrame();
    environment.flushFrame();
    expect(environment.release).not.toHaveBeenCalled();
  });

  it('uses the guarded timeout only when no renderer replacement milestone arrives', async () => {
    vi.useFakeTimers();
    const environment = createEnvironment(true);
    installEarlyWorldTileBootstrapHandoff(environment);

    await vi.advanceTimersByTimeAsync(9_999);
    environment.flushFrame();
    expect(environment.release).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    environment.flushFrame();
    expect(environment.release).not.toHaveBeenCalled();
    environment.flushFrame();
    expect(environment.release).toHaveBeenCalledOnce();
  });
});

function createEnvironment(appReady: boolean) {
  const listenersByType = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const frames = new Map<number, FrameRequestCallback>();
  const release = vi.fn();
  const alignToGameContainer = vi.fn();
  let nextFrameId = 0;
  const win = {
    __wampEarlyWorldTiles: { alignToGameContainer, release },
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      const listeners = listenersByType.get(type) ?? new Set<EventListenerOrEventListenerObject>();
      listeners.add(listener);
      listenersByType.set(type, listeners);
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      listenersByType.get(type)?.delete(listener);
    },
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const id = ++nextFrameId;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number) => {
      frames.delete(id);
    },
  };
  return {
    win,
    doc: { body: { dataset: { appReady: appReady ? 'true' : 'false' } } },
    release,
    alignToGameContainer,
    dispatchReady: () => dispatch('wamp:app-ready'),
    dispatchReplacementReady: () => dispatch('wamp:world-tiles-replacement-ready'),
    flushFrame: () => {
      const entry = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!entry) return;
      frames.delete(entry[0]);
      entry[1](performance.now());
    },
  };

  function dispatch(type: string): void {
    for (const listener of [...(listenersByType.get(type) ?? [])]) {
      if (typeof listener === 'function') listener(new Event(type));
      else listener.handleEvent(new Event(type));
    }
  }
}
