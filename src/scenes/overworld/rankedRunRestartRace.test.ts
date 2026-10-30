import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultCourseSnapshot } from '../../courses/model';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import type { RunRepository } from '../../runs/runRepository';
import { OverworldCoursePlaybackController } from './coursePlayback';
import { OverworldGoalRunController } from './goalRuns';
import { RankedRunTraceRecorder, type RankedRunTraceBinding, type RankedRunTraceFrameInput } from './rankedRunTraceRecorder';

const { expandedStart, expandedFinish } = vi.hoisted(() => ({
  expandedStart: vi.fn(), expandedFinish: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../auth/client', () => ({ getAuthDebugState: () => ({ authenticated: true, source: 'session', user: { displayName: 'Builder' } }) }));
vi.mock('../../courses/courseRepository', () => ({ createCourseRepository: () => ({ startRun: vi.fn(), finishRun: vi.fn(), loadCourseLeaderboard: vi.fn().mockResolvedValue(null) }), isCourseApiError: () => false }));
vi.mock('../../expandedRooms/repository', () => ({ createExpandedRoomRepository: () => ({ startRun: expandedStart, finishRun: expandedFinish, loadExpandedRoomLeaderboard: vi.fn().mockResolvedValue(null) }), isExpandedRoomApiError: () => false }));
vi.mock('../../persistence/roomRepository', () => ({ createRoomRepository: () => ({}) }));
vi.mock('../../progression/postRunRatingEvents', () => ({ requestPostRunGuestClaim: vi.fn(), requestPostRunRating: vi.fn() }));
vi.mock('../../progression/rewardStings', async importOriginal => ({
  ...await importOriginal<typeof import('../../progression/rewardStings')>(), notifyRewardStings: vi.fn(),
}));

type StartReply = RankedRunTraceBinding & { attemptId: string; userDisplayName: string; verificationSchemaVersion: number };
const startFrame: RankedRunTraceFrameInput = { roomCoordinates: { x: 0, y: 0 }, x: 64, y: 256,
  vx: 0, vy: 0, grounded: true, horizontalInput: 0, verticalInput: 0, jumpPressed: false };
const reply = (id: string): StartReply => ({ attemptId: id, userDisplayName: 'Builder', verificationSchemaVersion: 1,
  verificationNonce: `nonce-${id}`, snapshotHash: 'published-snapshot' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function settle() { for (let i = 0; i < 12; i += 1) await Promise.resolve(); }
afterEach(() => vi.clearAllMocks());

/** The scene's own wiring: prepare on start, bind (or start) on the signed reply. */
function sceneRecorder(recorder: RankedRunTraceRecorder) {
  return {
    onRankedRunPreparing: (kind: 'room' | 'course') => recorder.prepare(kind, startFrame),
    onRankedRunStarted: (binding: RankedRunTraceBinding & { kind: 'room' | 'course' }) => {
      if (!recorder.bindPrepared(binding.kind, binding)) recorder.start(binding.kind, binding, startFrame);
    },
    clearVerificationTrace: () => recorder.clear(),
  };
}

describe('ranked traces across a quick restart (F055)', () => {
  const survivalRoom = { ...createDefaultRoomSnapshot(), status: 'published' as const, spawnPoint: { x: 64, y: 256 },
    goal: { type: 'survival' as const, durationMs: 2_000, timeLimitMs: null } };

  function roomHarness() {
    const recorder = new RankedRunTraceRecorder();
    const starts = { A: deferred<StartReply>(), B: deferred<StartReply>() };
    const finishA = deferred<void>();
    const startRun = vi.fn().mockReturnValueOnce(starts.A.promise).mockReturnValueOnce(starts.B.promise);
    const finishRun = vi.fn((attemptId: string, _body?: unknown) => attemptId === 'A' ? finishA.promise : Promise.resolve());
    const goals = new OverworldGoalRunController({ playerHeight: 14,
      runRepository: { startRun, finishRun, loadRoomLeaderboard: vi.fn().mockResolvedValue(null),
        loadGlobalLeaderboard: vi.fn().mockResolvedValue(null) } as unknown as RunRepository,
      getScore: () => 0, getAuthenticated: () => true, getAuthSource: () => 'session', getAuthDisplayName: () => 'Builder',
      countRoomObjectsByCategory: () => 0,
      buildVerificationTrace: (state) => recorder.buildTrace(state.elapsedMs),
      ...sceneRecorder(recorder),
    });
    return { recorder, starts, finishA, finishRun, goals };
  }

  it('keeps run B\'s trace when failed run A\'s finish lands after the survival restart', async () => {
    const h = roomHarness();
    h.goals.syncRunForRoom(survivalRoom, 'spawn');
    h.starts.A.resolve(reply('A')); await settle();
    h.goals.getCurrentRun()!.elapsedMs = 500; h.goals.markFailed('Survival failed.'); await settle();
    h.goals.restartRunForRoom(survivalRoom, 'spawn');
    h.starts.B.resolve(reply('B')); await settle();
    h.finishA.resolve(); await settle(); // A's late reply
    expect(h.recorder.isActive('room')).toBe(true);
    h.goals.getCurrentRun()!.elapsedMs = 2_100; h.goals.tick(0); await settle();
    const finishB = h.finishRun.mock.calls.find(([attemptId]) => attemptId === 'B');
    expect(finishB?.[1]).toMatchObject({ result: 'completed', verificationTrace: { verificationNonce: 'nonce-B' } });
  });

  it('does not bind run A\'s late start reply to run B\'s trace', async () => {
    const h = roomHarness();
    h.goals.syncRunForRoom(survivalRoom, 'spawn');
    h.goals.restartRunForRoom(survivalRoom, 'spawn'); // before A's start reply arrives
    h.recorder.recordFrame(1_000, { ...startFrame, x: 200 }); // B is already moving
    h.starts.A.resolve(reply('A')); await settle();
    h.starts.B.resolve(reply('B')); await settle();
    expect(h.goals.getCurrentRun()?.attemptId).toBe('B');
    const trace = h.recorder.buildTrace(1_000)!;
    expect(trace.verificationNonce).toBe('nonce-B');
    expect(trace.breadcrumbs.map((crumb) => crumb.x)).toEqual([64, 200]);
  });

  it('does not attach an old start reply to a restarted run of the same Expanded Room', async () => {
    const recorder = new RankedRunTraceRecorder();
    const starts = { A: deferred<StartReply>(), B: deferred<StartReply>() };
    expandedStart.mockReturnValueOnce(starts.A.promise).mockReturnValueOnce(starts.B.promise);
    const course = { ...createDefaultCourseSnapshot('restart'), version: 1, status: 'published' as const,
      roomRefs: [{ roomId: '0,0', coordinates: { x: 0, y: 0 }, roomVersion: 1, roomTitle: null }],
      goal: { type: 'reach_exit' as const, exit: { roomId: '0,0', x: 96, y: 256 }, timeLimitMs: null } };
    let run: ReturnType<OverworldCoursePlaybackController['createCourseRunState']>;
    const controller: OverworldCoursePlaybackController = new OverworldCoursePlaybackController({
      getActiveCourseRun: () => run, getSelectedCoordinates: () => ({ x: 0, y: 0 }),
      getRoomSnapshotForCoordinates: () => createDefaultRoomSnapshot(), countRoomObjectsByCategory: () => 0,
      setActiveCourseRun: vi.fn(), clearTransientRoomOverrides: vi.fn(),
      setTransientRoomOverrides: vi.fn(), showTransientStatus: vi.fn(), renderHud: vi.fn(),
      buildVerificationTrace: (state) => recorder.buildTrace(state.elapsedMs), ...sceneRecorder(recorder),
    });
    run = controller.createCourseRunState(course); run.expandedRoomId = 'native-expanded'; run.expandedRoomVersion = 1;
    controller.startRunAfterSpawn();
    const runA = run;
    run = controller.createCourseRunState(course); run.expandedRoomId = 'native-expanded'; run.expandedRoomVersion = 1;
    controller.startRunAfterSpawn();
    recorder.recordFrame(1_000, { ...startFrame, x: 200 });
    starts.A.resolve(reply('A')); await settle();
    expect(run.attemptId).toBeNull();
    expect(runA.attemptId).toBeNull();
    starts.B.resolve(reply('B')); await settle();
    expect(run.attemptId).toBe('B');
    const trace = recorder.buildTrace(1_000)!;
    expect(trace.verificationNonce).toBe('nonce-B');
    expect(trace.breadcrumbs.map((crumb) => crumb.x)).toEqual([64, 200]);
  });
});
