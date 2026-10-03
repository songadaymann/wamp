import { describe, expect, it, vi } from 'vitest';
import worker from './worker';
import { corsHeaders } from './worker/core/http';
import type { Env } from './worker/core/types';

const API_URL = 'https://api.wamp.land/api/guest-activity/heartbeat';

describe('API CORS preflight caching', () => {
  it.each(['https://wamp.land', 'https://evil.example', undefined])(
    'adds a two-hour lifetime and preserves CORS policy for origin %s',
    async (origin) => {
      const headers = new Headers({
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      });
      if (origin) headers.set('Origin', origin);
      const request = new Request(API_URL, { method: 'OPTIONS', headers });
      const response = await worker.fetch(request, {} as Env);
      const expectedHeaders = new Headers(corsHeaders(request));
      expectedHeaders.set('Access-Control-Max-Age', '7200');

      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
      expect(Object.fromEntries(response.headers)).toEqual(Object.fromEntries(expectedHeaders));
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin === 'https://wamp.land' ? origin : '*');
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBe(origin === 'https://wamp.land' ? 'true' : null);
      expect(response.headers.get('Vary')).toBe(origin === 'https://wamp.land' ? 'Origin' : null);
    },
  );

  it.each([
    ['/api/health', 200],
    ['/api/not-a-route', 404],
  ])('does not add the preflight lifetime to ordinary API responses at %s', async (path, status) => {
    const request = new Request(`https://api.wamp.land${path}`, {
      headers: { Origin: 'https://wamp.land' },
    });
    const response = await worker.fetch(request, {} as Env);

    expect(response.status).toBe(status);
    expect(response.headers.get('Access-Control-Max-Age')).toBeNull();
    for (const [key, value] of new Headers(corsHeaders(request))) {
      expect(response.headers.get(key)).toBe(value);
    }
  });

  it('keeps non-API OPTIONS requests on the asset path', async () => {
    const request = new Request('https://api.wamp.land/not-an-api', { method: 'OPTIONS' });
    const assetResponse = new Response(null, { status: 405 });
    const fetch = vi.fn().mockResolvedValue(assetResponse);
    const response = await worker.fetch(request, { ASSETS: { fetch } } as unknown as Env);

    expect(fetch).toHaveBeenCalledWith(request);
    expect(response).toBe(assetResponse);
    expect(response.headers.get('Access-Control-Max-Age')).toBeNull();
  });
});
