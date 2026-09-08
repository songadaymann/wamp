import { TILE_SIZE } from '../../../config';
import type { RoomSnapshot } from '../../../persistence/roomModel';
import type { SwordsmanObjectiveTarget } from '../../../enemies/swordsmanObjectives';
import {
  getSwordsmanTraversalEdgeById,
  type SwordsmanBodySnapshot,
  type SwordsmanTraversalEdge,
  type SwordsmanTraversalGraph,
  type getSwordsmanTraversalContext,
} from '../../../enemies/swordsmanTraversal';
import { planSwordsmanRobustTraversal } from '../../../enemies/swordsmanRobustPlanner';
import type { LoadedRoomObject, LoadedRoomObjectRuntimeState } from './model';
import type { ArcadeObjectBody } from './bodies';

const SWORDSMAN_AI_COLLECT_NODE_COIN_BONUS = 48;
const SWORDSMAN_AI_COLLECT_CURRENT_SWEEP_BEHIND_GRACE_PX = 18;
const SWORDSMAN_AI_COLLECT_PRODUCTIVE_SWEEP_BACKTRACK_PX = 56;
export const SWORDSMAN_AI_COLLECT_ROUTE_COMMIT_MS = 7200;
const SWORDSMAN_AI_COLLECT_ROUTE_EDGE_WEIGHT = 720;
const SWORDSMAN_AI_COLLECT_ROUTE_COST_WEIGHT = 0.35;
const SWORDSMAN_AI_COLLECT_ROUTE_SETUP_WEIGHT = 2.1;
const SWORDSMAN_AI_COLLECT_ROUTE_BACKTRACK_WEIGHT = 8.5;
const SWORDSMAN_AI_COLLECT_ROUTE_EMPTY_SETUP_WEIGHT = 2.4;
const SWORDSMAN_AI_COLLECT_ROUTE_DEPLETED_CURRENT_SETUP_WEIGHT = 7.2;
const SWORDSMAN_AI_COLLECT_ROUTE_DEPLETED_SURFACE_STEP_PENALTY = 420;
const SWORDSMAN_AI_COLLECT_ROUTE_PARTIAL_PENALTY = 820;
const SWORDSMAN_AI_COLLECT_ROUTE_UPWARD_WEIGHT = 4.75;
const SWORDSMAN_AI_COLLECT_ROUTE_DROP_BONUS_WEIGHT = 1.25;
const SWORDSMAN_AI_COLLECT_ROUTE_NODE_COIN_VALUE = 96;
const SWORDSMAN_AI_COLLECT_ROUTE_SETUP_COIN_VALUE = 132;
const SWORDSMAN_AI_COLLECT_ROUTE_VALUE_CAP = 2400;
const SWORDSMAN_AI_COLLECT_ROUTE_WALL_EDGE_PENALTY = 560;
const SWORDSMAN_AI_COLLECT_ROUTE_RECENT_WALL_FAILURE_PENALTY = 1250;
const SWORDSMAN_AI_COLLECT_WALL_ROUTE_LOCAL_SWEEP_PENALTY_MIN = 2600;
const SWORDSMAN_AI_COLLECT_WALL_ROUTE_LOCAL_SWEEP_SCORE_MIN = 3200;
const SWORDSMAN_AI_COLLECT_CURRENT_SWEEP_ABOVE_PENALTY_WEIGHT = 28;

export type CollectNodeCandidate = {
  collectible: LoadedRoomObject;
  targetBody: ArcadeObjectBody;
  targetSnapshot: SwordsmanBodySnapshot;
  targetNodeId: string | null;
  objectiveTarget: SwordsmanObjectiveTarget;
  rawMetric: number;
  collectibleCount: number;
  collectDeltaY: number;
  traversalCenterXSum: number;
};
export type CollectSweepCandidate = {
  collectible: LoadedRoomObject;
  objectiveTarget: SwordsmanObjectiveTarget;
  targetSnapshot: SwordsmanBodySnapshot;
  rawMetric: number;
  collectDeltaY: number;
};
export type CollectNodeStats = {
  count: number;
};

export type CollectTarget = { collectible: LoadedRoomObject; objectiveTarget: SwordsmanObjectiveTarget };
export type CollectSelectionState = Pick<LoadedRoomObjectRuntimeState,
  'aiCollectState' | 'aiCollectRouteTargetNodeId' | 'aiCollectRouteExpiresAt' |
  'aiCollectRouteScore' | 'aiCollectRouteValue' | 'aiCollectRoutePenalty'>;
export interface CollectCandidateInventory {
  groupedCandidates: Map<string, CollectNodeCandidate>;
  currentSweepCandidates: CollectSweepCandidate[];
  collectNodeStats: Map<string, CollectNodeStats>;
  bestImmediateTarget: (CollectTarget & { metric: number }) | null;
  bestOverheadJumpTarget: (CollectTarget & { metric: number }) | null;
}
export interface CollectSelectionInput extends CollectCandidateInventory {
  now: number;
  room: RoomSnapshot;
  graph: SwordsmanTraversalGraph;
  enemySnapshot: SwordsmanBodySnapshot;
  currentContext: ReturnType<typeof getSwordsmanTraversalContext>;
  blockedEdgeIds: ReadonlySet<string>;
  sweepDirectionX: -1 | 1;
  bodyWidth: number;
  bodyHeight: number;
  runtime: Readonly<LoadedRoomObjectRuntimeState>;
  buildNodeTarget: (candidates: CollectNodeCandidate[], nodeId: string) => CollectTarget | null;
}

/** Select using a local state draft; only the runtime owner applies the result. */
export function selectSwordsmanCollectTarget(input: CollectSelectionInput): {
  target: CollectTarget | null; state: CollectSelectionState;
} {
  const { groupedCandidates, currentSweepCandidates, collectNodeStats,
    bestImmediateTarget, bestOverheadJumpTarget, now, enemySnapshot,
    currentContext, sweepDirectionX,
    runtime, buildNodeTarget } = input;
  const state: CollectSelectionState = {
    aiCollectState: runtime.aiCollectState,
    aiCollectRouteTargetNodeId: runtime.aiCollectRouteTargetNodeId,
    aiCollectRouteExpiresAt: runtime.aiCollectRouteExpiresAt,
    aiCollectRouteScore: runtime.aiCollectRouteScore,
    aiCollectRouteValue: runtime.aiCollectRouteValue,
    aiCollectRoutePenalty: runtime.aiCollectRoutePenalty,
  };
  const clearRoute = (): void => {
    state.aiCollectRouteTargetNodeId = null;
    state.aiCollectRouteExpiresAt = 0;
    state.aiCollectRouteScore = null;
    state.aiCollectRouteValue = 0;
    state.aiCollectRoutePenalty = 0;
    if (state.aiCollectState === 'route') state.aiCollectState = null;
  };
  const chooseTarget = (): CollectTarget | null => {
    if (bestImmediateTarget) {
      return {
        collectible: bestImmediateTarget.collectible,
        objectiveTarget: bestImmediateTarget.objectiveTarget,
      };
    }

    if (bestOverheadJumpTarget) {
      const overheadJumpTarget = bestOverheadJumpTarget as {
        collectible: LoadedRoomObject;
        objectiveTarget: SwordsmanObjectiveTarget;
        metric: number;
      };
      clearRoute();
      state.aiCollectState = 'jump';
      return {
        collectible: overheadJumpTarget.collectible,
        objectiveTarget: overheadJumpTarget.objectiveTarget,
      };
    }

    const candidates = Array.from(groupedCandidates.values(), (candidate) => ({ ...candidate })).sort(
      (left, right) => left.rawMetric - right.rawMetric,
    );

    for (const candidate of candidates) {
      if (
        candidate.collectibleCount <= 1 ||
        candidate.targetNodeId !== currentContext.currentNodeId ||
        !candidate.objectiveTarget.traversalSnapshot
      ) {
        continue;
      }

      const halfWidth = Math.max(
        1,
        (candidate.targetSnapshot.right - candidate.targetSnapshot.left) * 0.5,
      );
      const groupCenterX = candidate.traversalCenterXSum / candidate.collectibleCount;
      const adjustedSnapshot: SwordsmanBodySnapshot = {
        ...candidate.targetSnapshot,
        centerX: groupCenterX,
        left: groupCenterX - halfWidth,
        right: groupCenterX + halfWidth,
      };
      candidate.targetSnapshot = adjustedSnapshot;
      candidate.objectiveTarget = {
        ...candidate.objectiveTarget,
        traversalSnapshot: adjustedSnapshot,
      };
    }

    const currentSurfaceIsDepleted = Boolean(
      currentContext.currentSurface &&
        currentContext.currentNodeId &&
        !collectNodeStats.has(currentContext.currentNodeId),
    );

    const activeTraversalTargetNodeId = runtime.aiActiveTraversalNextNodeId;
    if (activeTraversalTargetNodeId && activeTraversalTargetNodeId !== currentContext.currentNodeId) {
      const activeTarget = buildNodeTarget(candidates, activeTraversalTargetNodeId);
      if (activeTarget) {
        state.aiCollectState = 'route';
        return activeTarget;
      }
    }

    if (
      currentContext.currentNodeId &&
      state.aiCollectRouteTargetNodeId === currentContext.currentNodeId
    ) {
      clearRoute();
    }

    const bestCurrentNodeTarget = selectCurrentSweepTarget(
      currentSweepCandidates, enemySnapshot, sweepDirectionX,
    );

    if (bestCurrentNodeTarget?.isProductive) {
      state.aiCollectState = 'sweep';
      return {
        collectible: bestCurrentNodeTarget.collectible,
        objectiveTarget: bestCurrentNodeTarget.objectiveTarget,
      };
    }

    const committedTargetNodeId = state.aiCollectRouteTargetNodeId;
    if (
      committedTargetNodeId &&
      committedTargetNodeId !== currentContext.currentNodeId &&
      now < state.aiCollectRouteExpiresAt
    ) {
      const committedCandidate = candidates.find(
        (candidate) => candidate.targetNodeId === committedTargetNodeId,
      );
      if (committedCandidate) {
        state.aiCollectState = 'route';
        return {
          collectible: committedCandidate.collectible,
          objectiveTarget: committedCandidate.objectiveTarget,
        };
      }

      const committedTarget = buildNodeTarget(candidates, committedTargetNodeId);
      if (committedTarget) {
        state.aiCollectState = 'route';
        return committedTarget;
      }
    }

    clearRoute();

    const bestRouteTarget = selectBestCollectRoute(input, candidates, currentSurfaceIsDepleted);

    if (
      bestRouteTarget &&
      bestCurrentNodeTarget &&
      bestRouteTarget.wallEdgeCount > 0 &&
      bestRouteTarget.penalty >= SWORDSMAN_AI_COLLECT_WALL_ROUTE_LOCAL_SWEEP_PENALTY_MIN &&
      bestRouteTarget.metric >= SWORDSMAN_AI_COLLECT_WALL_ROUTE_LOCAL_SWEEP_SCORE_MIN
    ) {
      state.aiCollectState = 'sweep';
      return {
        collectible: bestCurrentNodeTarget.collectible,
        objectiveTarget: bestCurrentNodeTarget.objectiveTarget,
      };
    }

    if (bestRouteTarget) {
      state.aiCollectState = 'route';
      state.aiCollectRouteTargetNodeId = bestRouteTarget.targetNodeId;
      state.aiCollectRouteExpiresAt = now + SWORDSMAN_AI_COLLECT_ROUTE_COMMIT_MS;
      state.aiCollectRouteScore = bestRouteTarget.metric;
      state.aiCollectRouteValue = bestRouteTarget.value;
      state.aiCollectRoutePenalty = bestRouteTarget.penalty;
      return {
        collectible: bestRouteTarget.collectible,
        objectiveTarget: bestRouteTarget.objectiveTarget,
      };
    }

    if (bestCurrentNodeTarget) {
      state.aiCollectState = 'sweep';
      return {
        collectible: bestCurrentNodeTarget.collectible,
        objectiveTarget: bestCurrentNodeTarget.objectiveTarget,
      };
    }

    const rawFallback = candidates.find(
      (candidate) =>
        candidate.targetNodeId !== null &&
        candidate.targetNodeId === currentContext.currentNodeId,
    ) ?? null;
    state.aiCollectState = rawFallback ? 'sweep' : null;
    return rawFallback
      ? {
          collectible: rawFallback.collectible,
          objectiveTarget: rawFallback.objectiveTarget,
        }
      : null;
  };
  return { target: chooseTarget(), state };
}

/** Route value and penalties are kept separate from target-priority/state transitions. */
function selectBestCollectRoute(
  input: CollectSelectionInput,
  candidates: CollectNodeCandidate[],
  currentSurfaceIsDepleted: boolean,
) {
  const { currentSweepCandidates, collectNodeStats, now, room, graph, enemySnapshot,
    currentContext, blockedEdgeIds, bodyWidth, bodyHeight, runtime, buildNodeTarget } = input;
  const countSetupPathCoins = (firstEdge: SwordsmanTraversalEdge | null): number => {
    if (
      !firstEdge ||
      !currentContext.currentNodeId ||
      firstEdge.fromId !== currentContext.currentNodeId
    ) {
      return 0;
    }

    const minX = Math.min(enemySnapshot.centerX, firstEdge.setupX) - TILE_SIZE * 0.5;
    const maxX = Math.max(enemySnapshot.centerX, firstEdge.setupX) + TILE_SIZE * 0.5;
    return currentSweepCandidates.filter((candidate) => {
      const centerX = candidate.targetSnapshot.centerX;
      return centerX >= minX && centerX <= maxX;
    }).length;
  };
  const scoreRouteCoinValue = (edges: readonly SwordsmanTraversalEdge[]): number => {
    let routeValue = 0;
    const seenNodeIds = new Set<string>();
    for (let index = 0; index < edges.length; index += 1) {
      const edge = edges[index];
      const node = graph.nodesById.get(edge.toId);
      const stats = node?.kind === 'surface' ? collectNodeStats.get(edge.toId) : null;
      if (!stats || seenNodeIds.has(edge.toId)) {
        continue;
      }

      seenNodeIds.add(edge.toId);
      const routeStep = index + 1;
      const discount = routeStep === 1 ? 1 : routeStep === 2 ? 0.72 : 0.48;
      routeValue +=
        Math.min(stats.count, 14) *
        SWORDSMAN_AI_COLLECT_ROUTE_NODE_COIN_VALUE *
        discount;
    }

    return Math.min(SWORDSMAN_AI_COLLECT_ROUTE_VALUE_CAP, routeValue);
  };
  const hasRecentWallRouteFailure = runtime.aiTraversalBlockedEdges.some((entry) => {
    if (entry.until <= now) {
      return false;
    }
    const blockedEdge = getSwordsmanTraversalEdgeById(graph, entry.edgeId);
    return (
      blockedEdge?.type === 'jump-to-wall' ||
      blockedEdge?.type === 'wall-jump' ||
      entry.edgeId.endsWith(':jump-to-wall') ||
      entry.edgeId.endsWith(':wall-jump')
    );
  });

  let bestRouteTarget: {
    collectible: LoadedRoomObject;
    objectiveTarget: SwordsmanObjectiveTarget;
    targetNodeId: string;
    metric: number;
    value: number;
    penalty: number;
    wallEdgeCount: number;
  } | null = null;
  for (const candidate of candidates) {
    if (!candidate.targetNodeId || candidate.targetNodeId === currentContext.currentNodeId) {
      continue;
    }

    const plan = planSwordsmanRobustTraversal({
      room,
      graph,
      enemy: enemySnapshot,
      target: candidate.targetSnapshot,
      blockedEdgeIds,
      bodyWidth: bodyWidth,
      bodyHeight: bodyHeight,
    });

    if (!plan || plan.edges.length === 0) {
      continue;
    }

    const partialTargetNodeId = plan.edges[plan.edges.length - 1]?.toId ?? null;
    const targetNodeId =
      plan.exactRoute ? candidate.targetNodeId : partialTargetNodeId;
    if (
      !targetNodeId ||
      targetNodeId === currentContext.currentNodeId ||
      (!plan.exactRoute && !collectNodeStats.has(targetNodeId))
    ) {
      continue;
    }

    const routeTarget = plan.exactRoute
      ? {
          collectible: candidate.collectible,
          objectiveTarget: candidate.objectiveTarget,
        }
      : buildNodeTarget(candidates, targetNodeId);
    if (!routeTarget) {
      continue;
    }

    const firstEdge = plan?.edges[0] ?? null;
    const setupDistance = firstEdge
      ? Math.abs(firstEdge.setupX - enemySnapshot.centerX)
      : 0;
    const setupDirection = firstEdge
      ? Math.sign(firstEdge.setupX - enemySnapshot.centerX)
      : 0;
    const backtrackDistance =
      setupDirection !== 0 &&
      setupDirection !== Math.sign(runtime.directionX)
        ? setupDistance
        : 0;
    const routeTargetSnapshot =
      routeTarget.objectiveTarget.traversalSnapshot ?? candidate.targetSnapshot;
    const targetVerticalDelta = routeTargetSnapshot.bottom - enemySnapshot.bottom;
    const nodeCoinBonus =
      Math.min(Math.max(candidate.collectibleCount - 1, 0), 6) *
      SWORDSMAN_AI_COLLECT_NODE_COIN_BONUS;
    const setupCoinCount = countSetupPathCoins(firstEdge);
    const setupCoinValue =
      Math.min(setupCoinCount, 8) * SWORDSMAN_AI_COLLECT_ROUTE_SETUP_COIN_VALUE;
    const routeCoinValue = scoreRouteCoinValue(plan.edges);
    const wallEdgeCount = plan.edges.filter(
      (edge) => edge.type === 'jump-to-wall' || edge.type === 'wall-jump',
    ).length;
    const wallRoutePenalty =
      wallEdgeCount * SWORDSMAN_AI_COLLECT_ROUTE_WALL_EDGE_PENALTY +
      (wallEdgeCount > 0 && hasRecentWallRouteFailure
        ? SWORDSMAN_AI_COLLECT_ROUTE_RECENT_WALL_FAILURE_PENALTY
        : 0);
    const depletedSurfaceStepCount = plan.edges.filter((edge) => {
      const node = graph.nodesById.get(edge.toId);
      return node?.kind === 'surface' && edge.toId !== targetNodeId && !collectNodeStats.has(edge.toId);
    }).length;
    const emptySetupPenalty =
      setupCoinCount === 0
        ? Math.max(0, setupDistance - TILE_SIZE * 1.5) *
          SWORDSMAN_AI_COLLECT_ROUTE_EMPTY_SETUP_WEIGHT
        : 0;
    const depletedCurrentSetupPenalty =
      currentSurfaceIsDepleted &&
      firstEdge?.fromId === currentContext.currentNodeId &&
      setupCoinCount === 0
        ? Math.max(0, setupDistance - TILE_SIZE) *
          SWORDSMAN_AI_COLLECT_ROUTE_DEPLETED_CURRENT_SETUP_WEIGHT
        : 0;
    const depletedSurfaceStepPenalty =
      depletedSurfaceStepCount * SWORDSMAN_AI_COLLECT_ROUTE_DEPLETED_SURFACE_STEP_PENALTY;
    const routeValue = Math.min(
      SWORDSMAN_AI_COLLECT_ROUTE_VALUE_CAP,
      routeCoinValue + setupCoinValue + nodeCoinBonus,
    );
    const routePenalty =
      wallRoutePenalty +
      emptySetupPenalty +
      depletedCurrentSetupPenalty +
      depletedSurfaceStepPenalty;
    const routeMetric =
      plan.routeCost * SWORDSMAN_AI_COLLECT_ROUTE_COST_WEIGHT +
      plan.edges.length * SWORDSMAN_AI_COLLECT_ROUTE_EDGE_WEIGHT +
      setupDistance * SWORDSMAN_AI_COLLECT_ROUTE_SETUP_WEIGHT +
      backtrackDistance * SWORDSMAN_AI_COLLECT_ROUTE_BACKTRACK_WEIGHT +
      (plan.exactRoute ? 0 : SWORDSMAN_AI_COLLECT_ROUTE_PARTIAL_PENALTY) +
      Math.max(0, -targetVerticalDelta) * SWORDSMAN_AI_COLLECT_ROUTE_UPWARD_WEIGHT -
      Math.min(900, Math.max(0, targetVerticalDelta) * SWORDSMAN_AI_COLLECT_ROUTE_DROP_BONUS_WEIGHT) +
      candidate.rawMetric * 0.25 -
      routeValue +
      routePenalty;

    if (!bestRouteTarget || routeMetric < bestRouteTarget.metric) {
      bestRouteTarget = {
        collectible: routeTarget.collectible,
        objectiveTarget: routeTarget.objectiveTarget,
        targetNodeId,
        metric: routeMetric,
        value: routeValue,
        penalty: routePenalty,
        wallEdgeCount,
      };
    }
  }

  return bestRouteTarget;
}

function selectCurrentSweepTarget(
  currentSweepCandidates: CollectSweepCandidate[],
  enemySnapshot: SwordsmanBodySnapshot,
  sweepDirectionX: -1 | 1,
) {
  let bestCurrentNodeTarget: {
    collectible: LoadedRoomObject;
    objectiveTarget: SwordsmanObjectiveTarget;
    metric: number;
    isProductive: boolean;
  } | null = null;
  for (const candidate of currentSweepCandidates) {
    const deltaX = candidate.targetSnapshot.centerX - enemySnapshot.centerX;
    const forwardDistance = deltaX * sweepDirectionX;
    const backtrackDistance = Math.max(0, -forwardDistance);
    const isProductive =
      forwardDistance >= -SWORDSMAN_AI_COLLECT_CURRENT_SWEEP_BEHIND_GRACE_PX ||
      backtrackDistance <= SWORDSMAN_AI_COLLECT_PRODUCTIVE_SWEEP_BACKTRACK_PX;
    const sweepMetric =
      (forwardDistance >= -SWORDSMAN_AI_COLLECT_CURRENT_SWEEP_BEHIND_GRACE_PX
        ? Math.max(0, forwardDistance)
        : Math.abs(deltaX) + 900) +
      Math.abs(candidate.collectDeltaY) * 0.4 +
      Math.max(0, -candidate.collectDeltaY) *
        SWORDSMAN_AI_COLLECT_CURRENT_SWEEP_ABOVE_PENALTY_WEIGHT +
      candidate.rawMetric * 0.1;
    if (!bestCurrentNodeTarget || sweepMetric < bestCurrentNodeTarget.metric) {
      bestCurrentNodeTarget = {
        collectible: candidate.collectible,
        objectiveTarget: candidate.objectiveTarget,
        metric: sweepMetric,
        isProductive,
      };
    }
  }

  return bestCurrentNodeTarget;
}
