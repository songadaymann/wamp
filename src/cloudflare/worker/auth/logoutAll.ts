import { HttpError, jsonResponse } from '../core/http';
import type { Env } from '../core/types';
import { clearSessionCookie, requireCurrentSession } from './request';

/** Revoke browser sessions only for the identity authenticated by this cookie. */
export async function handleLogoutAll(request: Request, env: Env): Promise<Response> {
  const session = await requireCurrentSession(env, request, 'log out on all devices');
  if (!request.headers.get('Origin')) {
    throw new HttpError(403, 'A trusted browser origin is required to log out on all devices.');
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(session.userId),
  ]);
  return jsonResponse(request, { ok: true }, {
    headers: { 'Set-Cookie': clearSessionCookie(request) },
  });
}
