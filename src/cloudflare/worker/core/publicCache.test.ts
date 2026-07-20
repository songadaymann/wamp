import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse } from './http';
import { loadAnonymousPublicCache } from './publicCache';
import type { WorkerExecutionContextLike } from './types';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('anonymous public cache CORS', () => {
  it('reapplies CORS for the current origin on cache hits', async () => {
    const stored = new Map<string, Response>();
    vi.stubGlobal('caches', {
      default: {
        async match(request: Request) {
          return stored.get(request.url)?.clone();
        },
        async put(request: Request, response: Response) {
          stored.set(request.url, response.clone());
        },
      },
    });
    const waits: Promise<unknown>[] = [];
    const context: WorkerExecutionContextLike = {
      waitUntil(promise) {
        waits.push(promise);
      },
    };
    const url = 'https://everybodys-platformer-safety.novox-robot.workers.dev/api/world/tiles/config';
    const localRequest = new Request(url, {
      headers: { Origin: 'http://127.0.0.1:4518' },
    });

    const first = await loadAnonymousPublicCache(localRequest, context, async () => (
      jsonResponse(localRequest, { ok: true }, {
        headers: { 'Cache-Control': 'public, max-age=20' },
      })
    ));
    await Promise.all(waits);

    expect(first.headers.get('X-WAMP-Cache')).toBe('miss');
    expect(first.headers.get('Access-Control-Allow-Origin')).toBe('http://127.0.0.1:4518');
    expect(stored.get(url)?.headers.get('Access-Control-Allow-Origin')).toBeNull();

    const safetyRequest = new Request(url, {
      headers: { Origin: 'https://safety-preview.wampland.pages.dev' },
    });
    const loader = vi.fn(async () => jsonResponse(safetyRequest, { ok: false }));
    const second = await loadAnonymousPublicCache(safetyRequest, context, loader);

    expect(loader).not.toHaveBeenCalled();
    expect(second.headers.get('X-WAMP-Cache')).toBe('hit');
    expect(second.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://safety-preview.wampland.pages.dev',
    );
    expect(second.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(second.headers.get('Vary')).toContain('Origin');
  });
});
