  import {
  ROOM_HEIGHT,
  ROOM_WIDTH,
  TILE_SIZE,
} from '../config';
import {
  SWORDSMAN_AI_DROP_SETUP_APPROACH_TOLERANCE_PX,
  SWORDSMAN_AI_DROP_SETUP_EDGE_INSET_PX,
  SWORDSMAN_AI_JUMP_LANDING_INSET_PX,
  SWORDSMAN_AI_JUMP_SETUP_APPROACH_TOLERANCE_PX,
  SWORDSMAN_AI_JUMP_SETUP_BACKOFF_PX,
  SWORDSMAN_AI_JUMP_SETUP_OVERSHOOT_TOLERANCE_PX,
  SWORDSMAN_AI_RELIABLE_JUMP_RISE_PX,
} from './swordsmanTuning';
import type { RoomSnapshot } from '../persistence/roomModel';
import {
  getTerrainTileCollisionProfile,
  roomHasTerrainTile,
} from '../scenes/overworld/terrainCollision';

export type SwordsmanTraversalIntent =
  | 'same-platform'
  | 'jump-up'
  | 'drop-down'
  | 'air-chase'
  | 'wall-jump'
  | 'blocked';

export interface SwordsmanSurfaceSegment {
  id: string;
  kind: 'surface';
  tileY: number;
  topY: number;
  leftTileX: number;
  rightTileX: number;
  leftX: number;
  rightX: number;
  centerX: number;
  hasOpenLeft: boolean;
  hasOpenRight: boolean;
}

export interface SwordsmanWallSegment {
  id: string;
  kind: 'wall';
  tileX: number;
  side: 'left' | 'right';
  x: number;
  topY: number;
  bottomY: number;
  centerY: number;
  contactSide: -1 | 1;
  jumpDirectionX: -1 | 1;
}

export interface SwordsmanTraversalEdge {
  id: string;
  type: 'jump-up' | 'jump-gap' | 'drop-down' | 'jump-to-wall' | 'wall-jump';
  fromId: string;
  toId: string;
  directionX: -1 | 1;
  setupX: number;
  targetX: number;
  allowEdgeDrop: boolean;
}

export type SwordsmanTraversalNode = SwordsmanSurfaceSegment | SwordsmanWallSegment;

export interface SwordsmanTraversalGraph {
  cacheKey: string;
  surfaceSegments: SwordsmanSurfaceSegment[];
  wallSegments: SwordsmanWallSegment[];
  nodesById: Map<string, SwordsmanTraversalNode>;
  edgesByNodeId: Map<string, SwordsmanTraversalEdge[]>;
  edgesById: Map<string, SwordsmanTraversalEdge>;
}

export interface SwordsmanTraversalContext {
  currentSurface: SwordsmanSurfaceSegment | null;
  currentWall: SwordsmanWallSegment | null;
  currentNodeId: string | null;
  startNodeIds: string[];
}

export interface SwordsmanTraversalTargetContext {
  targetSurface: SwordsmanSurfaceSegment | null;
  targetWall: SwordsmanWallSegment | null;
  targetNodeId: string | null;
  targetNodeIds: string[];
}

export interface SwordsmanBodySnapshot {
  centerX: number;
  centerY: number;
  left: number;
  right: number;
  bottom: number;
  onFloor: boolean;
  wallContactSide: -1 | 0 | 1;
}

export interface SwordsmanTraversalDecision {
  intent: SwordsmanTraversalIntent;
  directionX: -1 | 1;
  targetX: number;
  allowEdgeDrop: boolean;
  jumpVelocityX: number;
  jumpVelocityY: number;
  traversalEdgeId: string | null;
  traversalNextNodeId: string | null;
  currentSegmentId: string | null;
  targetSegmentId: string | null;
}

const SURFACE_MATCH_TOLERANCE_PX = 28;
const AIRBORNE_SURFACE_MATCH_TOLERANCE_PX = 64;
const WALL_MATCH_TOLERANCE_X_PX = 18;
const WALL_MATCH_TOLERANCE_Y_PX = 20;
const NODE_MARGIN_PX = TILE_SIZE * 0.5;
const JUMP_UP_MAX_VERTICAL_PX = SWORDSMAN_AI_RELIABLE_JUMP_RISE_PX;
const JUMP_UP_MAX_HORIZONTAL_PX = 126;
const JUMP_UP_MIN_VERTICAL_PX = 10;
const JUMP_GAP_MAX_DESCENT_PX = 18;
const DROP_DOWN_MAX_HORIZONTAL_PX = 96;
const DROP_DOWN_MIN_VERTICAL_PX = 12;
const JUMP_TO_WALL_MAX_VERTICAL_PX = 88;
const JUMP_TO_WALL_MAX_HORIZONTAL_PX = 84;
const WALL_JUMP_MIN_TARGET_RISE_PX = 24;
const WALL_JUMP_TO_SURFACE_MIN_VERTICAL_PX = 8;
const WALL_JUMP_TO_SURFACE_MAX_VERTICAL_PX = 86;
const WALL_JUMP_TO_SURFACE_MAX_HORIZONTAL_PX = 96;
const WALL_JUMP_PREFERRED_RISE_PX = 40;
const MAX_SEARCH_DEPTH = 3;
const TARGET_MATCH_SCORE_BONUS = 240;
const FALLBACK_DROP_EDGE_PREFIX = 'fallback-drop';

export function getSwordsmanTraversalGraphCacheKey(room: RoomSnapshot): string {
  return `${room.id}:${room.version}:${room.updatedAt}`;
}

export function buildSwordsmanTraversalGraph(room: RoomSnapshot): SwordsmanTraversalGraph {
  const surfaceSegments = buildSurfaceSegments(room);
  const wallSegments = buildWallSegments(room);
  const nodesById = new Map<string, SwordsmanTraversalNode>();
  const edgesByNodeId = new Map<string, SwordsmanTraversalEdge[]>();
  const edgesById = new Map<string, SwordsmanTraversalEdge>();

  for (const segment of surfaceSegments) {
    nodesById.set(segment.id, segment);
    edgesByNodeId.set(segment.id, []);
  }
  for (const wall of wallSegments) {
    nodesById.set(wall.id, wall);
    edgesByNodeId.set(wall.id, []);
  }

  const addEdge = (edge: SwordsmanTraversalEdge | null): void => {
    if (!edge) {
      return;
    }
    edgesByNodeId.get(edge.fromId)?.push(edge);
    edgesById.set(edge.id, edge);
  };

  for (const source of surfaceSegments) {
    for (const target of surfaceSegments) {
      if (source.id === target.id) {
        continue;
      }

      addEdge(buildJumpUpEdge(source, target, surfaceSegments));
      for (const dropEdge of buildDropDownEdges(room, source, target, surfaceSegments)) {
        addEdge(dropEdge);
      }
    }

    for (const wall of wallSegments) {
      addEdge(buildJumpToWallEdge(source, wall));
    }
  }

  for (const wall of wallSegments) {
    for (const target of surfaceSegments) {
      addEdge(buildWallJumpEdge(wall, target));
    }
  }

  return {
    cacheKey: getSwordsmanTraversalGraphCacheKey(room),
    surfaceSegments,
    wallSegments,
    nodesById,
    edgesByNodeId,
    edgesById,
  };
}

export function decideSwordsmanTraversal(
  graph: SwordsmanTraversalGraph,
  enemy: SwordsmanBodySnapshot,
  target: SwordsmanBodySnapshot,
  blockedEdgeIds: ReadonlySet<string> = new Set<string>(),
): SwordsmanTraversalDecision {
  const currentContext = getSwordsmanTraversalContext(graph, enemy);
  const currentSurface = currentContext.currentSurface;
  const targetContext = getSwordsmanTraversalTargetContext(graph, target);
  const targetSurface = targetContext.targetSurface;
  const fallbackDirectionX = (target.centerX >= enemy.centerX ? 1 : -1) as -1 | 1;
  const fallbackTargetX = targetSurface?.centerX ?? target.centerX;
  const currentNodeId = currentContext.currentNodeId;
  const targetNodeId = targetContext.targetNodeId;
  const baseDecision = (
    intent: SwordsmanTraversalIntent,
    overrides: Partial<SwordsmanTraversalDecision> = {},
  ): SwordsmanTraversalDecision => ({
    intent,
    directionX: fallbackDirectionX,
    targetX: fallbackTargetX,
    allowEdgeDrop: false,
    jumpVelocityX: 0,
    jumpVelocityY: 0,
    traversalEdgeId: null,
    traversalNextNodeId: null,
    currentSegmentId: currentNodeId,
    targetSegmentId: targetNodeId,
    ...overrides,
  });

  if (currentSurface && targetSurface && currentSurface.id === targetSurface.id) {
    return baseDecision('same-platform', {
      targetX: target.centerX,
    });
  }

  const startNodeIds = currentContext.startNodeIds;
  const targetNodeIds = targetContext.targetNodeIds;
  const bestPath = findBestTraversalPath(
    graph,
    startNodeIds,
    targetNodeIds,
    enemy,
    target,
    blockedEdgeIds,
  );
  if (bestPath) {
    const firstEdge = bestPath.edges[0] ?? null;
    if (firstEdge) {
      return buildSwordsmanTraversalDecisionFromEdge(
        firstEdge,
        enemy,
        fallbackDirectionX,
        fallbackTargetX,
        currentNodeId,
        targetNodeId,
        target,
      );
    }
  }

  if (!enemy.onFloor) {
    if (
      enemy.wallContactSide !== 0 &&
      target.centerY < enemy.centerY - WALL_JUMP_MIN_TARGET_RISE_PX
    ) {
      const wallJumpDirection = (enemy.wallContactSide === -1 ? 1 : -1) as -1 | 1;
      return baseDecision('wall-jump', {
        directionX: wallJumpDirection,
        targetX: target.centerX,
        jumpVelocityX: wallJumpDirection,
        jumpVelocityY: -1,
      });
    }

    return baseDecision('air-chase', {
      targetX: target.centerX,
    });
  }

  if (currentSurface && targetSurface && targetSurface.topY > currentSurface.topY + TILE_SIZE * 0.75) {
    const fallbackDropDecision = buildFallbackDropDecision(
      baseDecision,
      currentSurface,
      enemy,
      target,
      blockedEdgeIds,
    );
    if (fallbackDropDecision) {
      return fallbackDropDecision;
    }
  }

  return baseDecision('blocked', {
    targetX: target.centerX,
  });
}

function buildSurfaceSegments(room: RoomSnapshot): SwordsmanSurfaceSegment[] {
  const segments: SwordsmanSurfaceSegment[] = [];

  for (let tileY = 0; tileY < ROOM_HEIGHT; tileY += 1) {
    let activeSegment: SwordsmanSurfaceSegment | null = null;
    let lastTopY = Number.NaN;

    for (let tileX = 0; tileX < ROOM_WIDTH; tileX += 1) {
      const profile = getTerrainTileCollisionProfile(room, tileX, tileY);
      const hasSurface =
        profile.hasCollision &&
        !roomHasTerrainTile(room, tileX, tileY - 1);

      if (!hasSurface) {
        activeSegment = null;
        continue;
      }

      const topY = tileY * TILE_SIZE + profile.topInset;
      if (activeSegment && Math.abs(topY - lastTopY) <= 0.01) {
        activeSegment.rightTileX = tileX;
        activeSegment.rightX = (tileX + 1) * TILE_SIZE;
        activeSegment.centerX = (activeSegment.leftX + activeSegment.rightX) * 0.5;
        activeSegment.hasOpenRight = !roomHasTerrainTile(room, tileX + 1, tileY);
      } else {
        activeSegment = {
          id: `surface:${tileY}:${tileX}`,
          kind: 'surface',
          tileY,
          topY,
          leftTileX: tileX,
          rightTileX: tileX,
          leftX: tileX * TILE_SIZE,
          rightX: (tileX + 1) * TILE_SIZE,
          centerX: tileX * TILE_SIZE + TILE_SIZE * 0.5,
          hasOpenLeft: !roomHasTerrainTile(room, tileX - 1, tileY),
          hasOpenRight: !roomHasTerrainTile(room, tileX + 1, tileY),
        };
        segments.push(activeSegment);
      }
      lastTopY = topY;
    }
  }

  return segments;
}

function buildWallSegments(room: RoomSnapshot): SwordsmanWallSegment[] {
  const segments: SwordsmanWallSegment[] = [];

  for (let tileX = 0; tileX < ROOM_WIDTH; tileX += 1) {
    for (const side of ['left', 'right'] as const) {
      let activeSegment: SwordsmanWallSegment | null = null;
      let lastBottomY = Number.NaN;

      for (let tileY = 0; tileY < ROOM_HEIGHT; tileY += 1) {
        const profile = getTerrainTileCollisionProfile(room, tileX, tileY);
        if (!profile.hasCollision) {
          activeSegment = null;
          continue;
        }

        const hasExposedFace =
          side === 'left'
            ? !roomHasTerrainTile(room, tileX - 1, tileY)
            : !roomHasTerrainTile(room, tileX + 1, tileY);
        if (!hasExposedFace) {
          activeSegment = null;
          continue;
        }

        const topY = tileY * TILE_SIZE + profile.topInset;
        const bottomY = topY + profile.height;
        const x = side === 'left' ? tileX * TILE_SIZE : (tileX + 1) * TILE_SIZE;
        const contactSide = (side === 'left' ? 1 : -1) as -1 | 1;
        const jumpDirectionX = (contactSide === 1 ? -1 : 1) as -1 | 1;

        if (activeSegment && Math.abs(topY - lastBottomY) <= 0.01) {
          activeSegment.bottomY = bottomY;
          activeSegment.centerY = (activeSegment.topY + activeSegment.bottomY) * 0.5;
        } else {
          activeSegment = {
            id: `wall:${side}:${tileX}:${tileY}`,
            kind: 'wall',
            tileX,
            side,
            x,
            topY,
            bottomY,
            centerY: (topY + bottomY) * 0.5,
            contactSide,
            jumpDirectionX,
          };
          segments.push(activeSegment);
        }
        lastBottomY = bottomY;
      }
    }
  }

  return segments;
}

function buildJumpUpEdge(
  source: SwordsmanSurfaceSegment,
  target: SwordsmanSurfaceSegment,
  allSurfaces: readonly SwordsmanSurfaceSegment[],
): SwordsmanTraversalEdge | null {
  const verticalRise = source.topY - target.topY;
  if (verticalRise > JUMP_UP_MAX_VERTICAL_PX || verticalRise < -JUMP_GAP_MAX_DESCENT_PX) {
    return null;
  }
  const edgeType = verticalRise >= JUMP_UP_MIN_VERTICAL_PX ? 'jump-up' : 'jump-gap';

  const sourceMinX = getSurfaceMinAnchorX(source);
  const sourceMaxX = getSurfaceMaxAnchorX(source);
  const targetMinX = getSurfaceMinAnchorX(target);
  const targetMaxX = getSurfaceMaxAnchorX(target);
  const candidates: SwordsmanTraversalEdge[] = [];

  const addCandidate = (
    suffix: 'left' | 'right',
    directionX: -1 | 1,
    setupX: number,
    targetX: number,
  ): void => {
    const horizontal = targetX - setupX;
    if (Math.abs(horizontal) > JUMP_UP_MAX_HORIZONTAL_PX) {
      return;
    }
    if ((directionX > 0 && horizontal <= 0.01) || (directionX < 0 && horizontal >= -0.01)) {
      return;
    }
    if (
      edgeType === 'jump-gap' &&
      hasIntermediateSurfaceIntercept(source, target, allSurfaces, setupX, targetX)
    ) {
      return;
    }

    candidates.push({
      id: `${source.id}->${target.id}:${edgeType}:${suffix}`,
      type: edgeType,
      fromId: source.id,
      toId: target.id,
      directionX,
      setupX,
      targetX,
      allowEdgeDrop: false,
    });
  };

  const leftApproachSetupLimit = target.leftX - SWORDSMAN_AI_JUMP_SETUP_BACKOFF_PX;
  if (sourceMinX <= leftApproachSetupLimit) {
    addCandidate(
      'left',
      1,
      clamp(leftApproachSetupLimit, sourceMinX, sourceMaxX),
      clamp(
        target.leftX + SWORDSMAN_AI_JUMP_LANDING_INSET_PX,
        targetMinX,
        targetMaxX,
      ),
    );
  }

  const rightApproachSetupLimit = target.rightX + SWORDSMAN_AI_JUMP_SETUP_BACKOFF_PX;
  if (sourceMaxX >= rightApproachSetupLimit) {
    addCandidate(
      'right',
      -1,
      clamp(rightApproachSetupLimit, sourceMinX, sourceMaxX),
      clamp(
        target.rightX - SWORDSMAN_AI_JUMP_LANDING_INSET_PX,
        targetMinX,
        targetMaxX,
      ),
    );
  }

  if (candidates.length === 0) {
    return null;
  }

  let bestCandidate = candidates[0];
  let bestScore =
    Math.abs(bestCandidate.setupX - source.centerX) + Math.abs(bestCandidate.targetX - bestCandidate.setupX);

  for (let index = 1; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const score =
      Math.abs(candidate.setupX - source.centerX) + Math.abs(candidate.targetX - candidate.setupX);
    if (score < bestScore) {
      bestCandidate = candidate;
      bestScore = score;
    }
  }

  return bestCandidate;
}

function hasIntermediateSurfaceIntercept(
  source: SwordsmanSurfaceSegment,
  target: SwordsmanSurfaceSegment,
  allSurfaces: readonly SwordsmanSurfaceSegment[],
  setupX: number,
  targetX: number,
): boolean {
  const minPathX = Math.min(setupX, targetX);
  const maxPathX = Math.max(setupX, targetX);
  const lowerSurfaceTopY = Math.max(source.topY, target.topY);
  const interceptTopY = lowerSurfaceTopY - TILE_SIZE * 0.5;

  return allSurfaces.some((surface) => {
    if (surface.id === source.id || surface.id === target.id) {
      return false;
    }
    if (surface.topY > interceptTopY) {
      return false;
    }
    return surface.rightX > minPathX && surface.leftX < maxPathX;
  });
}

function buildDropDownEdges(
  room: RoomSnapshot,
  source: SwordsmanSurfaceSegment,
  target: SwordsmanSurfaceSegment,
  allSurfaces: readonly SwordsmanSurfaceSegment[],
): SwordsmanTraversalEdge[] {
  if (target.topY <= source.topY + DROP_DOWN_MIN_VERTICAL_PX) {
    return [];
  }

  const edges: SwordsmanTraversalEdge[] = [];
  const targetMinX = getSurfaceMinAnchorX(target);
  const targetMaxX = getSurfaceMaxAnchorX(target);
  const sourceEdges = [];
  if (!roomHasTerrainTile(room, source.leftTileX - 1, source.tileY)) {
    sourceEdges.push({
      directionX: -1 as const,
      setupX: source.leftX + SWORDSMAN_AI_DROP_SETUP_EDGE_INSET_PX,
      suffix: 'left' as const,
    });
  }
  if (!roomHasTerrainTile(room, source.rightTileX + 1, source.tileY)) {
    sourceEdges.push({
      directionX: 1 as const,
      setupX: source.rightX - SWORDSMAN_AI_DROP_SETUP_EDGE_INSET_PX,
      suffix: 'right' as const,
    });
  }

  for (const edge of sourceEdges) {
    const targetX = clamp(edge.setupX, targetMinX, targetMaxX);
    const horizontal = targetX - edge.setupX;
    if (Math.abs(horizontal) > DROP_DOWN_MAX_HORIZONTAL_PX) {
      continue;
    }
    if (hasIntermediateDropSurfaceIntercept(source, target, allSurfaces, edge.setupX, targetX)) {
      continue;
    }

    edges.push({
      id: `${source.id}->${target.id}:drop:${edge.suffix}`,
      type: 'drop-down',
      fromId: source.id,
      toId: target.id,
      directionX: edge.directionX,
      setupX: edge.setupX,
      targetX,
      allowEdgeDrop: true,
    });
  }

  return edges;
}

function hasIntermediateDropSurfaceIntercept(
  source: SwordsmanSurfaceSegment,
  target: SwordsmanSurfaceSegment,
  allSurfaces: readonly SwordsmanSurfaceSegment[],
  setupX: number,
  targetX: number,
): boolean {
  const minPathX = Math.min(setupX, targetX);
  const maxPathX = Math.max(setupX, targetX);

  return allSurfaces.some((surface) => {
    if (surface.id === source.id || surface.id === target.id) {
      return false;
    }
    if (surface.topY <= source.topY || surface.topY >= target.topY) {
      return false;
    }

    return surface.rightX > minPathX && surface.leftX < maxPathX;
  });
}

function buildJumpToWallEdge(
  source: SwordsmanSurfaceSegment,
  wall: SwordsmanWallSegment,
): SwordsmanTraversalEdge | null {
  const sourceMinX = getSurfaceMinAnchorX(source);
  const sourceMaxX = getSurfaceMaxAnchorX(source);
  const setupX = clamp(
    wall.x - wall.contactSide * SWORDSMAN_AI_JUMP_SETUP_BACKOFF_PX,
    sourceMinX,
    sourceMaxX,
  );
  const horizontal = wall.x - setupX;
  const directionX = directionFromDelta(horizontal, wall.contactSide);
  if (directionX !== wall.contactSide) {
    return null;
  }
  if (Math.abs(horizontal) <= SWORDSMAN_AI_JUMP_SETUP_APPROACH_TOLERANCE_PX) {
    return null;
  }
  if (Math.abs(horizontal) > JUMP_TO_WALL_MAX_HORIZONTAL_PX) {
    return null;
  }

  const reachableTopY = source.topY - JUMP_TO_WALL_MAX_VERTICAL_PX;
  const reachableBottomY = source.topY + TILE_SIZE;
  if (wall.bottomY < reachableTopY || wall.topY > reachableBottomY) {
    return null;
  }
  if (wall.bottomY < source.topY - TILE_SIZE) {
    return null;
  }

  return {
    id: `${source.id}->${wall.id}:jump-to-wall`,
    type: 'jump-to-wall',
    fromId: source.id,
    toId: wall.id,
    directionX,
    setupX,
    targetX: wall.x,
    allowEdgeDrop: false,
  };
}

function buildWallJumpEdge(
  wall: SwordsmanWallSegment,
  target: SwordsmanSurfaceSegment,
): SwordsmanTraversalEdge | null {
  const targetX = getSurfaceAnchorNearestX(target, wall.x);
  const horizontal = targetX - wall.x;
  if (horizontal !== 0 && Math.sign(horizontal) !== wall.jumpDirectionX) {
    return null;
  }
  if (Math.abs(horizontal) > WALL_JUMP_TO_SURFACE_MAX_HORIZONTAL_PX) {
    return null;
  }

  const preferredContactY = clamp(
    target.topY + WALL_JUMP_PREFERRED_RISE_PX,
    wall.topY,
    wall.bottomY,
  );
  const verticalRise = preferredContactY - target.topY;
  if (
    verticalRise < WALL_JUMP_TO_SURFACE_MIN_VERTICAL_PX ||
    verticalRise > WALL_JUMP_TO_SURFACE_MAX_VERTICAL_PX
  ) {
    return null;
  }

  return {
    id: `${wall.id}->${target.id}:wall-jump`,
    type: 'wall-jump',
    fromId: wall.id,
    toId: target.id,
    directionX: wall.jumpDirectionX,
    setupX: wall.x,
    targetX,
    allowEdgeDrop: false,
  };
}

function buildDecisionFromFirstEdge(
  baseDecision: (
    intent: SwordsmanTraversalIntent,
    overrides?: Partial<SwordsmanTraversalDecision>,
  ) => SwordsmanTraversalDecision,
  edge: SwordsmanTraversalEdge,
  enemy: SwordsmanBodySnapshot,
  target: SwordsmanBodySnapshot,
): SwordsmanTraversalDecision {
  switch (edge.type) {
    case 'jump-up':
    case 'jump-gap':
    case 'jump-to-wall': {
      if (enemy.onFloor) {
        const setupReferenceX = getTraversalSetupReferenceX(enemy);
        const setupDelta = edge.setupX - setupReferenceX;
        const needsSetupMove =
          edge.directionX > 0
            ? setupDelta > SWORDSMAN_AI_JUMP_SETUP_APPROACH_TOLERANCE_PX ||
              setupDelta < -SWORDSMAN_AI_JUMP_SETUP_OVERSHOOT_TOLERANCE_PX
            : setupDelta < -SWORDSMAN_AI_JUMP_SETUP_APPROACH_TOLERANCE_PX ||
              setupDelta > SWORDSMAN_AI_JUMP_SETUP_OVERSHOOT_TOLERANCE_PX;
        if (needsSetupMove) {
          return baseDecision('same-platform', {
            directionX: directionFromDelta(setupDelta, edge.directionX),
            targetX: edge.setupX,
            traversalEdgeId: edge.id,
            traversalNextNodeId: edge.toId,
          });
        }

        return baseDecision('jump-up', {
          directionX: edge.directionX,
          targetX: edge.targetX,
          jumpVelocityX: edge.directionX,
          jumpVelocityY: -1,
          traversalEdgeId: edge.id,
          traversalNextNodeId: edge.toId,
        });
      }

      return baseDecision('air-chase', {
        // Keep traversal edges committed midair instead of letting targetX overshoot
        // flip the AI back the other way before the jump route finishes.
        directionX: edge.directionX,
        targetX: edge.targetX,
        traversalEdgeId: edge.id,
        traversalNextNodeId: edge.toId,
      });
    }
    case 'drop-down': {
      if (enemy.onFloor) {
        const setupReferenceX = getTraversalSetupReferenceX(enemy);
        const setupDelta = edge.setupX - setupReferenceX;
        const targetBelowEnemy = target.centerY > enemy.centerY;
        const needsApproachMove =
          edge.directionX > 0
            ? setupDelta > SWORDSMAN_AI_DROP_SETUP_APPROACH_TOLERANCE_PX
            : setupDelta < -SWORDSMAN_AI_DROP_SETUP_APPROACH_TOLERANCE_PX;
        const overshotLip =
          edge.directionX > 0
            ? setupDelta < -SWORDSMAN_AI_JUMP_SETUP_OVERSHOOT_TOLERANCE_PX
            : setupDelta > SWORDSMAN_AI_JUMP_SETUP_OVERSHOOT_TOLERANCE_PX;
        const needsSetupMove =
          needsApproachMove ||
          (!targetBelowEnemy && overshotLip);
        if (needsSetupMove) {
          return baseDecision('same-platform', {
            directionX: directionFromDelta(setupDelta, edge.directionX),
            targetX: edge.setupX,
            traversalEdgeId: edge.id,
            traversalNextNodeId: edge.toId,
          });
        }

        return baseDecision('drop-down', {
          directionX: edge.directionX,
          targetX: edge.targetX,
          allowEdgeDrop: true,
          traversalEdgeId: edge.id,
          traversalNextNodeId: edge.toId,
        });
      }

      return baseDecision('air-chase', {
        directionX: edge.directionX,
        targetX: edge.targetX,
        traversalEdgeId: edge.id,
        traversalNextNodeId: edge.toId,
      });
    }
    case 'wall-jump': {
      if (!enemy.onFloor && enemy.wallContactSide !== 0) {
        return baseDecision('wall-jump', {
          directionX: edge.directionX,
          targetX: edge.targetX,
          jumpVelocityX: edge.directionX,
          jumpVelocityY: -1,
          traversalEdgeId: edge.id,
          traversalNextNodeId: edge.toId,
        });
      }

      return baseDecision('air-chase', {
        directionX: edge.directionX,
        targetX: edge.targetX,
        traversalEdgeId: edge.id,
        traversalNextNodeId: edge.toId,
      });
    }
  }
}

export function buildSwordsmanTraversalDecisionFromEdge(
  edge: SwordsmanTraversalEdge,
  enemy: SwordsmanBodySnapshot,
  fallbackDirectionX: -1 | 1,
  fallbackTargetX: number,
  currentNodeId: string | null,
  targetNodeId: string | null,
  target: SwordsmanBodySnapshot,
): SwordsmanTraversalDecision {
  const baseDecision = (
    intent: SwordsmanTraversalIntent,
    overrides: Partial<SwordsmanTraversalDecision> = {},
  ): SwordsmanTraversalDecision => ({
    intent,
    directionX: fallbackDirectionX,
    targetX: fallbackTargetX,
    allowEdgeDrop: false,
    jumpVelocityX: 0,
    jumpVelocityY: 0,
    traversalEdgeId: null,
    traversalNextNodeId: null,
    currentSegmentId: currentNodeId,
    targetSegmentId: targetNodeId,
    ...overrides,
  });

  return buildDecisionFromFirstEdge(baseDecision, edge, enemy, target);
}

function buildFallbackDropDecision(
  baseDecision: (
    intent: SwordsmanTraversalIntent,
    overrides?: Partial<SwordsmanTraversalDecision>,
  ) => SwordsmanTraversalDecision,
  currentSurface: SwordsmanSurfaceSegment,
  enemy: SwordsmanBodySnapshot,
  target: SwordsmanBodySnapshot,
  blockedEdgeIds: ReadonlySet<string>,
): SwordsmanTraversalDecision | null {
  const preferredDirectionX = (target.centerX >= enemy.centerX ? 1 : -1) as -1 | 1;
  const candidates: SwordsmanTraversalEdge[] = [];

  if (currentSurface.hasOpenLeft) {
    candidates.push({
      id: `${FALLBACK_DROP_EDGE_PREFIX}:${currentSurface.id}:left`,
      type: 'drop-down',
      fromId: currentSurface.id,
      toId: currentSurface.id,
      directionX: -1,
      setupX: currentSurface.leftX + SWORDSMAN_AI_DROP_SETUP_EDGE_INSET_PX,
      targetX: currentSurface.leftX + SWORDSMAN_AI_DROP_SETUP_EDGE_INSET_PX,
      allowEdgeDrop: true,
    });
  }
  if (currentSurface.hasOpenRight) {
    candidates.push({
      id: `${FALLBACK_DROP_EDGE_PREFIX}:${currentSurface.id}:right`,
      type: 'drop-down',
      fromId: currentSurface.id,
      toId: currentSurface.id,
      directionX: 1,
      setupX: currentSurface.rightX - SWORDSMAN_AI_DROP_SETUP_EDGE_INSET_PX,
      targetX: currentSurface.rightX - SWORDSMAN_AI_DROP_SETUP_EDGE_INSET_PX,
      allowEdgeDrop: true,
    });
  }

  let bestCandidate: SwordsmanTraversalEdge | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (blockedEdgeIds.has(candidate.id)) {
      continue;
    }
    const directionPenalty = candidate.directionX === preferredDirectionX ? 0 : 64;
    const setupPenalty = Math.abs(candidate.setupX - enemy.centerX) * 0.5;
    const score = directionPenalty + setupPenalty;
    if (score < bestScore) {
      bestCandidate = candidate;
      bestScore = score;
    }
  }

  if (!bestCandidate) {
    return null;
  }

  return buildDecisionFromFirstEdge(baseDecision, bestCandidate, enemy, target);
}

function getTraversalSetupReferenceX(enemy: SwordsmanBodySnapshot): number {
  return enemy.centerX;
}

function findBestTraversalPath(
  graph: SwordsmanTraversalGraph,
  startNodeIds: string[],
  targetNodeIds: string[],
  enemyBody: SwordsmanBodySnapshot,
  targetBody: SwordsmanBodySnapshot,
  blockedEdgeIds: ReadonlySet<string>,
): { edges: SwordsmanTraversalEdge[]; score: number } | null {
  if (startNodeIds.length === 0) {
    return null;
  }

  const targetIdSet = new Set(targetNodeIds);
  let bestPath: { edges: SwordsmanTraversalEdge[]; score: number } | null = null;

  for (const startNodeId of startNodeIds) {
    const queue: Array<{
      nodeId: string;
      edges: SwordsmanTraversalEdge[];
      visited: Set<string>;
    }> = [
      {
        nodeId: startNodeId,
        edges: [],
        visited: new Set([startNodeId]),
      },
    ];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        break;
      }

      if (current.edges.length > 0) {
        const score = scoreTraversalPathEnd(
          graph,
          current.nodeId,
          current.edges.length,
          targetIdSet,
          targetBody,
        ) + scoreTraversalPathEntry(current.edges[0], enemyBody, targetBody);
        if (!bestPath || score < bestPath.score) {
          bestPath = {
            edges: current.edges,
            score,
          };
        }
      }

      if (current.edges.length >= MAX_SEARCH_DEPTH) {
        continue;
      }

      for (const edge of graph.edgesByNodeId.get(current.nodeId) ?? []) {
        if (blockedEdgeIds.has(edge.id)) {
          continue;
        }
        if (current.visited.has(edge.toId)) {
          continue;
        }
        queue.push({
          nodeId: edge.toId,
          edges: [...current.edges, edge],
          visited: new Set([...current.visited, edge.toId]),
        });
      }
    }
  }

  return bestPath;
}

function scoreTraversalPathEnd(
  graph: SwordsmanTraversalGraph,
  nodeId: string,
  depth: number,
  targetNodeIds: Set<string>,
  targetBody: SwordsmanBodySnapshot,
): number {
  const node = graph.nodesById.get(nodeId);
  if (!node) {
    return Number.POSITIVE_INFINITY;
  }

  const { horizontalDistance, verticalDistance } = measureSwordsmanTraversalNodeDistanceToBody(node, targetBody);
  const targetMatchBonus = targetNodeIds.has(node.id) ? TARGET_MATCH_SCORE_BONUS : 0;
  return depth * 72 + horizontalDistance * 1.5 + verticalDistance * 2 - targetMatchBonus;
}

function scoreTraversalPathEntry(
  firstEdge: SwordsmanTraversalEdge,
  enemyBody: SwordsmanBodySnapshot,
  targetBody: SwordsmanBodySnapshot,
): number {
  const setupPenalty = Math.abs(firstEdge.setupX - enemyBody.centerX) * 1.25;
  const currentTargetDistance = Math.abs(targetBody.centerX - enemyBody.centerX);
  const setupTargetDistance = Math.abs(targetBody.centerX - firstEdge.setupX);
  const targetDirection = directionFromDelta(targetBody.centerX - enemyBody.centerX, firstEdge.directionX);
  const setupDirection = directionFromDelta(firstEdge.setupX - enemyBody.centerX, firstEdge.directionX);
  const directionPenalty =
    currentTargetDistance > TILE_SIZE * 0.75 && targetDirection !== setupDirection
      ? 52
      : 0;
  const movingAwayPenalty = Math.max(0, setupTargetDistance - currentTargetDistance) * 4;
  return setupPenalty + directionPenalty + movingAwayPenalty;
}

export function getSwordsmanTraversalCurrentNodeId(
  graph: SwordsmanTraversalGraph,
  body: SwordsmanBodySnapshot,
): string | null {
  return getSwordsmanTraversalContext(graph, body).currentNodeId;
}

export function getSwordsmanTraversalContext(
  graph: SwordsmanTraversalGraph,
  body: SwordsmanBodySnapshot,
): SwordsmanTraversalContext {
  const currentSurface = findSurfaceSegmentNearBody(
    graph,
    body,
    body.onFloor ? SURFACE_MATCH_TOLERANCE_PX : AIRBORNE_SURFACE_MATCH_TOLERANCE_PX,
  );
  const currentWall =
    body.wallContactSide === 0
      ? null
      : findWallSegmentNearBody(graph, body, body.wallContactSide);
  return {
    currentSurface,
    currentWall,
    currentNodeId: currentWall?.id ?? currentSurface?.id ?? null,
    startNodeIds: uniqueNodeIds([currentWall?.id ?? null, currentSurface?.id ?? null]),
  };
}

export function measureSwordsmanTraversalNodeDistanceToBody(
  node: SwordsmanTraversalNode,
  body: SwordsmanBodySnapshot,
): { horizontalDistance: number; verticalDistance: number } {
  if (node.kind === 'surface') {
    return {
      horizontalDistance: distanceToInterval(
        body.centerX,
        getSurfaceMinAnchorX(node),
        getSurfaceMaxAnchorX(node),
      ),
      verticalDistance: Math.abs(node.topY - body.bottom),
    };
  }

  return {
    horizontalDistance: Math.abs(node.x - body.centerX),
    verticalDistance: distanceToInterval(body.centerY, node.topY, node.bottomY),
  };
}

function findSurfaceSegmentNearBody(
  graph: SwordsmanTraversalGraph,
  body: SwordsmanBodySnapshot,
  tolerancePx: number,
): SwordsmanSurfaceSegment | null {
  let best: SwordsmanSurfaceSegment | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const segment of graph.surfaceSegments) {
    if (
      body.right < getSurfaceMinAnchorX(segment) - TILE_SIZE ||
      body.left > getSurfaceMaxAnchorX(segment) + TILE_SIZE
    ) {
      continue;
    }

    const verticalDistance = Math.abs(body.bottom - segment.topY);
    if (verticalDistance > tolerancePx) {
      continue;
    }

    const horizontalOverflow = distanceBetweenIntervals(
      body.left,
      body.right,
      getSurfaceMinAnchorX(segment),
      getSurfaceMaxAnchorX(segment),
    );
    const score = verticalDistance * 4 + horizontalOverflow;
    if (score < bestScore) {
      best = segment;
      bestScore = score;
    }
  }

  return best;
}

function findWallSegmentNearBody(
  graph: SwordsmanTraversalGraph,
  body: SwordsmanBodySnapshot,
  requiredContactSide: -1 | 1,
): SwordsmanWallSegment | null {
  let best: SwordsmanWallSegment | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const wall of graph.wallSegments) {
    if (wall.contactSide !== requiredContactSide) {
      continue;
    }

    const horizontalDistance = Math.abs(body.centerX - wall.x);
    if (horizontalDistance > WALL_MATCH_TOLERANCE_X_PX) {
      continue;
    }

    const verticalDistance = distanceToInterval(body.centerY, wall.topY, wall.bottomY);
    if (verticalDistance > WALL_MATCH_TOLERANCE_Y_PX) {
      continue;
    }

    const score = horizontalDistance * 4 + verticalDistance;
    if (score < bestScore) {
      best = wall;
      bestScore = score;
    }
  }

  return best;
}

function findTargetSurfaceSegment(
  graph: SwordsmanTraversalGraph,
  body: SwordsmanBodySnapshot,
): SwordsmanSurfaceSegment | null {
  const supportedSurface = findSurfaceSegmentNearBody(
    graph,
    body,
    body.onFloor ? SURFACE_MATCH_TOLERANCE_PX : AIRBORNE_SURFACE_MATCH_TOLERANCE_PX,
  );
  if (supportedSurface) {
    return supportedSurface;
  }

  let best: SwordsmanSurfaceSegment | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const segment of graph.surfaceSegments) {
    if (
      body.right < getSurfaceMinAnchorX(segment) - TILE_SIZE ||
      body.left > getSurfaceMaxAnchorX(segment) + TILE_SIZE
    ) {
      continue;
    }

    const belowOrAtBody = segment.topY >= body.centerY;
    const verticalDistance = Math.abs(segment.topY - body.bottom);
    const airborneDropDistance = belowOrAtBody
      ? segment.topY - body.centerY
      : Number.POSITIVE_INFINITY;
    const horizontalOverflow = distanceBetweenIntervals(
      body.left,
      body.right,
      getSurfaceMinAnchorX(segment),
      getSurfaceMaxAnchorX(segment),
    );
    const score = Math.min(verticalDistance, airborneDropDistance) + horizontalOverflow * 2;
    if (score < bestScore) {
      best = segment;
      bestScore = score;
    }
  }

  return best;
}

export function getSwordsmanTraversalTargetContext(
  graph: SwordsmanTraversalGraph,
  body: SwordsmanBodySnapshot,
): SwordsmanTraversalTargetContext {
  const targetSurface = findTargetSurfaceSegment(graph, body);
  const targetWall =
    body.wallContactSide === 0
      ? null
      : findWallSegmentNearBody(graph, body, body.wallContactSide);

  return {
    targetSurface,
    targetWall,
    targetNodeId: targetSurface?.id ?? targetWall?.id ?? null,
    targetNodeIds: uniqueNodeIds([targetSurface?.id ?? null, targetWall?.id ?? null]),
  };
}

export function getSwordsmanTraversalEdgeById(
  graph: SwordsmanTraversalGraph,
  edgeId: string,
): SwordsmanTraversalEdge | null {
  return graph.edgesById.get(edgeId) ?? null;
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

function uniqueNodeIds(ids: Array<string | null>): string[] {
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
}

function distanceToInterval(value: number, min: number, max: number): number {
  if (value < min) {
    return min - value;
  }
  if (value > max) {
    return value - max;
  }
  return 0;
}

function distanceBetweenIntervals(
  firstMin: number,
  firstMax: number,
  secondMin: number,
  secondMax: number,
): number {
  if (firstMax < secondMin) {
    return secondMin - firstMax;
  }
  if (firstMin > secondMax) {
    return firstMin - secondMax;
  }
  return 0;
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
