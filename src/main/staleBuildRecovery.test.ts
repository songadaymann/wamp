import { describe, expect, it, vi } from 'vitest';
import { installStaleBuildRecovery, STALE_ASSET_EVENT } from './staleBuildRecovery';

function harness(options: { entryStatus?: number | 'offline'; busy?: boolean[] } = {}) {
  const target = new EventTarget();
  const timers: Array<() => void> = [];
  const win = { addEventListener: target.addEventListener.bind(target), setTimeout: (callback: () => void) => { timers.push(callback); return 0; } };
  const fetchImpl = vi.fn(async () => {
    if (options.entryStatus === 'offline') throw new TypeError('Failed to fetch');
    return new Response(null, { status: options.entryStatus ?? 404 });
  });
  const doc = { querySelector: () => ({ src: 'https://wamp.land/assets/cache-v2/main-old.js' }) } as unknown as Pick<Document, 'querySelector'>;
  const busy = [...(options.busy ?? [])];
  const spies = { showReloadOffer: vi.fn(), report: vi.fn() };
  const recovery = installStaleBuildRecovery({
    win: win as unknown as Pick<Window, 'addEventListener' | 'setTimeout'>, doc, fetchImpl: fetchImpl as unknown as typeof fetch, buildId: 'build-a',
    canShowOffer: () => !(busy.shift() ?? false), ...spies,
  });
  const runTimers = () => { while (timers.length) timers.shift()!(); };
  const fail = async (type = 'vite:preloadError') => {
    const event = Object.assign(new Event(type, { cancelable: true }), { payload: new TypeError('Failed to fetch dynamically imported module') });
    target.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));
    runTimers();
    return event;
  };
  return { ...spies, recovery, fetchImpl, fail };
}

describe('stale build recovery (F374)', () => {
  it('offers a reload once the tab build is confirmed gone, never swallowing the error', async () => {
    const h = harness();
    const event = await h.fail();
    expect(event.defaultPrevented).toBe(false);
    expect(h.fetchImpl).toHaveBeenCalledWith('https://wamp.land/assets/cache-v2/main-old.js', expect.objectContaining({ method: 'HEAD', cache: 'no-store' }));
    expect(h.showReloadOffer).toHaveBeenCalledOnce();
    expect(h.report).toHaveBeenCalledWith(expect.stringContaining('Stale build build-a'));
    await h.fail(STALE_ASSET_EVENT);
    expect(h.showReloadOffer).toHaveBeenCalledTimes(2);
    expect(h.fetchImpl).toHaveBeenCalledOnce();
  });

  it('waits for the busy card to be free instead of covering a save or a choice', async () => {
    const h = harness({ busy: [true, true] });
    await h.fail();
    expect(h.showReloadOffer).toHaveBeenCalledOnce();
    expect(h.recovery.getDebugState()).toMatchObject({ confirmedStale: true, offersShown: 1 });
  });

  it('leaves network failures to the caller', async () => {
    for (const entryStatus of ['offline', 200] as const) {
      const h = harness({ entryStatus });
      await h.fail();
      expect(h.showReloadOffer).not.toHaveBeenCalled();
      expect(h.recovery.getDebugState()).toMatchObject({ failures: 1, confirmedStale: false });
    }
  });
});
