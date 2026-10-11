import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiWorldRepository } from './worldRepository';

const bounds = { minChunkX: 0, maxChunkX: 0, minChunkY: 0, maxChunkY: 0 };
const compactWindow = { chunkBounds: bounds, roomBounds: { minX: 0, maxX: 7, minY: 0, maxY: 7 }, chunks: [] };

function stubFetch(...responses: Array<Response | Error>) {
  const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error('unexpected request');
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const summaryCalls = (fetch: ReturnType<typeof stubFetch>) =>
  fetch.mock.calls.filter(([url]) => String(url).includes('/api/world/chunks/summary')).length;

afterEach(() => vi.unstubAllGlobals());

describe('compact world reads', () => {
  it('retries compact reads after a server error or network failure instead of switching to legacy chunks', async () => {
    const fetch = stubFetch(new Response('busy', { status: 503 }), new TypeError('network'), Response.json(compactWindow));
    const repository = new ApiWorldRepository('https://api.test', null);
    await expect(repository.loadCompactWorldChunkWindow(bounds)).rejects.toThrow('busy');
    await expect(repository.loadCompactWorldChunkWindow(bounds)).rejects.toThrow('network');
    await expect(repository.loadCompactWorldChunkWindow(bounds)).resolves.toMatchObject({ chunks: [] });
    expect(summaryCalls(fetch)).toBe(3);
  });

  it('uses legacy chunks for the session only when the server has no compact reads', async () => {
    const fetch = stubFetch(new Response('Compact world reads are disabled.', { status: 404 }));
    const repository = new ApiWorldRepository('https://api.test', null);
    await expect(repository.loadCompactWorldChunkWindow(bounds)).resolves.toBeNull();
    await expect(repository.loadCompactWorldChunkWindow(bounds)).resolves.toBeNull();
    expect(summaryCalls(fetch)).toBe(1);
  });

  it('keeps compact reads after a failed snapshot query', async () => {
    const fetch = stubFetch(new Response('oops', { status: 500 }), Response.json(compactWindow));
    const repository = new ApiWorldRepository('https://api.test', null);
    await expect(repository.queryRoomSnapshots([])).rejects.toThrow('oops');
    await expect(repository.loadCompactWorldChunkWindow(bounds)).resolves.toMatchObject({ chunks: [] });
    expect(summaryCalls(fetch)).toBe(1);
  });
});
