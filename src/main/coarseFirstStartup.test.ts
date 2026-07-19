import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COARSE_FIRST_MAIN_TIMEOUT_MS,
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
