import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PagesWorkerEnv, PagesWorkerExecutionContext } from './model';
import { createPagesWorker } from './routes';

function createEnv(fetchAsset: (request: Request) => Promise<Response>): PagesWorkerEnv {
  return {
    ASSETS: { fetch: fetchAsset },
    ROOM_SHARE_API_BASE_URL: 'https://api.example.test',
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('typed Pages route composition', () => {
  it.each([
    '/jam',
    '/school-admin',
    '/school-login',
    '/world-tile-render',
    '/assets/main-abcd1234.js',
  ])('handles static route %s before dynamic share routing', async (pathname) => {
    const fetchMetadata = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchMetadata);
    const calls: string[] = [];
    const fetchAsset = vi.fn(async (request: Request) => {
      calls.push(new URL(request.url).pathname);
      return new Response('typed response', {
        headers: { 'Content-Type': 'application/javascript' },
      });
    });

    const response = await createPagesWorker().fetch(
      new Request(`https://preview.wamp.land${pathname}`),
      createEnv(fetchAsset),
    );

    expect(await response.text()).toBe('typed response');
    expect(calls).toHaveLength(1);
    expect(fetchMetadata).not.toHaveBeenCalled();
  });

  it('handles room images before share pages and generic assets', async () => {
    const fetchMetadata = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchMetadata);
    const fetchAsset = vi.fn(async () => new Response('unexpected'));

    const response = await createPagesWorker().fetch(
      new Request('https://preview.wamp.land/r/11/-12/image.png', { method: 'HEAD' }),
      createEnv(fetchAsset),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(await response.text()).toBe('');
    expect(fetchMetadata).not.toHaveBeenCalled();
    expect(fetchAsset).not.toHaveBeenCalled();
  });

  it('handles share pages before the generic asset fallback', async () => {
    const fetchMetadata = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
      expect(`${url.pathname}${url.search}`).toBe('/api/profiles/by-username/fixture_user');
      return Response.json({ displayName: 'Fixture User', username: 'fixture_user' });
    });
    vi.stubGlobal('fetch', fetchMetadata);
    const fetchAsset = vi.fn(async (request: Request) => {
      expect(new URL(request.url).pathname).toBe('/index.html');
      return new Response('<html><head><title>WAMP</title></head><body>app</body></html>', {
        headers: { 'Content-Type': 'text/html' },
      });
    });

    const response = await createPagesWorker().fetch(
      new Request('https://preview.wamp.land/fixture_user'),
      createEnv(fetchAsset),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Fixture User (@fixture_user) on WAMP');
    expect(fetchMetadata).toHaveBeenCalledOnce();
    expect(fetchAsset).toHaveBeenCalledOnce();
  });

  it('falls back to ASSETS with the original request and response unchanged', async () => {
    const fetchMetadata = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchMetadata);
    const request = new Request('https://preview.wamp.land/api/health?fixture=safety', {
      headers: { 'X-Contract-Test': 'assets' },
    });
    const upstream = new Response('asset fallback', {
      status: 202,
      headers: { 'X-Asset-Fallback': 'yes' },
    });
    const fetchAsset = vi.fn(async (receivedRequest: Request) => {
      expect(receivedRequest).toBe(request);
      return upstream;
    });

    const response = await createPagesWorker().fetch(request, createEnv(fetchAsset));

    expect(response).toBe(upstream);
    expect(response.status).toBe(202);
    expect(response.headers.get('X-Asset-Fallback')).toBe('yes');
    expect(fetchMetadata).not.toHaveBeenCalled();
    expect(fetchAsset).toHaveBeenCalledOnce();
  });

  it('accepts the Cloudflare execution context without changing route behavior', async () => {
    const fetchMetadata = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchMetadata);
    const request = new Request('https://preview.wamp.land/api/health');
    const fetchAsset = vi.fn(async () => new Response('asset fallback'));
    const context: PagesWorkerExecutionContext = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    };

    const response = await createPagesWorker().fetch(request, createEnv(fetchAsset), context);

    expect(await response.text()).toBe('asset fallback');
    expect(fetchAsset).toHaveBeenCalledWith(request);
    expect(context.waitUntil).not.toHaveBeenCalled();
  });

  it('does not fall through when a static route returns an error response', async () => {
    const fetchMetadata = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchMetadata);
    const fetchAsset = vi.fn(async () => new Response('<title>SPA fallback</title>', {
      headers: { 'Content-Type': 'text/html' },
    }));

    const response = await createPagesWorker().fetch(
      new Request('https://preview.wamp.land/assets/main-missing.js'),
      createEnv(fetchAsset),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Asset Not Found');
    expect(fetchAsset).toHaveBeenCalledOnce();
    expect(fetchMetadata).not.toHaveBeenCalled();
  });
});
