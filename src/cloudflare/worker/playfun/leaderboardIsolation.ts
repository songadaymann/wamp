import { HttpError } from '../core/http';
import type { Env, RequestAuth } from '../core/types';

export function isPlayfunAuthSource(
  source: RequestAuth['source'] | null | undefined
): boolean {
  return source === 'playfun';
}

export function isPlayfunRequestAuth(
  auth: Pick<RequestAuth, 'source'> | null | undefined
): boolean {
  return isPlayfunAuthSource(auth?.source);
}

export async function isPlayfunLinkedUser(
  env: Env,
  userId: string
): Promise<boolean> {
  if (!userId) {
    return false;
  }

  const row = await env.DB.prepare(
    `
      SELECT 1 AS found
      FROM playfun_user_links
      WHERE user_id = ?
      LIMIT 1
    `
  )
    .bind(userId)
    .first<{ found: number | string | null }>();

  return Number(row?.found ?? 0) === 1;
}

export async function assertWampLeaderboardWriteAllowed(
  env: Env,
  auth: Pick<RequestAuth, 'source' | 'user'>,
  actionLabel: string
): Promise<void> {
  if (isPlayfunRequestAuth(auth) || (await isPlayfunLinkedUser(env, auth.user.id))) {
    throw new HttpError(
      403,
      `Play.fun-linked accounts can still ${actionLabel}, but WAMP leaderboard participation stays local-only.`
    );
  }
}

export function sqlIsPlayfunLinkedUser(userIdExpression: string): string {
  return `EXISTS (
    SELECT 1
    FROM playfun_user_links playfun_user_links
    WHERE playfun_user_links.user_id = ${userIdExpression}
  )`;
}

export function sqlIsNotPlayfunLinkedUser(userIdExpression: string): string {
  return `NOT ${sqlIsPlayfunLinkedUser(userIdExpression)}`;
}
