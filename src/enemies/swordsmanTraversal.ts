import {
  ROOM_HEIGHT,
  ROOM_WIDTH,
  TILE_SIZE,
  getObjectById,
  getObjectDisplayOffset,
  type PlacedObject,
} from '../config';
import {
  isFloorTriangle,
  normalizePlacedTriangle,
  triangleFloorHighTip,
  triangleFloorSurfaceYAt,
} from '../config/trianglePiece';
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
  | 'ladder-climb'
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
  /** Floor-ramp hyp; feet match against Y-at-X instead of flat topY. */
  triangle?: {
    anchorX: number;
    anchorY: number;
    legX: number;
    legY: number;
  };
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
  type:
    | 'jump-up'
    | 'jump-gap'
    | 'drop-down'
    | 'jump-to-wall'
    | 'wall-jump'
    | 'ladder-up'
    | 'ladder-down';
  fromId: string;
  toId: string;
  directionX: -1 | 1;
  setupX: number;
  targetX: number;
  allowEdgeDrop: boolean;
  ladderX?: number;
  ladderTopY?: number;
  ladderBottomY?: number;
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
const LADDER_SURFACE_ATTACH_TOLERANCE_X_PX = TILE_SIZE * 1.25;
const LADDER_SURFACE_ATTACH_TOLERANCE_Y_PX = TILE_SIZE * 1.5;
const LADDER_VERTICAL_MERGE_GAP_PX = TILE_SIZE * 1.25;
const LADDER_COLUMN_MERGE_TOLERANCE_X_PX = TILE_SIZE * 0.5;
const LADDER_MIN_VERTICAL_DELTA_PX = TILE_SIZE * 0.75;
const LADDER_ATTACH_APPROACH_TOLERANCE_PX = 5;
const MAX_SEARCH_DEPTH = 3;
const TARGET_MATCH_SCORE_BONUS = 240;
const FALLBACK_DROP_EDGE_PREFIX = 'fallback-drop';

interface SwordsmanLadderSegment {
  id: string;
  centerX: number;
  topY: number;
  bottomY: number;
}

interface SwordsmanLadderSurfaceAttachment {
  surface: SwordsmanSurfaceSegment;
  anchorX: number;
}

export function getSwordsmanTraversalGraphCacheKey(room: RoomSnapshot): string {
  return `${room.id}:${room.version}:${room.updatedAt}`;
}

export function buildSwordsmanTraversalGraph(room: RoomSnapshot): SwordsmanTraversalGraph {
  const build = startSwordsmanTraversalGraphBuild(room);
  let graph = build.buildNextPiece();
  while (!graph) {
    graph = build.buildNextPiece();
  }
  return graph;
}

// Rooms whose Sword Hunters updated in the last couple of seconds. The graph cache and the edge
// simulation cache never evict them (F302).
const ROOM_IN_PLAY_PROTECTION_MS = 2000;
const ROOMS_IN_PLAY_LIMIT = 64;
const roomsInPlay = new Map<string, { markedAt: number }>();

/** Marks a room version in play; called every frame its Sword Hunters update. */
export function markSwordsmanTraversalRoomInPlay(graphCacheKey: string, now = performance.now()): void {
  const mark = roomsInPlay.get(graphCacheKey);
  if (mark) {
    // Updated in place, so the map's order is not recency; pruning goes by timestamp.
    mark.markedAt = now;
    return;
  }

  if (roomsInPlay.size >= ROOMS_IN_PLAY_LIMIT) {
    let oldestKey: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [key, oldMark] of roomsInPlay) {
      if (now - oldMark.markedAt >= ROOM_IN_PLAY_PROTECTION_MS) {
        roomsInPlay.delete(key);
      } else if (oldMark.markedAt < oldestAt) {
        oldestKey = key;
        oldestAt = oldMark.markedAt;
      }
    }
    if (roomsInPlay.size >= ROOMS_IN_PLAY_LIMIT && oldestKey !== null) {
      roomsInPlay.delete(oldestKey);
    }
  }
  roomsInPlay.set(graphCacheKey, { markedAt: now });
}

export function isSwordsmanTraversalRoomInPlay(graphCacheKey: string, now = performance.now()): boolean {
  const mark = roomsInPlay.get(graphCacheKey);
  return mark !== undefined && now - mark.markedAt < ROOM_IN_PLAY_PROTECTION_MS;
}

// One graph per room version, shared by every scene's Sword Hunters and the jump warm-up, least
// recently used first; rooms in play are never evicted (F302).
const TRAVERSAL_GRAPH_CACHE_LIMIT = 64;
const traversalGraphsByCacheKey = new Map<string, SwordsmanTraversalGraph>();
let lastTraversalGraphCacheKey: string | null = null;

/** The room's cached graph, built now if no hunter or warm-up has built it yet. */
export function getSwordsmanTraversalGraphForRoom(room: RoomSnapshot): SwordsmanTraversalGraph {
  return peekSwordsmanTraversalGraphForRoom(room)
    ?? rememberSwordsmanTraversalGraph(buildSwordsmanTraversalGraph(room));
}

export function peekSwordsmanTraversalGraphForRoom(room: RoomSnapshot): SwordsmanTraversalGraph | null {
  const cacheKey = getSwordsmanTraversalGraphCacheKey(room);
  const graph = traversalGraphsByCacheKey.get(cacheKey);
  if (graph && cacheKey !== lastTraversalGraphCacheKey) {
    // Hunters read their room's graph many times a frame; only a change of room reorders.
    traversalGraphsByCacheKey.delete(cacheKey);
    traversalGraphsByCacheKey.set(cacheKey, graph);
    lastTraversalGraphCacheKey = cacheKey;
  }
  return graph ?? null;
}

/** Caches a graph built elsewhere, unless one for that room version is already cached. */
export function rememberSwordsmanTraversalGraph(graph: SwordsmanTraversalGraph): SwordsmanTraversalGraph {
  const cached = traversalGraphsByCacheKey.get(graph.cacheKey);
  if (cached) {
    return cached;
  }
  traversalGraphsByCacheKey.set(graph.cacheKey, graph);
  if (traversalGraphsByCacheKey.size > TRAVERSAL_GRAPH_CACHE_LIMIT) {
    const now = performance.now();
    for (const cacheKey of traversalGraphsByCacheKey.keys()) {
      if (cacheKey !== graph.cacheKey && !isSwordsmanTraversalRoomInPlay(cacheKey, now)) {
        traversalGraphsByCacheKey.delete(cacheKey);
        break;
      }
    }
  }
  return graph;
}

/** A graph built a piece at a time, so the work can be spread over frames (F302). */
export interface SwordsmanTraversalGraphBuild {
  /** Builds one piece; returns the finished graph after the last one. */
  buildNextPiece(): SwordsmanTraversalGraph | null;
}

/**
 * Builds the same graph as buildSwordsmanTraversalGraph, in the same order, one piece per call:
 * the surfaces, the walls and the ladders, then each surface's outgoing jumps, each wall's, and
 * the ladder edges last.
 */
export function startSwordsmanTraversalGraphBuild(room: RoomSnapshot): SwordsmanTraversalGraphBuild {
  let surfaceSegments: SwordsmanSurfaceSegment[] = [];
  let wallSegments: SwordsmanWallSegment[] = [];
  let ladderSegments: SwordsmanLadderSegment[] = [];
  const nodesById = new Map<string, SwordsmanTraversalNode>();
  const edgesByNodeId = new Map<string, SwordsmanTraversalEdge[]>();
  const edgesById = new Map<string, SwordsmanTraversalEdge>();
  let nextPiece = 0;
  let graph: SwordsmanTraversalGraph | null = null;

  const addEdge = (edge: SwordsmanTraversalEdge | null): void => {
    if (!edge) {
      return;
    }
    edgesByNodeId.get(edge.fromId)?.push(edge);
    edgesById.set(edge.id, edge);
  };

  const buildPiece = (piece: number): void => {
    if (piece === 0) {
      surfaceSegments = buildSurfaceSegments(room);
      for (const segment of surfaceSegments) {
        nodesById.set(segment.id, segment);
        edgesByNodeId.set(segment.id, []);
      }
      return;
    }
    if (piece === 1) {
      wallSegments = buildWallSegments(room);
      for (const wall of wallSegments) {
        nodesById.set(wall.id, wall);
        edgesByNodeId.set(wall.id, []);
      }
      return;
    }
    if (piece === 2) {
      ladderSegments = buildLadderSegments(room);
      return;
    }

    const source = surfaceSegments[piece - 3];
    if (source) {
      for (const target of surfaceSegments) {
        if (source.id === target.id) {
          continue;
        }

        addEdge(buildJumpUpEdge(source, target, surfaceSegments));
        for (const dropEdge of buildDropDownEdges(room, source, target, surfaceSegments)) {
          addEdge(dropEdge);
        }
        // Ramp tips nested inside a flush floor fail normal jump-up approach
        // geometry — add an explicit tip walk-off onto that floor.
        addEdge(buildTriangleFloorTransferEdge(room, source, target));
        // Back-to-back peak: walk over the shared tip onto the other hyp.
        addEdge(buildTriangleCrestTransferEdge(source, target));
      }

      for (const wall of wallSegments) {
        addEdge(buildJumpToWallEdge(source, wall));
      }
      return;
    }

    const wall = wallSegments[piece - 3 - surfaceSegments.length];
    if (wall) {
      for (const target of surfaceSegments) {
        addEdge(buildWallJumpEdge(wall, target));
      }
      return;
    }

    for (const edge of buildLadderEdges(ladderSegments, surfaceSegments)) {
      addEdge(edge);
    }
    graph = {
      cacheKey: getSwordsmanTraversalGraphCacheKey(room),
      surfaceSegments,
      wallSegments,
      nodesById,
      edgesByNodeId,
      edgesById,
    };
  };

  return {
    buildNextPiece() {
      if (!graph) {
        buildPiece(nextPiece);
        nextPiece += 1;
      }
      return graph;
    },
  };
}

export function decideSwordsmanTraversal(
  graph: SwordsmanTraversalGraph,
  enemy: SwordsmanBodySnapshot,
  target: SwordsmanBodySnapshot,
  blockedEdgeIds: ReadonlySet<string> = new Set<string>(),
  preferredSurfaceId: string | null = null,
): SwordsmanTraversalDecision {
  const currentContext = getSwordsmanTraversalContext(graph, enemy, preferredSurfaceId);
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
  const firstEdge = findBestTraversalFirstEdge(
    graph,
    startNodeIds,
    targetNodeIds,
    enemy,
    target,
    blockedEdgeIds,
  );
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

  appendTriangleSurfaceSegments(room, segments);
  return segments;
}

/**
 * One walkable surface per floor triangle so hunters can path on/off ramps.
 * topY is the high tip (crest); matching uses the hypotenuse at the body's X.
 */
function appendTriangleSurfaceSegments(
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

  appendTriangleWallSegments(room, segments);
  return segments;
}

/** Vertical legs of placed triangles act as climbable walls for Sword Hunter. */
function appendTriangleWallSegments(
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

function buildLadderSegments(room: RoomSnapshot): SwordsmanLadderSegment[] {
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

function buildLadderEdges(
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

/**
 * Two floor triangles that share a high tip (mountain peak) need a walk edge
 * over the crest. Jump-to-wall / tip-clear jumps on the paired vertical send
 * hunters back down the side they climbed.
 */
function buildTriangleCrestTransferEdge(
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
function buildTriangleFloorTransferEdge(
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

function buildJumpUpEdge(
  source: SwordsmanSurfaceSegment,
  target: SwordsmanSurfaceSegment,
  allSurfaces: readonly SwordsmanSurfaceSegment[],
): SwordsmanTraversalEdge | null {
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
    // Sample hyp height at the departure point so tall ramps still connect to
    // flush floor tips (flat topY would look like a full-ramp jump).
    const verticalRise =
      surfaceTopYNearBody(source, setupX) - surfaceTopYNearBody(target, targetX);
    if (verticalRise > JUMP_UP_MAX_VERTICAL_PX || verticalRise < -JUMP_GAP_MAX_DESCENT_PX) {
      return;
    }
    const edgeType = verticalRise >= JUMP_UP_MIN_VERTICAL_PX ? 'jump-up' : 'jump-gap';
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
  const edges: SwordsmanTraversalEdge[] = [];
  const targetMinX = getSurfaceMinAnchorX(target);
  const targetMaxX = getSurfaceMaxAnchorX(target);
  const sourceEdges = [];
  const openLeft = source.triangle
    ? source.hasOpenLeft
    : !roomHasTerrainTile(room, source.leftTileX - 1, source.tileY);
  const openRight = source.triangle
    ? source.hasOpenRight
    : !roomHasTerrainTile(room, source.rightTileX + 1, source.tileY);
  if (openLeft) {
    sourceEdges.push({
      directionX: -1 as const,
      setupX: source.leftX + SWORDSMAN_AI_DROP_SETUP_EDGE_INSET_PX,
      suffix: 'left' as const,
    });
  }
  if (openRight) {
    sourceEdges.push({
      directionX: 1 as const,
      setupX: source.rightX - SWORDSMAN_AI_DROP_SETUP_EDGE_INSET_PX,
      suffix: 'right' as const,
    });
  }

  for (const edge of sourceEdges) {
    const targetX = clamp(edge.setupX, targetMinX, targetMaxX);
    const sourceTop = surfaceTopYNearBody(source, edge.setupX);
    const targetTop = surfaceTopYNearBody(target, targetX);
    if (targetTop <= sourceTop + DROP_DOWN_MIN_VERTICAL_PX) {
      continue;
    }
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
  // Peak / crest verticals are walked, not jumped — jump-to-wall here wall-jumps
  // the hunter back down the ramp he just climbed.
  if (source.triangle) {
    const tip = triangleFloorHighTip(
      source.triangle.anchorX,
      source.triangle.anchorY,
      source.triangle.legX,
      source.triangle.legY,
    );
    if (
      tip
      && Math.abs(wall.x - tip.x) <= 6
      && Math.abs(wall.topY - tip.y) <= 6
    ) {
      return null;
    }
  }

  const sourceMinX = getSurfaceMinAnchorX(source);
  const sourceMaxX = getSurfaceMaxAnchorX(source);
  // Wall capping this surface (ramp low tip vs tile wall) is a corner, not a jump.
  if (wall.x >= source.leftX - 2 && wall.x <= source.rightX + 2) {
    return null;
  }

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
      // Shared-tip peaks: keep walking over the crest; never jump the lip.
      if (enemy.onFloor && edge.id.includes(':crest-walk:')) {
        return baseDecision('same-platform', {
          directionX: edge.directionX,
          targetX: edge.targetX,
          traversalEdgeId: edge.id,
          traversalNextNodeId: edge.toId,
        });
      }

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
    case 'ladder-up':
    case 'ladder-down': {
      const setupReferenceX = getTraversalSetupReferenceX(enemy);
      const setupDelta = edge.setupX - setupReferenceX;
      if (Math.abs(setupDelta) > LADDER_ATTACH_APPROACH_TOLERANCE_PX && enemy.onFloor) {
        return baseDecision('same-platform', {
          directionX: directionFromDelta(setupDelta, edge.directionX),
          targetX: edge.setupX,
          traversalEdgeId: edge.id,
          traversalNextNodeId: edge.toId,
        });
      }

      if (Math.abs(setupDelta) > TILE_SIZE && !enemy.onFloor) {
        return baseDecision('air-chase', {
          directionX: directionFromDelta(setupDelta, edge.directionX),
          targetX: edge.setupX,
          traversalEdgeId: edge.id,
          traversalNextNodeId: edge.toId,
        });
      }

      return baseDecision('ladder-climb', {
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

function findBestTraversalFirstEdge(
  graph: SwordsmanTraversalGraph,
  startNodeIds: string[],
  targetNodeIds: string[],
  enemyBody: SwordsmanBodySnapshot,
  targetBody: SwordsmanBodySnapshot,
  blockedEdgeIds: ReadonlySet<string>,
): SwordsmanTraversalEdge | null {
  if (startNodeIds.length === 0) {
    return null;
  }

  // Peak crest walks are an extra hop, so depth-3 search often prefers jumping off
  // the wrong tip. When the crest moves toward the target, take it immediately.
  const crestWalk = findCrestWalkTowardTarget(
    graph,
    startNodeIds,
    targetNodeIds,
    enemyBody,
    targetBody,
    blockedEdgeIds,
  );
  if (crestWalk) {
    return crestWalk;
  }

  // The routes are listed once per start-node and blocked-edge set, so a chase only searches again
  // when the enemy reaches another node or an edge is blocked. Scoring them against the live
  // positions still runs every call, so the chosen edge is the one a full search would pick (F305).
  const routes = getSwordsmanTraversalRouteSet(graph, startNodeIds, blockedEdgeIds);
  const targetIdSet = new Set(targetNodeIds);
  for (let endIndex = 0; endIndex < routes.endNodes.length; endIndex += 1) {
    const node = routes.endNodes[endIndex];
    const distance = node ? measureSwordsmanTraversalNodeDistanceToBody(node, targetBody) : null;
    const targetMatchBonus = node && targetIdSet.has(node.id) ? TARGET_MATCH_SCORE_BONUS : 0;
    for (let depth = 1; depth <= MAX_SEARCH_DEPTH; depth += 1) {
      routeEndScores[endIndex * MAX_SEARCH_DEPTH + depth - 1] = distance
        ? scoreTraversalPathEnd(depth, distance, targetMatchBonus)
        : Number.POSITIVE_INFINITY;
    }
  }
  for (let edgeIndex = 0; edgeIndex < routes.firstEdges.length; edgeIndex += 1) {
    routeEntryScores[edgeIndex] = scoreTraversalPathEntry(routes.firstEdges[edgeIndex], enemyBody, targetBody);
  }

  let bestRouteIndex = -1;
  let bestScore = 0;
  for (let routeIndex = 0; routeIndex < routes.depths.length; routeIndex += 1) {
    const score =
      routeEndScores[routes.endNodeIndexes[routeIndex] * MAX_SEARCH_DEPTH + routes.depths[routeIndex] - 1] +
      routeEntryScores[routes.firstEdgeIndexes[routeIndex]];
    if (bestRouteIndex < 0 || score < bestScore) {
      bestRouteIndex = routeIndex;
      bestScore = score;
    }
  }

  return bestRouteIndex < 0 ? null : routes.firstEdges[routes.firstEdgeIndexes[bestRouteIndex]];
}

/**
 * Every simple route of up to MAX_SEARCH_DEPTH edges from a set of start nodes, in the
 * breadth-first order they are scored, kept as parallel arrays so scoring allocates nothing.
 */
interface SwordsmanTraversalRouteSet {
  firstEdges: SwordsmanTraversalEdge[];
  endNodes: Array<SwordsmanTraversalNode | undefined>;
  firstEdgeIndexes: number[];
  endNodeIndexes: number[];
  depths: number[];
}

// One least-recently-used cache for every room's graph: a dense room's lists run to ~25 KB each.
const TRAVERSAL_ROUTE_SET_CACHE_LIMIT = 64;
const traversalRouteSets = new Map<string, SwordsmanTraversalRouteSet>();
const traversalGraphIds = new WeakMap<SwordsmanTraversalGraph, number>();
let nextTraversalGraphId = 1;
const routeEndScores: number[] = [];
const routeEntryScores: number[] = [];

function getSwordsmanTraversalRouteSet(
  graph: SwordsmanTraversalGraph,
  startNodeIds: readonly string[],
  blockedEdgeIds: ReadonlySet<string>,
): SwordsmanTraversalRouteSet {
  let graphId = traversalGraphIds.get(graph);
  if (graphId === undefined) {
    graphId = nextTraversalGraphId;
    nextTraversalGraphId += 1;
    traversalGraphIds.set(graph, graphId);
  }

  const startKey = `${graphId}\n${startNodeIds.join('\n')}`;
  const cacheKey = blockedEdgeIds.size === 0
    ? startKey
    : `${startKey}\n\n${Array.from(blockedEdgeIds).sort().join('\n')}`;
  const cached = traversalRouteSets.get(cacheKey);
  if (cached) {
    traversalRouteSets.delete(cacheKey);
    traversalRouteSets.set(cacheKey, cached);
    return cached;
  }

  const routes = buildSwordsmanTraversalRouteSet(graph, startNodeIds, blockedEdgeIds);
  traversalRouteSets.set(cacheKey, routes);
  if (traversalRouteSets.size > TRAVERSAL_ROUTE_SET_CACHE_LIMIT) {
    const leastRecentKey = traversalRouteSets.keys().next().value;
    if (leastRecentKey !== undefined) {
      traversalRouteSets.delete(leastRecentKey);
    }
  }
  return routes;
}

function buildSwordsmanTraversalRouteSet(
  graph: SwordsmanTraversalGraph,
  startNodeIds: readonly string[],
  blockedEdgeIds: ReadonlySet<string>,
): SwordsmanTraversalRouteSet {
  const routes: SwordsmanTraversalRouteSet = {
    firstEdges: [],
    endNodes: [],
    firstEdgeIndexes: [],
    endNodeIndexes: [],
    depths: [],
  };
  const endNodeIndexById = new Map<string, number>();
  // One breadth-first queue per start node, appended in turn; each entry points at its parent.
  const queueNodeIds: string[] = [];
  const queueParents: number[] = [];
  const queueFirstEdgeIndexes: number[] = [];
  const queueDepths: number[] = [];
  const isOnQueuedPath = (queueIndex: number, nodeId: string): boolean => {
    for (let index = queueIndex; index >= 0; index = queueParents[index]) {
      if (queueNodeIds[index] === nodeId) {
        return true;
      }
    }
    return false;
  };

  for (const startNodeId of startNodeIds) {
    let cursor = queueNodeIds.length;
    queueNodeIds.push(startNodeId);
    queueParents.push(-1);
    queueFirstEdgeIndexes.push(-1);
    queueDepths.push(0);

    for (; cursor < queueNodeIds.length; cursor += 1) {
      const nodeId = queueNodeIds[cursor];
      const depth = queueDepths[cursor];
      if (depth > 0) {
        let endNodeIndex = endNodeIndexById.get(nodeId);
        if (endNodeIndex === undefined) {
          endNodeIndex = routes.endNodes.length;
          routes.endNodes.push(graph.nodesById.get(nodeId));
          endNodeIndexById.set(nodeId, endNodeIndex);
        }
        routes.firstEdgeIndexes.push(queueFirstEdgeIndexes[cursor]);
        routes.endNodeIndexes.push(endNodeIndex);
        routes.depths.push(depth);
      }

      if (depth >= MAX_SEARCH_DEPTH) {
        continue;
      }

      for (const edge of graph.edgesByNodeId.get(nodeId) ?? []) {
        if (blockedEdgeIds.has(edge.id) || isOnQueuedPath(cursor, edge.toId)) {
          continue;
        }
        let firstEdgeIndex = queueFirstEdgeIndexes[cursor];
        if (depth === 0) {
          firstEdgeIndex = routes.firstEdges.length;
          routes.firstEdges.push(edge);
        }
        queueNodeIds.push(edge.toId);
        queueParents.push(cursor);
        queueFirstEdgeIndexes.push(firstEdgeIndex);
        queueDepths.push(depth + 1);
      }
    }
  }

  return routes;
}

function scoreTraversalPathEnd(
  depth: number,
  distance: { horizontalDistance: number; verticalDistance: number },
  targetMatchBonus: number,
): number {
  return depth * 72 + distance.horizontalDistance * 1.5 + distance.verticalDistance * 2 - targetMatchBonus;
}

function findCrestWalkTowardTarget(
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
  preferredSurfaceId: string | null = null,
): SwordsmanTraversalContext {
  const currentSurface = findSurfaceSegmentNearBody(
    graph,
    body,
    body.onFloor ? SURFACE_MATCH_TOLERANCE_PX : AIRBORNE_SURFACE_MATCH_TOLERANCE_PX,
    preferredSurfaceId,
  );
  const currentWall =
    body.wallContactSide === 0
      ? null
      : findWallSegmentNearBody(graph, body, body.wallContactSide);
  // Grounded on a ramp near its vertical tip must stay on the surface node —
  // preferring the wall freezes dismount / walk-off planning.
  if (body.onFloor && currentSurface) {
    return {
      currentSurface,
      currentWall,
      currentNodeId: currentSurface.id,
      startNodeIds: uniqueNodeIds([currentSurface.id]),
    };
  }
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
      verticalDistance: Math.abs(surfaceTopYNearBody(node, body.centerX) - body.bottom),
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
  preferredSurfaceId: string | null = null,
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

    const surfaceTopY = surfaceTopYNearBody(segment, body.centerX);
    const verticalDistance = Math.abs(body.bottom - surfaceTopY);
    if (verticalDistance > tolerancePx) {
      continue;
    }

    const horizontalOverflow = distanceBetweenIntervals(
      body.left,
      body.right,
      getSurfaceMinAnchorX(segment),
      getSurfaceMaxAnchorX(segment),
    );
    // Prefer triangle hyps over a tile floor under the ramp, and stick to the
    // last surface briefly so ramp feet don't flicker floor↔triangle each frame.
    const triangleBias = segment.triangle ? -28 : 0;
    const stickyBias = preferredSurfaceId && segment.id === preferredSurfaceId ? -18 : 0;
    const score = verticalDistance * 4 + horizontalOverflow + triangleBias + stickyBias;
    if (score < bestScore) {
      best = segment;
      bestScore = score;
    }
  }

  return best;
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

export function isSwordsmanLadderTraversalEdge(
  edge: SwordsmanTraversalEdge | null,
): edge is SwordsmanTraversalEdge & { type: 'ladder-up' | 'ladder-down' } {
  return edge?.type === 'ladder-up' || edge?.type === 'ladder-down';
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
