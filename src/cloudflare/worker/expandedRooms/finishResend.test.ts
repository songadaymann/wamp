import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultCourseSnapshot, type CourseGoal } from '../../../courses/model';
import type { CourseRunFinishRequestBody } from '../../../courses/runModel';
import { fixture, NOW } from '../activity/testDatabase';
import { handleAdminSuspiciousInvalidate } from '../admin/suspiciousInvalidation';
import { handleCourseRunFinish } from '../courses/routes';
import { loadOrBackfillUserProgress } from '../progression/progressRows';
import type { D1PreparedStatement } from '../core/types';
import { handleExpandedRoomRunFinish } from './runRoutes';

// Real SQL for runs, rewards and invalidation; only auth and the published content are stubbed.
const goal: CourseGoal = { type: 'reach_exit', exit: { roomId: '0,0', x: 96, y: 256 }, timeLimitMs: null };
const body: CourseRunFinishRequestBody = { result: 'completed', elapsedMs: 9_000, deaths: 0, collectiblesCollected: 0,
  enemiesDefeated: 0, checkpointsReached: 0, score: null, finishedAt: NOW, verificationTrace: null };
vi.mock('../auth/request', async (original) => ({ ...await original<typeof import('../auth/request')>(),
  requireAuthenticatedRequestAuth: vi.fn(async () => ({ user: { id: 'p1', displayName: 'p1' }, isAdmin: false })) }));
vi.mock('../courses/requestBodies', async (original) => ({ ...await original<typeof import('../courses/requestBodies')>(),
  parseCourseRunFinishBody: vi.fn(async () => ({ ...body })) }));
vi.mock('./store', async (original) => ({ ...await original<typeof import('./store')>(),
  loadExpandedRoomTarget: vi.fn(async () => ({ expandedRoomId: 'expanded', legacyCourseId: 'course', title: 'Expanded' })) }));
vi.mock('../courses/store', async (original) => ({ ...await original<typeof import('../courses/store')>(),
  loadPublishedCourse: vi.fn(async () => ({ ...createDefaultCourseSnapshot('course'), version: 1, status: 'published', goal, roomRefs: [] })),
  loadCourseRecord: vi.fn(async () => ({ versions: [] })) }));
vi.mock('../runs/verification', async (original) => ({ ...await original<typeof import('../runs/verification')>(),
  createCourseVerificationTrigger: vi.fn(() => null) }));

let f: ReturnType<typeof fixture>;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW));
  f = fixture(); f.env.ADMIN_API_KEY = 'fixture-admin-key';
  // Progress rows exist before the clear (as for a signed-in player), so totals start from 0 events.
  for (const user of ['p1', 'builder']) await loadOrBackfillUserProgress(f.env, user);
  const snapshot = JSON.stringify({ ...createDefaultCourseSnapshot('course'), version: 1, status: 'published', goal, roomRefs: [] });
  f.sqlite.prepare(`INSERT INTO courses (id,owner_user_id,owner_display_name,draft_json,created_at,updated_at)
    VALUES ('course','builder','builder',?,?,?)`).run(snapshot, NOW, NOW);
  f.sqlite.prepare("INSERT INTO course_versions (course_id,version,snapshot_json,created_at) VALUES ('course',1,?,?)").run(snapshot, NOW);
  f.sqlite.prepare(`INSERT INTO expanded_rooms (id,owner_user_id,owner_display_name,anchor_room_id,anchor_x,anchor_y,draft_json,created_at,updated_at)
    VALUES ('expanded','builder','builder','0,0',0,0,'{}',?,?)`).run(NOW, NOW);
  f.sqlite.prepare("INSERT INTO expanded_room_versions (expanded_room_id,version,snapshot_json,created_at) VALUES ('expanded',1,'{}',?)").run(NOW);
});
afterEach(() => { f.sqlite.close(); vi.useRealTimers(); vi.restoreAllMocks(); });

const ATTEMPT = '00000000-0000-4000-8000-000000000351';
const STARTED = '2026-10-04T16:59:51.000Z';
function seed(result: 'active' | 'completed', copy = true) {
  const finishedAt = result === 'active' ? null : NOW;
  const elapsed = result === 'active' ? null : 9_000;
  if (copy) f.sqlite.prepare(`INSERT INTO course_runs (attempt_id,course_id,course_version,goal_type,goal_json,user_id,user_display_name,
    started_at,finished_at,result,elapsed_ms,deaths,score,collectibles_collected,enemies_defeated,checkpoints_reached,verification_status,verification_nonce,verification_snapshot_hash)
    VALUES (?,'course',1,'reach_exit',?,'p1','p1',?,?,?,?,0,0,0,0,0,?,'nonce','hash')`)
    .run(ATTEMPT, JSON.stringify(goal), STARTED, finishedAt, result, elapsed, result === 'active' ? 'not_required' : 'passed');
  f.sqlite.prepare(`INSERT INTO expanded_room_runs (attempt_id,expanded_room_id,expanded_room_version,goal_type,goal_json,user_id,user_display_name,
    started_at,finished_at,result,elapsed_ms,deaths,score,collectibles_collected,enemies_defeated,checkpoints_reached,legacy_course_attempt_id,verification_status,verification_nonce,verification_snapshot_hash)
    VALUES (?,'expanded',1,'reach_exit',?,'p1','p1',?,?,?,?,0,0,0,0,0,?,?,'nonce','hash')`)
    .run(ATTEMPT, JSON.stringify(goal), STARTED, finishedAt, result, elapsed, ATTEMPT, result === 'active' ? 'not_required' : 'passed');
}
const finishRequest = () => new Request('https://api.wamp.land/finish', { method: 'POST' });
const resendExpanded = () => handleExpandedRoomRunFinish(finishRequest(), f.env, ATTEMPT).catch((error: unknown) => error);
const count = (sql: string) => Number((f.sqlite.prepare(sql).get() as { n: number }).n);
const events = (type: string) => count(`SELECT COUNT(*) AS n FROM point_events WHERE event_type = '${type}' AND source_key = '${ATTEMPT}'`);
const settled = (kind = 'expanded_room') =>
  count(`SELECT COUNT(*) AS n FROM run_settlements WHERE attempt_kind = '${kind}' AND attempt_id = '${ATTEMPT}'`);
const discoveryKeys = () => (f.sqlite.prepare("SELECT target_key FROM discovery_run_players WHERE user_id = 'p1' ORDER BY target_key").all() as
  { target_key: string }[]).map((row) => row.target_key);
const firstClears = () => count(`SELECT COUNT(*) AS n FROM pxp_events WHERE user_id = 'p1' AND event_type = 'course_clear_first'`);

describe('Expanded Room finish resends (F351)', () => {
  it('re-settles a committed clear whose rewards never finished, once', async () => {
    seed('completed');
    expect(await resendExpanded()).toMatchObject({ status: 204 });
    expect({ finalized: events('run_finalized'), settled: settled(), firstClears: firstClears() })
      .toEqual({ finalized: 1, settled: 1, firstClears: 1 });
    expect(await resendExpanded()).toMatchObject({ status: 204 });
    expect({ finalized: events('run_finalized'), settled: settled(), firstClears: firstClears() })
      .toEqual({ finalized: 1, settled: 1, firstClears: 1 });
    const total = f.sqlite.prepare(`SELECT total_pxp AS total, (SELECT SUM(amount) FROM pxp_events WHERE user_id = 'p1') AS events
      FROM user_progress WHERE user_id = 'p1'`).get() as { total: number; events: number };
    expect(total.total).toBe(total.events);
  });

  it('never re-awards a run while invalidation is between its two batches (F205)', async () => {
    seed('completed');
    expect(await resendExpanded()).toMatchObject({ status: 204 });
    expect(settled()).toBe(1);

    // Run the resend exactly when the course_runs copy and the markers are gone but the
    // expanded_room_runs row is not yet.
    const batch = f.env.DB.batch.bind(f.env.DB);
    let inWindow: unknown = null;
    f.env.DB.batch = async <T>(statements: D1PreparedStatement[]): Promise<T[]> => {
      if (!inWindow && statements.some((statement) => (statement as unknown as { sql: string }).sql.includes('DELETE FROM expanded_room_runs'))) {
        inWindow = await resendExpanded();
      }
      return batch<T>(statements);
    };
    const invalidate = new Request('https://api.wamp.land/api/admin/suspicious/users/p1/invalidate', {
      method: 'POST', headers: { 'x-admin-key': 'fixture-admin-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomRunAttemptIds: [], courseRunAttemptIds: [ATTEMPT], pointEventIds: [], reason: 'Impossible times', operatorLabel: 'fixture' }),
    });
    expect((await handleAdminSuspiciousInvalidate(invalidate, f.env, 'p1')).status).toBe(200);

    expect(inWindow).toMatchObject({ status: 404 });
    expect({ finalized: events('run_finalized'), settled: settled() }).toEqual({ finalized: 0, settled: 0 });
    expect(count(`SELECT COUNT(*) AS n FROM expanded_room_runs WHERE attempt_id = '${ATTEMPT}'`)).toBe(0);
  });

  it('hands a course-route finish of an Expanded Room copy to that route, so it settles once from one history', async () => {
    seed('active');
    vi.setSystemTime(new Date(Date.parse(STARTED) + 9_000));
    expect(await handleCourseRunFinish(finishRequest(), f.env, ATTEMPT)).toMatchObject({ status: 204 });
    const rows = f.sqlite.prepare(`SELECT c.result AS copy, c.finished_at AS copyAt, e.result AS expanded, e.finished_at AS expandedAt
      FROM course_runs c JOIN expanded_room_runs e ON e.legacy_course_attempt_id = c.attempt_id WHERE c.attempt_id = ?`).get(ATTEMPT) as Record<string, string>;
    expect(rows).toEqual({ copy: 'completed', copyAt: rows.copyAt, expanded: 'completed', expandedAt: rows.copyAt });
    expect({ finalized: events('run_finalized'), settled: settled(), courseSettled: settled('course'), firstClears: firstClears() })
      .toEqual({ finalized: 1, settled: 1, courseSettled: 0, firstClears: 1 });
    // Settled as the Expanded Room run only: one discovery key, not the legacy course's too.
    expect(discoveryKeys()).toEqual(['expanded_room:expanded']);

    // A resend through either route replays the outcome.
    expect(await handleCourseRunFinish(finishRequest(), f.env, ATTEMPT)).toMatchObject({ status: 204 });
    expect(await resendExpanded()).toMatchObject({ status: 204 });
    expect({ finalized: events('run_finalized'), settled: settled(), courseSettled: settled('course'), firstClears: firstClears() })
      .toEqual({ finalized: 1, settled: 1, courseSettled: 0, firstClears: 1 });
    expect(discoveryKeys()).toEqual(['expanded_room:expanded']);
  });
});
