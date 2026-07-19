import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COARSE_FIRST_MAIN_TIMEOUT_MS,
  COARSE_FIRST_MAIN_START_CEILING_MS,
  COARSE_FIRST_REFINEMENT_TIMEOUT_MS,
  startMainAfterEarlyWorldTiles,
  waitForEarlyWorldTileCoverage,
} from './coarseFirstStartup';

afterEach(() => {
  vi.useRealTimers();
});

describe('coarse-first application startup', () => {
  it('starts immediately when the early bootstrap handle is absent', async () => {
    vi.useFakeTimers();
    const importMain = vi.fn(async () => undefined);

    await startMainAfterEarlyWorldTiles({ handle: undefined, importMain });

    expect(importMain).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts as soon as early coverage settles and clears the timeout', async () => {
    vi.useFakeTimers();
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const importMain = vi.fn(async () => undefined);
    const started = startMainAfterEarlyWorldTiles({ handle: { ready }, importMain });

    expect(importMain).not.toHaveBeenCalled();
    resolveReady();
    await started;

    expect(importMain).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets target-LOD DOM refinement settle before importing the heavy runtime', async () => {
    vi.useFakeTimers();
    let resolveSharp!: () => void;
    const sharp = new Promise<void>((resolve) => {
      resolveSharp = resolve;
    });
    const importMain = vi.fn(async () => undefined);
    const started = startMainAfterEarlyWorldTiles({
      handle: { ready: Promise.resolve(), sharp },
      importMain,
    });

    await Promise.resolve();
    expect(importMain).not.toHaveBeenCalled();
    resolveSharp();
    await started;

    expect(importMain).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caps the extra target-refinement head start without extending a coarse timeout', async () => {
    vi.useFakeTimers();
    const importMain = vi.fn(async () => undefined);
    const started = startMainAfterEarlyWorldTiles({
      handle: { ready: Promise.resolve(), sharp: new Promise<void>(() => undefined) },
      importMain,
    });

    await vi.advanceTimersByTimeAsync(COARSE_FIRST_REFINEMENT_TIMEOUT_MS - 1);
    expect(importMain).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await started;
    expect(importMain).toHaveBeenCalledOnce();

    const coarseTimedOutImport = vi.fn(async () => undefined);
    const coarseTimedOut = startMainAfterEarlyWorldTiles({
      handle: {
        ready: new Promise<void>(() => undefined),
        sharp: new Promise<void>(() => undefined),
      },
      importMain: coarseTimedOutImport,
    });
    await vi.advanceTimersByTimeAsync(COARSE_FIRST_MAIN_TIMEOUT_MS);
    await coarseTimedOut;
    expect(coarseTimedOutImport).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a late coarse success inside the absolute main-start ceiling', async () => {
    vi.useFakeTimers();
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const importMain = vi.fn(async () => undefined);
    const started = startMainAfterEarlyWorldTiles({
      handle: { ready, sharp: new Promise<void>(() => undefined) },
      importMain,
    });

    await vi.advanceTimersByTimeAsync(COARSE_FIRST_MAIN_TIMEOUT_MS - 1);
    resolveReady();
    await Promise.resolve();
    expect(importMain).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(COARSE_FIRST_REFINEMENT_TIMEOUT_MS - 1);
    expect(importMain).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await started;

    expect(performance.now()).toBeLessThanOrEqual(COARSE_FIRST_MAIN_START_CEILING_MS);
    expect(importMain).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels sharp work when coarse coverage times out', async () => {
    vi.useFakeTimers();
    const cancelSharp = vi.fn();
    const importMain = vi.fn(async () => undefined);
    const started = startMainAfterEarlyWorldTiles({
      handle: {
        ready: new Promise<void>(() => undefined),
        sharp: new Promise<void>(() => undefined),
        cancelSharp,
      },
      importMain,
    });

    await vi.advanceTimersByTimeAsync(COARSE_FIRST_MAIN_TIMEOUT_MS);
    await started;

    expect(cancelSharp).toHaveBeenCalledOnce();
    expect(cancelSharp).toHaveBeenCalledWith('coarse-timeout');
    expect(importMain).toHaveBeenCalledOnce();
  });

  it('cancels sharp work when its refinement head start times out', async () => {
    vi.useFakeTimers();
    const cancelSharp = vi.fn();
    const importMain = vi.fn(async () => undefined);
    const started = startMainAfterEarlyWorldTiles({
      handle: {
        ready: Promise.resolve(),
        sharp: new Promise<void>(() => undefined),
        cancelSharp,
      },
      importMain,
    });

    await vi.advanceTimersByTimeAsync(COARSE_FIRST_REFINEMENT_TIMEOUT_MS);
    await started;

    expect(cancelSharp).toHaveBeenCalledOnce();
    expect(cancelSharp).toHaveBeenCalledWith('refinement-timeout');
    expect(importMain).toHaveBeenCalledOnce();
  });

  it('contains a throwing sharp cancellation hook and still starts', async () => {
    vi.useFakeTimers();
    const importMain = vi.fn(async () => undefined);
    const started = startMainAfterEarlyWorldTiles({
      handle: {
        ready: new Promise<void>(() => undefined),
        cancelSharp: () => {
          throw new Error('cancel failed');
        },
      },
      importMain,
    });

    await vi.advanceTimersByTimeAsync(COARSE_FIRST_MAIN_TIMEOUT_MS);
    await expect(started).resolves.toBeUndefined();
    expect(importMain).toHaveBeenCalledOnce();
  });

  it('starts after the strict 750 ms ceiling when coverage remains pending', async () => {
    vi.useFakeTimers();
    const importMain = vi.fn(async () => undefined);
    const neverReady = new Promise<void>(() => undefined);
    const started = startMainAfterEarlyWorldTiles({
      handle: { ready: neverReady },
      importMain,
    });

    await vi.advanceTimersByTimeAsync(COARSE_FIRST_MAIN_TIMEOUT_MS - 1);
    expect(importMain).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await started;

    expect(importMain).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('treats a rejected bootstrap as settled and starts without waiting', async () => {
    vi.useFakeTimers();
    const importMain = vi.fn(async () => undefined);

    await startMainAfterEarlyWorldTiles({
      handle: { ready: Promise.reject(new Error('bootstrap failed')) },
      importMain,
    });

    expect(importMain).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('contains a throwing thenable and still releases startup', async () => {
    vi.useFakeTimers();
    const handle = {
      ready: {
        then: () => {
          throw new Error('invalid thenable');
        },
      },
    };

    await expect(waitForEarlyWorldTileCoverage(handle)).resolves.toBe('settled');
    expect(vi.getTimerCount()).toBe(0);
  });
});
