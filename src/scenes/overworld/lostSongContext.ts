import { getActiveWorldId } from '../../worlds/clientContext';
import { getAuthDebugState } from '../../auth/client';
import { parseRoomId, roomIdFromCoordinates, type RoomCoordinates, type RoomSnapshotView } from '../../persistence/roomModel';
import type { ActiveExpandedRoomRunState } from './expandedRoomRuns';
import type { LostSongPlayContext } from './lostSongs';
interface LostSongContextHost {
  canPlay(): boolean;
  getCoordinates(): RoomCoordinates;
  getRoom(coordinates: RoomCoordinates): RoomSnapshotView | null;
  getCourse(): ActiveExpandedRoomRunState | null;
  isAssisted(): boolean;
  getCreator(id: string): string | null;
  getOrigin(coordinates: RoomCoordinates): { x: number; y: number };
  getPosition(): { x: number; y: number };
}
export function createLostSongContext(host: LostSongContextHost): (id?: string) => LostSongPlayContext | null {
  return (id = roomIdFromCoordinates(host.getCoordinates())) => {
    if (!host.canPlay()) return null;
    const coordinates = parseRoomId(id); if (!coordinates) return null;
    const room = host.getRoom(coordinates);
    if (!room?.placedObjects.some(object => object.id === 'lost_song')) return null;
    const origin = host.getOrigin(coordinates), course = host.getCourse(), position = host.getPosition();
    const userId = getAuthDebugState().user?.id ?? null;
    return { target: { roomId: id, roomVersion: room.version,
      ...(course?.expandedRoomId && course.expandedRoomVersion ? { expandedRoomId: course.expandedRoomId, expandedRoomVersion: course.expandedRoomVersion } : {}) },
      practice: host.isAssisted() || Boolean(getActiveWorldId()) || room.status !== 'published'
        || Boolean(course && course.course.status !== 'published') || Boolean(userId && host.getCreator(id) === userId),
      position: { x: position.x - origin.x, y: position.y - origin.y } };
  };
}
