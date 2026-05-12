import {
  decodeTileDataValue,
  getObjectById,
  isDynamicRuntimeObjectConfig,
  isPushableObjectConfig,
  isSolidRuntimeObjectConfig,
} from '../../config';
import { roomIdFromCoordinates, type RoomCoordinates, type RoomSnapshot } from '../../persistence/roomModel';

const LOCAL_PRESSURE_ENABLE_THRESHOLD = 620;
const LOCAL_PRESSURE_DISABLE_THRESHOLD = 500;
const LOCAL_PRESSURE_REDUCED_FULL_ROOM_BUDGET = 1;

export type LocalPlayPressureProfile = 'normal' | 'reduced';

export interface LocalPlayPressureRoomBreakdown {
  roomId: string;
  coordinates: RoomCoordinates;
  weight: number;
  roomScore: number;
  weightedRoomScore: number;
  dynamicBodyCount: number;
  pushableCount: number;
  pressurePlateCount: number;
  solidRuntimeObjectCount: number;
  terrainTileCount: number;
}

export interface LocalPlayPressureMetrics {
  profile: LocalPlayPressureProfile;
  score: number;
  fullRoomBudgetOverride: number | null;
  roomBreakdowns: LocalPlayPressureRoomBreakdown[];
}

function createEmptyMetrics(): LocalPlayPressureMetrics {
  return {
    profile: 'normal',
    score: 0,
    fullRoomBudgetOverride: null,
    roomBreakdowns: [],
  };
}

export function computeLocalPlayPressureMetrics(input: {
  focusCoordinates: RoomCoordinates;
  getRoomSnapshot: (coordinates: RoomCoordinates) => RoomSnapshot | null;
  wasReduced: boolean;
}): LocalPlayPressureMetrics {
  const roomBreakdowns: LocalPlayPressureRoomBreakdown[] = [];
  let score = 0;

  for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
    for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
      const coordinates = {
        x: input.focusCoordinates.x + deltaX,
        y: input.focusCoordinates.y + deltaY,
      };
      const room = input.getRoomSnapshot(coordinates);
      if (!room) {
        continue;
      }

      const weight = getNeighborhoodWeight(deltaX, deltaY);
      const roomBreakdown = computeRoomBreakdown(room, weight);
      roomBreakdowns.push(roomBreakdown);
      score += roomBreakdown.weightedRoomScore;
    }
  }

  const roundedScore = Number(score.toFixed(1));
  const threshold = input.wasReduced
    ? LOCAL_PRESSURE_DISABLE_THRESHOLD
    : LOCAL_PRESSURE_ENABLE_THRESHOLD;
  const reduced = roundedScore >= threshold;

  return {
    profile: reduced ? 'reduced' : 'normal',
    score: roundedScore,
    fullRoomBudgetOverride: reduced ? LOCAL_PRESSURE_REDUCED_FULL_ROOM_BUDGET : null,
    roomBreakdowns,
  };
}

export function createDefaultLocalPlayPressureMetrics(): LocalPlayPressureMetrics {
  return createEmptyMetrics();
}

function getNeighborhoodWeight(deltaX: number, deltaY: number): number {
  if (deltaX === 0 && deltaY === 0) {
    return 1;
  }

  if (deltaX === 0 || deltaY === 0) {
    return 0.7;
  }

  return 0.4;
}

function computeRoomBreakdown(
  room: RoomSnapshot,
  weight: number,
): LocalPlayPressureRoomBreakdown {
  let dynamicBodyCount = 0;
  let pushableCount = 0;
  let pressurePlateCount = 0;
  let solidRuntimeObjectCount = 0;

  for (const placedObject of room.placedObjects) {
    const config = getObjectById(placedObject.id);
    if (!config) {
      continue;
    }

    if (isDynamicRuntimeObjectConfig(config)) {
      dynamicBodyCount += 1;
    }
    if (isPushableObjectConfig(config)) {
      pushableCount += 1;
    }
    if (placedObject.id === 'floor_trigger') {
      pressurePlateCount += 1;
    }
    if (isSolidRuntimeObjectConfig(config)) {
      solidRuntimeObjectCount += 1;
    }
  }

  let terrainTileCount = 0;
  for (const row of room.tileData.terrain) {
    for (const value of row) {
      if (decodeTileDataValue(value).gid > 0) {
        terrainTileCount += 1;
      }
    }
  }

  const roomScore =
    pushableCount * 12
    + dynamicBodyCount * 8
    + pressurePlateCount * 20
    + solidRuntimeObjectCount * 2
    + terrainTileCount / 50;
  const roundedRoomScore = Number(roomScore.toFixed(1));

  return {
    roomId: roomIdFromCoordinates(room.coordinates),
    coordinates: { ...room.coordinates },
    weight,
    roomScore: roundedRoomScore,
    weightedRoomScore: Number((roundedRoomScore * weight).toFixed(1)),
    dynamicBodyCount,
    pushableCount,
    pressurePlateCount,
    solidRuntimeObjectCount,
    terrainTileCount,
  };
}
