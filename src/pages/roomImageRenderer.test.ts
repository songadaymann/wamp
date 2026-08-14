import { describe, expect, it, vi } from 'vitest';
import { ROOM_HEIGHT, ROOM_WIDTH, TILE_FLIP_X_FLAG, TILE_FLIP_Y_FLAG } from '../config';
import type { PagesWorkerEnv } from './model';
import { decodePng } from './roomImagePrimitives';
import {
  backgroundPalette,
  createFallbackRoomSnapshot,
  decodeTileValue,
  getTileColor,
  parseCustomSpriteObjectId,
  parseSolidBackgroundColor,
  renderRoomSharePreviewPng,
  resolvePreviewBackground,
} from './roomImageRenderer';
import type { PublishedRoomSnapshot } from './shareMetadata';

const PAGE_URL = new URL('https://preview.wamp.land/r/11/-12/image.png');

function emptyLayer(): number[][] {
  return Array.from(
    { length: ROOM_HEIGHT },
    () => Array.from({ length: ROOM_WIDTH }, () => -1),
  );
}

function createEnv(fetchAsset = vi.fn(async () => new Response('unexpected'))): PagesWorkerEnv {
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
    expect(parseSolidBackgroundColor(input)).toBe(expected);
  });

  it('resolves solid, custom, configured, and fallback background forms', () => {
    expect(resolvePreviewBackground('solid:#123456')).toEqual({
      kind: 'solid',
      color: 0x123456,
    });
    expect(resolvePreviewBackground('custom:abcdefgh?fit=center')).toEqual({
      kind: 'custom',
      id: 'abcdefgh',
      fit: 'center',
      palette: backgroundPalette('grassland'),
    });
    expect(resolvePreviewBackground({ group: { id: 'desert' } })).toEqual({
      kind: 'palette',
      id: 'desert',
      palette: backgroundPalette('desert'),
    });
    expect(resolvePreviewBackground(null)).toEqual({
      kind: 'palette',
      id: 'grassland',
      palette: backgroundPalette('grassland'),
    });
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
