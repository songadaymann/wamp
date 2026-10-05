import { describe, expect, it, vi } from 'vitest';
vi.mock('../../auth/client', () => ({ getAuthDebugState: () => ({ authenticated: false }) }));
vi.mock('../../persistence/roomRepository', () => ({ createRoomRepository: () => ({}) }));
vi.mock('../../courses/courseRepository', () => ({ createCourseRepository: () => ({}), isCourseApiError: () => false }));
vi.mock('../../expandedRooms/repository', () => ({ createExpandedRoomRepository: () => ({}), isExpandedRoomApiError: () => false }));
vi.mock('../../progression/postRunRatingEvents', () => ({ requestPostRunGuestClaim: vi.fn(), requestPostRunRating: vi.fn() }));
import { requestPostRunGuestClaim } from '../../progression/postRunRatingEvents';
import { createActiveCourseRunState } from './courseRuns';
import { OverworldCoursePlaybackController } from './coursePlayback';

function fixture(expandedRoomId: string | null) {
  const now = new Date().toISOString();
  const course = { id: 'legacy', title: 'Two Cell Adventure', version: 2, status: 'published' as const,
    roomRefs: [{ roomId: '10,20', coordinates: { x: 10, y: 20 }, roomVersion: 1, roomTitle: null },
      { roomId: '11,20', coordinates: { x: 11, y: 20 }, roomVersion: 1, roomTitle: null }],
    startPoint: null, goal: { type: 'survival' as const, durationMs: 1000 }, objectLinks: [], pressurePlateLinks: [], createdAt: now, updatedAt: now, publishedAt: now };
  const run = createActiveCourseRunState({ course, expandedRoomId, expandedRoomVersion: expandedRoomId ? 2 : null,
    startRoomId: '11,20', returnCoordinates: { x: 90, y: 90 }, enemyTarget: null, leaderboardEligible: false });
  run.result = 'completed'; run.elapsedMs = 1000;
  const guestRuns = { has: () => true, finish: vi.fn() };
  const host = { getActiveCourseRun: () => run, getSelectedCoordinates: () => ({ x: 99, y: 99 }), guestRuns, renderHud: vi.fn() };
  return { run, host, guestRuns, controller: new OverworldCoursePlaybackController(host as never) };
}
describe('capturing expanded and course clear destinations', () => {
  it.each([null, 'native-expanded', 'course:legacy'])('captures the locked starting cell in a guest clear for %s', async id => {
    const f = fixture(id); await f.controller.finalizeActiveCourseRun('completed');
    const detail = f.guestRuns.finish.mock.calls[0][2];
    expect(detail.contentType).toBe(id ? 'expanded_room' : 'course');
    expect(detail.shareCoordinates).toEqual({ x: 11, y: 20 });
    f.run.course.roomRefs[1].coordinates.x = 88;
    expect(detail.shareCoordinates).toEqual({ x: 11, y: 20 });
  });
  it('preserves the target on the legacy local-only course completion path', async () => {
    vi.mocked(requestPostRunGuestClaim).mockClear();
    const f = fixture('course:legacy'); f.host.guestRuns = undefined as never;
    await new OverworldCoursePlaybackController(f.host as never).finalizeActiveCourseRun('completed');
    expect(requestPostRunGuestClaim).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'course', expandedRoomId: 'course:legacy', shareCoordinates: { x: 11, y: 20 } }));
  });
});
