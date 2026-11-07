import { ROOM_HEIGHT, ROOM_WIDTH, TILE_SIZE } from '../config';
import {
  isFloorTriangle,
  normalizePlacedTriangle,
  triangleFloorHighTip,
  triangleFloorSurfaceYAt,
} from '../config/trianglePiece';
import { SWORDSMAN_AI_JUMP_LANDING_INSET_PX } from './swordsmanTuning';
import type { RoomSnapshot } from '../persistence/roomModel';
import {
  getTerrainTileCollisionProfile,
  roomHasTerrainTile,
} from '../scenes/overworld/terrainCollision';
import type {
  SwordsmanBodySnapshot,
  SwordsmanSurfaceSegment,
  SwordsmanTraversalEdge,
  SwordsmanTraversalGraph,
  SwordsmanWallSegment,
} from './swordsmanTraversal';

const NODE_MARGIN_PX = TILE_SIZE * 0.5;

/**
 * One walkable surface per floor triangle so hunters can path on/off ramps.
 * topY is the high tip (crest); matching uses the hypotenuse at the body's X.
 */
export function appendTriangleSurfaceSegments(
  room: RoomSnapshot,
  segments: SwordsmanSurfaceSegment[],
): void {
  let index = 0;
  for (const placed of room.placedObjects) {
    const geometry = normalizePlacedTriangle(placed);
    if (!geometry || !isFloorTriangle(geometry.legY) || geometry.legX === 0) {
      continue;
    }

    const leftX = Math.min(geometry.anchorX, geometry.anchorX + geometry.legX);
    const rightX = Math.max(geometry.anchorX, geometry.anchorX + geometry.legX);
    if (rightX - leftX < 8) {
      continue;
    }

    const highTipY = Math.min(geometry.anchorY, geometry.anchorY + geometry.legY);
    const lowTipY = Math.max(geometry.anchorY, geometry.anchorY + geometry.legY);
    const leftTipY =
      triangleFloorSurfaceYAt(
        geometry.anchorX,
        geometry.anchorY,
        geometry.legX,
        geometry.legY,
        leftX,
      ) ?? lowTipY;
    const rightTipY =
      triangleFloorSurfaceYAt(
        geometry.anchorX,
        geometry.anchorY,
        geometry.legX,
        geometry.legY,
        rightX,
      ) ?? lowTipY;

    const leftTileX = Math.floor(leftX / TILE_SIZE);
    const rightTileX = Math.max(leftTileX, Math.ceil(rightX / TILE_SIZE) - 1);
    // Vertical tips are walls — never mark them walk-off/drop open (that sent
    // hunters into the face and locked them in a tip reverse loop). Solid tiles
    // past a tip also close it (ramp jammed against a wall is not a ledge).
    const leftIsVerticalTip = Math.abs(leftX - geometry.anchorX) <= 1;
    const rightIsVerticalTip = Math.abs(rightX - geometry.anchorX) <= 1;
    const hasOpenLeft =
      !leftIsVerticalTip
      && !triangleTipHasFlushFloor(room, leftX - 1, leftTipY)
      && !triangleTipHasSolidOutside(room, leftX, leftTipY, -1);
    const hasOpenRight =
      !rightIsVerticalTip
      && !triangleTipHasFlushFloor(room, rightX + 1, rightTipY)
      && !triangleTipHasSolidOutside(room, rightX, rightTipY, 1);

    segments.push({
      id: `surface:triangle:${index}`,
      kind: 'surface',
      tileY: Math.floor(highTipY / TILE_SIZE),
      topY: highTipY,
      leftTileX,
      rightTileX,
      leftX,
      rightX,
      centerX: (leftX + rightX) * 0.5,
      hasOpenLeft,
      hasOpenRight,
      triangle: {
        anchorX: geometry.anchorX,
        anchorY: geometry.anchorY,
        legX: geometry.legX,
        legY: geometry.legY,
      },
    });
    index += 1;
  }
}

function triangleTipHasFlushFloor(
  room: RoomSnapshot,
  worldX: number,
  tipY: number,
): boolean {
  const tileX = Math.floor(worldX / TILE_SIZE);
  const tipTileY = Math.floor(tipY / TILE_SIZE);
  // Same row or one above (crest seating onto a platform top).
  for (const tileY of [tipTileY, tipTileY - 1]) {
    if (tileY < 0 || tileY >= ROOM_HEIGHT) {
      continue;
    }
    if (tileX < 0 || tileX >= ROOM_WIDTH) {
      continue;
    }
    const profile = getTerrainTileCollisionProfile(room, tileX, tileY);
    if (!profile.hasCollision || roomHasTerrainTile(room, tileX, tileY - 1)) {
      continue;
    }
    const topY = tileY * TILE_SIZE + profile.topInset;
    if (Math.abs(topY - tipY) <= 6) {
      return true;
    }
  }
  return false;
}

function triangleTipHasSolidOutside(
  room: RoomSnapshot,
  tipX: number,
  tipY: number,
  outwardX: -1 | 1,
): boolean {
  const tileX = Math.floor((tipX + outwardX * 2) / TILE_SIZE);
  const tipTileY = Math.floor(tipY / TILE_SIZE);
  for (const tileY of [tipTileY, tipTileY - 1, tipTileY + 1]) {
    if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) {
      continue;
    }
    if (roomHasTerrainTile(room, tileX, tileY)) {
      return true;
    }
  }
  return false;
}

/** Wall face beside a tip above the floor plane — not flush floor continuing underfoot. */
function triangleTipHasBlockingWallOutside(
  room: RoomSnapshot,
  tipX: number,
  tipY: number,
  outwardX: -1 | 1,
): boolean {
  const tileX = Math.floor((tipX + outwardX * 2) / TILE_SIZE);
  const tipTileY = Math.floor(tipY / TILE_SIZE);
  for (const tileY of [tipTileY - 1, tipTileY - 2, tipTileY - 3]) {
    if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) {
      continue;
    }
    if (roomHasTerrainTile(room, tileX, tileY)) {
      return true;
    }
  }
  return false;
}

/** Vertical legs of placed triangles act as climbable walls for Sword Hunter. */
export function appendTriangleWallSegments(
  room: RoomSnapshot,
  segments: SwordsmanWallSegment[],
): void {
  let index = 0;
  for (const placed of room.placedObjects) {
    const geometry = normalizePlacedTriangle(placed);
    if (!geometry || geometry.legX === 0) {
      continue;
    }

    const topY = Math.min(geometry.anchorY, geometry.anchorY + geometry.legY);
    const bottomY = Math.max(geometry.anchorY, geometry.anchorY + geometry.legY);
    if (bottomY - topY < 8) {
      continue;
    }

    // Outward normal of the vertical leg (same as triangleEdges in trianglePiece).
    const vertOutNx = geometry.legX < 0 ? 1 : -1;
    // Body on the open side: left contact when wall faces right, and vice versa.
    const contactSide = (vertOutNx > 0 ? -1 : 1) as -1 | 1;
    const jumpDirectionX = (-contactSide) as -1 | 1;

    segments.push({
      id: `wall:triangle:${index}`,
      kind: 'wall',
      tileX: Math.floor(geometry.anchorX / TILE_SIZE),
      side: contactSide === 1 ? 'left' : 'right',
      x: geometry.anchorX,
      topY,
      bottomY,
      centerY: (topY + bottomY) * 0.5,
      contactSide,
      jumpDirectionX,
    });
    index += 1;
  }
}

/**
 * Two floor triangles that share a high tip (mountain peak) need a walk edge
 * over the crest. Jump-to-wall / tip-clear jumps on the paired vertical send
 * hunters back down the side they climbed.
 */
export function buildTriangleCrestTransferEdge(
  source: SwordsmanSurfaceSegment,
  target: SwordsmanSurfaceSegment,
): SwordsmanTraversalEdge | null {
  if (!source.triangle || !target.triangle) {
    return null;
  }

  const sourceTip = triangleFloorHighTip(
    source.triangle.anchorX,
    source.triangle.anchorY,
    source.triangle.legX,
    source.triangle.legY,
  );
  const targetTip = triangleFloorHighTip(
    target.triangle.anchorX,
    target.triangle.anchorY,
    target.triangle.legX,
    target.triangle.legY,
  );
  if (!sourceTip || !targetTip) {
    return null;
  }
  if (Math.abs(sourceTip.x - targetTip.x) > 6 || Math.abs(sourceTip.y - targetTip.y) > 6) {
    return null;
  }

  const sourceSide = Math.sign(source.centerX - sourceTip.x);
  const targetSide = Math.sign(target.centerX - targetTip.x);
  if (sourceSide === 0 || targetSide === 0 || sourceSide === targetSide) {
    return null;
  }

  const directionX = (-sourceSide) as -1 | 1;
  const setupX = clamp(
    sourceTip.x - directionX * 4,
    source.leftX,
    source.rightX,
  );
  const targetX = clamp(
    targetTip.x + directionX * 10,
    target.leftX,
    target.rightX,
  );
  if (Math.sign(targetX - setupX) !== directionX) {
    return null;
  }

  return {
    id: `${source.id}->${target.id}:crest-walk:${directionX > 0 ? 'right' : 'left'}`,
    type: 'jump-gap',
    fromId: source.id,
    toId: target.id,
    directionX,
    setupX,
    targetX,
    allowEdgeDrop: false,
  };
}

/**
 * When a floor-triangle tip sits on (or flush with) another surface, hunters
 * need a walk-off edge. Standard jump-up setup requires approaching from
 * outside the target span, which fails for ramps nested on that floor.
 */
export function buildTriangleFloorTransferEdge(
  room: RoomSnapshot,
  source: SwordsmanSurfaceSegment,
  target: SwordsmanSurfaceSegment,
): SwordsmanTraversalEdge | null {
  if (!source.triangle || target.triangle) {
    return null;
  }

  const tipCandidates: Array<{ tipX: number; directionX: -1 | 1 }> = [
    { tipX: source.leftX, directionX: -1 },
    { tipX: source.rightX, directionX: 1 },
  ];

  let best: SwordsmanTraversalEdge | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const { tipX, directionX } of tipCandidates) {
    // Vertical tips are walls — only the horizontal (usually low) tip transfers.
    if (Math.abs(tipX - source.triangle.anchorX) <= 1) {
      continue;
    }

    const tipY = surfaceTopYNearBody(source, tipX);
    if (Math.abs(tipY - target.topY) > 6) {
      continue;
    }
    if (tipX < target.leftX - 4 || tipX > target.rightX + 4) {
      continue;
    }
    // Tip jammed against a blocking wall (not flush floor) is a corner trap.
    if (triangleTipHasBlockingWallOutside(room, tipX, tipY, directionX)) {
      continue;
    }

    const setupX = clamp(
      tipX - directionX * SWORDSMAN_AI_JUMP_LANDING_INSET_PX,
      source.leftX,
      source.rightX,
    );
    const targetX = clamp(
      tipX + directionX * SWORDSMAN_AI_JUMP_LANDING_INSET_PX,
      getSurfaceMinAnchorX(target),
      getSurfaceMaxAnchorX(target),
    );
    const horizontal = targetX - setupX;
    if (Math.abs(horizontal) < 1 || Math.sign(horizontal) !== directionX) {
      continue;
    }

    const score = Math.abs(setupX - source.centerX) + Math.abs(horizontal);
    if (score >= bestScore) {
      continue;
    }

    bestScore = score;
    best = {
      id: `${source.id}->${target.id}:triangle-transfer:${directionX > 0 ? 'right' : 'left'}`,
      type: 'jump-gap',
      fromId: source.id,
      toId: target.id,
      directionX,
      setupX,
      targetX,
      allowEdgeDrop: false,
    };
  }

  return best;
}

/**
 * Prefer an immediate crest-walk when it moves toward the chase target —
 * depth-3 search often prefers jumping off the wrong tip instead.
 */
export function findCrestWalkTowardTarget(
  graph: SwordsmanTraversalGraph,
  startNodeIds: readonly string[],
  targetNodeIds: readonly string[],
  enemyBody: SwordsmanBodySnapshot,
  targetBody: SwordsmanBodySnapshot,
  blockedEdgeIds: ReadonlySet<string>,
): SwordsmanTraversalEdge | null {
  // Avoid edgesByNodeId reads on non-triangle starts so route-list caching stays valid.
  const triangleStarts = startNodeIds.filter((startNodeId) => {
    const node = graph.nodesById.get(startNodeId);
    return node?.kind === 'surface' && Boolean(node.triangle);
  });
  if (triangleStarts.length === 0) {
    return null;
  }

  const targetIdSet = new Set(targetNodeIds);
  const targetDirection = directionFromDelta(
    targetBody.centerX - enemyBody.centerX,
    1,
  );
  const horizontalSpan = Math.abs(targetBody.centerX - enemyBody.centerX);
  let best: SwordsmanTraversalEdge | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const startNodeId of triangleStarts) {
    for (const edge of graph.edgesByNodeId.get(startNodeId) ?? []) {
      if (blockedEdgeIds.has(edge.id) || !edge.id.includes(':crest-walk:')) {
        continue;
      }
      const towardPartner = targetIdSet.has(edge.toId);
      const towardTargetSide =
        horizontalSpan > TILE_SIZE * 0.75 && edge.directionX === targetDirection;
      if (!towardPartner && !towardTargetSide) {
        continue;
      }
      const score =
        Math.abs(edge.setupX - enemyBody.centerX) + (towardPartner ? 0 : 40);
      if (score < bestScore) {
        best = edge;
        bestScore = score;
      }
    }
  }

  return best;
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

function surfaceTopYNearBody(segment: SwordsmanSurfaceSegment, localX: number): number {
  if (!segment.triangle) {
    return segment.topY;
  }
  return (
    triangleFloorSurfaceYAt(
      segment.triangle.anchorX,
      segment.triangle.anchorY,
      segment.triangle.legX,
      segment.triangle.legY,
      localX,
    ) ?? segment.topY
  );
}

function getSurfaceMinAnchorX(segment: SwordsmanSurfaceSegment): number {
  return segment.leftX + NODE_MARGIN_PX;
}

function getSurfaceMaxAnchorX(segment: SwordsmanSurfaceSegment): number {
  return segment.rightX - NODE_MARGIN_PX;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
