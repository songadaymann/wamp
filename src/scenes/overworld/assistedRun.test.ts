import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import { createDefaultCourseSnapshot } from '../../courses/model';
import type { RunRepository } from '../../runs/runRepository';
import { OverworldGoalRunController } from './goalRuns';
import { markRunAssisted, ASSIST_RUN_MESSAGE } from './assistedRun';
import { createActiveExpandedRoomRunState } from './expandedRoomRuns';
import { requestPostRunGuestClaim, requestPostRunRating } from '../../progression/postRunRatingEvents';
vi.mock('../../progression/postRunRatingEvents', () => ({ requestPostRunGuestClaim: vi.fn(), requestPostRunRating: vi.fn() }));
vi.mock('../../persistence/roomRepository', () => ({ createRoomRepository: () => ({}) }));
afterEach(() => vi.clearAllMocks());
function harness({ signed = false, assisted = true } = {}) {
  let enabled = assisted;
  let resolveStart: (response: unknown) => void = () => {};
  const start = new Promise(resolve => { resolveStart = resolve; });
  const repository = { startRun: vi.fn(() => start), finishRun: vi.fn(), loadRoomLeaderboard: vi.fn().mockResolvedValue(null) };
  const guestRuns = { has: vi.fn(() => false), begin: vi.fn(), finish: vi.fn() }, draftClear = vi.fn();
  const controller = new OverworldGoalRunController({ playerHeight: 14, runRepository: repository as unknown as RunRepository,
    getScore: () => 0, getAuthenticated: () => signed, getAuthSource: () => 'session', getAuthDisplayName: () => 'Assist Test',
    isAssistActive: () => enabled, countRoomObjectsByCategory: () => 0, guestRuns: guestRuns as never, onDraftGoalCompleted: draftClear });
  const room = { ...createDefaultRoomSnapshot(), status: 'published' as const, goal: { type: 'collect_target' as const, requiredCount: 1, timeLimitMs: null } };
  controller.syncRunForRoom(room, 'spawn');
  return { controller, repository, guestRuns, draftClear, room, resolveStart, setEnabled: (value: boolean) => { enabled = value; }, run: () => controller.getCurrentRun()! };
}
describe('assisted attempt submission boundaries', () => {
  it.each([false, true])('completes locally with no guest or signed rewards (signed=%s)', signed => {
    const h = harness({ signed }); h.controller.recordCollectibleCollected(h.room.id);
    expect(h.run()).toMatchObject({ result: 'completed', qualificationState: 'qualified', assisted: true, leaderboardEligible: false, submissionState: 'local-only', submissionMessage: ASSIST_RUN_MESSAGE });
    expect(h.repository.startRun).not.toHaveBeenCalled(); expect(h.repository.finishRun).not.toHaveBeenCalled();
    expect(h.guestRuns.begin).not.toHaveBeenCalled(); expect(h.guestRuns.finish).not.toHaveBeenCalled();
    expect(requestPostRunGuestClaim).not.toHaveBeenCalled(); expect(requestPostRunRating).not.toHaveBeenCalled();
  });
  it('invalidates a starting ranked run and ignores its late start reply', async () => {
    const h = harness({ signed: true, assisted: false }); expect(h.repository.startRun).toHaveBeenCalledOnce();
    expect(markRunAssisted(h.run())).toBe(true); h.setEnabled(false);
    h.resolveStart({ attemptId: 'late', verificationSchemaVersion: 1, verificationNonce: 'nonce', snapshotHash: 'hash', userDisplayName: 'Test' });
    await Promise.resolve(); await Promise.resolve();
    h.controller.recordCollectibleCollected(h.room.id);
    expect(h.run()).toMatchObject({ assisted: true, attemptId: null, leaderboardEligible: false, submissionState: 'local-only', result: 'completed' });
    expect(h.repository.finishRun).not.toHaveBeenCalled();
  });
  it('ignores a live guest session after assistance is enabled mid-attempt', () => {
    const h = harness({ assisted: false }); expect(h.guestRuns.begin).toHaveBeenCalledOnce();
    h.guestRuns.has.mockReturnValue(true); markRunAssisted(h.run()); h.controller.recordCollectibleCollected(h.room.id);
    expect(h.guestRuns.finish).not.toHaveBeenCalled(); expect(requestPostRunGuestClaim).not.toHaveBeenCalled();
  });
  it('requires a fresh attempt after disabling assistance and does not certify draft clears', () => {
    const h = harness(); h.setEnabled(false); h.controller.recordCollectibleCollected(h.room.id);
    expect(h.run().assisted).toBe(true); expect(markRunAssisted(h.run())).toBe(false);
    h.controller.clearCurrentRun(); h.controller.syncRunForRoom({ ...h.room, status: 'draft' }, 'spawn'); markRunAssisted(h.run());
    h.controller.recordCollectibleCollected(h.room.id); expect(h.draftClear).not.toHaveBeenCalled();
    h.controller.clearCurrentRun(); h.controller.syncRunForRoom(h.room, 'spawn'); expect(h.run().assisted).toBe(false); expect(h.guestRuns.begin).toHaveBeenCalledOnce();
  });
  it('forces Expanded Room assistance local even if a caller requests ranked eligibility', () => {
    const run = createActiveExpandedRoomRunState({ course: createDefaultCourseSnapshot('test'), returnCoordinates: { x: 0, y: 0 }, leaderboardEligible: true, assisted: true, enemyTarget: null });
    expect(run).toMatchObject({ assisted: true, leaderboardEligible: false, submissionState: 'local-only', submissionMessage: ASSIST_RUN_MESSAGE });
  });
});
