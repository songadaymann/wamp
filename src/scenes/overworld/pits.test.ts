import { describe, expect, it } from 'vitest';
import { createDefaultCourseSnapshot, type CourseSnapshot } from '../../courses/model';
import { createExpandedRoomSummaryFromLegacyCourse, createExpandedRoomSummaryFromResolvedTarget, type ExpandedRoomMembershipSummary } from '../../expandedRooms/model';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import { hasDeadlyBottomEdge } from './pits';

const room = createDefaultRoomSnapshot();
function course(enabled: boolean): CourseSnapshot {
  return { ...createDefaultCourseSnapshot('vertical'), pitsAreDeadly: enabled, roomRefs: [
    { roomId: '0,0', coordinates: { x: 0, y: 0 }, roomVersion: 1, roomTitle: null },
    { roomId: '0,1', coordinates: { x: 0, y: 1 }, roomVersion: 1, roomTitle: null },
    { roomId: '1,0', coordinates: { x: 1, y: 0 }, roomVersion: 1, roomTitle: null },
  ] };
}
const membership = (enabled: boolean): ExpandedRoomMembershipSummary => createExpandedRoomSummaryFromLegacyCourse({ courseId: 'vertical', courseTitle: 'Vertical', goalType: 'reach_exit', roomCount: 3, pitsAreDeadly: enabled });

describe('outer bottom edge decisions', () => {
  it('only opts in ordinary rooms and ignores unavailable room data', () => {
    expect(hasDeadlyBottomEdge(null, null)).toBe(false);
    expect(hasDeadlyBottomEdge(room, null)).toBe(false);
    expect(hasDeadlyBottomEdge({ ...room, pitsAreDeadly: true }, null)).toBe(true);
  });
  it('keeps vertical expanded connections open, killing at each exposed outer contour', () => {
    expect(hasDeadlyBottomEdge(room, course(true))).toBe(false);
    expect(hasDeadlyBottomEdge({ ...room, coordinates: { x: 0, y: 1 } }, course(true))).toBe(true);
    expect(hasDeadlyBottomEdge({ ...room, coordinates: { x: 1, y: 0 } }, course(true))).toBe(true);
  });
  it('uses the root off setting even when an individual cell has enabled pits', () => {
    expect(hasDeadlyBottomEdge({ ...room, coordinates: { x: 0, y: 1 }, pitsAreDeadly: true }, course(false))).toBe(false);
    expect(hasDeadlyBottomEdge({ ...room, pitsAreDeadly: true }, null, membership(false))).toBe(false);
  });
  it('applies published root metadata during free exploration without an active run', () => {
    expect(hasDeadlyBottomEdge(room, null, membership(true), membership(true))).toBe(false);
    expect(hasDeadlyBottomEdge(room, null, membership(true), null)).toBe(true);
    expect(hasDeadlyBottomEdge(room, null, membership(true), { ...membership(true), expandedRoomId: 'other' })).toBe(true);
  });
  it('preserves root settings when targets become cached membership summaries', () => {
    const summary = membership(true);
    expect(createExpandedRoomSummaryFromResolvedTarget({ ...summary, ownerUserId: null, ownerDisplayName: null, anchorRoomId: '0,0', anchorCoordinates: { x: 0, y: 0 }, focusedCoordinates: null, version: 1, publishedAt: null, cells: [] }).pitsAreDeadly).toBe(true);
  });
});
