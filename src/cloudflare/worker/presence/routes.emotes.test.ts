import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { fixture, NOW } from '../activity/testDatabase';
import { handlePresenceRequest } from './routes';
import { verifyPartykitIdentityToken } from '../../../presence/identityToken';

let f: ReturnType<typeof fixture>;
afterEach(() => f?.sqlite.close());
function setup() {
  f = fixture();
  f.env.PARTYKIT_IDENTITY_TOKEN_SECRET = 'local-emote-test';
  f.sqlite.prepare('INSERT INTO school_classrooms(id,slug,display_name,teacher_email,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run('class-a', 'class-a', 'Class A', 'teacher@example.test', NOW, NOW);
  f.sqlite.prepare('INSERT INTO school_students(id,classroom_id,user_id,username,password_hash,password_updated_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run('student-a', 'class-a', 'p1', 'student', 'unused-login-fixture', NOW, NOW, NOW);
  for (const user of ['p1', 'p2']) f.sqlite.prepare('INSERT INTO sessions(id,user_id,token_hash,expires_at,created_at,last_seen_at) VALUES(?,?,?,?,?,?)')
    .run(user, user, createHash('sha256').update(user).digest('hex'), '2099-01-01T00:00:00.000Z', NOW, NOW);
}
async function issue(user?: string) {
  const request = new Request('https://api.wamp.land/api/presence/identity-token', {
    method: 'POST', headers: { Origin: 'https://wamp.land', 'Content-Type': 'application/json', ...(user ? { Cookie: `ep_session=${user}` } : {}) },
    body: JSON.stringify({ identity: { userId: 'guest-abcd-0000-0000', displayName: 'Guest abcd' }, classroomId: 'spoofed-class', roomChat: 'ok', emotesMuted: false }),
  });
  const response = await handlePresenceRequest(request, new URL(request.url), f.env);
  expect(response.status).toBe(200);
  const body = await response.json() as { token: string };
  return verifyPartykitIdentityToken(body.token, 'local-emote-test');
}
describe('school emote token issuance with real session/database auth', () => {
  it('uses school membership from the session rather than packet identity or scope', async () => {
    setup();
    expect(await issue('p1')).toMatchObject({ userId: 'p1', source: 'auth', roomChat: 'school', classroomId: 'class-a' });
    for (const user of ['p2', undefined]) expect((await issue(user))?.classroomId).toBeUndefined();
  });
  it('retains school isolation while muting a chat-banned student', async () => {
    setup();
    f.sqlite.prepare('INSERT INTO chat_bans(user_id,banned_by_user_id,created_at) VALUES(?,?,?)').run('p1', 'builder', NOW);
    expect(await issue('p1')).toMatchObject({ roomChat: 'school', classroomId: 'class-a', emotesMuted: true });
  });
  it('retains school isolation while muting a suspended student', async () => {
    setup();
    f.sqlite.prepare('UPDATE users SET suspended_at=? WHERE id=?').run(NOW, 'p1');
    expect(await issue('p1')).toMatchObject({ roomChat: 'school', classroomId: 'class-a', emotesMuted: true });
  });
});
