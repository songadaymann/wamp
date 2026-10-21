import { afterEach, describe, expect, it } from 'vitest';
import { fixture } from '../activity/testDatabase';
import { requireAuthenticatedRequestAuth, requireCurrentSession } from '../auth/request';
import { API_TOKEN_PREFIX, createApiTokenForUser, createSession, generateOpaqueToken, hashToken } from '../auth/store';

const opened: ReturnType<typeof fixture>[] = [];
afterEach(() => { for (const f of opened.splice(0)) f.sqlite.close(); });

function request(method: string, headers: Record<string, string>): Request {
  return new Request('https://api.wamp.land/api/rooms/0%2C0/publish', {
    method, headers: { Origin: 'https://wamp.land', ...headers },
  });
}

describe('account suspension', () => {
  it('refuses every signed-in write, by session or token, but keeps reads and log out working', async () => {
    const f = fixture(); opened.push(f);
    const session = await createSession(f.env, 'p1');
    const token = API_TOKEN_PREFIX + generateOpaqueToken(32);
    await createApiTokenForUser(f.env, 'p1', 'Bot', await hashToken(token), ['rooms:write'], new Date().toISOString(), crypto.randomUUID());
    const cookie = { Cookie: `ep_session=${session}` };
    const bearer = { Authorization: `Bearer ${token}` };
    await expect(requireAuthenticatedRequestAuth(f.env, request('POST', cookie), 'publish rooms', 'rooms:write'))
      .resolves.toMatchObject({ user: { id: 'p1' } });

    f.sqlite.prepare("UPDATE users SET suspended_at = ?, suspended_reason = 'raid' WHERE id = 'p1'").run(new Date().toISOString());
    for (const headers of [cookie, bearer]) {
      await expect(requireAuthenticatedRequestAuth(f.env, request('POST', headers), 'publish rooms', 'rooms:write'))
        .rejects.toMatchObject({ status: 403, message: expect.stringMatching(/suspended/) });
      await expect(requireAuthenticatedRequestAuth(f.env, request('GET', headers), 'read rooms', 'rooms:write'))
        .resolves.toMatchObject({ user: { id: 'p1' } });
    }
    await expect(requireCurrentSession(f.env, request('PUT', cookie), 'share custom sprites'))
      .rejects.toMatchObject({ status: 403 });
    await expect(requireCurrentSession(f.env, request('POST', cookie), 'log out on all devices', { allowSuspended: true }))
      .resolves.toMatchObject({ user: { id: 'p1' } });
    const other = await createSession(f.env, 'p2');
    await expect(requireAuthenticatedRequestAuth(f.env, request('POST', { Cookie: `ep_session=${other}` }), 'publish rooms', 'rooms:write'))
      .resolves.toMatchObject({ user: { id: 'p2' } });
  });
});
