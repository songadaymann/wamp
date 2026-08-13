import Phaser from 'phaser';
import {
  isSolidRuntimeObjectConfig,
  objectCollidesWithWorld,
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_WIDTH,
  TILE_SIZE,
  type GameObjectConfig,
} from '../../../config';
import type { RoomCoordinates, RoomSnapshot } from '../../../persistence/roomModel';
import {
  SWORDSMAN_AI_ANIMATION_KEYS,
  type SwordsmanAiState,
} from '../../../enemies/swordsmanAi';
import {
  getPoliceAnimationKey,
  isPoliceEnemyObjectId,
} from '../../../enemies/policeEnemy';
import {
  buildSwordsmanDuelObjectiveTarget,
  DEFAULT_SWORDSMAN_DEFEAT_MODE,
  DEFAULT_SWORDSMAN_OBJECTIVE_MODE,
  type SwordsmanDefeatMode,
  type SwordsmanObjectiveMode,
  type SwordsmanObjectiveTarget,
} from '../../../enemies/swordsmanObjectives';
import {
  getSwordsmanTraversalAirSpeed,
  SWORDSMAN_AI_JUMP_SETUP_APPROACH_TOLERANCE_PX,
  SWORDSMAN_AI_JUMP_VELOCITY_X,
  SWORDSMAN_AI_JUMP_VELOCITY_Y,
  SWORDSMAN_AI_LADDER_ALIGN_SPEED,
  SWORDSMAN_AI_LADDER_CLIMB_SPEED,
  SWORDSMAN_AI_WALL_JUMP_VELOCITY_X,
  SWORDSMAN_AI_WALL_JUMP_VELOCITY_Y,
} from '../../../enemies/swordsmanTuning';
import {
  getSwordsmanDropDownAirVelocityX,
} from '../../../enemies/swordsmanTraversalSkills';
import {
  buildSwordsmanTraversalDecisionFromEdge,
  buildSwordsmanTraversalGraph,
  getSwordsmanTraversalContext,
  decideSwordsmanTraversal,
  getSwordsmanTraversalEdgeById,
  getSwordsmanTraversalCurrentNodeId,
  getSwordsmanTraversalGraphCacheKey,
  getSwordsmanTraversalTargetContext,
  isSwordsmanLadderTraversalEdge,
  type SwordsmanBodySnapshot,
  type SwordsmanSurfaceSegment,
  type SwordsmanTraversalDecision,
  type SwordsmanTraversalEdge,
  type SwordsmanTraversalGraph,
} from '../../../enemies/swordsmanTraversal';
import {
  planSwordsmanRobustTraversal,
  SWORDSMAN_AI_ROBUST_REPLAN_INTERVAL_MS,
  SWORDSMAN_AI_ROBUST_ROUTE_COMMIT_MS,
  type SwordsmanTraversalPlannerMode,
} from '../../../enemies/swordsmanRobustPlanner';
import type { LoadedRoomObject } from '../liveObjects';
import type { LoadedFullRoom } from '../worldStreaming';
import { terrainTileCollidesAtLocalPixel } from '../terrainCollision';
import { isAnimationSafelyPlayable } from './animationReadiness';
import {
  getArcadeBodyBounds,
  isDynamicArcadeBody,
  type ArcadeObjectBody,
} from './bodies';

const SWORDSMAN_AI_CHASE_RANGE_X = 240;
const SWORDSMAN_AI_CHASE_RANGE_Y = 176;
const SWORDSMAN_AI_ATTACK_RANGE_X = 28;
const SWORDSMAN_AI_ATTACK_RANGE_Y = 24;
const SWORDSMAN_AI_SPEED = 84;
const SWORDSMAN_AI_TRAVERSAL_COOLDOWN_MS = 320;
const SWORDSMAN_AI_FAILED_TRAVERSAL_BLOCK_MS = 1200;
const SWORDSMAN_AI_COLLECT_FAILED_TRAVERSAL_BLOCK_MS = 6400;
const SWORDSMAN_AI_COLLECT_FAILED_WALL_ROUTE_BLOCK_MS = 18000;
const SWORDSMAN_AI_JUMP_RESULT_GRACE_MS = 140;
const SWORDSMAN_AI_DROP_DOWN_RESULT_GRACE_MS = 520;
const SWORDSMAN_AI_LADDER_RESULT_TIMEOUT_MS = 6000;
const SWORDSMAN_AI_LADDER_ATTACH_TOLERANCE_PX = 6;
const SWORDSMAN_AI_LADDER_FINISH_TOLERANCE_PX = 4;
const SWORDSMAN_AI_JUMP_SUCCESS_RISE_PX = 10;
const SWORDSMAN_AI_FALLBACK_STALL_BLOCK_MS = 480;
const SWORDSMAN_AI_FALLBACK_PROGRESS_EPSILON_PX = 3;
const SWORDSMAN_AI_ROUTE_LOOP_STALL_MS = 900;
const SWORDSMAN_AI_ROUTE_LOOP_REPEAT_LIMIT = 3;
const SWORDSMAN_AI_ROUTE_LOOP_BLOCK_MS = 2400;
const SWORDSMAN_AI_WINDUP_MS = 180;
const SWORDSMAN_AI_ATTACK_MS = 240;
const SWORDSMAN_AI_ATTACK_HIT_START_MS = 55;
const SWORDSMAN_AI_ATTACK_HIT_END_MS = 155;
const SWORDSMAN_AI_COOLDOWN_MS = 300;
const POLICE_AI_SHOOT_RANGE_X = 220;
const POLICE_AI_SHOOT_RANGE_Y = 20;
const POLICE_AI_WINDUP_MS = 220;
const POLICE_AI_ATTACK_MS = 650;
const POLICE_AI_COOLDOWN_MS = 680;
const SWORDSMAN_AI_SWORD_LOS_STEP_PX = 4;
const SWORDSMAN_AI_EDGE_GUARD_PROBE_LEAD_PX = 4;
const SWORDSMAN_AI_FACING_FLIP_MIN_INTERVAL_MS = 90;
const SWORDSMAN_AI_FACING_FLIP_MIN_TRAVEL_PX = 6;
const SWORDSMAN_AI_COLLECT_NODE_COIN_BONUS = 48;
const SWORDSMAN_AI_COLLECT_CURRENT_SWEEP_BEHIND_GRACE_PX = 18;
const SWORDSMAN_AI_COLLECT_PRODUCTIVE_SWEEP_BACKTRACK_PX = 56;
const SWORDSMAN_AI_COLLECT_ROUTE_COMMIT_MS = 7200;
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
const SWORDSMAN_AI_COLLECT_OVERHEAD_MIN_RISE_PX = 18;
const SWORDSMAN_AI_COLLECT_OVERHEAD_MAX_RISE_PX = 86;
const SWORDSMAN_AI_COLLECT_OVERHEAD_MAX_HORIZONTAL_PX = 48;
const SWORDSMAN_AI_COLLECT_OVERHEAD_BEHIND_GRACE_PX = 12;
const SWORDSMAN_AI_COLLECT_OVERHEAD_SURFACE_MARGIN_PX = 10;
const SWORDSMAN_AI_COLLECT_OVERHEAD_EDGE_CLEARANCE_PX = 72;
const SWORDSMAN_AI_COLLECT_OVERHEAD_PATH_STEP_PX = 8;

interface LiveObjectSwordsmanControllerOptions<TEdgeWall> {
  scene: Phaser.Scene;
  getRoomOrigin: (coordinates: RoomCoordinates) => { x: number; y: number };
  getPlayerBody: () => Phaser.Physics.Arcade.Body | null;
  getCurrentTime: () => number;
  isCollectedObjectKey: (key: string) => boolean;
  swordsmanTraversalPlannerMode: SwordsmanTraversalPlannerMode;
  handlePlayerDeath: (reason: string) => void;
  resetDynamicObjectIfOutOfBounds: (
    room: RoomSnapshot,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
  ) => boolean;
  collectLiveObject: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    options?: { collector?: 'player' | 'enemy' },
  ) => void;
  maybeReverseGroundEnemy: (
    room: RoomSnapshot,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
  ) => void;
  spawnEnemyBullet: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
  ) => void;
}

export class LiveObjectSwordsmanController<TEdgeWall = unknown> {
  private readonly swordsmanTraversalGraphs = new Map<string, SwordsmanTraversalGraph>();

  constructor(private readonly options: LiveObjectSwordsmanControllerOptions<TEdgeWall>) {}

  updateEnemy(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
  ): void {
    this.updateSwordsmanEnemy(loadedRoom, liveObject);
  }

  getObjectiveMode(liveObject: LoadedRoomObject): SwordsmanObjectiveMode {
    return this.getSwordsmanObjectiveMode(liveObject);
  }

  getDefeatMode(liveObject: LoadedRoomObject): SwordsmanDefeatMode {
    return this.getSwordsmanDefeatMode(liveObject);
  }

  swordCanDamagePlayer(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    playerBody: Phaser.Physics.Arcade.Body,
  ): boolean {
    return this.swordsmanSwordCanDamagePlayer(loadedRoom, liveObject, playerBody);
  }

  resetFacingMemory(liveObject: LoadedRoomObject, directionX: number): void {
    this.resetSwordsmanFacingMemory(liveObject, directionX);
  }

  applyFacing(
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body | null,
    directionX: number,
    options: { force?: boolean } = {},
  ): void {
    this.applySwordsmanFacing(liveObject, body, directionX, options);
  }

  private updateSwordsmanEnemy(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
  ): void {
    const room = loadedRoom.room;
    const body = this.getDynamicBody(liveObject.sprite);
    if (!body) {
      return;
    }

    const now = this.options.getCurrentTime();
    if (this.resetDynamicObjectIfOutOfBounds(room, liveObject, body)) {
      this.stopSwordsmanLadderTraversal(liveObject, body);
      this.resetSwordsmanTraversalMemory(liveObject);
      this.setSwordsmanAiState(liveObject, 'patrol');
      return;
    }

    this.syncSwordsmanLadderGravity(liveObject, body);
    this.updateSwordsmanTraversalMemory(room, liveObject, body, now);
    if (isPoliceEnemyObjectId(liveObject.config.id)) {
      if (liveObject.runtime.policeBehaviorMode === 'patrol') {
        this.updatePolicePatrolObjective(loadedRoom, liveObject, body, now);
      } else {
        this.updateSwordsmanDuelObjective(loadedRoom, liveObject, body, now);
      }
      return;
    }
    switch (this.getSwordsmanObjectiveMode(liveObject)) {
      case 'collect':
        this.updateSwordsmanCollectObjective(loadedRoom, liveObject, body, now);
        return;
      case 'duel':
      default:
        this.updateSwordsmanDuelObjective(loadedRoom, liveObject, body, now);
        return;
    }
  }

  private updatePolicePatrolObjective(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
    now: number,
  ): void {
    const target = liveObject.runtime.policePatrolShoots
      ? this.getSwordsmanDuelObjectiveTarget(loadedRoom, liveObject, body)
      : null;
    const currentState = liveObject.runtime.aiState ?? 'patrol';

    if (currentState === 'attack') {
      body.setVelocityX(0);
      this.holdGroundedSwordsmanAttackBody(body);
      this.clearSwordsmanObjectiveTraversalState(liveObject, 'police-patrol-attack', body);
      this.applySwordsmanFacing(liveObject, body, liveObject.runtime.directionX, { force: true });
      this.playSwordsmanAnimation(liveObject, this.getEnemyAnimationKey(liveObject, 'sword-slash'));
      if (now >= liveObject.runtime.nextActionAt) {
        this.setSwordsmanAiState(liveObject, 'patrol');
      }
      return;
    }

    if (currentState === 'windup') {
      body.setVelocityX(0);
      this.holdGroundedSwordsmanAttackBody(body);
      this.clearSwordsmanObjectiveTraversalState(liveObject, 'police-patrol-windup', body);
      if (target) {
        liveObject.runtime.directionX = target.directionX;
      }
      this.applySwordsmanFacing(liveObject, body, liveObject.runtime.directionX, { force: true });
      this.playSwordsmanAnimation(liveObject, this.getEnemyAnimationKey(liveObject, 'idle'));
      if (now >= liveObject.runtime.nextActionAt) {
        if (target?.withinActionRange) {
          this.startSwordsmanAttack(loadedRoom, liveObject);
        } else {
          this.setSwordsmanAiState(liveObject, 'patrol');
        }
      }
      return;
    }

    if (target?.withinActionRange && now >= liveObject.runtime.cooldownUntil) {
      liveObject.runtime.directionX = target.directionX;
      this.startSwordsmanWindup(liveObject);
      body.setVelocityX(0);
      return;
    }

    this.runSwordsmanPatrolFallback(loadedRoom, liveObject, body, 'police-patrol');
  }

  private getSwordsmanObjectiveMode(liveObject: LoadedRoomObject): SwordsmanObjectiveMode {
    return liveObject.runtime.aiObjectiveMode ?? DEFAULT_SWORDSMAN_OBJECTIVE_MODE;
  }

  private getSwordsmanDefeatMode(liveObject: LoadedRoomObject): SwordsmanDefeatMode {
    return liveObject.runtime.aiDefeatMode ?? DEFAULT_SWORDSMAN_DEFEAT_MODE;
  }

  private updateSwordsmanDuelObjective(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
    now: number,
  ): void {
    const target = this.getSwordsmanDuelObjectiveTarget(loadedRoom, liveObject, body);
    const currentState = liveObject.runtime.aiState ?? 'patrol';

    if (currentState === 'attack') {
      body.setVelocityX(0);
      this.holdGroundedSwordsmanAttackBody(body);
      this.clearSwordsmanObjectiveTraversalState(liveObject, 'attack', body);
      this.applySwordsmanFacing(liveObject, body, liveObject.runtime.directionX, { force: true });
      this.playSwordsmanAnimation(liveObject, this.getEnemyAnimationKey(liveObject, 'sword-slash'));
      if (!isPoliceEnemyObjectId(liveObject.config.id)) {
        this.applySwordsmanSwordDamage(loadedRoom, liveObject);
      }
      if (now >= liveObject.runtime.nextActionAt) {
        this.setSwordsmanAiState(liveObject, 'cooldown');
        this.playSwordsmanAnimation(liveObject, this.getEnemyAnimationKey(liveObject, 'idle'));
      }
      return;
    }

    if (currentState === 'windup') {
      body.setVelocityX(0);
      this.holdGroundedSwordsmanAttackBody(body);
      this.clearSwordsmanObjectiveTraversalState(liveObject, 'windup', body);
      if (target) {
        liveObject.runtime.directionX = target.directionX;
      }
      this.applySwordsmanFacing(liveObject, body, liveObject.runtime.directionX, { force: true });
      this.playSwordsmanAnimation(liveObject, this.getEnemyAnimationKey(liveObject, 'idle'));
      if (now >= liveObject.runtime.nextActionAt) {
        if (target?.withinActionRange) {
          this.startSwordsmanAttack(loadedRoom, liveObject);
        } else {
          this.setSwordsmanAiState(liveObject, target ? 'chase' : 'patrol');
        }
      }
      return;
    }

    if (currentState === 'cooldown') {
      body.setVelocityX(0);
      this.holdGroundedSwordsmanAttackBody(body);
      this.clearSwordsmanObjectiveTraversalState(liveObject, 'cooldown', body);
      this.playSwordsmanAnimation(
        liveObject,
        this.getEnemyAnimationKey(liveObject, isPoliceEnemyObjectId(liveObject.config.id) ? 'reload' : 'idle'),
      );
      if (now >= liveObject.runtime.cooldownUntil) {
        this.setSwordsmanAiState(liveObject, target ? 'chase' : 'patrol');
      }
      return;
    }

    this.runSwordsmanTraversalObjective(loadedRoom, liveObject, body, target, now, {
      onActionRangeReached: () => {
        this.startSwordsmanWindup(liveObject);
      },
      idleReason: 'patrol',
    });
  }

  private updateSwordsmanCollectObjective(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
    now: number,
  ): void {
    const target = this.getSwordsmanCollectObjectiveTarget(loadedRoom, liveObject, body);
    const currentState = liveObject.runtime.aiState ?? 'patrol';

    if (currentState === 'attack' || currentState === 'windup' || currentState === 'cooldown') {
      this.clearSwordsmanObjectiveTraversalState(liveObject, 'collect-mode-reset', body);
      this.setSwordsmanAiState(liveObject, 'patrol');
    }

    this.runSwordsmanTraversalObjective(loadedRoom, liveObject, body, target?.objectiveTarget ?? null, now, {
      onActionRangeReached: () => {
        if (!target) {
          return;
        }
        if (!liveObject.runtime.aiActiveTraversalEdgeId && (body.blocked.down || body.touching.down)) {
          body.setVelocityX(0);
          this.playSwordsmanAnimation(liveObject, this.getEnemyAnimationKey(liveObject, 'idle'));
        }
        liveObject.runtime.aiPlannedTraversalReason = 'collect';
        this.collectLiveObject(loadedRoom, target.collectible, {
          collector: 'enemy',
        });
      },
      idleReason: 'collect-idle',
    });
  }

  private getSwordsmanDuelObjectiveTarget(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body
  ): SwordsmanObjectiveTarget | null {
    const room = loadedRoom.room;
    const isPolice = isPoliceEnemyObjectId(liveObject.config.id);
    const target = buildSwordsmanDuelObjectiveTarget({
      enemyBody: body,
      playerBody: this.options.getPlayerBody(),
      roomOrigin: this.options.getRoomOrigin(room.coordinates),
      roomWidthPx: ROOM_PX_WIDTH,
      roomHeightPx: ROOM_PX_HEIGHT,
      chaseRangeX: SWORDSMAN_AI_CHASE_RANGE_X,
      chaseRangeY: SWORDSMAN_AI_CHASE_RANGE_Y,
      attackRangeX: isPolice ? POLICE_AI_SHOOT_RANGE_X : SWORDSMAN_AI_ATTACK_RANGE_X,
      attackRangeY: isPolice ? POLICE_AI_SHOOT_RANGE_Y : SWORDSMAN_AI_ATTACK_RANGE_Y,
    });

    if (!target?.withinActionRange) {
      return target;
    }

    if (
      isPolice
        ? this.canPoliceShootTarget(loadedRoom, liveObject, target.body)
        : this.canSwordsmanSwordReachTarget(loadedRoom, liveObject, target.body)
    ) {
      return target;
    }

    return {
      ...target,
      withinActionRange: false,
    };
  }

  private getSwordsmanCollectObjectiveTarget(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
  ): { collectible: LoadedRoomObject; objectiveTarget: SwordsmanObjectiveTarget } | null {
    type CollectNodeCandidate = {
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
    type CollectSweepCandidate = {
      collectible: LoadedRoomObject;
      objectiveTarget: SwordsmanObjectiveTarget;
      targetSnapshot: SwordsmanBodySnapshot;
      rawMetric: number;
      collectDeltaY: number;
    };
    type CollectNodeStats = {
      count: number;
    };

    const now = this.options.getCurrentTime();
    const enemyBounds = getArcadeBodyBounds(body);
    const room = loadedRoom.room;
    const roomOrigin = this.options.getRoomOrigin(room.coordinates);
    const graph = this.getSwordsmanTraversalGraph(room);
    const enemySnapshot = this.createSwordsmanBodySnapshot(body, roomOrigin);
    const currentContext = getSwordsmanTraversalContext(graph, enemySnapshot);
    const blockedEdgeIds = this.getSwordsmanBlockedTraversalEdgeIds(liveObject, now);
    const sweepDirectionX = (liveObject.runtime.directionX >= 0 ? 1 : -1) as -1 | 1;
    const groupedCandidates = new Map<string, CollectNodeCandidate>();
    const currentSweepCandidates: CollectSweepCandidate[] = [];
    const collectNodeStats = new Map<string, CollectNodeStats>();
    const addCollectNodeStat = (nodeIds: readonly string[]): void => {
      for (const nodeId of nodeIds) {
        const existing = collectNodeStats.get(nodeId);
        if (!existing) {
          collectNodeStats.set(nodeId, {
            count: 1,
          });
          continue;
        }
        existing.count += 1;
      }
    };
    let bestImmediateTarget: {
      collectible: LoadedRoomObject;
      objectiveTarget: SwordsmanObjectiveTarget;
      metric: number;
    } | null = null;
    let bestOverheadJumpTarget: {
      collectible: LoadedRoomObject;
      objectiveTarget: SwordsmanObjectiveTarget;
      metric: number;
    } | null = null;
    const considerOverheadJumpTarget = (
      collectible: LoadedRoomObject,
      objectiveTarget: SwordsmanObjectiveTarget,
      deltaX: number,
      deltaY: number,
      rawMetric: number,
    ): void => {
      if (!objectiveTarget.opportunisticJump || liveObject.runtime.aiActiveTraversalEdgeId) {
        return;
      }

      const forwardDistance = deltaX * sweepDirectionX;
      const jumpMetric =
        (forwardDistance >= -SWORDSMAN_AI_COLLECT_OVERHEAD_BEHIND_GRACE_PX
          ? Math.max(0, forwardDistance)
          : Math.abs(deltaX) + 240) +
        Math.abs(deltaY) * 0.35 +
        rawMetric * 0.08;
      if (!bestOverheadJumpTarget || jumpMetric < bestOverheadJumpTarget.metric) {
        bestOverheadJumpTarget = {
          collectible,
          objectiveTarget,
          metric: jumpMetric,
        };
      }
    };

    for (const candidate of loadedRoom.liveObjects) {
      if (
        candidate.config.category !== 'collectible' ||
        !candidate.sprite.active ||
        !candidate.sprite.body ||
        this.options.isCollectedObjectKey(candidate.key)
      ) {
        continue;
      }

      const targetBody = candidate.sprite.body as ArcadeObjectBody;
      const collectibleBounds = getArcadeBodyBounds(targetBody);
      const deltaX = targetBody.center.x - body.center.x;
      const deltaY = targetBody.center.y - body.center.y;
      const withinActionRange =
        Phaser.Geom.Intersects.RectangleToRectangle(enemyBounds, collectibleBounds) ||
        (Math.abs(deltaX) <= body.halfWidth + targetBody.width * 0.5 + 6 &&
          Math.abs(deltaY) <= body.halfHeight + targetBody.height * 0.5 + 8);
      const metric = Math.abs(deltaX) + Math.abs(deltaY) * 1.2;
      const objectiveTarget: SwordsmanObjectiveTarget = {
        kind: 'collectible',
        body: targetBody,
        directionX: deltaX >= 0 ? 1 : -1,
        withinActionRange,
      };
      const overheadJump = this.getSwordsmanCollectOverheadJump(
        room,
        currentContext.currentSurface,
        body,
        targetBody,
        sweepDirectionX,
      );

      if (withinActionRange) {
        if (!bestImmediateTarget || metric < bestImmediateTarget.metric) {
          bestImmediateTarget = {
            collectible: candidate,
            objectiveTarget,
            metric,
          };
        }
        continue;
      }

      const collectTraversalSnapshot = this.buildSwordsmanCollectTraversalSnapshot(
        graph,
        body,
        targetBody,
        roomOrigin,
      );
      if (!collectTraversalSnapshot) {
        // Collectibles without a valid standing pickup point are opportunistic only; do not let
        // their raw body snapshot masquerade as a sweepable current-node target.
        if (overheadJump) {
          const jumpObjectiveTarget: SwordsmanObjectiveTarget = {
            ...objectiveTarget,
            opportunisticJump: overheadJump,
          };
          considerOverheadJumpTarget(candidate, jumpObjectiveTarget, deltaX, deltaY, metric);
        }
        continue;
      }

      const targetContext = getSwordsmanTraversalTargetContext(graph, collectTraversalSnapshot);
      addCollectNodeStat(
        targetContext.targetNodeId ? [targetContext.targetNodeId] : targetContext.targetNodeIds,
      );
      const targetIncludesCurrentNode = Boolean(
        currentContext.currentNodeId &&
          targetContext.targetNodeIds.includes(currentContext.currentNodeId),
      );
      const groupedObjectiveTarget: SwordsmanObjectiveTarget = {
        ...objectiveTarget,
        traversalSnapshot: collectTraversalSnapshot,
        opportunisticJump: overheadJump,
      };
      if (overheadJump) {
        considerOverheadJumpTarget(candidate, groupedObjectiveTarget, deltaX, deltaY, metric);
      }
      if (targetIncludesCurrentNode) {
        currentSweepCandidates.push({
          collectible: candidate,
          objectiveTarget: groupedObjectiveTarget,
          targetSnapshot: collectTraversalSnapshot,
          rawMetric: metric,
          collectDeltaY: deltaY,
        });
      }
      const targetNodeKey =
        targetContext.targetNodeId ??
        (targetContext.targetNodeIds.length > 0
          ? targetContext.targetNodeIds.join('|')
          : `collectible:${candidate.key}`);
      const existing = groupedCandidates.get(targetNodeKey);
      if (!existing) {
        groupedCandidates.set(targetNodeKey, {
          collectible: candidate,
          targetBody,
          targetSnapshot: collectTraversalSnapshot,
          targetNodeId: targetContext.targetNodeId,
          objectiveTarget: groupedObjectiveTarget,
          rawMetric: metric,
          collectibleCount: 1,
          collectDeltaY: deltaY,
          traversalCenterXSum: collectTraversalSnapshot.centerX,
        });
        continue;
      }

      existing.collectibleCount += 1;
      existing.traversalCenterXSum += collectTraversalSnapshot.centerX;
      if (metric < existing.rawMetric) {
        existing.collectible = candidate;
        existing.targetBody = targetBody;
        existing.targetSnapshot = collectTraversalSnapshot;
        existing.targetNodeId = targetContext.targetNodeId;
        existing.objectiveTarget = groupedObjectiveTarget;
        existing.rawMetric = metric;
        existing.collectDeltaY = deltaY;
      }
    }

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
      this.clearSwordsmanCollectRoute(liveObject);
      liveObject.runtime.aiCollectState = 'jump';
      return {
        collectible: overheadJumpTarget.collectible,
        objectiveTarget: overheadJumpTarget.objectiveTarget,
      };
    }

    const candidates = Array.from(groupedCandidates.values()).sort(
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

    const activeTraversalTargetNodeId = liveObject.runtime.aiActiveTraversalNextNodeId;
    if (activeTraversalTargetNodeId && activeTraversalTargetNodeId !== currentContext.currentNodeId) {
      const activeTarget = this.buildSwordsmanCollectNodeObjectiveTarget(
        graph,
        candidates,
        activeTraversalTargetNodeId,
        enemySnapshot,
        body,
      );
      if (activeTarget) {
        liveObject.runtime.aiCollectState = 'route';
        return activeTarget;
      }
    }

    if (
      currentContext.currentNodeId &&
      liveObject.runtime.aiCollectRouteTargetNodeId === currentContext.currentNodeId
    ) {
      this.clearSwordsmanCollectRoute(liveObject);
    }

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

    if (bestCurrentNodeTarget?.isProductive) {
      liveObject.runtime.aiCollectState = 'sweep';
      return {
        collectible: bestCurrentNodeTarget.collectible,
        objectiveTarget: bestCurrentNodeTarget.objectiveTarget,
      };
    }

    const committedTargetNodeId = liveObject.runtime.aiCollectRouteTargetNodeId;
    if (
      committedTargetNodeId &&
      committedTargetNodeId !== currentContext.currentNodeId &&
      now < liveObject.runtime.aiCollectRouteExpiresAt
    ) {
      const committedCandidate = candidates.find(
        (candidate) => candidate.targetNodeId === committedTargetNodeId,
      );
      if (committedCandidate) {
        liveObject.runtime.aiCollectState = 'route';
        return {
          collectible: committedCandidate.collectible,
          objectiveTarget: committedCandidate.objectiveTarget,
        };
      }

      const committedTarget = this.buildSwordsmanCollectNodeObjectiveTarget(
        graph,
        candidates,
        committedTargetNodeId,
        enemySnapshot,
        body,
      );
      if (committedTarget) {
        liveObject.runtime.aiCollectState = 'route';
        return committedTarget;
      }
    }

    this.clearSwordsmanCollectRoute(liveObject);

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
    const hasRecentWallRouteFailure = liveObject.runtime.aiTraversalBlockedEdges.some((entry) => {
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
        bodyWidth: body.width,
        bodyHeight: body.height,
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
        : this.buildSwordsmanCollectNodeObjectiveTarget(
            graph,
            candidates,
            targetNodeId,
            enemySnapshot,
            body,
          );
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
        setupDirection !== Math.sign(liveObject.runtime.directionX)
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

    if (
      bestRouteTarget &&
      bestCurrentNodeTarget &&
      bestRouteTarget.wallEdgeCount > 0 &&
      bestRouteTarget.penalty >= SWORDSMAN_AI_COLLECT_WALL_ROUTE_LOCAL_SWEEP_PENALTY_MIN &&
      bestRouteTarget.metric >= SWORDSMAN_AI_COLLECT_WALL_ROUTE_LOCAL_SWEEP_SCORE_MIN
    ) {
      liveObject.runtime.aiCollectState = 'sweep';
      return {
        collectible: bestCurrentNodeTarget.collectible,
        objectiveTarget: bestCurrentNodeTarget.objectiveTarget,
      };
    }

    if (bestRouteTarget) {
      liveObject.runtime.aiCollectState = 'route';
      liveObject.runtime.aiCollectRouteTargetNodeId = bestRouteTarget.targetNodeId;
      liveObject.runtime.aiCollectRouteExpiresAt = now + SWORDSMAN_AI_COLLECT_ROUTE_COMMIT_MS;
      liveObject.runtime.aiCollectRouteScore = bestRouteTarget.metric;
      liveObject.runtime.aiCollectRouteValue = bestRouteTarget.value;
      liveObject.runtime.aiCollectRoutePenalty = bestRouteTarget.penalty;
      return {
        collectible: bestRouteTarget.collectible,
        objectiveTarget: bestRouteTarget.objectiveTarget,
      };
    }

    if (bestCurrentNodeTarget) {
      liveObject.runtime.aiCollectState = 'sweep';
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
    liveObject.runtime.aiCollectState = rawFallback ? 'sweep' : null;
    return rawFallback
      ? {
          collectible: rawFallback.collectible,
          objectiveTarget: rawFallback.objectiveTarget,
        }
      : null;
  }

  private getSwordsmanCollectOverheadJump(
    room: RoomSnapshot,
    currentSurface: SwordsmanSurfaceSegment | null,
    body: Phaser.Physics.Arcade.Body,
    targetBody: ArcadeObjectBody,
    sweepDirectionX: -1 | 1,
  ): NonNullable<SwordsmanObjectiveTarget['opportunisticJump']> | null {
    if (!currentSurface || !(body.blocked.down || body.touching.down)) {
      return null;
    }

    const deltaX = targetBody.center.x - body.center.x;
    const rise = body.center.y - targetBody.center.y;
    if (
      rise < SWORDSMAN_AI_COLLECT_OVERHEAD_MIN_RISE_PX ||
      rise > SWORDSMAN_AI_COLLECT_OVERHEAD_MAX_RISE_PX ||
      Math.abs(deltaX) > SWORDSMAN_AI_COLLECT_OVERHEAD_MAX_HORIZONTAL_PX ||
      deltaX * sweepDirectionX < -SWORDSMAN_AI_COLLECT_OVERHEAD_BEHIND_GRACE_PX
    ) {
      return null;
    }

    const roomOrigin = this.options.getRoomOrigin(room.coordinates);
    const bodyLocalX = body.center.x - roomOrigin.x;
    const targetLocalX = targetBody.center.x - roomOrigin.x;
    if (
      targetLocalX < currentSurface.leftX - SWORDSMAN_AI_COLLECT_OVERHEAD_SURFACE_MARGIN_PX ||
      targetLocalX > currentSurface.rightX + SWORDSMAN_AI_COLLECT_OVERHEAD_SURFACE_MARGIN_PX
    ) {
      return null;
    }

    const directionX = (Math.abs(deltaX) <= 4 ? sweepDirectionX : deltaX >= 0 ? 1 : -1) as -1 | 1;
    const minSafeJumpX =
      currentSurface.leftX +
      body.halfWidth +
      SWORDSMAN_AI_COLLECT_OVERHEAD_SURFACE_MARGIN_PX;
    const maxSafeJumpX =
      currentSurface.rightX -
      body.halfWidth -
      SWORDSMAN_AI_COLLECT_OVERHEAD_SURFACE_MARGIN_PX;
    const edgeClearance =
      directionX > 0
        ? currentSurface.rightX - bodyLocalX
        : bodyLocalX - currentSurface.leftX;
    if (
      bodyLocalX < minSafeJumpX ||
      bodyLocalX > maxSafeJumpX ||
      targetLocalX < minSafeJumpX ||
      targetLocalX > maxSafeJumpX ||
      edgeClearance < SWORDSMAN_AI_COLLECT_OVERHEAD_EDGE_CLEARANCE_PX
    ) {
      return null;
    }

    if (!this.hasClearSwordsmanCollectOverheadPath(room, body, targetBody)) {
      return null;
    }

    const velocityX =
      Math.abs(deltaX) <= 6
        ? body.velocity.x || directionX * SWORDSMAN_AI_SPEED
        : directionX *
          Phaser.Math.Clamp(Math.abs(deltaX) * 3.25, SWORDSMAN_AI_SPEED, SWORDSMAN_AI_JUMP_VELOCITY_X);

    return {
      directionX,
      targetX: targetBody.center.x,
      velocityX,
      velocityY: SWORDSMAN_AI_JUMP_VELOCITY_Y,
    };
  }

  private hasClearSwordsmanCollectOverheadPath(
    room: RoomSnapshot,
    body: Phaser.Physics.Arcade.Body,
    targetBody: ArcadeObjectBody,
  ): boolean {
    const startY = body.top - 2;
    const endY = targetBody.bottom + 2;
    if (endY >= startY) {
      return true;
    }

    const steps = Math.max(
      1,
      Math.ceil((startY - endY) / SWORDSMAN_AI_COLLECT_OVERHEAD_PATH_STEP_PX),
    );
    for (let index = 0; index <= steps; index += 1) {
      const progress = index / steps;
      const x = Phaser.Math.Linear(body.center.x, targetBody.center.x, progress);
      const y = Phaser.Math.Linear(startY, endY, progress);
      if (this.hasSolidTerrainAtWorldPoint(room, x, y)) {
        return false;
      }
    }

    return true;
  }

  private buildSwordsmanCollectNodeObjectiveTarget(
    graph: SwordsmanTraversalGraph,
    candidates: Array<{
      collectible: LoadedRoomObject;
      targetBody: ArcadeObjectBody;
    }>,
    nodeId: string,
    enemySnapshot: SwordsmanBodySnapshot,
    body: Phaser.Physics.Arcade.Body,
  ): { collectible: LoadedRoomObject; objectiveTarget: SwordsmanObjectiveTarget } | null {
    const fallback = candidates[0] ?? null;
    const node = graph.nodesById.get(nodeId);
    if (!fallback || !node) {
      return null;
    }

    const halfWidth = body.width * 0.5;
    const halfHeight = body.height * 0.5;
    let traversalSnapshot: SwordsmanBodySnapshot;
    if (node.kind === 'surface') {
      const centerX = Phaser.Math.Clamp(
        enemySnapshot.centerX,
        node.leftX + halfWidth,
        node.rightX - halfWidth,
      );
      traversalSnapshot = {
        centerX,
        centerY: node.topY - halfHeight,
        left: centerX - halfWidth,
        right: centerX + halfWidth,
        bottom: node.topY,
        onFloor: true,
        wallContactSide: 0,
      };
    } else {
      traversalSnapshot = {
        centerX: node.x,
        centerY: node.centerY,
        left: node.x - halfWidth,
        right: node.x + halfWidth,
        bottom: node.centerY + halfHeight,
        onFloor: false,
        wallContactSide: node.contactSide,
      };
    }

    return {
      collectible: fallback.collectible,
      objectiveTarget: {
        kind: 'collectible',
        body: fallback.targetBody,
        directionX: traversalSnapshot.centerX >= enemySnapshot.centerX ? 1 : -1,
        withinActionRange: false,
        traversalSnapshot,
      },
    };
  }

  private clearSwordsmanCollectRoute(liveObject: LoadedRoomObject): void {
    liveObject.runtime.aiCollectRouteTargetNodeId = null;
    liveObject.runtime.aiCollectRouteExpiresAt = 0;
    liveObject.runtime.aiCollectRouteScore = null;
    liveObject.runtime.aiCollectRouteValue = 0;
    liveObject.runtime.aiCollectRoutePenalty = 0;
    if (liveObject.runtime.aiCollectState === 'route') {
      liveObject.runtime.aiCollectState = null;
    }
  }

  private clearSwordsmanObjectiveTraversalState(
    liveObject: LoadedRoomObject,
    reason: string | null,
    body: Phaser.Physics.Arcade.Body | null = null,
  ): void {
    this.stopSwordsmanLadderTraversal(liveObject, body);
    liveObject.runtime.aiIntent = null;
    liveObject.runtime.aiTargetX = null;
    liveObject.runtime.aiCurrentSegmentId = null;
    liveObject.runtime.aiTargetSegmentId = null;
    liveObject.runtime.aiTraversalEdgeId = null;
    this.clearSwordsmanFallbackTraversal(liveObject);
    this.clearSwordsmanRouteLoopMemory(liveObject);
    this.clearSwordsmanPlannedRoute(liveObject, reason);
    this.clearSwordsmanCollectRoute(liveObject);
  }

  private runSwordsmanTraversalObjective(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
    target: SwordsmanObjectiveTarget | null,
    now: number,
    options: {
      onActionRangeReached?: () => void;
      idleReason: string;
    },
  ): void {
    const room = loadedRoom.room;
    const onFloor = body.blocked.down || body.touching.down;
    if (!target) {
      if (options.idleReason === 'collect-idle') {
        const hasBlockedCollectRoute = liveObject.runtime.aiTraversalBlockedEdges.some(
          (entry) => entry.until > now,
        );
        if (hasBlockedCollectRoute) {
          this.runSwordsmanPatrolFallback(loadedRoom, liveObject, body, 'collect-recovery');
          return;
        }
        this.runSwordsmanCollectIdleFallback(liveObject, body, options.idleReason);
        return;
      }
      this.runSwordsmanPatrolFallback(loadedRoom, liveObject, body, options.idleReason);
      return;
    }

    let traversalDecision = this.getSwordsmanTraversalDecision(
      liveObject,
      room,
      body,
      target.body,
      target.traversalSnapshot ?? null,
    );
    if (this.maybeBlockSwordsmanFallbackRoute(room, liveObject, body, traversalDecision, now)) {
      traversalDecision = this.getSwordsmanTraversalDecision(
        liveObject,
        room,
        body,
        target.body,
        target.traversalSnapshot ?? null,
      );
    }
    if (this.updateSwordsmanRouteLoopMemory(room, liveObject, body, traversalDecision, now)) {
      traversalDecision = this.getSwordsmanTraversalDecision(
        liveObject,
        room,
        body,
        target.body,
        target.traversalSnapshot ?? null,
      );
      this.updateSwordsmanRouteLoopMemory(room, liveObject, body, traversalDecision, now);
    }
    this.trackSwordsmanFallbackRoute(room, liveObject, body, traversalDecision, now);
    const chaseDirectionX = traversalDecision?.directionX ?? target.directionX;
    liveObject.runtime.directionX = chaseDirectionX;
    liveObject.runtime.aiIntent = traversalDecision?.intent ?? (onFloor ? 'same-platform' : 'air-chase');
    liveObject.runtime.aiTargetX = traversalDecision?.targetX ?? target.body.center.x;
    liveObject.runtime.aiCurrentSegmentId = traversalDecision?.currentSegmentId ?? null;
    liveObject.runtime.aiTargetSegmentId = traversalDecision?.targetSegmentId ?? null;
    liveObject.runtime.aiTraversalEdgeId = traversalDecision?.traversalEdgeId ?? null;
    if (target.withinActionRange) {
      options.onActionRangeReached?.();
      if (!liveObject.runtime.aiActiveTraversalEdgeId && (body.blocked.down || body.touching.down)) {
        body.setVelocityX(0);
      }
      return;
    }

    this.setSwordsmanAiState(liveObject, 'chase');
    this.applySwordsmanFacing(liveObject, body, liveObject.runtime.directionX);
    if (this.tryApplySwordsmanCollectJump(room, liveObject, body, target, now)) {
      return;
    }
    if (this.tryApplySwordsmanLadderTraversal(room, liveObject, body, traversalDecision, now)) {
      return;
    }
    if (this.tryApplySwordsmanTraversalImpulse(liveObject, body, traversalDecision)) {
      return;
    }
    this.maybeStartSwordsmanDropDownTraversalAttempt(loadedRoom, liveObject, body, traversalDecision, now);

    if (!onFloor) {
      this.steerSwordsmanInAir(
        room,
        liveObject,
        body,
        chaseDirectionX,
        traversalDecision?.traversalEdgeId ? traversalDecision.targetX : null,
      );
      return;
    }

    this.moveSwordsmanAlongGround(loadedRoom, liveObject, body, SWORDSMAN_AI_SPEED, {
      allowEdgeDrop: traversalDecision?.allowEdgeDrop ?? false,
      decision: traversalDecision,
    });
  }

  private runSwordsmanCollectIdleFallback(
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
    reason: string,
  ): void {
    this.setSwordsmanAiState(liveObject, 'patrol');
    this.clearSwordsmanObjectiveTraversalState(liveObject, reason, body);
    body.setVelocityX(0);
    this.applySwordsmanFacing(liveObject, body, liveObject.runtime.directionX);
    this.playSwordsmanAnimation(
      liveObject,
      body.velocity.y < 0
        ? this.getEnemyAnimationKey(liveObject, 'jump-rise')
        : body.velocity.y > 0
          ? this.getEnemyAnimationKey(liveObject, 'jump-fall')
          : this.getEnemyAnimationKey(liveObject, 'idle'),
    );
  }

  private runSwordsmanPatrolFallback(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
    reason: string,
  ): void {
    this.setSwordsmanAiState(liveObject, 'patrol');
    this.clearSwordsmanObjectiveTraversalState(liveObject, reason, body);
    this.maybeReverseGroundEnemy(loadedRoom.room, liveObject, body);
    this.applySwordsmanFacing(liveObject, body, liveObject.runtime.directionX);
    this.moveSwordsmanAlongGround(loadedRoom, liveObject, body, SWORDSMAN_AI_SPEED * 0.68);
  }

  private moveSwordsmanAlongGround(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
    speed: number,
    options: {
      allowEdgeDrop?: boolean;
      decision?: SwordsmanTraversalDecision | null;
    } = {},
  ): void {
    const onFloor = body.blocked.down || body.touching.down;
    const movingTowardWall =
      (body.blocked.left && liveObject.runtime.directionX < 0) ||
      (body.blocked.right && liveObject.runtime.directionX > 0);
    const supportedByRuntimeObject = this.isSwordsmanSupportedBySolidRuntimeObject(
      loadedRoom,
      liveObject,
      body,
    );
    const allowJumpSetupApproach =
      !supportedByRuntimeObject &&
      this.shouldAllowSwordsmanJumpSetupEdgeApproach(
        loadedRoom.room,
        body,
        options.decision ?? null,
      );
    const allowEdgeDrop = Boolean(options.allowEdgeDrop && !supportedByRuntimeObject);
    const missingGroundAhead =
      !allowEdgeDrop &&
      !allowJumpSetupApproach &&
      onFloor &&
      !this.hasSolidSupportAhead(
        loadedRoom,
        liveObject,
        body,
        liveObject.runtime.directionX,
        SWORDSMAN_AI_EDGE_GUARD_PROBE_LEAD_PX,
      );

    if (movingTowardWall || missingGroundAhead) {
      body.setVelocityX(0);
      this.playSwordsmanAnimation(liveObject, this.getEnemyAnimationKey(liveObject, 'idle'));
      return;
    }

    body.setVelocityX(liveObject.runtime.directionX * speed);
    this.playSwordsmanAnimation(liveObject, this.getEnemyAnimationKey(liveObject, 'run'));
  }

  private getSwordsmanTraversalDecision(
    liveObject: LoadedRoomObject,
    room: RoomSnapshot,
    body: Phaser.Physics.Arcade.Body,
    targetBody: ArcadeObjectBody,
    targetSnapshotOverride: SwordsmanBodySnapshot | null = null,
  ): SwordsmanTraversalDecision {
    const plannerMode =
      this.getSwordsmanObjectiveMode(liveObject) === 'collect'
        ? 'robust'
        : this.options.swordsmanTraversalPlannerMode;
    if (plannerMode === 'robust') {
      return this.getSwordsmanRobustTraversalDecision(
        liveObject,
        room,
        body,
        targetBody,
        targetSnapshotOverride,
      );
    }

    return this.getSwordsmanClassicTraversalDecision(
      liveObject,
      room,
      body,
      targetBody,
      targetSnapshotOverride,
    );
  }

  private getSwordsmanClassicTraversalDecision(
    liveObject: LoadedRoomObject,
    room: RoomSnapshot,
    body: Phaser.Physics.Arcade.Body,
    targetBody: ArcadeObjectBody,
    targetSnapshotOverride: SwordsmanBodySnapshot | null = null,
  ): SwordsmanTraversalDecision {
    const graph = this.getSwordsmanTraversalGraph(room);
    const roomOrigin = this.options.getRoomOrigin(room.coordinates);
    const blockedEdgeIds = this.getSwordsmanBlockedTraversalEdgeIds(liveObject, this.options.getCurrentTime());
    const enemySnapshot = this.createSwordsmanBodySnapshot(body, roomOrigin);
    const targetSnapshot = this.resolveSwordsmanTraversalTargetSnapshot(
      liveObject,
      graph,
      body,
      targetBody,
      roomOrigin,
      targetSnapshotOverride,
    );
    liveObject.runtime.aiPlannerMode = 'classic';
    liveObject.runtime.aiPlannerFallback = false;
    liveObject.runtime.aiPlannerPlanMs = 0;
    liveObject.runtime.aiPlannerExpandedStates = 0;
    liveObject.runtime.aiPlannerSimulatedEdges = 0;
    const activeTraversalEdge = liveObject.runtime.aiActiveTraversalEdgeId
      ? getSwordsmanTraversalEdgeById(graph, liveObject.runtime.aiActiveTraversalEdgeId)
      : null;
    if (isSwordsmanLadderTraversalEdge(activeTraversalEdge)) {
      const currentContext = getSwordsmanTraversalContext(graph, enemySnapshot);
      const targetContext = getSwordsmanTraversalTargetContext(graph, targetSnapshot);
      return buildSwordsmanTraversalDecisionFromEdge(
        activeTraversalEdge,
        enemySnapshot,
        targetSnapshot.centerX >= enemySnapshot.centerX ? 1 : -1,
        targetContext.targetSurface?.centerX ?? targetSnapshot.centerX,
        currentContext.currentNodeId,
        targetContext.targetNodeId,
        targetSnapshot,
      );
    }
    this.clearSwordsmanPlannedRoute(liveObject, null);
    return decideSwordsmanTraversal(graph, enemySnapshot, targetSnapshot, blockedEdgeIds);
  }

  private getSwordsmanRobustTraversalDecision(
    liveObject: LoadedRoomObject,
    room: RoomSnapshot,
    body: Phaser.Physics.Arcade.Body,
    targetBody: ArcadeObjectBody,
    targetSnapshotOverride: SwordsmanBodySnapshot | null = null,
  ): SwordsmanTraversalDecision {
    const graph = this.getSwordsmanTraversalGraph(room);
    const roomOrigin = this.options.getRoomOrigin(room.coordinates);
    let blockedEdgeIds = this.getSwordsmanBlockedTraversalEdgeIds(
      liveObject,
      this.options.getCurrentTime(),
    );
    const enemySnapshot = this.createSwordsmanBodySnapshot(body, roomOrigin);
    const targetSnapshot = this.resolveSwordsmanTraversalTargetSnapshot(
      liveObject,
      graph,
      body,
      targetBody,
      roomOrigin,
      targetSnapshotOverride,
    );
    const currentContext = getSwordsmanTraversalContext(graph, enemySnapshot);
    const targetContext = getSwordsmanTraversalTargetContext(graph, targetSnapshot);
    const fallbackDirectionX = (targetSnapshot.centerX >= enemySnapshot.centerX ? 1 : -1) as -1 | 1;
    const fallbackTargetX = targetContext.targetSurface?.centerX ?? targetSnapshot.centerX;
    const now = this.options.getCurrentTime();
    const onFloor = body.blocked.down || body.touching.down;
    const routeLifetimeMs =
      this.getSwordsmanObjectiveMode(liveObject) === 'collect'
        ? Math.max(
            SWORDSMAN_AI_COLLECT_ROUTE_COMMIT_MS,
            SWORDSMAN_AI_ROBUST_ROUTE_COMMIT_MS,
            SWORDSMAN_AI_ROBUST_REPLAN_INTERVAL_MS,
          )
        : Math.max(
            SWORDSMAN_AI_ROBUST_ROUTE_COMMIT_MS,
            SWORDSMAN_AI_ROBUST_REPLAN_INTERVAL_MS,
          );
    liveObject.runtime.aiPlannerMode = 'robust';
    this.advanceSwordsmanPlannedRoute(liveObject, graph, currentContext.currentNodeId);

    let activeTraversalEdge = liveObject.runtime.aiActiveTraversalEdgeId
      ? getSwordsmanTraversalEdgeById(graph, liveObject.runtime.aiActiveTraversalEdgeId)
      : null;
    if (
      activeTraversalEdge?.type === 'jump-to-wall' &&
      currentContext.currentNodeId === activeTraversalEdge.toId
    ) {
      this.clearSwordsmanTraversalAttempt(liveObject);
      activeTraversalEdge = null;
    }
    const previousTraversalEdge = liveObject.runtime.aiTraversalEdgeId
      ? getSwordsmanTraversalEdgeById(graph, liveObject.runtime.aiTraversalEdgeId)
      : null;
    const plannedTraversalEdge = this.getSwordsmanPlannedRouteActiveEdge(liveObject, graph);

    if (activeTraversalEdge) {
      liveObject.runtime.aiPlannerFallback = false;
      liveObject.runtime.aiPlannerPlanMs = 0;
      liveObject.runtime.aiPlannerExpandedStates = 0;
      liveObject.runtime.aiPlannerSimulatedEdges = 0;
      liveObject.runtime.aiPlannedTraversalReason = 'active-traversal';
      return buildSwordsmanTraversalDecisionFromEdge(
        activeTraversalEdge,
        enemySnapshot,
        fallbackDirectionX,
        fallbackTargetX,
        currentContext.currentNodeId,
        targetContext.targetNodeId,
        targetSnapshot,
      );
    }

    if (!onFloor) {
      if (
        plannedTraversalEdge &&
        plannedTraversalEdge.fromId === currentContext.currentNodeId &&
        !blockedEdgeIds.has(plannedTraversalEdge.id)
      ) {
        liveObject.runtime.aiPlannerFallback = false;
        liveObject.runtime.aiPlannerPlanMs = 0;
        liveObject.runtime.aiPlannerExpandedStates = 0;
        liveObject.runtime.aiPlannerSimulatedEdges = 0;
        liveObject.runtime.aiPlannedTraversalReason = 'airborne-route-edge';
        return buildSwordsmanTraversalDecisionFromEdge(
          plannedTraversalEdge,
          enemySnapshot,
          fallbackDirectionX,
          fallbackTargetX,
          currentContext.currentNodeId,
          targetContext.targetNodeId,
          targetSnapshot,
        );
      }

      if (currentContext.currentWall) {
        const wallPlan = planSwordsmanRobustTraversal({
          room,
          graph,
          enemy: enemySnapshot,
          target: targetSnapshot,
          blockedEdgeIds,
          bodyWidth: body.width,
          bodyHeight: body.height,
        });

        liveObject.runtime.aiPlannerPlanMs = wallPlan?.planDurationMs ?? 0;
        liveObject.runtime.aiPlannerExpandedStates = wallPlan?.expandedStates ?? 0;
        liveObject.runtime.aiPlannerSimulatedEdges = wallPlan?.simulatedEdges ?? 0;

        if (wallPlan && wallPlan.edges.length > 0) {
          const wallEdge = wallPlan.edges[0];
          liveObject.runtime.aiPlannerFallback = false;
          liveObject.runtime.aiPlannedTraversalEdgeIds = wallPlan.edges.map((edge) => edge.id);
          liveObject.runtime.aiPlannedTraversalTargetNodeId = wallPlan.targetNodeId;
          liveObject.runtime.aiPlannedTraversalExpiresAt = now + routeLifetimeMs;
          liveObject.runtime.aiPlannedTraversalReason = wallPlan.exactRoute
            ? 'airborne-wall-route'
            : 'airborne-wall-partial-route';
          return buildSwordsmanTraversalDecisionFromEdge(
            wallEdge,
            enemySnapshot,
            fallbackDirectionX,
            fallbackTargetX,
            currentContext.currentNodeId,
            targetContext.targetNodeId,
            targetSnapshot,
          );
        }
      }

      const previousEdgeStillPlanned =
        previousTraversalEdge !== null &&
        liveObject.runtime.aiPlannedTraversalEdgeIds[0] === previousTraversalEdge.id &&
        !blockedEdgeIds.has(previousTraversalEdge.id) &&
        (
          previousTraversalEdge.type !== 'wall-jump' ||
          currentContext.currentWall?.id === previousTraversalEdge.fromId
        );
      if (previousTraversalEdge && previousEdgeStillPlanned) {
        liveObject.runtime.aiPlannerFallback = false;
        liveObject.runtime.aiPlannerPlanMs = 0;
        liveObject.runtime.aiPlannerExpandedStates = 0;
        liveObject.runtime.aiPlannerSimulatedEdges = 0;
        liveObject.runtime.aiPlannedTraversalReason = 'airborne-reuse-edge';
        return buildSwordsmanTraversalDecisionFromEdge(
          previousTraversalEdge,
          enemySnapshot,
          fallbackDirectionX,
          fallbackTargetX,
          currentContext.currentNodeId,
          targetContext.targetNodeId,
          targetSnapshot,
        );
      }

      if (
        plannedTraversalEdge?.type === 'wall-jump' &&
        currentContext.currentWall?.id !== plannedTraversalEdge.fromId
      ) {
        this.blockSwordsmanTraversalEdge(liveObject, plannedTraversalEdge.id, now, {
          clearReason: 'invalid-airborne-wall-start',
        });
        this.clearSwordsmanCollectRoute(liveObject);
        this.clearSwordsmanPlannedRoute(liveObject, 'invalid-airborne-wall-start');
        blockedEdgeIds = this.getSwordsmanBlockedTraversalEdgeIds(liveObject, now);
      }

      liveObject.runtime.aiPlannerFallback = false;
      liveObject.runtime.aiPlannerPlanMs = 0;
      liveObject.runtime.aiPlannerExpandedStates = 0;
      liveObject.runtime.aiPlannerSimulatedEdges = 0;
      liveObject.runtime.aiPlannedTraversalReason = 'airborne-hold';
      return {
        intent: 'air-chase',
        directionX: (liveObject.runtime.directionX >= 0 ? 1 : -1) as -1 | 1,
        targetX: fallbackTargetX,
        allowEdgeDrop: false,
        jumpVelocityX: 0,
        jumpVelocityY: 0,
        traversalEdgeId: null,
        traversalNextNodeId: null,
        currentSegmentId: currentContext.currentNodeId,
        targetSegmentId: targetContext.targetNodeId,
      };
    }

    if (
      currentContext.currentSurface &&
      targetContext.targetSurface &&
      currentContext.currentSurface.id === targetContext.targetSurface.id
    ) {
      liveObject.runtime.aiPlannerFallback = false;
      liveObject.runtime.aiPlannerPlanMs = 0;
      liveObject.runtime.aiPlannerExpandedStates = 0;
      liveObject.runtime.aiPlannerSimulatedEdges = 0;
      this.clearSwordsmanPlannedRoute(liveObject, 'same-surface');
      return {
        intent: 'same-platform',
        directionX: fallbackDirectionX,
        targetX: targetSnapshot.centerX,
        allowEdgeDrop: false,
        jumpVelocityX: 0,
        jumpVelocityY: 0,
        traversalEdgeId: null,
        traversalNextNodeId: null,
        currentSegmentId: currentContext.currentNodeId,
        targetSegmentId: targetContext.targetNodeId,
      };
    }

    let activeEdge = this.getSwordsmanPlannedRouteActiveEdge(liveObject, graph);
    const targetChanged =
      liveObject.runtime.aiPlannedTraversalTargetNodeId !== null &&
      !targetContext.targetNodeIds.includes(liveObject.runtime.aiPlannedTraversalTargetNodeId);
    const routeExpired = now >= liveObject.runtime.aiPlannedTraversalExpiresAt;
    const blockedRoute = activeEdge ? blockedEdgeIds.has(activeEdge.id) : false;
    const detachedRoute =
      activeEdge !== null &&
      currentContext.currentNodeId !== null &&
      activeEdge.fromId !== currentContext.currentNodeId &&
      activeEdge.toId !== currentContext.currentNodeId;

    if (
      detachedRoute &&
      activeEdge &&
      !targetChanged &&
      !routeExpired &&
      !blockedRoute &&
      this.getSwordsmanObjectiveMode(liveObject) === 'collect'
    ) {
      this.blockSwordsmanTraversalEdge(liveObject, activeEdge.id, now, {
        clearReason: 'detached-route',
      });
      this.clearSwordsmanCollectRoute(liveObject);
      blockedEdgeIds = this.getSwordsmanBlockedTraversalEdgeIds(liveObject, now);
      activeEdge = null;
    }

    if (!activeEdge || targetChanged || routeExpired || blockedRoute || detachedRoute) {
      const plan = planSwordsmanRobustTraversal({
        room,
        graph,
        enemy: enemySnapshot,
        target: targetSnapshot,
        blockedEdgeIds,
        bodyWidth: body.width,
        bodyHeight: body.height,
      });

      liveObject.runtime.aiPlannerPlanMs = plan?.planDurationMs ?? 0;
      liveObject.runtime.aiPlannerExpandedStates = plan?.expandedStates ?? 0;
      liveObject.runtime.aiPlannerSimulatedEdges = plan?.simulatedEdges ?? 0;

      if (plan && plan.edges.length > 0) {
        liveObject.runtime.aiPlannerFallback = false;
        liveObject.runtime.aiPlannedTraversalEdgeIds = plan.edges.map((edge) => edge.id);
        liveObject.runtime.aiPlannedTraversalTargetNodeId = plan.targetNodeId;
        liveObject.runtime.aiPlannedTraversalExpiresAt = now + routeLifetimeMs;
        if (activeEdge) {
          liveObject.runtime.aiPlannedTraversalReason = plan.exactRoute ? 'replan' : 'replan-partial';
        } else {
          liveObject.runtime.aiPlannedTraversalReason = plan.exactRoute ? 'new-route' : 'new-partial-route';
        }
        activeEdge = plan.edges[0] ?? null;
      } else {
        liveObject.runtime.aiPlannerFallback = true;
        this.clearSwordsmanPlannedRoute(liveObject, 'fallback-classic');
        return decideSwordsmanTraversal(graph, enemySnapshot, targetSnapshot, blockedEdgeIds);
      }
    } else {
      liveObject.runtime.aiPlannerFallback = false;
      liveObject.runtime.aiPlannedTraversalReason = 'reuse';
    }

    if (!activeEdge) {
      liveObject.runtime.aiPlannerFallback = true;
      this.clearSwordsmanPlannedRoute(liveObject, 'fallback-classic');
      return decideSwordsmanTraversal(graph, enemySnapshot, targetSnapshot, blockedEdgeIds);
    }

    if (
      activeEdge.type === 'wall-jump' &&
      currentContext.currentWall?.id !== activeEdge.fromId
    ) {
      this.blockSwordsmanTraversalEdge(liveObject, activeEdge.id, now, {
        clearReason: 'invalid-wall-start',
      });
      this.clearSwordsmanCollectRoute(liveObject);
      this.clearSwordsmanPlannedRoute(liveObject, 'invalid-wall-start');
      blockedEdgeIds = this.getSwordsmanBlockedTraversalEdgeIds(liveObject, now);
      liveObject.runtime.aiPlannerFallback = true;
      return decideSwordsmanTraversal(graph, enemySnapshot, targetSnapshot, blockedEdgeIds);
    }

    return buildSwordsmanTraversalDecisionFromEdge(
      activeEdge,
      enemySnapshot,
      fallbackDirectionX,
      fallbackTargetX,
      currentContext.currentNodeId,
      targetContext.targetNodeId,
      targetSnapshot,
    );
  }

  private getSwordsmanTraversalGraph(room: RoomSnapshot): SwordsmanTraversalGraph {
    const cacheKey = getSwordsmanTraversalGraphCacheKey(room);
    const cached = this.swordsmanTraversalGraphs.get(cacheKey);
    if (cached) {
      return cached;
    }

    if (this.swordsmanTraversalGraphs.size > 64) {
      this.swordsmanTraversalGraphs.clear();
    }
    const graph = buildSwordsmanTraversalGraph(room);
    this.swordsmanTraversalGraphs.set(cacheKey, graph);
    return graph;
  }

  private buildSwordsmanCollectTraversalSnapshot(
    graph: SwordsmanTraversalGraph,
    enemyBody: Phaser.Physics.Arcade.Body,
    collectibleBody: ArcadeObjectBody,
    roomOrigin: { x: number; y: number },
  ): SwordsmanBodySnapshot | null {
    const collectibleCenterX = collectibleBody.center.x - roomOrigin.x;
    const collectibleCenterY = collectibleBody.center.y - roomOrigin.y;
    const enemyHalfWidth = enemyBody.width * 0.5;
    const enemyHalfHeight = enemyBody.height * 0.5;
    const horizontalReach = enemyHalfWidth + collectibleBody.width * 0.5 + 6;
    const verticalReach = enemyHalfHeight + collectibleBody.height * 0.5 + 8;
    let bestSnapshot: SwordsmanBodySnapshot | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const segment of graph.surfaceSegments) {
      const minCenterX = segment.leftX + enemyHalfWidth;
      const maxCenterX = segment.rightX - enemyHalfWidth;
      if (maxCenterX < minCenterX) {
        continue;
      }

      const standingCenterY = segment.topY - enemyHalfHeight;
      const verticalDistance = Math.abs(collectibleCenterY - standingCenterY);
      if (verticalDistance > verticalReach) {
        continue;
      }

      const collectMinX = Math.max(minCenterX, collectibleCenterX - horizontalReach);
      const collectMaxX = Math.min(maxCenterX, collectibleCenterX + horizontalReach);
      if (collectMinX > collectMaxX) {
        continue;
      }

      const collectX = Phaser.Math.Clamp(collectibleCenterX, collectMinX, collectMaxX);
      const horizontalDistance = Math.abs(collectX - collectibleCenterX);
      const score = verticalDistance * 4 + horizontalDistance;
      if (score >= bestScore) {
        continue;
      }

      bestScore = score;
      bestSnapshot = {
        centerX: collectX,
        centerY: standingCenterY,
        left: collectX - enemyHalfWidth,
        right: collectX + enemyHalfWidth,
        bottom: segment.topY,
        onFloor: true,
        wallContactSide: 0,
      };
    }

    return bestSnapshot;
  }

  private resolveSwordsmanTraversalTargetSnapshot(
    liveObject: LoadedRoomObject,
    graph: SwordsmanTraversalGraph,
    body: Phaser.Physics.Arcade.Body,
    targetBody: ArcadeObjectBody,
    roomOrigin: { x: number; y: number },
    targetSnapshotOverride: SwordsmanBodySnapshot | null = null,
  ): SwordsmanBodySnapshot {
    if (targetSnapshotOverride) {
      return targetSnapshotOverride;
    }

    if (this.getSwordsmanObjectiveMode(liveObject) === 'collect') {
      return (
        this.buildSwordsmanCollectTraversalSnapshot(graph, body, targetBody, roomOrigin) ??
        this.createSwordsmanBodySnapshot(targetBody, roomOrigin)
      );
    }

    return this.createSwordsmanBodySnapshot(targetBody, roomOrigin);
  }

  private shouldAllowSwordsmanJumpSetupEdgeApproach(
    room: RoomSnapshot,
    body: Phaser.Physics.Arcade.Body,
    decision: SwordsmanTraversalDecision | null,
  ): boolean {
    if (
      !decision ||
      decision.intent !== 'same-platform' ||
      !decision.traversalEdgeId ||
      !(body.blocked.down || body.touching.down)
    ) {
      return false;
    }

    const edge = getSwordsmanTraversalEdgeById(
      this.getSwordsmanTraversalGraph(room),
      decision.traversalEdgeId,
    );
    if (
      !edge ||
      (
        edge.type !== 'jump-up' &&
        edge.type !== 'jump-gap' &&
        edge.type !== 'jump-to-wall' &&
        !isSwordsmanLadderTraversalEdge(edge)
      )
    ) {
      return false;
    }

    const snapshot = this.createSwordsmanBodySnapshot(body, this.options.getRoomOrigin(room.coordinates));
    const setupReferenceX = snapshot.centerX;
    const remainingSetupDistance = Math.abs(edge.setupX - setupReferenceX);
    return (
      remainingSetupDistance <=
      body.halfWidth +
        SWORDSMAN_AI_EDGE_GUARD_PROBE_LEAD_PX +
        SWORDSMAN_AI_JUMP_SETUP_APPROACH_TOLERANCE_PX
    );
  }

  private createSwordsmanBodySnapshot(
    body: ArcadeObjectBody,
    roomOrigin: { x: number; y: number },
  ): SwordsmanBodySnapshot {
    return {
      centerX: body.center.x - roomOrigin.x,
      centerY: body.center.y - roomOrigin.y,
      left: body.left - roomOrigin.x,
      right: body.right - roomOrigin.x,
      bottom: body.bottom - roomOrigin.y,
      onFloor: isDynamicArcadeBody(body) ? body.blocked.down || body.touching.down : false,
      wallContactSide: this.getSwordsmanWallContactSide(body),
    };
  }

  private getSwordsmanWallContactSide(body: ArcadeObjectBody): -1 | 0 | 1 {
    if (!isDynamicArcadeBody(body)) {
      return 0;
    }
    if (body.blocked.left || body.touching.left) {
      return -1;
    }
    if (body.blocked.right || body.touching.right) {
      return 1;
    }
    return 0;
  }

  private syncSwordsmanLadderGravity(
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
  ): void {
    body.setAllowGravity(liveObject.runtime.aiLadderTraversalEdgeId === null);
  }

  private stopSwordsmanLadderTraversal(
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body | null = null,
  ): void {
    const ladderEdgeId = liveObject.runtime.aiLadderTraversalEdgeId;
    if (!ladderEdgeId && body?.allowGravity !== false) {
      return;
    }

    if (body) {
      body.setAllowGravity(true);
    }
    liveObject.runtime.aiLadderTraversalEdgeId = null;
    if (ladderEdgeId && liveObject.runtime.aiActiveTraversalEdgeId === ladderEdgeId) {
      this.clearSwordsmanTraversalAttempt(liveObject);
    }
  }

  private tryApplySwordsmanLadderTraversal(
    room: RoomSnapshot,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
    decision: SwordsmanTraversalDecision | null,
    now: number,
  ): boolean {
    if (!decision || decision.intent !== 'ladder-climb' || !decision.traversalEdgeId) {
      this.stopSwordsmanLadderTraversal(liveObject, body);
      return false;
    }

    const graph = this.getSwordsmanTraversalGraph(room);
    const edge = getSwordsmanTraversalEdgeById(graph, decision.traversalEdgeId);
    if (!isSwordsmanLadderTraversalEdge(edge)) {
      this.stopSwordsmanLadderTraversal(liveObject, body);
      return false;
    }

    const targetNode = graph.nodesById.get(edge.toId);
    if (!targetNode || targetNode.kind !== 'surface') {
      this.stopSwordsmanLadderTraversal(liveObject, body);
      return false;
    }

    if (liveObject.runtime.aiLadderTraversalEdgeId !== edge.id) {
      this.startSwordsmanTraversalAttempt(liveObject, decision, body);
      liveObject.runtime.aiLadderTraversalEdgeId = edge.id;
      liveObject.runtime.aiTraversalCooldownUntil = now + SWORDSMAN_AI_TRAVERSAL_COOLDOWN_MS;
    }

    const roomOrigin = this.options.getRoomOrigin(room.coordinates);
    const ladderX = edge.ladderX ?? edge.setupX;
    const localCenterX = body.center.x - roomOrigin.x;
    const localBottom = body.bottom - roomOrigin.y;
    const deltaX = ladderX - localCenterX;
    const targetBottom = targetNode.topY;
    const climbDirectionY = edge.type === 'ladder-up' ? -1 : 1;
    const reachedTarget =
      climbDirectionY < 0
        ? localBottom <= targetBottom + SWORDSMAN_AI_LADDER_FINISH_TOLERANCE_PX
        : localBottom >= targetBottom - SWORDSMAN_AI_LADDER_FINISH_TOLERANCE_PX;

    if (reachedTarget) {
      this.stopSwordsmanLadderTraversal(liveObject, body);
      body.setVelocityY(0);
      body.setVelocityX(
        Phaser.Math.Clamp(
          (edge.targetX - localCenterX) * 10,
          -SWORDSMAN_AI_LADDER_ALIGN_SPEED,
          SWORDSMAN_AI_LADDER_ALIGN_SPEED,
        ),
      );
      this.playSwordsmanAnimation(liveObject, this.getEnemyAnimationKey(liveObject, 'idle'));
      return true;
    }

    body.setAllowGravity(false);
    body.setVelocityX(
      Phaser.Math.Clamp(
        deltaX * 12,
        -SWORDSMAN_AI_LADDER_ALIGN_SPEED,
        SWORDSMAN_AI_LADDER_ALIGN_SPEED,
      ),
    );
    body.setVelocityY(climbDirectionY * SWORDSMAN_AI_LADDER_CLIMB_SPEED);
    const facingDirectionX =
      Math.abs(deltaX) > SWORDSMAN_AI_LADDER_ATTACH_TOLERANCE_PX
        ? (deltaX > 0 ? 1 : -1)
        : decision.directionX;
    liveObject.runtime.directionX = facingDirectionX;
    this.applySwordsmanFacing(liveObject, body, facingDirectionX);
    this.playSwordsmanAnimation(liveObject, this.getEnemyAnimationKey(liveObject, 'ladder-climb'));
    return true;
  }

  private tryApplySwordsmanTraversalImpulse(
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
    decision: SwordsmanTraversalDecision | null,
  ): boolean {
    if (!decision || this.options.getCurrentTime() < liveObject.runtime.aiTraversalCooldownUntil) {
      return false;
    }

    const onFloor = body.blocked.down || body.touching.down;
    if (decision.intent === 'jump-up' && onFloor) {
      body.setVelocityX(decision.jumpVelocityX * SWORDSMAN_AI_JUMP_VELOCITY_X);
      body.setVelocityY(decision.jumpVelocityY * Math.abs(SWORDSMAN_AI_JUMP_VELOCITY_Y));
      this.startSwordsmanTraversalAttempt(liveObject, decision, body);
      liveObject.runtime.directionX = decision.directionX;
      liveObject.runtime.aiTraversalCooldownUntil =
        this.options.getCurrentTime() + SWORDSMAN_AI_TRAVERSAL_COOLDOWN_MS;
      this.applySwordsmanFacing(liveObject, body, liveObject.runtime.directionX, { force: true });
      this.playSwordsmanAnimation(liveObject, this.getEnemyAnimationKey(liveObject, 'jump-rise'));
      return true;
    }

    const wallContactSide = this.getSwordsmanWallContactSide(body);
    if (
      decision.intent === 'wall-jump' &&
      !onFloor &&
      wallContactSide !== 0 &&
      wallContactSide === -decision.directionX
    ) {
      body.setVelocityX(decision.jumpVelocityX * SWORDSMAN_AI_WALL_JUMP_VELOCITY_X);
      body.setVelocityY(decision.jumpVelocityY * Math.abs(SWORDSMAN_AI_WALL_JUMP_VELOCITY_Y));
      this.startSwordsmanTraversalAttempt(liveObject, decision, body);
      liveObject.runtime.directionX = decision.directionX;
      liveObject.runtime.aiTraversalCooldownUntil =
        this.options.getCurrentTime() + SWORDSMAN_AI_TRAVERSAL_COOLDOWN_MS;
      this.applySwordsmanFacing(liveObject, body, liveObject.runtime.directionX, { force: true });
      this.playSwordsmanAnimation(liveObject, this.getEnemyAnimationKey(liveObject, 'jump-rise'));
      return true;
    }

    return false;
  }

  private maybeStartSwordsmanDropDownTraversalAttempt(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
    decision: SwordsmanTraversalDecision | null,
    now: number,
  ): void {
    if (
      !decision ||
      decision.intent !== 'drop-down' ||
      !decision.allowEdgeDrop ||
      liveObject.runtime.aiActiveTraversalEdgeId ||
      now < liveObject.runtime.aiTraversalCooldownUntil
    ) {
      return;
    }

    const onFloor = body.blocked.down || body.touching.down;
    if (!onFloor) {
      return;
    }

    if (this.isSwordsmanSupportedBySolidRuntimeObject(loadedRoom, liveObject, body)) {
      return;
    }

    this.startSwordsmanTraversalAttempt(liveObject, decision, body);
    liveObject.runtime.aiTraversalCooldownUntil = now + SWORDSMAN_AI_TRAVERSAL_COOLDOWN_MS;
  }

  private tryApplySwordsmanCollectJump(
    room: RoomSnapshot,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
    target: SwordsmanObjectiveTarget,
    now: number,
  ): boolean {
    const jump = target.opportunisticJump;
    if (
      !jump ||
      liveObject.runtime.aiActiveTraversalEdgeId ||
      now < liveObject.runtime.aiTraversalCooldownUntil ||
      !(body.blocked.down || body.touching.down)
    ) {
      return false;
    }

    const roomOrigin = this.options.getRoomOrigin(room.coordinates);
    body.setVelocity(jump.velocityX, jump.velocityY);
    this.clearSwordsmanTraversalAttempt(liveObject);
    this.clearSwordsmanFallbackTraversal(liveObject);
    this.clearSwordsmanRouteLoopMemory(liveObject);
    this.clearSwordsmanPlannedRoute(liveObject, 'collect-overhead-jump');
    liveObject.runtime.directionX = jump.directionX;
    liveObject.runtime.aiIntent = 'jump-up';
    liveObject.runtime.aiTargetX = Math.round(jump.targetX - roomOrigin.x);
    liveObject.runtime.aiTraversalEdgeId = null;
    liveObject.runtime.aiTraversalCooldownUntil = now + SWORDSMAN_AI_TRAVERSAL_COOLDOWN_MS;
    this.applySwordsmanFacing(liveObject, body, liveObject.runtime.directionX, { force: true });
    this.playSwordsmanAnimation(liveObject, this.getEnemyAnimationKey(liveObject, 'jump-rise'));
    return true;
  }

  private resetSwordsmanTraversalMemory(liveObject: LoadedRoomObject): void {
    liveObject.runtime.aiTraversalBlockedEdges = [];
    this.clearSwordsmanTraversalAttempt(liveObject);
    this.clearSwordsmanFallbackTraversal(liveObject);
    this.clearSwordsmanRouteLoopMemory(liveObject);
    this.clearSwordsmanPlannedRoute(liveObject, null);
    this.clearSwordsmanCollectRoute(liveObject);
    liveObject.runtime.aiPlannerFallback = false;
    liveObject.runtime.aiPlannerPlanMs = 0;
    liveObject.runtime.aiPlannerExpandedStates = 0;
    liveObject.runtime.aiPlannerSimulatedEdges = 0;
    liveObject.runtime.aiTraversalLastBlockReason = null;
  }

  private resetSwordsmanFacingMemory(
    liveObject: LoadedRoomObject,
    directionX: number,
  ): void {
    const facingDirectionX = directionX >= 0 ? 1 : -1;
    liveObject.runtime.aiFacingDirectionX = facingDirectionX;
    liveObject.runtime.aiFacingLastFlipAt = this.options.getCurrentTime();
    liveObject.runtime.aiFacingLastFlipX = liveObject.sprite.x;
  }

  private applySwordsmanFacing(
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body | null,
    desiredDirectionX: number,
    options: {
      force?: boolean;
    } = {},
  ): void {
    if (desiredDirectionX !== 0) {
      const facingDirectionX = desiredDirectionX > 0 ? 1 : -1;
      if (facingDirectionX !== liveObject.runtime.aiFacingDirectionX) {
        const now = this.options.getCurrentTime();
        const currentX = body?.center.x ?? liveObject.sprite.x;
        const recentlyFlipped =
          now <
          liveObject.runtime.aiFacingLastFlipAt + SWORDSMAN_AI_FACING_FLIP_MIN_INTERVAL_MS;
        const barelyMoved =
          Math.abs(currentX - liveObject.runtime.aiFacingLastFlipX) <
          SWORDSMAN_AI_FACING_FLIP_MIN_TRAVEL_PX;
        if (options.force || !recentlyFlipped || !barelyMoved) {
          liveObject.runtime.aiFacingDirectionX = facingDirectionX;
          liveObject.runtime.aiFacingLastFlipAt = now;
          liveObject.runtime.aiFacingLastFlipX = currentX;
        }
      }
    }

    this.applyDirectionalFacing(
      liveObject.sprite,
      liveObject.config,
      liveObject.runtime.aiFacingDirectionX,
    );
  }

  private clearSwordsmanTraversalAttempt(liveObject: LoadedRoomObject): void {
    liveObject.runtime.aiLadderTraversalEdgeId = null;
    liveObject.runtime.aiActiveTraversalEdgeId = null;
    liveObject.runtime.aiActiveTraversalNextNodeId = null;
    liveObject.runtime.aiActiveTraversalStartedAt = 0;
    liveObject.runtime.aiActiveTraversalStartBottom = 0;
  }

  private clearSwordsmanFallbackTraversal(liveObject: LoadedRoomObject): void {
    liveObject.runtime.aiFallbackTraversalEdgeId = null;
    liveObject.runtime.aiFallbackTraversalSegmentId = null;
    liveObject.runtime.aiFallbackTraversalLastProgressAt = 0;
    liveObject.runtime.aiFallbackTraversalBestMetric = Number.POSITIVE_INFINITY;
  }

  private clearSwordsmanRouteLoopMemory(liveObject: LoadedRoomObject): void {
    liveObject.runtime.aiRouteLoopSignature = null;
    liveObject.runtime.aiRouteLoopCount = 0;
    liveObject.runtime.aiRouteLoopLastProgressAt = 0;
    liveObject.runtime.aiRouteLoopBestMetric = Number.POSITIVE_INFINITY;
  }

  private clearSwordsmanPlannedRoute(
    liveObject: LoadedRoomObject,
    reason: string | null,
  ): void {
    liveObject.runtime.aiPlannedTraversalEdgeIds = [];
    liveObject.runtime.aiPlannedTraversalTargetNodeId = null;
    liveObject.runtime.aiPlannedTraversalExpiresAt = 0;
    liveObject.runtime.aiPlannedTraversalReason = reason;
  }

  private advanceSwordsmanPlannedRoute(
    liveObject: LoadedRoomObject,
    graph: SwordsmanTraversalGraph,
    currentNodeId: string | null,
  ): void {
    while (liveObject.runtime.aiPlannedTraversalEdgeIds.length > 0 && currentNodeId) {
      const nextEdge = this.getSwordsmanPlannedRouteActiveEdge(liveObject, graph);
      if (!nextEdge) {
        this.clearSwordsmanPlannedRoute(liveObject, 'missing-edge');
        return;
      }
      if (nextEdge.toId !== currentNodeId) {
        break;
      }
      liveObject.runtime.aiPlannedTraversalEdgeIds.shift();
      liveObject.runtime.aiPlannedTraversalReason = 'advance-route';
    }

    if (liveObject.runtime.aiPlannedTraversalEdgeIds.length === 0 && currentNodeId) {
      this.clearSwordsmanPlannedRoute(liveObject, 'route-complete');
    }
  }

  private getSwordsmanPlannedRouteActiveEdge(
    liveObject: LoadedRoomObject,
    graph: SwordsmanTraversalGraph,
  ): SwordsmanTraversalEdge | null {
    const edgeId = liveObject.runtime.aiPlannedTraversalEdgeIds[0] ?? null;
    if (!edgeId) {
      return null;
    }
    return getSwordsmanTraversalEdgeById(graph, edgeId);
  }

  private startSwordsmanTraversalAttempt(
    liveObject: LoadedRoomObject,
    decision: SwordsmanTraversalDecision,
    body: Phaser.Physics.Arcade.Body,
  ): void {
    if (!decision.traversalEdgeId) {
      this.clearSwordsmanTraversalAttempt(liveObject);
      return;
    }

    liveObject.runtime.aiActiveTraversalEdgeId = decision.traversalEdgeId;
    liveObject.runtime.aiActiveTraversalNextNodeId = decision.traversalNextNodeId;
    liveObject.runtime.aiActiveTraversalStartedAt = this.options.getCurrentTime();
    liveObject.runtime.aiActiveTraversalStartBottom = body.bottom;
  }

  private updateSwordsmanTraversalMemory(
    room: RoomSnapshot,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
    now: number,
  ): void {
    liveObject.runtime.aiTraversalBlockedEdges = liveObject.runtime.aiTraversalBlockedEdges.filter(
      (entry) => entry.until > now,
    );

    const activeEdgeId = liveObject.runtime.aiActiveTraversalEdgeId;
    if (!activeEdgeId) {
      return;
    }

    const graph = this.getSwordsmanTraversalGraph(room);
    const activeEdge = getSwordsmanTraversalEdgeById(graph, activeEdgeId);
    const currentNodeId = getSwordsmanTraversalCurrentNodeId(
      graph,
      this.createSwordsmanBodySnapshot(body, this.options.getRoomOrigin(room.coordinates)),
    );
    const nextNodeId = liveObject.runtime.aiActiveTraversalNextNodeId;

    if (!isSwordsmanLadderTraversalEdge(activeEdge) && (body.blocked.up || body.touching.up)) {
      this.blockSwordsmanTraversalEdge(
        liveObject,
        activeEdgeId,
        now,
        this.getSwordsmanTraversalFailureBlockOptions(
          liveObject,
          graph,
          activeEdge,
          'hit-head',
        ),
      );
      return;
    }

    if (isSwordsmanLadderTraversalEdge(activeEdge)) {
      const targetNode = nextNodeId ? graph.nodesById.get(nextNodeId) : null;
      const localBottom = body.bottom - this.options.getRoomOrigin(room.coordinates).y;
      const reachedTarget =
        targetNode?.kind === 'surface' &&
        (activeEdge.type === 'ladder-up'
          ? localBottom <= targetNode.topY + SWORDSMAN_AI_LADDER_FINISH_TOLERANCE_PX
          : localBottom >= targetNode.topY - SWORDSMAN_AI_LADDER_FINISH_TOLERANCE_PX);
      if (nextNodeId && currentNodeId === nextNodeId && reachedTarget) {
        this.stopSwordsmanLadderTraversal(liveObject, body);
        return;
      }

      if (activeEdge.type === 'ladder-up' && (body.blocked.up || body.touching.up)) {
        this.blockSwordsmanTraversalEdge(
          liveObject,
          activeEdgeId,
          now,
          this.getSwordsmanTraversalFailureBlockOptions(
            liveObject,
            graph,
            activeEdge,
            'hit-head',
          ),
        );
        this.stopSwordsmanLadderTraversal(liveObject, body);
        return;
      }

      if (now >= liveObject.runtime.aiActiveTraversalStartedAt + SWORDSMAN_AI_LADDER_RESULT_TIMEOUT_MS) {
        this.blockSwordsmanTraversalEdge(
          liveObject,
          activeEdgeId,
          now,
          this.getSwordsmanTraversalFailureBlockOptions(
            liveObject,
            graph,
            activeEdge,
            'failed-ladder-traversal',
          ),
        );
        this.stopSwordsmanLadderTraversal(liveObject, body);
      }
      return;
    }

    if (
      nextNodeId &&
      currentNodeId === nextNodeId &&
      activeEdge?.type === 'jump-to-wall'
    ) {
      this.clearSwordsmanTraversalAttempt(liveObject);
      return;
    }

    const activeTraversalGraceMs =
      activeEdge?.type === 'drop-down'
        ? SWORDSMAN_AI_DROP_DOWN_RESULT_GRACE_MS
        : SWORDSMAN_AI_JUMP_RESULT_GRACE_MS;
    const activeTraversalGraceElapsed =
      now >= liveObject.runtime.aiActiveTraversalStartedAt + activeTraversalGraceMs;

    const onFloor = body.blocked.down || body.touching.down;
    if (!onFloor || !activeTraversalGraceElapsed) {
      return;
    }

    if (nextNodeId) {
      if (currentNodeId === nextNodeId) {
        this.clearSwordsmanTraversalAttempt(liveObject);
        return;
      }
      this.blockSwordsmanTraversalEdge(
        liveObject,
        activeEdgeId,
        now,
        this.getSwordsmanTraversalFailureBlockOptions(
          liveObject,
          graph,
          activeEdge,
          'missed-traversal-target',
        ),
      );
      return;
    }

    const verticalRise = liveObject.runtime.aiActiveTraversalStartBottom - body.bottom;
    if (verticalRise >= SWORDSMAN_AI_JUMP_SUCCESS_RISE_PX) {
      this.clearSwordsmanTraversalAttempt(liveObject);
      return;
    }

    this.blockSwordsmanTraversalEdge(
      liveObject,
      activeEdgeId,
      now,
      this.getSwordsmanTraversalFailureBlockOptions(
        liveObject,
        graph,
        activeEdge,
        'failed-traversal',
      ),
    );
  }

  private getSwordsmanTraversalFailureBlockOptions(
    liveObject: LoadedRoomObject,
    graph: SwordsmanTraversalGraph,
    edge: SwordsmanTraversalEdge | null,
    clearReason: string,
  ): {
    durationMs?: number;
    clearReason?: string | null;
    preserveRouteLoopMemory?: boolean;
    relatedEdgeIds?: string[];
    clearCollectRoute?: boolean;
  } {
    if (this.getSwordsmanObjectiveMode(liveObject) !== 'collect') {
      return { clearReason };
    }

    return {
      clearReason,
      clearCollectRoute: true,
      ...(edge?.type === 'wall-jump'
        ? {
            durationMs: SWORDSMAN_AI_COLLECT_FAILED_WALL_ROUTE_BLOCK_MS,
            relatedEdgeIds: this.getSwordsmanRelatedWallRouteEdgeIds(graph, edge),
          }
        : {}),
    };
  }

  private getSwordsmanRelatedWallRouteEdgeIds(
    graph: SwordsmanTraversalGraph,
    edge: SwordsmanTraversalEdge,
  ): string[] {
    const relatedEdgeIds = new Set<string>();
    if (edge.type === 'wall-jump') {
      for (const candidate of graph.edgesById.values()) {
        if (candidate.type === 'jump-to-wall' && candidate.toId === edge.fromId) {
          relatedEdgeIds.add(candidate.id);
        }
      }
    }

    return Array.from(relatedEdgeIds);
  }

  private blockSwordsmanTraversalEdge(
    liveObject: LoadedRoomObject,
    edgeId: string,
    now: number,
    options: {
      durationMs?: number;
      clearReason?: string | null;
      preserveRouteLoopMemory?: boolean;
      relatedEdgeIds?: string[];
      clearCollectRoute?: boolean;
    } = {},
  ): void {
    liveObject.runtime.aiTraversalLastBlockReason = options.clearReason ?? 'blocked-edge';
    const defaultDurationMs =
      this.getSwordsmanObjectiveMode(liveObject) === 'collect'
        ? SWORDSMAN_AI_COLLECT_FAILED_TRAVERSAL_BLOCK_MS
        : SWORDSMAN_AI_FAILED_TRAVERSAL_BLOCK_MS;
    const until = now + (options.durationMs ?? defaultDurationMs);
    const edgeIdsToBlock = Array.from(new Set([edgeId, ...(options.relatedEdgeIds ?? [])]));
    for (const blockedEdgeId of edgeIdsToBlock) {
      const existing = liveObject.runtime.aiTraversalBlockedEdges.find(
        (entry) => entry.edgeId === blockedEdgeId,
      );
      if (existing) {
        existing.until = Math.max(existing.until, until);
      } else {
        liveObject.runtime.aiTraversalBlockedEdges.push({ edgeId: blockedEdgeId, until });
      }
    }
    if (
      edgeIdsToBlock.some((blockedEdgeId) =>
        liveObject.runtime.aiPlannedTraversalEdgeIds.includes(blockedEdgeId),
      )
    ) {
      this.clearSwordsmanPlannedRoute(liveObject, options.clearReason ?? 'blocked-edge');
    }
    if (options.clearCollectRoute) {
      this.clearSwordsmanCollectRoute(liveObject);
    }
    this.clearSwordsmanTraversalAttempt(liveObject);
    if (!options.preserveRouteLoopMemory) {
      this.clearSwordsmanRouteLoopMemory(liveObject);
    }
  }

  private maybeBlockSwordsmanFallbackRoute(
    room: RoomSnapshot,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
    decision: SwordsmanTraversalDecision | null,
    now: number,
  ): boolean {
    const fallbackEdgeId = decision?.traversalEdgeId ?? null;
    if (
      !decision ||
      !fallbackEdgeId ||
      !decision.currentSegmentId ||
      (decision.intent !== 'same-platform' && decision.intent !== 'drop-down') ||
      !(body.blocked.down || body.touching.down)
    ) {
      return false;
    }

    if (this.isSwordsmanLadderTraversalDecision(room, decision)) {
      this.clearSwordsmanFallbackTraversal(liveObject);
      return false;
    }

    if (
      liveObject.runtime.aiFallbackTraversalEdgeId !== fallbackEdgeId ||
      liveObject.runtime.aiFallbackTraversalSegmentId !== decision.currentSegmentId
    ) {
      return false;
    }

    const progressMetric = this.measureSwordsmanFallbackProgressMetric(
      room,
      body,
      decision,
    );
    if (progressMetric === null) {
      return false;
    }

    if (
      progressMetric <=
      liveObject.runtime.aiFallbackTraversalBestMetric - SWORDSMAN_AI_FALLBACK_PROGRESS_EPSILON_PX
    ) {
      return false;
    }

    if (now < liveObject.runtime.aiFallbackTraversalLastProgressAt + SWORDSMAN_AI_FALLBACK_STALL_BLOCK_MS) {
      return false;
    }

    if (!fallbackEdgeId) {
      return false;
    }

    this.blockSwordsmanTraversalEdge(liveObject, fallbackEdgeId, now);
    this.clearSwordsmanFallbackTraversal(liveObject);
    return true;
  }

  private trackSwordsmanFallbackRoute(
    room: RoomSnapshot,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
    decision: SwordsmanTraversalDecision | null,
    now: number,
  ): void {
    const fallbackEdgeId = decision?.traversalEdgeId ?? null;
    if (
      !decision ||
      !fallbackEdgeId ||
      !decision.currentSegmentId ||
      (decision.intent !== 'same-platform' && decision.intent !== 'drop-down') ||
      !(body.blocked.down || body.touching.down)
    ) {
      this.clearSwordsmanFallbackTraversal(liveObject);
      return;
    }

    if (this.isSwordsmanLadderTraversalDecision(room, decision)) {
      this.clearSwordsmanFallbackTraversal(liveObject);
      return;
    }

    if (
      liveObject.runtime.aiFallbackTraversalEdgeId !== fallbackEdgeId ||
      liveObject.runtime.aiFallbackTraversalSegmentId !== decision.currentSegmentId
    ) {
      const progressMetric = this.measureSwordsmanFallbackProgressMetric(room, body, decision);
      liveObject.runtime.aiFallbackTraversalEdgeId = fallbackEdgeId;
      liveObject.runtime.aiFallbackTraversalSegmentId = decision.currentSegmentId;
      liveObject.runtime.aiFallbackTraversalLastProgressAt = now;
      liveObject.runtime.aiFallbackTraversalBestMetric = progressMetric ?? Number.POSITIVE_INFINITY;
      return;
    }

    const progressMetric = this.measureSwordsmanFallbackProgressMetric(room, body, decision);
    if (
      progressMetric !== null &&
      progressMetric <=
      liveObject.runtime.aiFallbackTraversalBestMetric - SWORDSMAN_AI_FALLBACK_PROGRESS_EPSILON_PX
    ) {
      liveObject.runtime.aiFallbackTraversalLastProgressAt = now;
      liveObject.runtime.aiFallbackTraversalBestMetric = progressMetric;
    }
  }

  private updateSwordsmanRouteLoopMemory(
    room: RoomSnapshot,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
    decision: SwordsmanTraversalDecision | null,
    now: number,
  ): boolean {
    const activeDecision = decision;
    const signature = this.buildSwordsmanRouteLoopSignature(activeDecision);
    const progressMetric = activeDecision?.traversalEdgeId
      ? this.measureSwordsmanFallbackProgressMetric(room, body, activeDecision)
      : null;
    if (this.isSwordsmanLadderTraversalDecision(room, activeDecision)) {
      this.clearSwordsmanRouteLoopMemory(liveObject);
      return false;
    }
    if (
      !activeDecision ||
      !signature ||
      !activeDecision.traversalEdgeId ||
      liveObject.runtime.aiActiveTraversalEdgeId ||
      !(body.blocked.down || body.touching.down) ||
      (activeDecision.intent !== 'same-platform' && activeDecision.intent !== 'drop-down')
    ) {
      this.clearSwordsmanRouteLoopMemory(liveObject);
      return false;
    }

    if (liveObject.runtime.aiRouteLoopSignature !== signature) {
      liveObject.runtime.aiRouteLoopSignature = signature;
      liveObject.runtime.aiRouteLoopCount = 0;
      liveObject.runtime.aiRouteLoopLastProgressAt = now;
      liveObject.runtime.aiRouteLoopBestMetric = progressMetric ?? Number.POSITIVE_INFINITY;
      return false;
    }

    if (
      progressMetric !== null &&
      progressMetric <=
        liveObject.runtime.aiRouteLoopBestMetric - SWORDSMAN_AI_FALLBACK_PROGRESS_EPSILON_PX
    ) {
      liveObject.runtime.aiRouteLoopLastProgressAt = now;
      liveObject.runtime.aiRouteLoopBestMetric = progressMetric;
      return false;
    }

    if (now < liveObject.runtime.aiRouteLoopLastProgressAt + SWORDSMAN_AI_ROUTE_LOOP_STALL_MS) {
      return false;
    }

    liveObject.runtime.aiRouteLoopCount += 1;
    liveObject.runtime.aiRouteLoopLastProgressAt = now;

    if (
      liveObject.runtime.aiRouteLoopCount < SWORDSMAN_AI_ROUTE_LOOP_REPEAT_LIMIT
    ) {
      return false;
    }

    this.blockSwordsmanTraversalEdge(liveObject, activeDecision.traversalEdgeId, now, {
      durationMs: SWORDSMAN_AI_ROUTE_LOOP_BLOCK_MS,
      clearReason: 'blocked-repeated-route',
      preserveRouteLoopMemory: true,
    });
    return true;
  }

  private isSwordsmanLadderTraversalDecision(
    room: RoomSnapshot,
    decision: SwordsmanTraversalDecision | null,
  ): boolean {
    if (!decision?.traversalEdgeId) {
      return false;
    }

    return isSwordsmanLadderTraversalEdge(
      getSwordsmanTraversalEdgeById(this.getSwordsmanTraversalGraph(room), decision.traversalEdgeId),
    );
  }

  private buildSwordsmanRouteLoopSignature(
    decision: SwordsmanTraversalDecision | null,
  ): string | null {
    if (!decision?.currentSegmentId || !decision.targetSegmentId) {
      return null;
    }

    return `${decision.currentSegmentId}->${decision.targetSegmentId}`;
  }

  private measureSwordsmanFallbackProgressMetric(
    room: RoomSnapshot,
    body: Phaser.Physics.Arcade.Body,
    decision: SwordsmanTraversalDecision,
  ): number | null {
    const edgeId = decision.traversalEdgeId;
    if (!edgeId) {
      return null;
    }

    const edge = getSwordsmanTraversalEdgeById(this.getSwordsmanTraversalGraph(room), edgeId);
    if (!edge) {
      return null;
    }

    const snapshot = this.createSwordsmanBodySnapshot(
      body,
      this.options.getRoomOrigin(room.coordinates),
    );
    const setupReferenceX = snapshot.centerX;
    return Math.abs(edge.setupX - setupReferenceX);
  }

  private getSwordsmanBlockedTraversalEdgeIds(
    liveObject: LoadedRoomObject,
    now: number,
  ): ReadonlySet<string> {
    liveObject.runtime.aiTraversalBlockedEdges = liveObject.runtime.aiTraversalBlockedEdges.filter(
      (entry) => entry.until > now,
    );
    return new Set(liveObject.runtime.aiTraversalBlockedEdges.map((entry) => entry.edgeId));
  }

  private steerSwordsmanInAir(
    room: RoomSnapshot,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
    directionX: -1 | 1,
    targetX: number | null = null,
  ): void {
    const traversalEdgeId =
      liveObject.runtime.aiActiveTraversalEdgeId ?? liveObject.runtime.aiTraversalEdgeId;
    const traversalEdge = traversalEdgeId
      ? getSwordsmanTraversalEdgeById(this.getSwordsmanTraversalGraph(room), traversalEdgeId)
      : null;
    if (traversalEdge?.type === 'drop-down') {
      this.steerSwordsmanDropDownInAir(room, liveObject, body, traversalEdge);
      return;
    }
    const steerDirectionX = this.getSwordsmanAirSteerDirection(
      room,
      body,
      directionX,
      traversalEdgeId ? targetX : null,
    );
    const airSpeed = getSwordsmanTraversalAirSpeed(traversalEdgeId, steerDirectionX, body.velocity.x);
    body.setVelocityX(steerDirectionX * airSpeed);
    this.applySwordsmanFacing(liveObject, body, steerDirectionX);
    this.playSwordsmanAnimation(
      liveObject,
      body.velocity.y < 0
        ? this.getEnemyAnimationKey(liveObject, 'jump-rise')
        : this.getEnemyAnimationKey(liveObject, 'jump-fall'),
    );
  }

  private steerSwordsmanDropDownInAir(
    room: RoomSnapshot,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
    edge: SwordsmanTraversalEdge,
  ): void {
    const graph = this.getSwordsmanTraversalGraph(room);
    const targetNode = graph.nodesById.get(edge.toId);
    const roomOrigin = this.options.getRoomOrigin(room.coordinates);
    const localCenterX = body.center.x - roomOrigin.x;
    const velocityX =
      targetNode?.kind === 'surface'
        ? getSwordsmanDropDownAirVelocityX(edge, targetNode, localCenterX, body.width)
        : edge.directionX * SWORDSMAN_AI_SPEED;
    body.setVelocityX(velocityX);

    const facingDirectionX =
      Math.abs(velocityX) <= 0.01
        ? liveObject.runtime.directionX
        : (velocityX > 0 ? 1 : -1);
    this.applySwordsmanFacing(liveObject, body, facingDirectionX);
    this.playSwordsmanAnimation(
      liveObject,
      body.velocity.y < 0
        ? this.getEnemyAnimationKey(liveObject, 'jump-rise')
        : this.getEnemyAnimationKey(liveObject, 'jump-fall'),
    );
  }

  private getSwordsmanAirSteerDirection(
    room: RoomSnapshot,
    body: Phaser.Physics.Arcade.Body,
    fallbackDirectionX: -1 | 1,
    targetX: number | null,
  ): -1 | 1 {
    if (targetX === null) {
      return fallbackDirectionX;
    }

    const roomOrigin = this.options.getRoomOrigin(room.coordinates);
    const localCenterX = body.center.x - roomOrigin.x;
    const deltaX = targetX - localCenterX;
    if (Math.abs(deltaX) <= SWORDSMAN_AI_JUMP_SETUP_APPROACH_TOLERANCE_PX) {
      return fallbackDirectionX;
    }

    return deltaX > 0 ? 1 : -1;
  }

  private startSwordsmanWindup(liveObject: LoadedRoomObject): void {
    const now = this.options.getCurrentTime();
    this.setSwordsmanAiState(liveObject, 'windup');
    liveObject.runtime.nextActionAt = now + (
      isPoliceEnemyObjectId(liveObject.config.id)
        ? POLICE_AI_WINDUP_MS
        : SWORDSMAN_AI_WINDUP_MS
    );
    this.applySwordsmanFacing(liveObject, null, liveObject.runtime.directionX, { force: true });
    this.playSwordsmanAnimation(liveObject, this.getEnemyAnimationKey(liveObject, 'idle'));
  }

  private startSwordsmanAttack(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
  ): void {
    const now = this.options.getCurrentTime();
    const isPolice = isPoliceEnemyObjectId(liveObject.config.id);
    const attackMs = isPolice ? POLICE_AI_ATTACK_MS : SWORDSMAN_AI_ATTACK_MS;
    const cooldownMs = isPolice ? POLICE_AI_COOLDOWN_MS : SWORDSMAN_AI_COOLDOWN_MS;
    this.setSwordsmanAiState(liveObject, 'attack');
    liveObject.runtime.nextActionAt = now + attackMs;
    liveObject.runtime.activatedUntil = now + SWORDSMAN_AI_ATTACK_HIT_END_MS;
    liveObject.runtime.cooldownUntil = now + attackMs + cooldownMs;
    this.applySwordsmanFacing(liveObject, null, liveObject.runtime.directionX, { force: true });
    const attackAnimationKey = this.getEnemyAnimationKey(liveObject, 'sword-slash');
    if (
      isAnimationSafelyPlayable(
        this.options.scene.anims,
        attackAnimationKey,
      )
    ) {
      liveObject.sprite.play(attackAnimationKey, false);
    }
    if (isPolice) {
      this.options.spawnEnemyBullet(loadedRoom, liveObject);
    } else {
      this.applySwordsmanSwordDamage(loadedRoom, liveObject);
    }
  }

  private setSwordsmanAiState(
    liveObject: LoadedRoomObject,
    state: SwordsmanAiState
  ): void {
    if (liveObject.runtime.aiState === state) {
      return;
    }

    liveObject.runtime.aiState = state;
    liveObject.runtime.actionStartedAt = this.options.getCurrentTime();
  }

  private playSwordsmanAnimation(liveObject: LoadedRoomObject, animationKey: string): void {
    if (!isAnimationSafelyPlayable(this.options.scene.anims, animationKey)) {
      return;
    }

    liveObject.sprite.play(animationKey, true);
  }

  private getEnemyAnimationKey(
    liveObject: LoadedRoomObject,
    action: keyof typeof SWORDSMAN_AI_ANIMATION_KEYS | 'reload',
  ): string {
    if (!isPoliceEnemyObjectId(liveObject.config.id)) {
      return action === 'reload'
        ? SWORDSMAN_AI_ANIMATION_KEYS.idle
        : SWORDSMAN_AI_ANIMATION_KEYS[action];
    }

    const policeAction = action === 'sword-slash'
      ? 'shoot'
      : action === 'ladder-climb'
        ? 'run'
        : action === 'land'
          ? 'idle'
          : action;
    return getPoliceAnimationKey(liveObject.config.id, policeAction) ?? liveObject.config.id;
  }

  private applySwordsmanSwordDamage(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
  ): void {
    const playerBody = this.options.getPlayerBody();
    if (!playerBody || !this.swordsmanSwordCanDamagePlayer(loadedRoom, liveObject, playerBody)) {
      return;
    }

    this.options.handlePlayerDeath(`${liveObject.config.name} cut you down.`);
  }

  private swordsmanSwordCanDamagePlayer(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    playerBody: Phaser.Physics.Arcade.Body,
  ): boolean {
    const now = this.options.getCurrentTime();
    if (
      liveObject.runtime.aiState !== 'attack' ||
      now - liveObject.runtime.actionStartedAt < SWORDSMAN_AI_ATTACK_HIT_START_MS ||
      now > liveObject.runtime.activatedUntil
    ) {
      return false;
    }

    return this.canSwordsmanSwordReachTarget(loadedRoom, liveObject, playerBody);
  }

  private canSwordsmanSwordReachTarget(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    targetBody: ArcadeObjectBody,
  ): boolean {
    const targetBounds = getArcadeBodyBounds(targetBody);
    if (!Phaser.Geom.Intersects.RectangleToRectangle(
      this.getSwordsmanAttackBounds(liveObject),
      targetBounds,
    )) {
      return false;
    }

    return !this.isSwordsmanSwordPathBlocked(loadedRoom, liveObject, targetBounds);
  }

  private canPoliceShootTarget(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    targetBody: ArcadeObjectBody,
  ): boolean {
    const body = liveObject.sprite.body as ArcadeObjectBody | null;
    if (!body) {
      return false;
    }

    const bodyBounds = getArcadeBodyBounds(body);
    const targetBounds = getArcadeBodyBounds(targetBody);
    const shotY = body.center.y - 4;
    if (shotY < targetBounds.top - 5 || shotY > targetBounds.bottom + 5) {
      return false;
    }

    const directionX = targetBody.center.x >= body.center.x ? 1 : -1;
    const pathStartX = directionX > 0 ? bodyBounds.right : targetBounds.right;
    const pathEndX = directionX > 0 ? targetBounds.left : bodyBounds.left;
    const left = Math.min(pathStartX, pathEndX);
    const right = Math.max(pathStartX, pathEndX);
    if (right - left <= 1) {
      return true;
    }

    const lane = new Phaser.Geom.Rectangle(left, shotY - 2, right - left, 4);
    if (this.swordsmanSwordLaneHitsSolidTerrain(loadedRoom.room, lane)) {
      return false;
    }

    for (const candidate of loadedRoom.liveObjects) {
      const solidBody = this.getSolidRuntimeObjectBody(candidate, liveObject);
      if (
        solidBody
        && Phaser.Geom.Intersects.RectangleToRectangle(lane, getArcadeBodyBounds(solidBody))
      ) {
        return false;
      }
    }

    return true;
  }

  private isSwordsmanSwordPathBlocked(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    targetBounds: Phaser.Geom.Rectangle,
  ): boolean {
    const lane = this.getSwordsmanSwordPathLane(liveObject, targetBounds);
    if (!lane) {
      return false;
    }

    if (this.swordsmanSwordLaneHitsSolidTerrain(loadedRoom.room, lane)) {
      return true;
    }

    for (const candidate of loadedRoom.liveObjects) {
      const body = this.getSolidRuntimeObjectBody(candidate, liveObject);
      if (!body) {
        continue;
      }

      if (Phaser.Geom.Intersects.RectangleToRectangle(lane, getArcadeBodyBounds(body))) {
        return true;
      }
    }

    return false;
  }

  private getSwordsmanSwordPathLane(
    liveObject: LoadedRoomObject,
    targetBounds: Phaser.Geom.Rectangle,
  ): Phaser.Geom.Rectangle | null {
    const body = liveObject.sprite.body as ArcadeObjectBody | null;
    if (!body) {
      return null;
    }

    const attackBounds = this.getSwordsmanAttackBounds(liveObject);
    const overlapTop = Math.max(attackBounds.top, targetBounds.top);
    const overlapBottom = Math.min(attackBounds.bottom, targetBounds.bottom);
    if (overlapBottom <= overlapTop) {
      return null;
    }

    const bodyBounds = getArcadeBodyBounds(body);
    const directionX = liveObject.runtime.directionX >= 0 ? 1 : -1;
    const pathStartX = directionX > 0 ? bodyBounds.right : targetBounds.right;
    const pathEndX = directionX > 0 ? targetBounds.left : bodyBounds.left;
    const left = Math.min(pathStartX, pathEndX);
    const right = Math.max(pathStartX, pathEndX);
    if (right - left <= 1) {
      return null;
    }

    return new Phaser.Geom.Rectangle(left, overlapTop, right - left, overlapBottom - overlapTop);
  }

  private swordsmanSwordLaneHitsSolidTerrain(
    room: RoomSnapshot,
    lane: Phaser.Geom.Rectangle,
  ): boolean {
    const left = Math.floor(lane.left) + 1;
    const right = Math.ceil(lane.right) - 1;
    if (right < left) {
      return false;
    }

    const top = lane.top + 1;
    const bottom = lane.bottom - 1;
    const sampleYs = [
      lane.centerY,
      Phaser.Math.Clamp(top, lane.top, lane.bottom),
      Phaser.Math.Clamp(bottom, lane.top, lane.bottom),
    ];
    const sampleAtX = (x: number): boolean => {
      for (const y of sampleYs) {
        if (this.hasSolidTerrainAtWorldPoint(room, x, y)) {
          return true;
        }
      }
      return false;
    };

    for (let x = left; x <= right; x += SWORDSMAN_AI_SWORD_LOS_STEP_PX) {
      if (sampleAtX(x)) {
        return true;
      }
    }

    return sampleAtX(right);
  }

  private hasSolidSupportAhead(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
    directionX: number,
    leadPx = 4,
  ): boolean {
    const probeX = body.center.x + directionX * (body.halfWidth + leadPx);
    const probeY = body.bottom + 2;
    return (
      this.hasSolidTerrainAtWorldPoint(loadedRoom.room, probeX, probeY) ||
      this.solidRuntimeObjectContainsPoint(loadedRoom, liveObject, probeX, probeY)
    );
  }

  private isSwordsmanSupportedBySolidRuntimeObject(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
  ): boolean {
    const probeY = body.bottom + 2;
    return [body.left + 1, body.center.x, body.right - 1].some((probeX) =>
      this.solidRuntimeObjectContainsPoint(loadedRoom, liveObject, probeX, probeY)
    );
  }

  private solidRuntimeObjectContainsPoint(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    excludedObject: LoadedRoomObject,
    x: number,
    y: number,
  ): boolean {
    for (const candidate of loadedRoom.liveObjects) {
      const body = this.getSolidRuntimeObjectBody(candidate, excludedObject);
      if (!body) {
        continue;
      }

      const bounds = getArcadeBodyBounds(body);
      if (x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
        return true;
      }
    }

    return false;
  }

  private getSolidRuntimeObjectBody(
    candidate: LoadedRoomObject,
    excludedObject: LoadedRoomObject,
  ): ArcadeObjectBody | null {
    if (
      candidate === excludedObject ||
      !candidate.sprite.active ||
      !candidate.sprite.body ||
      !objectCollidesWithWorld(candidate.config) ||
      !isSolidRuntimeObjectConfig(candidate.config)
    ) {
      return null;
    }

    const body = candidate.sprite.body as ArcadeObjectBody;
    return body.enable ? body : null;
  }

  private holdGroundedSwordsmanAttackBody(body: Phaser.Physics.Arcade.Body): void {
    if (body.blocked.down || body.touching.down) {
      body.setVelocityY(0);
    }
  }

  private getSwordsmanAttackBounds(liveObject: LoadedRoomObject): Phaser.Geom.Rectangle {
    const body = liveObject.sprite.body as ArcadeObjectBody | null;
    const bounds = body
      ? getArcadeBodyBounds(body)
      : new Phaser.Geom.Rectangle(
          liveObject.sprite.x - liveObject.config.bodyWidth * 0.5,
          liveObject.sprite.y - liveObject.config.bodyHeight * 0.5,
          liveObject.config.bodyWidth,
          liveObject.config.bodyHeight,
        );
    const directionX = liveObject.runtime.directionX >= 0 ? 1 : -1;
    const width = 32;
    const height = 24;
    const left = directionX > 0 ? bounds.centerX + 4 : bounds.centerX - width - 4;

    return new Phaser.Geom.Rectangle(
      left,
      bounds.centerY - height * 0.5,
      width,
      height,
    );
  }


  private resetDynamicObjectIfOutOfBounds(
    room: RoomSnapshot,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
  ): boolean {
    return this.options.resetDynamicObjectIfOutOfBounds(room, liveObject, body);
  }

  private collectLiveObject(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    options: { collector?: 'player' | 'enemy' } = {},
  ): void {
    this.options.collectLiveObject(loadedRoom, liveObject, options);
  }

  private maybeReverseGroundEnemy(
    room: RoomSnapshot,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
  ): void {
    this.options.maybeReverseGroundEnemy(room, liveObject, body);
  }

  private applyDirectionalFacing(
    sprite: Phaser.GameObjects.Sprite,
    config: GameObjectConfig,
    directionX: number,
  ): void {
    if (!config.facingDirection || directionX === 0) {
      return;
    }

    const facingRight = directionX > 0;
    sprite.setFlipX(config.facingDirection === 'right' ? !facingRight : facingRight);
  }

  private hasSolidTerrainAtWorldPoint(room: RoomSnapshot, worldX: number, worldY: number): boolean {
    const roomOrigin = this.options.getRoomOrigin(room.coordinates);
    const localX = Math.floor((worldX - roomOrigin.x) / TILE_SIZE);
    const localY = Math.floor((worldY - roomOrigin.y) / TILE_SIZE);

    if (localX < 0 || localX >= ROOM_WIDTH || localY < 0 || localY >= ROOM_HEIGHT) {
      return false;
    }

    const localPixelY = worldY - roomOrigin.y - localY * TILE_SIZE;
    return terrainTileCollidesAtLocalPixel(room, localX, localY, localPixelY);
  }

  private getDynamicBody(sprite: Phaser.GameObjects.Sprite): Phaser.Physics.Arcade.Body | null {
    const body = sprite.body as ArcadeObjectBody | null;
    return isDynamicArcadeBody(body) ? body : null;
  }
}
