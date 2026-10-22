import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deliverRankedFinish,
  isRetryableRankedFinishError,
  RankedFinishDelivery,
  rankedFinishRequestInit,
  rankedFinishTimeoutMs,
  retryPendingRankedFinishes,
  type RankedFinishRetryEnvironment,
  type RankedFinishRunStatus,
} from './rankedFinishDelivery';

class HttpFailure extends Error {
  constructor(readonly status: number, message = `HTTP ${status}`) { super(message); }
}

interface TestEnvironment extends RankedFinishRetryEnvironment {
  visible: boolean;
  online: boolean;
  subscriptions: number;
  wake(): void;
}

function environment(): TestEnvironment {
  let wake: (() => void) | null = null;
  const env: TestEnvironment = {
    visible: true,
    online: true,
    subscriptions: 0,
    isVisible: () => env.visible,
    isOnline: () => env.online,
    onWake: (callback) => {
      wake = callback; env.subscriptions += 1;
      return () => { wake = null; env.subscriptions -= 1; };
    },
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    wake: () => wake?.(),
  };
  return env;
}

async function settle() { for (let i = 0; i < 6; i += 1) await Promise.resolve(); }

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('ranked finish request', () => {
  it('sets a deadline and uses keepalive only while the body fits the browser budget', () => {
    const short = rankedFinishRequestInit({ result: 'completed', trace: 'x'.repeat(1_000) });
    expect(short).toMatchObject({ method: 'POST', keepalive: true });
    expect(short.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(short.body as string)).toMatchObject({ result: 'completed' });
    expect(rankedFinishRequestInit({ trace: 'x'.repeat(70_000) }).keepalive).toBe(false);
  });

  it('gives a long trace more time to upload, up to two minutes', () => {
    expect(rankedFinishTimeoutMs(0)).toBe(15_000);
    expect(rankedFinishTimeoutMs(8_192)).toBe(16_000);
    expect(rankedFinishTimeoutMs(400 * 1024)).toBe(65_000);
    expect(rankedFinishTimeoutMs(4 * 1024 * 1024)).toBe(120_000);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    rankedFinishRequestInit({ trace: 'x'.repeat(400 * 1024 - 12) });
    expect(timeout).toHaveBeenLastCalledWith(65_000);
    timeout.mockRestore();
  });

  it('resends only unanswered requests, server errors, 408, 425 and 429', () => {
    expect(isRetryableRankedFinishError(new TypeError('Load failed'))).toBe(true);
    expect(isRetryableRankedFinishError(new DOMException('timed out', 'TimeoutError'))).toBe(true);
    for (const status of [500, 502, 503, 408, 425, 429]) expect(isRetryableRankedFinishError(new HttpFailure(status))).toBe(true);
    for (const status of [400, 401, 403, 404, 409, 413]) expect(isRetryableRankedFinishError(new HttpFailure(status))).toBe(false);
  });
});

describe('ranked finish delivery (F351)', () => {
  it('resends the same payload at 1s, 3s and 10s, then waits for a wake or Retry', async () => {
    const env = environment();
    const payload = { result: 'completed', elapsedMs: 9_000 };
    const sent: unknown[] = [];
    const send = vi.fn(async (): Promise<void> => { sent.push(payload); throw new TypeError('Failed to fetch'); });
    const waiting = vi.fn();
    const delivery = new RankedFinishDelivery(send, { env, onWaiting: waiting });
    void delivery.done.catch(() => {});
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(waiting).toHaveBeenCalledTimes(1);
    expect(delivery.waiting).toBe(true);

    await vi.advanceTimersByTimeAsync(999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(send).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(send).toHaveBeenCalledTimes(4);

    send.mockResolvedValueOnce(undefined);
    env.wake();
    await expect(delivery.done).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(5);
    expect(sent.every(body => body === payload)).toBe(true);
    expect(env.subscriptions).toBe(0);
  });

  it('stops at once on a final answer such as a verification 409', async () => {
    const env = environment();
    const send = vi.fn()
      .mockRejectedValueOnce(new HttpFailure(503))
      .mockRejectedValueOnce(new HttpFailure(409, 'Ranked run could not be verified.'));
    const delivery = new RankedFinishDelivery(send, { env });
    const outcome = delivery.done.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(outcome).resolves.toMatchObject({ status: 409, message: 'Ranked run could not be verified.' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(delivery.waiting).toBe(false);
    expect(env.subscriptions).toBe(0);
  });

  it('holds a hidden page\'s retry until the page is visible again', async () => {
    const env = environment();
    const send = vi.fn().mockRejectedValueOnce(new TypeError('Load failed')).mockResolvedValue(undefined);
    const delivery = new RankedFinishDelivery(send, { env });
    await settle();
    env.visible = false;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(send).toHaveBeenCalledTimes(1);
    env.visible = true;
    env.wake();
    await expect(delivery.done).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('lets the HUD Retry button resend every waiting finish, but never one already in flight', async () => {
    const env = environment();
    let release!: () => void;
    const send = vi.fn()
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const delivery = new RankedFinishDelivery(send, { env });
    await settle();
    retryPendingRankedFinishes();
    await settle();
    expect(send).toHaveBeenCalledTimes(2);
    retryPendingRankedFinishes();
    env.wake();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(send).toHaveBeenCalledTimes(2);
    release();
    await expect(delivery.done).resolves.toBeUndefined();
    retryPendingRankedFinishes();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('keeps the run status in plain words while it waits, then clears it', async () => {
    const env = environment();
    env.online = false;
    const run: RankedFinishRunStatus = { submissionMessage: 'Submitting run...' };
    const changes: (string | null)[] = [];
    const send = vi.fn()
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockRejectedValueOnce(new HttpFailure(502))
      .mockResolvedValueOnce(undefined);
    const done = deliverRankedFinish(run, 'completed', send, { env, onChange: () => changes.push(run.finishRetry ?? null) });
    await settle();
    expect(run).toMatchObject({ finishRetry: 'waiting', submissionMessage: 'Saving your clear... no connection, will retry.' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toMatchObject({ finishRetry: 'waiting', submissionMessage: 'Saving your clear... server busy, will retry.' });
    await vi.advanceTimersByTimeAsync(3_000);
    await done;
    expect(run.finishRetry).toBeNull();
    expect(changes).toEqual(['waiting', 'sending', 'waiting', 'sending']);
  });
});
