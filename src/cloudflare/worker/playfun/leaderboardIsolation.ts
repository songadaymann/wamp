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

export async function isPlayfunLeaderboardExcludedUserId(
  env: Env,
  userId: string
): Promise<boolean> {
  if (!userId) {
    return false;
  }

  const row = await env.DB.prepare(
    `
      SELECT 1 AS found
      FROM users users_playfun_filter
      WHERE users_playfun_filter.id = ?
        AND users_playfun_filter.email IS NULL
        AND users_playfun_filter.wallet_address IS NULL
        AND EXISTS (
          SELECT 1
          FROM playfun_user_links playfun_user_links
          WHERE playfun_user_links.user_id = users_playfun_filter.id
        )
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
  if (await isPlayfunLeaderboardExcludedUserId(env, auth.user.id)) {
    throw new HttpError(
      403,
      `Play.fun-only accounts can still ${actionLabel}, but WAMP leaderboard participation stays local-only.`
    );
  }
}

export function sqlUserIdHasPlayfunLink(userIdExpression: string): string {
  return `EXISTS (
    SELECT 1
    FROM playfun_user_links playfun_user_links
    WHERE playfun_user_links.user_id = ${userIdExpression}
  )`;
}

export function sqlUserIdIsPlayfunOnly(userIdExpression: string): string {
  return `EXISTS (
    SELECT 1
    FROM users users_playfun_filter
    WHERE users_playfun_filter.id = ${userIdExpression}
      AND users_playfun_filter.email IS NULL
      AND users_playfun_filter.wallet_address IS NULL
      AND ${sqlUserIdHasPlayfunLink('users_playfun_filter.id')}
  )`;
}

export function sqlUserIdIsNotPlayfunOnly(userIdExpression: string): string {
  return `NOT (${sqlUserIdIsPlayfunOnly(userIdExpression)})`;
}

export function sqlHasPlayfunDisplayNamePrefix(displayNameExpression: string): string {
  return `${displayNameExpression} LIKE 'playfun-%'`;
}

export function sqlDoesNotHavePlayfunDisplayNamePrefix(displayNameExpression: string): string {
  return `NOT (${sqlHasPlayfunDisplayNamePrefix(displayNameExpression)})`;
}

export function sqlUserIdHasPlayfunDisplayNamePrefix(userIdExpression: string): string {
  return `EXISTS (
    SELECT 1
    FROM users users_playfun_filter
    WHERE users_playfun_filter.id = ${userIdExpression}
      AND ${sqlHasPlayfunDisplayNamePrefix('users_playfun_filter.display_name')}
  )`;
}

export function sqlUserIdDoesNotHavePlayfunDisplayNamePrefix(userIdExpression: string): string {
  return `NOT (${sqlUserIdHasPlayfunDisplayNamePrefix(userIdExpression)})`;
}
