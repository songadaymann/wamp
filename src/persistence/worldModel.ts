import {
  DEFAULT_ROOM_COORDINATES,
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomSnapshot,
} from './roomModel';

export type WorldCellState = 'published' | 'frontier';

export interface WorldRoomSummary {
  id: string;
  coordinates: RoomCoordinates;
  state: WorldCellState;
  background: string | null;
  version: number | null;
  publishedAt: string | null;
}

export interface WorldWindow {
  center: RoomCoordinates;
  radius: number;
  rooms: WorldRoomSummary[];
}

export function getOrthogonalNeighbors(coordinates: RoomCoordinates): RoomCoordinates[] {
  return [
    { x: coordinates.x + 1, y: coordinates.y },
    { x: coordinates.x - 1, y: coordinates.y },
    { x: coordinates.x, y: coordinates.y + 1 },
    { x: coordinates.x, y: coordinates.y - 1 },
  ];
}

export function isWithinWorldWindow(
  coordinates: RoomCoordinates,
  center: RoomCoordinates,
  radius: number
): boolean {
  return (
    Math.abs(coordinates.x - center.x) <= radius &&
    Math.abs(coordinates.y - center.y) <= radius
  );
}

export function createPublishedRoomSummary(room: RoomSnapshot): WorldRoomSummary {
  return {
    id: room.id,
    coordinates: { ...room.coordinates },
    state: 'published',
    background: room.background,
    version: room.version,
    publishedAt: room.publishedAt,
  };
}

export function createFrontierRoomSummary(coordinates: RoomCoordinates): WorldRoomSummary {
  return {
    id: roomIdFromCoordinates(coordinates),
    coordinates: { ...coordinates },
    state: 'frontier',
    background: null,
    version: null,
    publishedAt: null,
  };
}

export function computeWorldWindow(
  publishedRooms: RoomSnapshot[],
  center: RoomCoordinates,
  radius: number
): WorldWindow {
  const publishedById = new Map<string, RoomSnapshot>();

  for (const room of publishedRooms) {
    publishedById.set(room.id, room);
  }

  const roomsById = new Map<string, WorldRoomSummary>();

  for (const room of publishedRooms) {
    if (isWithinWorldWindow(room.coordinates, center, radius)) {
      roomsById.set(room.id, createPublishedRoomSummary(room));
    }
  }

  if (publishedRooms.length === 0) {
    if (isWithinWorldWindow(DEFAULT_ROOM_COORDINATES, center, radius)) {
      const frontier = createFrontierRoomSummary(DEFAULT_ROOM_COORDINATES);
      roomsById.set(frontier.id, frontier);
    }

    return {
      center: { ...center },
      radius,
      rooms: Array.from(roomsById.values()).sort(compareWorldSummaries),
    };
  }

  for (const room of publishedRooms) {
    for (const neighbor of getOrthogonalNeighbors(room.coordinates)) {
      const neighborId = roomIdFromCoordinates(neighbor);
      if (publishedById.has(neighborId)) continue;
      if (!isWithinWorldWindow(neighbor, center, radius)) continue;
      if (roomsById.has(neighborId)) continue;

      roomsById.set(neighborId, createFrontierRoomSummary(neighbor));
    }
  }

  return {
    center: { ...center },
    radius,
    rooms: Array.from(roomsById.values()).sort(compareWorldSummaries),
  };
}

function compareWorldSummaries(a: WorldRoomSummary, b: WorldRoomSummary): number {
  if (a.coordinates.y !== b.coordinates.y) {
    return a.coordinates.y - b.coordinates.y;
  }

  return a.coordinates.x - b.coordinates.x;
}
