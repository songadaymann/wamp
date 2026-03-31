import { isPlayfunLeaderboardExcludedDisplayName } from '../../../playfun/identity';
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
      FROM users
      WHERE id = ?
        AND display_name LIKE 'playfun-%'
      LIMIT 1
    `
  )
    .bind(userId)
    .first<{ found: number | string | null }>();

  return Number(row?.found ?? 0) === 1;
}

export async function assertWampLeaderboardWriteAllowed(
  _env: Env,
  auth: Pick<RequestAuth, 'source' | 'user'>,
  actionLabel: string
): Promise<void> {
  if (isPlayfunLeaderboardExcludedDisplayName(auth.user.displayName)) {
    throw new HttpError(
      403,
      `Accounts using Play.fun burner names can still ${actionLabel}, but WAMP leaderboard participation stays local-only.`
    );
  }
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
