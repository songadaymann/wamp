import { handleRoomImageRequest } from './roomImageRenderer';
import { createDefaultRoomSnapshot } from '../persistence/roomModel';
import { BLOCKED_ART_COLOR } from '../customSprites/blocklist';
import { parseSolidColorBackgroundColor, resolveRoomBackground } from '../backgrounds/model';
import { parseCustomSpriteObjectId } from '../customSprites/model';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { ROOM_HEIGHT, ROOM_WIDTH, TILE_FLIP_X_FLAG, TILE_FLIP_Y_FLAG } from '../config';
import type { PagesWorkerEnv } from './model';
import { decodePng } from '../roomImage/roomImagePrimitives';
import {
  createFallbackRoomSnapshot,
  decodeTileValue,
  getTileColor,
  renderRoomSharePreviewPng,
} from '../roomImage/roomImageRenderer';
import type { PublishedRoomSnapshot } from './shareMetadata';

afterEach(() => vi.unstubAllGlobals());

const PAGE_URL = new URL('https://preview.wamp.land/r/11/-12/image.png');

function emptyLayer(): number[][] {
  return Array.from(
    { length: ROOM_HEIGHT },
    () => Array.from({ length: ROOM_WIDTH }, () => -1),
  );
}

function createEnv(
  fetchAsset: PagesWorkerEnv['ASSETS']['fetch'] = vi.fn(async () => new Response('unexpected')),
): PagesWorkerEnv {
  return {
    ASSETS: { fetch: fetchAsset },
    ROOM_SHARE_API_BASE_URL: 'https://api.example.test',
  };
}

function pixelAt(
  image: Awaited<ReturnType<typeof decodePng>>,
  x: number,
  y: number,
): number[] {
  const offset = (y * image.width + x) * 4;
  return Array.from(image.pixels.slice(offset, offset + 4));
}

describe('room image renderer model normalization', () => {
  it('creates the exact empty grassland fallback snapshot', () => {
    const snapshot = createFallbackRoomSnapshot({ x: 11, y: -12 });

    expect(snapshot).toMatchObject({
      id: '11,-12',
      coordinates: { x: 11, y: -12 },
      title: null,
      background: 'grassland',
      placedObjects: [],
    });
    expect(snapshot.tileData).toEqual({
      background: emptyLayer(),
      terrain: emptyLayer(),
      foreground: emptyLayer(),
    });
  });

  it.each([
    ['solid:#123456', 0x123456],
    [' SOLID:abcdef ', 0xabcdef],
    ['solid:12345', null],
    ['grassland', null],
    [null, null],
  ])('parses legacy solid background %j', (input, expected) => {
    expect(parseSolidColorBackgroundColor(input)).toBe(expected === null ? null : '#' + expected.toString(16).padStart(6, '0'));
  });

  it('uses canonical solid, custom, group and default backgrounds', () => {
    expect(resolveRoomBackground('solid:#123456')).toEqual({ kind: 'solid', color: '#123456' });
    expect(resolveRoomBackground('custom:abcdefgh?fit=center')).toEqual({ kind: 'custom', id: 'abcdefgh', fit: 'center' });
    expect(resolveRoomBackground('desert')).toMatchObject({ kind: 'group', group: { id: 'desert' } });
    expect(resolveRoomBackground(null)).toEqual({ kind: 'none' });
  });

  it('preserves tile flip decoding and invalid-value behavior', () => {
    expect(decodeTileValue(42)).toEqual({ gid: 42, flipX: false, flipY: false });
    expect(decodeTileValue(42 + TILE_FLIP_X_FLAG)).toEqual({
      gid: 42,
      flipX: true,
      flipY: false,
    });
    expect(decodeTileValue(42 + TILE_FLIP_X_FLAG + TILE_FLIP_Y_FLAG)).toEqual({
      gid: 42,
      flipX: true,
      flipY: true,
    });
    expect(decodeTileValue(Number.NaN)).toEqual({ gid: -1, flipX: false, flipY: false });
    expect(decodeTileValue('42')).toEqual({ gid: -1, flipX: false, flipY: false });
  });

  it('preserves custom-sprite IDs and deterministic fallback tile colors', () => {
    expect(parseCustomSpriteObjectId('custom_sprite: fixture ')).toBe('fixture');
    expect(parseCustomSpriteObjectId('custom_sprite:')).toBeNull();
    expect(parseCustomSpriteObjectId('coin_gold')).toBeNull();
    expect(getTileColor(99, 3, 4)).toBe(getTileColor(99, 3, 4));
    expect(getTileColor(99, 3, 4)).not.toBe(getTileColor(100, 3, 4));
  });
});

describe('room image renderer orchestration', () => {
  it('renders a deterministic solid-background PNG without asset I/O', async () => {
    const fetchAsset = vi.fn(async () => new Response('unexpected'));
    const snapshot: PublishedRoomSnapshot = {
      id: '11,-12',
      background: 'solid:#123456',
      tileData: {
        background: emptyLayer(),
        terrain: emptyLayer(),
        foreground: emptyLayer(),
      },
      placedObjects: [],
    };

    const png = await renderRoomSharePreviewPng(
      new Request(PAGE_URL),
      createEnv(fetchAsset),
      PAGE_URL,
      snapshot,
    );
    const image = await decodePng(png);

    expect(image.width).toBe(1200);
    expect(image.height).toBe(630);
    expect(pixelAt(image, 0, 0)).toEqual([0x12, 0x34, 0x56, 255]);
    expect(fetchAsset).not.toHaveBeenCalled();
  });

  it('decodes and draws the actual golden cassette through the Pages PNG asset path', async () => {
    const snapshot: PublishedRoomSnapshot = {
      id: '11,-12', background: 'solid:#000000',
      tileData: { background: emptyLayer(), terrain: emptyLayer(), foreground: emptyLayer() },
      placedObjects: [{ id: 'lost_song', x: 8, y: 8, layer: 'terrain' }],
    };
    const fetchAsset = vi.fn(async () => new Response(new Uint8Array(readFileSync('public/assets/objects/lost_song.png'))));
    const png = await renderRoomSharePreviewPng(new Request(PAGE_URL), createEnv(fetchAsset), PAGE_URL, snapshot);
    const image = await decodePng(png);
    expect(fetchAsset).toHaveBeenCalled();
    expect(Array.from(image.pixels).filter((_, i) => i % 4 === 0).some((red, i) => red === 252 && image.pixels[i*4+1] === 234)).toBe(true);
  });

  it('draws a real-art room with the corrected real-art pixels in a compressed PNG (F332)', async () => {
    const snapshot = JSON.parse(readFileSync('test/fixtures/smart-autotiling/references/desert-x-7-y-3.room.json', 'utf8'))
      .snapshot as PublishedRoomSnapshot;
    const fetchAsset = vi.fn(async (request: Request) => {
      const path = `public${decodeURIComponent(new URL(request.url).pathname)}`;
      return existsSync(path) ? new Response(new Uint8Array(readFileSync(path))) : new Response('missing', { status: 404 });
    });
    const png = await renderRoomSharePreviewPng(new Request(PAGE_URL), createEnv(fetchAsset), PAGE_URL, snapshot);
    const image = await decodePng(png);

    expect(fetchAsset).toHaveBeenCalled();
    // Corrected F269/F389 real-art pixels; renderer versions were bumped with the intentional drawing changes.
    expect(createHash('sha256').update(image.pixels).digest('hex'))
      .toBe('38c388aff5f5fa8a288f063cea4dffa3922e115f9cf7a8b052c7aa6e3c124392');
    expect(png.length).toBeLessThan(120_000);
  });

  it('draws an eligible custom sprite in its configured object layer', async () => {
    const pixels = Array.from({ length: 16 * 16 }, () => null as string | null);
    pixels[0] = '#ff0000';
    const snapshot: PublishedRoomSnapshot = {
      id: '11,-12',
      background: 'solid:#000000',
      tileData: {
        background: emptyLayer(),
        terrain: emptyLayer(),
        foreground: emptyLayer(),
      },
      placedObjects: [{
        id: 'custom_sprite:fixture',
        x: 8,
        y: 8,
        layer: 'terrain',
      }],
      customSprites: [{
        id: 'fixture',
        size: 16,
        status: 'ready',
        pixels,
      }],
    };

    const png = await renderRoomSharePreviewPng(
      new Request(PAGE_URL),
      createEnv(),
      PAGE_URL,
      snapshot,
    );
    const image = await decodePng(png);

    expect(pixelAt(image, 60, 18)).toEqual([255, 0, 0, 255]);
  });
});

describe('Pages image moderation for custom-tile source art', () => {
  it.each([true, false])('masks a tile even without an embedded sprite (blocklist available=%s)', async available => {
    const snapshot = createDefaultRoomSnapshot('11,-12', { x: 11, y: -12 });
    snapshot.background = 'solid:#000000'; snapshot.customSprites = [];
    snapshot.customTiles = [{ id: 'source-tile', name: 'Source tile', sourceSpriteId: 'blocked-source',
      collision: 'none', pixels: Array(256).fill('#ff0000'), createdAt: '2026-10-29', updatedAt: '2026-10-29' }];
    snapshot.tileData.terrain[0][0] = 10_000;
    const fetchApi = vi.fn(async (input: RequestInfo | URL) => String(input).includes('/api/world/tiles/config')
      ? available ? Response.json({ blockedCustomSpriteIds: ['blocked-source'] }) : new Response(null, { status: 503 })
      : Response.json(snapshot));
    vi.stubGlobal('fetch', fetchApi);
    const response = await handleRoomImageRequest(new Request(PAGE_URL), createEnv(), PAGE_URL, snapshot.coordinates);
    const image = await decodePng(new Uint8Array(await response.arrayBuffer()));
    const color = Number.parseInt(BLOCKED_ART_COLOR.slice(1), 16);
    expect(pixelAt(image, 70, 28)).toEqual([(color >> 16) & 255, (color >> 8) & 255, color & 255, 255]);
    expect(fetchApi).toHaveBeenCalledTimes(2);
    if (!available) expect(response.headers.get('Cache-Control')).toBe('public, max-age=60, s-maxage=60');
  });
});
