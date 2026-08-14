import { describe, expect, it, vi } from 'vitest';
import worker, { type PagesWorkerEnv } from './worker';

describe('Pages standalone renderer routes', () => {
  it('does not cache an HTML SPA fallback under a hashed asset URL', async () => {
    const fetchAsset = vi.fn(async () => new Response('<title>WAMP</title>', {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    }));
    const env = {
      ASSETS: { fetch: fetchAsset },
    } satisfies PagesWorkerEnv;

    const response = await worker.fetch(
      new Request('https://wamp.land/assets/main-newhash.js'),
      env,
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(await response.text()).toBe('Asset Not Found');
    expect(fetchAsset).toHaveBeenCalledOnce();
  });

  it('passes through a valid hashed asset response', async () => {
    const fetchAsset = vi.fn(async () => new Response('export default true;', {
      headers: { 'Content-Type': 'application/javascript' },
    }));
    const env = {
      ASSETS: { fetch: fetchAsset },
    } satisfies PagesWorkerEnv;

    const response = await worker.fetch(
      new Request('https://wamp.land/assets/main-goodhash.js'),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/javascript');
    expect(await response.text()).toBe('export default true;');
  });

  it.each([
    '/world-tile-render',
    '/world-tile-render/',
    '/world-tile-render.html',
  ])('serves the inert world tile renderer asset for %s', async (pathname) => {
    const fetchAsset = vi.fn(async (request: Request) => {
      expect(new URL(request.url).pathname).toBe('/__standalone/world-tile-render.asset');
      return new Response('<title>WAMP World Tile Renderer</title>', {
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    });
    const env = {
      ASSETS: { fetch: fetchAsset },
    } satisfies PagesWorkerEnv;

    const response = await worker.fetch(
      new Request(`https://0123abcd.wampland.pages.dev${pathname}`),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toContain('WAMP World Tile Renderer');
    expect(fetchAsset).toHaveBeenCalledOnce();
  });

  it('rejects mutations to the renderer route', async () => {
    const fetchAsset = vi.fn();
    const response = await worker.fetch(
      new Request('https://0123abcd.wampland.pages.dev/world-tile-render.html', {
        method: 'POST',
      }),
      { ASSETS: { fetch: fetchAsset } } satisfies PagesWorkerEnv,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET, HEAD');
    expect(fetchAsset).not.toHaveBeenCalled();
  });

  it('proxies /capture to the map-screenshot Worker with a public base path', async () => {
    const upstreamFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.url).toBe(
        'https://everybodys-platformer-map-screenshots.novox-robot.workers.dev/api/health',
      );
      expect(request.headers.get('X-WAMP-Public-Base-Path')).toBe('/capture');
      expect(request.headers.get('Cookie')).toBeNull();
      expect(request.headers.get('Authorization')).toBeNull();
      expect(request.headers.get('X-Unrelated-Header')).toBeNull();
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', upstreamFetch);

    try {
      const response = await worker.fetch(
        new Request('https://wamp.land/capture/api/health', {
          headers: {
            Authorization: 'Bearer must-not-forward',
            Cookie: 'session=must-not-forward',
            'X-Unrelated-Header': 'must-not-forward',
          },
        }),
        { ASSETS: { fetch: vi.fn() } } satisfies PagesWorkerEnv,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(upstreamFetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects unsupported /capture proxy methods without an upstream request', async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal('fetch', upstreamFetch);

    try {
      const response = await worker.fetch(
        new Request('https://wamp.land/capture/api/health', { method: 'PUT' }),
        { ASSETS: { fetch: vi.fn() } } satisfies PagesWorkerEnv,
      );

      expect(response.status).toBe(405);
      expect(response.headers.get('Allow')).toBe('GET, HEAD, POST');
      expect(upstreamFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
