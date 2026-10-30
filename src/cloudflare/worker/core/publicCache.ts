import type { WorkerExecutionContextLike } from './types';
import { corsHeaders } from './http';

interface WorkerCacheStorage extends CacheStorage {
  default?: Cache;
}

/**
 * The zone's browser-cache TTL rewrites Cache-Control on stored entries (hits came
 * back as max-age=14400 for responses stored with max-age=20), which let browsers
 * keep leaderboards and world summaries for hours. The intended value travels in this
 * private header and is restored on a hit.
 */
const STORED_CACHE_CONTROL_HEADER = 'X-WAMP-Stored-Cache-Control';

export function hasPublicCache(context: WorkerExecutionContextLike | undefined): boolean {
  return Boolean(context && (globalThis.caches as WorkerCacheStorage | undefined)?.default);
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
  if (cached) return withCacheDiagnostic(applyRequestCors(cached, request), 'hit');

  const response = withCacheDiagnostic(await loader(), 'miss');
  if (response.ok && !response.headers.has('Set-Cookie')) {
    context.waitUntil(cache.put(cacheKey, stripRequestCors(response.clone())));
  }
  return response;
}

/** The stored copy of a GET for this URL, as a hit returns it, or null; never loads anything. */
export async function matchAnonymousPublicCache(
  request: Request,
  context: WorkerExecutionContextLike | undefined,
): Promise<Response | null> {
  const cache = (globalThis.caches as WorkerCacheStorage | undefined)?.default;
  if (!cache || !context) return null;
  const cached = await cache.match(new Request(request.url, { method: 'GET' }));
  return cached ? withCacheDiagnostic(applyRequestCors(cached, request), 'hit') : null;
}

function stripRequestCors(response: Response): Response {
  const headers = new Headers(response.headers);
  const cacheControl = headers.get('Cache-Control');
  if (cacheControl) headers.set(STORED_CACHE_CONTROL_HEADER, cacheControl);
  headers.delete('Access-Control-Allow-Origin');
  headers.delete('Access-Control-Allow-Credentials');
  removeVaryHeaderValue(headers, 'Origin');
  return cloneResponse(response, headers);
}

function applyRequestCors(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  const storedCacheControl = headers.get(STORED_CACHE_CONTROL_HEADER);
  if (storedCacheControl) headers.set('Cache-Control', storedCacheControl);
  headers.delete(STORED_CACHE_CONTROL_HEADER);
  headers.delete('Access-Control-Allow-Origin');
  headers.delete('Access-Control-Allow-Credentials');
  removeVaryHeaderValue(headers, 'Origin');
  const cors = new Headers(corsHeaders(request));
  for (const [key, value] of cors.entries()) {
    if (key.toLowerCase() === 'vary') {
      appendVaryHeaderValue(headers, value);
    } else {
      headers.set(key, value);
    }
  }
  return cloneResponse(response, headers);
}

function removeVaryHeaderValue(headers: Headers, value: string): void {
  const remaining = (headers.get('Vary') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry && entry.toLowerCase() !== value.toLowerCase());
  if (remaining.length > 0) headers.set('Vary', remaining.join(', '));
  else headers.delete('Vary');
}

function appendVaryHeaderValue(headers: Headers, value: string): void {
  const values = new Set((headers.get('Vary') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean));
  values.add(value);
  headers.set('Vary', Array.from(values).join(', '));
}

function cloneResponse(response: Response, headers: Headers): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withCacheDiagnostic(response: Response, status: 'hit' | 'miss' | 'bypass'): Response {
  const headers = new Headers(response.headers);
  headers.set('X-WAMP-Cache', status);
  if (status === 'hit') headers.set('Server-Timing', 'cache;dur=0;desc="hit"');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
