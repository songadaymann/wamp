import { describe, expect, it, vi } from 'vitest';
import worker, { type PagesWorkerEnv } from './worker';

describe('Pages standalone renderer routes', () => {
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
});
