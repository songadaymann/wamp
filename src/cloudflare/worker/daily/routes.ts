import { loadOptionalRequestAuth, requireAdminRequest, requireOptionalScope, requireTrustedOriginForMutation } from '../auth/request';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import type { Env } from '../core/types';
import { loadDailyResponse, overrideDailyPick } from './store';

export async function handleDaily(request: Request, env: Env): Promise<Response> {
  const scoped = { ...env, DB: env.DB.withSession?.('first-primary') ?? env.DB };
  const auth = await loadOptionalRequestAuth(scoped,request);
  requireOptionalScope(auth,'leaderboards:read','view the daily challenge');
  return jsonResponse(request,await loadDailyResponse(scoped,auth?.user.id ?? null),{ headers: {'Cache-Control':'private, no-store'} });
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
