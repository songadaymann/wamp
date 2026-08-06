import { describe, expect, it } from 'vitest';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';
import { hasUserAvatarEntitlement, loadUserAvatarEntitlementIds } from './entitlements';

describe('user avatar entitlements', () => {
  it('loads and checks entitlements by canonical user id', async () => {
    const env = createEnv(['gamejew-red', 'future-prize']);

    await expect(loadUserAvatarEntitlementIds(env, 'user-1')).resolves.toEqual(
      new Set(['gamejew-red', 'future-prize']),
    );
    await expect(hasUserAvatarEntitlement(env, 'user-1', 'gamejew-red')).resolves.toBe(true);
    await expect(hasUserAvatarEntitlement(env, 'user-1', 'not-granted')).resolves.toBe(false);
  });
});

function createEnv(avatarIds: string[]): Env {
  const database: D1Database = {
    prepare: (query: string): D1PreparedStatement => {
      let bindings: unknown[] = [];
      const statement: D1PreparedStatement = {
        bind: (...values: unknown[]) => {
          bindings = values;
          return statement;
        },
        first: async <T>() => {
          const avatarId = String(bindings[1] ?? '');
          return (query.includes('user_avatar_entitlements') && avatarIds.includes(avatarId)
            ? { avatar_id: avatarId }
            : null) as T | null;
        },
        all: async <T>() => ({
          results: (query.includes('user_avatar_entitlements')
            ? avatarIds.map((avatarId) => ({ avatar_id: avatarId }))
            : []) as T[],
        }),
      };
      return statement;
    },
    batch: async () => [],
  };

  return { DB: database } as Env;
}
