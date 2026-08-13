import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PagesWorkerEnv } from './model';
import {
  handleSharePageRequest,
  parseRoomImageCoordinates,
} from './shareRoutes';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Pages share route ownership', () => {
  it.each([
    ['/r/11/-12/image', { x: 11, y: -12 }],
    ['/r/00011/-0012/image.png/', { x: 11, y: -12 }],
    ['/r/9007199254740993/-0/image.png', { x: 9_007_199_254_740_992, y: -0 }],
    ['/r/11/-12', null],
    ['/r/11/-12/image.jpg', null],
  ])('parses room image coordinates for %s', (pathname, expected) => {
    expect(parseRoomImageCoordinates(pathname)).toEqual(expected);
  });

  it.each([
    '/r/11/-12',
    '/?x=11&y=-12',
    '/playlist/safety-fixture',
    '/wamp-o-gram/abcdefghijkl',
    '/fixture_user',
  ])('rejects mutations to recognized share page %s without I/O', async (pathname) => {
    const fetchAsset = vi.fn(async () => new Response('unexpected'));
    const fetchMetadata = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchMetadata);
    const request = new Request(`https://preview.wamp.land${pathname}`, {
      method: 'POST',
    });

    const response = await handleSharePageRequest(
      request,
      { ASSETS: { fetch: fetchAsset } } satisfies PagesWorkerEnv,
      new URL(request.url),
    );

    expect(response?.status).toBe(405);
    expect(response?.headers.get('Allow')).toBe('GET, HEAD');
    expect(await response?.text()).toBe('Method Not Allowed');
    expect(fetchMetadata).not.toHaveBeenCalled();
    expect(fetchAsset).not.toHaveBeenCalled();
  });

  it.each([
    '/r/11/-12/image.png',
    '/?x=11.5&y=-12',
    '/api/health',
    '/two/segments',
  ])('returns null for non-share-page route %s without consuming it', async (pathname) => {
    const fetchAsset = vi.fn(async () => new Response('unexpected'));
    const request = new Request(`https://preview.wamp.land${pathname}`);

    const response = await handleSharePageRequest(
      request,
      { ASSETS: { fetch: fetchAsset } } satisfies PagesWorkerEnv,
      new URL(request.url),
    );

    expect(response).toBeNull();
    expect(fetchAsset).not.toHaveBeenCalled();
  });
});
