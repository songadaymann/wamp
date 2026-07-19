import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorldTileByteCache, sha256Hex, worldTileByteCacheKey } from './byteCache';

afterEach(() => vi.unstubAllGlobals());

describe('world tile byte cache identity', () => {
  it('keeps immutable content revisions separate even if a URL is reused accidentally', () => {
    const url = 'https://tiles.example.test/world/tile.png';
    expect(worldTileByteCacheKey({ url, contentHash: 'first' }))
      .not.toBe(worldTileByteCacheKey({ url, contentHash: 'second' }));
  });

  it('computes the renderer-compatible lowercase SHA-256 digest', async () => {
    expect(await sha256Hex(new Blob(['wamp']))).toBe(
      '5bed0e036c8e899173b3eb483f3eebcab972fd4803109123ad5e8cac08de555d',
    );
  });

  it('deduplicates concurrent immutable fetches by content hash', async () => {
    const blob = new Blob(['tile-bytes']);
    const contentHash = await sha256Hex(blob);
    const fetchMock = vi.fn(async () => new Response(blob, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const cache = new WorldTileByteCache(1_024);
    const ready = {
      generation: 1,
      contentHash,
      url: 'https://tiles.example.test/tile.png',
      width: 642 as const,
      height: 354 as const,
      overlap: 1 as const,
      byteLength: blob.size,
    };
    const [first, second] = await Promise.all([
      cache.getOrFetch(ready),
      cache.getOrFetch(ready),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.blob.size).toBe(second.blob.size);
  });

  it('detaches an old lifecycle without letting its completion clear the replacement request', async () => {
    const blob = new Blob(['tile-bytes']);
    const contentHash = await sha256Hex(blob);
    const deferred: Array<() => void> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      deferred.push(() => resolve(new Response(blob, { status: 200 })));
    }));
    vi.stubGlobal('fetch', fetchMock);
    const cache = new WorldTileByteCache(1_024);
    const ready = {
      generation: 1,
      contentHash,
      url: 'https://tiles.example.test/tile.png',
      width: 642 as const,
      height: 354 as const,
      overlap: 1 as const,
      byteLength: blob.size,
    };

    const obsolete = cache.getOrFetch(ready);
    cache.detachPendingRequests();
    const replacement = cache.getOrFetch(ready);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    deferred[0]();
    await obsolete;
    const deduplicatedReplacement = cache.getOrFetch(ready);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    deferred[1]();
    await Promise.all([replacement, deduplicatedReplacement]);
  });

  it('does not poison the cache when valid-length bytes have the wrong hash', async () => {
    const correct = new Blob(['good']);
    const corrupt = new Blob(['evil']);
    const contentHash = await sha256Hex(correct);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(corrupt, { status: 200 }))
      .mockResolvedValueOnce(new Response(correct, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const cache = new WorldTileByteCache(1_024);
    const ready = {
      generation: 1,
      contentHash,
      url: 'https://tiles.example.test/tile.png',
      width: 642 as const,
      height: 354 as const,
      overlap: 1 as const,
      byteLength: correct.size,
    };
    await expect(cache.getOrFetch(ready)).rejects.toThrow('content hash mismatch');
    await expect(cache.getOrFetch(ready, undefined, true)).resolves.toMatchObject({ cacheHit: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
