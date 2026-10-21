import { loadOptionalRequestAuth } from '../auth/request';
import { HttpError, jsonResponse } from '../core/http';
import { loadAnonymousPublicCache } from '../core/publicCache';
import type { Env, WorkerExecutionContextLike } from '../core/types';
import { loadCollectionAttribution, loadCollectionShelf } from './store';

export async function handleCollectionRead(request: Request, env: Env, context?: WorkerExecutionContextLike, userId?: string): Promise<Response> {
  // Validate credentials before using a shared response, as on other public lists.
  await loadOptionalRequestAuth(env, request);
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit') ?? 24);
  if (!Number.isInteger(limit) || limit < 1 || limit > 48) throw new HttpError(400, 'limit must be between 1 and 48.');
  const targets = [...new Set(url.searchParams.getAll('target'))];
  if (!userId && (!targets.length || targets.length > 16 || targets.some(id => !id || id.length > 160))) {
    throw new HttpError(400, 'Choose between 1 and 16 room targets.');
  }
  return loadAnonymousPublicCache(request, context, async () => {
    const body = userId
      ? await loadCollectionShelf(env, userId, limit, url.searchParams.get('cursor'))
      : { results: await Promise.all(targets.map(id => loadCollectionAttribution(env, id))) };
    return jsonResponse(request, body, { headers: { 'Cache-Control': 'public, max-age=20' } });
  });
}
