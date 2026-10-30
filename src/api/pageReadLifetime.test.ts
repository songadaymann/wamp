import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithPageReadLifetime, installPageReadLifecycle } from './pageReadLifetime';

afterEach(() => vi.unstubAllGlobals());
function page() {
  const target = Object.assign(new EventTarget(), { document: { hidden: false } });
  vi.stubGlobal('window', target);
  installPageReadLifecycle();
  return target;
}
describe('outgoing page read lifetime', () => {
  it('aborts an unfinished read before navigation and never starts another in the outgoing document', async () => {
    const target = page();
    const fetch = vi.fn((_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetch);
    const read = fetchWithPageReadLifetime('/api/guest-runs/mine');
    target.dispatchEvent(new Event('beforeunload'));
    await expect(read).rejects.toMatchObject({ name: 'AbortError' });
    await expect(fetchWithPageReadLifetime('/api/leaderboards/rooms/discover')).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('preserves draft flushes, keepalive and caller cancellation for writes during navigation', async () => {
    const target = page(), controller = new AbortController();
    const fetch = vi.fn(async () => Response.json({ saved: true }));
    vi.stubGlobal('fetch', fetch); target.dispatchEvent(new Event('beforeunload'));
    const options = { method: 'POST', keepalive: true, signal: controller.signal };
    await fetchWithPageReadLifetime('/api/draft', options);
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/draft', options);
  });
  it.each(['pageshow', 'pointerdown'])('restores reads on %s after cached-page return or cancelled navigation', async event => {
    const target = page(), controller = new AbortController();
    const fetch = vi.fn(async () => Response.json({ ok: true })); vi.stubGlobal('fetch', fetch);
    target.dispatchEvent(new Event('beforeunload'));
    await expect(fetchWithPageReadLifetime('/api/progress')).rejects.toMatchObject({ name: 'AbortError' });
    target.dispatchEvent(new Event(event));
    await fetchWithPageReadLifetime('/api/progress', { signal: controller.signal });
    const signal = (fetch.mock.calls[0] as unknown as [unknown, RequestInit])[1].signal;
    expect(signal?.aborted).toBe(false); controller.abort(); expect(signal?.aborted).toBe(true);
  });
});
