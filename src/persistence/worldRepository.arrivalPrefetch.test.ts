import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompactWorldChunkWindow, WorldChunkBounds } from './worldModel';

type RepositoryModule = typeof import('./worldRepository');

const arrival: WorldChunkBounds = { minChunkX: -4, maxChunkX: 0, minChunkY: -3, maxChunkY: 1 };
const inner: WorldChunkBounds = { minChunkX: -3, maxChunkX: -1, minChunkY: -2, maxChunkY: 0 };

function compactWindowFor(bounds: WorldChunkBounds): CompactWorldChunkWindow {
  const chunks = [];
  for (let y = bounds.minChunkY; y <= bounds.maxChunkY; y += 1) {
    for (let x = bounds.minChunkX; x <= bounds.maxChunkX; x += 1) {
      chunks.push({
        id: `${x},${y}`,
        coordinates: { x, y },
        roomBounds: { minX: x * 8, maxX: x * 8 + 7, minY: y * 8, maxY: y * 8 + 7 },
        rooms: [],
        chunkPreviewHash: 'h',
      });
    }
  }
  return {
    chunkBounds: bounds,
    roomBounds: { minX: bounds.minChunkX * 8, maxX: bounds.maxChunkX * 8 + 7, minY: bounds.minChunkY * 8, maxY: bounds.maxChunkY * 8 + 7 },
    chunks,
  } as unknown as CompactWorldChunkWindow;
}

function stubSummaryFetch(...responses: Array<CompactWorldChunkWindow | Error>) {
  const fetch = vi.fn(async (url: string | URL | Request) => {
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request ${String(url)}`);
    if (next instanceof Error) throw next;
    return Response.json(next);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

async function load(): Promise<RepositoryModule> {
  vi.resetModules();
  return import('./worldRepository');
}

afterEach(() => vi.unstubAllGlobals());

describe('arrival world prefetch (F018)', () => {
  it('serves the first covered compact load from the pre-boot request, cropped to the window asked for', async () => {
    const fetch = stubSummaryFetch(compactWindowFor(arrival), compactWindowFor(inner));
    const { ApiWorldRepository, prefetchArrivalCompactWorldWindow } = await load();
    prefetchArrivalCompactWorldWindow(arrival);
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0][0])).toContain('minChunkX=-4&maxChunkX=0&minChunkY=-3&maxChunkY=1');

    const repository = new ApiWorldRepository('https://api.test', null);
    const window = await repository.loadCompactWorldChunkWindow(inner);
    expect(fetch).toHaveBeenCalledOnce(); // no second request
    expect(window?.chunkBounds).toEqual(inner);
    expect(window?.roomBounds).toEqual({ minX: -24, maxX: -1, minY: -16, maxY: 7 });
    expect(window?.chunks.map((chunk) => chunk.id)).toEqual([
      '-3,-2', '-2,-2', '-1,-2', '-3,-1', '-2,-1', '-1,-1', '-3,0', '-2,0', '-1,0',
    ]);

    // Used once: the next load asks the server.
    await repository.loadCompactWorldChunkWindow(inner);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('loads normally when the camera needs a window the prefetch does not cover', async () => {
    const wide: WorldChunkBounds = { minChunkX: -5, maxChunkX: 1, minChunkY: -4, maxChunkY: 2 };
    const fetch = stubSummaryFetch(compactWindowFor(arrival), compactWindowFor(wide));
    const { ApiWorldRepository, prefetchArrivalCompactWorldWindow } = await load();
    prefetchArrivalCompactWorldWindow(arrival);
    const window = await new ApiWorldRepository('https://api.test', null).loadCompactWorldChunkWindow(wide);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(window?.chunks).toHaveLength(49);
  });

  it('falls back to a normal request when the pre-boot request failed', async () => {
    const fetch = stubSummaryFetch(new TypeError('offline'), compactWindowFor(inner));
    const { ApiWorldRepository, prefetchArrivalCompactWorldWindow } = await load();
    prefetchArrivalCompactWorldWindow(arrival);
    const window = await new ApiWorldRepository('https://api.test', null).loadCompactWorldChunkWindow(inner);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(window?.chunks).toHaveLength(9);
  });
});
