import { composeRoomImages } from '../../../roomImage/compose';
import { sha256Hex } from '../../../mint/roomMetadata';
import { decodePng } from '../../../roomImage/roomImagePrimitives';
import { encodePng } from '../../../utils/pngEncoder';
import { WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH } from '../../../worldTiles/assetContract';
import { WORLD_TILE_CONTENT_HEIGHT, WORLD_TILE_CONTENT_WIDTH, WORLD_TILE_IMAGE_HEIGHT,
  WORLD_TILE_IMAGE_WIDTH, WORLD_TILE_OVERLAP } from '../../../worldTiles/model';
import type { Env } from '../core/types';
import { normalizeWorldTilePublicBaseUrl } from '../worldTiles/service';
import { loadWorldTileManifestReadSet } from '../worldTiles/store';
import { ROOM_SHARE_IMAGE_HEIGHT, ROOM_SHARE_IMAGE_WIDTH, type ExpandedRoomSharePreviewCell } from './imageRenderer';

interface CachedShareArtwork { url: string; key: string; width: number; height: number }

/** Only current, complete leaves for the exact pinned room versions may replace the fallback. */
export async function loadCachedShareArtwork(env: Env, cells: ExpandedRoomSharePreviewCell[],
  area: { id: string; version: number | null } | null): Promise<CachedShareArtwork | null> {
  const bucket = env.WORLD_TILE_BUCKET;
  const base = normalizeWorldTilePublicBaseUrl(env.WORLD_TILE_PUBLIC_BASE_URL);
  if (!bucket || !base || cells.length === 0) return null;
  try {
    const sorted = [...cells].sort((a, b) => a.coordinates.y - b.coordinates.y || a.coordinates.x - b.coordinates.x);
    const bounds = { minRoomX: Math.min(...sorted.map(c => c.coordinates.x)), maxRoomX: Math.max(...sorted.map(c => c.coordinates.x)),
      minRoomY: Math.min(...sorted.map(c => c.coordinates.y)), maxRoomY: Math.max(...sorted.map(c => c.coordinates.y)) };
    const read = await loadWorldTileManifestReadSet(env, sorted.map(c => ({ level: 4, ...c.coordinates })), bounds, bounds);
    if (!read.rendererVersion || read.rendererAssetContractHash !== WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH) return null;
    const leaves = sorted.map(cell => {
      const summary = read.rooms.find(room => room.id === cell.snapshot.id && room.coordinates.x === cell.coordinates.x
        && room.coordinates.y === cell.coordinates.y);
      const row = read.tileRows.find(tile => tile.level === 4 && tile.tile_x === cell.coordinates.x && tile.tile_y === cell.coordinates.y);
      return summary?.version === cell.snapshot.version && row?.renderer_version === read.rendererVersion
        && row.desired_empty === 0 && row.ready_empty === 0 && row.ready_generation === row.desired_generation
        && row.ready_hash && row.r2_key ? row : null;
    });
    if (leaves.some(leaf => !leaf)) return null;
    const keys = leaves.map(leaf => leaf!.r2_key!);
    if (cells.length === 1) {
      if (!await bucket.head(keys[0])) return null;
      return { key: keys[0], url: publicUrl(base, keys[0]), width: WORLD_TILE_IMAGE_WIDTH, height: WORLD_TILE_IMAGE_HEIGHT };
    }
    if (!area || !bucket.get || !bucket.put) return null;
    // Include renderer, ready hashes, geometry and pinned versions: repairs and republish invalidate the composite too.
    const identity = JSON.stringify({ format: 1, renderer: read.rendererVersion, area,
      cells: sorted.map((cell, i) => [cell.snapshot.id, cell.snapshot.version, cell.coordinates, keys[i], leaves[i]!.ready_hash]) });
    const key = `share-artwork/v1/${await sha256Hex(identity)}.png`;
    if (!await bucket.head(key)) {
      const images = await Promise.all(keys.map(async leafKey => {
        const object = await bucket.get!(leafKey);
        if (!object) throw new Error('Share leaf is not available.');
        const image = await decodePng(new Uint8Array(await object.arrayBuffer()));
        if (image.width !== WORLD_TILE_IMAGE_WIDTH || image.height !== WORLD_TILE_IMAGE_HEIGHT) throw new Error('Share leaf dimensions differ.');
        return image;
      }));
      const canvas = composeRoomImages(sorted.map((cell, i) => ({ coordinates: cell.coordinates, image: images[i],
        crop: { x: WORLD_TILE_OVERLAP, y: WORLD_TILE_OVERLAP, width: WORLD_TILE_CONTENT_WIDTH, height: WORLD_TILE_CONTENT_HEIGHT } })));
      await bucket.put(key, await encodePng(canvas.width, canvas.height, canvas.pixels), {
        httpMetadata: { contentType: 'image/png', cacheControl: 'public, max-age=3600' },
      });
    }
    return { key, url: publicUrl(base, key), width: ROOM_SHARE_IMAGE_WIDTH, height: ROOM_SHARE_IMAGE_HEIGHT };
  } catch {
    // A missing/lagging render, bad PNG or unavailable tile store must never break a room's share link.
    return null;
  }
}

function publicUrl(base: string, key: string): string {
  return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
}
