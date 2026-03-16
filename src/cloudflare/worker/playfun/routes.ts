import { requireAuthenticatedRequestAuth } from '../auth/request';
import { jsonResponse } from '../core/http';
import type { Env } from '../core/types';
import { flushPlayfunPointSync, getPlayfunPublicConfig, linkPlayfunUserFromRequest } from './service';

export async function handlePlayfunConfig(request: Request, env: Env): Promise<Response> {
  return jsonResponse(request, getPlayfunPublicConfig(env), {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

export async function handlePlayfunFlush(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuthenticatedRequestAuth(env, request, 'flush Play.fun points');
  await linkPlayfunUserFromRequest(env, request, auth.user.id);
  const summary = await flushPlayfunPointSync(env, auth.user.id);
  return jsonResponse(request, summary, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
