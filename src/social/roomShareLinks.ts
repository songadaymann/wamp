import type { RoomCoordinates } from '../persistence/roomModel';

const ROOM_SHARE_PATH_PATTERN = /^\/r\/(-?\d+)\/(-?\d+)\/?$/;

export function buildRoomSharePath(coordinates: RoomCoordinates): string {
  return `/r/${coordinates.x}/${coordinates.y}`;
}

export function buildRoomShareUrl(
  coordinates: RoomCoordinates,
  href: string,
): string {
  const url = new URL(href);
  url.pathname = buildRoomSharePath(coordinates);
  url.searchParams.delete('x');
  url.searchParams.delete('y');
  url.hash = '';
  return url.toString();
}

export function buildAttributedRoomShareUrl(coordinates: RoomCoordinates, href: string): string {
  // Editor, QA and navigation parameters must not travel with a public invitation.
  const url = new URL(buildRoomSharePath(coordinates), new URL(href).origin);
  url.searchParams.set('from', 'share');
  return url.toString();
}

export function parseRoomSharePath(pathname: string): RoomCoordinates | null {
  const match = ROOM_SHARE_PATH_PATTERN.exec(pathname);
  if (!match) {
    return null;
  }

  return {
    x: Number.parseInt(match[1], 10),
    y: Number.parseInt(match[2], 10),
  };
}
