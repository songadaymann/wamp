import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../../auth/model';
import type { D1Database, D1PreparedStatement, Env, UserRow } from '../core/types';

vi.mock('../progression/store', () => ({
  ensureFounderIdentityQualification: vi.fn(async () => undefined),
}));

import { attachEmailToUser } from './store';

const NOW = '2026-07-25T12:00:00.000Z';

function createUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'wallet-user',
    email: null,
    walletAddress: '0x1234000000000000000000000000000000005678',
    displayName: 'Wallet Player',
    username: 'wallet-player',
    createdAt: NOW,
    avatarUrl: null,
    bio: null,
    selectedAvatarId: null,
    ...overrides,
  };
}

function createEnv(users: AuthUser[]): {
  env: Env;
  getUser(id: string): AuthUser | undefined;
  updateQueries: string[];
} {
  const userById = new Map(users.map((user) => [user.id, { ...user }]));
  const updateQueries: string[] = [];

  class Statement implements D1PreparedStatement {
    private values: unknown[] = [];

    constructor(private readonly query: string) {}

    bind(...values: unknown[]): D1PreparedStatement {
      this.values = values;
      return this;
    }

    async first<T>(): Promise<T | null> {
      if (this.query.includes('SELECT username, avatar_url, bio, selected_avatar_id')) {
        const user = userById.get(String(this.values[0]));
        return (user ? {
          username: user.username ?? null,
          avatar_url: user.avatarUrl ?? null,
          bio: user.bio ?? null,
          selected_avatar_id: user.selectedAvatarId ?? null,
        } : null) as T | null;
      }

      let user: AuthUser | undefined;
      if (this.query.includes('WHERE email = ?')) {
        user = [...userById.values()].find((candidate) => candidate.email === this.values[0]);
      } else if (this.query.includes('WHERE id = ?')) {
        user = userById.get(String(this.values[0]));
      }

      return (user ? toUserRow(user) : null) as T | null;
    }

    async all<T>(): Promise<{ results: T[] }> {
      if (this.query.includes('UPDATE users') && this.query.includes('SET email = ?')) {
        updateQueries.push(this.query);
        const [email, updatedAt, userId] = this.values as [string, string, string];
        const user = userById.get(userId);
        if (user && user.email === null) {
          user.email = email;
          user.createdAt = user.createdAt || updatedAt;
        }
      }
      return { results: [] };
    }
  }

  const db: D1Database = {
    prepare(query: string): D1PreparedStatement {
      return new Statement(query);
    },
    async batch<T>(statements: D1PreparedStatement[]): Promise<T[]> {
      return Promise.all(statements.map((statement) => statement.all().then((result) => result as T)));
    },
  };

  return {
    env: {
      DB: db,
      JAM_DB: db,
      ASSETS: { fetch: async () => new Response() },
    },
    getUser: (id) => userById.get(id),
    updateQueries,
  };
}

function toUserRow(user: AuthUser): UserRow {
  return {
    id: user.id,
    email: user.email,
    wallet_address: user.walletAddress,
    display_name: user.displayName,
    username: user.username ?? null,
    avatar_url: user.avatarUrl ?? null,
    bio: user.bio ?? null,
    selected_avatar_id: user.selectedAvatarId ?? null,
    created_at: user.createdAt ?? NOW,
    updated_at: NOW,
  };
}

describe('wallet account email linking', () => {
  it('attaches a verified email to the existing wallet user', async () => {
    const walletUser = createUser();
    const { env, getUser, updateQueries } = createEnv([walletUser]);

    const updated = await attachEmailToUser(env, walletUser, ' Wallet-Player@Example.com ');

    expect(updated.id).toBe(walletUser.id);
    expect(updated.walletAddress).toBe(walletUser.walletAddress);
    expect(updated.email).toBe('wallet-player@example.com');
    expect(getUser(walletUser.id)?.email).toBe('wallet-player@example.com');
    expect(updateQueries).toHaveLength(1);
    expect(updateQueries[0]).toContain('WHERE id = ? AND email IS NULL');
  });

  it('refuses to merge an email that belongs to another account', async () => {
    const walletUser = createUser();
    const emailUser = createUser({
      id: 'email-user',
      email: 'claimed@example.com',
      walletAddress: null,
    });
    const { env, getUser, updateQueries } = createEnv([walletUser, emailUser]);

    await expect(attachEmailToUser(env, walletUser, 'claimed@example.com'))
      .rejects.toMatchObject({ status: 409 });

    expect(getUser(walletUser.id)?.email).toBeNull();
    expect(updateQueries).toHaveLength(0);
  });
});
