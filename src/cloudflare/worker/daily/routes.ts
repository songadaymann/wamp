import { loadOptionalRequestAuth, requireAdminRequest, requireOptionalScope, requireTrustedOriginForMutation } from '../auth/request';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import type { Env, WorkerExecutionContextLike } from '../core/types';
import { loadDailyResponse, overrideDailyPick, type DailyShared, type DailySharedCache } from './store';

const DAILY_SHARED_CACHE_SECONDS = 30;

/**
 * Keeps the pick, recent picks and top ten for 30 seconds per date in the edge cache, so
 * panel reloads stop re-running the daily queries. Viewer completions and rank stay fresh.
 */
function dailySharedCache(request: Request, context?: WorkerExecutionContextLike): { load: DailySharedCache; status: () => string } | null {
  const cache = (globalThis.caches as (CacheStorage & { default?: Cache }) | undefined)?.default;
  if (!cache || !context) return null;
  let status = 'bypass';
  return { status: () => status, load: async (date, load) => {
    const key = new Request(new URL(`/__wamp-cache/daily-shared-v1/${date}`, request.url));
    const cached = await cache.match(key);
    if (cached) { status = 'hit'; return await cached.json() as DailyShared; }
    const value = await load(); status = 'miss';
    context.waitUntil(cache.put(key, new Response(JSON.stringify(value), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${DAILY_SHARED_CACHE_SECONDS}` },
    })));
    return value;
  } };
}
export async function handleDaily(request: Request, env: Env, context?: WorkerExecutionContextLike): Promise<Response> {
  const scoped = { ...env, DB: env.DB.withSession?.('first-primary') ?? env.DB };
  const auth = await loadOptionalRequestAuth(scoped,request);
  requireOptionalScope(auth,'leaderboards:read','view the daily challenge');
  const cache = dailySharedCache(request,context);
  const response = await loadDailyResponse(scoped,auth?.user.id ?? null,undefined,cache?.load);
  return jsonResponse(request,response,{ headers: {'Cache-Control':'private, no-store','X-WAMP-Cache':cache?.status() ?? 'bypass'} });
}
export async function handleAdminDaily(request: Request, env: Env): Promise<Response> {
  requireAdminRequest(env,request,'choose Room of the Day');
  const scoped = { ...env, DB: env.DB.withSession?.('first-primary') ?? env.DB };
  if (request.method === 'PUT') {
    requireTrustedOriginForMutation(request);
    const body = await parseJsonBody<{ roomId?: unknown }>(request,{maxBytes:1024});
    if (!body || typeof body.roomId !== 'string' || !/^-?\d+,-?\d+$/.test(body.roomId)
      || body.roomId.length > 40) throw new HttpError(400,'Enter the room coordinates as x,y.');
    await overrideDailyPick(scoped,body.roomId);
  }
  return jsonResponse(request,await loadDailyResponse(scoped,null),{headers:{'Cache-Control':'no-store'}});
}
