import { describe, expect, it, vi } from 'vitest';
vi.mock('../../auth/client', () => ({ getAuthDebugState: () => ({ authenticated: false }) }));
import { OverworldHudStateController } from './hudState';

describe('selected room share titles', () => {
  it('does not advertise public rankings for a draft preview rendered over published cells', () => {
    const controller = new OverworldHudStateController({ getMode: () => 'play',
      getSelectedCoordinates: () => ({ x: 1, y: 0 }), getCellStateAt: () => 'published',
      getRoomSnapshotForCoordinates: () => ({ version: 12 }),
      getActiveCourseRun: () => ({ course: { id: 'draft', status: 'draft', version: 1,
        roomRefs: [{ roomId: '1,0' }], goal: { type: 'reach_exit' } } }) } as never);
    expect(controller.getSelectedRoomContext().state).toBe('draft');
  });
  it.each(['browse', 'play'])('retains native leaderboard identity and goal on a nonentry cell in %s', mode => {
    const controller = new OverworldHudStateController({ getMode: () => mode,
      getActiveCourseRun: () => null, getSelectedCoordinates: () => ({ x: 181, y: 99 }),
      getCellStateAt: () => 'published', getRoomSnapshotForCoordinates: () => ({ version: 12 }),
      getRoomSummary: () => ({ expandedRoom: { expandedRoomId: 'native', title: 'Adventure',
        goalType: 'reach_exit', cellCount: 2, legacyCourseId: null } }) } as never);
    controller.refreshSelectedSummary();
    expect(controller.getSelectedRoomContext()).toMatchObject({ expandedRoomId: 'native',
      expandedRoomVersion: null, publishedVersion: 12, courseTitle: 'Adventure', courseGoalType: 'reach_exit', courseRoomCount: 2 });
  });
  it('retains the playing version after republishing or unloading summary metadata', () => {
    const controller = new OverworldHudStateController({ getMode: () => 'play',
      getSelectedCoordinates: () => ({ x: 181, y: 99 }), getCellStateAt: () => 'published',
      getRoomSnapshotForCoordinates: () => ({ version: 12 }),
      getActiveCourseRun: () => ({ expandedRoomId: 'native', expandedRoomVersion: 3,
        course: { id: 'compatibility', version: 3, title: 'Playing Adventure', goal: { type: 'reach_exit' }, roomRefs: [{ roomId: '181,99' }] } }) } as never);
    expect(controller.getSelectedRoomContext()).toMatchObject({ expandedRoomId: 'native',
      expandedRoomVersion: 3, courseGoalType: 'reach_exit', courseTitle: 'Playing Adventure' });
  });
  it('uses an already loaded snapshot while the map summary has no title', () => {
    const controller = new OverworldHudStateController({ getMode: () => 'browse', getSelectedCoordinates: () => ({ x: -11, y: -6 }),
      getCellStateAt: () => 'published', getRoomSnapshotForCoordinates: () => ({ title: 'De Ja Vu' }) } as never);
    expect(controller.getSelectedRoomContext().shareTitle).toBe('De Ja Vu');
  });
  it('uses the native Expanded Room title even without a legacy course', () => {
    const controller = new OverworldHudStateController({ getMode: () => 'browse', getSelectedCoordinates: () => ({ x: 180, y: 99 }),
      getCellStateAt: () => 'published', getRoomSnapshotForCoordinates: () => ({ title: 'Cell 180' }),
      getRoomSummary: () => ({ expandedRoom: { title: 'Sharing Adventure', legacyCourseId: null } }) } as never);
    controller.refreshSelectedSummary();expect(controller.getSelectedRoomContext().shareTitle).toBe('Sharing Adventure');
  });
  it.each([true, false])('uses the playing level title only for a matching cell (%s)', matches => {
    const controller = new OverworldHudStateController({ getMode: () => 'play', getSelectedCoordinates: () => ({ x: -11, y: -5 }),
      getCellStateAt: () => 'published', getRoomSnapshotForCoordinates: () => ({ title: 'Cell title' }),
      getActiveCourseRun: () => ({ course: { title: 'Playing Adventure', roomRefs: [{ roomId: matches ? '-11,-5' : '1,1' }] } }) } as never);
    expect(controller.getSelectedRoomContext().shareTitle).toBe(matches ? 'Playing Adventure' : 'Cell title');
  });
});
