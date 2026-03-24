import Phaser from 'phaser';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';
import type { RoomCoordinates } from '../../persistence/roomModel';
import {
  isWithinRoomBounds,
  roomToChunkCoordinates,
  type WorldChunkBounds,
  type WorldRoomBounds,
  WORLD_CHUNK_SIZE,
} from '../../persistence/worldModel';
import type { PerformanceProfile } from '../../ui/deviceLayout';
import type { OverworldMode } from '../sceneData';

const STREAM_RADIUS = 1;
const PLAY_NEAR_MAX_CHUNK_RADIUS = 2;
const PLAY_MID_MAX_CHUNK_RADIUS = 3;
const PLAY_FAR_MAX_CHUNK_RADIUS = 4;
const PLAY_ULTRA_MAX_CHUNK_RADIUS = 4;
const REDUCED_PLAY_NEAR_MAX_CHUNK_RADIUS = 2;
const REDUCED_PLAY_MID_MAX_CHUNK_RADIUS = 2;
const REDUCED_PLAY_FAR_MAX_CHUNK_RADIUS = 3;
const REDUCED_PLAY_ULTRA_MAX_CHUNK_RADIUS = 3;
const BROWSE_MAX_CHUNK_RADIUS = 3;
const PLAY_NEAR_MAX_PREVIEW_ROOMS = 49;
const PLAY_MID_MAX_PREVIEW_ROOMS = 121;
const PLAY_FAR_MAX_PREVIEW_ROOMS = 196;
const PLAY_ULTRA_MAX_PREVIEW_ROOMS = 256;
const REDUCED_PLAY_NEAR_MAX_PREVIEW_ROOMS = 25;
const REDUCED_PLAY_MID_MAX_PREVIEW_ROOMS = 49;
const REDUCED_PLAY_FAR_MAX_PREVIEW_ROOMS = 81;
const REDUCED_PLAY_ULTRA_MAX_PREVIEW_ROOMS = 121;
const BROWSE_NEAR_MAX_PREVIEW_ROOMS = 64;
const BROWSE_MID_MAX_PREVIEW_ROOMS = 144;
const BROWSE_FAR_MAX_PREVIEW_ROOMS = 256;
const PLAY_NEAR_MID_LOD_ROOM_RADIUS = 5;
const PLAY_MID_MID_LOD_ROOM_RADIUS = 9;
const PLAY_FAR_MID_LOD_ROOM_RADIUS = 13;
const PLAY_ULTRA_MID_LOD_ROOM_RADIUS = 17;
const REDUCED_PLAY_NEAR_MID_LOD_ROOM_RADIUS = 4;
const REDUCED_PLAY_MID_MID_LOD_ROOM_RADIUS = 6;
const REDUCED_PLAY_FAR_MID_LOD_ROOM_RADIUS = 8;
const REDUCED_PLAY_ULTRA_MID_LOD_ROOM_RADIUS = 10;
const BROWSE_NEAR_MID_LOD_ROOM_RADIUS = 6;
const BROWSE_MID_MID_LOD_ROOM_RADIUS = 10;
const BROWSE_FAR_MID_LOD_ROOM_RADIUS = 14;
const MIN_ZOOM = 0.08;
const FULL_ROOM_BUDGET = (STREAM_RADIUS * 2 + 1) ** 2;
const PLAY_ULTRA_ZOOM_THRESHOLD = 0.11;
const PLAY_FAR_ZOOM_THRESHOLD = 0.16;
const PLAY_MID_ZOOM_THRESHOLD = 0.28;
const VIEWPORT_ROOM_PADDING = 1;

export interface PreviewSelectionCandidate {
  id: string;
  coordinates: RoomCoordinates;
  isRenderable: boolean;
  allowFullRoomLoad: boolean;
}

export interface OverworldPreviewSelection {
  previewRoomBudget: number;
  fullRoomBudget: number;
  protectedVisiblePreviewRoomCount: number;
  nearLodRoomIds: Set<string>;
  midLodRoomIds: Set<string>;
  farLodRoomIds: Set<string>;
  previewRoomIds: Set<string>;
  fullRoomIds: Set<string>;
}

interface OverworldPreviewSelectionInput {
  mode: OverworldMode;
  performanceProfile: PerformanceProfile;
  zoom: number;
  focusCoordinates: RoomCoordinates;
  roomCandidates: Iterable<PreviewSelectionCandidate>;
  visibleRoomBounds: WorldRoomBounds | null;
}

interface StreamingBudgetResult {
  previewRoomBudget: number;
  fullRoomBudget: number;
}

type PlayPreviewTier = 'near' | 'mid' | 'far' | 'ultra';

export function getDesiredChunkBounds(input: {
  centerCoordinates: RoomCoordinates;
  mode: OverworldMode;
  performanceProfile: PerformanceProfile;
  zoom: number;
  viewportWidth: number;
  viewportHeight: number;
}): WorldChunkBounds {
  const { centerCoordinates, mode, performanceProfile, viewportWidth, viewportHeight } = input;
  const zoom = Math.max(input.zoom, MIN_ZOOM);
  const chunkCenter = roomToChunkCoordinates(centerCoordinates);
  const visibleRoomsX = Math.ceil(viewportWidth / (ROOM_PX_WIDTH * zoom));
  const visibleRoomsY = Math.ceil(viewportHeight / (ROOM_PX_HEIGHT * zoom));
  const paddedRoomRadius = Math.max(
    STREAM_RADIUS + 1,
    Math.ceil(Math.max(visibleRoomsX, visibleRoomsY) * 0.5) + 2
  );
  const maxChunkRadius = getMaxChunkRadius(mode, zoom, performanceProfile);
  const chunkRadius = Phaser.Math.Clamp(
    Math.ceil(paddedRoomRadius / WORLD_CHUNK_SIZE),
    1,
    maxChunkRadius
  );

  return {
    minChunkX: chunkCenter.x - chunkRadius,
    maxChunkX: chunkCenter.x + chunkRadius,
    minChunkY: chunkCenter.y - chunkRadius,
    maxChunkY: chunkCenter.y + chunkRadius,
  };
}

export function computeOverworldPreviewSelection(
  input: OverworldPreviewSelectionInput
): OverworldPreviewSelection {
  const { focusCoordinates, mode, performanceProfile } = input;
  const zoom = Math.max(input.zoom, MIN_ZOOM);
  const roomCandidates = Array.from(input.roomCandidates);
  const budgets = computeStreamingBudgets(mode, zoom, performanceProfile);
  const midLodRoomRadius = getMidLodRoomRadius(mode, zoom, performanceProfile);
  const visibleRoomBounds = input.visibleRoomBounds
    ? expandRoomBounds(input.visibleRoomBounds, VIEWPORT_ROOM_PADDING)
    : null;
  const nearLodRoomIds = new Set<string>();
  const midLodRoomIds = new Set<string>();
  const farLodRoomIds = new Set<string>();

  for (const roomCandidate of roomCandidates) {
    const deltaX = Math.abs(roomCandidate.coordinates.x - focusCoordinates.x);
    const deltaY = Math.abs(roomCandidate.coordinates.y - focusCoordinates.y);

    if (deltaX <= STREAM_RADIUS && deltaY <= STREAM_RADIUS) {
      nearLodRoomIds.add(roomCandidate.id);
      continue;
    }

    if (deltaX <= midLodRoomRadius && deltaY <= midLodRoomRadius) {
      midLodRoomIds.add(roomCandidate.id);
      continue;
    }

    farLodRoomIds.add(roomCandidate.id);
  }

  const previewEligibleRoomIds = new Set<string>([
    ...nearLodRoomIds,
    ...midLodRoomIds,
    ...farLodRoomIds,
  ]);
  const visibleRoomIds = new Set(
    roomCandidates
      .filter(
        (roomCandidate) =>
          roomCandidate.isRenderable &&
          visibleRoomBounds !== null &&
          isWithinRoomBounds(roomCandidate.coordinates, visibleRoomBounds)
      )
      .map((roomCandidate) => roomCandidate.id)
  );
  const effectivePreviewBudget = Math.max(
    budgets.previewRoomBudget,
    visibleRoomIds.size
  );

  return {
    previewRoomBudget: effectivePreviewBudget,
    fullRoomBudget: budgets.fullRoomBudget,
    protectedVisiblePreviewRoomCount: visibleRoomIds.size,
    nearLodRoomIds,
    midLodRoomIds,
    farLodRoomIds,
    previewRoomIds: selectPrioritizedRoomIds({
      roomCandidates,
      eligibleRoomIds: previewEligibleRoomIds,
      nearLodRoomIds,
      midLodRoomIds,
      visibleRoomIds,
      focusCoordinates,
      budget: effectivePreviewBudget,
    }),
    fullRoomIds:
      mode === 'play'
        ? selectPrioritizedRoomIds({
            roomCandidates: roomCandidates.filter((roomCandidate) => roomCandidate.allowFullRoomLoad),
            eligibleRoomIds: new Set(
              roomCandidates
                .filter(
                  (roomCandidate) =>
                    roomCandidate.allowFullRoomLoad && nearLodRoomIds.has(roomCandidate.id)
                )
                .map((roomCandidate) => roomCandidate.id)
            ),
            nearLodRoomIds,
            midLodRoomIds,
            visibleRoomIds: new Set<string>(),
            focusCoordinates,
            budget: budgets.fullRoomBudget,
          })
        : new Set<string>(),
  };
}

function getMaxChunkRadius(
  mode: OverworldMode,
  zoom: number,
  performanceProfile: PerformanceProfile,
): number {
  if (mode === 'browse') {
    return BROWSE_MAX_CHUNK_RADIUS;
  }

  if (performanceProfile === 'reduced') {
    switch (getPlayPreviewTier(zoom)) {
      case 'ultra':
        return REDUCED_PLAY_ULTRA_MAX_CHUNK_RADIUS;
      case 'far':
        return REDUCED_PLAY_FAR_MAX_CHUNK_RADIUS;
      case 'mid':
        return REDUCED_PLAY_MID_MAX_CHUNK_RADIUS;
      case 'near':
      default:
        return REDUCED_PLAY_NEAR_MAX_CHUNK_RADIUS;
    }
  }

  switch (getPlayPreviewTier(zoom)) {
    case 'ultra':
      return PLAY_ULTRA_MAX_CHUNK_RADIUS;
    case 'far':
      return PLAY_FAR_MAX_CHUNK_RADIUS;
    case 'mid':
      return PLAY_MID_MAX_CHUNK_RADIUS;
    case 'near':
    default:
      return PLAY_NEAR_MAX_CHUNK_RADIUS;
  }
}

function getMidLodRoomRadius(
  mode: OverworldMode,
  zoom: number,
  performanceProfile: PerformanceProfile,
): number {
  if (mode === 'play') {
    if (performanceProfile === 'reduced') {
      switch (getPlayPreviewTier(zoom)) {
        case 'ultra':
          return REDUCED_PLAY_ULTRA_MID_LOD_ROOM_RADIUS;
        case 'far':
          return REDUCED_PLAY_FAR_MID_LOD_ROOM_RADIUS;
        case 'mid':
          return REDUCED_PLAY_MID_MID_LOD_ROOM_RADIUS;
        case 'near':
        default:
          return REDUCED_PLAY_NEAR_MID_LOD_ROOM_RADIUS;
      }
    }

    switch (getPlayPreviewTier(zoom)) {
      case 'ultra':
        return PLAY_ULTRA_MID_LOD_ROOM_RADIUS;
      case 'far':
        return PLAY_FAR_MID_LOD_ROOM_RADIUS;
      case 'mid':
        return PLAY_MID_MID_LOD_ROOM_RADIUS;
      case 'near':
      default:
        return PLAY_NEAR_MID_LOD_ROOM_RADIUS;
    }
  }

  if (zoom <= 0.12) {
    return BROWSE_FAR_MID_LOD_ROOM_RADIUS;
  }

  if (zoom <= 0.2) {
    return BROWSE_MID_MID_LOD_ROOM_RADIUS;
  }

  return BROWSE_NEAR_MID_LOD_ROOM_RADIUS;
}

function computeStreamingBudgets(
  mode: OverworldMode,
  zoom: number,
  performanceProfile: PerformanceProfile,
): StreamingBudgetResult {
  if (mode === 'play') {
    if (performanceProfile === 'reduced') {
      switch (getPlayPreviewTier(zoom)) {
        case 'ultra':
          return {
            previewRoomBudget: REDUCED_PLAY_ULTRA_MAX_PREVIEW_ROOMS,
            fullRoomBudget: FULL_ROOM_BUDGET,
          };
        case 'far':
          return {
            previewRoomBudget: REDUCED_PLAY_FAR_MAX_PREVIEW_ROOMS,
            fullRoomBudget: FULL_ROOM_BUDGET,
          };
        case 'mid':
          return {
            previewRoomBudget: REDUCED_PLAY_MID_MAX_PREVIEW_ROOMS,
            fullRoomBudget: FULL_ROOM_BUDGET,
          };
        case 'near':
        default:
          return {
            previewRoomBudget: REDUCED_PLAY_NEAR_MAX_PREVIEW_ROOMS,
            fullRoomBudget: FULL_ROOM_BUDGET,
          };
      }
    }

    switch (getPlayPreviewTier(zoom)) {
      case 'ultra':
        return {
          previewRoomBudget: PLAY_ULTRA_MAX_PREVIEW_ROOMS,
          fullRoomBudget: FULL_ROOM_BUDGET,
        };
      case 'far':
        return {
          previewRoomBudget: PLAY_FAR_MAX_PREVIEW_ROOMS,
          fullRoomBudget: FULL_ROOM_BUDGET,
        };
      case 'mid':
        return {
          previewRoomBudget: PLAY_MID_MAX_PREVIEW_ROOMS,
          fullRoomBudget: FULL_ROOM_BUDGET,
        };
      case 'near':
      default:
        return {
          previewRoomBudget: PLAY_NEAR_MAX_PREVIEW_ROOMS,
          fullRoomBudget: FULL_ROOM_BUDGET,
        };
    }
  }

  if (zoom <= 0.12) {
    return {
      previewRoomBudget: BROWSE_FAR_MAX_PREVIEW_ROOMS,
      fullRoomBudget: 0,
    };
  }

  if (zoom <= 0.2) {
    return {
      previewRoomBudget: BROWSE_MID_MAX_PREVIEW_ROOMS,
      fullRoomBudget: 0,
    };
  }

  return {
    previewRoomBudget: BROWSE_NEAR_MAX_PREVIEW_ROOMS,
    fullRoomBudget: 0,
  };
}

function getPlayPreviewTier(zoom: number): PlayPreviewTier {
  if (zoom <= PLAY_ULTRA_ZOOM_THRESHOLD) {
    return 'ultra';
  }

  if (zoom <= PLAY_FAR_ZOOM_THRESHOLD) {
    return 'far';
  }

  if (zoom <= PLAY_MID_ZOOM_THRESHOLD) {
    return 'mid';
  }

  return 'near';
}

function expandRoomBounds(bounds: WorldRoomBounds, padding: number): WorldRoomBounds {
  return {
    minX: bounds.minX - padding,
    maxX: bounds.maxX + padding,
    minY: bounds.minY - padding,
    maxY: bounds.maxY + padding,
  };
}

function selectPrioritizedRoomIds(input: {
  roomCandidates: PreviewSelectionCandidate[];
  eligibleRoomIds: Set<string>;
  nearLodRoomIds: Set<string>;
  midLodRoomIds: Set<string>;
  visibleRoomIds: Set<string>;
  focusCoordinates: RoomCoordinates;
  budget: number;
}): Set<string> {
  const {
    roomCandidates,
    eligibleRoomIds,
    nearLodRoomIds,
    midLodRoomIds,
    visibleRoomIds,
    focusCoordinates,
    budget,
  } = input;
  if (budget <= 0 || eligibleRoomIds.size === 0) {
    return new Set();
  }

  const candidateById = new Map(roomCandidates.map((candidate) => [candidate.id, candidate]));
  const prioritized = Array.from(eligibleRoomIds.values())
    .map((roomId) => candidateById.get(roomId) ?? null)
    .filter(
      (roomCandidate): roomCandidate is PreviewSelectionCandidate =>
        roomCandidate !== null && roomCandidate.isRenderable
    )
    .sort((left, right) => {
      const leftVisible = visibleRoomIds.has(left.id);
      const rightVisible = visibleRoomIds.has(right.id);
      if (leftVisible !== rightVisible) {
        return leftVisible ? -1 : 1;
      }

      const leftBucket = nearLodRoomIds.has(left.id) ? 0 : midLodRoomIds.has(left.id) ? 1 : 2;
      const rightBucket = nearLodRoomIds.has(right.id) ? 0 : midLodRoomIds.has(right.id) ? 1 : 2;
      if (leftBucket !== rightBucket) {
        return leftBucket - rightBucket;
      }

      const leftDistance =
        Math.abs(left.coordinates.x - focusCoordinates.x) +
        Math.abs(left.coordinates.y - focusCoordinates.y);
      const rightDistance =
        Math.abs(right.coordinates.x - focusCoordinates.x) +
        Math.abs(right.coordinates.y - focusCoordinates.y);
      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }

      if (left.coordinates.y !== right.coordinates.y) {
        return left.coordinates.y - right.coordinates.y;
      }

      return left.coordinates.x - right.coordinates.x;
    });

  return new Set(prioritized.slice(0, budget).map((roomCandidate) => roomCandidate.id));
}
