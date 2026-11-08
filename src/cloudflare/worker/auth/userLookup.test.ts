import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture, NOW } from '../activity/testDatabase';
import {
  createMagicLinkToken, createUserForEmail, findUserByDisplayName, findUserByEmail, findUserById,
  findUserByUsername, findUserByWallet, hashToken, loadApiTokenAuth,
  loadLiveEmailCodes, loadMagicLinkByTokenHash,
} from './store';

describe('single-query user profiles on the migrated schema', () => {
  let f: ReturnType<typeof fixture>;
  beforeEach(() => {
    f = fixture();
    f.sqlite.prepare(`UPDATE users SET username = 'ada', display_name = 'Ada',
      wallet_address = '0xabc', avatar_url = 'https://example.test/avatar.png',
      bio = 'Builder', selected_avatar_id = 'red' WHERE id = 'p1'`).run();
  });
  afterEach(() => { vi.restoreAllMocks(); f.sqlite.close(); });

  const profile = { username: 'ada', avatarUrl: 'https://example.test/avatar.png', bio: 'Builder', selectedAvatarId: 'red' };
  const rowProfile = { username: 'ada', avatar_url: profile.avatarUrl, bio: 'Builder', selected_avatar_id: 'red' };

  it.each([
    ['email', (env: typeof f.env) => findUserByEmail(env, 'p1@example.test')],
    ['wallet', (env: typeof f.env) => findUserByWallet(env, '0xabc')],
    ['id', (env: typeof f.env) => findUserById(env, 'p1')],
    ['username', (env: typeof f.env) => findUserByUsername(env, 'ADA')],
    ['display name', (env: typeof f.env) => findUserByDisplayName(env, 'ADA')],
  ] as const)('loads full fields by %s with one query', async (_label, lookup) => {
    const queries = vi.spyOn(f.env.DB, 'prepare');
    expect(await lookup(f.env)).toMatchObject({ id: 'p1', ...profile });
    expect(queries).toHaveBeenCalledTimes(1);
  });

  it('returns null for an unknown user in one query', async () => {
    const queries = vi.spyOn(f.env.DB, 'prepare');
    expect(await findUserByEmail(f.env, "missing' OR 1=1 --")).toBeNull();
    expect(queries).toHaveBeenCalledTimes(1);
  });

  it('preserves nullable fields on existing accounts', async () => {
    expect(await findUserById(f.env, 'p2')).toMatchObject({
      id: 'p2', username: null, avatarUrl: null, bio: null, selectedAvatarId: null,
    });
  });

  it('creates a username without a schema probe or a second profile read', async () => {
    const queries = vi.spyOn(f.env.DB, 'prepare');
    const user = await createUserForEmail(f.env, 'new-player@example.test');
    expect(user.username).toBeTruthy();
    expect(queries).toHaveBeenCalledTimes(2);
    expect(await findUserById(f.env, user.id)).toMatchObject({ email: user.email, username: user.username });
  });

  it('surfaces database failures without hiding them as a missing account', async () => {
    vi.spyOn(f.env.DB, 'prepare').mockImplementation(() => { throw new Error('database unavailable'); });
    await expect(findUserByUsername(f.env, 'ada')).rejects.toThrow('database unavailable');
  });

  it('loads both live codes and their profiles in one joined query', async () => {
    for (const token of ['first', 'second']) {
      await createMagicLinkToken(f.env, 'p1', 'p1@example.test', token, token, '2099-01-01', NOW);
    }
    const queries = vi.spyOn(f.env.DB, 'prepare');
    const rows = await loadLiveEmailCodes(f.env, 'p1@example.test', NOW);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toMatchObject(rowProfile);
    expect(queries).toHaveBeenCalledTimes(1);
    queries.mockClear();
    expect(await loadMagicLinkByTokenHash(f.env, 'first')).toMatchObject(rowProfile);
    expect(queries).toHaveBeenCalledTimes(1);
  });

  it('loads API-token profile in one read and retains the usage write and revocation check', async () => {
    const tokenHash = await hashToken('test-token');
    f.sqlite.prepare(`INSERT INTO api_tokens (id,user_id,label,token_hash,scopes_json,created_at)
      VALUES ('token','p1','test',?,'["rooms:read"]',?)`).run(tokenHash, NOW);
    const queries = vi.spyOn(f.env.DB, 'prepare');
    expect(await loadApiTokenAuth(f.env, 'test-token')).toMatchObject({ user: profile });
    expect(queries).toHaveBeenCalledTimes(2);
    expect(queries.mock.calls.filter(([sql]) => /SELECT/i.test(sql))).toHaveLength(1);
    expect(f.sqlite.prepare("SELECT last_used_at FROM api_tokens WHERE id = 'token'").get()).toMatchObject({ last_used_at: expect.any(String) });
    f.sqlite.prepare("UPDATE api_tokens SET revoked_at = ? WHERE id = 'token'").run(NOW);
    queries.mockClear();
    expect(await loadApiTokenAuth(f.env, 'test-token')).toBeNull();
    expect(queries).toHaveBeenCalledTimes(1);
  });
});
