import type { Env } from '../core/types';
import {
  LEGACY_GENERATED_DISPLAY_NAME_PREFIX,
  LEGACY_GENERATED_USER_LINKS_TABLE,
} from './legacySource';

export async function isGeneratedLeaderboardExcludedUserId(
  env: Env,
  userId: string
): Promise<boolean> {
  if (!userId) {
    return false;
  }

  const row = await env.DB.prepare(
    `
      SELECT 1 AS found
      FROM users users_generated_filter
      WHERE users_generated_filter.id = ?
        AND users_generated_filter.email IS NULL
        AND users_generated_filter.wallet_address IS NULL
        AND EXISTS (
          SELECT 1
          FROM ${LEGACY_GENERATED_USER_LINKS_TABLE} legacy_generated_user_links
          WHERE legacy_generated_user_links.user_id = users_generated_filter.id
        )
      LIMIT 1
    `
  )
    .bind(userId)
    .first<{ found: number | string | null }>();

  return Number(row?.found ?? 0) === 1;
}

export function sqlUserIdHasLegacyGeneratedLink(userIdExpression: string): string {
  return `EXISTS (
    SELECT 1
    FROM ${LEGACY_GENERATED_USER_LINKS_TABLE} legacy_generated_user_links
    WHERE legacy_generated_user_links.user_id = ${userIdExpression}
  )`;
}

export function sqlUserIdIsLegacyGeneratedOnly(userIdExpression: string): string {
  return `EXISTS (
    SELECT 1
    FROM users users_generated_filter
    WHERE users_generated_filter.id = ${userIdExpression}
      AND users_generated_filter.email IS NULL
      AND users_generated_filter.wallet_address IS NULL
      AND ${sqlUserIdHasLegacyGeneratedLink('users_generated_filter.id')}
  )`;
}

export function sqlUserIdIsNotLegacyGeneratedOnly(userIdExpression: string): string {
  return `NOT (${sqlUserIdIsLegacyGeneratedOnly(userIdExpression)})`;
}

export function sqlHasLegacyGeneratedDisplayNamePrefix(displayNameExpression: string): string {
  return `${displayNameExpression} LIKE '${LEGACY_GENERATED_DISPLAY_NAME_PREFIX}%'`;
}

export function sqlUserIdHasLegacyGeneratedDisplayNamePrefix(userIdExpression: string): string {
  return `EXISTS (
    SELECT 1
    FROM users users_generated_filter
    WHERE users_generated_filter.id = ${userIdExpression}
      AND ${sqlHasLegacyGeneratedDisplayNamePrefix('users_generated_filter.display_name')}
  )`;
}

export function sqlUserIdDoesNotHaveLegacyGeneratedDisplayNamePrefix(userIdExpression: string): string {
  return `NOT (${sqlUserIdHasLegacyGeneratedDisplayNamePrefix(userIdExpression)})`;
}
