import { afterEach, describe, expect, it, vi } from 'vitest';
import { installEarlyWorldTileBootstrapHandoff } from './earlyWorldTileBootstrapHandoff';
import {
  clearWorldReplacementCoverage,
  publishWorldReplacementCoverageReady,
} from './worldReplacementCoverage';

describe('early world tile bootstrap handoff', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retains the cover until app readiness, current replacement coverage, and two painted frames', () => {
    const environment = createEnvironment(false);
    installEarlyWorldTileBootstrapHandoff(environment);

    environment.dispatchAppReady();
    expect(environment.alignToGameContainer).toHaveBeenCalledOnce();
    expect(environment.release).not.toHaveBeenCalled();
    environment.publishReplacement('tiled:1');
    environment.flushFrame();
    expect(environment.release).not.toHaveBeenCalled();
    environment.flushFrame();
    expect(environment.release).toHaveBeenCalledOnce();
    expect(environment.release).toHaveBeenCalledWith('phaser-coverage-painted');
  });

  it('accepts pre-app-ready coverage only while the same key remains current', () => {
    const environment = createEnvironment(false);
    installEarlyWorldTileBootstrapHandoff(environment);

    environment.publishReplacement('compact:1');
    environment.flushFrame();
    expect(environment.release).not.toHaveBeenCalled();
    environment.dispatchAppReady();
    environment.flushFrame();
    expect(environment.release).not.toHaveBeenCalled();
    environment.flushFrame();
    expect(environment.release).toHaveBeenCalledOnce();
  });

  it('does not accept a pre-app-ready event whose state was invalidated', () => {
    const environment = createEnvironment(false);
    installEarlyWorldTileBootstrapHandoff(environment);

    environment.publishReplacement('compact:stale');
    environment.invalidateReplacement('compact:stale');
    environment.dispatchAppReady();
    environment.flushFrame();
    environment.flushFrame();
    expect(environment.release).not.toHaveBeenCalled();
  });

  it('cancels a pending release on invalidation and requires two fresh frames for its replacement', () => {
    const environment = createEnvironment(true);
    installEarlyWorldTileBootstrapHandoff(environment);
    environment.publishReplacement('tiled:old');
    environment.flushFrame();
    environment.invalidateReplacement('tiled:old');
    environment.flushFrame();
    expect(environment.release).not.toHaveBeenCalled();

    environment.publishReplacement('legacy:new');
    environment.flushFrame();
    expect(environment.release).not.toHaveBeenCalled();
    environment.flushFrame();
    expect(environment.release).toHaveBeenCalledOnce();
  });

  it('reads already-current replacement state installed before the handoff listener', () => {
    const environment = createEnvironment(true);
    environment.publishReplacement('compact:already-painted');
    installEarlyWorldTileBootstrapHandoff(environment);

    environment.flushFrame();
    expect(environment.release).not.toHaveBeenCalled();
    environment.flushFrame();
    expect(environment.release).toHaveBeenCalledOnce();
  });

  it('never fabricates replacement readiness after a timeout', async () => {
    vi.useFakeTimers();
    const environment = createEnvironment(true);
    installEarlyWorldTileBootstrapHandoff(environment);

    await vi.advanceTimersByTimeAsync(60_000);
    environment.flushFrame();
    environment.flushFrame();
    expect(environment.release).not.toHaveBeenCalled();
  });

  it('cancels a pending release when its owner is disposed', () => {
    const environment = createEnvironment(true);
    const dispose = installEarlyWorldTileBootstrapHandoff(environment);
    environment.publishReplacement('tiled:1');
    dispose();
    environment.flushFrame();
    environment.flushFrame();
    expect(environment.release).not.toHaveBeenCalled();
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
    __wampWorldReplacementCoverage: null,
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      const listeners = listenersByType.get(type) ?? new Set<EventListenerOrEventListenerObject>();
      listeners.add(listener);
      listenersByType.set(type, listeners);
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      listenersByType.get(type)?.delete(listener);
    },
    dispatchEvent: (event: Event) => {
      dispatch(event);
      return true;
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
    dispatchAppReady: () => dispatch(new Event('wamp:app-ready')),
    publishReplacement: (key: string) => publishWorldReplacementCoverageReady({
      schemaVersion: 1,
      key,
      source: key.startsWith('tiled') ? 'tiled' : key.startsWith('compact') ? 'compact' : 'legacy',
      generation: 1,
      readyAtMs: performance.now(),
    }, win),
    invalidateReplacement: (key: string) => clearWorldReplacementCoverage(key, win),
    flushFrame: () => {
      const entry = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!entry) return;
      frames.delete(entry[0]);
      entry[1](performance.now());
    },
  };

  function dispatch(event: Event): void {
    for (const listener of [...(listenersByType.get(event.type) ?? [])]) {
      if (typeof listener === 'function') listener(event);
      else listener.handleEvent(event);
    }
  }
}
