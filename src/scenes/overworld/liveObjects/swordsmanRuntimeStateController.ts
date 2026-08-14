import type { SwordsmanAiState } from '../../../enemies/swordsmanAi';
import {
  getSwordsmanTraversalEdgeById,
  type SwordsmanTraversalDecision,
  type SwordsmanTraversalGraph,
} from '../../../enemies/swordsmanTraversal';
import type { LoadedRoomObjectRuntimeState } from './model';

export class SwordsmanRuntimeStateController {
  getAiState(runtime: LoadedRoomObjectRuntimeState): SwordsmanAiState {
    return runtime.aiState ?? 'patrol';
  }

  transition(
    runtime: LoadedRoomObjectRuntimeState,
    state: SwordsmanAiState,
    now: number,
  ): boolean {
    if (runtime.aiState === state) {
      return false;
    }

    runtime.aiState = state;
    runtime.actionStartedAt = now;
    return true;
  }

  beginWindup(
    runtime: LoadedRoomObjectRuntimeState,
    now: number,
    windupMs: number,
  ): void {
    this.transition(runtime, 'windup', now);
    runtime.nextActionAt = now + windupMs;
  }

  beginAttack(
    runtime: LoadedRoomObjectRuntimeState,
    now: number,
    timing: { attackMs: number; cooldownMs: number; hitWindowEndMs: number },
  ): void {
    this.transition(runtime, 'attack', now);
    runtime.nextActionAt = now + timing.attackMs;
    runtime.activatedUntil = now + timing.hitWindowEndMs;
    runtime.cooldownUntil = now + timing.attackMs + timing.cooldownMs;
  }

  isAttackHitActive(
    runtime: LoadedRoomObjectRuntimeState,
    now: number,
    hitWindowStartMs: number,
  ): boolean {
    return runtime.aiState === 'attack' &&
      now - runtime.actionStartedAt >= hitWindowStartMs &&
      now <= runtime.activatedUntil;
  }

  applyTraversalDecision(
    runtime: LoadedRoomObjectRuntimeState,
    decision: SwordsmanTraversalDecision | null,
    input: { fallbackDirectionX: -1 | 1; fallbackTargetX: number; onFloor: boolean },
  ): -1 | 1 {
    const directionX = decision?.directionX ?? input.fallbackDirectionX;
    runtime.directionX = directionX;
    runtime.aiIntent = decision?.intent ?? (input.onFloor ? 'same-platform' : 'air-chase');
    runtime.aiTargetX = decision?.targetX ?? input.fallbackTargetX;
    runtime.aiCurrentSegmentId = decision?.currentSegmentId ?? null;
    runtime.aiTargetSegmentId = decision?.targetSegmentId ?? null;
    runtime.aiTraversalEdgeId = decision?.traversalEdgeId ?? null;
    return directionX;
  }

  applyCollectJump(
    runtime: LoadedRoomObjectRuntimeState,
    input: { directionX: -1 | 1; targetX: number; cooldownUntil: number },
  ): void {
    runtime.directionX = input.directionX;
    runtime.aiIntent = 'jump-up';
    runtime.aiTargetX = input.targetX;
    runtime.aiTraversalEdgeId = null;
    runtime.aiTraversalCooldownUntil = input.cooldownUntil;
  }

  clearCollectRoute(runtime: LoadedRoomObjectRuntimeState): void {
    runtime.aiCollectRouteTargetNodeId = null;
    runtime.aiCollectRouteExpiresAt = 0;
    runtime.aiCollectRouteScore = null;
    runtime.aiCollectRouteValue = 0;
    runtime.aiCollectRoutePenalty = 0;
    if (runtime.aiCollectState === 'route') {
      runtime.aiCollectState = null;
    }
  }

  clearTraversalAttempt(runtime: LoadedRoomObjectRuntimeState): void {
    runtime.aiLadderTraversalEdgeId = null;
    runtime.aiActiveTraversalEdgeId = null;
    runtime.aiActiveTraversalNextNodeId = null;
    runtime.aiActiveTraversalStartedAt = 0;
    runtime.aiActiveTraversalStartBottom = 0;
  }

  clearFallbackTraversal(runtime: LoadedRoomObjectRuntimeState): void {
    runtime.aiFallbackTraversalEdgeId = null;
    runtime.aiFallbackTraversalSegmentId = null;
    runtime.aiFallbackTraversalLastProgressAt = 0;
    runtime.aiFallbackTraversalBestMetric = Number.POSITIVE_INFINITY;
  }

  clearRouteLoopMemory(runtime: LoadedRoomObjectRuntimeState): void {
    runtime.aiRouteLoopSignature = null;
    runtime.aiRouteLoopCount = 0;
    runtime.aiRouteLoopLastProgressAt = 0;
    runtime.aiRouteLoopBestMetric = Number.POSITIVE_INFINITY;
  }

  clearPlannedRoute(
    runtime: LoadedRoomObjectRuntimeState,
    reason: string | null,
  ): void {
    runtime.aiPlannedTraversalEdgeIds = [];
    runtime.aiPlannedTraversalTargetNodeId = null;
    runtime.aiPlannedTraversalExpiresAt = 0;
    runtime.aiPlannedTraversalReason = reason;
  }

  clearObjectiveTraversal(
    runtime: LoadedRoomObjectRuntimeState,
    reason: string | null,
  ): void {
    runtime.aiIntent = null;
    runtime.aiTargetX = null;
    runtime.aiCurrentSegmentId = null;
    runtime.aiTargetSegmentId = null;
    runtime.aiTraversalEdgeId = null;
    this.clearFallbackTraversal(runtime);
    this.clearRouteLoopMemory(runtime);
    this.clearPlannedRoute(runtime, reason);
    this.clearCollectRoute(runtime);
  }

  resetTraversalMemory(runtime: LoadedRoomObjectRuntimeState): void {
    runtime.aiTraversalBlockedEdges = [];
    this.clearTraversalAttempt(runtime);
    this.clearFallbackTraversal(runtime);
    this.clearRouteLoopMemory(runtime);
    this.clearPlannedRoute(runtime, null);
    this.clearCollectRoute(runtime);
    runtime.aiPlannerFallback = false;
    runtime.aiPlannerPlanMs = 0;
    runtime.aiPlannerExpandedStates = 0;
    runtime.aiPlannerSimulatedEdges = 0;
    runtime.aiTraversalLastBlockReason = null;
  }

  pruneBlockedEdges(runtime: LoadedRoomObjectRuntimeState, now: number): void {
    runtime.aiTraversalBlockedEdges = runtime.aiTraversalBlockedEdges.filter(
      (entry) => entry.until > now,
    );
  }

  startTraversalAttempt(
    runtime: LoadedRoomObjectRuntimeState,
    decision: SwordsmanTraversalDecision,
    now: number,
    startBottom: number,
  ): void {
    if (!decision.traversalEdgeId) {
      this.clearTraversalAttempt(runtime);
      return;
    }

    runtime.aiActiveTraversalEdgeId = decision.traversalEdgeId;
    runtime.aiActiveTraversalNextNodeId = decision.traversalNextNodeId;
    runtime.aiActiveTraversalStartedAt = now;
    runtime.aiActiveTraversalStartBottom = startBottom;
  }

  stopLadderTraversal(runtime: LoadedRoomObjectRuntimeState): string | null {
    const ladderEdgeId = runtime.aiLadderTraversalEdgeId;
    runtime.aiLadderTraversalEdgeId = null;
    if (ladderEdgeId && runtime.aiActiveTraversalEdgeId === ladderEdgeId) {
      this.clearTraversalAttempt(runtime);
    }
    return ladderEdgeId;
  }

  setLadderTraversalEdge(runtime: LoadedRoomObjectRuntimeState, edgeId: string): void {
    runtime.aiLadderTraversalEdgeId = edgeId;
  }

  advancePlannedRoute(
    runtime: LoadedRoomObjectRuntimeState,
    graph: SwordsmanTraversalGraph,
    currentNodeId: string | null,
  ): void {
    while (runtime.aiPlannedTraversalEdgeIds.length > 0 && currentNodeId) {
      const edgeId = runtime.aiPlannedTraversalEdgeIds[0] ?? null;
      const nextEdge = edgeId ? getSwordsmanTraversalEdgeById(graph, edgeId) : null;
      if (!nextEdge) {
        this.clearPlannedRoute(runtime, 'missing-edge');
        return;
      }
      if (nextEdge.toId !== currentNodeId) {
        break;
      }
      runtime.aiPlannedTraversalEdgeIds.shift();
      runtime.aiPlannedTraversalReason = 'advance-route';
    }

    if (runtime.aiPlannedTraversalEdgeIds.length === 0 && currentNodeId) {
      this.clearPlannedRoute(runtime, 'route-complete');
    }
  }
}
