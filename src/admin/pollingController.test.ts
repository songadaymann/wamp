import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPollingController } from './pollingController';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('admin polling controller', () => {
  it('starts one timer, polls on cadence, and clears it when disabled', () => {
    vi.useFakeTimers();
    const poll = vi.fn();
    vi.stubGlobal('window', globalThis);
    const controller = createPollingController(10_000, poll);

    controller.sync(true);
    controller.sync(true);
    vi.advanceTimersByTime(20_000);
    expect(poll).toHaveBeenCalledTimes(2);

    controller.sync(false);
    vi.advanceTimersByTime(20_000);
    expect(poll).toHaveBeenCalledTimes(2);
  });
});
