import { describe, expect, it } from 'vitest';
import { getObjectById } from '../../../config';
import { SWORDSMAN_AI_OBJECT_ID } from '../../../enemies/swordsmanAi';
import type {
  SwordsmanTraversalDecision,
  SwordsmanTraversalGraph,
} from '../../../enemies/swordsmanTraversal';
import type { LoadedRoomObjectRuntimeState } from './model';
import { createLiveObjectRuntimeState } from './objectFactory';
import { SwordsmanRuntimeStateController } from './swordsmanRuntimeStateController';

function createRuntime(): LoadedRoomObjectRuntimeState {
  const config = getObjectById(SWORDSMAN_AI_OBJECT_ID);
  if (!config) {
    throw new Error('Missing Sword Hunter test config.');
  }
  return createLiveObjectRuntimeState({
    config,
    sprite: { x: 40, y: 80 } as never,
    initialDirectionX: 1,
    baseTimeSeed: 0,
    getCurrentTime: () => 1_000,
    objectiveMode: null,
    defeatMode: null,
    policeBehaviorMode: null,
    policePatrolShoots: null,
    npcMode: null,
    npcPushable: null,
    npcCanJumpFall: null,
    npcPlayerCollision: null,
    npcFriendlyFire: null,
    npcDefeatMode: null,
    swordsmanTraversalPlannerMode: 'robust',
  });
}

describe('SwordsmanRuntimeStateController', () => {
  it('owns patrol/chase and exact windup/attack/cooldown timing state', () => {
    const controller = new SwordsmanRuntimeStateController();
    const runtime = createRuntime();
    runtime.aiState = null;

    expect(controller.getAiState(runtime)).toBe('patrol');
    expect(controller.transition(runtime, 'chase', 1_000)).toBe(true);
    expect(runtime.actionStartedAt).toBe(1_000);
    expect(controller.transition(runtime, 'chase', 1_200)).toBe(false);
    expect(runtime.actionStartedAt).toBe(1_000);

    controller.beginWindup(runtime, 1_300, 180);
    expect(runtime).toMatchObject({
      aiState: 'windup',
      actionStartedAt: 1_300,
      nextActionAt: 1_480,
    });

    controller.beginAttack(runtime, 1_480, {
      attackMs: 240,
      cooldownMs: 300,
      hitWindowEndMs: 155,
    });
    expect(runtime).toMatchObject({
      aiState: 'attack',
      actionStartedAt: 1_480,
      nextActionAt: 1_720,
      activatedUntil: 1_635,
      cooldownUntil: 2_020,
    });
    expect(controller.isAttackHitActive(runtime, 1_534, 55)).toBe(false);
    expect(controller.isAttackHitActive(runtime, 1_535, 55)).toBe(true);
    expect(controller.isAttackHitActive(runtime, 1_635, 55)).toBe(true);
    expect(controller.isAttackHitActive(runtime, 1_636, 55)).toBe(false);

    controller.transition(runtime, 'cooldown', 1_720);
    expect(runtime).toMatchObject({ aiState: 'cooldown', actionStartedAt: 1_720 });
  });

  it('owns chase navigation intent and collect-jump state without Phaser bodies', () => {
    const controller = new SwordsmanRuntimeStateController();
    const runtime = createRuntime();
    const decision = {
      directionX: -1,
      intent: 'jump-up',
      targetX: 44,
      currentSegmentId: 'surface-a',
      targetSegmentId: 'surface-b',
      traversalEdgeId: 'edge-a-b',
    } as SwordsmanTraversalDecision;

    expect(controller.applyTraversalDecision(runtime, decision, {
      fallbackDirectionX: 1,
      fallbackTargetX: 99,
      onFloor: true,
    })).toBe(-1);
    expect(runtime).toMatchObject({
      directionX: -1,
      aiIntent: 'jump-up',
      aiTargetX: 44,
      aiCurrentSegmentId: 'surface-a',
      aiTargetSegmentId: 'surface-b',
      aiTraversalEdgeId: 'edge-a-b',
    });

    expect(controller.applyTraversalDecision(runtime, null, {
      fallbackDirectionX: 1,
      fallbackTargetX: 99,
      onFloor: false,
    })).toBe(1);
    expect(runtime).toMatchObject({
      directionX: 1,
      aiIntent: 'air-chase',
      aiTargetX: 99,
      aiCurrentSegmentId: null,
      aiTargetSegmentId: null,
      aiTraversalEdgeId: null,
    });

    controller.applyCollectJump(runtime, {
      directionX: -1,
      targetX: 32,
      cooldownUntil: 2_400,
    });
    expect(runtime).toMatchObject({
      directionX: -1,
      aiIntent: 'jump-up',
      aiTargetX: 32,
      aiTraversalEdgeId: null,
      aiTraversalCooldownUntil: 2_400,
    });
  });

  it('clears objective and full traversal state at their existing boundaries', () => {
    const controller = new SwordsmanRuntimeStateController();
    const runtime = createRuntime();
    Object.assign(runtime, {
      aiIntent: 'wall-jump',
      aiTargetX: 72,
      aiCurrentSegmentId: 'a',
      aiTargetSegmentId: 'b',
      aiTraversalEdgeId: 'a-b',
      aiFallbackTraversalEdgeId: 'fallback',
      aiFallbackTraversalSegmentId: 'a',
      aiFallbackTraversalLastProgressAt: 500,
      aiFallbackTraversalBestMetric: 12,
      aiRouteLoopSignature: 'loop',
      aiRouteLoopCount: 4,
      aiRouteLoopLastProgressAt: 600,
      aiRouteLoopBestMetric: 8,
      aiPlannedTraversalEdgeIds: ['a-b'],
      aiPlannedTraversalTargetNodeId: 'b',
      aiPlannedTraversalExpiresAt: 9_000,
      aiCollectState: 'route',
      aiCollectRouteTargetNodeId: 'b',
      aiCollectRouteExpiresAt: 9_000,
      aiCollectRouteScore: 10,
      aiCollectRouteValue: 20,
      aiCollectRoutePenalty: 30,
    });

    controller.clearObjectiveTraversal(runtime, 'attack');
    expect(runtime).toMatchObject({
      aiIntent: null,
      aiTargetX: null,
      aiCurrentSegmentId: null,
      aiTargetSegmentId: null,
      aiTraversalEdgeId: null,
      aiFallbackTraversalEdgeId: null,
      aiRouteLoopSignature: null,
      aiPlannedTraversalEdgeIds: [],
      aiPlannedTraversalReason: 'attack',
      aiCollectState: null,
      aiCollectRouteTargetNodeId: null,
      aiCollectRouteScore: null,
      aiCollectRouteValue: 0,
      aiCollectRoutePenalty: 0,
    });

    Object.assign(runtime, {
      aiLadderTraversalEdgeId: 'ladder',
      aiActiveTraversalEdgeId: 'ladder',
      aiActiveTraversalNextNodeId: 'upper',
      aiActiveTraversalStartedAt: 800,
      aiActiveTraversalStartBottom: 120,
      aiTraversalBlockedEdges: [{ edgeId: 'bad', until: 4_000 }],
      aiPlannerFallback: true,
      aiPlannerPlanMs: 7,
      aiPlannerExpandedStates: 8,
      aiPlannerSimulatedEdges: 9,
      aiTraversalLastBlockReason: 'hit-head',
    });
    controller.resetTraversalMemory(runtime);
    expect(runtime).toMatchObject({
      aiLadderTraversalEdgeId: null,
      aiActiveTraversalEdgeId: null,
      aiActiveTraversalNextNodeId: null,
      aiActiveTraversalStartedAt: 0,
      aiActiveTraversalStartBottom: 0,
      aiTraversalBlockedEdges: [],
      aiPlannerFallback: false,
      aiPlannerPlanMs: 0,
      aiPlannerExpandedStates: 0,
      aiPlannerSimulatedEdges: 0,
      aiTraversalLastBlockReason: null,
    });
  });

  it('owns traversal attempts, ladder release, route advancement, and block pruning', () => {
    const controller = new SwordsmanRuntimeStateController();
    const runtime = createRuntime();
    const decision = {
      traversalEdgeId: 'edge-a-b',
      traversalNextNodeId: 'b',
    } as SwordsmanTraversalDecision;

    controller.startTraversalAttempt(runtime, decision, 1_000, 120);
    controller.setLadderTraversalEdge(runtime, 'edge-a-b');
    expect(runtime).toMatchObject({
      aiLadderTraversalEdgeId: 'edge-a-b',
      aiActiveTraversalEdgeId: 'edge-a-b',
      aiActiveTraversalNextNodeId: 'b',
      aiActiveTraversalStartedAt: 1_000,
      aiActiveTraversalStartBottom: 120,
    });
    expect(controller.stopLadderTraversal(runtime)).toBe('edge-a-b');
    expect(runtime).toMatchObject({
      aiLadderTraversalEdgeId: null,
      aiActiveTraversalEdgeId: null,
      aiActiveTraversalNextNodeId: null,
    });

    runtime.aiPlannedTraversalEdgeIds = ['edge-a-b'];
    runtime.aiPlannedTraversalTargetNodeId = 'b';
    runtime.aiPlannedTraversalExpiresAt = 5_000;
    const graph = {
      edgesById: new Map([
        ['edge-a-b', { id: 'edge-a-b', fromId: 'a', toId: 'b' }],
      ]),
    } as unknown as SwordsmanTraversalGraph;
    controller.advancePlannedRoute(runtime, graph, 'b');
    expect(runtime.aiPlannedTraversalEdgeIds).toEqual([]);
    expect(runtime.aiPlannedTraversalReason).toBe('route-complete');

    runtime.aiTraversalBlockedEdges = [
      { edgeId: 'expired', until: 999 },
      { edgeId: 'active', until: 1_001 },
    ];
    controller.pruneBlockedEdges(runtime, 1_000);
    expect(runtime.aiTraversalBlockedEdges).toEqual([{ edgeId: 'active', until: 1_001 }]);
  });
});
