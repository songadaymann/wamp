import { describe, expect, it, vi } from 'vitest';
import { hasExpandedRoomLeaderboardTarget, loadSelectedExpandedRoomLeaderboard } from './expandedRoomLeaderboardTarget';
import type { OverworldSelectedRoomContext } from './sceneBridge';

const cell = (changes = {}): OverworldSelectedRoomContext => ({ roomId: '2,3', coordinates: { x: 2, y: 3 },
  state: 'published', expandedRoomId: 'native-id', courseId: null, courseTitle: 'Adventure',
  courseGoalType: 'reach_exit', courseRoomCount: 2, ...changes });

describe('whole Expanded Room leaderboard targeting', () => {
  it.each(['2,3', '3,3'])('loads the native identity from every cell (%s), bypassing cached results', async roomId => {
    const native = { loadExpandedRoomLeaderboard: vi.fn().mockResolvedValue({ courseVersion: 4 }) };
    const legacy = { loadCourseLeaderboard: vi.fn() };
    expect(await loadSelectedExpandedRoomLeaderboard(cell({ roomId }), native, legacy)).toEqual({ courseVersion: 4 });
    expect(native.loadExpandedRoomLeaderboard).toHaveBeenCalledWith('native-id', null, 25, true);
    expect(legacy.loadCourseLeaderboard).not.toHaveBeenCalled();
  });
  it('pins a playing run to its whole-room version, never the cell version', async () => {
    const native = { loadExpandedRoomLeaderboard: vi.fn() }, legacy = { loadCourseLeaderboard: vi.fn() };
    await loadSelectedExpandedRoomLeaderboard(cell({ expandedRoomVersion: 7, publishedVersion: 29 }), native, legacy);
    expect(native.loadExpandedRoomLeaderboard).toHaveBeenCalledWith('native-id', 7, 25, true);
    await loadSelectedExpandedRoomLeaderboard(cell({ expandedRoomId: null, courseId: 'old-course', expandedRoomVersion: 3 }), native, legacy);
    expect(legacy.loadCourseLeaderboard).toHaveBeenCalledWith('old-course', 3, 25, true);
  });
  it('keeps published rooms with no goal accessible but intentionally unranked', async () => {
    const native = { loadExpandedRoomLeaderboard: vi.fn() }, legacy = { loadCourseLeaderboard: vi.fn() };
    const context = cell({ courseGoalType: null });
    expect(hasExpandedRoomLeaderboardTarget(context)).toBe(true);
    expect(await loadSelectedExpandedRoomLeaderboard(context, native, legacy)).toBeNull();
    expect(native.loadExpandedRoomLeaderboard).not.toHaveBeenCalled();
  });
  it('keeps standalone aliases and unpublished drafts out of whole-room rankings', () => {
    expect(hasExpandedRoomLeaderboardTarget(cell({ expandedRoomId: 'room:2,3' }))).toBe(false);
    expect(hasExpandedRoomLeaderboardTarget(cell({ state: 'draft' }))).toBe(false);
    expect(hasExpandedRoomLeaderboardTarget(cell({ expandedRoomId: null, courseId: 'old' }))).toBe(true);
  });
  it('propagates failures instead of turning them into empty boards or segment rankings', async () => {
    const native = { loadExpandedRoomLeaderboard: vi.fn().mockRejectedValue(new Error('offline')) };
    const legacy = { loadCourseLeaderboard: vi.fn() };
    await expect(loadSelectedExpandedRoomLeaderboard(cell(), native, legacy)).rejects.toThrow('offline');
    expect(legacy.loadCourseLeaderboard).not.toHaveBeenCalled();
  });
});
