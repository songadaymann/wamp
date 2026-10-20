import { afterEach, describe, expect, it, vi } from 'vitest';
import { withCaptureBrowser } from './managedBrowser';
afterEach(() => vi.useRealTimers());
describe('capture browser lifetime', () => {
  it('closes exactly once for success and failed page work', async () => {
    for (const fail of [false, true]) {
      const close = vi.fn(async () => undefined), controller = new AbortController();
      const result = withCaptureBrowser(async () => ({ close }), async () => { if (fail) throw new Error('Page failed'); return 'png'; }, controller.signal);
      if (fail) await expect(result).rejects.toThrow('Page failed'); else expect(await result).toBe('png');
      expect(close).toHaveBeenCalledTimes(1);
    }
  });
  it('closes late launch results before page work when cancellation arrived during launch', async () => {
    let resolve!: (value: { close(): Promise<void> }) => void;
    const close = vi.fn(async () => undefined), work = vi.fn(async () => 'png'), controller = new AbortController();
    const result = withCaptureBrowser(() => new Promise<{ close(): Promise<void> }>(r => { resolve = r; }), work, controller.signal);
    controller.abort(new Error('Deadline')); resolve({ close });
    await expect(result).rejects.toThrow('Deadline'); expect(close).toHaveBeenCalledTimes(1); expect(work).not.toHaveBeenCalled();
  });
  it('rejects timed-out work and removes the only active timer', async () => {
    vi.useFakeTimers(); const close = vi.fn(async () => undefined), controller = new AbortController();
    const result = withCaptureBrowser(async () => ({ close }), () => new Promise<never>(() => undefined), controller.signal);
    const assertion = expect(result).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(90_001); await assertion;
    expect(close).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it('disconnects stalled cleanup, reports it and clears both timers', async () => {
    vi.useFakeTimers(); const disconnect = vi.fn(), controller = new AbortController();
    const result = withCaptureBrowser(async () => ({ close: () => new Promise<never>(() => undefined), disconnect }), async () => 'png', controller.signal);
    const assertion = expect(result).rejects.toThrow('cleanup is pending');
    await vi.advanceTimersByTimeAsync(10001); await assertion; expect(disconnect).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
});
