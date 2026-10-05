import { requireAuthenticatedRequestAuth } from '../auth/request';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import type { Env } from '../core/types';
import { loadActivity, loadActivityPreferences, markActivitySeen, publicPreferences, saveActivityPreferences } from './store';

export async function handleMyActivity(request: Request, url: URL, env: Env): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(env, request, 'view your activity');
  if (auth.source !== 'session') throw new HttpError(403, 'Sign in to manage your private activity.');
  const db = env.DB.withSession?.('first-primary') ?? env.DB;
  const emailAvailable = Boolean(auth.user.email?.trim()) && !auth.school;
  if (request.method === 'GET' && url.pathname === '/api/me/activity') {
    const raw = url.searchParams.get('before');
    const before = raw === null ? undefined : Number(raw);
    if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) throw new HttpError(400, 'Invalid activity page.');
    return jsonResponse(request, await loadActivity(db, auth.user.id, emailAvailable, before), { headers: { 'Cache-Control': 'no-store' } });
  }
  if (url.pathname === '/api/me/activity/seen' && request.method === 'POST') {
    const body = await parseJsonBody<{ latestId?: unknown }>(request, { maxBytes: 1024 });
    if (!body || !Number.isSafeInteger(body.latestId) || Number(body.latestId) < 0) throw new HttpError(400, 'A valid activity watermark is required.');
    await markActivitySeen(db, auth.user.id, Number(body.latestId));
    return jsonResponse(request, { ok: true });
  }
  if (url.pathname === '/api/me/activity/preferences' && request.method === 'PUT') {
    const body = await parseJsonBody<{ weeklyDigest?: unknown; dethroneAlerts?: unknown; dailyFeatures?: unknown }>(request, { maxBytes: 1024 });
    if (!body || typeof body.weeklyDigest !== 'boolean' || typeof body.dethroneAlerts !== 'boolean') throw new HttpError(400, 'Choose both email preferences.');
    if (body.dailyFeatures !== undefined && typeof body.dailyFeatures !== 'boolean') throw new HttpError(400,'Choose whether to receive Room of the Day emails.');
    if (!emailAvailable && (body.weeklyDigest || body.dethroneAlerts || body.dailyFeatures)) throw new HttpError(409, 'An email account is needed for activity emails.');
    await saveActivityPreferences(db, auth.user.id, {weeklyDigest:body.weeklyDigest,dethroneAlerts:body.dethroneAlerts,
      dailyFeatures: typeof body.dailyFeatures === 'boolean' ? body.dailyFeatures : undefined}, new Date().toISOString());
    return jsonResponse(request, publicPreferences(await loadActivityPreferences(db, auth.user.id), emailAvailable));
  }
  throw new HttpError(404, 'Activity route not found.');
}
