export function hasFocusedRoomCoordinateLink(search: string): boolean {
  const params = new URLSearchParams(search);
  return parseCoordinate(params.get('x')) !== null && parseCoordinate(params.get('y')) !== null;
}

function parseCoordinate(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}
