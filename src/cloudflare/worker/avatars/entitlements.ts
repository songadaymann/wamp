import type { PlayerAvatarId } from '../../../player/avatar/model';
import type { Env } from '../core/types';

interface UserAvatarEntitlementRow {
  avatar_id: string;
}

export async function loadUserAvatarEntitlementIds(
  env: Env,
  userId: string,
): Promise<Set<PlayerAvatarId>> {
  const result = await env.DB.prepare(
    `
      SELECT avatar_id
      FROM user_avatar_entitlements
      WHERE user_id = ?
      ORDER BY avatar_id ASC
    `,
  )
    .bind(userId)
    .all<UserAvatarEntitlementRow>();

  return new Set(result.results.map((row) => row.avatar_id));
}

export async function hasUserAvatarEntitlement(
  env: Env,
  userId: string,
  avatarId: PlayerAvatarId,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `
      SELECT avatar_id
      FROM user_avatar_entitlements
      WHERE user_id = ? AND avatar_id = ?
      LIMIT 1
    `,
  )
    .bind(userId, avatarId)
    .first<UserAvatarEntitlementRow>();

  return row?.avatar_id === avatarId;
}
