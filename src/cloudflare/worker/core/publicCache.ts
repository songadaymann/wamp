import type { WorkerExecutionContextLike } from './types';
import { corsHeaders } from './http';

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
  if (cached) return withCacheDiagnostic(applyRequestCors(cached, request), 'hit');

  const response = withCacheDiagnostic(await loader(), 'miss');
  if (response.ok && !response.headers.has('Set-Cookie')) {
    context.waitUntil(cache.put(cacheKey, stripRequestCors(response.clone())));
  }
  return response;
}

function stripRequestCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.delete('Access-Control-Allow-Origin');
  headers.delete('Access-Control-Allow-Credentials');
  removeVaryHeaderValue(headers, 'Origin');
  return cloneResponse(response, headers);
}

function applyRequestCors(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
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
