import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import { createDefaultCourseSnapshot } from '../../courses/model';
import { GuestRunService } from '../../guestRooms/runService';
import { GuestRunFinishQueue } from '../../guestRooms/runFinishQueue';
import type { GuestRunRepository } from '../../guestRooms/runRepository';
import type { GuestRunStartBody, GuestRunStartResponse } from '../../guestRooms/runModel';
import type { RunRepository } from '../../runs/runRepository';
import { OverworldGoalRunController } from './goalRuns';
import { OverworldCoursePlaybackController } from './coursePlayback';
import { GuestRunPlaybackController } from './guestRunPlayback';
import { RankedRunTraceRecorder, type RankedRunTraceFrameInput } from './rankedRunTraceRecorder';
import type { ActiveCourseRunState } from './courseRuns';

const { requestPostRunGuestClaim, requestPostRunRating, notifyRewardStings, auth } = vi.hoisted(() => ({
  requestPostRunGuestClaim: vi.fn(), requestPostRunRating: vi.fn(), notifyRewardStings: vi.fn(),
  auth: { authenticated: false, source: 'email', user: { displayName: 'Player' } },
}));
vi.mock('../../auth/client', () => ({ getAuthDebugState: () => auth }));
vi.mock('../../presence/worldPresence', () => ({ resolveWorldPresenceGuestIdentity: () => ({ userId: 'guest-test' }) }));
vi.mock('../../progression/postRunRatingEvents', () => ({ requestPostRunGuestClaim, requestPostRunRating }));
vi.mock('../../progression/rewardStings', async importOriginal => ({
  ...await importOriginal<typeof import('../../progression/rewardStings')>(), notifyRewardStings,
}));
vi.mock('../../courses/courseRepository', () => ({ createCourseRepository: () => ({}), isCourseApiError: () => false }));
vi.mock('../../expandedRooms/repository', () => ({ createExpandedRoomRepository: () => ({}), isExpandedRoomApiError: () => false }));
vi.mock('../../persistence/roomRepository', () => ({ createRoomRepository: () => ({}) }));
vi.mock('../../courses/draftSession', () => ({ getActiveCourseDraftSessionRoomOverrides: () => [] }));
afterEach(() => { vi.clearAllMocks(); auth.authenticated = false; });

const frame: RankedRunTraceFrameInput = { roomCoordinates: { x: 0, y: 0 }, x: 64, y: 128,
  vx: 0, vy: 0, grounded: true, horizontalInput: 0, verticalInput: 0, jumpPressed: false };
function startResponse(body: GuestRunStartBody): GuestRunStartResponse {
  return { ...body, attemptId: crypto.randomUUID(), startedAt: new Date().toISOString(),
    verificationSchemaVersion: 1, verificationNonce: 'server-nonce', snapshotHash: 'server-hash' };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const room = () => ({ ...createDefaultRoomSnapshot('0,0', { x: 0, y: 0 }), status: 'published' as const,
  spawnPoint: { x: 64, y: 128 }, goal: { type: 'reach_exit' as const, exit: { x: 144, y: 128 }, timeLimitMs: null } });

function harness() {
  const repo: GuestRunRepository = {
    start: vi.fn(async body => startResponse(body)), findStart: vi.fn(),
    finish: vi.fn(async attemptId => ({ attemptId, result: 'completed' as const, verificationStatus: 'passed' as const,
      saved: true, verificationReason: null })), listPending: vi.fn(), claim: vi.fn(), listClaimed: vi.fn(),
  };
  const service = new GuestRunService({ repository: repo, queue: new GuestRunFinishQueue(null),
    identity: () => ({ guestUserId: 'guest-test', recoveryToken: 'a'.repeat(64) }), notify: vi.fn() });
  const recorder = new RankedRunTraceRecorder();
  let goals!: OverworldGoalRunController; let currentCourse: ActiveCourseRunState | null = null;
  const startTrace = vi.fn((kind: 'room' | 'course', binding: Parameters<RankedRunTraceRecorder['start']>[1]) => recorder.start(kind, binding, frame));
  const clearTrace = vi.fn(() => recorder.clear()); const renderHud = vi.fn();
  const guests = new GuestRunPlaybackController({ service,
    getCurrentRun: kind => kind === 'room' ? goals.getCurrentRun() : currentCourse, startTrace, clearTrace, renderHud });
  const buildTrace = (_run: { elapsedMs: number }, result: 'completed' | 'failed' | 'abandoned') => {
    if (result === 'completed') recorder.recordGoalEvent({ type: 'complete', actor: 'player', roomId: '0,0',
      roomX: 0, roomY: 0, x: 144, y: 128, instanceId: null, checkpointIndex: null });
    return recorder.buildTrace(_run.elapsedMs);
  };
  const rankedStart = vi.fn(); const rankedFinish = vi.fn();
  goals = new OverworldGoalRunController({ playerHeight: 26, guestRuns: guests,
    runRepository: { startRun: rankedStart, finishRun: rankedFinish } as unknown as RunRepository,
    getAuthenticated: () => auth.authenticated, getAuthSource: () => 'session', getAuthDisplayName: () => 'Player',
    getScore: () => 0, countRoomObjectsByCategory: () => 1,
    buildVerificationTrace: buildTrace, clearVerificationTrace: clearTrace });
  const courses = new OverworldCoursePlaybackController({ guestRuns: guests,
    getSelectedCoordinates: () => ({ x: 0, y: 0 }), getActiveCourseRun: () => currentCourse,
    setActiveCourseRun: run => { currentCourse = run; }, getRoomSnapshotForCoordinates: () => room(),
    countRoomObjectsByCategory: () => 1, clearTransientRoomOverride: vi.fn(), clearTransientRoomOverrides: vi.fn(),
    setTransientRoomOverride: vi.fn(), setTransientRoomOverrides: vi.fn(), showTransientStatus: vi.fn(), renderHud,
    buildVerificationTrace: buildTrace, clearVerificationTrace: clearTrace });
  function setCourse(expandedRoomId: string | null) {
    const snapshot = { ...createDefaultCourseSnapshot('example'), status: 'published' as const,
      roomRefs: [{ roomId: '0,0', coordinates: { x: 0, y: 0 }, roomVersion: 1, roomTitle: null }],
      goal: { type: 'reach_exit' as const, exit: { roomId: '0,0', x: 144, y: 128 }, timeLimitMs: null } };
    currentCourse = courses.createCourseRunState(snapshot); currentCourse.expandedRoomId = expandedRoomId;
    return currentCourse;
  }
  return { goals, guests, courses, setCourse, repo, recorder, rankedStart, rankedFinish, startTrace, clearTrace, renderHud };
}
async function settle(): Promise<void> { for (let i = 0; i < 12; i++) await Promise.resolve(); }

describe('ordinary guest playback lifecycle', () => {
  it('starts at qualified spawn and captures a quick clear before the start reply', async () => {
    const h = harness(); const pending = deferred<GuestRunStartResponse>(); vi.mocked(h.repo.start).mockReturnValue(pending.promise);
    h.goals.syncRunForRoom(room(), 'spawn'); h.recorder.recordFrame(1000, { ...frame, x: 144 }); h.goals.tick(1000);
    h.goals.markCompleted('Exit reached.');
    expect(h.startTrace).toHaveBeenCalledTimes(1); expect(h.clearTrace).toHaveBeenCalledTimes(1);
    expect(requestPostRunGuestClaim).toHaveBeenCalledTimes(1); expect(notifyRewardStings).toHaveBeenCalledTimes(1);
    expect(requestPostRunGuestClaim.mock.calls[0][0]).toMatchObject({ contentType: 'room', guestProgress: { status: 'queued' } });
    expect(h.repo.finish).not.toHaveBeenCalled(); expect(h.rankedStart).not.toHaveBeenCalled();
    pending.resolve(startResponse(vi.mocked(h.repo.start).mock.calls[0][0])); await settle();
    expect(h.goals.getCurrentRun()).toMatchObject({ submissionState: 'submitted', guestProgress: { status: 'saved' }, leaderboardEligible: false });
    expect(vi.mocked(h.repo.finish).mock.calls[0][1].verificationTrace).toMatchObject({ verificationNonce: 'server-nonce',
      breadcrumbs: [{ atMs: 0 }, { atMs: 1000 }], goalEvents: [{ type: 'complete' }] });
    expect(h.rankedFinish).not.toHaveBeenCalled(); expect(requestPostRunRating).not.toHaveBeenCalled();
  });
  it('does not record a practice entry until the player reaches spawn', () => {
    const h = harness(); h.goals.syncRunForRoom(room(), 'transition'); expect(h.repo.start).not.toHaveBeenCalled();
    h.goals.qualifyPracticeRunAt({ x: 200, y: 128 }); expect(h.repo.start).not.toHaveBeenCalled();
    h.goals.qualifyPracticeRunAt({ x: 64, y: 128 }); expect(h.repo.start).toHaveBeenCalledTimes(1);
  });
  it('keeps draft playtests local and does not offer a saved guest clear', () => {
    const h = harness(); h.goals.syncRunForRoom({ ...room(), status: 'draft' }, 'spawn'); h.goals.markCompleted('Clear');
    expect(h.repo.start).not.toHaveBeenCalled(); expect(h.repo.finish).not.toHaveBeenCalled(); expect(requestPostRunGuestClaim).not.toHaveBeenCalled();
  });
  it('keeps the original guest run when the player signs in during play', async () => {
    const h = harness(); h.goals.syncRunForRoom(room(), 'spawn'); auth.authenticated = true; h.goals.markCompleted('Clear'); await settle();
    expect(h.repo.finish).toHaveBeenCalledTimes(1); expect(h.rankedStart).not.toHaveBeenCalled(); expect(h.rankedFinish).not.toHaveBeenCalled();
    expect(requestPostRunGuestClaim.mock.calls[0][0].guestProgress.clientRunId).toBe(h.goals.getCurrentRun()?.guestProgress?.clientRunId);
  });
  it('a delayed earlier start cannot reset a restarted run recorder', async () => {
    const h = harness(); const pending = deferred<GuestRunStartResponse>(); vi.mocked(h.repo.start).mockReturnValueOnce(pending.promise);
    h.goals.syncRunForRoom(room(), 'spawn'); const oldStart = vi.mocked(h.repo.start).mock.calls[0][0];
    h.goals.abandonActiveRun(); h.goals.reset(); h.goals.syncRunForRoom(room(), 'spawn'); await settle();
    const currentId = h.goals.getCurrentRun()?.attemptId; const clearCount = h.clearTrace.mock.calls.length;
    pending.resolve(startResponse(oldStart)); await settle();
    expect(h.startTrace).toHaveBeenCalledTimes(2); expect(h.clearTrace).toHaveBeenCalledTimes(clearCount);
    expect(h.recorder.isActive('room')).toBe(true); expect(h.goals.getCurrentRun()?.attemptId).toBe(currentId);
    expect(notifyRewardStings).not.toHaveBeenCalled(); expect(requestPostRunGuestClaim).not.toHaveBeenCalled();
  });
  it('submits abandon once and preserves the trace before teardown', async () => {
    const h = harness(); h.goals.syncRunForRoom(room(), 'spawn'); h.recorder.recordFrame(500, frame); h.goals.tick(500);
    h.goals.abandonActiveRun(); h.goals.abandonActiveRun(); h.goals.reset(); await settle();
    expect(h.repo.finish).toHaveBeenCalledTimes(1);
    expect(vi.mocked(h.repo.finish).mock.calls[0][1]).toMatchObject({ result: 'abandoned', elapsedMs: 500,
      verificationTrace: { breadcrumbs: [{ atMs: 0 }, { atMs: 500 }] } });
    expect(requestPostRunGuestClaim).not.toHaveBeenCalled(); expect(notifyRewardStings).not.toHaveBeenCalled();
  });
});

describe('course and expanded guest playback', () => {
  it.each([null, 'course:example', 'native-example'])('starts %s only after the runtime spawn hook', async expandedId => {
    const h = harness(); const run = h.setCourse(expandedId); expect(h.repo.start).not.toHaveBeenCalled();
    h.courses.startGuestRunAfterSpawn(); h.courses.startGuestRunAfterSpawn(); await settle();
    expect(h.repo.start).toHaveBeenCalledTimes(1); expect(h.startTrace).toHaveBeenCalledTimes(1);
    expect(vi.mocked(h.repo.start).mock.calls[0][0]).toMatchObject({
      contentType: expandedId ? 'expanded_room' : 'course', contentId: expandedId ?? 'example' });
    run.elapsedMs = 1000; run.result = 'completed'; h.recorder.recordFrame(1000, { ...frame, x: 144 });
    await h.courses.finalizeActiveCourseRun('completed'); await settle();
    expect(run.guestProgress?.status).toBe('saved'); expect(run.leaderboardEligible).toBe(false);
    expect(requestPostRunGuestClaim.mock.calls[0][0]).toMatchObject({ contentType: expandedId ? 'expanded_room' : 'course',
      contentId: expandedId ?? 'example' }); expect(requestPostRunRating).not.toHaveBeenCalled();
  });
  it('does not start drafts or convert a newly signed-in run into a guest run', () => {
    const h = harness(); const draft = h.setCourse('course:example'); draft.course.status = 'draft';
    h.courses.startGuestRunAfterSpawn(); expect(h.repo.start).not.toHaveBeenCalled();
    const signed = h.setCourse('course:example'); auth.authenticated = true; h.courses.startGuestRunAfterSpawn();
    expect(h.guests.has(signed)).toBe(false); expect(h.repo.start).not.toHaveBeenCalled();
  });
  it('keeps a draft preview local even when its starting course snapshot was published', async () => {
    const h = harness(); const run = h.setCourse('course:example');
    await h.courses.prepareActiveCourseRoomOverrides(run.course, { mode: 'draftPreview', roomOverrides: [room()] });
    h.courses.startGuestRunAfterSpawn(); expect(h.repo.start).not.toHaveBeenCalled();
  });
  it('a late expanded start reply cannot overwrite a restart of the same course', async () => {
    const h = harness(); const pending = deferred<GuestRunStartResponse>(); vi.mocked(h.repo.start).mockReturnValueOnce(pending.promise);
    const old = h.setCourse('course:example'); h.courses.startGuestRunAfterSpawn(); const oldStart = vi.mocked(h.repo.start).mock.calls[0][0];
    await h.courses.finalizeActiveCourseRun('abandoned'); const current = h.setCourse('course:example'); h.courses.startGuestRunAfterSpawn(); await settle();
    const currentId = current.attemptId; pending.resolve(startResponse(oldStart)); await settle();
    expect(current.attemptId).toBe(currentId); expect(current.guestProgress?.status).toBe('queued');
    expect(h.recorder.isActive('course')).toBe(true); expect(h.startTrace).toHaveBeenCalledTimes(2);
    expect(h.guests.has(old)).toBe(true);
  });
});
