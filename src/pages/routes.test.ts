import { describe, expect, it, vi } from 'vitest';
import type {
  PagesWorkerEnv,
  PagesWorkerExecutionContext,
  PagesWorkerHandler,
} from './model';
import { createPagesWorker } from './routes';

function createEnv(fetchAsset: (request: Request) => Promise<Response>): PagesWorkerEnv {
  return { ASSETS: { fetch: fetchAsset } };
}

describe('typed Pages route composition', () => {
  it.each([
    '/jam',
    '/school-admin',
    '/school-login',
    '/world-tile-render',
    '/assets/main-abcd1234.js',
  ])('handles typed route %s before the legacy worker', async (pathname) => {
    const calls: string[] = [];
    const fetchAsset = vi.fn(async (request: Request) => {
      calls.push(`asset:${new URL(request.url).pathname}`);
      return new Response('typed response', {
        headers: { 'Content-Type': 'application/javascript' },
      });
    });
    const legacyWorker: PagesWorkerHandler = {
      fetch: vi.fn(async () => {
        calls.push('legacy');
        return new Response('legacy response');
      }),
    };
    const worker = createPagesWorker(legacyWorker);

    const response = await worker.fetch(
      new Request(`https://preview.wamp.land${pathname}`),
      createEnv(fetchAsset),
    );

    expect(await response.text()).toBe('typed response');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^asset:/);
    expect(legacyWorker.fetch).not.toHaveBeenCalled();
  });

  it.each([
    '/',
    '/index.html',
    '/r/11/-12',
    '/r/11/-12/image.png',
    '/playlist/safety-fixture',
    '/wamp-o-gram/safety-fixture',
    '/fixture_user',
    '/api/health',
    '/assets',
  ])('delegates non-static route %s to the legacy worker unchanged', async (pathname) => {
    const request = new Request(`https://preview.wamp.land${pathname}?fixture=safety`, {
      headers: { 'X-Contract-Test': 'legacy' },
    });
    const fetchAsset = vi.fn(async () => new Response('asset fallback'));
    const env = createEnv(fetchAsset);
    const legacyFetch = vi.fn(async (receivedRequest: Request, receivedEnv: PagesWorkerEnv) => {
      expect(receivedRequest).toBe(request);
      expect(receivedEnv).toBe(env);
      return new Response('legacy response', {
        status: 202,
        headers: { 'X-Legacy': 'yes' },
      });
    });
    const worker = createPagesWorker({ fetch: legacyFetch });

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(202);
    expect(response.headers.get('X-Legacy')).toBe('yes');
    expect(await response.text()).toBe('legacy response');
    expect(legacyFetch).toHaveBeenCalledOnce();
    expect(fetchAsset).not.toHaveBeenCalled();
  });

  it('delegates POST /jam/ because the legacy contract only redirects GET and HEAD', async () => {
    const request = new Request('https://preview.wamp.land/jam/?fixture=safety', {
      method: 'POST',
    });
    const env = createEnv(vi.fn(async () => new Response('asset fallback')));
    const legacyFetch = vi.fn(async () => new Response('legacy mutation response', { status: 207 }));
    const worker = createPagesWorker({ fetch: legacyFetch });

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(207);
    expect(await response.text()).toBe('legacy mutation response');
    expect(legacyFetch).toHaveBeenCalledWith(request, env, undefined);
  });

  it('forwards the Cloudflare execution context to the legacy handler unchanged', async () => {
    const request = new Request('https://preview.wamp.land/r/11/-12');
    const env = createEnv(vi.fn(async () => new Response('asset fallback')));
    const context: PagesWorkerExecutionContext = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    };
    const legacyFetch = vi.fn(async () => new Response('legacy response'));
    const worker = createPagesWorker({ fetch: legacyFetch });

    await worker.fetch(request, env, context);

    expect(legacyFetch).toHaveBeenCalledWith(request, env, context);
  });

  it('does not fall through when a typed route returns an error response', async () => {
    const fetchAsset = vi.fn(async () => new Response('<title>SPA fallback</title>', {
      headers: { 'Content-Type': 'text/html' },
    }));
    const legacyFetch = vi.fn(async () => new Response('legacy response'));
    const worker = createPagesWorker({ fetch: legacyFetch });

    const response = await worker.fetch(
      new Request('https://preview.wamp.land/assets/main-missing.js'),
      createEnv(fetchAsset),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Asset Not Found');
    expect(fetchAsset).toHaveBeenCalledOnce();
    expect(legacyFetch).not.toHaveBeenCalled();
  });
});
