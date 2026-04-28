import {
  DEFAULT_ROOM_COORDINATES,
  type RoomCoordinates,
} from '../persistence/roomModel';
import {
  buildRoomSharePath,
  parseRoomSharePath,
} from '../social/roomShareLinks';

function parseCoordinate(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

export function hasFocusedCoordinatesInUrl(): boolean {
  if (parseRoomSharePath(window.location.pathname)) {
    return true;
  }

  const params = new URLSearchParams(window.location.search);
  return parseCoordinate(params.get('x')) !== null && parseCoordinate(params.get('y')) !== null;
}

export function getFocusedCoordinatesFromUrl(): RoomCoordinates {
  const pathCoordinates = parseRoomSharePath(window.location.pathname);
  if (pathCoordinates) {
    return pathCoordinates;
  }

  const params = new URLSearchParams(window.location.search);
  const x = parseCoordinate(params.get('x'));
  const y = parseCoordinate(params.get('y'));

  if (x === null || y === null) {
    return { ...DEFAULT_ROOM_COORDINATES };
  }

  return { x, y };
}

export function setFocusedCoordinatesInUrl(coordinates: RoomCoordinates): void {
  const url = new URL(window.location.href);
  url.pathname = buildRoomSharePath(coordinates);
  url.searchParams.delete('x');
  url.searchParams.delete('y');
  window.history.replaceState({}, '', url);
}
