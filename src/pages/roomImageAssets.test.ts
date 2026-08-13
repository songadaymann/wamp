import { afterEach, describe, expect, it, vi } from 'vitest';
import { encode as encodeJpeg } from 'jpeg-js';
import type { PagesWorkerEnv } from './model';
import {
  decodeJpegImageData,
  drawCustomBackgroundImage,
  getCustomBackgroundCenterRect,
  getCustomBackgroundTileScale,
  loadAssetImageData,
  loadCustomBackgroundImageData,
  normalizeAssetPath,
  parseCustomBackground,
} from './roomImageAssets';
import {
  createCanvas,
  encodePng,
  fillRect,
} from './roomImagePrimitives';

function pngResponse(
  pixels = new Uint8Array([11, 22, 33, 255]),
  width = 1,
  height = 1,
): Response {
  return new Response(encodePng(width, height, pixels).buffer as ArrayBuffer, {
    headers: { 'Content-Type': 'image/png' },
  });
}

function createEnv(fetchAsset: (request: Request) => Promise<Response>): PagesWorkerEnv {
  return { ASSETS: { fetch: fetchAsset } };
}

function getPixel(canvas: ReturnType<typeof createCanvas>, x: number, y: number): number[] {
  const offset = (y * canvas.width + x) * 4;
  return Array.from(canvas.pixels.slice(offset, offset + 4));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('room image asset references', () => {
  it.each([
    ['assets/tiles.png', '/assets/tiles.png'],
    [' /assets/tiles.png ', '/assets/tiles.png'],
    ['///assets/tiles.png', '/assets/tiles.png'],
    ['', '/'],
    [null, '/'],
  ])('normalizes the legacy asset path %j', (input, expected) => {
    expect(normalizeAssetPath(input)).toBe(expected);
  });

  it.each([
    ['custom:abcdefgh', { id: 'abcdefgh', fit: 'tile' }],
    [' CUSTOM:abcdefgh?fit=stretch ', { id: 'abcdefgh', fit: 'stretch' }],
    ['custom:abcdefgh?fit=center&fit=stretch', { id: 'abcdefgh', fit: 'center' }],
    ['custom:abcdefgh?fit=unknown', { id: 'abcdefgh', fit: 'tile' }],
    ['custom:abc_def-123?other=value', { id: 'abc_def-123', fit: 'tile' }],
  ])('parses the custom background reference %s', (input, expected) => {
    expect(parseCustomBackground(input)).toEqual(expected);
  });

  it.each([
    null,
    '',
    'grassland',
    'custom:short',
    'custom:abcdefgh!',
    `custom:${'a'.repeat(129)}`,
  ])('rejects a non-custom or invalid background reference %j', (input) => {
    expect(parseCustomBackground(input)).toBeNull();
  });
});

describe('room image built-in asset loading', () => {
  it('constructs an origin-local ASSETS request and decodes its PNG response', async () => {
    const fetchAsset = vi.fn(async (request: Request) => {
      expect(request.url).toBe('https://preview.wamp.land/assets/t13-fixture.png');
      expect(request.method).toBe('GET');
      expect(request.headers.get('X-T13-Fixture')).toBe('asset-loader');
      return pngResponse();
    });
    const request = new Request('https://preview.wamp.land/r/11/-12/image.png?ignored=1', {
      headers: { 'X-T13-Fixture': 'asset-loader' },
    });

    await expect(loadAssetImageData(
      request,
      createEnv(fetchAsset),
      new URL(request.url),
      ' //assets/t13-fixture.png ',
    )).resolves.toEqual({
      width: 1,
      height: 1,
      pixels: new Uint8Array([11, 22, 33, 255]),
    });
    expect(fetchAsset).toHaveBeenCalledTimes(1);
  });

  it('deduplicates normalized asset paths and retains the fulfilled promise in cache', async () => {
    const fetchAsset = vi.fn(async () => pngResponse(new Uint8Array([44, 55, 66, 255])));
    const env = createEnv(fetchAsset);
    const request = new Request('https://preview.wamp.land/r/1/2/image.png');
    const url = new URL(request.url);

    const [first, second] = await Promise.all([
      loadAssetImageData(request, env, url, 'assets/t13-cache.png'),
      loadAssetImageData(request, env, url, '/assets/t13-cache.png'),
    ]);
    const third = await loadAssetImageData(request, env, url, '///assets/t13-cache.png');

    expect(fetchAsset).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(third).toEqual(first);
  });

  it('retains rejected asset promises and preserves the exact non-OK error', async () => {
    const firstFetch = vi.fn(async () => new Response('missing', { status: 404 }));
    const secondFetch = vi.fn(async () => pngResponse());
    const request = new Request('https://preview.wamp.land/r/1/2/image.png');
    const url = new URL(request.url);

    await expect(loadAssetImageData(
      request,
      createEnv(firstFetch),
      url,
      'assets/t13-rejected.png',
    )).rejects.toThrow('Failed to load asset /assets/t13-rejected.png');
    await expect(loadAssetImageData(
      request,
      createEnv(secondFetch),
      url,
      '/assets/t13-rejected.png',
    )).rejects.toThrow('Failed to load asset /assets/t13-rejected.png');

    expect(firstFetch).toHaveBeenCalledTimes(1);
    expect(secondFetch).not.toHaveBeenCalled();
  });
});

describe('room image custom background loading', () => {
  it('uses the configured API URL, transform hint, user agent, PNG decoder, and URL-keyed cache', async () => {
    const fetchImage = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      pngResponse(new Uint8Array([77, 88, 99, 255]))
    ));
    vi.stubGlobal('fetch', fetchImage);
    const request = new Request('https://preview.wamp.land/r/1/2/image.png', {
      headers: { 'User-Agent': 'T13 image fixture' },
    });
    const env: PagesWorkerEnv = {
      ASSETS: { fetch: vi.fn() },
      ROOM_SHARE_API_BASE_URL: 'https://api.example.test/base/',
    };

    const first = await loadCustomBackgroundImageData(
      request,
      env,
      new URL(request.url),
      't13_png_fixture',
    );
    const second = await loadCustomBackgroundImageData(
      request,
      env,
      new URL('https://another-page-origin.test/r/3/4/image.png'),
      't13_png_fixture',
    );

    expect(first).toEqual({
      width: 1,
      height: 1,
      pixels: new Uint8Array([77, 88, 99, 255]),
    });
    expect(second).toEqual(first);
    expect(fetchImage).toHaveBeenCalledTimes(1);
    const [input, init] = fetchImage.mock.calls[0];
    expect(input).toBe('https://api.example.test/api/background-images/t13_png_fixture/image');
    expect(init).toMatchObject({
      headers: {
        Accept: 'image/png',
        'User-Agent': 'T13 image fixture',
      },
      cf: { image: { format: 'png' } },
    });
  });

  it('falls back to the renderer user agent and dispatches JPEG bytes to jpeg-js', async () => {
    const encoded = encodeJpeg({
      width: 1,
      height: 1,
      data: new Uint8Array([210, 40, 30, 255]),
    }, 100).data;
    const fetchImage = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      new Response(Uint8Array.from(encoded).buffer)
    ));
    vi.stubGlobal('fetch', fetchImage);
    const request = new Request('https://preview.wamp.land/r/1/2/image.png');

    const image = await loadCustomBackgroundImageData(
      request,
      createEnv(vi.fn()),
      new URL(request.url),
      't13_jpeg_fixture',
    );

    expect(image.width).toBe(1);
    expect(image.height).toBe(1);
    expect(image.pixels).toHaveLength(4);
    expect(image.pixels[0]).toBeGreaterThan(180);
    expect(image.pixels[3]).toBe(255);
    const init = fetchImage.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get('User-Agent')).toBe('WAMP room share renderer');
  });

  it('preserves custom-background HTTP and unsupported-format errors', async () => {
    const request = new Request('https://preview.wamp.land/r/1/2/image.png');
    const url = new URL(request.url);
    const unavailableFetch = vi.fn(async () => new Response('missing', { status: 503 }));
    vi.stubGlobal('fetch', unavailableFetch);

    await expect(loadCustomBackgroundImageData(
      request,
      createEnv(vi.fn()),
      url,
      't13_http_error',
    )).rejects.toThrow('Failed to load custom background t13_http_error');

    const recoveredFetch = vi.fn(async () => pngResponse());
    vi.stubGlobal('fetch', recoveredFetch);
    await expect(loadCustomBackgroundImageData(
      request,
      createEnv(vi.fn()),
      url,
      't13_http_error',
    )).rejects.toThrow('Failed to load custom background t13_http_error');
    expect(unavailableFetch).toHaveBeenCalledOnce();
    expect(recoveredFetch).not.toHaveBeenCalled();

    vi.stubGlobal('fetch', vi.fn(async () => (
      new Response(new Uint8Array([1, 2, 3, 4]).buffer)
    )));
    await expect(loadCustomBackgroundImageData(
      request,
      createEnv(vi.fn()),
      url,
      't13_format_error',
    )).rejects.toThrow(
      'Custom background t13_format_error was not returned as a supported image format.',
    );
  });

  it('decodes JPEG bytes with an RGBA typed-array result', () => {
    const encoded = encodeJpeg({
      width: 2,
      height: 1,
      data: new Uint8Array([
        255, 0, 0, 255,
        0, 0, 255, 255,
      ]),
    }, 100).data;

    const image = decodeJpegImageData(encoded);

    expect(image).toMatchObject({ width: 2, height: 1 });
    expect(image.pixels).toBeInstanceOf(Uint8Array);
    expect(image.pixels).toHaveLength(8);
    expect(image.pixels[3]).toBe(255);
    expect(image.pixels[7]).toBe(255);
  });
});

describe('room image custom background fit geometry', () => {
  it.each([
    [{ width: 64, height: 48 }, 1],
    [{ width: 256, height: 192 }, 0.5],
    [{ width: 512, height: 96 }, 0.25],
    [{ width: 0, height: 0 }, 1],
  ])('keeps the legacy tile scale constraint for %j', (size, expected) => {
    expect(getCustomBackgroundTileScale(size)).toBe(expected);
  });

  it.each([
    [
      { width: 640, height: 480 },
      { width: 480, height: 288 },
      { x: 48, y: 0, width: 384, height: 288 },
    ],
    [
      { width: 100, height: 50 },
      { width: 480, height: 288 },
      { x: 190, y: 119, width: 100, height: 50 },
    ],
    [
      { width: 0, height: 0 },
      { width: 4, height: 3 },
      { x: 1, y: 1, width: 1, height: 1 },
    ],
  ])('keeps the legacy centered-image rectangle', (source, target, expected) => {
    expect(getCustomBackgroundCenterRect(source, target)).toEqual(expected);
  });

  it('draws stretch and tile fits only inside their requested canvas bounds', () => {
    const image = createCanvas(1, 1);
    fillRect(image, 0, 0, 1, 1, 0x123456);

    const stretched = createCanvas(4, 3);
    drawCustomBackgroundImage(stretched, image, 'stretch', 1, 1, 2, 2);
    expect(getPixel(stretched, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(getPixel(stretched, 1, 1)).toEqual([0x12, 0x34, 0x56, 255]);
    expect(getPixel(stretched, 2, 2)).toEqual([0x12, 0x34, 0x56, 255]);
    expect(getPixel(stretched, 3, 2)).toEqual([0, 0, 0, 0]);

    const tiled = createCanvas(4, 3);
    drawCustomBackgroundImage(tiled, image, 'tile', 0, 0, 4, 3);
    for (let y = 0; y < tiled.height; y += 1) {
      for (let x = 0; x < tiled.width; x += 1) {
        expect(getPixel(tiled, x, y)).toEqual([0x12, 0x34, 0x56, 255]);
      }
    }
  });
});
