import {
  TILE_SIZE,
  getObjectById,
  getObjectDisplayOffset,
  type PlacedObject,
} from '../config';
import type { RoomSnapshot } from '../persistence/roomModel';
import type {
  SwordsmanSurfaceSegment,
  SwordsmanTraversalEdge,
} from './swordsmanTraversal';

const LADDER_SURFACE_ATTACH_TOLERANCE_X_PX = TILE_SIZE * 1.25;
const LADDER_SURFACE_ATTACH_TOLERANCE_Y_PX = TILE_SIZE * 1.5;
const LADDER_VERTICAL_MERGE_GAP_PX = TILE_SIZE * 1.25;
const LADDER_COLUMN_MERGE_TOLERANCE_X_PX = TILE_SIZE * 0.5;
const LADDER_MIN_VERTICAL_DELTA_PX = TILE_SIZE * 0.75;
const NODE_MARGIN_PX = TILE_SIZE * 0.5;

export interface SwordsmanLadderSegment {
  id: string;
  centerX: number;
  topY: number;
  bottomY: number;
}

interface SwordsmanLadderSurfaceAttachment {
  surface: SwordsmanSurfaceSegment;
  anchorX: number;
}

export function buildLadderSegments(room: RoomSnapshot): SwordsmanLadderSegment[] {
  const ladderConfig = getObjectById('ladder');
  if (!ladderConfig) {
    return [];
  }

  const rawSegments = room.placedObjects
    .map((placed, index) => buildPlacedLadderSegment(placed, index, ladderConfig))
    .filter((segment): segment is SwordsmanLadderSegment => segment !== null)
    .sort((left, right) => left.centerX - right.centerX || left.topY - right.topY);
  const mergedSegments: SwordsmanLadderSegment[] = [];

  for (const segment of rawSegments) {
    const existing = mergedSegments.find((candidate) => {
      const sameColumn =
        Math.abs(candidate.centerX - segment.centerX) <= LADDER_COLUMN_MERGE_TOLERANCE_X_PX;
      const verticalTouching =
        segment.topY <= candidate.bottomY + LADDER_VERTICAL_MERGE_GAP_PX &&
        segment.bottomY >= candidate.topY - LADDER_VERTICAL_MERGE_GAP_PX;
      return sameColumn && verticalTouching;
    });

    if (!existing) {
      mergedSegments.push({ ...segment });
      continue;
    }

    existing.id = `${existing.id}+${segment.id}`;
    existing.centerX = (existing.centerX + segment.centerX) * 0.5;
    existing.topY = Math.min(existing.topY, segment.topY);
    existing.bottomY = Math.max(existing.bottomY, segment.bottomY);
  }

  return mergedSegments;
}

function buildPlacedLadderSegment(
  placed: PlacedObject,
  index: number,
  ladderConfig: NonNullable<ReturnType<typeof getObjectById>>,
): SwordsmanLadderSegment | null {
  if (placed.id !== 'ladder' || ladderConfig.bodyWidth <= 0 || ladderConfig.bodyHeight <= 0) {
    return null;
  }

  const displayOffset = getObjectDisplayOffset(ladderConfig);
  const spriteX = placed.x + displayOffset.x;
  const spriteY = placed.y + displayOffset.y;
  const bodyOffsetX =
    ladderConfig.bodyOffsetX ?? Math.max(0, (ladderConfig.frameWidth - ladderConfig.bodyWidth) * 0.5);
  const bodyOffsetY =
    ladderConfig.bodyOffsetY ?? Math.max(0, (ladderConfig.frameHeight - ladderConfig.bodyHeight) * 0.5);
  const leftX = spriteX - ladderConfig.frameWidth * 0.5 + bodyOffsetX;
  const topY = spriteY - ladderConfig.frameHeight * 0.5 + bodyOffsetY;

  return {
    id: `ladder:${placed.instanceId ?? index}:${Math.round(spriteX)}:${Math.round(topY)}`,
    centerX: leftX + ladderConfig.bodyWidth * 0.5,
    topY,
    bottomY: topY + ladderConfig.bodyHeight,
  };
}

export function buildLadderEdges(
  ladderSegments: readonly SwordsmanLadderSegment[],
  surfaceSegments: readonly SwordsmanSurfaceSegment[],
): SwordsmanTraversalEdge[] {
  const edges: SwordsmanTraversalEdge[] = [];

  for (const ladder of ladderSegments) {
    const attachments = surfaceSegments
      .map((surface) => getLadderSurfaceAttachment(ladder, surface))
      .filter((attachment): attachment is SwordsmanLadderSurfaceAttachment => attachment !== null)
      .sort((left, right) => left.surface.topY - right.surface.topY);

    for (const source of attachments) {
      for (const target of attachments) {
        const verticalDelta = target.surface.topY - source.surface.topY;
        if (Math.abs(verticalDelta) < LADDER_MIN_VERTICAL_DELTA_PX) {
          continue;
        }

        const type = verticalDelta < 0 ? 'ladder-up' : 'ladder-down';
        const directionX = directionFromDelta(ladder.centerX - source.surface.centerX, 1);
        edges.push({
          id: `${source.surface.id}->${target.surface.id}:${ladder.id}:${type}`,
          type,
          fromId: source.surface.id,
          toId: target.surface.id,
          directionX,
          setupX: source.anchorX,
          targetX: target.anchorX,
          allowEdgeDrop: false,
          ladderX: ladder.centerX,
          ladderTopY: ladder.topY,
          ladderBottomY: ladder.bottomY,
        });
      }
    }
  }

  return edges;
}

function getLadderSurfaceAttachment(
  ladder: SwordsmanLadderSegment,
  surface: SwordsmanSurfaceSegment,
): SwordsmanLadderSurfaceAttachment | null {
  if (
    surface.topY < ladder.topY - LADDER_SURFACE_ATTACH_TOLERANCE_Y_PX ||
    surface.topY > ladder.bottomY + LADDER_SURFACE_ATTACH_TOLERANCE_Y_PX
  ) {
    return null;
  }

  const anchorX = getSurfaceAnchorNearestX(surface, ladder.centerX);
  if (Math.abs(anchorX - ladder.centerX) > LADDER_SURFACE_ATTACH_TOLERANCE_X_PX) {
    return null;
  }

  return { surface, anchorX };
}

function getSurfaceMinAnchorX(segment: SwordsmanSurfaceSegment): number {
  return segment.leftX + NODE_MARGIN_PX;
}

function getSurfaceMaxAnchorX(segment: SwordsmanSurfaceSegment): number {
  return segment.rightX - NODE_MARGIN_PX;
}

function getSurfaceAnchorNearestX(segment: SwordsmanSurfaceSegment, targetX: number): number {
  return clamp(targetX, getSurfaceMinAnchorX(segment), getSurfaceMaxAnchorX(segment));
}

function directionFromDelta(delta: number, fallback: number): -1 | 1 {
  if (delta > 0.01) {
    return 1;
  }
  if (delta < -0.01) {
    return -1;
  }
  return fallback >= 0 ? 1 : -1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
