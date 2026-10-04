import type { CourseSnapshot } from '../courses/model';
import type { RoomCoordinates, RoomSnapshot } from '../persistence/roomModel';

export const ROOM_PUBLISH_NAME_REQUEST_EVENT = 'wamp:room-publish-name-request';
export const ROOM_FIRST_PUBLISHED_EVENT = 'wamp:room-first-published';

export interface RoomPublishNameRequest {
  userId: string;
  suggestedTitle: string;
  resolve: (title: string | null) => void;
}

export interface FirstPublishedRoom {
  userId: string;
  contentType: 'room' | 'expanded_room';
  contentId: string;
  title: string;
  coordinates: RoomCoordinates;
  snapshot?: RoomSnapshot;
  expandedSnapshot?: CourseSnapshot;
  play: () => void;
}

export function requestRoomPublishName(userId: string, suggestedTitle: string): Promise<string | null> {
  return new Promise(resolve => {
    const handled = !window.dispatchEvent(new CustomEvent<RoomPublishNameRequest>(ROOM_PUBLISH_NAME_REQUEST_EVENT, {
      cancelable: true, detail: { userId, suggestedTitle, resolve },
    }));
    if (!handled) resolve(null);
  });
}

export function announceFirstPublishedRoom(detail: FirstPublishedRoom): void {
  window.dispatchEvent(new CustomEvent<FirstPublishedRoom>(ROOM_FIRST_PUBLISHED_EVENT, { detail }));
}

export function announceFirstPublishedExpandedRoom(options: {
  userId: string; snapshot: CourseSnapshot; play: (coordinates: RoomCoordinates) => void;
}): void {
  const start = options.snapshot.roomRefs.find(ref => ref.roomId === options.snapshot.startPoint?.roomId)
    ?? options.snapshot.roomRefs[0];
  if (!start) return;
  const coordinates = { ...start.coordinates };
  announceFirstPublishedRoom({ userId: options.userId, contentType: 'expanded_room', contentId: options.snapshot.id,
    title: options.snapshot.title || 'Expanded Room', coordinates, expandedSnapshot: options.snapshot,
    play: () => options.play({ ...coordinates }) });
}

export function suggestRoomTitle(goalType: string | undefined): string {
  return ({ reach_exit: 'The Great Escape', collect_target: 'Treasure Hunt', defeat_all: 'Monster Mash',
    checkpoint_sprint: 'Checkpoint Chase', survival: 'Stay Alive' } as Record<string, string>)[goalType ?? ''] ?? 'My WAMP Room';
}
