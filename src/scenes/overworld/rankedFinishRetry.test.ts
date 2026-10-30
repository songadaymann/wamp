import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultCourseSnapshot } from '../../courses/model';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import type { RunFinishRequestBody } from '../../runs/model';
import type { RunRepository } from '../../runs/runRepository';
import { OverworldCoursePlaybackController } from './coursePlayback';
import { OverworldGoalRunController } from './goalRuns';

const { expandedStart, expandedFinish, rewards } = vi.hoisted(() => ({
  expandedStart: vi.fn(), expandedFinish: vi.fn(), rewards: vi.fn(),
}));
vi.mock('../../auth/client', () => ({ getAuthDebugState: () => ({ authenticated: true, source: 'session', user: { displayName: 'Builder' } }) }));
vi.mock('../../courses/courseRepository', () => ({ createCourseRepository: () => ({ startRun: vi.fn(), finishRun: vi.fn(), loadCourseLeaderboard: vi.fn().mockResolvedValue(null) }), isCourseApiError: () => false }));
vi.mock('../../expandedRooms/repository', () => ({ createExpandedRoomRepository: () => ({ startRun: expandedStart, finishRun: expandedFinish, loadExpandedRoomLeaderboard: vi.fn().mockResolvedValue(null) }), isExpandedRoomApiError: () => false }));
vi.mock('../../persistence/roomRepository', () => ({ createRoomRepository: () => ({}) }));
vi.mock('../../progression/postRunRatingEvents', () => ({ requestPostRunGuestClaim: vi.fn(), requestPostRunRating: vi.fn() }));
vi.mock('../../progression/rewardStings', async importOriginal => ({
  ...await importOriginal<typeof import('../../progression/rewardStings')>(), notifyRewardStings: rewards,
}));
vi.mock('../../runs/ghostRepository', () => ({ notifyGhostBestUpdated: vi.fn() }));

class ApiFailure extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const start = { attemptId: 'attempt-1', userDisplayName: 'Builder', verificationSchemaVersion: 1,
  verificationNonce: 'nonce-1', snapshotHash: 'hash-1' };
const trace = { schemaVersion: 1, verificationNonce: 'nonce-1', snapshotHash: 'hash-1', traceDurationMs: 2_000,
  inputEvents: [], breadcrumbs: [], roomTransitions: [], goalEvents: [], deathEvents: [] };
async function settle() { for (let i = 0; i < 12; i += 1) await Promise.resolve(); }

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('signed-in room clear retry (F351)', () => {
  const survivalRoom = { ...createDefaultRoomSnapshot(), status: 'published' as const, spawnPoint: { x: 64, y: 256 },
    goal: { type: 'survival' as const, durationMs: 2_000, timeLimitMs: null } };

  function harness(finishRun: RunRepository['finishRun']) {
    const clearVerificationTrace = vi.fn();
    const buildVerificationTrace = vi.fn(() => structuredClone(trace));
    const goals = new OverworldGoalRunController({ playerHeight: 14,
      runRepository: { startRun: vi.fn().mockResolvedValue(start), finishRun,
        loadRoomLeaderboard: vi.fn().mockResolvedValue(null), loadGlobalLeaderboard: vi.fn() } as unknown as RunRepository,
      getScore: () => 0, getAuthenticated: () => true, getAuthSource: () => 'session', getAuthDisplayName: () => 'Builder',
      countRoomObjectsByCategory: () => 0, buildVerificationTrace, clearVerificationTrace, showTransientStatus: vi.fn() });
    return { goals, clearVerificationTrace, buildVerificationTrace };
  }
  async function clearRoom(h: ReturnType<typeof harness>) {
    h.goals.syncRunForRoom(survivalRoom, 'spawn');
    await settle();
    const run = h.goals.getCurrentRun()!;
    run.elapsedMs = 2_100;
    h.goals.tick(0);
    await settle();
    return run;
  }

  it('keeps the clear after a dropped reply and resends the same payload', async () => {
    const finishRun = vi.fn<RunRepository['finishRun']>()
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValueOnce(undefined);
    const h = harness(finishRun);
    const run = await clearRoom(h);
    expect(run).toMatchObject({ submissionState: 'finishing', finishRetry: 'waiting',
      submissionMessage: 'Saving your clear... connection lost, will retry.' });
    expect(run.submissionMessage).not.toContain('Load failed');
    // The payload already holds the trace; the recorder is released without waiting for the server.
    expect(h.clearVerificationTrace).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(finishRun).toHaveBeenCalledTimes(2);
    const [first, second] = finishRun.mock.calls as [string, RunFinishRequestBody][];
    expect(second[0]).toBe('attempt-1');
    expect(second[1]).toBe(first[1]);
    expect(second[1]).toMatchObject({ result: 'completed', verificationTrace: { verificationNonce: 'nonce-1' } });
    expect(h.buildVerificationTrace).toHaveBeenCalledTimes(1);
    expect(run).toMatchObject({ submissionState: 'submitted', finishRetry: null, pendingResult: null });
    expect(rewards).toHaveBeenCalled();
  });

  it('keeps retrying a clear in the background after the player restarts', async () => {
    const finishRun = vi.fn<RunRepository['finishRun']>()
      .mockRejectedValueOnce(new ApiFailure(503, 'Service unavailable'))
      .mockResolvedValue(undefined);
    const h = harness(finishRun);
    const cleared = await clearRoom(h);
    h.goals.restartRunForRoom(survivalRoom, 'spawn');
    await settle();
    h.clearVerificationTrace.mockClear();
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(finishRun).toHaveBeenCalledTimes(2);
    expect(cleared.submissionState).toBe('submitted');
    // The finished run's reply must not reset the restarted run's recorder.
    expect(h.clearVerificationTrace).not.toHaveBeenCalled();
  });

  it('does not retry a verification 409 and shows the server\'s reason', async () => {
    const finishRun = vi.fn<RunRepository['finishRun']>()
      .mockRejectedValue(new ApiFailure(409, 'Ranked run could not be verified.'));
    const h = harness(finishRun);
    const run = await clearRoom(h);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(finishRun).toHaveBeenCalledTimes(1);
    expect(run).toMatchObject({ submissionState: 'error', finishRetry: null,
      submissionMessage: 'Ranked clear not recorded: Ranked run could not be verified.' });
  });
});

describe('signed-in expanded room clear retry (F351)', () => {
  it('resends an expanded room finish after a timeout and keeps the HUD current', async () => {
    expandedStart.mockResolvedValue(start);
    expandedFinish.mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError')).mockResolvedValueOnce(undefined);
    const course = { ...createDefaultCourseSnapshot('retry'), version: 1, status: 'published' as const,
      roomRefs: [{ roomId: '0,0', coordinates: { x: 0, y: 0 }, roomVersion: 1, roomTitle: null }],
      goal: { type: 'reach_exit' as const, exit: { roomId: '0,0', x: 96, y: 256 }, timeLimitMs: null } };
    let run: ReturnType<OverworldCoursePlaybackController['createCourseRunState']>;
    const renderHud = vi.fn();
    const clearVerificationTrace = vi.fn();
    const controller: OverworldCoursePlaybackController = new OverworldCoursePlaybackController({
      getActiveCourseRun: () => run, getSelectedCoordinates: () => ({ x: 0, y: 0 }),
      getRoomSnapshotForCoordinates: () => createDefaultRoomSnapshot(), countRoomObjectsByCategory: () => 0,
      setActiveCourseRun: vi.fn(), clearTransientRoomOverrides: vi.fn(),
      setTransientRoomOverrides: vi.fn(), showTransientStatus: vi.fn(), renderHud,
      buildVerificationTrace: () => structuredClone(trace), clearVerificationTrace,
    });
    run = controller.createCourseRunState(course); run.expandedRoomId = 'expanded'; run.expandedRoomVersion = 1;
    controller.startRunAfterSpawn();
    await settle();
    expect(run.attemptId).toBe('attempt-1');

    const finished = controller.finalizeActiveCourseRun('completed');
    await settle();
    expect(run).toMatchObject({ submissionState: 'finishing', finishRetry: 'waiting' });
    expect(renderHud).toHaveBeenCalled();
    expect(clearVerificationTrace).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    await finished;
    expect(expandedFinish).toHaveBeenCalledTimes(2);
    expect(expandedFinish.mock.calls[1][1]).toBe(expandedFinish.mock.calls[0][1]);
    expect(run).toMatchObject({ submissionState: 'submitted', finishRetry: null });
  });
});
