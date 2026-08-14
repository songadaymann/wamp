import { describe, expect, it, vi } from 'vitest';
import type { PagesWorkerEnv } from './model';
import { handleStaticAssetRequest } from './staticAssets';

const STANDALONE_ALIASES = [
  ['/jam', '/__standalone/jam.asset'],
  ['/jam.html', '/__standalone/jam.asset'],
  ['/school-admin', '/__standalone/school-admin.asset'],
  ['/school-admin/', '/__standalone/school-admin.asset'],
  ['/school-admin.html', '/__standalone/school-admin.asset'],
  ['/school-login', '/__standalone/school-login.asset'],
  ['/school-login/', '/__standalone/school-login.asset'],
  ['/school-login.html', '/__standalone/school-login.asset'],
  ['/world-tile-render', '/__standalone/world-tile-render.asset'],
  ['/world-tile-render/', '/__standalone/world-tile-render.asset'],
  ['/world-tile-render.html', '/__standalone/world-tile-render.asset'],
] as const;

function requireResponse(response: Response | null): Response {
  expect(response).not.toBeNull();
  if (!response) throw new Error('Expected the typed static route to handle this request.');
  return response;
}

function createEnv(fetchAsset: (request: Request) => Promise<Response>): PagesWorkerEnv {
  return { ASSETS: { fetch: fetchAsset } };
}

describe('Pages standalone asset routing contract', () => {
  it.each(STANDALONE_ALIASES)('rewrites GET %s to %s', async (pathname, assetPathname) => {
    const fetchAsset = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      expect(url.pathname).toBe(assetPathname);
      expect(url.search).toBe('?fixture=safety');
      expect(request.method).toBe('GET');
      expect(request.headers.get('X-Contract-Test')).toBe('standalone');
      return new Response(`asset:${assetPathname}`, {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Asset-Header': 'preserved',
        },
      });
    });

    const response = requireResponse(await handleStaticAssetRequest(
      new Request(`https://preview.wamp.land${pathname}?fixture=safety`, {
        headers: { 'X-Contract-Test': 'standalone' },
      }),
      createEnv(fetchAsset),
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60, s-maxage=300');
    expect(response.headers.get('X-Asset-Header')).toBe('preserved');
    expect(await response.text()).toBe(`asset:${assetPathname}`);
    expect(fetchAsset).toHaveBeenCalledOnce();
  });

  it.each(STANDALONE_ALIASES)('rewrites HEAD %s and returns no body', async (pathname, assetPathname) => {
    const fetchAsset = vi.fn(async (request: Request) => {
      expect(new URL(request.url).pathname).toBe(assetPathname);
      expect(request.method).toBe('HEAD');
      return new Response('upstream body is not exposed', {
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    });

    const response = requireResponse(await handleStaticAssetRequest(
      new Request(`https://preview.wamp.land${pathname}`, { method: 'HEAD' }),
      createEnv(fetchAsset),
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toBe('');
    expect(fetchAsset).toHaveBeenCalledOnce();
  });

  it.each(STANDALONE_ALIASES)('rejects POST %s before asset lookup', async (pathname) => {
    const fetchAsset = vi.fn(async () => new Response('unexpected'));

    const response = requireResponse(await handleStaticAssetRequest(
      new Request(`https://preview.wamp.land${pathname}`, { method: 'POST' }),
      createEnv(fetchAsset),
    ));

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, HEAD');
    expect(await response.text()).toBe('Method Not Allowed');
    expect(fetchAsset).not.toHaveBeenCalled();
  });

  it.each(['GET', 'HEAD'])('redirects %s /jam/ to /jam and preserves the query', async (method) => {
    const fetchAsset = vi.fn(async () => new Response('unexpected'));

    const response = requireResponse(await handleStaticAssetRequest(
      new Request('https://preview.wamp.land/jam/?room=11%2C-12&mode=safety', { method }),
      createEnv(fetchAsset),
    ));

    expect(response.status).toBe(308);
    expect(response.headers.get('Location')).toBe(
      'https://preview.wamp.land/jam?room=11%2C-12&mode=safety',
    );
    expect(await response.text()).toBe('');
    expect(fetchAsset).not.toHaveBeenCalled();
  });

  it('leaves POST /jam/ unhandled instead of applying the GET redirect or alias rule', async () => {
    const fetchAsset = vi.fn(async () => new Response('unexpected'));

    const response = await handleStaticAssetRequest(
      new Request('https://preview.wamp.land/jam/?mode=safety', { method: 'POST' }),
      createEnv(fetchAsset),
    );

    expect(response).toBeNull();
    expect(fetchAsset).not.toHaveBeenCalled();
  });

  it('preserves upstream status and custom headers while replacing standalone cache headers', async () => {
    const fetchAsset = vi.fn(async () => new Response('missing standalone asset', {
      status: 404,
      headers: {
        'Cache-Control': 'private, max-age=0',
        'Content-Length': '999',
        'Content-Type': 'application/octet-stream',
        'X-Asset-Header': 'preserved',
      },
    }));

    const response = requireResponse(await handleStaticAssetRequest(
      new Request('https://preview.wamp.land/school-login'),
      createEnv(fetchAsset),
    ));

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60, s-maxage=300');
    expect(response.headers.get('Content-Length')).toBeNull();
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('X-Asset-Header')).toBe('preserved');
    expect(await response.text()).toBe('missing standalone asset');
  });
});

describe('Pages hashed asset routing contract', () => {
  it('passes through a successful non-HTML asset response unchanged', async () => {
    const upstream = new Response('export const ready = true;', {
      status: 206,
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Type': 'APPLICATION/JAVASCRIPT',
        ETag: 'fixture-etag',
      },
    });
    const fetchAsset = vi.fn(async (request: Request) => {
      expect(request.url).toBe('https://preview.wamp.land/assets/main-abcd1234.js?cache=1');
      return upstream;
    });

    const response = requireResponse(await handleStaticAssetRequest(
      new Request('https://preview.wamp.land/assets/main-abcd1234.js?cache=1'),
      createEnv(fetchAsset),
    ));

    expect(response).toBe(upstream);
    expect(response.status).toBe(206);
    expect(response.headers.get('ETag')).toBe('fixture-etag');
    expect(await response.text()).toBe('export const ready = true;');
    expect(fetchAsset).toHaveBeenCalledOnce();
  });

  it.each([
    ['an HTML SPA fallback', 200, 'TeXt/HtMl; charset=utf-8'],
    ['a non-success JavaScript response', 404, 'application/javascript'],
  ])('turns %s into an uncached 404', async (_label, status, contentType) => {
    const fetchAsset = vi.fn(async () => new Response('<title>fallback</title>', {
      status,
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Type': contentType,
      },
    }));

    const response = requireResponse(await handleStaticAssetRequest(
      new Request('https://preview.wamp.land/assets/main-missing.js'),
      createEnv(fetchAsset),
    ));

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await response.text()).toBe('Asset Not Found');
  });

  it('returns the hashed-asset 404 without a body for HEAD', async () => {
    const fetchAsset = vi.fn(async (request: Request) => {
      expect(request.method).toBe('HEAD');
      return new Response('<title>fallback</title>', {
        headers: { 'Content-Type': 'text/html' },
      });
    });

    const response = requireResponse(await handleStaticAssetRequest(
      new Request('https://preview.wamp.land/assets/main-missing.js', { method: 'HEAD' }),
      createEnv(fetchAsset),
    ));

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });

  it.each(['POST', 'PUT', 'DELETE'])('rejects %s to a hashed asset before asset lookup', async (method) => {
    const fetchAsset = vi.fn(async () => new Response('unexpected'));

    const response = requireResponse(await handleStaticAssetRequest(
      new Request('https://preview.wamp.land/assets/main-abcd1234.js', { method }),
      createEnv(fetchAsset),
    ));

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, HEAD');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(fetchAsset).not.toHaveBeenCalled();
  });

  it.each([
    '/',
    '/assets',
    '/asset/main-abcd1234.js',
    '/assets-not/main-abcd1234.js',
    '/r/11/-12',
  ])('leaves non-hashed path %s unhandled', async (pathname) => {
    const fetchAsset = vi.fn(async () => new Response('unexpected'));

    const response = await handleStaticAssetRequest(
      new Request(`https://preview.wamp.land${pathname}`),
      createEnv(fetchAsset),
    );

    expect(response).toBeNull();
    expect(fetchAsset).not.toHaveBeenCalled();
  });
});
