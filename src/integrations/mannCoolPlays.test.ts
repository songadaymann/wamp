import { afterEach, expect, it, vi } from 'vitest';
import { MannCoolPlayReporter, MANN_COOL_PLAYS_URL, mannCoolPlaySource } from './mannCoolPlays';
afterEach(() => vi.useRealTimers());
it('classifies only exact mann.cool referrers', () => {
  expect(mannCoolPlaySource('https://mann.cool/?anything=private')).toBe('mann.cool');
  for (const referrer of ['', 'garbage', 'http://mann.cool', 'https://mann.cool.evil.test/', 'https://example.test/']) expect(mannCoolPlaySource(referrer)).toBe('direct');
});
it('reports once with only the slug and source, omitting credentials and referrer', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{}'));
  const s = new MannCoolPlayReporter({ hostname: 'wamp.land', referrer: 'https://mann.cool/private?token=no', fetch });
  await Promise.all([s.report(), s.report()]); await s.report(); expect(fetch).toHaveBeenCalledTimes(1); expect(s.status).toBe('sent');
  const [url, options] = fetch.mock.calls[0]; expect(url).toBe(MANN_COOL_PLAYS_URL);
  expect(JSON.parse(String(options?.body))).toEqual({ slug: 'wamp', source: 'mann.cool' });
  expect(options).toMatchObject({ method: 'POST', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true });
});
it('skips localhost and every preview origin', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const hostname of ['localhost', '127.0.0.1', 'preview.wampland.pages.dev', 'wamp.land.evil.test']) { const s = new MannCoolPlayReporter({ hostname, referrer: '', fetch }); await s.report(); expect(s.status).toBe('skipped'); }
  expect(fetch).not.toHaveBeenCalled();
});
it('fails quietly without retrying HTTP or network errors', async () => {
  for (const fetch of [vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{}', { status: 503 })), vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('offline'))]) {
    const s = new MannCoolPlayReporter({ hostname: 'www.wamp.land', referrer: '', fetch }); await s.report(); await s.report(); expect(s.status).toBe('failed'); expect(fetch).toHaveBeenCalledTimes(1);
  }
});
it('aborts a slow report after four seconds and on teardown', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))));
  const s = new MannCoolPlayReporter({ hostname: 'wamp.land', referrer: '', fetch }); const pending = s.report(); await vi.advanceTimersByTimeAsync(4000); await pending; expect(s.status).toBe('failed');
  const other = new MannCoolPlayReporter({ hostname: 'wamp.land', referrer: '', fetch }); const teardown = other.report(); await Promise.resolve(); other.destroy(); await teardown; expect(other.status).toBe('failed');
});
