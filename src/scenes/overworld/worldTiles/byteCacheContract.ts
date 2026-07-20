export const WORLD_TILE_BYTE_CACHE_NAME = 'wamp-world-tile-bytes-v1';
export const WORLD_TILE_BYTE_CACHE_HASH_PARAM = '__wamp_tile_hash';

export function buildWorldTileByteCacheRequest(
  ready: { url: string; contentHash: string },
): Request {
  const url = new URL(ready.url);
  url.searchParams.set(WORLD_TILE_BYTE_CACHE_HASH_PARAM, ready.contentHash);
  return new Request(url.toString(), { method: 'GET' });
}
