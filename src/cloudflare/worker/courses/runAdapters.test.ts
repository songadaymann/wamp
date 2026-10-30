import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultCourseSnapshot } from '../../../courses/model';
import { publishRoomAs, workerApi, type WorkerApi } from '../core/workerApi.testSupport';

// The complete Worker on migrated SQLite. Verification policy is covered by the finalization
// contract suite; here a non-triggering finish exercises real storage, boards, ratings and XP.
vi.mock('../runs/verification', async original => ({ ...await original<typeof import('../runs/verification')>(),
  createCourseVerificationTrigger: vi.fn(() => null) }));
let api: WorkerApi, builder: string, player: string, other: string;
const goal = { type: 'reach_exit', exit: { roomId: '1,0', x: 600, y: 256 }, timeLimitMs: null };
const finishBody = { result: 'completed', elapsedMs: 9000, deaths: 0, collectiblesCollected: 0, enemiesDefeated: 0, checkpointsReached: 0 };
const migration = readFileSync(new URL('../../../../migrations/0075_course_run_convergence.sql', import.meta.url), 'utf8');
const courseUrl = '/api/courses/merged';
const expandedUrl = '/api/expanded-rooms/course%3Amerged';
const courseBoard = '/api/leaderboards/courses/merged?version=1';
const expandedBoard = '/api/leaderboards/expanded-rooms/course%3Amerged?version=1';
const finishUrl = (attempt: string, legacy = true) => `/api/${legacy ? 'course-runs' : 'expanded-room-runs'}/${attempt}/finish`;
const tick = (ms = 9000) => vi.setSystemTime(Date.now() + ms);
function row(sql: string, ...values: (string | number)[]) { return api.sqlite.prepare(sql).get(...values) as Record<string, any>; }
async function start(legacy = true, version = 1) {
  const response = await api.call(`${legacy ? courseUrl : expandedUrl}/runs/start`, { session: player, body: legacy
    ? { courseId: 'merged', courseVersion: version, goal }
    : { expandedRoomId: 'course:merged', expandedRoomVersion: version, goal } });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body;
}
async function finish(attempt: string, legacy = true) {
  return api.call(finishUrl(attempt, legacy), { session: player, body: finishBody });
}
function removeCanonicalAttempt(attempt: string) {
  api.sqlite.prepare('DELETE FROM expanded_room_runs WHERE attempt_id = ?').run(attempt);
}
function awards(attempt: string) {
  return row("SELECT COUNT(*) AS count FROM point_events WHERE event_type = 'run_finalized' AND source_key = ?", attempt).count;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-04T18:00:00Z'));
  api = workerApi(); builder = await api.signIn('builder'); player = await api.signIn('p1'); other = await api.signIn('p2');
  await publishRoomAs(api, builder, 1, 0);
  await api.setBuilderCaps('builder', { expandedRoomCellLimit: 4 });
  const created = await api.call('/api/courses', { session: builder, body: {
    ...createDefaultCourseSnapshot('merged'), title: 'Merged path', goal,
    roomRefs: [0, 1].map(x => ({ roomId: `${x},0`, coordinates: { x, y: 0 }, roomVersion: 1, roomTitle: null })),
    startPoint: { roomId: '0,0', x: 64, y: 256 },
  } });
  expect(created.status).toBe(200);
  expect((await api.call(`${courseUrl}/publish`, { method: 'POST', session: builder })).status).toBe(200);
});
afterEach(() => { api.close(); vi.useRealTimers(); });

describe('course routes adapt to one Expanded Room accounting path (F270)', () => {
  it.each([true, false])('shares starts, finishes, boards and ratings when legacy start=%s', async legacy => {
    const started = await start(legacy);
    if (legacy) {
      expect(started).toMatchObject({ courseId: 'merged', courseVersion: 1, verificationSchemaVersion: 1 });
      expect(started).not.toHaveProperty('expandedRoomId');
      expect(started).not.toHaveProperty('legacyCourseId');
    }
    const stored = row('SELECT * FROM expanded_room_runs WHERE attempt_id = ?', started.attemptId);
    const copy = row('SELECT * FROM course_runs WHERE attempt_id = ?', started.attemptId);
    expect(stored).toMatchObject({ legacy_course_attempt_id: started.attemptId, expanded_room_id: 'course:merged',
      verification_nonce: copy.verification_nonce, verification_snapshot_hash: copy.verification_snapshot_hash });
    tick();
    expect((await finish(started.attemptId, !legacy)).status).toBe(204);
    expect((await finish(started.attemptId, legacy)).status).toBe(204);
    expect(awards(started.attemptId)).toBe(1);
    const [oldBoard, newBoard] = await Promise.all([
      api.call(courseBoard, { session: player }), api.call(expandedBoard, { session: player }),
    ]);
    expect([oldBoard.status, newBoard.status]).toEqual([200, 200]);
    expect(oldBoard.body.entries).toHaveLength(1);
    expect(oldBoard.body.entries[0]).toMatchObject({ attemptId: started.attemptId, courseId: 'merged', courseVersion: 1, userId: 'p1' });
    expect(oldBoard.body).not.toHaveProperty('expandedRoomId');
    expect(oldBoard.body.entries[0]).not.toHaveProperty('expandedRoomId');
    expect(oldBoard.body.viewerBest).not.toHaveProperty('expandedRoomId');
    expect(newBoard.body.entries[0]).toMatchObject({ ...oldBoard.body.entries[0], expandedRoomId: 'course:merged' });
    expect(oldBoard.headers.get('Cache-Control')).toBe('private, max-age=20');
    expect((await api.call(courseBoard)).headers.get('Cache-Control')).toBe('public, max-age=20, stale-while-revalidate=40');

    const rated = await api.call(`${courseUrl}/ratings`, { session: player, body: {
      courseVersion: 1, qualityStars: 4, difficultyChoice: 'hard', autoSuggestedDifficulty: 'hard',
    } });
    expect(rated.status, JSON.stringify(rated.body)).toBe(200);
    expect(rated.body).toMatchObject({ ok: true, courseId: 'merged', courseVersion: 1 });
    expect(rated.body).toHaveProperty('summary');
    expect(rated.body).not.toHaveProperty('expandedRoomId');
    expect(row("SELECT quality_stars FROM expanded_room_ratings WHERE expanded_room_id = 'course:merged' AND user_id = 'p1'").quality_stars).toBe(4);
    expect(row("SELECT quality_stars FROM course_ratings WHERE course_id = 'merged' AND user_id = 'p1'").quality_stars).toBe(4);
  });

  it('retains the legacy body-selected course identity and validation labels', async () => {
    const started = await api.call('/api/courses/url-alias/runs/start', { session: player, body: {
      courseId: 'merged', courseVersion: 1, goal,
    } });
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({ courseId: 'merged', courseVersion: 1 });
    expect(row('SELECT expanded_room_id FROM expanded_room_runs WHERE attempt_id = ?', started.body.attemptId).expanded_room_id).toBe('course:merged');
    const badVersion = await api.call(`${courseUrl}/runs/start`, { session: player, body: { courseVersion: 0, goal } });
    expect(badVersion.status).toBe(400);
    expect(badVersion.body.error).toContain('courseVersion');
  });

  it('promotes a pre-cutover active attempt, preserving its binding and rewarding it once', async () => {
    const started = await start(); removeCanonicalAttempt(started.attemptId); tick();
    expect((await finish(started.attemptId)).status).toBe(204);
    expect(row('SELECT verification_nonce, verification_snapshot_hash, result FROM expanded_room_runs WHERE attempt_id = ?', started.attemptId))
      .toMatchObject({ verification_nonce: started.verificationNonce, verification_snapshot_hash: started.snapshotHash, result: 'completed' });
    expect((await finish(started.attemptId, false)).status).toBe(204);
    expect(awards(started.attemptId)).toBe(1);
    expect((await api.call(expandedBoard)).body.entries[0].attemptId).toBe(started.attemptId);
  });

  it('finishes two concurrent legacy retries once', async () => {
    const started = await start(); removeCanonicalAttempt(started.attemptId); tick();
    const responses = await Promise.all([finish(started.attemptId), finish(started.attemptId)]);
    expect(responses.map(response => response.status)).toEqual([204, 204]);
    expect(awards(started.attemptId)).toBe(1);
    expect(row('SELECT result FROM expanded_room_runs WHERE attempt_id = ?', started.attemptId).result).toBe('completed');
  });

  it('reconciles a legacy Worker that finishes while the canonical request is verifying', async () => {
    const started = await start(); tick();
    const hold = api.holdNextQuery(/UPDATE expanded_room_runs[\s\S]*RETURNING attempt_id/);
    const pending = finish(started.attemptId, false); await hold.held;
    // Models the already-deployed legacy handler winning its course row during rollout.
    api.sqlite.prepare(`UPDATE course_runs SET result = 'completed', finished_at = ?, elapsed_ms = 9000,
      score = 123, verification_status = 'passed', finalize_seq = 1, insight_play_ms = 9000 WHERE attempt_id = ?`)
      .run(new Date().toISOString(), started.attemptId);
    api.sqlite.prepare("INSERT INTO run_settlements VALUES ('course', ?, ?)").run(started.attemptId, new Date().toISOString());
    hold.release(); expect((await pending).status).toBe(204);
    expect(row('SELECT result, score, verification_status FROM expanded_room_runs WHERE attempt_id = ?', started.attemptId))
      .toMatchObject({ result: 'completed', score: 123, verification_status: 'passed' });
    expect((await api.call(expandedBoard)).body.entries[0].score).toBe(123);
    expect(awards(started.attemptId)).toBe(0); // The old handler owns the awards; reconciliation only copies.
    expect((await finish(started.attemptId)).status).toBe(204);
    expect(awards(started.attemptId)).toBe(0);
  });

  it('re-settles an interrupted pre-cutover clear once', async () => {
    const started = await start(); removeCanonicalAttempt(started.attemptId); tick();
    api.sqlite.prepare(`UPDATE course_runs SET result = 'completed', finished_at = ?, elapsed_ms = 9000,
      score = 123, verification_status = 'passed', insight_play_ms = 9000 WHERE attempt_id = ?`)
      .run(new Date().toISOString(), started.attemptId);
    expect((await finish(started.attemptId)).status).toBe(204);
    expect((await finish(started.attemptId, false)).status).toBe(204);
    expect(awards(started.attemptId)).toBe(1);
  });

  it('does not promote an attempt for an unauthenticated caller, another user, or invalid finish body', async () => {
    const started = await start(); removeCanonicalAttempt(started.attemptId); tick();
    expect((await api.call(finishUrl(started.attemptId), { body: finishBody })).status).toBe(401);
    expect((await api.call(finishUrl(started.attemptId), { session: other, body: finishBody })).status).toBe(403);
    expect((await api.call(finishUrl(started.attemptId), { session: player, body: { result: 'nope' } })).status).toBe(400);
    expect(row('SELECT COUNT(*) AS count FROM expanded_room_runs WHERE attempt_id = ?', started.attemptId).count).toBe(0);
    expect(row('SELECT result FROM course_runs WHERE attempt_id = ?', started.attemptId).result).toBe('active');
  });

  it('inherits an old settled finish without granting more XP or points', async () => {
    const started = await start(); tick(); expect((await finish(started.attemptId)).status).toBe(204);
    const before = row("SELECT total_pxp FROM user_progress WHERE user_id = 'p1'").total_pxp;
    removeCanonicalAttempt(started.attemptId);
    api.sqlite.prepare("UPDATE run_settlements SET attempt_kind = 'course' WHERE attempt_kind = 'expanded_room' AND attempt_id = ?").run(started.attemptId);
    expect((await finish(started.attemptId)).status).toBe(204);
    expect(awards(started.attemptId)).toBe(1);
    expect(row("SELECT total_pxp FROM user_progress WHERE user_id = 'p1'").total_pxp).toBe(before);
    expect(row("SELECT COUNT(*) AS count FROM run_settlements WHERE attempt_kind = 'expanded_room' AND attempt_id = ?", started.attemptId).count).toBe(1);
  });

  it('finishes a pinned in-flight attempt after the creator unpublishes the Expanded Room', async () => {
    const started = await start(); removeCanonicalAttempt(started.attemptId);
    expect((await api.call(`${courseUrl}/unpublish`, { method: 'POST', session: builder })).status).toBe(200);
    tick(); expect((await finish(started.attemptId)).status).toBe(204);
    expect((await api.call(courseBoard)).body.entries[0].attemptId).toBe(started.attemptId);
    expect((await api.call('/api/leaderboards/courses/merged')).status).toBe(404);
  });
});

describe('additive convergence backfill', () => {
  it('restores unpublished historical projections and attempts without republishing or duplicating insight data', async () => {
    const started = await start(); tick(); expect((await finish(started.attemptId)).status).toBe(204);
    expect((await api.call(`${courseUrl}/unpublish`, { method: 'POST', session: builder })).status).toBe(200);
    api.sqlite.prepare("UPDATE rooms SET minted_chain_id = 8453 WHERE id = '1,0'").run();
    api.sqlite.prepare("DELETE FROM expanded_rooms WHERE id = 'course:merged'").run();
    api.sqlite.exec(migration);
    expect(row("SELECT published_json FROM expanded_rooms WHERE id = 'course:merged'").published_json).toBeNull();
    expect(row("SELECT COUNT(*) AS count FROM expanded_room_versions WHERE expanded_room_id = 'course:merged'").count).toBe(1);
    expect(row("SELECT COUNT(*) AS count FROM expanded_room_cells WHERE expanded_room_id = 'course:merged'").count).toBe(2);
    expect(row('SELECT result, verification_nonce, finalize_seq FROM expanded_room_runs WHERE attempt_id = ?', started.attemptId))
      .toMatchObject({ result: 'completed', verification_nonce: started.verificationNonce, finalize_seq: null });
    expect(row('SELECT COUNT(*) AS count FROM room_insight_attempts WHERE attempt_key IN (?, ?)', `course:${started.attemptId}`, `expanded:${started.attemptId}`).count).toBe(1);
    expect(row("SELECT protected_minted FROM expanded_room_cells WHERE expanded_room_id = 'course:merged' AND room_id = '1,0'").protected_minted).toBe(1);
    expect(api.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    api.sqlite.exec(migration);
    expect(row("SELECT COUNT(*) AS count FROM expanded_room_cells WHERE expanded_room_id = 'course:merged'").count).toBe(2);
    expect((await finish(started.attemptId)).status).toBe(204);
    expect(awards(started.attemptId)).toBe(1);
  });
  it('preserves existing native data and keeps imported finalization order out of the native sequence', async () => {
    const old = await start(); removeCanonicalAttempt(old.attemptId); tick();
    api.sqlite.prepare(`UPDATE course_runs SET result = 'completed', finished_at = ?, elapsed_ms = 9000,
      verification_status = 'passed', finalize_seq = 1 WHERE attempt_id = ?`).run(new Date().toISOString(), old.attemptId);
    const record = await api.call(courseUrl, { session: builder });
    expect((await api.call(`${courseUrl}/draft`, { method: 'PUT', session: builder, body: { ...record.body.draft, title: 'Second version' } })).status).toBe(200);
    expect((await api.call(`${courseUrl}/publish`, { method: 'POST', session: builder })).status).toBe(200);
    const native = await start(false, 2); tick(); expect((await finish(native.attemptId, false)).status).toBe(204);
    expect(row('SELECT finalize_seq FROM expanded_room_runs WHERE attempt_id = ?', native.attemptId).finalize_seq).toBe(1);
    api.sqlite.prepare("UPDATE expanded_room_versions SET title = 'Native sentinel' WHERE expanded_room_id = 'course:merged' AND version = 2").run();
    api.sqlite.prepare("DELETE FROM expanded_room_versions WHERE expanded_room_id = 'course:merged' AND version = 1").run();
    const nativeBefore = row('SELECT * FROM expanded_room_runs WHERE attempt_id = ?', native.attemptId);
    api.sqlite.exec(migration); api.sqlite.exec(migration);
    expect(row('SELECT * FROM expanded_room_runs WHERE attempt_id = ?', native.attemptId)).toEqual(nativeBefore);
    expect(row("SELECT title FROM expanded_room_versions WHERE expanded_room_id = 'course:merged' AND version = 2").title).toBe('Native sentinel');
    expect(row('SELECT finalize_seq FROM expanded_room_runs WHERE attempt_id = ?', old.attemptId).finalize_seq).toBeNull();
    expect(row("SELECT COUNT(*) AS count FROM expanded_room_versions WHERE expanded_room_id = 'course:merged'").count).toBe(2);
    expect(api.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

});
