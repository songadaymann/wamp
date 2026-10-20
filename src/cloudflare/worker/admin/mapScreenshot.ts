import type { Env } from '../core/types';
import { requireAdminRequest, requireTrustedOriginForMutation } from '../auth/request';
import { HttpError, jsonResponse } from '../core/http';

export async function handleAdminMapCapture(request: Request, env: Env): Promise<Response> {
  requireAdminRequest(env, request, 'capture the world map');
  requireTrustedOriginForMutation(request);
  if (!env.MAP_SCREENSHOTS) throw new HttpError(503, 'Map capture is unavailable.');
  const result = await env.MAP_SCREENSHOTS.captureManual();
  return jsonResponse(request, { ...result, ...(!result.ok ? { error: result.reason || result.error || 'Capture failed.' } : {}) }, { status: result.ok ? 201 : result.busy || result.skipped ? 429 : 502, headers: { 'Cache-Control': 'private, no-store' } });
}
