import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultCourseSnapshot } from '../../courses/model';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import type { RunRepository } from '../../runs/runRepository';
import { OverworldCoursePlaybackController } from './coursePlayback';
import { OverworldGoalRunController } from './goalRuns';
import { RankedRunTraceRecorder, type RankedRunTraceFrameInput } from './rankedRunTraceRecorder';
import { subscribeGhostBestUpdates } from '../../runs/ghostRepository';

const { courseStart, expandedStart, courseFinish, expandedFinish } = vi.hoisted(() => ({
  courseStart: vi.fn(), expandedStart: vi.fn(), courseFinish: vi.fn().mockResolvedValue(undefined), expandedFinish: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../auth/client', () => ({ getAuthDebugState: () => ({ authenticated: true, source: 'session', user: { displayName: 'Builder' } }) }));
vi.mock('../../courses/courseRepository', () => ({ createCourseRepository: () => ({ startRun: courseStart, finishRun: courseFinish, loadCourseLeaderboard: vi.fn().mockResolvedValue(null) }), isCourseApiError: () => false }));
vi.mock('../../expandedRooms/repository', () => ({ createExpandedRoomRepository: () => ({ startRun: expandedStart, finishRun: expandedFinish, loadExpandedRoomLeaderboard: vi.fn().mockResolvedValue(null) }), isExpandedRoomApiError: () => false }));
vi.mock('../../persistence/roomRepository', () => ({ createRoomRepository: () => ({}) }));
vi.mock('../../progression/postRunRatingEvents', () => ({ requestPostRunGuestClaim: vi.fn(), requestPostRunRating: vi.fn() }));
vi.mock('../../progression/rewardStings', async importOriginal => ({
  ...await importOriginal<typeof import('../../progression/rewardStings')>(), notifyRewardStings: vi.fn(),
}));

const binding = { verificationSchemaVersion: 1, verificationNonce: 'signed-binding', snapshotHash: 'published-snapshot' };
const startFrame: RankedRunTraceFrameInput = { roomCoordinates: { x: 0, y: 0 }, x: 64, y: 256,
  vx: 0, vy: 0, grounded: true, horizontalInput: 0, verticalInput: 0, jumpPressed: false };
function deferred() {
  let resolve!: (value: typeof binding & { attemptId: string; userDisplayName: string }) => void;
  const promise = new Promise<typeof binding & { attemptId: string; userDisplayName: string }>(done => { resolve = done; });
  return { promise, resolve };
}
function touchAndDie(recorder: RankedRunTraceRecorder) {
  recorder.recordFrame(1000, { ...startFrame, x: 320 });
  recorder.recordGoalEvent({ type: 'respawn_checkpoint', actor: 'player', roomId: '0,0', roomX: 0, roomY: 0,
    x: 320, y: 256, instanceId: 'flag', checkpointIndex: null });
  recorder.recordFrame(500, { ...startFrame, x: 416 });
  recorder.recordDeath({ ...startFrame, x: 424, y: 280 });
  recorder.recordRespawn({ ...startFrame, x: 320 }, { kind: 'object', instanceId: 'flag', checkpointIndex: null });
}
function expectRetained(recorder: RankedRunTraceRecorder) {
  const trace = recorder.buildTrace(1500)!;
  expect(trace.verificationNonce).toBe(binding.verificationNonce);
  expect(trace.snapshotHash).toBe(binding.snapshotHash);
  expect(trace.breadcrumbs[0]).toMatchObject({ atMs: 0, x: 64 });
  expect(trace.goalEvents).toHaveLength(1);
  expect(trace.respawnEvents?.[0]).toMatchObject({ atMs: 1500, instanceId: 'flag', goalEventCount: 1 });
  expect(trace.deathEvents).toHaveLength(1);
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
afterEach(() => vi.clearAllMocks());

describe('ranked trace capture while the start request is pending', () => {
  it.each([true, false])('keeps a co-op room practice for authenticated=%s without a ranked or guest receipt', async authenticated => {
    const startRun = vi.fn(), finishRun = vi.fn(), begin = vi.fn();
    const goals = new OverworldGoalRunController({ playerHeight: 14,
      runRepository: { startRun, finishRun, loadRoomLeaderboard: vi.fn().mockResolvedValue(null),
        loadGlobalLeaderboard: vi.fn().mockResolvedValue(null) } as unknown as RunRepository,
      getScore: () => 0, getAuthenticated: () => authenticated, getAuthSource: () => 'session', getAuthDisplayName: () => 'Builder',
      countRoomObjectsByCategory: () => 0, guestRuns: { begin, has: () => false } as never,
    });
    const room = { ...createDefaultRoomSnapshot(), status: 'published' as const, spawnPoint: { x: 64, y: 256 },
      goal: { type: 'reach_exit' as const, exit: { x: 96, y: 256 }, timeLimitMs: null },
      placedObjects: [{ id: 'floor_trigger', x: 88, y: 248, instanceId: 'plate', coopPlate: true }] };
    goals.syncRunForRoom(room, 'spawn'); await settle();
    expect(goals.getCurrentRun()).toMatchObject({ cooperative: true, leaderboardEligible: false, submissionState: 'local-only' });
    expect(goals.getCurrentRun()?.submissionMessage).toMatch(/Co-op practice/);
    goals.getCurrentRun()!.elapsedMs = 1000; goals.markCompleted('Done'); await settle();
    expect(startRun).not.toHaveBeenCalled(); expect(finishRun).not.toHaveBeenCalled(); expect(begin).not.toHaveBeenCalled();
  });

  it('keeps the entire Expanded Room practice when a different pinned cell has a co-op plate', () => {
    const course = { ...createDefaultCourseSnapshot('coop'), version: 1, status: 'published' as const,
      startPoint: { roomId: '0,0', x: 64, y: 256 },
      roomRefs: [0, 1].map(x => ({ roomId: `${x},0`, coordinates: { x, y: 0 }, roomVersion: 1, roomTitle: null })),
      goal: { type: 'reach_exit' as const, exit: { roomId: '1,0', x: 500, y: 256 }, timeLimitMs: null } };
    const controller: OverworldCoursePlaybackController = new OverworldCoursePlaybackController({
      getActiveCourseRun: () => run, getSelectedCoordinates: () => ({ x: 0, y: 0 }),
      getRoomSnapshotForCoordinates: coordinates => ({ ...createDefaultRoomSnapshot(), placedObjects: coordinates.x === 1
        ? [{ id: 'floor_trigger', instanceId: 'plate', x: 88, y: 248, coopPlate: true }] : [] }),
      countRoomObjectsByCategory: () => 0, setActiveCourseRun: vi.fn(), clearTransientRoomOverride: vi.fn(),
      clearTransientRoomOverrides: vi.fn(), setTransientRoomOverride: vi.fn(), setTransientRoomOverrides: vi.fn(),
      showTransientStatus: vi.fn(), renderHud: vi.fn(),
    });
    const run = controller.createCourseRunState(course);
    controller.startRunAfterSpawn();
    expect(run).toMatchObject({ cooperative: true, leaderboardEligible: false, submissionState: 'local-only' });
    expect(run.submissionMessage).toMatch(/Co-op practice/);
    expect(courseStart).not.toHaveBeenCalled(); expect(expandedStart).not.toHaveBeenCalled();
  });

  it('submits a clear immediately and refreshes ghost choices even while the prior leaderboard read is slow', async () => {
    let resolveBoard!: (value: null) => void;
    const slowBoard = new Promise<null>(resolve => { resolveBoard = resolve; });
    const board = vi.fn().mockResolvedValue(null), finish = vi.fn().mockResolvedValue(undefined);
    const goals = new OverworldGoalRunController({ playerHeight: 14,
      runRepository: { startRun: vi.fn().mockResolvedValue({ ...binding, attemptId: 'finish-now', userDisplayName: 'Builder' }),
        finishRun: finish, loadRoomLeaderboard: board, loadGlobalLeaderboard: vi.fn().mockResolvedValue(null) } as unknown as RunRepository,
      getScore: () => 0, getAuthenticated: () => true, getAuthSource: () => 'session', getAuthDisplayName: () => 'Builder',
      countRoomObjectsByCategory: () => 0, buildVerificationTrace: () => ({ schemaVersion: 1, verificationNonce: 'signed-binding',
        snapshotHash: 'published-snapshot', traceDurationMs: 1000, inputEvents: [], breadcrumbs: [], roomTransitions: [], goalEvents: [] }),
    });
    const room = { ...createDefaultRoomSnapshot(), status: 'published' as const, spawnPoint: { x: 64, y: 256 },
      goal: { type: 'reach_exit' as const, exit: { x: 96, y: 256 }, timeLimitMs: null } };
    goals.syncRunForRoom(room, 'spawn'); await settle();
    board.mockReturnValue(slowBoard);
    const refreshed = vi.fn(), unsubscribe = subscribeGhostBestUpdates(room.id, refreshed);
    try {
      goals.getCurrentRun()!.elapsedMs = 1000; goals.markCompleted('Done');
      expect(finish).toHaveBeenCalledTimes(1); await settle();
      expect(refreshed).toHaveBeenCalledTimes(1);
      expect(goals.getCurrentRun()?.submissionState).toBe('submitted');
    } finally { unsubscribe(); resolveBoard(null); await settle(); }
  });
  it('retains an ordinary room checkpoint and death before the signed binding arrives', async () => {
    const pending = deferred(); const recorder = new RankedRunTraceRecorder();
    const startRun = vi.fn(() => pending.promise);
    const goals = new OverworldGoalRunController({ playerHeight: 14,
      runRepository: { startRun, loadRoomLeaderboard: vi.fn().mockResolvedValue(null),
        loadGlobalLeaderboard: vi.fn().mockResolvedValue(null) } as unknown as RunRepository,
      getScore: () => 0, getAuthenticated: () => true, getAuthSource: () => 'session',
      getAuthDisplayName: () => 'Builder', countRoomObjectsByCategory: () => 0,
      onRankedRunPreparing: kind => recorder.prepare(kind, startFrame),
      onRankedRunStarted: response => { expect(recorder.bindPrepared(response.kind, response)).toBe(true); },
    });
    const room = { ...createDefaultRoomSnapshot(), status: 'published' as const, spawnPoint: { x: 64, y: 256 },
      goal: { type: 'reach_exit' as const, exit: { x: 96, y: 256 }, timeLimitMs: null } };
    goals.syncRunForRoom(room, 'spawn');
    expect(startRun).toHaveBeenCalledTimes(1); touchAndDie(recorder);
    pending.resolve({ ...binding, attemptId: 'attempt', userDisplayName: 'Builder' }); await settle();
    expectRetained(recorder);
  });

  it.each([null, 'native-expanded'])('starts %s once after spawn and retains early checkpoint events', async expandedRoomId => {
    const pending = deferred(); const recorder = new RankedRunTraceRecorder();
    courseStart.mockReturnValue(pending.promise); expandedStart.mockReturnValue(pending.promise);
    const course = { ...createDefaultCourseSnapshot('test'), version: 1, status: 'published' as const,
      startPoint: { roomId: '0,0', x: 64, y: 256 },
      roomRefs: [{ roomId: '0,0', coordinates: { x: 0, y: 0 }, roomVersion: 1, roomTitle: null }],
      goal: { type: 'reach_exit' as const, exit: { roomId: '0,0', x: 96, y: 256 }, timeLimitMs: null } };
    const controller: OverworldCoursePlaybackController = new OverworldCoursePlaybackController({ getSelectedCoordinates: () => ({ x: 0, y: 0 }),
      getActiveCourseRun: () => run, getRoomSnapshotForCoordinates: () => createDefaultRoomSnapshot(),
      countRoomObjectsByCategory: () => 0, renderHud: vi.fn(),
      setActiveCourseRun: vi.fn(), clearTransientRoomOverride: vi.fn(), clearTransientRoomOverrides: vi.fn(),
      setTransientRoomOverride: vi.fn(), setTransientRoomOverrides: vi.fn(), showTransientStatus: vi.fn(),
      onRankedRunPreparing: kind => recorder.prepare(kind, startFrame),
      onRankedRunStarted: response => { expect(recorder.bindPrepared(response.kind, response)).toBe(true); },
    });
    const run = controller.createCourseRunState(course); run.expandedRoomId = expandedRoomId;
    run.expandedRoomVersion = expandedRoomId ? 1 : null;
    controller.startRunAfterSpawn(); controller.startRunAfterSpawn();
    expect(courseStart.mock.calls.length + expandedStart.mock.calls.length).toBe(1);
    touchAndDie(recorder);
    pending.resolve({ ...binding, attemptId: 'attempt', userDisplayName: 'Builder' }); await settle();
    expectRetained(recorder); controller.startRunAfterSpawn();
    expect(courseStart.mock.calls.length + expandedStart.mock.calls.length).toBe(1);
  });

  it('does not bind a reply to a cleared trace or a different kind, and fresh preparation drops old touches', () => {
    const recorder = new RankedRunTraceRecorder(); recorder.prepare('room', startFrame); touchAndDie(recorder);
    expect(recorder.bindPrepared('course', binding)).toBe(false);
    recorder.clear(); expect(recorder.bindPrepared('room', binding)).toBe(false);
    recorder.prepare('room', startFrame); expect(recorder.bindPrepared('room', binding)).toBe(true);
    expect(recorder.buildTrace(0)?.goalEvents).toHaveLength(0);
    expect(recorder.buildTrace(0)?.respawnEvents).toBeUndefined();
    expect(recorder.bindPrepared('room', { ...binding, verificationNonce: 'other' })).toBe(false);
  });

  it.each([null, 'native-expanded'])('submits a completed %s checkpoint run even before the start reply arrives', async expandedRoomId => {
    const pending = deferred(); const recorder = new RankedRunTraceRecorder(); const onStarted = vi.fn();
    courseStart.mockReturnValue(pending.promise); expandedStart.mockReturnValue(pending.promise);
    const course = { ...createDefaultCourseSnapshot('early-finish'), version: 1, status: 'published' as const,
      roomRefs: [{ roomId: '0,0', coordinates: { x: 0, y: 0 }, roomVersion: 1, roomTitle: null }],
      goal: { type: 'reach_exit' as const, exit: { roomId: '0,0', x: 96, y: 256 }, timeLimitMs: null } };
    const controller: OverworldCoursePlaybackController = new OverworldCoursePlaybackController({
      getActiveCourseRun: () => run, getSelectedCoordinates: () => ({ x: 0, y: 0 }),
      getRoomSnapshotForCoordinates: () => createDefaultRoomSnapshot(), countRoomObjectsByCategory: () => 0,
      setActiveCourseRun: vi.fn(), clearTransientRoomOverride: vi.fn(), clearTransientRoomOverrides: vi.fn(),
      setTransientRoomOverride: vi.fn(), setTransientRoomOverrides: vi.fn(), showTransientStatus: vi.fn(), renderHud: vi.fn(),
      onRankedRunPreparing: kind => recorder.prepare(kind, startFrame), onRankedRunStarted: onStarted,
      buildVerificationTrace: state => recorder.buildTrace(state.elapsedMs), clearVerificationTrace: () => recorder.clear(),
    });
    const run = controller.createCourseRunState(course); run.expandedRoomId = expandedRoomId; run.expandedRoomVersion = expandedRoomId ? 1 : null;
    controller.startRunAfterSpawn(); touchAndDie(recorder); run.elapsedMs = 1500; run.deaths = 1; run.result = 'completed';
    await controller.finalizeActiveCourseRun('completed');
    expect(courseFinish).not.toHaveBeenCalled(); expect(expandedFinish).not.toHaveBeenCalled(); expect(recorder.isActive()).toBe(false);
    pending.resolve({ ...binding, attemptId: 'early-attempt', userDisplayName: 'Builder' });
    await vi.waitFor(() => expect(expandedRoomId ? expandedFinish : courseFinish).toHaveBeenCalledTimes(1));
    const [attemptId, body] = (expandedRoomId ? expandedFinish : courseFinish).mock.calls[0];
    expect(attemptId).toBe('early-attempt'); expect(body.result).toBe('completed'); expect(body.deaths).toBe(1);
    expect(body.verificationTrace).toMatchObject({ verificationNonce: binding.verificationNonce,
      snapshotHash: binding.snapshotHash, schemaVersion: 1, traceDurationMs: 1500 });
    expect(body.verificationTrace.respawnEvents).toHaveLength(1); expect(body.verificationTrace.goalEvents).toHaveLength(1);
    expect(onStarted).not.toHaveBeenCalled(); expect(run.submissionState).toBe('submitted');
  });
});
