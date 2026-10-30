import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForWalletReceipt } from './walletReceiptWait';
afterEach(() => vi.useRealTimers());
describe('owned wallet receipt wait', () => {
  it('does not even read a receipt when a late hash arrives after Close', async () => {
    vi.useFakeTimers(); const read = vi.fn(), controller = new AbortController(); controller.abort();
    await expect(waitForWalletReceipt(read, () => true, controller.signal)).rejects.toThrow('cancelled');
    expect(read).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('checks an unmined receipt again and removes all timers after success', async () => {
    vi.useFakeTimers(); const read = vi.fn().mockRejectedValueOnce('not-mined').mockResolvedValueOnce({ status: 'success' });
    const work = waitForWalletReceipt(read, e => e === 'not-mined', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2_000); expect(await work).toEqual({ status: 'success' });
    expect(read).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels an unresponsive provider and consumes a later error without polling again', async () => {
    vi.useFakeTimers(); const controller = new AbortController(); let reject!: (error: Error) => void;
    const read = vi.fn(() => new Promise((_, fail) => { reject = fail; }));
    const work = waitForWalletReceipt(read, () => false, controller.signal), checked = expect(work).rejects.toThrow();
    controller.abort(); await checked; reject(new Error('late provider error')); await Promise.resolve();
    await vi.advanceTimersByTimeAsync(300_000); expect(read).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('clears the backoff when closed and treats a provider error as unknown immediately', async () => {
    vi.useFakeTimers(); const controller = new AbortController(), read = vi.fn().mockRejectedValue('not-mined');
    const work = waitForWalletReceipt(read, e => e === 'not-mined', controller.signal), checked = expect(work).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1); controller.abort(); await checked;
    expect(vi.getTimerCount()).toBe(0); expect(read).toHaveBeenCalledOnce();
    await expect(waitForWalletReceipt(vi.fn().mockRejectedValue(new Error('RPC offline')), () => false, new AbortController().signal)).rejects.toThrow('RPC offline');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('ends a perpetually unmined transaction at the existing 3-minute deadline', async () => {
    vi.useFakeTimers(); const read = vi.fn().mockRejectedValue('not-mined');
    const work = waitForWalletReceipt(read, () => true, new AbortController().signal), checked = expect(work).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(180_000); await checked;
    const count = read.mock.calls.length; await vi.advanceTimersByTimeAsync(300_000);
    expect(read).toHaveBeenCalledTimes(count); expect(vi.getTimerCount()).toBe(0);
  });
});
