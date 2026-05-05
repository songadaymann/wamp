import {
  ROOM_HEIGHT,
  ROOM_WIDTH,
  TILE_SIZE,
} from '../config';
import type { RoomSnapshot } from '../persistence/roomModel';
import { getTerrainTileCollisionProfile } from '../scenes/overworld/terrainCollision';
import {
  getSwordsmanTraversalAirSpeed,
  SWORDSMAN_AI_AIR_SPEED,
  SWORDSMAN_AI_JUMP_VELOCITY_X,
  SWORDSMAN_AI_JUMP_VELOCITY_Y,
  SWORDSMAN_AI_LADDER_CLIMB_SPEED,
  SWORDSMAN_AI_WALL_JUMP_VELOCITY_X,
  SWORDSMAN_AI_WALL_JUMP_VELOCITY_Y,
} from './swordsmanTuning';
import {
  getSwordsmanDropDownAirVelocityX,
} from './swordsmanTraversalSkills';
import {
  getSwordsmanTraversalContext,
  getSwordsmanTraversalCurrentNodeId,
  getSwordsmanTraversalTargetContext,
  isSwordsmanLadderTraversalEdge,
  measureSwordsmanTraversalNodeDistanceToBody,
  type SwordsmanBodySnapshot,
  type SwordsmanTraversalEdge,
  type SwordsmanTraversalGraph,
  type SwordsmanTraversalNode,
  type SwordsmanTraversalTargetContext,
} from './swordsmanTraversal';

export type SwordsmanTraversalPlannerMode = 'classic' | 'robust';

export interface SwordsmanRobustTraversalPlan {
  edges: SwordsmanTraversalEdge[];
  currentNodeId: string | null;
  targetNodeId: string | null;
  targetNodeIds: string[];
  exactRoute: boolean;
  routeCost: number;
  expandedStates: number;
  simulatedEdges: number;
  planDurationMs: number;
}

export interface SwordsmanRobustTraversalRequest {
  room: RoomSnapshot;
  graph: SwordsmanTraversalGraph;
  enemy: SwordsmanBodySnapshot;
  target: SwordsmanBodySnapshot;
  blockedEdgeIds: ReadonlySet<string>;
  bodyWidth: number;
  bodyHeight: number;
}

export interface SwordsmanTraversalEdgeSimulationDebug {
  edgeId: string;
  success: boolean;
  travelMs: number;
}

interface SearchState {
  nodeId: string;
  edges: SwordsmanTraversalEdge[];
  cost: number;
  heuristic: number;
  score: number;
  visited: Set<string>;
}

interface SimBody {
  centerX: number;
  centerY: number;
  velocityX: number;
  velocityY: number;
  onFloor: boolean;
  wallContactSide: -1 | 0 | 1;
  blockedLeft: boolean;
  blockedRight: boolean;
  blockedUp: boolean;
  blockedDown: boolean;
}

interface EdgeSimulationResult {
  success: boolean;
  travelMs: number;
}

const ROBUST_MAX_SEARCH_DEPTH = 8;
const ROBUST_MAX_SEARCH_STATES = 160;
const ROBUST_ROUTE_COMMIT_MS = 900;
const ROBUST_REPLAN_INTERVAL_MS = 420;
const ROBUST_FIRST_EDGE_DIRECTION_PENALTY = 52;
const ROBUST_FIRST_EDGE_VERTICAL_DIRECTION_THRESHOLD_PX = TILE_SIZE * 0.75;
const ROBUST_FIRST_EDGE_VERTICAL_DIRECTION_PENALTY = 140;
const ROBUST_FIRST_EDGE_VERTICAL_MOVE_WEIGHT = 1.5;
const ROBUST_FIRST_EDGE_HEURISTIC_REGRESSION_WEIGHT = 1.35;
const GRAVITY_PX_PER_S2 = 700;
const GROUND_SPEED_PX_PER_S = 72;
const SIMULATION_STEP_MS = 1000 / 60;
const MAX_EDGE_SIMULATION_MS = 2200;
const OUT_OF_BOUNDS_PADDING_PX = 64;
const SURFACE_PROBE_INSET_PX = 1;
const EPSILON = 0.01;
const EDGE_SIMULATION_CACHE_LIMIT = 4096;

const edgeSimulationCache = new Map<string, EdgeSimulationResult>();

export const SWORDSMAN_AI_ROBUST_ROUTE_COMMIT_MS = ROBUST_ROUTE_COMMIT_MS;
export const SWORDSMAN_AI_ROBUST_REPLAN_INTERVAL_MS = ROBUST_REPLAN_INTERVAL_MS;

export function planSwordsmanRobustTraversal(
  request: SwordsmanRobustTraversalRequest,
): SwordsmanRobustTraversalPlan | null {
  const startedAt = performance.now();
  const {
    room,
    graph,
    enemy,
    target,
    blockedEdgeIds,
    bodyWidth,
    bodyHeight,
  } = request;
  const currentContext = getSwordsmanTraversalContext(graph, enemy);
  const targetContext = getSwordsmanTraversalTargetContext(graph, target);

  if (currentContext.startNodeIds.length === 0 || targetContext.targetNodeIds.length === 0) {
    return null;
  }

  if (
    currentContext.currentNodeId &&
    targetContext.targetNodeIds.includes(currentContext.currentNodeId)
  ) {
    return {
      edges: [],
      currentNodeId: currentContext.currentNodeId,
      targetNodeId: targetContext.targetNodeId,
      targetNodeIds: targetContext.targetNodeIds,
      exactRoute: true,
      routeCost: 0,
      expandedStates: 0,
      simulatedEdges: 0,
      planDurationMs: performance.now() - startedAt,
    };
  }

  const targetIdSet = new Set(targetContext.targetNodeIds);
  const frontier: SearchState[] = [];
  const bestCostByState = new Map<string, number>();
  let bestPlan: SearchState | null = null;
  let bestPartialPlan: SearchState | null = null;
  let expandedStates = 0;
  let simulatedEdges = 0;
  let bestStartHeuristic = Number.POSITIVE_INFINITY;

  for (const startNodeId of currentContext.startNodeIds) {
    const heuristic = estimateRemainingCost(graph, startNodeId, targetContext, target);
    bestStartHeuristic = Math.min(bestStartHeuristic, heuristic);
    frontier.push({
      nodeId: startNodeId,
      edges: [],
      cost: 0,
      heuristic,
      score: heuristic,
      visited: new Set([startNodeId]),
    });
    bestCostByState.set(`${startNodeId}:0`, 0);
  }

  while (frontier.length > 0 && expandedStates < ROBUST_MAX_SEARCH_STATES) {
    frontier.sort((left, right) => left.score - right.score);
    const current = frontier.shift();
    if (!current) {
      break;
    }

    expandedStates += 1;
    if (current.edges.length >= ROBUST_MAX_SEARCH_DEPTH) {
      continue;
    }

    for (const edge of graph.edgesByNodeId.get(current.nodeId) ?? []) {
      if (blockedEdgeIds.has(edge.id) || current.visited.has(edge.toId)) {
        continue;
      }

      const simulation = simulateTraversalEdge(
        room,
        graph,
        edge,
        bodyWidth,
        bodyHeight,
      );
      if (!simulation.success) {
        continue;
      }
      simulatedEdges += 1;

      const nextEdges = [...current.edges, edge];
      const heuristic = estimateRemainingCost(graph, edge.toId, targetContext, target);
      const nextCost =
        current.cost +
        simulation.travelMs +
        (nextEdges.length === 1
          ? scoreRobustFirstEdge(graph, edge, enemy, target, current.heuristic, heuristic)
          : 0);
      const stateKey = `${edge.toId}:${nextEdges.length}`;
      const previousBestCost = bestCostByState.get(stateKey);
      if (previousBestCost !== undefined && previousBestCost <= nextCost) {
        continue;
      }
      bestCostByState.set(stateKey, nextCost);

      const nextState: SearchState = {
        nodeId: edge.toId,
        edges: nextEdges,
        cost: nextCost,
        heuristic,
        score: nextCost + heuristic,
        visited: new Set([...current.visited, edge.toId]),
      };

      if (targetIdSet.has(edge.toId)) {
        if (!bestPlan || nextState.cost < bestPlan.cost) {
          bestPlan = nextState;
        }
        continue;
      }

      if (
        nextState.edges.length > 0 &&
        nextState.heuristic < bestStartHeuristic - 1 &&
        (
          !bestPartialPlan ||
          nextState.heuristic < bestPartialPlan.heuristic ||
          (Math.abs(nextState.heuristic - bestPartialPlan.heuristic) <= 0.01 &&
            nextState.cost < bestPartialPlan.cost)
        )
      ) {
        bestPartialPlan = nextState;
      }

      frontier.push(nextState);
    }
  }

  const selectedPlan = bestPlan ?? bestPartialPlan;
  if (!selectedPlan) {
    return null;
  }

  return {
    edges: selectedPlan.edges,
    currentNodeId: currentContext.currentNodeId,
    targetNodeId: targetContext.targetNodeId,
    targetNodeIds: targetContext.targetNodeIds,
    exactRoute: selectedPlan === bestPlan,
    routeCost: selectedPlan.cost,
    expandedStates,
    simulatedEdges,
    planDurationMs: performance.now() - startedAt,
  };
}

export function debugSimulateSwordsmanTraversalEdge(
  room: RoomSnapshot,
  graph: SwordsmanTraversalGraph,
  edge: SwordsmanTraversalEdge,
  bodyWidth: number,
  bodyHeight: number,
): SwordsmanTraversalEdgeSimulationDebug {
  const result = simulateTraversalEdge(room, graph, edge, bodyWidth, bodyHeight);
  return {
    edgeId: edge.id,
    success: result.success,
    travelMs: Math.round(result.travelMs),
  };
}

function estimateRemainingCost(
  graph: SwordsmanTraversalGraph,
  nodeId: string,
  targetContext: SwordsmanTraversalTargetContext,
  target: SwordsmanBodySnapshot,
): number {
  if (targetContext.targetNodeIds.includes(nodeId)) {
    return 0;
  }

  const node = graph.nodesById.get(nodeId);
  if (!node) {
    return Number.POSITIVE_INFINITY;
  }

  const { horizontalDistance, verticalDistance } =
    measureSwordsmanTraversalNodeDistanceToBody(node, target);
  return horizontalDistance * 1.8 + verticalDistance * 2.2;
}

function scoreRobustFirstEdge(
  graph: SwordsmanTraversalGraph,
  edge: SwordsmanTraversalEdge,
  enemy: SwordsmanBodySnapshot,
  target: SwordsmanBodySnapshot,
  currentHeuristic: number,
  nextHeuristic: number,
): number {
  const setupPenalty = Math.abs(edge.setupX - enemy.centerX) * 1.5;
  const currentTargetDistance = Math.abs(target.centerX - enemy.centerX);
  const setupTargetDistance = Math.abs(target.centerX - edge.setupX);
  const targetDirection = directionFromDelta(target.centerX - enemy.centerX, edge.directionX);
  const setupDirection = directionFromDelta(edge.setupX - enemy.centerX, edge.directionX);
  const directionPenalty =
    currentTargetDistance > TILE_SIZE * 0.75 && targetDirection !== setupDirection
      ? ROBUST_FIRST_EDGE_DIRECTION_PENALTY
      : 0;
  const movingAwayPenalty = Math.max(0, setupTargetDistance - currentTargetDistance) * 4;
  const verticalDirectionPenalty = scoreRobustFirstEdgeVerticalDirectionPenalty(
    graph,
    edge,
    enemy,
    target,
  );
  const heuristicRegressionPenalty = Math.max(0, nextHeuristic - currentHeuristic) *
    ROBUST_FIRST_EDGE_HEURISTIC_REGRESSION_WEIGHT;
  return setupPenalty + directionPenalty + movingAwayPenalty + verticalDirectionPenalty +
    heuristicRegressionPenalty;
}

function scoreRobustFirstEdgeVerticalDirectionPenalty(
  graph: SwordsmanTraversalGraph,
  edge: SwordsmanTraversalEdge,
  enemy: SwordsmanBodySnapshot,
  target: SwordsmanBodySnapshot,
): number {
  const targetVerticalDelta = target.centerY - enemy.centerY;
  if (Math.abs(targetVerticalDelta) <= ROBUST_FIRST_EDGE_VERTICAL_DIRECTION_THRESHOLD_PX) {
    return 0;
  }

  const verticalMove = getTraversalEdgeVerticalMove(graph, edge);
  if (verticalMove === null || Math.abs(verticalMove) <= 1) {
    return 0;
  }

  const movingAwayVertically =
    (targetVerticalDelta > 0 && verticalMove < -1) ||
    (targetVerticalDelta < 0 && verticalMove > 1);
  if (!movingAwayVertically) {
    return 0;
  }

  return ROBUST_FIRST_EDGE_VERTICAL_DIRECTION_PENALTY +
    Math.min(80, Math.abs(verticalMove) * ROBUST_FIRST_EDGE_VERTICAL_MOVE_WEIGHT);
}

function getTraversalEdgeVerticalMove(
  graph: SwordsmanTraversalGraph,
  edge: SwordsmanTraversalEdge,
): number | null {
  const sourceNode = graph.nodesById.get(edge.fromId);
  const targetNode = graph.nodesById.get(edge.toId);
  if (!sourceNode || !targetNode) {
    return null;
  }

  return getTraversalNodeReferenceY(targetNode) - getTraversalNodeReferenceY(sourceNode);
}

function getTraversalNodeReferenceY(node: SwordsmanTraversalNode): number {
  return node.kind === 'surface' ? node.topY : node.centerY;
}

function simulateTraversalEdge(
  room: RoomSnapshot,
  graph: SwordsmanTraversalGraph,
  edge: SwordsmanTraversalEdge,
  bodyWidth: number,
  bodyHeight: number,
): EdgeSimulationResult {
  const cacheKey = buildEdgeSimulationCacheKey(graph.cacheKey, edge.id, bodyWidth, bodyHeight);
  const cached = edgeSimulationCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const sourceNode = graph.nodesById.get(edge.fromId);
  const targetNode = graph.nodesById.get(edge.toId);
  if (!sourceNode || !targetNode) {
    return rememberEdgeSimulation(cacheKey, { success: false, travelMs: 0 });
  }

  if (isSwordsmanLadderTraversalEdge(edge)) {
    return rememberEdgeSimulation(
      cacheKey,
      simulateLadderTraversalEdge(edge, sourceNode, targetNode),
    );
  }

  const body = createInitialSimBody(edge, sourceNode, targetNode, bodyWidth, bodyHeight);
  let elapsedMs = 0;
  let preserveLaunchSteps = needsLaunchImpulse(edge) ? 1 : 0;

  while (elapsedMs < MAX_EDGE_SIMULATION_MS) {
    if (preserveLaunchSteps > 0) {
      preserveLaunchSteps -= 1;
    } else {
      applySteeringVelocity(graph, edge, body, bodyWidth);
    }

    stepSimBody(room, body, bodyWidth, bodyHeight);
    elapsedMs += SIMULATION_STEP_MS;

    if (body.blockedUp && edge.type !== 'drop-down') {
      break;
    }

    const currentNodeId = getSwordsmanTraversalCurrentNodeId(
      graph,
      toBodySnapshot(body, bodyWidth, bodyHeight),
    );
    if (currentNodeId === edge.toId && hasSimBodyReachedTraversalTarget(targetNode, body)) {
      return rememberEdgeSimulation(cacheKey, {
        success: true,
        travelMs: elapsedMs,
      });
    }

    if (hasSimulationEscapedRoom(body)) {
      break;
    }
  }

  return rememberEdgeSimulation(cacheKey, { success: false, travelMs: elapsedMs });
}

function simulateLadderTraversalEdge(
  edge: SwordsmanTraversalEdge,
  sourceNode: SwordsmanTraversalNode,
  targetNode: SwordsmanTraversalNode,
): EdgeSimulationResult {
  if (sourceNode.kind !== 'surface' || targetNode.kind !== 'surface') {
    return { success: false, travelMs: 0 };
  }

  const climbDistance = Math.abs(targetNode.topY - sourceNode.topY);
  const alignDistance = Math.abs((edge.ladderX ?? edge.setupX) - edge.setupX);
  return {
    success: climbDistance > 0,
    travelMs:
      120 +
      (alignDistance / GROUND_SPEED_PX_PER_S) * 1000 +
      (climbDistance / SWORDSMAN_AI_LADDER_CLIMB_SPEED) * 1000,
  };
}

function hasSimBodyReachedTraversalTarget(
  targetNode: SwordsmanTraversalNode,
  body: SimBody,
): boolean {
  if (targetNode.kind === 'surface') {
    return body.onFloor || body.blockedDown;
  }

  return body.wallContactSide !== 0;
}

function createInitialSimBody(
  edge: SwordsmanTraversalEdge,
  sourceNode: SwordsmanTraversalNode,
  targetNode: SwordsmanTraversalNode,
  bodyWidth: number,
  bodyHeight: number,
): SimBody {
  if (sourceNode.kind === 'surface') {
    const centerY = sourceNode.topY - bodyHeight * 0.5;
    const body: SimBody = {
      centerX: edge.setupX,
      centerY,
      velocityX: 0,
      velocityY: 0,
      onFloor: true,
      wallContactSide: 0,
      blockedLeft: false,
      blockedRight: false,
      blockedUp: false,
      blockedDown: false,
    };
    if (needsLaunchImpulse(edge)) {
      body.onFloor = false;
      body.velocityX = edge.directionX * SWORDSMAN_AI_JUMP_VELOCITY_X;
      body.velocityY = SWORDSMAN_AI_JUMP_VELOCITY_Y;
    }
    return body;
  }

  const preferredCenterY =
    targetNode.kind === 'surface'
      ? clamp(targetNode.topY + 40, sourceNode.topY, sourceNode.bottomY)
      : sourceNode.centerY;
  return {
    centerX:
      sourceNode.contactSide === 1
        ? sourceNode.x - bodyWidth * 0.5 - EPSILON
        : sourceNode.x + bodyWidth * 0.5 + EPSILON,
    centerY: preferredCenterY,
    velocityX: edge.directionX * SWORDSMAN_AI_WALL_JUMP_VELOCITY_X,
    velocityY: SWORDSMAN_AI_WALL_JUMP_VELOCITY_Y,
    onFloor: false,
    wallContactSide: 0,
    blockedLeft: false,
    blockedRight: false,
    blockedUp: false,
    blockedDown: false,
  };
}

function needsLaunchImpulse(edge: SwordsmanTraversalEdge): boolean {
  return edge.type !== 'drop-down';
}

function applySteeringVelocity(
  graph: SwordsmanTraversalGraph,
  edge: SwordsmanTraversalEdge,
  body: SimBody,
  bodyWidth: number,
): void {
  if (edge.type === 'drop-down' && body.onFloor) {
    body.velocityX = edge.directionX * GROUND_SPEED_PX_PER_S;
    body.velocityY = 0;
    return;
  }

  if (edge.type === 'drop-down') {
    const targetNode = graph.nodesById.get(edge.toId);
    if (targetNode?.kind === 'surface') {
      body.velocityX = getSwordsmanDropDownAirVelocityX(
        edge,
        targetNode,
        body.centerX,
        bodyWidth,
      );
      return;
    }
  }

  const steerDirection = directionFromDelta(edge.targetX - body.centerX, edge.directionX);
  const airSpeed =
    edge.type === 'drop-down'
      ? SWORDSMAN_AI_AIR_SPEED
      : getSwordsmanTraversalAirSpeed(edge.id, steerDirection, body.velocityX);
  body.velocityX = steerDirection * airSpeed;
}

function stepSimBody(
  room: RoomSnapshot,
  body: SimBody,
  bodyWidth: number,
  bodyHeight: number,
): void {
  body.blockedLeft = false;
  body.blockedRight = false;
  body.blockedUp = false;
  body.blockedDown = false;
  body.wallContactSide = 0;

  if (body.onFloor && !hasSupportBelow(room, body, bodyWidth, bodyHeight)) {
    body.onFloor = false;
  }

  if (!body.onFloor) {
    body.velocityY += GRAVITY_PX_PER_S2 * (SIMULATION_STEP_MS / 1000);
  } else {
    body.velocityY = 0;
  }

  const previousCenterX = body.centerX;
  body.centerX += body.velocityX * (SIMULATION_STEP_MS / 1000);
  resolveHorizontalCollisions(room, body, bodyWidth, bodyHeight, previousCenterX);

  const previousCenterY = body.centerY;
  body.centerY += body.velocityY * (SIMULATION_STEP_MS / 1000);
  resolveVerticalCollisions(room, body, bodyWidth, bodyHeight, previousCenterY);

  if (body.blockedDown) {
    body.onFloor = true;
    body.velocityY = 0;
  } else if (hasSupportBelow(room, body, bodyWidth, bodyHeight)) {
    body.onFloor = true;
  } else {
    body.onFloor = false;
  }

  body.wallContactSide = body.blockedLeft ? -1 : body.blockedRight ? 1 : 0;
}

function resolveHorizontalCollisions(
  room: RoomSnapshot,
  body: SimBody,
  bodyWidth: number,
  bodyHeight: number,
  previousCenterX: number,
): void {
  if (Math.abs(body.velocityX) <= EPSILON) {
    return;
  }

  const movingRight = body.velocityX > 0;
  const bodyTop = getTop(body, bodyHeight) + 1;
  const bodyBottom = getBottom(body, bodyHeight) - 1;
  const bodyLeft = getLeft(body, bodyWidth);
  const bodyRight = getRight(body, bodyWidth);
  const previousLeft = previousCenterX - bodyWidth * 0.5;
  const previousRight = previousCenterX + bodyWidth * 0.5;
  let resolvedCenterX = body.centerX;

  for (const rect of getCollidingTerrainRects(room, bodyLeft, bodyTop, bodyRight, bodyBottom)) {
    if (movingRight && previousRight <= rect.left + EPSILON) {
      resolvedCenterX = Math.min(resolvedCenterX, rect.left - bodyWidth * 0.5 - EPSILON);
      body.blockedRight = true;
    } else if (!movingRight && previousLeft >= rect.right - EPSILON) {
      resolvedCenterX = Math.max(resolvedCenterX, rect.right + bodyWidth * 0.5 + EPSILON);
      body.blockedLeft = true;
    }
  }

  body.centerX = resolvedCenterX;
  if (body.blockedLeft || body.blockedRight) {
    body.velocityX = 0;
  }
}

function resolveVerticalCollisions(
  room: RoomSnapshot,
  body: SimBody,
  bodyWidth: number,
  bodyHeight: number,
  previousCenterY: number,
): void {
  if (Math.abs(body.velocityY) <= EPSILON) {
    return;
  }

  const movingDown = body.velocityY > 0;
  const bodyTop = getTop(body, bodyHeight);
  const bodyBottom = getBottom(body, bodyHeight);
  const bodyLeft = getLeft(body, bodyWidth) + 1;
  const bodyRight = getRight(body, bodyWidth) - 1;
  const previousTop = previousCenterY - bodyHeight * 0.5;
  const previousBottom = previousCenterY + bodyHeight * 0.5;
  let resolvedCenterY = body.centerY;

  for (const rect of getCollidingTerrainRects(room, bodyLeft, bodyTop, bodyRight, bodyBottom)) {
    if (movingDown && previousBottom <= rect.top + EPSILON) {
      resolvedCenterY = Math.min(resolvedCenterY, rect.top - bodyHeight * 0.5 - EPSILON);
      body.blockedDown = true;
    } else if (!movingDown && previousTop >= rect.bottom - EPSILON) {
      resolvedCenterY = Math.max(resolvedCenterY, rect.bottom + bodyHeight * 0.5 + EPSILON);
      body.blockedUp = true;
    }
  }

  body.centerY = resolvedCenterY;
  if (body.blockedUp || body.blockedDown) {
    body.velocityY = 0;
  }
}

function hasSupportBelow(
  room: RoomSnapshot,
  body: SimBody,
  bodyWidth: number,
  bodyHeight: number,
): boolean {
  const bottom = getBottom(body, bodyHeight);
  const probeY = bottom + 1;
  const leftProbe = getLeft(body, bodyWidth) + SURFACE_PROBE_INSET_PX;
  const rightProbe = getRight(body, bodyWidth) - SURFACE_PROBE_INSET_PX;
  const centerProbe = body.centerX;
  return (
    pointCollides(room, leftProbe, probeY) ||
    pointCollides(room, centerProbe, probeY) ||
    pointCollides(room, rightProbe, probeY)
  );
}

function pointCollides(room: RoomSnapshot, localX: number, localY: number): boolean {
  const tileX = Math.floor(localX / TILE_SIZE);
  const tileY = Math.floor(localY / TILE_SIZE);
  if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) {
    return false;
  }

  const profile = getTerrainTileCollisionProfile(room, tileX, tileY);
  if (!profile.hasCollision) {
    return false;
  }

  const localPixelY = localY - tileY * TILE_SIZE;
  return localPixelY >= profile.topInset && localPixelY < TILE_SIZE - profile.bottomInset;
}

function getCollidingTerrainRects(
  room: RoomSnapshot,
  left: number,
  top: number,
  right: number,
  bottom: number,
): Array<{ left: number; top: number; right: number; bottom: number }> {
  const collidingRects: Array<{ left: number; top: number; right: number; bottom: number }> = [];
  const startTileX = Math.max(0, Math.floor(left / TILE_SIZE));
  const endTileX = Math.min(ROOM_WIDTH - 1, Math.floor((right - EPSILON) / TILE_SIZE));
  const startTileY = Math.max(0, Math.floor(top / TILE_SIZE));
  const endTileY = Math.min(ROOM_HEIGHT - 1, Math.floor((bottom - EPSILON) / TILE_SIZE));

  for (let tileY = startTileY; tileY <= endTileY; tileY += 1) {
    for (let tileX = startTileX; tileX <= endTileX; tileX += 1) {
      const profile = getTerrainTileCollisionProfile(room, tileX, tileY);
      if (!profile.hasCollision) {
        continue;
      }

      const rect = {
        left: tileX * TILE_SIZE,
        top: tileY * TILE_SIZE + profile.topInset,
        right: (tileX + 1) * TILE_SIZE,
        bottom: (tileY + 1) * TILE_SIZE - profile.bottomInset,
      };
      if (right <= rect.left || left >= rect.right || bottom <= rect.top || top >= rect.bottom) {
        continue;
      }

      collidingRects.push(rect);
    }
  }

  return collidingRects;
}

function hasSimulationEscapedRoom(body: SimBody): boolean {
  return (
    body.centerX < -OUT_OF_BOUNDS_PADDING_PX ||
    body.centerX > ROOM_WIDTH * TILE_SIZE + OUT_OF_BOUNDS_PADDING_PX ||
    body.centerY > ROOM_HEIGHT * TILE_SIZE + OUT_OF_BOUNDS_PADDING_PX ||
    body.centerY < -OUT_OF_BOUNDS_PADDING_PX
  );
}

function toBodySnapshot(
  body: SimBody,
  bodyWidth: number,
  bodyHeight: number,
): SwordsmanBodySnapshot {
  return {
    centerX: body.centerX,
    centerY: body.centerY,
    left: getLeft(body, bodyWidth),
    right: getRight(body, bodyWidth),
    bottom: getBottom(body, bodyHeight),
    onFloor: body.onFloor,
    wallContactSide: body.wallContactSide,
  };
}

function getLeft(body: SimBody, bodyWidth: number): number {
  return body.centerX - bodyWidth * 0.5;
}

function getRight(body: SimBody, bodyWidth: number): number {
  return body.centerX + bodyWidth * 0.5;
}

function getTop(body: SimBody, bodyHeight: number): number {
  return body.centerY - bodyHeight * 0.5;
}

function getBottom(body: SimBody, bodyHeight: number): number {
  return body.centerY + bodyHeight * 0.5;
}

function buildEdgeSimulationCacheKey(
  graphCacheKey: string,
  edgeId: string,
  bodyWidth: number,
  bodyHeight: number,
): string {
  return `${graphCacheKey}:${edgeId}:${Math.round(bodyWidth)}:${Math.round(bodyHeight)}`;
}

function rememberEdgeSimulation(
  key: string,
  value: EdgeSimulationResult,
): EdgeSimulationResult {
  if (edgeSimulationCache.size >= EDGE_SIMULATION_CACHE_LIMIT) {
    edgeSimulationCache.clear();
  }
  edgeSimulationCache.set(key, value);
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function directionFromDelta(delta: number, fallback: number): -1 | 1 {
  if (delta > EPSILON) {
    return 1;
  }
  if (delta < -EPSILON) {
    return -1;
  }
  return fallback >= 0 ? 1 : -1;
}
