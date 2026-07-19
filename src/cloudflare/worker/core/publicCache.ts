import type { WorkerExecutionContextLike } from './types';

interface WorkerCacheStorage extends CacheStorage {
  default?: Cache;
}

export async function loadAnonymousPublicCache(
  request: Request,
  context: WorkerExecutionContextLike | undefined,
  loader: () => Promise<Response>,
): Promise<Response> {
  const cache = (globalThis.caches as WorkerCacheStorage | undefined)?.default;
  if (!cache || !context || request.method !== 'GET') {
    return withCacheDiagnostic(await loader(), 'bypass');
  }

  const cacheKey = new Request(request.url, { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return withCacheDiagnostic(cached, 'hit');

  const response = withCacheDiagnostic(await loader(), 'miss');
  if (response.ok && !response.headers.has('Set-Cookie')) {
    context.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return response;
}

function withCacheDiagnostic(response: Response, status: 'hit' | 'miss' | 'bypass'): Response {
  const headers = new Headers(response.headers);
  headers.set('X-WAMP-Cache', status);
  const serverTiming = headers.get('Server-Timing');
  if (status === 'hit') headers.set('Server-Timing', `cache;dur=0;desc="hit"${serverTiming ? `, ${serverTiming}` : ''}`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
