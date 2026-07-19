import { describe, expect, it, vi } from 'vitest';
import { installEarlyWorldTileBootstrapHandoff } from './earlyWorldTileBootstrapHandoff';

describe('early world tile bootstrap handoff', () => {
  it('retains the cover through two frames after app-ready, then releases once', () => {
    const environment = createEnvironment(false);
    installEarlyWorldTileBootstrapHandoff(environment);

    environment.dispatchReady();
    expect(environment.alignToGameContainer).toHaveBeenCalledOnce();
    expect(environment.release).not.toHaveBeenCalled();
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
    environment.flushFrame();
    expect(environment.release).not.toHaveBeenCalled();
    environment.flushFrame();
    expect(environment.release).toHaveBeenCalledOnce();
  });

  it('cancels a pending release when its owner is disposed', () => {
    const environment = createEnvironment(false);
    const dispose = installEarlyWorldTileBootstrapHandoff(environment);
    environment.dispatchReady();
    dispose();
    environment.flushFrame();
    environment.flushFrame();
    expect(environment.release).not.toHaveBeenCalled();
  });
});

function createEnvironment(appReady: boolean) {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const frames = new Map<number, FrameRequestCallback>();
  const release = vi.fn();
  const alignToGameContainer = vi.fn();
  let nextFrameId = 0;
  const win = {
    __wampEarlyWorldTiles: { alignToGameContainer, release },
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.delete(listener);
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
    dispatchReady: () => {
      for (const listener of [...listeners]) {
        if (typeof listener === 'function') listener(new Event('wamp:app-ready'));
        else listener.handleEvent(new Event('wamp:app-ready'));
      }
    },
    flushFrame: () => {
      const entry = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!entry) return;
      frames.delete(entry[0]);
      entry[1](performance.now());
    },
  };
}
