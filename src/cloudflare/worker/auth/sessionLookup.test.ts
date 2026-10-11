import { describe, expect, it } from 'vitest';
import { NOW, fixture } from '../activity/testDatabase';
import { loadOptionalRequestAuth } from './request';
import { createSession } from './store';

/** Counts the D1 statements a request's auth lookup runs. */
async function signedIn(f: ReturnType<typeof fixture>, userId: string) {
  const token = await createSession(f.env, userId);
  const prepare = f.env.DB.prepare.bind(f.env.DB);
  const statements: string[] = [];
  f.env.DB.prepare = (sql: string) => { statements.push(sql.replace(/\s+/g, ' ').trim().slice(0, 40)); return prepare(sql); };
  const request = new Request('https://api.wamp.land/api/me', { headers: { Cookie: `ep_session=${token}` } });
  const auth = await loadOptionalRequestAuth(f.env, request);
  f.env.DB.prepare = prepare;
  return { auth, statements };
}

function enrol(f: ReturnType<typeof fixture>, userId: string, disabledAt: string | null = null) {
  f.sqlite.prepare(`INSERT INTO school_classrooms (id,slug,display_name,teacher_email,created_at,updated_at,disabled_at)
    VALUES ('class-1','room-12','Room 12','teacher@example.test',?,?,?)`).run(NOW, NOW, disabledAt);
  f.sqlite.prepare(`INSERT INTO school_students (id,classroom_id,user_id,username,password_hash,password_reset_required,password_updated_at,created_at,updated_at)
    VALUES ('student-1','class-1',?,'ada','hash',0,?,?,?)`).run(userId, NOW, NOW, NOW);
}

describe('signed-in request lookup (F031)', () => {
  it('identifies the player, profile fields included, in one query', async () => {
    const f = fixture();
    f.sqlite.prepare(`UPDATE users SET username = 'p1name', bio = 'hello', selected_avatar_id = 'frog' WHERE id = 'p1'`).run();
    const { auth, statements } = await signedIn(f, 'p1');
    expect(statements).toHaveLength(1);
    expect(auth?.user).toMatchObject({ id: 'p1', username: 'p1name', bio: 'hello', selectedAvatarId: 'frog' });
    expect(auth?.school).toBeNull();
  });

  it('carries a student\'s classroom in the same query', async () => {
    const f = fixture(); enrol(f, 'p1');
    const { auth, statements } = await signedIn(f, 'p1');
    expect(statements).toHaveLength(1);
    expect(auth?.school).toEqual({ classroomId: 'class-1', classroomSlug: 'room-12', classroomName: 'Room 12', studentId: 'student-1', studentUsername: 'ada' });
  });

  it('still signs out a student whose classroom is disabled', async () => {
    const f = fixture(); enrol(f, 'p1', NOW);
    const { auth } = await signedIn(f, 'p1');
    expect(auth).toBeNull();
    expect((f.sqlite.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = 'p1'`).get() as { n: number }).n).toBe(0);
  });
});
