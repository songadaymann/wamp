import {
  DEFAULT_ROOM_COORDINATES,
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomSnapshot,
} from './roomModel';
import type { CourseMembershipSummary } from '../courses/model';
import type { RoomGoalType } from '../goals/roomGoals';

export type WorldCellState = 'published' | 'frontier';
export const WORLD_CHUNK_SIZE = 8;

export interface WorldRoomSummary {
  id: string;
  coordinates: RoomCoordinates;
  title: string | null;
  state: WorldCellState;
  background: string | null;
  goalType: RoomGoalType | null;
  version: number | null;
  publishedAt: string | null;
  course: CourseMembershipSummary | null;
}

export interface WorldChunkCoordinates {
  x: number;
  y: number;
}

export interface WorldRoomBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface WorldChunkBounds {
  minChunkX: number;
  maxChunkX: number;
  minChunkY: number;
  maxChunkY: number;
}

export interface WorldChunk {
  id: string;
  coordinates: WorldChunkCoordinates;
  roomBounds: WorldRoomBounds;
  rooms: WorldRoomSummary[];
}

export interface WorldChunkWindow {
  chunkBounds: WorldChunkBounds;
  roomBounds: WorldRoomBounds;
  chunks: WorldChunk[];
}

export interface WorldWindow {
  center: RoomCoordinates;
  radius: number;
  rooms: WorldRoomSummary[];
}

export interface ClaimableFrontierRoomWindow {
  center: RoomCoordinates;
  radius: number;
  rooms: WorldRoomSummary[];
  roomDailyClaimLimit: number | null;
  roomClaimsUsedToday: number;
  roomClaimsRemainingToday: number | null;
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

export function isWithinRoomBounds(
  coordinates: RoomCoordinates,
  bounds: WorldRoomBounds
): boolean {
  return (
    coordinates.x >= bounds.minX &&
    coordinates.x <= bounds.maxX &&
    coordinates.y >= bounds.minY &&
    coordinates.y <= bounds.maxY
  );
}

export function roomToChunkCoordinates(coordinates: RoomCoordinates): WorldChunkCoordinates {
  return {
    x: Math.floor(coordinates.x / WORLD_CHUNK_SIZE),
    y: Math.floor(coordinates.y / WORLD_CHUNK_SIZE),
  };
}

export function chunkIdFromCoordinates(coordinates: WorldChunkCoordinates): string {
  return `${coordinates.x},${coordinates.y}`;
}

export function getChunkRoomBounds(coordinates: WorldChunkCoordinates): WorldRoomBounds {
  const minX = coordinates.x * WORLD_CHUNK_SIZE;
  const minY = coordinates.y * WORLD_CHUNK_SIZE;
  return {
    minX,
    maxX: minX + WORLD_CHUNK_SIZE - 1,
    minY,
    maxY: minY + WORLD_CHUNK_SIZE - 1,
  };
}

export function getRoomBoundsForChunkBounds(chunkBounds: WorldChunkBounds): WorldRoomBounds {
  return {
    minX: chunkBounds.minChunkX * WORLD_CHUNK_SIZE,
    maxX: (chunkBounds.maxChunkX + 1) * WORLD_CHUNK_SIZE - 1,
    minY: chunkBounds.minChunkY * WORLD_CHUNK_SIZE,
    maxY: (chunkBounds.maxChunkY + 1) * WORLD_CHUNK_SIZE - 1,
  };
}

export function createWorldWindowFromRoomBounds(bounds: WorldRoomBounds): WorldWindow {
  const centerX = Math.floor((bounds.minX + bounds.maxX) * 0.5);
  const centerY = Math.floor((bounds.minY + bounds.maxY) * 0.5);
  const radius = Math.max(
    centerX - bounds.minX,
    bounds.maxX - centerX,
    centerY - bounds.minY,
    bounds.maxY - centerY
  );

  return {
    center: { x: centerX, y: centerY },
    radius,
    rooms: [],
  };
}

export function createPublishedRoomSummary(room: RoomSnapshot): WorldRoomSummary {
  return {
    id: room.id,
    coordinates: { ...room.coordinates },
    title: room.title,
    state: 'published',
    background: room.background,
    goalType: room.goal?.type ?? null,
    version: room.version,
    publishedAt: room.publishedAt,
    course: null,
  };
}

export function createFrontierRoomSummary(coordinates: RoomCoordinates): WorldRoomSummary {
  return {
    id: roomIdFromCoordinates(coordinates),
    coordinates: { ...coordinates },
    title: null,
    state: 'frontier',
    background: null,
    goalType: null,
    version: null,
    publishedAt: null,
    course: null,
  };
}

export function computeWorldChunk(
  publishedRooms: RoomSnapshot[],
  coordinates: WorldChunkCoordinates
): WorldChunk {
  const roomBounds = getChunkRoomBounds(coordinates);

  return {
    id: chunkIdFromCoordinates(coordinates),
    coordinates: { ...coordinates },
    roomBounds,
    rooms: computeWorldSummariesInBounds(publishedRooms, roomBounds),
  };
}

export function computeWorldChunkWindow(
  publishedRooms: RoomSnapshot[],
  chunkBounds: WorldChunkBounds
): WorldChunkWindow {
  const chunks: WorldChunk[] = [];
  for (let chunkY = chunkBounds.minChunkY; chunkY <= chunkBounds.maxChunkY; chunkY += 1) {
    for (let chunkX = chunkBounds.minChunkX; chunkX <= chunkBounds.maxChunkX; chunkX += 1) {
      chunks.push(computeWorldChunk(publishedRooms, { x: chunkX, y: chunkY }));
    }
  }

  return {
    chunkBounds: { ...chunkBounds },
    roomBounds: getRoomBoundsForChunkBounds(chunkBounds),
    chunks,
  };
}

export function computeWorldWindow(
  publishedRooms: RoomSnapshot[],
  center: RoomCoordinates,
  radius: number
): WorldWindow {
  const bounds: WorldRoomBounds = {
    minX: center.x - radius,
    maxX: center.x + radius,
    minY: center.y - radius,
    maxY: center.y + radius,
  };

  return {
    center: { ...center },
    radius,
    rooms: computeWorldSummariesInBounds(publishedRooms, bounds),
  };
}

export function computeWorldSummariesFromPublishedSummariesInBounds(
  publishedRooms: WorldRoomSummary[],
  bounds: WorldRoomBounds
): WorldRoomSummary[] {
  const publishedById = new Map<string, WorldRoomSummary>();
  for (const room of publishedRooms) {
    if (room.state === 'published') {
      publishedById.set(room.id, room);
    }
  }

  const roomsById = new Map<string, WorldRoomSummary>();
  for (const room of publishedRooms) {
    if (room.state === 'published' && isWithinRoomBounds(room.coordinates, bounds)) {
      roomsById.set(room.id, { ...room, coordinates: { ...room.coordinates } });
    }
  }

  if (publishedById.size === 0) {
    if (isWithinRoomBounds(DEFAULT_ROOM_COORDINATES, bounds)) {
      const frontier = createFrontierRoomSummary(DEFAULT_ROOM_COORDINATES);
      roomsById.set(frontier.id, frontier);
    }

    return Array.from(roomsById.values()).sort(compareWorldSummaries);
  }

  for (const room of publishedById.values()) {
    for (const neighbor of getOrthogonalNeighbors(room.coordinates)) {
      const neighborId = roomIdFromCoordinates(neighbor);
      if (publishedById.has(neighborId)) continue;
      if (!isWithinRoomBounds(neighbor, bounds)) continue;
      if (roomsById.has(neighborId)) continue;

      roomsById.set(neighborId, createFrontierRoomSummary(neighbor));
    }
  }

  return Array.from(roomsById.values()).sort(compareWorldSummaries);
}

function computeWorldSummariesInBounds(
  publishedRooms: RoomSnapshot[],
  bounds: WorldRoomBounds
): WorldRoomSummary[] {
  const publishedById = new Map<string, RoomSnapshot>();
  for (const room of publishedRooms) {
    publishedById.set(room.id, room);
  }

  const roomsById = new Map<string, WorldRoomSummary>();
  for (const room of publishedRooms) {
    if (isWithinRoomBounds(room.coordinates, bounds)) {
      roomsById.set(room.id, createPublishedRoomSummary(room));
    }
  }

  if (publishedRooms.length === 0) {
    if (isWithinRoomBounds(DEFAULT_ROOM_COORDINATES, bounds)) {
      const frontier = createFrontierRoomSummary(DEFAULT_ROOM_COORDINATES);
      roomsById.set(frontier.id, frontier);
    }

    return Array.from(roomsById.values()).sort(compareWorldSummaries);
  }

  for (const room of publishedRooms) {
    for (const neighbor of getOrthogonalNeighbors(room.coordinates)) {
      const neighborId = roomIdFromCoordinates(neighbor);
      if (publishedById.has(neighborId)) continue;
      if (!isWithinRoomBounds(neighbor, bounds)) continue;
      if (roomsById.has(neighborId)) continue;

      roomsById.set(neighborId, createFrontierRoomSummary(neighbor));
    }
  }

  return Array.from(roomsById.values()).sort(compareWorldSummaries);
}

function compareWorldSummaries(a: WorldRoomSummary, b: WorldRoomSummary): number {
  if (a.coordinates.y !== b.coordinates.y) {
    return a.coordinates.y - b.coordinates.y;
  }

  return a.coordinates.x - b.coordinates.x;
}
