import type { RoomCoordinates } from '../persistence/roomModel';
import { parseRoomSharePath } from './roomShareLinks';

export function normalizeChallengeAttemptId(value: unknown): string | null {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : null;
}

/** A challenge belongs to the room in its invitation, never the next room visited. */
export function getChallengeAttemptId(coordinates: RoomCoordinates, href?: string): string | null {
  try {
    const url = new URL(href ?? window.location.href);
    const room = parseRoomSharePath(url.pathname);
    return room?.x === coordinates.x && room.y === coordinates.y
      ? normalizeChallengeAttemptId(url.searchParams.get('vs')) : null;
  } catch { return null; }
}
