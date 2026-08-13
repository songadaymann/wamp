import type Phaser from 'phaser';
import { ROOM_PX_WIDTH, type GameObjectConfig } from '../../../config';
import { SWORDSMAN_AI_OBJECT_ID } from '../../../enemies/swordsmanAi';
import {
  DEFAULT_POLICE_BEHAVIOR_MODE,
  isPoliceEnemyObjectId,
  normalizePoliceBehaviorMode,
  normalizePolicePatrolShoots,
  type PoliceBehaviorMode,
} from '../../../enemies/policeEnemy';
import {
  DEFAULT_SWORDSMAN_DEFEAT_MODE,
  DEFAULT_SWORDSMAN_OBJECTIVE_MODE,
  type SwordsmanDefeatMode,
  type SwordsmanObjectiveMode,
} from '../../../enemies/swordsmanObjectives';
import type { SwordsmanTraversalPlannerMode } from '../../../enemies/swordsmanRobustPlanner';
import {
  DEFAULT_NPC_MODE,
  normalizeNpcCanJumpFall,
  normalizeNpcDefeatMode,
  normalizeNpcFriendlyFire,
  normalizeNpcMode,
  normalizeNpcPlayerCollision,
  normalizeNpcPushable,
  type NpcMode,
} from '../../../npcs/model';
import type { LoadedRoomObjectRuntimeState } from '../liveObjects';

export function getInitialDirectionX(
  facing: 'left' | 'right' | undefined,
  localX: number,
): -1 | 1 {
  if (facing === 'right') {
    return 1;
  }
  if (facing === 'left') {
    return -1;
  }
  return localX <= ROOM_PX_WIDTH * 0.5 ? 1 : -1; //if undefined, objects face toward middle of Room
}

export function createLiveObjectRuntimeState(options: {
  config: GameObjectConfig;
  sprite: Phaser.GameObjects.Sprite;
  initialDirectionX: -1 | 1;
  baseTimeSeed: number;
  getCurrentTime: () => number;
  objectiveMode: SwordsmanObjectiveMode | null;
  defeatMode: SwordsmanDefeatMode | null;
  policeBehaviorMode: PoliceBehaviorMode | null;
  policePatrolShoots: boolean | null;
  npcMode: NpcMode | null;
  npcPushable: boolean | null;
  npcCanJumpFall: boolean | null;
  npcPlayerCollision: boolean | null;
  npcFriendlyFire: boolean | null;
  npcDefeatMode: SwordsmanDefeatMode | null;
  swordsmanTraversalPlannerMode: SwordsmanTraversalPlannerMode;
}): LoadedRoomObjectRuntimeState {
  const {
    config,
    sprite,
    initialDirectionX,
    baseTimeSeed,
    getCurrentTime,
    objectiveMode,
    defeatMode,
    policeBehaviorMode,
    policePatrolShoots,
    npcMode,
    npcPushable,
    npcCanJumpFall,
    npcPlayerCollision,
    npcFriendlyFire,
    npcDefeatMode,
    swordsmanTraversalPlannerMode,
  } = options;
  const isSwordsman = config.id === SWORDSMAN_AI_OBJECT_ID;
  const isPolice = isPoliceEnemyObjectId(config.id);
  const isSmartTraversalEnemy = isSwordsman || isPolice;
  const isNpc = config.category === 'npc';
  const normalizedNpcMode = isNpc
    ? normalizeNpcMode(npcMode) ?? DEFAULT_NPC_MODE
    : null;

  return {
    baseX: sprite.x,
    baseY: sprite.y,
    previousX: sprite.x,
    previousY: sprite.y,
    gravityDirection: 'down',
    gravityRoomId: null,
    inWater: false,
    specialTileWindX: 0,
    specialTileOnIce: false,
    specialTileOnSticky: false,
    specialTileOnBounce: false,
    specialTileOnDamage: false,
    initialDirectionX,
    directionX: initialDirectionX,
    movingPlatformTargetIndex: 1,
    movingPlatformPathDirection: 1,
    aiFacingDirectionX: initialDirectionX,
    aiFacingLastFlipAt: getCurrentTime(),
    aiFacingLastFlipX: sprite.x,
    elapsedMs: 0,
    nextActionAt: //these are custom delays before these objects start doing things
      config.id === 'frog'
        ? getCurrentTime() + 250
        : config.id === 'cannon'
          ? getCurrentTime() + 700
          : config.id === 'lightning'
            ? getCurrentTime() + (baseTimeSeed % 500)
            : getCurrentTime(),
    actionStartedAt: getCurrentTime(),
    aiTraversalCooldownUntil: 0,
    cooldownUntil: 0,
    activatedUntil: 0,
    aiState: isSmartTraversalEnemy ? 'patrol' : null,
    aiObjectiveMode: isSwordsman
      ? objectiveMode ?? DEFAULT_SWORDSMAN_OBJECTIVE_MODE
      : null,
    aiDefeatMode: isSwordsman ? defeatMode ?? DEFAULT_SWORDSMAN_DEFEAT_MODE : null,
    aiIntent: null,
    aiTargetX: null,
    aiCurrentSegmentId: null,
    aiTargetSegmentId: null,
    aiTraversalEdgeId: null,
    aiTraversalBlockedEdges: [],
    aiTraversalLastBlockReason: null,
    aiActiveTraversalEdgeId: null,
    aiActiveTraversalNextNodeId: null,
    aiActiveTraversalStartedAt: 0,
    aiActiveTraversalStartBottom: 0,
    aiLadderTraversalEdgeId: null,
    aiFallbackTraversalEdgeId: null,
    aiFallbackTraversalSegmentId: null,
    aiFallbackTraversalLastProgressAt: 0,
    aiFallbackTraversalBestMetric: Number.POSITIVE_INFINITY,
    aiRouteLoopSignature: null,
    aiRouteLoopCount: 0,
    aiRouteLoopLastProgressAt: 0,
    aiRouteLoopBestMetric: Number.POSITIVE_INFINITY,
    aiPlannerMode: isSmartTraversalEnemy ? swordsmanTraversalPlannerMode : null,
    aiPlannerFallback: false,
    aiPlannerPlanMs: 0,
    aiPlannerExpandedStates: 0,
    aiPlannerSimulatedEdges: 0,
    aiPlannedTraversalEdgeIds: [],
    aiPlannedTraversalTargetNodeId: null,
    aiPlannedTraversalExpiresAt: 0,
    aiPlannedTraversalReason: null,
    aiCollectState: null,
    aiCollectRouteTargetNodeId: null,
    aiCollectRouteExpiresAt: 0,
    aiCollectRouteScore: null,
    aiCollectRouteValue: 0,
    aiCollectRoutePenalty: 0,
    policeBehaviorMode: isPolice
      ? normalizePoliceBehaviorMode(policeBehaviorMode) ?? DEFAULT_POLICE_BEHAVIOR_MODE
      : null,
    policePatrolShoots: isPolice
      ? normalizePolicePatrolShoots(policePatrolShoots)
      : false,
    npcMode: normalizedNpcMode,
    npcPushable:
      isNpc && normalizedNpcMode
        ? normalizeNpcPushable(npcPushable, normalizedNpcMode)
        : false,
    npcCanJumpFall:
      isNpc && normalizedNpcMode
        ? normalizeNpcCanJumpFall(npcCanJumpFall, normalizedNpcMode)
        : false,
    npcPlayerCollision: isNpc
      ? normalizeNpcPlayerCollision(npcPlayerCollision)
      : false,
    npcFriendlyFire: isNpc ? normalizeNpcFriendlyFire(npcFriendlyFire) : false,
    npcDefeatMode: isNpc ? normalizeNpcDefeatMode(npcDefeatMode) : null,
    npcVictorious: false,
    npcWalking: normalizedNpcMode === 'patrol' || normalizedNpcMode === 'follow',
    npcBounceCooldownUntil: 0,
    npcQuicksandUntil: 0,
    pressureActive: false,
    triggerLatched: false,
  };
}
