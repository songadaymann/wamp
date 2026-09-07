import { requireAdminRequest, requireTrustedOriginForMutation } from '../auth/request';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import type { Env } from '../core/types';
import { sendWorldGrantEmail } from './notifications';
import { D1WorldEntitlementProvider } from './entitlements';
import {
  createComplimentaryWorldGrant,
  listAdminWorldState,
  loadWorldEntitlementById,
  worldsEnabled,
} from './store';
import { resolveWorldNameRequest } from './names';

export async function handleAdminWorldsRequest(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  requireAdminRequest(env, request, 'manage Worlds');
  requireTrustedOriginForMutation(request);
  if (!worldsEnabled(env)) throw new HttpError(404, 'Worlds are not enabled.');
  const segments = url.pathname.split('/').filter(Boolean);

  if (url.pathname === '/api/admin/worlds' && request.method === 'GET') {
    return jsonResponse(request, await listAdminWorldState(env));
  }

  if (segments.length === 4 && segments[3] === 'grants' && request.method === 'POST') {
    const body = await parseJsonBody<{ email?: unknown; idempotencyKey?: unknown }>(request);
    if (typeof body.email !== 'string') throw new HttpError(400, 'Owner email is required.');
    const entitlement = await createComplimentaryWorldGrant(
      env,
      body.email,
      typeof body.idempotencyKey === 'string' ? body.idempotencyKey : null,
    );
    const email = await sendWorldGrantEmail(request, env, entitlement.ownerEmail);
    return jsonResponse(request, { entitlement, email }, { status: 201 });
  }

  if (
    segments.length === 6 &&
    segments[3] === 'entitlements' &&
    segments[5] === 'resend' &&
    request.method === 'POST'
  ) {
    const entitlement = await loadWorldEntitlementById(env, decodeURIComponent(segments[4]));
    if (!entitlement) throw new HttpError(404, 'World entitlement was not found.');
    const email = await sendWorldGrantEmail(request, env, entitlement.ownerEmail);
    return jsonResponse(request, { entitlement, email });
  }

  if (
    segments.length === 6 &&
    segments[3] === 'entitlements' &&
    segments[5] === 'status' &&
    request.method === 'PATCH'
  ) {
    const body = await parseJsonBody<{ status?: unknown; idempotencyKey?: unknown }>(request);
    if (body.status !== 'active' && body.status !== 'frozen') {
      throw new HttpError(400, 'status must be active or frozen.');
    }
    const entitlementId = decodeURIComponent(segments[4]);
    const idempotencyKey = typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim()
      : `admin:${entitlementId}:${body.status}:${crypto.randomUUID()}`;
    const provider = new D1WorldEntitlementProvider(env);
    const change = { entitlementId, idempotencyKey, occurredAt: new Date().toISOString() };
    if (body.status === 'active') await provider.reactivate(change);
    else await provider.freeze(change);
    return jsonResponse(request, { ok: true });
  }

  if (segments.length === 5 && segments[3] === 'name-requests' && request.method === 'PATCH') {
    const body = await parseJsonBody<{ decision?: unknown }>(request);
    if (body.decision !== 'approve' && body.decision !== 'reject') {
      throw new HttpError(400, 'decision must be approve or reject.');
    }
    await resolveWorldNameRequest(env, decodeURIComponent(segments[4]), body.decision);
    return jsonResponse(request, { ok: true });
  }

  throw new HttpError(404, 'Admin World route not found.');
}
