import { requireAuthenticatedRequestAuth, requireTrustedOriginForMutation } from '../auth/request';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import type { Env } from '../core/types';
import { assertWampLeaderboardWriteAllowed } from '../generatedUsers/leaderboardIsolation';
import { findGuestRunStart, finishGuestRun, parseGuestRunStart, startGuestRun, validGuestRequestId } from './attempts';
import { claimGuestRuns } from './claims';
import { guestRunIdentity, limitGuestRunRequest } from './identity';
import { listClaimedGuestClears, listPendingGuestClears } from './history';

export async function handleGuestRunRequest(request: Request, url: URL, originalEnv: Env): Promise<Response> {
  requireTrustedOriginForMutation(request);
  const env = { ...originalEnv, DB: originalEnv.DB.withSession?.('first-primary') ?? originalEnv.DB };
  const identity = await guestRunIdentity(request);
  if (url.pathname === '/api/guest-runs/mine' && request.method === 'GET') {
    return jsonResponse(request, await listPendingGuestClears(env, identity));
  }
  const lookup = /^\/api\/guest-runs\/by-client\/([a-f0-9-]{36})$/i.exec(url.pathname);
  if (lookup && validGuestRequestId(lookup[1]) && request.method === 'GET') {
    await limitGuestRunRequest(env, request, identity, 'start');
    return jsonResponse(request, await findGuestRunStart(env, identity, lookup[1]));
  }
  if (url.pathname === '/api/guest-runs/start' && request.method === 'POST') {
    await limitGuestRunRequest(env, request, identity, 'start');
    return jsonResponse(request, await startGuestRun(env, identity, await parseGuestRunStart(request)));
  }
  const finish = /^\/api\/guest-runs\/([a-f0-9-]{36})\/finish$/i.exec(url.pathname);
  if (finish && validGuestRequestId(finish[1]) && request.method === 'POST') {
    await limitGuestRunRequest(env, request, identity, 'finish');
    return jsonResponse(request, await finishGuestRun(env, identity, finish[1], request));
  }
  throw new HttpError(404, 'Guest run route not found.');
}
export async function handleGuestProgressHistoryRequest(request: Request, originalEnv: Env): Promise<Response> {
  const env = { ...originalEnv, DB: originalEnv.DB.withSession?.('first-primary') ?? originalEnv.DB };
  const auth = await requireAuthenticatedRequestAuth(env, request, 'view saved guest clears');
  return jsonResponse(request, { ...await listClaimedGuestClears(env, auth.user.id), userId: auth.user.id });
}
export async function handleClaimGuestRequest(request: Request, originalEnv: Env): Promise<Response> {
  const env = { ...originalEnv, DB: originalEnv.DB.withSession?.('first-primary') ?? originalEnv.DB };
  const auth = await requireAuthenticatedRequestAuth(env, request, 'save guest progress', 'runs:write');
  await assertWampLeaderboardWriteAllowed(env, auth, 'save guest progress');
  const identity = await guestRunIdentity(request);
  await limitGuestRunRequest(env, request, identity, 'claim');
  const body = await parseJsonBody<{ claimId?: unknown; expectedUserId?: unknown }>(request, { maxBytes: 8192 });
  if (!body || typeof body.claimId !== 'string' || !validGuestRequestId(body.claimId)) {
    throw new HttpError(400, 'A stable claim id is required.');
  }
  if (typeof body.expectedUserId !== 'string' || body.expectedUserId !== auth.user.id) {
    throw new HttpError(409, 'Your account changed. Refresh sign-in before saving guest progress.');
  }
  return jsonResponse(request, await claimGuestRuns(env, identity, auth.user.id, body.claimId));
}
