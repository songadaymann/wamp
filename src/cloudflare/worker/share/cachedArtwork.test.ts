import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRoomSnapshot } from '../../../persistence/roomModel';
import { decodePng, createCanvas, fillRect } from '../../../roomImage/roomImagePrimitives';
import { encodePng } from '../../../utils/pngEncoder';
import { WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH } from '../../../worldTiles/assetContract';
import type { Env } from '../core/types';
import { loadWorldTileManifestReadSet, type WorldTileManifestReadSet } from '../worldTiles/store';
import { loadCachedShareArtwork } from './cachedArtwork';

vi.mock('../worldTiles/store', () => ({ loadWorldTileManifestReadSet: vi.fn() }));
const cells = [-2, -1].map(x => ({ coordinates: { x, y: -3 },
  snapshot: { ...createDefaultRoomSnapshot(`${x},-3`, { x, y: -3 }), version: 4 } }));
let read: WorldTileManifestReadSet;
let objects: Map<string, Uint8Array>;
let env: Env;
let put: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetAllMocks();
  read = { rendererVersion: 'active', rendererAssetContractHash: WORLD_TILE_AUTHORING_ASSET_CONTRACT_HASH,
    leafChanges: [], rooms: cells.map(cell => ({ id: cell.snapshot.id, coordinates: cell.coordinates, version: 4,
      title: null, state: 'published', goalType: null, publishedAt: null, previewUpdatedAt: null,
      creatorUserId: null, creatorDisplayName: null })),
    tileRows: cells.map((cell, i) => ({ renderer_version: 'active', level: 4, tile_x: cell.coordinates.x, tile_y: -3,
      desired_generation: 2, desired_empty: 0, ready_generation: 2, ready_hash: `hash${i}`, ready_empty: 0,
      r2_key: `world-tiles/active/objects/${i}.png`, byte_length: 100, ready_at: '2026-10-29' })) };
  vi.mocked(loadWorldTileManifestReadSet).mockImplementation(async () => read);
  objects = new Map();
  for (const [i, tile] of read.tileRows.entries()) {
    const canvas = createCanvas(642, 354);
    fillRect(canvas, 0, 0, 642, 354, 0xff00ff); // overlap must not appear in composite
    fillRect(canvas, 1, 1, 640, 352, i ? 0x00ff00 : 0xff0000);
    objects.set(tile.r2_key!, await encodePng(642, 354, canvas.pixels));
  }
  put = vi.fn(async (key: string, bytes: Uint8Array) => { objects.set(key, bytes); });
  env = { WORLD_TILE_PUBLIC_BASE_URL: 'https://tiles.wamp.land', WORLD_TILE_BUCKET: {
    head: vi.fn(async key => objects.has(key) ? { key, size: objects.get(key)!.length, etag: 'etag', uploaded: new Date() } : null),
    get: vi.fn(async key => objects.has(key) ? { arrayBuffer: async () => objects.get(key)!.slice().buffer as ArrayBuffer } : null),
    put, list: vi.fn(), delete: vi.fn(),
  } } as unknown as Env;
});

const area = { id: 'expanded:test', version: 3 };
const pixel = (image: Awaited<ReturnType<typeof decodePng>>, x: number, y: number) =>
  [...image.pixels.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];

describe('cached map artwork for shares', () => {
  it('uses the ready leaf public URL and its real dimensions without drawing or reading PNG bytes', async () => {
    expect(await loadCachedShareArtwork(env, [cells[0]], null)).toEqual({
      url: 'https://tiles.wamp.land/world-tiles/active/objects/0.png',
      key: 'world-tiles/active/objects/0.png', width: 642, height: 354,
    });
    expect(env.WORLD_TILE_BUCKET!.get).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it.each(['missing', 'stale', 'empty', 'version', 'renderer', 'contract', 'object'])(
    'falls back when a required leaf is %s', async reason => {
      if (reason === 'missing') read.tileRows = [];
      if (reason === 'stale') read.tileRows[0].ready_generation = 1;
      if (reason === 'empty') read.tileRows[0].ready_empty = 1;
      if (reason === 'version') read.rooms[0].version = 5;
      if (reason === 'renderer') read.tileRows[0].renderer_version = 'retired';
      if (reason === 'contract') read.rendererAssetContractHash = 'old-assets';
      if (reason === 'object') objects.clear();
      expect(await loadCachedShareArtwork(env, [cells[0]], null)).toBeNull();
      expect(put).not.toHaveBeenCalled();
    },
  );

  it('composes negative-coordinate cells in geometry order, crops overlap and reuses the cached PNG', async () => {
    const result = await loadCachedShareArtwork(env, [...cells].reverse(), area);
    expect(result).toMatchObject({ width: 1200, height: 630 });
    const image = await decodePng(objects.get(result!.key)!);
    expect(pixel(image, 100, 315)).toEqual([255, 0, 0, 255]);
    expect(pixel(image, 1100, 315)).toEqual([0, 255, 0, 255]);
    expect(pixel(image, 600, 20)).toEqual([14, 21, 36, 255]);
    expect(put).toHaveBeenCalledTimes(1);
    expect(await loadCachedShareArtwork(env, cells, area)).toEqual(result);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('changes the composite key for area versions and tile repairs even if room versions stay fixed', async () => {
    const first = await loadCachedShareArtwork(env, cells, area);
    const version = await loadCachedShareArtwork(env, cells, { ...area, version: 4 });
    expect(version!.key).not.toBe(first!.key);
    read.tileRows[0].ready_hash = 'repaired';
    const repair = await loadCachedShareArtwork(env, cells, area);
    expect(repair!.key).not.toBe(first!.key);
  });

  it('preserves vertical cell placement and leaves unoccupied footprint cells empty', async () => {
    const third = { ...cells[0], coordinates: { x: -2, y: -2 },
      snapshot: { ...cells[0].snapshot, id: '-2,-2', coordinates: { x: -2, y: -2 } } };
    read.rooms.push({ ...read.rooms[0], id: third.snapshot.id, coordinates: third.coordinates });
    read.tileRows.push({ ...read.tileRows[0], tile_y: -2 });
    const result = await loadCachedShareArtwork(env, [...cells, third], area);
    const image = await decodePng(objects.get(result!.key)!);
    expect(pixel(image, 400, 200)).toEqual([255, 0, 0, 255]);
    expect(pixel(image, 800, 200)).toEqual([0, 255, 0, 255]);
    expect(pixel(image, 400, 450)).toEqual([255, 0, 0, 255]);
    expect(pixel(image, 800, 450)).toEqual([14, 21, 36, 255]);
  });

  it('does not substitute current map art for an older pinned Expanded Room version', async () => {
    read.rooms[1].version = 5;
    expect(await loadCachedShareArtwork(env, cells, area)).toBeNull();
    expect(put).not.toHaveBeenCalled();
  });

  it.each(['missing', 'corrupt', 'wrong-size', 'read-error', 'write-error'])(
    'keeps fallback available for %s composite storage', async failure => {
      const key = read.tileRows[1].r2_key!;
      if (failure === 'missing') objects.delete(key);
      if (failure === 'corrupt') objects.set(key, new Uint8Array([1, 2, 3]));
      if (failure === 'wrong-size') objects.set(key, await encodePng(1, 1, new Uint8Array(4)));
      if (failure === 'read-error') vi.mocked(env.WORLD_TILE_BUCKET!.get!).mockRejectedValue(new Error('R2 unavailable'));
      if (failure === 'write-error') put.mockRejectedValue(new Error('R2 unavailable'));
      expect(await loadCachedShareArtwork(env, cells, area)).toBeNull();
    },
  );

  it('falls back when the read model is unavailable', async () => {
    vi.mocked(loadWorldTileManifestReadSet).mockRejectedValue(new Error('D1 unavailable'));
    expect(await loadCachedShareArtwork(env, cells, area)).toBeNull();
  });
});
