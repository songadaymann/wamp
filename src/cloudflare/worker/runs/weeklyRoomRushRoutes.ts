import { loadOptionalRequestAuth, requireOptionalScope, requireAdminRequest, requireTrustedOriginForMutation } from '../auth/request';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import type { Env } from '../core/types';
import { loadWeeklyRoomRushResponse } from './roomRushLeaderboards';
import { deleteWeeklyRoomRushPick, loadWeeklyRoomRushAdmin, saveWeeklyRoomRushPick } from './weeklyRoomRushStore';

export async function handleWeeklyRoomRush(request: Request, env: Env): Promise<Response> {
  env = { ...env, DB: env.DB.withSession?.('first-primary') ?? env.DB };
  const auth = await loadOptionalRequestAuth(env, request);
  requireOptionalScope(auth, 'leaderboards:read', 'view weekly Room Rush');
  return jsonResponse(request, await loadWeeklyRoomRushResponse(env), { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function handleAdminWeeklyRoomRush(request: Request, url: URL, env: Env): Promise<Response> {
  requireAdminRequest(env, request, 'choose weekly Room Rush');
  requireTrustedOriginForMutation(request);
  env = { ...env, DB: env.DB.withSession?.('first-primary') ?? env.DB };
  if (request.method === 'PUT') {
    const body = await parseJsonBody<{ openingMonday?: unknown; roomId?: unknown }>(request, { maxBytes: 1024 });
    if (!body || typeof body !== 'object') throw new HttpError(400, 'Choose an opening Monday and room.');
    await saveWeeklyRoomRushPick(env, body);
  } else if (request.method === 'DELETE') {
    await deleteWeeklyRoomRushPick(env, url.searchParams.get('openingMonday'));
  } else if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
  return jsonResponse(request, await loadWeeklyRoomRushAdmin(env), { headers: { 'Cache-Control': 'no-store' } });
}
