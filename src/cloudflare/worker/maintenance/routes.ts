import { clearSessionCookie } from '../auth/request';
import { HttpError, jsonResponse } from '../core/http';
import type { Env } from '../core/types';

export async function handleTestReset(request: Request, env: Env): Promise<Response> {
  if (env.ENABLE_TEST_RESET !== '1') {
    throw new HttpError(403, 'Test reset is disabled for this Worker.');
  }

  const counts = {
    rooms: await countRows(env, 'rooms'),
    roomVersions: await countRows(env, 'room_versions'),
    roomRuns: await countRows(env, 'room_runs'),
    userStats: await countRows(env, 'user_stats'),
    chatMessages: await countRows(env, 'chat_messages'),
    users: await countRows(env, 'users'),
    sessions: await countRows(env, 'sessions'),
    magicLinks: await countRows(env, 'magic_link_tokens'),
    walletChallenges: await countRows(env, 'wallet_challenges'),
    apiTokens: await countRows(env, 'api_tokens'),
  };

  await env.DB.batch([
    env.DB.prepare('DELETE FROM api_tokens'),
    env.DB.prepare('DELETE FROM magic_link_tokens'),
    env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM wallet_challenges'),
    env.DB.prepare('DELETE FROM user_stats'),
    env.DB.prepare('DELETE FROM room_runs'),
    env.DB.prepare('DELETE FROM chat_messages'),
    env.DB.prepare('DELETE FROM room_versions'),
    env.DB.prepare('DELETE FROM rooms'),
    env.DB.prepare('DELETE FROM users'),
  ]);

  return jsonResponse(
    request,
    {
      ok: true,
      deleted: counts,
    },
    {
      headers: {
        'Set-Cookie': clearSessionCookie(request),
      },
    }
  );
}

export async function countRows(env: Env, tableName: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).first<{
    count: number | string | null;
  }>();

  return Number(row?.count ?? 0);
}
