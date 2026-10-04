import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultCourseRecord } from '../courses/model';
import { announceFirstPublishedExpandedRoom, ROOM_FIRST_PUBLISHED_EVENT, type FirstPublishedRoom } from './events';

afterEach(() => vi.unstubAllGlobals());
describe('expanded first-publish entry', () => {
  it('shares and plays the published start cell even when it is not the first stored ref', () => {
    const win = new EventTarget(); vi.stubGlobal('window', win);
    let detail!: FirstPublishedRoom;
    win.addEventListener(ROOM_FIRST_PUBLISHED_EVENT, event => { detail = (event as CustomEvent<FirstPublishedRoom>).detail; });
    const snapshot = createDefaultCourseRecord('expanded').draft;
    snapshot.title = 'My Adventure';
    snapshot.roomRefs = [
      { roomId: '1,2', coordinates: { x: 1, y: 2 }, roomVersion: 4, roomTitle: 'First' },
      { roomId: '1,3', coordinates: { x: 1, y: 3 }, roomVersion: 7, roomTitle: 'Start' },
    ];
    snapshot.startPoint = { roomId: '1,3', x: 32, y: 320 };
    const play = vi.fn(); announceFirstPublishedExpandedRoom({ userId: 'builder', snapshot, play });
    expect(detail).toMatchObject({ contentType: 'expanded_room', title: 'My Adventure', coordinates: { x: 1, y: 3 }, expandedSnapshot: snapshot });
    expect(play).not.toHaveBeenCalled(); snapshot.roomRefs[1].coordinates.y = 9;
    detail.play(); expect(play).toHaveBeenCalledExactlyOnceWith({ x: 1, y: 3 });
  });
  it('cannot announce a live expanded link without a published cell', () => {
    const win = new EventTarget(); vi.stubGlobal('window', win); const listener = vi.fn();
    win.addEventListener(ROOM_FIRST_PUBLISHED_EVENT, listener);
    announceFirstPublishedExpandedRoom({ userId: 'builder', snapshot: createDefaultCourseRecord('empty').draft, play: vi.fn() });
    expect(listener).not.toHaveBeenCalled();
  });
});
