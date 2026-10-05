import { describe, expect, it, vi } from 'vitest';
vi.mock('../../auth/client', () => ({ getAuthDebugState: () => ({ authenticated: false }) }));
import { OverworldHudStateController } from './hudState';

describe('selected room share titles', () => {
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
