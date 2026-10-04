import { afterEach, describe, expect, it, vi } from 'vitest';
const repos = vi.hoisted(() => ({ room: vi.fn(), course: vi.fn(), expanded: vi.fn() }));
vi.mock('../persistence/roomRepository', () => ({ createRoomRepository: () => ({ loadRoom: repos.room }) }));
vi.mock('../courses/courseRepository', () => ({ createCourseRepository: () => ({ loadCourse: repos.course }) }));
vi.mock('../expandedRooms/repository', () => ({ createExpandedRoomRepository: () => ({ loadExpandedRoom: repos.expanded }) }));
import { resolveGuestRunReplayLink } from './runReplayLinks';
afterEach(() => vi.resetAllMocks());
describe('guest replay destinations', () => {
  it.each(['room', 'expanded_room'] as const)('resolves a published %s room without trusting local coordinates', async contentType => {
    repos.room.mockResolvedValue({ published: {} });
    expect(await resolveGuestRunReplayLink({ contentType, contentId: contentType === 'room' ? '-11,-6' : 'room:-11,-6' })).toEqual({ href: '/r/-11/-6', label: 'Replay' });
    expect(repos.room).toHaveBeenCalledWith('-11,-6', { x: -11, y: -6 });
  });
  it.each(['course', 'expanded_room'] as const)('resolves %s to its actual published spawn cell', async contentType => {
    repos.course.mockResolvedValue({ published: { startPoint: { roomId: '13,0' }, roomRefs: [
      { roomId: '12,0', coordinates: { x: 12, y: 0 } }, { roomId: '13,0', coordinates: { x: 13, y: 0 } }] } });
    expect(await resolveGuestRunReplayLink({ contentType, contentId: contentType === 'course' ? 'fixture' : 'course:fixture' })).toEqual({ href: '/r/13/0', label: 'Replay' });
  });
  it('offers the published native expanded anchor without promising an unsupported replay control', async () => {
    repos.expanded.mockResolvedValue({ publishedAt: new Date().toISOString(), anchorCoordinates: { x: 2, y: 3 } });
    expect(await resolveGuestRunReplayLink({ contentType: 'expanded_room', contentId: 'native' })).toEqual({ href: '/r/2/3', label: 'View room' });
  });
  it('does not link private, deleted, unavailable or malformed content', async () => {
    repos.room.mockResolvedValue({ published: null }); repos.course.mockRejectedValue(new Error('deleted')); repos.expanded.mockRejectedValue(new Error('offline'));
    expect(await resolveGuestRunReplayLink({ contentType: 'room', contentId: '1,2' })).toBeNull();
    expect(await resolveGuestRunReplayLink({ contentType: 'room', contentId: 'javascript:bad' })).toBeNull();
    expect(await resolveGuestRunReplayLink({ contentType: 'course', contentId: 'deleted' })).toBeNull();
    expect(await resolveGuestRunReplayLink({ contentType: 'expanded_room', contentId: 'offline' })).toBeNull();
  });
});
