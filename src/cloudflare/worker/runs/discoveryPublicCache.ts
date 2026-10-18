import type { Env, WorkerExecutionContextLike } from '../core/types';

export type DiscoveryPublicRead = 'index' | 'legacy' | 'indexed-details';
const MAX_CACHE_BYTES = 4 * 1024 * 1024;

/** Request-local cache for explicitly public discovery inputs. Never pass viewer history here. */
export class DiscoveryPublicCache {
  private readonly statuses: Array<'hit' | 'miss' | 'bypass'> = [];
  constructor(
    private readonly request: Request,
    private readonly env: Env,
    private readonly context?: WorkerExecutionContextLike,
    private readonly fresh = false,
  ) {}

  get status(): 'hit' | 'miss' | 'bypass' {
    if (this.statuses.includes('bypass')) return 'bypass';
    if (this.statuses.includes('miss')) return 'miss';
    return this.statuses.length ? 'hit' : 'bypass';
  }

  async load<T>(kind: DiscoveryPublicRead, inputs: unknown[], loader: () => Promise<T>): Promise<T> {
    const cache = (globalThis.caches as (CacheStorage & { default?: Cache }) | undefined)?.default;
    if (!cache || !this.context || this.fresh || this.request.method !== 'GET') return loader();
    const signature = JSON.stringify([kind, inputs,
      this.env.PLAYABLE_CONTENT_INDEX_READS ?? '', this.env.EXPANDED_ROOMS_ENABLED ?? '', this.env.WORLDS_ENABLED ?? '']);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature)));
    const key = new Request(new URL(`/__wamp-cache/discovery-public-v1/${Array.from(digest,
      byte => byte.toString(16).padStart(2, '0')).join('')}`, this.request.url));
    const cached = await cache.match(key);
    if (cached) {
      this.statuses.push('hit');
      return await cached.json() as T;
    }
    const value = await loader();
    // Missing/disabled index results must keep checking the existing legacy fallback path.
    if (value === null) return value;
    const body = JSON.stringify(value);
    if (body.length > MAX_CACHE_BYTES || new TextEncoder().encode(body).byteLength > MAX_CACHE_BYTES) {
      this.statuses.push('bypass');
      return value;
    }
    this.statuses.push('miss');
    this.context.waitUntil(cache.put(key, new Response(body, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=20' },
    })));
    return value;
  }
}
