import {
  DEFAULT_ROOM_COORDINATES,
  type RoomCoordinates,
} from '../persistence/roomModel';

function parseCoordinate(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

export function getFocusedCoordinatesFromUrl(): RoomCoordinates {
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
  url.searchParams.set('x', String(coordinates.x));
  url.searchParams.set('y', String(coordinates.y));
  window.history.replaceState({}, '', url);
}
