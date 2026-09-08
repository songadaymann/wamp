import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../core/types';
import type { RunVerificationTriggerResult } from './verification';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), tier: vi.fn(), verify: vi.fn(), audit: vi.fn(), trigger: vi.fn(),
  room: vi.fn(), course: vi.fn(), body: vi.fn(), rooms: vi.fn(),
}));
vi.mock('../auth/request', async (original) => ({ ...await original<typeof import('../auth/request')>(), requireAuthenticatedRequestAuth: mocks.auth }));
vi.mock('../generatedUsers/leaderboardIsolation', async (original) => ({ ...await original<typeof import('../generatedUsers/leaderboardIsolation')>(), assertWampLeaderboardWriteAllowed: vi.fn() }));
vi.mock('../progression/store', async (original) => ({ ...await original<typeof import('../progression/store')>(), loadEffectiveTrustTier: mocks.tier }));
vi.mock('./verification', async (original) => ({ ...await original<typeof import('./verification')>(), verifyRoomRunTrace: mocks.verify, verifyCourseRunTrace: mocks.verify, createRoomVerificationTrigger: mocks.trigger, createCourseVerificationTrigger: mocks.trigger, recordRunVerificationAudit: mocks.audit }));
vi.mock('../rooms/store', async (original) => ({ ...await original<typeof import('../rooms/store')>(), loadRoomRecord: mocks.room, loadRoomSnapshotsByReferences: mocks.rooms }));
vi.mock('../courses/store', async (original) => ({ ...await original<typeof import('../courses/store')>(), loadPublishedCourse: mocks.course, loadCourseRecord: vi.fn(async () => ({})) }));
vi.mock('../expandedRooms/store', async (original) => ({ ...await original<typeof import('../expandedRooms/store')>(), loadExpandedRoomTarget: vi.fn(async () => ({ legacyCourseId: 'course', expandedRoomId: 'expanded' })) }));
vi.mock('../../../persistence/roomModel', async (original) => ({ ...await original<typeof import('../../../persistence/roomModel')>(), cloneRoomSnapshot: (value: unknown) => value }));
vi.mock('../../../courses/model', async (original) => ({ ...await original<typeof import('../../../courses/model')>(), cloneCourseSnapshot: (value: unknown) => value }));
vi.mock('./requestBodies', async (original) => ({ ...await original<typeof import('./requestBodies')>(), parseRunFinishBody: mocks.body }));
vi.mock('../courses/requestBodies', async (original) => ({ ...await original<typeof import('../courses/requestBodies')>(), parseCourseRunFinishBody: mocks.body }));
vi.mock('./points', async (original) => ({ ...await original<typeof import('./points')>(), getRunMetricCapsForSnapshot: () => ({ maxCollectibles: 100, maxEnemies: 100, maxCheckpoints: 100 }), clampRunMetricsToSnapshot: (_: unknown, metrics: unknown) => metrics, loadBestCompletedRunForUserAndRoomVersion: vi.fn(async () => null), previewRunFinalizePoints: () => ({ points: 1 }) }));
vi.mock('./roomLeaderboardAggregation', async (original) => ({ ...await original<typeof import('./roomLeaderboardAggregation')>(), resolveAggregatedRoomLeaderboardSelection: () => ({ leaderboardFamilyVersions: [1] }) }));
vi.mock('./leaderboards', async (original) => ({ ...await original<typeof import('./leaderboards')>(), loadRankedRoomLeaderboardRows: vi.fn(async () => []), loadViewerRankedRoomLeaderboardRow: vi.fn(async () => null) }));
vi.mock('../courses/leaderboards', async (original) => ({ ...await original<typeof import('../courses/leaderboards')>(), loadRankedCourseLeaderboardRows: vi.fn(async () => []), loadViewerRankedCourseLeaderboardRow: vi.fn(async () => null) }));
vi.mock('../expandedRooms/leaderboards', async (original) => ({ ...await original<typeof import('../expandedRooms/leaderboards')>(), loadRankedExpandedRoomLeaderboardRows: vi.fn(async () => []), loadViewerRankedExpandedRoomLeaderboardRow: vi.fn(async () => null) }));

import { HttpError } from '../core/http';
import { handleRunFinish } from './routes';
import { handleCourseRunFinish } from '../courses/routes';
import { handleExpandedRoomRunFinish } from '../expandedRooms/runRoutes';

const trigger: RunVerificationTriggerResult = {
  required: true, reason: 'point_gain', predictedRank: 1, previousRank: null,
  improvementMs: null, improvementRatio: null, improvementScore: null,
  previousBestElapsedMs: null, previousBestScore: null, pointAwardPotential: true,
};
const goal = { type: 'reach_exit', timeLimitMs: null, exit: null };
const snapshot = { id: 'room', version: 1, goal, roomRefs: [] };
const body = { result: 'completed', elapsedMs: 1000, deaths: 2, collectiblesCollected: 8, enemyCollectiblesCollected: 1, enemiesDefeated: 7, checkpointsReached: 6, verificationTrace: { fixture: true } };
const derivedMetrics = { collectiblesCollected: 3, enemyCollectiblesCollected: 2, enemiesDefeated: 4, checkpointsReached: 5 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-08T12:00:01Z'));
  mocks.auth.mockResolvedValue({ user: { id: 'user', displayName: 'User' }, isAdmin: false });
  mocks.tier.mockResolvedValue('T0');
  mocks.trigger.mockReturnValue(trigger);
  mocks.body.mockResolvedValue({ ...body });
  mocks.room.mockResolvedValue({ published: snapshot });
  mocks.course.mockResolvedValue(snapshot);
  mocks.rooms.mockResolvedValue({ snapshots: [] });
  mocks.verify.mockResolvedValue({ status: 'passed', reason: null, derivedMetrics, summary: { checked: true } });
});
afterEach(() => vi.useRealTimers());

function database() {
  let loaded = false;
  const writes: { sql: string; values: unknown[] }[] = [];
  const batch = vi.fn(async (statements: { sql: string; values: unknown[] }[]) => { writes.push(...statements); return []; });
  const env = { DB: { batch, prepare: (sql: string) => {
    const statement = {
      sql, values: [] as unknown[],
      bind(...values: unknown[]) { statement.values = values; return statement; },
      async first() {
        if (!/WHERE attempt_id = \?/.test(sql) || loaded) return null;
        loaded = true;
        return { attempt_id: 'attempt', room_id: 'room', room_x: 0, room_y: 0, room_version: 1, course_id: 'course', course_version: 1, expanded_room_id: 'expanded', expanded_room_version: 1, legacy_course_attempt_id: 'attempt', goal_json: JSON.stringify(goal), user_id: 'user', user_display_name: 'User', started_at: '2026-09-08T12:00:00Z', result: 'active', verification_nonce: 'nonce', verification_snapshot_hash: 'hash' };
      },
      async all() { return { results: [] }; },
    };
    return statement;
  } } } as unknown as Env;
  return { env, writes, batch };
}

for (const [kind, handler] of [['room', handleRunFinish], ['course', handleCourseRunFinish], ['expanded', handleExpandedRoomRunFinish]] as const) {
  describe(`${kind} finalization verification contract`, () => {
    async function finish() {
      const db = database();
      const error = await handler(new Request('https://example.test/finish'), db.env, 'attempt').catch((failure: unknown) => failure);
      return { ...db, error };
    }
    it.each(['not_required', 'relaxed', 'passed', 'failed', 'missing_trace', 'timeout'] as const)('preserves %s SQL and audit behavior', async (scenario) => {
      if (scenario === 'not_required') mocks.body.mockResolvedValue({ ...body, result: 'abandoned' });
      if (scenario === 'relaxed') mocks.tier.mockResolvedValue('T1');
      if (scenario === 'failed') mocks.verify.mockResolvedValue({ status: 'failed', reason: 'trace_goal', derivedMetrics, summary: { invalid: true } });
      if (scenario === 'missing_trace') mocks.body.mockResolvedValue({ ...body, verificationTrace: null });
      if (scenario === 'timeout') mocks.verify.mockResolvedValue({ status: 'timeout', reason: 'trace_timeout', derivedMetrics, summary: { elapsed: true } });
      const { writes, batch, error } = await finish();
      expect(batch).toHaveBeenCalledTimes(1);
      expect(writes.map(({ sql }) => sql.match(/UPDATE (\w+)/)?.[1])).toEqual(kind === 'expanded' ? ['expanded_room_runs', 'course_runs'] : [`${kind}_runs`]);
      const status = scenario === 'relaxed' ? 'not_required' : scenario === 'missing_trace' ? 'failed' : scenario;
      const reason = scenario === 'failed' ? 'trace_goal' : scenario === 'missing_trace' ? 'missing_trace' : scenario === 'timeout' ? 'trace_timeout' : null;
      for (const write of writes) {
        expect(write.values.slice(8)).toEqual([status, reason, 'attempt']);
        expect(write.values.slice(5, 8)).toEqual(scenario === 'passed' ? [3, 4, 5] : scenario === 'not_required' ? [0, 0, 0] : [8, 7, 6]);
        expect(write.values[0]).toBe('2026-09-08T12:00:01.000Z');
        expect(write.values.slice(2, 4)).toEqual([1000, 2]);
      }
      expect(mocks.verify).toHaveBeenCalledTimes(['not_required', 'relaxed', 'missing_trace'].includes(scenario) ? 0 : 1);
      if (scenario === 'not_required') {
        expect(mocks.tier).not.toHaveBeenCalled();
        expect(mocks.audit).not.toHaveBeenCalled();
      } else {
        expect(batch.mock.invocationCallOrder[0]).toBeLessThan(mocks.audit.mock.invocationCallOrder[0]);
        const audit = mocks.audit.mock.calls[0][1];
        expect(audit).toMatchObject({ kind: kind === 'room' ? 'room' : 'course', attemptId: 'attempt', status: scenario === 'relaxed' ? 'skipped' : status, triggerReason: 'point_gain', verificationReason: reason });
        expect(audit.trace).toEqual(scenario === 'relaxed' || scenario === 'missing_trace' ? null : body.verificationTrace);
        expect(audit.summary).toEqual(scenario === 'relaxed'
          ? { trigger, ...(kind === 'expanded' ? { expandedRoomId: 'expanded' } : {}), policy: 't1_audit_only', trustTier: 'T1', verifier: null }
          : { trigger, verifier: scenario === 'missing_trace' ? { issue: 'missing_trace' } : scenario === 'failed' ? { invalid: true } : scenario === 'timeout' ? { elapsed: true } : { checked: true }, ...(kind === 'expanded' ? { expandedRoomId: 'expanded' } : {}) });
      }
      // The fixture deliberately ends at the post-audit reload for accepted runs.
      expect(error).toBeInstanceOf(HttpError);
      expect(error).toMatchObject({ status: ['failed', 'missing_trace', 'timeout'].includes(scenario) ? 409 : 500 });
    });

    it.each(['untriggered', 'T2'])('skips verification and audits for %s completed runs', async (policy) => {
      if (policy === 'untriggered') mocks.trigger.mockReturnValue({ ...trigger, required: false });
      else mocks.tier.mockResolvedValue('T2');
      const { writes } = await finish();
      expect(writes[0].values.slice(8)).toEqual(['not_required', null, 'attempt']);
      expect(mocks.verify).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    });

    it('retains HttpError classification from verifier or snapshot lookup', async () => {
      mocks.verify.mockRejectedValue(new HttpError(503, 'snapshot unavailable'));
      const { writes, error } = await finish();
      expect(writes[0].values.slice(8)).toEqual(['failed', 'missing_trace', 'attempt']);
      expect(error).toMatchObject({ status: 409 });
      expect(mocks.audit.mock.calls[0][1].summary.verifier).toEqual({ issue: 'missing_trace' });
    });

    it('propagates unexpected verifier errors before persistence', async () => {
      const failure = new Error('unexpected verifier defect');
      mocks.verify.mockRejectedValue(failure);
      const { error, batch } = await finish();
      expect(error).toBe(failure);
      expect(batch).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    });

    it('retains the room-only normalization after verified metric application', async () => {
      const targetGoal = { type: 'collect_target', requiredCount: 5, timeLimitMs: null };
      mocks.room.mockResolvedValue({ published: { ...snapshot, goal: targetGoal } });
      mocks.course.mockResolvedValue({ ...snapshot, goal: targetGoal });
      const { writes, error } = await finish();
      if (kind === 'room') {
        expect(writes).toEqual([]);
        expect(error).toMatchObject({ status: 409, message: 'Completed collect-target runs must meet the published goal.' });
      } else {
        expect(writes[0].values[5]).toBe(3);
        expect(writes[0].values[8]).toBe('passed');
      }
    });
  });
}
