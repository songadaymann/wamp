import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '../activity/testDatabase';
import { handleAuthRequest } from './routes';
import { API_TOKEN_PREFIX, createApiTokenForUser, createSession, generateOpaqueToken,
  hashToken, loadApiTokenAuth, loadSessionFromToken } from './store';
import { createSchoolClassroom, createSchoolStudent, resetSchoolStudentPassword } from '../school/store';

const databases: ReturnType<typeof fixture>[] = [];
const database = () => { const f = fixture(); databases.push(f); return f; };
afterEach(() => { vi.restoreAllMocks(); for (const f of databases.splice(0)) f.sqlite.close(); });

function request(token?: string, options: { origin?: string | null; path?: string; method?: string; authorization?: string } = {}) {
  const headers = new Headers();
  if (token) headers.set('Cookie', `ep_session=${token}`);
  if (options.origin !== null) headers.set('Origin', options.origin ?? 'https://wamp.land');
  if (options.authorization) headers.set('Authorization', options.authorization);
  return new Request(`https://api.wamp.land/api/auth/${options.path ?? 'logout-all'}`, {
    method: options.method ?? 'POST', headers,
    // No caller-provided identity may select whose sessions get revoked.
    ...((options.method ?? 'POST') === 'POST' ? { body: JSON.stringify({ userId: 'p1' }) } : {}),
  });
}
const dispatch = (f: ReturnType<typeof fixture>, r: Request) => handleAuthRequest(r, new URL(r.url), f.env);

describe('all-device session revocation', () => {
  it('revokes all of the authenticated user sessions, preserves another user and clears the cookie', async () => {
    const f = database();
    const own = await Promise.all([1, 2, 3].map(() => createSession(f.env, 'builder')));
    const other = await createSession(f.env, 'p1');
    const response = await dispatch(f, request(own[0]));
    expect(response.status).toBe(200); await expect(response.json()).resolves.toEqual({ ok: true });
    expect(response.headers.get('Set-Cookie')).toMatch(/ep_session=;.*Max-Age=0/);
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly');
    expect(response.headers.get('Set-Cookie')).toContain('Secure');
    for (const token of own) expect(await loadSessionFromToken(f.env, token)).toBeNull();
    expect((await loadSessionFromToken(f.env, other))?.userId).toBe('p1');
    await expect(dispatch(f, request(own[1]))).rejects.toMatchObject({ status: 401 });
    const plan = f.sqlite.prepare('EXPLAIN QUERY PLAN DELETE FROM sessions WHERE user_id = ?').all('builder');
    expect(JSON.stringify(plan)).toContain('idx_sessions_user_id');
  });

  it('keeps ordinary logout limited to the current session', async () => {
    const f = database(), first = await createSession(f.env, 'builder'), second = await createSession(f.env, 'builder');
    expect((await dispatch(f, request(first, { path: 'logout' }))).status).toBe(200);
    expect(await loadSessionFromToken(f.env, first)).toBeNull();
    expect((await loadSessionFromToken(f.env, second))?.userId).toBe('builder');
  });

  it('does not revoke sessions through a GET request', async () => {
    const f = database(), live = await createSession(f.env, 'builder');
    await expect(dispatch(f, request(live, { method: 'GET' }))).rejects.toMatchObject({ status: 404 });
    expect(await loadSessionFromToken(f.env, live)).not.toBeNull();
  });

  it.each([undefined, 'invalid-cookie'])('rejects missing or invalid session cookies (%s)', async cookie => {
    const f = database(), live = await createSession(f.env, 'builder');
    await expect(dispatch(f, request(cookie))).rejects.toMatchObject({ status: 401 });
    expect(await loadSessionFromToken(f.env, live)).not.toBeNull();
  });

  it('requires a browser session even when an API token is otherwise valid', async () => {
    const f = database(), live = await createSession(f.env, 'builder');
    const token = API_TOKEN_PREFIX + generateOpaqueToken(32);
    await createApiTokenForUser(f.env, 'builder', 'Test token', await hashToken(token), ['rooms:write'],
      new Date().toISOString(), crypto.randomUUID());
    expect(await loadApiTokenAuth(f.env, token)).not.toBeNull();
    await expect(dispatch(f, request(undefined, { authorization: `Bearer ${token}` }))).rejects.toMatchObject({ status: 401 });
    expect(await loadSessionFromToken(f.env, live)).not.toBeNull();
  });

  it.each(['https://untrusted.example', null])('rejects an untrusted or absent origin (%s)', async origin => {
    const f = database(), live = await createSession(f.env, 'builder');
    await expect(dispatch(f, request(live, { origin }))).rejects.toMatchObject({ status: 403 });
    expect(await loadSessionFromToken(f.env, live)).not.toBeNull();
  });

  it('does not revoke a live session when an expired cookie is presented', async () => {
    const f = database(), expired = await createSession(f.env, 'builder', -1), live = await createSession(f.env, 'builder');
    await expect(dispatch(f, request(expired))).rejects.toMatchObject({ status: 401 });
    expect(await loadSessionFromToken(f.env, live)).not.toBeNull();
  });

  it('keeps authentication intact if the revocation write fails', async () => {
    const f = database(), live = await createSession(f.env, 'builder');
    const write = vi.spyOn(f.env.DB, 'batch').mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(dispatch(f, request(live))).rejects.toThrow('Storage unavailable');
    write.mockRestore(); expect(await loadSessionFromToken(f.env, live)).not.toBeNull();
  });

  it('never restores sessions during concurrent logout requests', async () => {
    const f = database(), a = await createSession(f.env, 'builder'), b = await createSession(f.env, 'builder');
    const other = await createSession(f.env, 'p1');
    const results = await Promise.allSettled([dispatch(f, request(a)), dispatch(f, request(b))]);
    for (const result of results) {
      if (result.status === 'fulfilled') expect(result.value.status).toBe(200);
      else expect(result.reason).toMatchObject({ status: 401 });
    }
    expect(await loadSessionFromToken(f.env, a)).toBeNull(); expect(await loadSessionFromToken(f.env, b)).toBeNull();
    expect(await loadSessionFromToken(f.env, other)).not.toBeNull();
  });

  it('retains existing school password-reset revocation with actual migrated records', async () => {
    const f = database();
    const classroom = await createSchoolClassroom(new Request('https://wamp.land'), f.env,
      { slug: 'session-fixture', displayName: 'Session fixture', teacherEmail: 'teacher@example.test' });
    const { student } = await createSchoolStudent(f.env, classroom, 'student-fixture');
    const first = await createSession(f.env, student.userId), second = await createSession(f.env, student.userId);
    const other = await createSession(f.env, 'p1');
    const reset = await resetSchoolStudentPassword(f.env, classroom.id, student.id);
    expect(reset.student.passwordResetRequired).toBe(true);
    expect(await loadSessionFromToken(f.env, first)).toBeNull(); expect(await loadSessionFromToken(f.env, second)).toBeNull();
    expect(await loadSessionFromToken(f.env, other)).not.toBeNull();
  });
});
