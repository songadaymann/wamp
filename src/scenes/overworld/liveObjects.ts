import Phaser from 'phaser';
import type { SfxCue } from '../../audio/sfx';
import {
  canObjectBeStoredInContainer,
  decodeTileDataValue,
  getObjectById,
  getObjectDefaultFrame,
  getObjectDisplayOffset,
  getObjectDisplayScale,
  getObjectRuntimeBodyOffset,
  objectCollidesWithWorld,
  placedObjectLayerAllowsRuntimeCollision,
  isDynamicRuntimeObjectConfig,
  isBlockSwitchObjectId,
  isSwitchBlockObjectId,
  isMovingPlatformEndpointObjectId,
  isMovingPlatformObjectId,
  isPushableObjectConfig,
  isSolidRuntimeObjectConfig,
  getPlacedObjectLayer,
  getSpecialTileKindForGid,
  LAYER_NAMES,
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_WIDTH,
  TILE_SIZE,
  type GameObjectConfig,
  type LayerName,
  type SpecialTileKind,
} from '../../config';
import type { RoomCoordinates, RoomSnapshot } from '../../persistence/roomModel';
import { getEditorObjectConfigById } from '../../customSprites/objectConfig';
import { ensureCustomSpriteTexture } from '../../customSprites/registry';
import {
  SWORDSMAN_AI_OBJECT_ID,
  type SwordsmanAiState,
} from '../../enemies/swordsmanAi';
import {
  getPlacedPoliceBehaviorMode,
  getPlacedPolicePatrolShoots,
  isPoliceEnemyObjectId,
  type PoliceBehaviorMode,
} from '../../enemies/policeEnemy';
import type {
  SwordsmanDefeatMode,
  SwordsmanObjectiveMode,
} from '../../enemies/swordsmanObjectives';
import {
  type SwordsmanTraversalIntent,
} from '../../enemies/swordsmanTraversal';
import type { SwordsmanTraversalPlannerMode } from '../../enemies/swordsmanRobustPlanner';
import type { LoadedFullRoom } from './worldStreaming';
import { terrainTileCollidesAtLocalPixel } from './terrainCollision';
import {
  bodyIsBlockedInGravityDirection,
  getBodyVelocityAlongVector,
  getGravityAngle,
  getGravityRightVector,
  getGravityVector,
  setBodyVelocityAlongVector,
  type DirectionVector,
  type PlayerGravityDirection,
  type SpecialTilePlayerEnvironment,
} from './specialTiles';
import {
  getArcadeBodyBounds,
  isDynamicArcadeBody,
} from './liveObjects/bodies';
import type { ArcadeObjectBody } from './liveObjects/bodies';
import {
  createLiveObjectRuntimeState,
  getInitialDirectionX,
} from './liveObjects/objectFactory';
import { isAnimationSafelyPlayable } from './liveObjects/animationReadiness';
import { collectLiveObject as collectLiveObjectWithFx } from './liveObjects/collection';
import {
  canActorTriggerBlockSwitchByContact,
} from './liveObjects/triggers';
import { LiveObjectTriggerController } from './liveObjects/triggerController';
import { LiveObjectHazardController } from './liveObjects/hazardController';
import { LiveObjectEnemyLifecycleController } from './liveObjects/enemyLifecycle';
import { LiveObjectSwordsmanController } from './liveObjects/swordsmanController';
import {
  getLiveObjectBehavior,
  liveObjectBehaviorCanSleepAtDistance,
  liveObjectBehaviorUpdatesEveryFrame,
  type FlyingEnemyBehavior,
} from './liveObjects/behaviorRegistry';
import { liveObjectBlocksPlayerMovement } from './playerCollisionObjects';
import { carryMovingPlatformRiders } from './liveObjects/movingPlatforms';
import { getPlacedObjectPathTargetIds } from '../../placedObjects/objectPaths';
import { getContainedLiveObjectKey } from './liveObjects/indexing';
import {
  JIMOTHY_ANIMATION_KEYS,
  getPlacedNpcDefeatMode,
  getPlacedNpcMode,
  getPlacedNpcName,
  normalizeNpcCanJumpFall,
  normalizeNpcFriendlyFire,
  normalizeNpcPlayerCollision,
  normalizeNpcPushable,
  type NpcMode,
} from '../../npcs/model';
import {
  LiveObjectNpcController,
  type NpcRuntimeStateSnapshot,
} from './liveObjects/npcController';
import {
  getNpcEnvironmentalObjectInteraction,
} from './liveObjects/npcEnvironment';

export { isDynamicArcadeBody } from './liveObjects/bodies';
export type { ArcadeObjectBody } from './liveObjects/bodies';

interface SwordsmanTraversalBlockState {
  edgeId: string;
  until: number;
}

type SwordsmanCollectState = 'sweep' | 'route' | 'jump';

export interface LoadedRoomObjectRuntimeState {
  baseX: number;
  baseY: number;
  previousX: number;
  previousY: number;
  gravityDirection: PlayerGravityDirection;
  gravityRoomId: string | null;
  inWater: boolean;
  specialTileWindX: -1 | 0 | 1;
  specialTileOnIce: boolean;
  specialTileOnSticky: boolean;
  specialTileOnBounce: boolean;
  specialTileOnDamage: boolean;
  initialDirectionX: number;
  directionX: number;
  movingPlatformTargetIndex: number;
  movingPlatformPathDirection: -1 | 1;
  aiFacingDirectionX: number;
  aiFacingLastFlipAt: number;
  aiFacingLastFlipX: number;
  elapsedMs: number;
  nextActionAt: number;
  actionStartedAt: number;
  aiTraversalCooldownUntil: number;
  cooldownUntil: number;
  activatedUntil: number;
  aiState: SwordsmanAiState | null;
  aiObjectiveMode: SwordsmanObjectiveMode | null;
  aiDefeatMode: SwordsmanDefeatMode | null;
  aiIntent: SwordsmanTraversalIntent | null;
  aiTargetX: number | null;
  aiCurrentSegmentId: string | null;
  aiTargetSegmentId: string | null;
  aiTraversalEdgeId: string | null;
  aiTraversalBlockedEdges: SwordsmanTraversalBlockState[];
  aiTraversalLastBlockReason: string | null;
  aiActiveTraversalEdgeId: string | null;
  aiActiveTraversalNextNodeId: string | null;
  aiActiveTraversalStartedAt: number;
  aiActiveTraversalStartBottom: number;
  aiLadderTraversalEdgeId: string | null;
  aiFallbackTraversalEdgeId: string | null;
  aiFallbackTraversalSegmentId: string | null;
  aiFallbackTraversalLastProgressAt: number;
  aiFallbackTraversalBestMetric: number;
  aiRouteLoopSignature: string | null;
  aiRouteLoopCount: number;
  aiRouteLoopLastProgressAt: number;
  aiRouteLoopBestMetric: number;
  aiPlannerMode: SwordsmanTraversalPlannerMode | null;
  aiPlannerFallback: boolean;
  aiPlannerPlanMs: number;
  aiPlannerExpandedStates: number;
  aiPlannerSimulatedEdges: number;
  aiPlannedTraversalEdgeIds: string[];
  aiPlannedTraversalTargetNodeId: string | null;
  aiPlannedTraversalExpiresAt: number;
  aiPlannedTraversalReason: string | null;
  aiCollectState: SwordsmanCollectState | null;
  aiCollectRouteTargetNodeId: string | null;
  aiCollectRouteExpiresAt: number;
  aiCollectRouteScore: number | null;
  aiCollectRouteValue: number;
  aiCollectRoutePenalty: number;
  policeBehaviorMode: PoliceBehaviorMode | null;
  policePatrolShoots: boolean;
  npcMode: NpcMode | null;
  npcPushable: boolean;
  npcCanJumpFall: boolean;
  npcPlayerCollision: boolean;
  npcFriendlyFire: boolean;
  npcDefeatMode: SwordsmanDefeatMode | null;
  npcVictorious: boolean;
  npcWalking: boolean;
  npcBounceCooldownUntil: number;
  npcQuicksandUntil: number;
  pressureActive: boolean;
  triggerLatched: boolean;
}

export interface LoadedRoomObject {
  key: string;
  placedInstanceId: string | null;
  linkedTargetRoomId: string | null;
  linkedTargetInstanceId: string | null;
  linkedTargetInstanceIds: string[];
  linkedTargetWorldX: number | null;
  linkedTargetWorldY: number | null;
  containedObjectId: string | null;
  signText: string | null;
  npcName: string | null;
  npcNameLabel: Phaser.GameObjects.Text | null;
  layer: LayerName;
  countsTowardGoals: boolean;
  config: GameObjectConfig;
  sprite: Phaser.GameObjects.Sprite;
  helpers: Phaser.GameObjects.GameObject[];
  interactions: Phaser.Physics.Arcade.Collider[];
  worldColliders: Phaser.Physics.Arcade.Collider[];
  runtime: LoadedRoomObjectRuntimeState;
}

interface OverworldLiveObjectSettings {
  bouncePadVelocity: number;
  bouncePadCooldownMs: number;
  bouncePadActiveMs: number;
  batSpeed: number;
  batWaveAmplitude: number;
  batWaveSpeed: number;
  birdSpeed: number;
  birdWaveAmplitude: number;
  birdWaveSpeed: number;
  crabSpeed: number;
  snakeSpeed: number;
  slimeSpeed: number;
  penguinSpeed: number;
  frogHopSpeed: number;
  frogHopVelocity: number;
  frogHopDelayMs: number;
  cannonFireDelayMs: number;
  cannonBulletSpeed: number;
  cannonBulletLifetimeMs: number;
  tornadoLiftVelocity: number;
  tornadoSideVelocity: number;
  tornadoCooldownMs: number;
  respawnFallDistance: number;
  enemyStompBounceVelocity: number;
}

interface OverworldLiveObjectControllerOptions<TEdgeWall = unknown> {
  scene: Phaser.Scene;
  settings: OverworldLiveObjectSettings;
  getLoadedFullRooms: () => Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>;
  getRoomOrigin: (coordinates: RoomCoordinates) => { x: number; y: number };
  getPlacedObjectRuntimeKey: (
    roomId: string,
    placedObject: RoomSnapshot['placedObjects'][number],
    placedIndex: number
  ) => string;
  isCollectedObjectKey: (key: string) => boolean;
  markCollectedObjectKey: (key: string) => void;
  getPlayer: () => Phaser.GameObjects.GameObject | null;
  getPlayerPickupSensor: () => Phaser.GameObjects.GameObject | null;
  getPlayerBody: () => Phaser.Physics.Arcade.Body | null;
  getConveyorDirectionForBody: (
    body: Phaser.Physics.Arcade.Body,
    gravityDirection: PlayerGravityDirection,
  ) => -1 | 0 | 1;
  getBodyRoomId: (body: Phaser.Physics.Arcade.Body) => string;
  getSpecialTileEnvironmentForBody: (
    body: Phaser.Physics.Arcade.Body,
    currentGravityDirection: PlayerGravityDirection,
  ) => Readonly<SpecialTilePlayerEnvironment>;
  swordsmanTraversalPlannerMode: SwordsmanTraversalPlannerMode;
  isPlayerClimbingLadder: () => boolean;
  isLadderDropRequested: () => boolean;
  isPlayerButtStomping: () => boolean;
  handlePlayerButtStompImpact: (bounceVelocity: number) => void;
  getCurrentTime: () => number;
  addScore: (delta: number) => void;
  onKeyCollected: () => void;
  tryConsumeHeldKey: () => boolean;
  touchQuicksand: () => void;
  grantExternalLaunchGrace: (durationMs: number) => void;
  showTransientStatus: (message: string) => void;
  handlePlayerDeath: (reason: string) => void;
  onEnemyDefeated: (event: {
    roomId: string;
    roomCoordinates: RoomCoordinates;
    enemyName: string;
    instanceId: string | null;
    x: number;
    y: number;
  }) => boolean;
  onNpcDefeated: (event: {
    roomId: string;
    roomCoordinates: RoomCoordinates;
    npcName: string;
    instanceId: string | null;
    x: number;
    y: number;
  }) => void;
  onCollectibleCollected: (event: {
    roomId: string;
    roomCoordinates: RoomCoordinates;
    instanceId: string | null;
    x: number;
    y: number;
  }) => void;
  onEnemyCollectibleCollected: (event: {
    roomId: string;
    roomCoordinates: RoomCoordinates;
    instanceId: string | null;
    x: number;
    y: number;
  }) => void;
  onLiveObjectRemoved: (event: LiveObjectRemovedEvent) => void;
  onRoomSwitchStateChanged: (event: LiveObjectSwitchStateChangedEvent) => void;
  playRoomSfx: (cue: SfxCue, roomCoordinates: RoomCoordinates) => void;
  playEnemyKillFx: (x: number, y: number, roomCoordinates: RoomCoordinates) => void;
  playCollectFx: (
    x: number,
    y: number,
    scoreDelta: number,
    roomCoordinates: RoomCoordinates,
    cue?: SfxCue
  ) => void;
  playBounceFx: (
    x: number,
    y: number,
    roomCoordinates: RoomCoordinates,
    cue?: SfxCue | null
  ) => void;
  playBombExplosionFx: (x: number, y: number, roomCoordinates: RoomCoordinates) => void;
}

const LIVE_OBJECT_CONVEYOR_SPEED = 48;
const LIVE_OBJECT_GRAVITY_ACCELERATION = 700;
const LIVE_OBJECT_MAX_GRAVITY_SPEED = 500;
const LIVE_OBJECT_WATER_GRAVITY_FACTOR = 0.35;
const LIVE_OBJECT_WATER_MAX_GRAVITY_SPEED = 118;
const LIVE_OBJECT_WATER_DAMPING_FACTOR = 0.965;
const LIVE_OBJECT_WIND_ACCELERATION = 980;
const LIVE_OBJECT_WIND_MAX_SPEED = 280;
const BUTT_STOMP_BREAK_BOUNCE_VELOCITY = -150;
const BUTT_STOMP_BREAK_TOP_TOLERANCE_PX = 12;
const BUTT_STOMP_BREAK_MIN_HORIZONTAL_OVERLAP_PX = 3;
const BUTT_STOMP_BREAK_STACK_VERTICAL_GAP_TOLERANCE_PX = 4;
const GROUND_ENEMY_EDGE_SAFE_SPECIAL_TILE_KINDS = new Set<SpecialTileKind>([
  'conveyorLeft',
  'conveyorRight',
  'ice',
  'sticky',
  'bounce',
  'gravityUp',
  'gravityDown',
  'gravityLeft',
  'gravityRight',
  'water',
]);

export interface CreateLiveObjectEntryOptions {
  key: string;
  config: GameObjectConfig;
  x: number;
  y: number;
  facing?: 'left' | 'right';
  layer?: LayerName;
  baseTimeSeed?: number;
  placedInstanceId: string | null;
  linkedTargetRoomId: string | null;
  linkedTargetInstanceId: string | null;
  linkedTargetInstanceIds?: string[];
  linkedTargetWorldX?: number | null;
  linkedTargetWorldY?: number | null;
  containedObjectId: string | null;
  signText: string | null;
  objectiveMode?: SwordsmanObjectiveMode | null;
  defeatMode?: SwordsmanDefeatMode | null;
  policeBehaviorMode?: PoliceBehaviorMode | null;
  policePatrolShoots?: boolean | null;
  npcMode?: NpcMode | null;
  npcPushable?: boolean | null;
  npcCanJumpFall?: boolean | null;
  npcPlayerCollision?: boolean | null;
  npcFriendlyFire?: boolean | null;
  npcName?: string | null;
  npcDefeatMode?: SwordsmanDefeatMode | null;
  countsTowardGoals: boolean;
}

export interface WeaponHitResult {
  roomId: string;
  enemyName: string;
  x: number;
  y: number;
}

export type LiveObjectRemovedReason =
  | 'enemy-defeated'
  | 'npc-defeated'
  | 'collectible-collected'
  | 'enemy-collected'
  | 'object-removed'
  | 'brick-broken'
  | 'crate-broken';

export type LiveObjectExplicitRemovalReason = Extract<
  LiveObjectRemovedReason,
  'object-removed' | 'brick-broken' | 'crate-broken'
>;

export interface LiveObjectRemovedEvent {
  roomId: string;
  roomCoordinates: RoomCoordinates;
  objectKey: string;
  objectId: string;
  instanceId: string | null;
  reason: LiveObjectRemovedReason;
  x: number;
  y: number;
}

export interface LiveObjectSwitchStateChangedEvent {
  roomId: string;
  roomCoordinates: RoomCoordinates;
  active: boolean;
}

interface RoomLiveObjectPartition {
  source: LoadedRoomObject[];
  sourceLength: number;
  updating: LoadedRoomObject[];
  ladders: LoadedRoomObject[];
  ladderRoomBoundsPadding: number;
  ladderSpatialIndex: LiveObjectSpatialIndex | null;
  pushables: LoadedRoomObject[];
  pushableRoomBoundsPadding: number;
  pushableSpatialIndex: LiveObjectSpatialIndex | null;
  runtimeSolids: LoadedRoomObject[];
  runtimeSolidRoomBoundsPadding: number;
  runtimeSolidSpatialIndex: LiveObjectSpatialIndex | null;
  pathTargetsByInstanceId: Map<string, LoadedRoomObject>;
}

interface LiveObjectSpatialBinRange {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface LiveObjectSpatialIndex {
  readonly binsByX: Map<number, Map<number, Set<LoadedRoomObject>>>;
  readonly binRangeByObject: Map<LoadedRoomObject, LiveObjectSpatialBinRange>;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const LIVE_OBJECT_SPATIAL_BIN_SIZE_PX = TILE_SIZE * 4;

export class OverworldLiveObjectController<TEdgeWall = unknown> {
  private readonly triggerController: LiveObjectTriggerController<TEdgeWall>;
  private readonly hazardController: LiveObjectHazardController<TEdgeWall>;
  private readonly swordsmanController: LiveObjectSwordsmanController<TEdgeWall>;
  private readonly npcController: LiveObjectNpcController<TEdgeWall>;
  private readonly enemyLifecycleController: LiveObjectEnemyLifecycleController<TEdgeWall>;
  private readonly liveObjectPartitionsByRoomId = new Map<string, RoomLiveObjectPartition>();
  private readonly liveObjectPartitionByObject = new WeakMap<
    LoadedRoomObject,
    RoomLiveObjectPartition
  >();
  private readonly spatialQueryMarks = new WeakMap<LoadedRoomObject, number>();
  private spatialQueryGeneration = 0;
  private readonly colliderDormancyStates = new WeakMap<
    Phaser.Physics.Arcade.Collider,
    boolean
  >();
  private physicsReconciliationGeneration = 0;
  private readonly distanceSleepingObjects = new WeakSet<LoadedRoomObject>();
  private roomStateEventSuppressionDepth = 0;

  constructor(private readonly options: OverworldLiveObjectControllerOptions<TEdgeWall>) {
    this.triggerController = new LiveObjectTriggerController({
      getLoadedFullRooms: this.options.getLoadedFullRooms,
      getPlayerBody: this.options.getPlayerBody,
      getCurrentTime: this.options.getCurrentTime,
      getRoomOrigin: this.options.getRoomOrigin,
      playRoomSfx: this.options.playRoomSfx,
      playBounceFx: this.options.playBounceFx,
      showTransientStatus: this.options.showTransientStatus,
      tryConsumeHeldKey: this.options.tryConsumeHeldKey,
      createLiveObjectEntry: (loadedRoom, entryOptions) =>
        this.createLiveObjectEntry(loadedRoom, entryOptions),
      removeLiveObject: (loadedRoom, liveObject, reason) =>
        this.removeLiveObject(loadedRoom, liveObject, reason),
      onRoomSwitchStateChanged: (event) => this.emitRoomSwitchStateChanged(event),
      syncWorldObjectColliders: (loadedRooms) => this.syncWorldObjectColliders(loadedRooms),
      syncLiveObjectInteractions: (loadedRooms) => this.syncLiveObjectInteractions(loadedRooms),
    });
    this.hazardController = new LiveObjectHazardController({
      scene: this.options.scene,
      settings: this.options.settings,
      getCurrentTime: this.options.getCurrentTime,
      getRoomOrigin: this.options.getRoomOrigin,
      getPlayer: this.options.getPlayer,
      getPlayerBody: this.options.getPlayerBody,
      grantExternalLaunchGrace: this.options.grantExternalLaunchGrace,
      touchQuicksand: this.options.touchQuicksand,
      handlePlayerDeath: this.options.handlePlayerDeath,
      playBounceFx: this.options.playBounceFx,
      playBombExplosionFx: this.options.playBombExplosionFx,
      showTransientStatus: this.options.showTransientStatus,
      applyDirectionalFacing: (sprite, config, directionX) =>
        this.applyDirectionalFacing(sprite, config, directionX),
      getObjectBodyOffset: (config) => this.getObjectBodyOffset(config),
      removeLiveObject: (loadedRoom, liveObject) =>
        this.removeLiveObject(loadedRoom, liveObject),
      triggerBlockSwitch: (loadedRoom, switchObject) =>
        this.triggerController.triggerBlockSwitch(loadedRoom, switchObject),
      handleNpcHazardContact: (loadedRoom, npc) => {
        this.enemyLifecycleController.defeatNpc(loadedRoom, npc);
      },
    });
    this.npcController = new LiveObjectNpcController({
      scene: this.options.scene,
      getCurrentTime: this.options.getCurrentTime,
      getPlayerBody: this.options.getPlayerBody,
      resetDynamicObjectIfOutOfBounds: (room, liveObject, body) =>
        this.resetDynamicObjectIfOutOfBounds(room, liveObject, body),
      getRoomWorldBounds: (room) => this.getRoomWorldBounds(room),
      applyDirectionalFacing: (sprite, config, directionX) =>
        this.applyDirectionalFacing(sprite, config, directionX),
      hasSolidTerrainAtWorldPoint: (room, worldX, worldY) =>
        this.hasSolidTerrainAtWorldPoint(room, worldX, worldY),
      playBounceFx: (x, y, roomCoordinates) =>
        this.options.playBounceFx(x, y, roomCoordinates),
      bouncePadVelocity: this.options.settings.bouncePadVelocity,
      bouncePadCooldownMs: this.options.settings.bouncePadCooldownMs,
    });
    this.swordsmanController = new LiveObjectSwordsmanController({
      scene: this.options.scene,
      getRoomOrigin: this.options.getRoomOrigin,
      getPlayerBody: this.options.getPlayerBody,
      getCurrentTime: this.options.getCurrentTime,
      isCollectedObjectKey: this.options.isCollectedObjectKey,
      swordsmanTraversalPlannerMode: this.options.swordsmanTraversalPlannerMode,
      handlePlayerDeath: this.options.handlePlayerDeath,
      resetDynamicObjectIfOutOfBounds: (room, liveObject, body) =>
        this.resetDynamicObjectIfOutOfBounds(room, liveObject, body),
      collectLiveObject: (loadedRoom, liveObject, options) =>
        this.collectLiveObject(loadedRoom, liveObject, options),
      maybeReverseGroundEnemy: (room, liveObject, body) =>
        this.maybeReverseGroundEnemy(room, liveObject, body),
      spawnEnemyBullet: (loadedRoom, liveObject) => {
        const body = this.getDynamicBody(liveObject.sprite);
        this.hazardController.spawnEnemyBullet(loadedRoom, liveObject, {
          offsetX: 14 * getObjectDisplayScale(liveObject.config),
          offsetY: body ? body.center.y - liveObject.sprite.y - 4 : 8,
          hitReason: `${liveObject.config.name} shot you.`,
        });
      },
    });
    this.enemyLifecycleController = new LiveObjectEnemyLifecycleController({
      scene: this.options.scene,
      settings: this.options.settings,
      getLoadedFullRooms: this.options.getLoadedFullRooms,
      getRoomOrigin: this.options.getRoomOrigin,
      getPlayer: this.options.getPlayer,
      getPlayerBody: this.options.getPlayerBody,
      addScore: this.options.addScore,
      playEnemyKillFx: this.options.playEnemyKillFx,
      playBounceFx: this.options.playBounceFx,
      showTransientStatus: this.options.showTransientStatus,
      handlePlayerDeath: this.options.handlePlayerDeath,
      onEnemyDefeated: this.options.onEnemyDefeated,
      onNpcDefeated: this.options.onNpcDefeated,
      onLiveObjectRemoved: (event) => this.emitLiveObjectRemoved(event),
      getSwordsmanObjectiveMode: (liveObject) => this.swordsmanController.getObjectiveMode(liveObject),
      getSwordsmanDefeatMode: (liveObject) => this.swordsmanController.getDefeatMode(liveObject),
      swordsmanSwordCanDamagePlayer: (loadedRoom, liveObject, playerBody) =>
        this.swordsmanController.swordCanDamagePlayer(loadedRoom, liveObject, playerBody),
      createLiveObjectEntry: (loadedRoom, entryOptions) =>
        this.createLiveObjectEntry(loadedRoom, entryOptions),
      destroyLiveObjectInteractions: (liveObject) =>
        this.destroyLiveObjectInteractions(liveObject),
      destroyLiveObjectWorldColliders: (liveObject) =>
        this.destroyLiveObjectWorldColliders(liveObject),
      destroyLiveObjectHelpers: (liveObject) =>
        this.destroyLiveObjectHelpers(liveObject),
      syncWorldObjectColliders: (loadedRooms) => this.syncWorldObjectColliders(loadedRooms),
      syncLiveObjectInteractions: (loadedRooms) => this.syncLiveObjectInteractions(loadedRooms),
    });
  }

  resetSwitchStates(): void {
    this.triggerController.resetSwitchStates();
  }

  resetSwitchStateForRoom(roomId: string): void {
    this.triggerController.resetSwitchStateForRoom(roomId);
  }

  setSwitchStateForRoom(roomId: string, active: boolean): void {
    this.withSuppressedRoomStateEvents(() => {
      this.triggerController.setRoomSwitchState(roomId, active);
      for (const loadedRoom of this.options.getLoadedFullRooms()) {
        if (loadedRoom.room.id !== roomId) {
          continue;
        }
        this.triggerController.applySwitchBlockStates(loadedRoom);
      }
      this.syncWorldObjectColliders(this.options.getLoadedFullRooms());
      this.syncLiveObjectInteractions(this.options.getLoadedFullRooms());
    });
  }

  removeLiveObjectByKey(roomId: string, objectKey: string): boolean {
    for (const loadedRoom of this.options.getLoadedFullRooms()) {
      if (loadedRoom.room.id !== roomId) {
        continue;
      }

      const liveObject = loadedRoom.liveObjects.find((candidate) => candidate.key === objectKey) ?? null;
      if (!liveObject) {
        return false;
      }

      this.withSuppressedRoomStateEvents(() => {
        this.removeLiveObject(loadedRoom, liveObject);
      });
      return true;
    }

    return false;
  }

  createLiveObjects(loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>): void {
    this.createLiveObjectsBatch(
      loadedRoom,
      0,
      loadedRoom.room.placedObjects.length,
      false,
    );
    this.finalizeLiveObjectCreation(loadedRoom, false);
  }

  createLiveObjectsBatch(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    startIndex: number,
    endIndex: number,
    dormant: boolean,
  ): number {
    const firstIndex = Phaser.Math.Clamp(
      Math.floor(startIndex),
      0,
      loadedRoom.room.placedObjects.length,
    );
    const lastIndex = Phaser.Math.Clamp(
      Math.ceil(endIndex),
      firstIndex,
      loadedRoom.room.placedObjects.length,
    );
    for (let index = firstIndex; index < lastIndex; index += 1) {
      const placedObject = loadedRoom.room.placedObjects[index];
      const config = getEditorObjectConfigById(placedObject.id);
      if (!config) {
        continue;
      }

      const objectKey = this.options.getPlacedObjectRuntimeKey(loadedRoom.room.id, placedObject, index);
      if (this.options.isCollectedObjectKey(objectKey)) {
        continue;
      }

      const linkedTargetInstanceIds = getPlacedObjectPathTargetIds(placedObject);
      const liveObject = this.createLiveObjectEntry(loadedRoom, {
        key: objectKey,
        config,
        x: placedObject.x,
        y: placedObject.y,
        facing: placedObject.facing,
        layer: placedObject.layer,
        baseTimeSeed: placedObject.x + placedObject.y,
        placedInstanceId: placedObject.instanceId,
        linkedTargetRoomId: linkedTargetInstanceIds.length > 0 ? loadedRoom.room.id : null,
        linkedTargetInstanceId: linkedTargetInstanceIds[0] ?? null,
        linkedTargetInstanceIds,
        linkedTargetWorldX: null,
        linkedTargetWorldY: null,
        containedObjectId: placedObject.containedObjectId ?? null,
        signText: placedObject.signText ?? null,
        objectiveMode: placedObject.swordsmanObjectiveMode ?? null,
        defeatMode: placedObject.swordsmanDefeatMode ?? null,
        policeBehaviorMode: getPlacedPoliceBehaviorMode(placedObject),
        policePatrolShoots: getPlacedPolicePatrolShoots(placedObject),
        npcMode: getPlacedNpcMode(placedObject),
        npcPushable: normalizeNpcPushable(
          placedObject.npcPushable,
          getPlacedNpcMode(placedObject),
        ),
        npcCanJumpFall: normalizeNpcCanJumpFall(
          placedObject.npcCanJumpFall,
          getPlacedNpcMode(placedObject),
        ),
        npcPlayerCollision: normalizeNpcPlayerCollision(
          placedObject.npcPlayerCollision,
        ),
        npcFriendlyFire: normalizeNpcFriendlyFire(placedObject.npcFriendlyFire),
        npcName: getPlacedNpcName(placedObject, config.name),
        npcDefeatMode: getPlacedNpcDefeatMode(placedObject),
        countsTowardGoals: true,
      });
      if (liveObject) {
        loadedRoom.liveObjects.push(liveObject);
        if (dormant) {
          this.setLiveObjectDormant(liveObject, true);
        }
      }
    }

    return lastIndex;
  }

  finalizeLiveObjectCreation(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    dormant: boolean,
  ): void {
    this.triggerController.applySwitchBlockStates(loadedRoom);
    if (dormant) {
      for (const liveObject of loadedRoom.liveObjects) {
        if (!isSwitchBlockObjectId(liveObject.config.id)) continue;
        this.captureFinalizedDormantBodyState(liveObject.sprite);
      }
    }
    this.liveObjectPartitionsByRoomId.delete(loadedRoom.room.id);
  }

  setLoadedRoomLiveObjectsDormant(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    dormant: boolean,
  ): void {
    for (const liveObject of loadedRoom.liveObjects) {
      this.setLiveObjectDormant(liveObject, dormant);
      for (const interaction of liveObject.interactions) {
        this.setColliderDormant(interaction, dormant);
      }
      for (const collider of liveObject.worldColliders) {
        this.setColliderDormant(collider, dormant);
      }
    }
    this.liveObjectPartitionsByRoomId.delete(loadedRoom.room.id);
  }

  setLoadedRoomWorldCollisionTargetDormant(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    dormant: boolean,
  ): void {
    const collisionTargets = new Set<unknown>([
      loadedRoom.terrainLayer,
      loadedRoom.terrainInsetBodies,
    ].filter(Boolean));
    if (collisionTargets.size === 0) return;

    for (const activeRoom of this.options.getLoadedFullRooms()) {
      for (const liveObject of activeRoom.liveObjects) {
        for (const collider of liveObject.worldColliders) {
          const targets = collider as Phaser.Physics.Arcade.Collider & {
            object1?: unknown;
            object2?: unknown;
          };
          if (
            collisionTargets.has(targets.object1)
            || collisionTargets.has(targets.object2)
          ) {
            this.setColliderDormant(collider, dormant);
          }
        }
      }
    }
  }

  destroyLiveObjects(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    options: { preserveTriggerState?: boolean } = {},
  ): void {
    this.destroyLiveObjectsBatch(loadedRoom, Number.MAX_SAFE_INTEGER, {
      preserveTriggerState: options.preserveTriggerState,
      clearRoomTriggerState: true,
    });
  }

  destroyLiveObjectsBatch(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    maxObjectCount: number,
    options: {
      preserveTriggerState?: boolean;
      clearRoomTriggerState?: boolean;
    } = {},
  ): boolean {
    let firstError: unknown;
    let hasError = false;
    const attempt = (operation: () => void) => {
      try {
        operation();
      } catch (error) {
        if (!hasError) {
          firstError = error;
          hasError = true;
        }
      }
    };
    if (options.clearRoomTriggerState && !options.preserveTriggerState) {
      attempt(() => this.triggerController.clearBlockSwitchActorLatchesForRoom(loadedRoom));
      attempt(() => this.triggerController.clearPressureTriggerStatesForRoom(loadedRoom));
    }
    const destroyCount = Math.min(
      loadedRoom.liveObjects.length,
      Math.max(1, Math.floor(maxObjectCount)),
    );
    for (let index = 0; index < destroyCount; index += 1) {
      const liveObject = loadedRoom.liveObjects.at(-1);
      if (!liveObject) break;
      attempt(() => this.destroyLiveObjectInteractions(liveObject));
      attempt(() => this.destroyLiveObjectWorldColliders(liveObject));
      attempt(() => this.destroyLiveObjectHelpers(liveObject));
      attempt(() => liveObject.sprite.destroy());
      loadedRoom.liveObjects.pop();
    }

    this.liveObjectPartitionsByRoomId.delete(loadedRoom.room.id);
    if (hasError) throw firstError;
    return loadedRoom.liveObjects.length === 0;
  }

  clearRoomInteractions(loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>): void {
    for (const liveObject of loadedRoom.liveObjects) {
      this.destroyLiveObjectInteractions(liveObject);
    }
  }

  syncLoadedWorldColliders(
    loadedRooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
  ): void {
    this.syncWorldObjectColliders(loadedRooms);
  }

  getPhysicsReconciliationGeneration(): number {
    return this.physicsReconciliationGeneration;
  }

  setRoomNpcsVictorious(roomId: string, victorious: boolean): void {
    this.npcController.setRoomVictory(
      this.options.getLoadedFullRooms(),
      roomId,
      victorious,
    );
  }

  getRoomNpcState(
    roomId: string,
    requestedInstanceId: string | null = null,
  ): NpcRuntimeStateSnapshot | null {
    return this.npcController.getRoomNpcState(
      this.options.getLoadedFullRooms(),
      roomId,
      requestedInstanceId,
    );
  }

  *getLoadedPushableLiveObjects(): IterableIterator<LoadedRoomObject> {
    for (const loadedRoom of this.options.getLoadedFullRooms()) {
      yield* this.getRoomLiveObjectPartition(loadedRoom).pushables;
    }
  }

  *getLoadedRuntimeSolidLiveObjects(): IterableIterator<LoadedRoomObject> {
    for (const loadedRoom of this.options.getLoadedFullRooms()) {
      yield* this.getRoomLiveObjectPartition(loadedRoom).runtimeSolids;
    }
  }

  *getPushableLiveObjectsInBounds(
    bounds: Phaser.Geom.Rectangle,
    paddingX = 0,
    paddingY = paddingX,
  ): IterableIterator<LoadedRoomObject> {
    yield* this.getLiveObjectsInBounds('pushable', bounds, paddingX, paddingY);
  }

  *getRuntimeSolidLiveObjectsInBounds(
    bounds: Phaser.Geom.Rectangle,
    paddingX = 0,
    paddingY = paddingX,
  ): IterableIterator<LoadedRoomObject> {
    yield* this.getLiveObjectsInBounds('runtimeSolid', bounds, paddingX, paddingY);
  }

  private createLiveObjectEntry(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    options: CreateLiveObjectEntryOptions,
  ): LoadedRoomObject | null {
    const roomOrigin = this.options.getRoomOrigin(loadedRoom.room.coordinates);
    const {
      key,
      config,
      x,
      y,
      facing,
      layer,
      baseTimeSeed = 0,
      placedInstanceId,
      linkedTargetRoomId,
      linkedTargetInstanceId,
      linkedTargetInstanceIds = linkedTargetInstanceId ? [linkedTargetInstanceId] : [],
      linkedTargetWorldX = null,
      linkedTargetWorldY = null,
      containedObjectId,
      signText,
      objectiveMode = null,
      defeatMode = null,
      policeBehaviorMode = null,
      policePatrolShoots = null,
      npcMode = null,
      npcPushable = null,
      npcCanJumpFall = null,
      npcPlayerCollision = null,
      npcFriendlyFire = null,
      npcName = null,
      npcDefeatMode = null,
      countsTowardGoals,
    } = options;
    ensureCustomSpriteTexture(this.options.scene, config);
    const displayOffset = getObjectDisplayOffset(config);
    const sprite = this.options.scene.add.sprite(
      roomOrigin.x + x + displayOffset.x,
      roomOrigin.y + y + displayOffset.y,
      config.id,
      getObjectDefaultFrame(config)
    );
    sprite.setOrigin(0.5, 0.5);
    sprite.setScale(getObjectDisplayScale(config));
    const normalizedLayer = getPlacedObjectLayer({ layer });
    sprite.setDepth(this.getPlacedObjectRuntimeDepth({ layer: normalizedLayer }));
    sprite.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    if (isMovingPlatformEndpointObjectId(config.id)) {
      sprite.setVisible(false);
    }

    if (config.frameCount > 1 && config.fps > 0) {
      const animationKey = `${config.id}_anim`;
      if (isAnimationSafelyPlayable(this.options.scene.anims, animationKey)) {
        sprite.play(animationKey);
      }
    }

    if (config.id === 'lightning') {
      sprite.stop();
      sprite.setVisible(false);
    }
    if (config.id === 'door_metal' || config.id === 'door_metal_narrow') {
      sprite.setTint(0xb8c4d8);
    }
    if (config.id === 'trapdoor_metal') {
      sprite.setTint(0xb8c4d8);
    }
    if (
      config.bodyWidth > 0 &&
      config.bodyHeight > 0 &&
      (
        placedObjectLayerAllowsRuntimeCollision(config, { layer: normalizedLayer }) ||
        config.category === 'npc'
      )
    ) {
      if (this.usesDynamicObjectBody(config)) {
        this.options.scene.physics.add.existing(sprite);
        const body = sprite.body as Phaser.Physics.Arcade.Body;
        body.setSize(config.bodyWidth, config.bodyHeight, true);
        body.setOffset(...this.getObjectBodyOffset(config));
        body.setCollideWorldBounds(false);
        body.setAllowGravity(config.category === 'npc' ? false : this.objectUsesGravity(config));
        if (isMovingPlatformObjectId(config.id)) {
          body.setAllowGravity(false);
          body.setImmovable(true);
          body.setBounce(0, 0);
          body.pushable = false;
        }
        if (isPushableObjectConfig(config) || config.id === 'cage') {
          body.setBounce(0, 0);
          body.setDragX(900);
          body.setMaxVelocity(120, 500);
          body.pushable = false;
        }
      } else {
        this.options.scene.physics.add.existing(sprite, true);
        const body = sprite.body as Phaser.Physics.Arcade.StaticBody;
        body.updateFromGameObject();
        body.setSize(config.bodyWidth, config.bodyHeight);
        body.setOffset(...this.getObjectBodyOffset(config));
      }
    }

    const initialDirectionX = getInitialDirectionX(facing, x);
    this.applyDirectionalFacing(sprite, config, initialDirectionX);
    const helpers: Phaser.GameObjects.GameObject[] = [];
    if (config.id === 'ladder') {
      const supportZone = this.createLadderTopSupport(sprite);
      if (supportZone) {
        helpers.push(supportZone);
      }
    }

    const liveObject: LoadedRoomObject = {
      key,
      placedInstanceId,
      linkedTargetRoomId,
      linkedTargetInstanceId,
      linkedTargetInstanceIds,
      linkedTargetWorldX,
      linkedTargetWorldY,
      containedObjectId,
      signText,
      npcName: config.category === 'npc' ? npcName ?? config.name : null,
      npcNameLabel: null,
      layer: normalizedLayer,
      countsTowardGoals,
      config,
      sprite,
      helpers,
      interactions: [],
      worldColliders: [],
      runtime: createLiveObjectRuntimeState({
        config,
        sprite,
        initialDirectionX,
        baseTimeSeed,
        getCurrentTime: this.options.getCurrentTime,
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
        swordsmanTraversalPlannerMode: this.options.swordsmanTraversalPlannerMode,
      }),
    };
    if (config.category === 'npc') {
      const npcBody = this.getDynamicBody(sprite);
      const npcIsMovable =
        liveObject.runtime.npcMode !== 'idle' || liveObject.runtime.npcPushable;
      if (npcBody) {
        npcBody.setAllowGravity(normalizedLayer === 'terrain' && npcIsMovable);
        npcBody.setImmovable(!npcIsMovable);
        npcBody.pushable = npcIsMovable;
        npcBody.setBounce(0, 0);
        npcBody.setDragX(npcIsMovable ? 550 : 0);
        npcBody.setMaxVelocity(140, 500);
      }
      if (liveObject.npcName) {
        const label = this.options.scene.add.text(
          sprite.x,
          sprite.y - 19,
          liveObject.npcName,
          {
            fontFamily: '"Press Start 2P", monospace',
            fontSize: '6px',
            color: '#ffffff',
            stroke: '#101522',
            strokeThickness: 2,
            align: 'center',
          },
        );
        label.setOrigin(0.5, 1);
        label.setDepth(sprite.depth + 0.05);
        liveObject.npcNameLabel = label;
        liveObject.helpers.push(label);
      }
      if (isAnimationSafelyPlayable(this.options.scene.anims, JIMOTHY_ANIMATION_KEYS.idle)) {
        sprite.play(JIMOTHY_ANIMATION_KEYS.idle);
      }
    }

    this.triggerController.initializePressureControlledObjectState(liveObject);

    return liveObject;
  }

  syncLiveObjectInteractions(loadedRooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>): void {
    this.physicsReconciliationGeneration += 1;
    const rooms = Array.from(loadedRooms).filter(
      (loadedRoom) => loadedRoom.runtimeSuspended !== true,
    );
    const player = this.options.getPlayer();
    const playerPickupSensor = this.options.getPlayerPickupSensor();
    const playerBody = this.options.getPlayerBody();

    for (const loadedRoom of rooms) {
      for (const liveObject of loadedRoom.liveObjects) {
        this.destroyLiveObjectInteractions(liveObject);

        if (!player || !playerBody || !liveObject.sprite.active || !liveObject.sprite.body) {
          continue;
        }

        switch (liveObject.config.category) {
          case 'collectible':
            if (!playerPickupSensor) {
              break;
            }
            liveObject.interactions.push(
              this.options.scene.physics.add.overlap(playerPickupSensor, liveObject.sprite, () => {
                this.collectLiveObject(loadedRoom, liveObject);
              })
            );
            break;
          case 'hazard':
            this.hazardController.addHazardInteraction(loadedRoom, liveObject, player);
            break;
          case 'enemy':
            liveObject.interactions.push(
              this.options.scene.physics.add.overlap(player, liveObject.sprite, () => {
                this.enemyLifecycleController.handleEnemyContact(loadedRoom, liveObject);
              })
            );
            break;
          case 'npc':
            if (placedObjectLayerAllowsRuntimeCollision(liveObject.config, liveObject)) {
              if (liveObjectBlocksPlayerMovement(liveObject)) {
                liveObject.interactions.push(
                  this.options.scene.physics.add.collider(
                    player,
                    liveObject.sprite,
                    () => {
                      this.enemyLifecycleController.handleNpcContact(loadedRoom, liveObject);
                    },
                    () => this.shouldCollideWithLiveObject(liveObject),
                  ),
                );
              }
              for (const dangerRoom of rooms) {
                for (const danger of dangerRoom.liveObjects) {
                  if (
                    danger === liveObject ||
                    !danger.sprite.active ||
                    !danger.sprite.body
                  ) {
                    continue;
                  }
                  const interactionKind =
                    getNpcEnvironmentalObjectInteraction(danger.config);
                  if (interactionKind === 'none') {
                    continue;
                  }
                  if (interactionKind === 'tornado') {
                    if (
                      liveObject.runtime.npcMode !== 'idle' ||
                      liveObject.runtime.npcPushable
                    ) {
                      this.hazardController.addNpcTornadoInteraction(
                        dangerRoom,
                        liveObject,
                        danger,
                      );
                    }
                    continue;
                  }
                  liveObject.interactions.push(
                    this.options.scene.physics.add.overlap(
                      liveObject.sprite,
                      danger.sprite,
                      () => {
                        if (interactionKind === 'quicksand') {
                          this.npcController.touchQuicksand(liveObject);
                        } else {
                          this.enemyLifecycleController.defeatNpc(loadedRoom, liveObject);
                        }
                      },
                    ),
                  );
                }
              }
            }
            break;
          case 'platform':
            if (liveObject.config.id === 'brick_box') {
              liveObject.interactions.push(
                this.options.scene.physics.add.collider(player, liveObject.sprite, () => {
                  this.maybeBreakBrickBox(loadedRoom, liveObject);
                }, () => this.shouldCollideWithLiveObject(liveObject))
              );
            } else if (liveObject.config.id === 'crate') {
              liveObject.interactions.push(
                this.options.scene.physics.add.collider(player, liveObject.sprite, () => {
                  this.maybeBreakButtStompableObject(loadedRoom, liveObject);
                }, () => this.shouldCollideWithLiveObject(liveObject))
              );
            } else if (isBlockSwitchObjectId(liveObject.config.id)) {
              liveObject.interactions.push(
                this.options.scene.physics.add.collider(player, liveObject.sprite, () => {
                  this.triggerController.maybeTriggerBlockSwitch(loadedRoom, liveObject);
                }, () => this.shouldCollideWithLiveObject(liveObject))
              );
            } else {
              liveObject.interactions.push(
                this.options.scene.physics.add.collider(
                  player,
                  liveObject.sprite,
                  undefined,
                  () => this.shouldCollideWithLiveObject(liveObject),
                )
              );
            }
            break;
          case 'interactive':
            if (liveObject.config.id === 'ladder') {
              const supportZone = liveObject.helpers[0];
              if (supportZone && supportZone.body) {
                liveObject.interactions.push(
                  this.options.scene.physics.add.collider(
                    player,
                    supportZone,
                    undefined,
                    () => this.shouldCollideWithLadderTopSupport(playerBody, supportZone.body as ArcadeObjectBody),
                  )
                );
              }
            } else if (liveObject.config.id === 'bounce_pad') {
              this.hazardController.addBouncePadInteraction(loadedRoom, liveObject, player);
            } else if (liveObject.config.id === 'tornado' || liveObject.config.id === 'tornado_sand') {
              this.hazardController.addHazardInteraction(loadedRoom, liveObject, player);
            } else if (
              liveObject.config.id === 'door_locked' ||
              liveObject.config.id === 'door_locked_narrow'
            ) {
              liveObject.interactions.push(
                this.options.scene.physics.add.collider(player, liveObject.sprite, () => {
                  this.triggerController.handleLockedDoorContact(loadedRoom, liveObject);
                }, () => this.shouldCollideWithLiveObject(liveObject))
              );
            } else if (liveObject.config.id === 'trapdoor_locked') {
              liveObject.interactions.push(
                this.options.scene.physics.add.collider(
                  player,
                  liveObject.sprite,
                  undefined,
                  () => this.shouldCollideWithLiveObject(liveObject),
                )
              );
            } else if (liveObject.config.id === 'barricade') {
              liveObject.interactions.push(
                this.options.scene.physics.add.collider(
                  player,
                  liveObject.sprite,
                  undefined,
                  () => this.shouldCollideWithLiveObject(liveObject),
                )
              );
            } else if (liveObject.config.id === 'wooden_bridge') {
              liveObject.interactions.push(
                this.options.scene.physics.add.collider(
                  player,
                  liveObject.sprite,
                  undefined,
                  () => this.shouldCollideWithLiveObject(liveObject),
                )
              );
            }
            break;
          default:
            break;
        }

      }
    }
  }

  updateLiveObjects(
    loadedRooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
    delta: number
  ): void {
    const rooms = Array.from(loadedRooms).filter(
      (loadedRoom) => loadedRoom.runtimeSuspended !== true,
    );
    const playerBody = this.options.getPlayerBody();

    for (const loadedRoom of rooms) {
      const partition = this.getRoomLiveObjectPartition(loadedRoom);
      this.ensureDynamicSpatialIndexes(partition);
      for (const liveObject of partition.updating) {
        try {
          if (!liveObject.sprite.active) {
            continue;
          }

          const dynamicBody = this.getDynamicBody(liveObject.sprite);
          const behavior = getLiveObjectBehavior(liveObject.config.id);
          const shouldSleep = playerBody !== null
            && liveObjectBehaviorCanSleepAtDistance(behavior)
            && this.isLiveObjectOutsideWakeRange(liveObject, playerBody);
          if (shouldSleep) {
            if (dynamicBody?.enable) {
              dynamicBody.enable = false;
              this.distanceSleepingObjects.add(liveObject);
            }
            continue;
          }
          if (dynamicBody && this.distanceSleepingObjects.has(liveObject)) {
            dynamicBody.enable = true;
            this.distanceSleepingObjects.delete(liveObject);
          }
          if (dynamicBody) {
            this.updateLiveObjectSpecialTileState(liveObject, dynamicBody);
            if (
              liveObject.config.category === 'npc' &&
              liveObject.runtime.specialTileOnDamage
            ) {
              this.enemyLifecycleController.defeatNpc(loadedRoom, liveObject);
              if (!liveObject.sprite.active) {
                continue;
              }
            }
          }

          switch (behavior.kind) {
            case 'flyingEnemy': {
              const motion = this.getFlyingEnemyMotion(behavior);
              this.updateFlyingEnemyObject(
                loadedRoom.room,
                liveObject,
                delta,
                motion.speed,
                motion.waveAmplitude,
                motion.waveSpeed
              );
              break;
            }
            case 'patrolEnemy':
              this.updatePatrolEnemy(loadedRoom.room, liveObject);
              break;
            case 'swordsman':
              this.swordsmanController.updateEnemy(loadedRoom, liveObject);
              break;
            case 'frog':
              this.updateFrogEnemy(loadedRoom.room, liveObject);
              break;
            case 'cannon':
              this.hazardController.updateCannonObject(loadedRoom, liveObject);
              break;
            case 'travelingProjectile':
              this.hazardController.updateTravelingProjectile(loadedRoom, liveObject);
              break;
            case 'bomb':
              this.hazardController.updateBombObject(liveObject);
              break;
            case 'lightning':
              this.hazardController.updateLightningObject(liveObject);
              break;
            case 'bouncePad':
              this.hazardController.updateBouncePadObject(liveObject);
              break;
            case 'movingPlatform':
              this.updateMovingPlatformObject(rooms, liveObject, delta);
              break;
            case 'blockSwitch':
              this.triggerController.updateBlockSwitchObject(loadedRoom, liveObject);
              break;
            case 'npc':
              this.npcController.updateNpc(rooms, loadedRoom, liveObject, delta);
              break;
            default:
              break;
          }

          this.applyConveyorToLiveObject(liveObject);
          if (dynamicBody) {
            this.applyLiveObjectSpecialTileForces(
              loadedRoom,
              liveObject,
              dynamicBody,
              delta,
            );
          }
          if (liveObject.sprite.active) {
            this.syncLiveObjectGravityPresentation(liveObject);
          }
        } finally {
          this.refreshPartitionSpatialMembership(partition, liveObject);
        }
      }
    }

    carryMovingPlatformRiders(rooms, {
      getDynamicBody: (sprite) => this.getDynamicBody(sprite),
      getPlayerBody: this.options.getPlayerBody,
      onLiveObjectMoved: (liveObject) => this.refreshLiveObjectSpatialMembership(liveObject),
    });
    this.stabilizePushableStacks(rooms);
    this.triggerController.updatePressurePlates(rooms);
  }

  private getFlyingEnemyMotion(behavior: FlyingEnemyBehavior): {
    speed: number;
    waveAmplitude: number;
    waveSpeed: number;
  } {
    const speedBase =
      behavior.speedSetting === 'bat'
        ? this.options.settings.batSpeed
        : this.options.settings.birdSpeed;
    const waveAmplitudeSetting = behavior.waveAmplitudeSetting ?? behavior.speedSetting;
    const waveSpeedSetting = behavior.waveSpeedSetting ?? behavior.speedSetting;
    const waveAmplitudeBase = waveAmplitudeSetting === 'bat'
      ? this.options.settings.batWaveAmplitude
      : this.options.settings.birdWaveAmplitude;
    const waveSpeedBase = waveSpeedSetting === 'bat'
      ? this.options.settings.batWaveSpeed
      : this.options.settings.birdWaveSpeed;

    return {
      speed: speedBase * (behavior.speedMultiplier ?? 1),
      waveAmplitude: behavior.waveAmplitude ?? waveAmplitudeBase,
      waveSpeed: behavior.waveSpeed ?? waveSpeedBase,
    };
  }

  private applyConveyorToLiveObject(liveObject: LoadedRoomObject): void {
    if (!this.shouldLiveObjectRideConveyors(liveObject)) {
      return;
    }

    const body = this.getDynamicBody(liveObject.sprite);
    if (!body) {
      return;
    }

    const gravityDirection = this.getLiveObjectGravityDirection(liveObject);
    const gravityVelocity = getBodyVelocityAlongVector(body, getGravityVector(gravityDirection));
    if (gravityVelocity < -20) {
      return;
    }

    const conveyorDirection = this.options.getConveyorDirectionForBody(body, gravityDirection);
    if (conveyorDirection === 0) {
      return;
    }

    body.setVelocityX(body.velocity.x + conveyorDirection * LIVE_OBJECT_CONVEYOR_SPEED);
  }

  private updateLiveObjectSpecialTileState(
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
  ): void {
    if (!this.shouldLiveObjectUseSpecialTilePhysics(liveObject)) {
      liveObject.runtime.gravityDirection = 'down';
      liveObject.runtime.gravityRoomId = null;
      liveObject.runtime.inWater = false;
      liveObject.runtime.specialTileWindX = 0;
      liveObject.runtime.specialTileOnIce = false;
      liveObject.runtime.specialTileOnSticky = false;
      liveObject.runtime.specialTileOnBounce = false;
      liveObject.runtime.specialTileOnDamage =
        liveObject.config.category === 'npc' && liveObject.layer === 'terrain'
          ? this.options.getSpecialTileEnvironmentForBody(body, 'down').onDamage
          : false;
      body.setAllowGravity(this.liveObjectUsesGravity(liveObject));
      return;
    }

    const currentRoomId = this.options.getBodyRoomId(body);
    if (liveObject.runtime.gravityRoomId !== currentRoomId) {
      liveObject.runtime.gravityRoomId = currentRoomId;
      liveObject.runtime.gravityDirection = 'down';
    }

    const environment = this.options.getSpecialTileEnvironmentForBody(
      body,
      liveObject.runtime.gravityDirection,
    );
    liveObject.runtime.gravityDirection = environment.gravityDirection;
    liveObject.runtime.gravityRoomId = currentRoomId;
    liveObject.runtime.inWater = environment.inWater;
    liveObject.runtime.specialTileWindX = environment.windX;
    liveObject.runtime.specialTileOnIce = environment.onIce;
    liveObject.runtime.specialTileOnSticky = environment.onSticky;
    liveObject.runtime.specialTileOnBounce = environment.onBounce;
    liveObject.runtime.specialTileOnDamage = environment.onDamage;
    body.setAllowGravity(
      this.liveObjectUsesGravity(liveObject) &&
      liveObject.runtime.gravityDirection === 'down' &&
      !liveObject.runtime.inWater,
    );
    if (isPushableObjectConfig(liveObject.config) || liveObject.config.id === 'cage') {
      const horizontalGravity =
        liveObject.runtime.gravityDirection === 'left' ||
        liveObject.runtime.gravityDirection === 'right';
      body.setDragX(horizontalGravity ? 0 : 900);
      body.setMaxVelocity(horizontalGravity ? 500 : 120, horizontalGravity ? 120 : 500);
    }
  }

  private applyLiveObjectSpecialTileForces(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
    delta: number,
  ): void {
    if (!this.shouldLiveObjectUseSpecialTilePhysics(liveObject)) {
      return;
    }

    const gravityDirection = this.getLiveObjectGravityDirection(liveObject);
    const gravityVector = getGravityVector(gravityDirection);
    const deltaSeconds = Math.max(delta / 1000, 1 / 60);
    const usesManualGravity = gravityDirection !== 'down' || liveObject.runtime.inWater;
    const suppressNpcRoomBottomGravity =
      gravityDirection === 'down' &&
      liveObject.config.category === 'npc' &&
      this.npcController.isRestingOnRoomBottom(liveObject);
    body.setAllowGravity(
      this.liveObjectUsesGravity(liveObject) &&
      !usesManualGravity &&
      !suppressNpcRoomBottomGravity,
    );

    if (usesManualGravity && !suppressNpcRoomBottomGravity) {
      const gravityScale = liveObject.runtime.inWater ? LIVE_OBJECT_WATER_GRAVITY_FACTOR : 1;
      const maxGravitySpeed = liveObject.runtime.inWater
        ? LIVE_OBJECT_WATER_MAX_GRAVITY_SPEED
        : LIVE_OBJECT_MAX_GRAVITY_SPEED;
      const gravityVelocity = getBodyVelocityAlongVector(body, gravityVector);
      setBodyVelocityAlongVector(
        body,
        gravityVector,
        Phaser.Math.Clamp(
          gravityVelocity + LIVE_OBJECT_GRAVITY_ACCELERATION * gravityScale * deltaSeconds,
          -LIVE_OBJECT_MAX_GRAVITY_SPEED,
          maxGravitySpeed,
        ),
      );
    }

    if (liveObject.runtime.inWater) {
      const nextVelocityX = Phaser.Math.Clamp(
        body.velocity.x * LIVE_OBJECT_WATER_DAMPING_FACTOR,
        -LIVE_OBJECT_WATER_MAX_GRAVITY_SPEED,
        LIVE_OBJECT_WATER_MAX_GRAVITY_SPEED,
      );
      const nextVelocityY = Phaser.Math.Clamp(
        body.velocity.y * LIVE_OBJECT_WATER_DAMPING_FACTOR,
        -LIVE_OBJECT_WATER_MAX_GRAVITY_SPEED,
        LIVE_OBJECT_WATER_MAX_GRAVITY_SPEED,
      );
      body.setVelocity(nextVelocityX, nextVelocityY);
    }

    if (
      liveObject.config.category === 'npc' &&
      liveObject.runtime.specialTileWindX !== 0
    ) {
      const windDelta =
        liveObject.runtime.specialTileWindX * LIVE_OBJECT_WIND_ACCELERATION * deltaSeconds;
      body.setVelocityX(
        Phaser.Math.Clamp(
          body.velocity.x + windDelta,
          -LIVE_OBJECT_WIND_MAX_SPEED,
          LIVE_OBJECT_WIND_MAX_SPEED,
        ),
      );
    }

    if (
      liveObject.config.category === 'npc' &&
      liveObject.runtime.specialTileOnBounce &&
      this.options.getCurrentTime() >= liveObject.runtime.npcBounceCooldownUntil
    ) {
      const gravityVelocity = getBodyVelocityAlongVector(body, gravityVector);
      if (gravityVelocity >= -24) {
        liveObject.runtime.npcBounceCooldownUntil =
          this.options.getCurrentTime() + this.options.settings.bouncePadCooldownMs;
        setBodyVelocityAlongVector(
          body,
          gravityVector,
          this.options.settings.bouncePadVelocity,
        );
        this.options.playBounceFx(
          body.center.x,
          body.center.y,
          loadedRoom.room.coordinates,
          'bounce',
        );
      }
    }
  }

  private shouldLiveObjectUseSpecialTilePhysics(liveObject: LoadedRoomObject): boolean {
    const config = liveObject.config;
    if (
      isMovingPlatformObjectId(config.id) ||
      config.behavior === 'fly' ||
      config.id === 'cannon_bullet' ||
      config.id === 'fireball' ||
      config.id === 'cage'
    ) {
      return false;
    }
    if (
      (config.id === SWORDSMAN_AI_OBJECT_ID || isPoliceEnemyObjectId(config.id))
      && liveObject.runtime.aiLadderTraversalEdgeId
    ) {
      return false;
    }

    return (
      isPushableObjectConfig(config) ||
      config.category === 'enemy' ||
      (
        config.category === 'npc' &&
        liveObject.layer === 'terrain' &&
        (liveObject.runtime.npcMode !== 'idle' || liveObject.runtime.npcPushable)
      )
    );
  }

  private shouldLiveObjectRideConveyors(liveObject: LoadedRoomObject): boolean {
    const config = liveObject.config;
    if (isMovingPlatformObjectId(config.id)) {
      return false;
    }

    return (
      isPushableObjectConfig(config) ||
      config.id === 'cage' ||
      (config.category === 'enemy' && config.behavior !== 'fly') ||
      (
        config.category === 'npc' &&
        liveObject.layer === 'terrain' &&
        (liveObject.runtime.npcMode !== 'idle' || liveObject.runtime.npcPushable)
      )
    );
  }

  private updateMovingPlatformObject(
    rooms: Array<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
    liveObject: LoadedRoomObject,
    delta: number,
  ): void {
    const body = this.getDynamicBody(liveObject.sprite);
    if (!body) {
      return;
    }

    const pathPoints = this.getMovingPlatformPathPoints(rooms, liveObject);
    if (pathPoints.length < 2) {
      liveObject.runtime.previousX = liveObject.sprite.x;
      liveObject.runtime.previousY = liveObject.sprite.y;
      body.setVelocity(0, 0);
      return;
    }

    let targetIndex = Math.round(liveObject.runtime.movingPlatformTargetIndex);
    let pathDirection: -1 | 1 = liveObject.runtime.movingPlatformPathDirection === -1 ? -1 : 1;
    if (targetIndex < 0 || targetIndex >= pathPoints.length) {
      targetIndex = pathDirection >= 0 ? 1 : pathPoints.length - 2;
    }
    targetIndex = Phaser.Math.Clamp(targetIndex, 0, pathPoints.length - 1);

    const destinationPoint = pathPoints[targetIndex];
    const destination = new Phaser.Math.Vector2(destinationPoint.x, destinationPoint.y);
    const current = new Phaser.Math.Vector2(liveObject.sprite.x, liveObject.sprite.y);
    const remaining = Phaser.Math.Distance.Between(
      current.x,
      current.y,
      destination.x,
      destination.y,
    );
    const deltaSeconds = Math.max(delta / 1000, 1 / 60);
    const step = Math.max(1, 44 * deltaSeconds);
    const next =
      remaining <= step
        ? destination
        : current.add(destination.clone().subtract(current).normalize().scale(step));
    const previousX = liveObject.sprite.x;
    const previousY = liveObject.sprite.y;

    body.reset(next.x, next.y);
    body.setVelocity((next.x - previousX) / deltaSeconds, (next.y - previousY) / deltaSeconds);
    liveObject.sprite.setPosition(next.x, next.y);
    liveObject.runtime.previousX = previousX;
    liveObject.runtime.previousY = previousY;
    if (remaining <= step) {
      if (targetIndex === pathPoints.length - 1) {
        pathDirection = -1;
      } else if (targetIndex === 0) {
        pathDirection = 1;
      }
      liveObject.runtime.movingPlatformPathDirection = pathDirection;
      liveObject.runtime.movingPlatformTargetIndex = Phaser.Math.Clamp(
        targetIndex + pathDirection,
        0,
        pathPoints.length - 1,
      );
      liveObject.runtime.directionX = pathDirection;
    } else {
      liveObject.runtime.movingPlatformPathDirection = pathDirection;
      liveObject.runtime.movingPlatformTargetIndex = targetIndex;
      liveObject.runtime.directionX = next.x >= previousX ? 1 : -1;
    }
  }

  private getMovingPlatformPathPoints(
    rooms: Array<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
    liveObject: LoadedRoomObject,
  ): Array<{ x: number; y: number }> {
    const targetInstanceIds = liveObject.linkedTargetInstanceIds.length > 0
      ? liveObject.linkedTargetInstanceIds
      : liveObject.linkedTargetInstanceId
        ? [liveObject.linkedTargetInstanceId]
        : [];
    if (targetInstanceIds.length === 0) {
      return [];
    }

    const points: Array<{ x: number; y: number }> = [
      { x: liveObject.runtime.baseX, y: liveObject.runtime.baseY },
    ];
    for (const loadedRoom of rooms) {
      if (liveObject.linkedTargetRoomId && loadedRoom.room.id !== liveObject.linkedTargetRoomId) {
        continue;
      }
      const pathTargets = this.getRoomLiveObjectPartition(loadedRoom).pathTargetsByInstanceId;
      for (let targetIndex = 0; targetIndex < targetInstanceIds.length; targetIndex += 1) {
        const candidate = pathTargets.get(targetInstanceIds[targetIndex] ?? '');
        if (!candidate?.sprite.active) {
          continue;
        }
        points[targetIndex + 1] = { x: candidate.sprite.x, y: candidate.sprite.y };
      }
    }

    if (
      liveObject.linkedTargetWorldX !== null &&
      liveObject.linkedTargetWorldY !== null &&
      points.length === 1
    ) {
      points.push({
        x: liveObject.linkedTargetWorldX,
        y: liveObject.linkedTargetWorldY,
      });
    }

    return points.filter((point): point is { x: number; y: number } => Boolean(point));
  }

  findOverlappingLadder(
    loadedRooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>
  ): LoadedRoomObject | null {
    const playerBody = this.options.getPlayerBody();
    if (!playerBody) {
      return null;
    }

    const playerBounds = getArcadeBodyBounds(playerBody);
    let closestLadder: LoadedRoomObject | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    const queryMark = this.nextSpatialQueryMark();

    for (const loadedRoom of loadedRooms) {
      const partition = this.getRoomLiveObjectPartition(loadedRoom);
      if (
        !partition.ladderSpatialIndex &&
        !this.boundsCouldOverlapRoom(
          playerBounds,
          loadedRoom.room.coordinates,
          partition.ladderRoomBoundsPadding,
        )
      ) {
        continue;
      }

      const spatialIndex = this.getOrCreateSpatialIndex(partition, 'ladder');
      for (const liveObject of this.querySpatialIndex(
        spatialIndex,
        playerBounds,
        0,
        0,
        queryMark,
      )) {
        if (!liveObject.sprite.active || !liveObject.sprite.body) {
          continue;
        }

        const ladderBounds = getArcadeBodyBounds(liveObject.sprite.body as ArcadeObjectBody);
        if (!Phaser.Geom.Intersects.RectangleToRectangle(playerBounds, ladderBounds)) {
          continue;
        }

        const distance =
          Math.abs(liveObject.sprite.x - playerBody.center.x) +
          Math.abs(liveObject.sprite.y - playerBody.center.y);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestLadder = liveObject;
        }
      }
    }

    return closestLadder;
  }

  private boundsCouldOverlapRoom(
    bounds: Phaser.Geom.Rectangle,
    coordinates: RoomCoordinates,
    padding: number,
  ): boolean {
    const origin = this.options.getRoomOrigin(coordinates);
    return (
      bounds.right >= origin.x - padding &&
      bounds.left <= origin.x + ROOM_PX_WIDTH + padding &&
      bounds.bottom >= origin.y - padding &&
      bounds.top <= origin.y + ROOM_PX_HEIGHT + padding
    );
  }

  private getRoomLiveObjectPartition(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
  ): RoomLiveObjectPartition {
    const existing = this.liveObjectPartitionsByRoomId.get(loadedRoom.room.id);
    if (existing?.source === loadedRoom.liveObjects && existing.sourceLength === loadedRoom.liveObjects.length) {
      return existing;
    }
    const updating: LoadedRoomObject[] = [];
    const ladders: LoadedRoomObject[] = [];
    const pushables: LoadedRoomObject[] = [];
    const runtimeSolids: LoadedRoomObject[] = [];
    let ladderRoomBoundsPadding = 0;
    let pushableRoomBoundsPadding = 0;
    let runtimeSolidRoomBoundsPadding = 0;
    const pathTargetsByInstanceId = new Map<string, LoadedRoomObject>();
    for (const liveObject of loadedRoom.liveObjects) {
      const behavior = getLiveObjectBehavior(liveObject.config.id);
      if (liveObjectBehaviorUpdatesEveryFrame(behavior) || isDynamicArcadeBody(liveObject.sprite.body as ArcadeObjectBody | null)) {
        updating.push(liveObject);
      }
      if (liveObject.config.id === 'ladder') {
        ladders.push(liveObject);
        ladderRoomBoundsPadding = Math.max(
          ladderRoomBoundsPadding,
          this.getLiveObjectRoomBoundsPadding(liveObject),
        );
      }
      if (isPushableObjectConfig(liveObject.config)) {
        pushables.push(liveObject);
        pushableRoomBoundsPadding = Math.max(
          pushableRoomBoundsPadding,
          this.getLiveObjectRoomBoundsPadding(liveObject),
        );
      }
      if (
        isSolidRuntimeObjectConfig(liveObject.config) &&
        placedObjectLayerAllowsRuntimeCollision(liveObject.config, liveObject)
      ) {
        runtimeSolids.push(liveObject);
        runtimeSolidRoomBoundsPadding = Math.max(
          runtimeSolidRoomBoundsPadding,
          this.getLiveObjectRoomBoundsPadding(liveObject),
        );
      }
      if (liveObject.placedInstanceId && isMovingPlatformEndpointObjectId(liveObject.config.id)) {
        pathTargetsByInstanceId.set(liveObject.placedInstanceId, liveObject);
      }
    }
    const partition = {
      source: loadedRoom.liveObjects,
      sourceLength: loadedRoom.liveObjects.length,
      updating,
      ladders,
      ladderRoomBoundsPadding,
      ladderSpatialIndex: null,
      pushables,
      pushableRoomBoundsPadding,
      pushableSpatialIndex: null,
      runtimeSolids,
      runtimeSolidRoomBoundsPadding,
      runtimeSolidSpatialIndex: null,
      pathTargetsByInstanceId,
    };
    for (const liveObject of loadedRoom.liveObjects) {
      this.liveObjectPartitionByObject.set(liveObject, partition);
    }
    this.liveObjectPartitionsByRoomId.set(loadedRoom.room.id, partition);
    return partition;
  }

  private *getLiveObjectsInBounds(
    category: 'pushable' | 'runtimeSolid',
    bounds: Phaser.Geom.Rectangle,
    paddingX: number,
    paddingY: number,
  ): IterableIterator<LoadedRoomObject> {
    const safePaddingX = Math.max(0, paddingX);
    const safePaddingY = Math.max(0, paddingY);
    const queryMark = this.nextSpatialQueryMark();
    for (const loadedRoom of this.options.getLoadedFullRooms()) {
      const partition = this.getRoomLiveObjectPartition(loadedRoom);
      const existingIndex = category === 'pushable'
        ? partition.pushableSpatialIndex
        : partition.runtimeSolidSpatialIndex;
      const roomBoundsPadding = category === 'pushable'
        ? partition.pushableRoomBoundsPadding
        : partition.runtimeSolidRoomBoundsPadding;
      if (
        !existingIndex &&
        !this.boundsCouldOverlapRoom(
          bounds,
          loadedRoom.room.coordinates,
          roomBoundsPadding + Math.max(safePaddingX, safePaddingY),
        )
      ) {
        continue;
      }

      const spatialIndex = existingIndex ?? this.getOrCreateSpatialIndex(partition, category);
      yield* this.querySpatialIndex(
        spatialIndex,
        bounds,
        safePaddingX,
        safePaddingY,
        queryMark,
      );
    }
  }

  private getOrCreateSpatialIndex(
    partition: RoomLiveObjectPartition,
    category: 'ladder' | 'pushable' | 'runtimeSolid',
  ): LiveObjectSpatialIndex {
    switch (category) {
      case 'ladder':
        partition.ladderSpatialIndex ??= this.createSpatialIndex(partition.ladders);
        return partition.ladderSpatialIndex;
      case 'pushable':
        partition.pushableSpatialIndex ??= this.createSpatialIndex(partition.pushables);
        return partition.pushableSpatialIndex;
      case 'runtimeSolid':
        partition.runtimeSolidSpatialIndex ??= this.createSpatialIndex(partition.runtimeSolids);
        return partition.runtimeSolidSpatialIndex;
    }
  }

  private createSpatialIndex(liveObjects: LoadedRoomObject[]): LiveObjectSpatialIndex {
    const spatialIndex: LiveObjectSpatialIndex = {
      binsByX: new Map(),
      binRangeByObject: new Map(),
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    };
    for (const liveObject of liveObjects) {
      this.refreshSpatialIndexMembership(spatialIndex, liveObject);
    }
    return spatialIndex;
  }

  private ensureDynamicSpatialIndexes(partition: RoomLiveObjectPartition): void {
    if (partition.pushables.length > 0) {
      this.getOrCreateSpatialIndex(partition, 'pushable');
    }
    if (partition.runtimeSolids.length > 0) {
      this.getOrCreateSpatialIndex(partition, 'runtimeSolid');
    }
  }

  private refreshPartitionSpatialMembership(
    partition: RoomLiveObjectPartition,
    liveObject: LoadedRoomObject,
  ): void {
    if (partition.pushableSpatialIndex && isPushableObjectConfig(liveObject.config)) {
      this.refreshSpatialIndexMembership(partition.pushableSpatialIndex, liveObject);
    }
    if (
      partition.runtimeSolidSpatialIndex &&
      isSolidRuntimeObjectConfig(liveObject.config) &&
      placedObjectLayerAllowsRuntimeCollision(liveObject.config, liveObject)
    ) {
      this.refreshSpatialIndexMembership(partition.runtimeSolidSpatialIndex, liveObject);
    }
  }

  private refreshLiveObjectSpatialMembership(liveObject: LoadedRoomObject): void {
    const partition = this.liveObjectPartitionByObject.get(liveObject);
    if (partition) {
      this.refreshPartitionSpatialMembership(partition, liveObject);
    }
  }

  private refreshSpatialIndexMembership(
    spatialIndex: LiveObjectSpatialIndex,
    liveObject: LoadedRoomObject,
  ): void {
    const previousRange = spatialIndex.binRangeByObject.get(liveObject) ?? null;
    const body = liveObject.sprite.body as ArcadeObjectBody | null;
    if (!body) {
      if (previousRange) {
        this.removeSpatialIndexMembership(spatialIndex, liveObject, previousRange);
      }
      return;
    }
    const nextMinX = Math.floor(body.left / LIVE_OBJECT_SPATIAL_BIN_SIZE_PX);
    const nextMaxX = Math.floor(
      Math.max(body.left, body.left + Math.max(0, body.width) - 0.001) /
        LIVE_OBJECT_SPATIAL_BIN_SIZE_PX,
    );
    const nextMinY = Math.floor(body.top / LIVE_OBJECT_SPATIAL_BIN_SIZE_PX);
    const nextMaxY = Math.floor(
      Math.max(body.top, body.top + Math.max(0, body.height) - 0.001) /
        LIVE_OBJECT_SPATIAL_BIN_SIZE_PX,
    );
    if (
      previousRange &&
      previousRange.minX === nextMinX &&
      previousRange.maxX === nextMaxX &&
      previousRange.minY === nextMinY &&
      previousRange.maxY === nextMaxY
    ) {
      return;
    }
    if (previousRange) {
      this.removeSpatialIndexMembership(spatialIndex, liveObject, previousRange);
    }
    const nextRange = {
      minX: nextMinX,
      maxX: nextMaxX,
      minY: nextMinY,
      maxY: nextMaxY,
    };

    spatialIndex.binRangeByObject.set(liveObject, nextRange);
    spatialIndex.minX = Math.min(spatialIndex.minX, nextRange.minX);
    spatialIndex.maxX = Math.max(spatialIndex.maxX, nextRange.maxX);
    spatialIndex.minY = Math.min(spatialIndex.minY, nextRange.minY);
    spatialIndex.maxY = Math.max(spatialIndex.maxY, nextRange.maxY);
    for (let binX = nextRange.minX; binX <= nextRange.maxX; binX += 1) {
      let binsByY = spatialIndex.binsByX.get(binX);
      if (!binsByY) {
        binsByY = new Map();
        spatialIndex.binsByX.set(binX, binsByY);
      }
      for (let binY = nextRange.minY; binY <= nextRange.maxY; binY += 1) {
        let bin = binsByY.get(binY);
        if (!bin) {
          bin = new Set();
          binsByY.set(binY, bin);
        }
        bin.add(liveObject);
      }
    }
  }

  private removeSpatialIndexMembership(
    spatialIndex: LiveObjectSpatialIndex,
    liveObject: LoadedRoomObject,
    range: LiveObjectSpatialBinRange,
  ): void {
    spatialIndex.binRangeByObject.delete(liveObject);
    for (let binX = range.minX; binX <= range.maxX; binX += 1) {
      const binsByY = spatialIndex.binsByX.get(binX);
      if (!binsByY) {
        continue;
      }
      for (let binY = range.minY; binY <= range.maxY; binY += 1) {
        const bin = binsByY.get(binY);
        bin?.delete(liveObject);
        if (bin?.size === 0) {
          binsByY.delete(binY);
        }
      }
      if (binsByY.size === 0) {
        spatialIndex.binsByX.delete(binX);
      }
    }
    if (spatialIndex.binRangeByObject.size === 0) {
      spatialIndex.minX = Number.POSITIVE_INFINITY;
      spatialIndex.maxX = Number.NEGATIVE_INFINITY;
      spatialIndex.minY = Number.POSITIVE_INFINITY;
      spatialIndex.maxY = Number.NEGATIVE_INFINITY;
    }
  }

  private *querySpatialIndex(
    spatialIndex: LiveObjectSpatialIndex,
    bounds: Phaser.Geom.Rectangle,
    paddingX: number,
    paddingY: number,
    queryMark: number,
  ): IterableIterator<LoadedRoomObject> {
    const queryRange = this.getSpatialBinRange(
      bounds.left - paddingX,
      bounds.top - paddingY,
      bounds.width + paddingX * 2,
      bounds.height + paddingY * 2,
    );
    if (
      queryRange.maxX < spatialIndex.minX ||
      queryRange.minX > spatialIndex.maxX ||
      queryRange.maxY < spatialIndex.minY ||
      queryRange.minY > spatialIndex.maxY
    ) {
      return;
    }

    for (let binX = queryRange.minX; binX <= queryRange.maxX; binX += 1) {
      const binsByY = spatialIndex.binsByX.get(binX);
      if (!binsByY) {
        continue;
      }
      for (let binY = queryRange.minY; binY <= queryRange.maxY; binY += 1) {
        const bin = binsByY.get(binY);
        if (!bin) {
          continue;
        }
        for (const liveObject of bin) {
          if (this.spatialQueryMarks.get(liveObject) === queryMark) {
            continue;
          }
          this.spatialQueryMarks.set(liveObject, queryMark);
          yield liveObject;
        }
      }
    }
  }

  private getSpatialBinRange(
    left: number,
    top: number,
    width: number,
    height: number,
  ): LiveObjectSpatialBinRange {
    const right = left + Math.max(0, width);
    const bottom = top + Math.max(0, height);
    return {
      minX: Math.floor(left / LIVE_OBJECT_SPATIAL_BIN_SIZE_PX),
      maxX: Math.floor(Math.max(left, right - 0.001) / LIVE_OBJECT_SPATIAL_BIN_SIZE_PX),
      minY: Math.floor(top / LIVE_OBJECT_SPATIAL_BIN_SIZE_PX),
      maxY: Math.floor(Math.max(top, bottom - 0.001) / LIVE_OBJECT_SPATIAL_BIN_SIZE_PX),
    };
  }

  private nextSpatialQueryMark(): number {
    this.spatialQueryGeneration += 1;
    return this.spatialQueryGeneration;
  }

  private getLiveObjectRoomBoundsPadding(liveObject: LoadedRoomObject): number {
    const displayScale = Math.max(1, Math.abs(getObjectDisplayScale(liveObject.config)));
    return Math.max(
      liveObject.config.frameWidth * displayScale,
      liveObject.config.frameHeight * displayScale,
      liveObject.config.bodyWidth * displayScale,
      liveObject.config.bodyHeight * displayScale,
    );
  }

  private isLiveObjectOutsideWakeRange(
    liveObject: LoadedRoomObject,
    playerBody: ArcadeObjectBody,
  ): boolean {
    return Math.abs(liveObject.sprite.x - playerBody.center.x) > ROOM_PX_WIDTH * 1.5
      || Math.abs(liveObject.sprite.y - playerBody.center.y) > ROOM_PX_HEIGHT * 1.75;
  }

  attackEnemiesInRect(
    loadedRooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
    attackRect: Phaser.Geom.Rectangle,
    maxHits = Number.POSITIVE_INFINITY
  ): WeaponHitResult[] {
    return this.enemyLifecycleController.attackEnemiesInRect(loadedRooms, attackRect, maxHits);
  }

  attackEnemyAtPoint(
    loadedRooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
    x: number,
    y: number,
    radius = 6
  ): WeaponHitResult | null {
    return this.enemyLifecycleController.attackEnemyAtPoint(loadedRooms, x, y, radius);
  }

  private stabilizePushableStacks(
    loadedRooms: LoadedFullRoom<LoadedRoomObject, TEdgeWall>[],
  ): void {
    const pushables: Array<{
      liveObject: LoadedRoomObject;
      body: Phaser.Physics.Arcade.Body;
    }> = [];

    for (const loadedRoom of loadedRooms) {
      for (const liveObject of this.getRoomLiveObjectPartition(loadedRoom).pushables) {
        const body = liveObject.sprite.body as ArcadeObjectBody | null;
        if (
          liveObject.sprite.active &&
          this.getLiveObjectGravityDirection(liveObject) === 'down' &&
          isDynamicArcadeBody(body)
        ) {
          pushables.push({ liveObject, body });
        }
      }
    }

    if (pushables.length < 2) {
      return;
    }

    pushables.sort((a, b) => a.body.center.x - b.body.center.x || b.body.top - a.body.top);

    const groups: Array<
      Array<{ liveObject: LoadedRoomObject; body: Phaser.Physics.Arcade.Body }>
    > = [];

    for (const candidate of pushables) {
      const group = groups.find((existing) =>
        existing.some(
          (member) =>
            Math.abs(member.body.center.x - candidate.body.center.x) <=
            Math.max(2, Math.min(member.body.width, candidate.body.width) * 0.5)
        )
      );
      if (group) {
        group.push(candidate);
      } else {
        groups.push([candidate]);
      }
    }

    for (const group of groups) {
      group.sort((a, b) => b.body.top - a.body.top);
      for (let index = 1; index < group.length; index += 1) {
        const lower = group[index - 1];
        const upper = group[index];
        const desiredTop = lower.body.top - upper.body.height;
        const stackGap = lower.body.top - upper.body.bottom;
        if (Math.abs(stackGap) > upper.body.height + 2) {
          continue;
        }
        if (Math.abs(upper.body.top - desiredTop) <= 0.5) {
          continue;
        }

        const velocityX = upper.body.velocity.x;
        const spriteYFromBodyTop = upper.liveObject.sprite.y - upper.body.top;
        const targetSpriteY = desiredTop + spriteYFromBodyTop;

        upper.liveObject.sprite.setY(targetSpriteY);
        upper.body.updateFromGameObject();
        upper.body.prev.x = upper.body.x;
        upper.body.prev.y = upper.body.y;
        upper.body.setVelocity(velocityX, 0);
        this.refreshLiveObjectSpatialMembership(upper.liveObject);
      }
    }
  }

  private destroyLiveObjectInteractions(liveObject: LoadedRoomObject): void {
    let firstError: unknown;
    let hasError = false;
    for (const interaction of liveObject.interactions) {
      this.colliderDormancyStates.delete(interaction);
      try {
        interaction.destroy();
      } catch (error) {
        if (!hasError) {
          firstError = error;
          hasError = true;
        }
      }
    }
    liveObject.interactions = [];
    if (hasError) throw firstError;
  }

  private destroyLiveObjectHelpers(liveObject: LoadedRoomObject): void {
    let firstError: unknown;
    let hasError = false;
    for (const helper of liveObject.helpers) {
      try {
        helper.destroy();
      } catch (error) {
        if (!hasError) {
          firstError = error;
          hasError = true;
        }
      }
    }
    liveObject.helpers = [];
    if (hasError) throw firstError;
  }

  private setLiveObjectDormant(liveObject: LoadedRoomObject, dormant: boolean): void {
    this.setGameObjectDormant(liveObject.sprite, dormant);
    for (const helper of liveObject.helpers) {
      this.setGameObjectDormant(helper, dormant);
    }
  }

  private captureFinalizedDormantBodyState(gameObject: Phaser.GameObjects.GameObject): void {
    const body = (gameObject as Phaser.GameObjects.GameObject & {
      body?: ArcadeObjectBody | null;
    }).body;
    if (gameObject.getData('wampPreparedDormant') !== true || !body) return;

    // Switch-state finalization runs after the object was made dormant. Keep
    // its newly resolved logical collision state for activation without
    // allowing the detached body's collision to become live before commit.
    gameObject.setData('wampPreparedBodyEnabled', body.enable);
    body.enable = false;
  }

  private setGameObjectDormant(gameObject: Phaser.GameObjects.GameObject, dormant: boolean): void {
    const displayObject = gameObject as Phaser.GameObjects.GameObject & {
      visible?: boolean;
      setVisible?: (visible: boolean) => unknown;
      body?: ArcadeObjectBody | null;
    };
    if (dormant) {
      if (gameObject.getData('wampPreparedDormant') === true) {
        return;
      }
      gameObject.setData('wampPreparedDormant', true);
      gameObject.setData('wampPreparedActive', gameObject.active);
      gameObject.setData('wampPreparedVisible', displayObject.visible ?? true);
      gameObject.setData('wampPreparedBodyEnabled', displayObject.body?.enable ?? null);
      gameObject.setActive(false);
      displayObject.setVisible?.(false);
      if (displayObject.body) {
        displayObject.body.enable = false;
      }
      return;
    }

    if (gameObject.getData('wampPreparedDormant') !== true) {
      return;
    }
    gameObject.setActive(gameObject.getData('wampPreparedActive') !== false);
    displayObject.setVisible?.(gameObject.getData('wampPreparedVisible') !== false);
    const bodyEnabled = gameObject.getData('wampPreparedBodyEnabled');
    if (displayObject.body && typeof bodyEnabled === 'boolean') {
      displayObject.body.enable = bodyEnabled;
    }
    gameObject.setData('wampPreparedDormant', undefined);
    gameObject.setData('wampPreparedActive', undefined);
    gameObject.setData('wampPreparedVisible', undefined);
    gameObject.setData('wampPreparedBodyEnabled', undefined);
  }

  private destroyLiveObjectWorldColliders(liveObject: LoadedRoomObject): void {
    let firstError: unknown;
    let hasError = false;
    for (const collider of liveObject.worldColliders) {
      this.colliderDormancyStates.delete(collider);
      try {
        collider.destroy();
      } catch (error) {
        if (!hasError) {
          firstError = error;
          hasError = true;
        }
      }
    }
    liveObject.worldColliders = [];
    if (hasError) throw firstError;
  }

  private shouldCollideWithLiveObject(liveObject: LoadedRoomObject): boolean {
    const body = liveObject.sprite.body as ArcadeObjectBody | null;
    return Boolean(liveObject.sprite.active && body?.enable);
  }

  private shouldCollideLiveObjectWithWorld(liveObject: LoadedRoomObject): boolean {
    const body = liveObject.sprite.body as ArcadeObjectBody | null;
    return Boolean(liveObject.sprite.active && body?.enable);
  }

  private shouldCollideLiveObjectPair(
    liveObject: LoadedRoomObject,
    obstacle: LoadedRoomObject,
  ): boolean {
    return (
      this.shouldCollideLiveObjectWithWorld(liveObject)
      && this.shouldCollideWithLiveObject(obstacle)
    );
  }

  private syncWorldObjectColliders(
    loadedRooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
  ): void {
    this.physicsReconciliationGeneration += 1;
    const rooms = Array.from(loadedRooms).filter(
      (loadedRoom) => loadedRoom.runtimeSuspended !== true,
    );
    const solidObstacles = rooms.flatMap((loadedRoom) =>
      this.getRoomLiveObjectPartition(loadedRoom).runtimeSolids.filter(
        (candidate) =>
          this.shouldCollideWithLiveObject(candidate) &&
          objectCollidesWithWorld(candidate.config)
      ).map((liveObject) => ({ loadedRoom, liveObject }))
    );
    const dynamicSolidObstacleIndexByKey = new Map(
      solidObstacles
        .filter(({ liveObject }) => this.usesDynamicObjectBody(liveObject.config))
        .map(({ liveObject }, index) => [liveObject.key, index] as const)
    );

    for (const loadedRoom of rooms) {
      for (const liveObject of loadedRoom.liveObjects) {
        this.destroyLiveObjectWorldColliders(liveObject);

        if (
          !this.shouldCollideLiveObjectWithWorld(liveObject)
          || !this.usesDynamicObjectBody(liveObject.config)
        ) {
          continue;
        }
        if (!placedObjectLayerAllowsRuntimeCollision(liveObject.config, liveObject)) {
          continue;
        }
        if (!objectCollidesWithWorld(liveObject.config)) {
          continue;
        }

        for (const collisionRoom of rooms) {
          liveObject.worldColliders.push(
            this.options.scene.physics.add.collider(
              liveObject.sprite,
              collisionRoom.terrainLayer,
              undefined,
              () => this.shouldCollideLiveObjectWithWorld(liveObject),
            )
          );
          if (collisionRoom.terrainInsetBodies) {
            liveObject.worldColliders.push(
              this.options.scene.physics.add.collider(
                liveObject.sprite,
                collisionRoom.terrainInsetBodies,
                undefined,
                () => this.shouldCollideLiveObjectWithWorld(liveObject),
              )
            );
          }
        }

        const liveObjectDynamicSolidIndex = dynamicSolidObstacleIndexByKey.get(liveObject.key);
        for (const { loadedRoom: obstacleLoadedRoom, liveObject: obstacle } of solidObstacles) {
          if (!obstacle.sprite.active || !obstacle.sprite.body || obstacle === liveObject) {
            continue;
          }

          const obstacleDynamicSolidIndex = dynamicSolidObstacleIndexByKey.get(obstacle.key);
          if (
            liveObjectDynamicSolidIndex !== undefined &&
            obstacleDynamicSolidIndex !== undefined &&
            obstacleDynamicSolidIndex <= liveObjectDynamicSolidIndex
          ) {
            continue;
          }

          if (
            isBlockSwitchObjectId(obstacle.config.id) &&
            canActorTriggerBlockSwitchByContact(liveObject)
          ) {
            liveObject.worldColliders.push(
              this.options.scene.physics.add.collider(liveObject.sprite, obstacle.sprite, () => {
                this.triggerController.handleBlockSwitchActorHit(obstacleLoadedRoom, obstacle, liveObject);
              }, () => this.shouldCollideLiveObjectPair(liveObject, obstacle))
            );
            continue;
          }

          if (
            isPushableObjectConfig(obstacle.config) &&
            this.canActorPushPushableByContact(liveObject)
          ) {
            liveObject.worldColliders.push(
              this.options.scene.physics.add.collider(liveObject.sprite, obstacle.sprite, () => {
                this.handleActorPushableContact(liveObject, obstacle);
              }, () => this.shouldCollideLiveObjectPair(liveObject, obstacle))
            );
            continue;
          }

          liveObject.worldColliders.push(
            this.options.scene.physics.add.collider(
              liveObject.sprite,
              obstacle.sprite,
              undefined,
              () => this.shouldCollideLiveObjectPair(liveObject, obstacle),
            )
          );
        }
      }
    }
  }

  private setColliderDormant(
    collider: Phaser.Physics.Arcade.Collider,
    dormant: boolean,
  ): void {
    if (dormant) {
      if (!this.colliderDormancyStates.has(collider)) {
        this.colliderDormancyStates.set(collider, collider.active);
      }
      collider.active = false;
      return;
    }

    const previousActive = this.colliderDormancyStates.get(collider);
    if (previousActive === undefined) return;
    collider.active = previousActive;
    this.colliderDormancyStates.delete(collider);
  }

  private updateFlyingEnemyObject(
    room: RoomSnapshot,
    liveObject: LoadedRoomObject,
    delta: number,
    speed: number,
    waveAmplitude: number,
    waveSpeed: number
  ): void {
    const body = liveObject.sprite.body as ArcadeObjectBody | null;
    if (!body) {
      return;
    }

    const bounds = this.getObjectHorizontalTravelBounds(room, liveObject.config);
    liveObject.runtime.elapsedMs += delta;
    const nextY =
      liveObject.runtime.baseY +
      Math.sin(liveObject.runtime.elapsedMs * waveSpeed) * waveAmplitude;

    if (isDynamicArcadeBody(body)) {
      if (this.resetDynamicObjectIfOutOfBounds(room, liveObject, body)) {
        return;
      }

      const touchingHorizontalObstacle =
        ((body.blocked.left || body.touching.left) && liveObject.runtime.directionX < 0) ||
        ((body.blocked.right || body.touching.right) && liveObject.runtime.directionX > 0);
      const reachedBounds =
        (liveObject.sprite.x <= bounds.left && liveObject.runtime.directionX < 0) ||
        (liveObject.sprite.x >= bounds.right && liveObject.runtime.directionX > 0);

      if (touchingHorizontalObstacle || reachedBounds) {
        const clampedX = Phaser.Math.Clamp(liveObject.sprite.x, bounds.left, bounds.right);
        if (clampedX !== liveObject.sprite.x) {
          body.reset(clampedX, liveObject.sprite.y);
        }
        liveObject.runtime.directionX *= -1;
      }

      const deltaSeconds = Math.max(delta / 1000, 1 / 60);
      const maxVerticalSpeed = Math.max(24, waveAmplitude * waveSpeed * 1000 * 1.5);
      let velocityY = Phaser.Math.Clamp(
        (nextY - liveObject.sprite.y) / deltaSeconds,
        -maxVerticalSpeed,
        maxVerticalSpeed
      );
      const movingIntoVerticalObstacle =
        (velocityY < 0 && (body.blocked.up || body.touching.up)) ||
        (velocityY > 0 && (body.blocked.down || body.touching.down));
      if (movingIntoVerticalObstacle) {
        velocityY = 0;
      }

      body.setVelocity(liveObject.runtime.directionX * speed, velocityY);
      this.applyDirectionalFacing(liveObject.sprite, liveObject.config, liveObject.runtime.directionX);
      return;
    }

    let nextX = liveObject.sprite.x + liveObject.runtime.directionX * speed * (delta / 1000);
    if (nextX <= bounds.left || nextX >= bounds.right) {
      nextX = Phaser.Math.Clamp(nextX, bounds.left, bounds.right);
      liveObject.runtime.directionX *= -1;
    }

    liveObject.sprite.setPosition(nextX, nextY);
    this.applyDirectionalFacing(liveObject.sprite, liveObject.config, liveObject.runtime.directionX);
    body.updateFromGameObject();
  }

  private updatePatrolEnemy(room: RoomSnapshot, liveObject: LoadedRoomObject): void {
    const body = this.getDynamicBody(liveObject.sprite);
    if (!body) {
      return;
    }

    if (this.resetDynamicObjectIfOutOfBounds(room, liveObject, body)) {
      return;
    }

    this.maybeReverseGroundEnemy(room, liveObject, body);
    const gravityDirection = this.getLiveObjectGravityDirection(liveObject);
    this.applyDirectionalFacing(
      liveObject.sprite,
      liveObject.config,
      this.getScreenFacingDirectionForGravityTangent(liveObject.runtime.directionX, gravityDirection),
    );
    this.setBodyVelocityAlongGravityTangent(
      body,
      gravityDirection,
      liveObject.runtime.directionX * this.getGroundEnemySpeed(liveObject.config.id),
    );
  }

  private updateFrogEnemy(room: RoomSnapshot, liveObject: LoadedRoomObject): void {
    const body = this.getDynamicBody(liveObject.sprite);
    if (!body) {
      return;
    }

    if (this.resetDynamicObjectIfOutOfBounds(room, liveObject, body)) {
      return;
    }

    this.maybeReverseGroundEnemy(room, liveObject, body);
    const gravityDirection = this.getLiveObjectGravityDirection(liveObject);
    const onFloor = bodyIsBlockedInGravityDirection(body, gravityDirection);

    if (onFloor) {
      this.applyDirectionalFacing(
        liveObject.sprite,
        liveObject.config,
        this.getScreenFacingDirectionForGravityTangent(liveObject.runtime.directionX, gravityDirection),
      );
      if (this.options.getCurrentTime() >= liveObject.runtime.nextActionAt) {
        this.setBodyVelocityAlongGravityTangent(
          body,
          gravityDirection,
          liveObject.runtime.directionX * this.options.settings.frogHopSpeed,
        );
        setBodyVelocityAlongVector(
          body,
          getGravityVector(gravityDirection),
          this.options.settings.frogHopVelocity,
        );
        liveObject.runtime.nextActionAt =
          this.options.getCurrentTime() + this.options.settings.frogHopDelayMs;
      } else {
        this.setBodyVelocityAlongGravityTangent(body, gravityDirection, 0);
      }
      return;
    }

    this.applyDirectionalFacing(
      liveObject.sprite,
      liveObject.config,
      this.getScreenFacingDirectionForGravityTangent(liveObject.runtime.directionX, gravityDirection),
    );
    const tangentVelocity = getBodyVelocityAlongVector(
      body,
      getGravityRightVector(gravityDirection),
    );
    if (Math.abs(tangentVelocity) < this.options.settings.frogHopSpeed * 0.8) {
      this.setBodyVelocityAlongGravityTangent(
        body,
        gravityDirection,
        liveObject.runtime.directionX * this.options.settings.frogHopSpeed,
      );
    }
  }

  private maybeReverseGroundEnemy(
    room: RoomSnapshot,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body
  ): void {
    const gravityDirection = this.getLiveObjectGravityDirection(liveObject);
    const bounds = this.getObjectTangentTravelBounds(room, liveObject.config, gravityDirection);
    const pushableAhead =
      gravityDirection === 'down' ? this.getPushableContactAhead(liveObject, body) : null;
    const pushableBlockedAhead =
      pushableAhead !== null &&
      (
        (liveObject.runtime.directionX < 0 && (pushableAhead.blocked.left || pushableAhead.touching.left)) ||
        (liveObject.runtime.directionX > 0 && (pushableAhead.blocked.right || pushableAhead.touching.right))
      );
    const touchingWall =
      this.bodyIsBlockedAlongGravityTangent(body, gravityDirection, liveObject.runtime.directionX) &&
      (pushableAhead === null || pushableBlockedAhead);
    const rightVector = getGravityRightVector(gravityDirection);
    const axisDirection =
      liveObject.runtime.directionX * (rightVector.x !== 0 ? rightVector.x : rightVector.y);
    const tangentPosition = rightVector.x !== 0 ? body.center.x : body.center.y;
    const reachedBounds =
      (tangentPosition <= bounds.min && axisDirection < 0) ||
      (tangentPosition >= bounds.max && axisDirection > 0);
    const onFloor = bodyIsBlockedInGravityDirection(body, gravityDirection);
    const missingGroundAhead =
      onFloor &&
      this.groundEnemyAvoidsEdges(liveObject.config.id) &&
      !this.hasGroundEnemySupportOrSpecialTileAhead(
        room,
        body,
        liveObject.runtime.directionX,
        gravityDirection,
      );

    if (touchingWall || reachedBounds || missingGroundAhead) {
      liveObject.runtime.directionX *= -1;
    }
  }

  private canActorPushPushableByContact(liveObject: LoadedRoomObject): boolean {
    return liveObject.config.id === 'penguin';
  }

  private handleActorPushableContact(
    actor: LoadedRoomObject,
    pushable: LoadedRoomObject,
  ): void {
    if (!this.canActorPushPushableByContact(actor)) {
      return;
    }

    const actorBody = this.getDynamicBody(actor.sprite);
    const pushableBody = this.getDynamicBody(pushable.sprite);
    if (!actorBody || !pushableBody) {
      return;
    }

    const directionX = actor.runtime.directionX >= 0 ? 1 : -1;
    const actorBounds = getArcadeBodyBounds(actorBody);
    const pushableBounds = getArcadeBodyBounds(pushableBody);
    const verticalOverlap =
      Math.min(actorBounds.bottom, pushableBounds.bottom) -
      Math.max(actorBounds.top, pushableBounds.top);
    const sideContact =
      directionX > 0
        ? actorBounds.right <= pushableBounds.right && actorBounds.centerX < pushableBounds.centerX
        : actorBounds.left >= pushableBounds.left && actorBounds.centerX > pushableBounds.centerX;
    if (verticalOverlap < Math.min(8, actorBounds.height * 0.5) || !sideContact) {
      return;
    }

    pushableBody.setVelocityX(directionX * this.options.settings.penguinSpeed);
  }

  private getPushableContactAhead(
    actor: LoadedRoomObject,
    actorBody: Phaser.Physics.Arcade.Body,
  ): Phaser.Physics.Arcade.Body | null {
    if (!this.canActorPushPushableByContact(actor)) {
      return null;
    }

    const directionX = actor.runtime.directionX >= 0 ? 1 : -1;
    const actorBounds = getArcadeBodyBounds(actorBody);
    for (const candidate of this.getPushableLiveObjectsInBounds(actorBounds, 3, 2)) {
      if (
        candidate === actor ||
        !candidate.sprite.active ||
        !isDynamicArcadeBody(candidate.sprite.body as ArcadeObjectBody | null)
      ) {
        continue;
      }

      const candidateBody = candidate.sprite.body as Phaser.Physics.Arcade.Body;
      const candidateBounds = getArcadeBodyBounds(candidateBody);
      const verticalOverlap =
        Math.min(actorBounds.bottom, candidateBounds.bottom) -
        Math.max(actorBounds.top, candidateBounds.top);
      if (verticalOverlap < Math.min(8, actorBounds.height * 0.5)) {
        continue;
      }

      const horizontalGap =
        directionX > 0
          ? candidateBounds.left - actorBounds.right
          : actorBounds.left - candidateBounds.right;
      if (horizontalGap >= -2 && horizontalGap <= 3) {
        return candidateBody;
      }
    }

    return null;
  }

  private applyDirectionalFacing(
    sprite: Phaser.GameObjects.Sprite,
    config: GameObjectConfig,
    directionX: number
  ): void {
    if (!config.facingDirection || directionX === 0) {
      return;
    }

    const facingRight = directionX > 0;
    sprite.setFlipX(config.facingDirection === 'right' ? !facingRight : facingRight);
  }

  private syncLiveObjectGravityPresentation(liveObject: LoadedRoomObject): void {
    const shouldRotateWithGravity =
      liveObject.config.category === 'enemy' &&
      this.shouldLiveObjectUseSpecialTilePhysics(liveObject);
    const gravityDirection = shouldRotateWithGravity
      ? this.getLiveObjectGravityDirection(liveObject)
      : 'down';
    liveObject.sprite.setRotation(getGravityAngle(gravityDirection));

    if (!shouldRotateWithGravity || !liveObject.config.facingDirection) {
      return;
    }

    const body = this.getDynamicBody(liveObject.sprite);
    const tangentVelocity = body
      ? getBodyVelocityAlongVector(body, getGravityRightVector(gravityDirection))
      : 0;
    const fallbackDirectionX =
      liveObject.config.id === SWORDSMAN_AI_OBJECT_ID
        ? liveObject.runtime.aiFacingDirectionX
        : liveObject.runtime.directionX;
    const directionX =
      Math.abs(tangentVelocity) > 4 ? Math.sign(tangentVelocity) : fallbackDirectionX;
    this.applyDirectionalFacing(
      liveObject.sprite,
      liveObject.config,
      this.getScreenFacingDirectionForGravityTangent(directionX, gravityDirection),
    );
  }

  private getPlacedObjectRuntimeDepth(placedObject: Pick<RoomSnapshot['placedObjects'][number], 'layer'>): number {
    switch (getPlacedObjectLayer(placedObject)) {
      case 'background':
        return 9.5;
      case 'foreground':
        return 28;
      case 'terrain':
      default:
        return 18;
    }
  }

  private resetDynamicObjectIfOutOfBounds(
    room: RoomSnapshot,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body
  ): boolean {
    const bounds = this.getObjectResetWorldBounds(room, liveObject.config);
    const margin = this.options.settings.respawnFallDistance;
    if (
      body.right >= bounds.left - margin &&
      body.left <= bounds.right + margin &&
      body.bottom >= bounds.top - margin &&
      body.top <= bounds.bottom + margin
    ) {
      return false;
    }

    liveObject.runtime.directionX = liveObject.runtime.initialDirectionX;
    liveObject.runtime.gravityDirection = 'down';
    liveObject.runtime.gravityRoomId = room.id;
    liveObject.runtime.inWater = false;
    liveObject.runtime.specialTileWindX = 0;
    liveObject.runtime.specialTileOnIce = false;
    liveObject.runtime.specialTileOnSticky = false;
    liveObject.runtime.specialTileOnBounce = false;
    liveObject.runtime.specialTileOnDamage = false;
    liveObject.runtime.npcBounceCooldownUntil = 0;
    liveObject.runtime.npcQuicksandUntil = 0;
    liveObject.runtime.elapsedMs = 0;
    liveObject.runtime.nextActionAt = this.options.getCurrentTime() + 250;
    body.reset(liveObject.runtime.baseX, liveObject.runtime.baseY);
    liveObject.sprite.setPosition(liveObject.runtime.baseX, liveObject.runtime.baseY);
    body.setAllowGravity(this.liveObjectUsesGravity(liveObject));
    if (liveObject.config.id === SWORDSMAN_AI_OBJECT_ID) {
      this.swordsmanController.resetFacingMemory(liveObject, liveObject.runtime.initialDirectionX);
      this.swordsmanController.applyFacing(liveObject, body, liveObject.runtime.initialDirectionX, {
        force: true,
      });
    } else {
      this.applyDirectionalFacing(
        liveObject.sprite,
        liveObject.config,
        liveObject.runtime.initialDirectionX
      );
    }
    body.setVelocity(0, 0);
    return true;
  }

  private hasGroundEnemySupportOrSpecialTileAhead(
    room: RoomSnapshot,
    body: Phaser.Physics.Arcade.Body,
    directionX: number,
    gravityDirection: PlayerGravityDirection,
    leadPx = 4,
  ): boolean {
    const probe = this.getGroundEnemySupportProbePoint(body, directionX, gravityDirection, leadPx);
    return (
      this.hasSolidTerrainAtWorldPoint(room, probe.x, probe.y) ||
      this.hasEdgeSafeSpecialTileAtWorldPoint(room, probe.x, probe.y)
    );
  }

  private getGroundEnemySupportProbePoint(
    body: Phaser.Physics.Arcade.Body,
    directionX: number,
    gravityDirection: PlayerGravityDirection,
    leadPx: number,
  ): { x: number; y: number } {
    const gravityVector = getGravityVector(gravityDirection);
    const rightVector = getGravityRightVector(gravityDirection);
    const tangentHalfExtent = rightVector.x !== 0 ? body.halfWidth : body.halfHeight;
    const gravityHalfExtent = gravityVector.x !== 0 ? body.halfWidth : body.halfHeight;
    return {
      x:
        body.center.x +
        rightVector.x * directionX * (tangentHalfExtent + leadPx) +
        gravityVector.x * (gravityHalfExtent + 2),
      y:
        body.center.y +
        rightVector.y * directionX * (tangentHalfExtent + leadPx) +
        gravityVector.y * (gravityHalfExtent + 2),
    };
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

  private hasEdgeSafeSpecialTileAtWorldPoint(
    room: RoomSnapshot,
    worldX: number,
    worldY: number,
  ): boolean {
    const roomOrigin = this.options.getRoomOrigin(room.coordinates);
    const localX = Math.floor((worldX - roomOrigin.x) / TILE_SIZE);
    const localY = Math.floor((worldY - roomOrigin.y) / TILE_SIZE);

    if (localX < 0 || localX >= ROOM_WIDTH || localY < 0 || localY >= ROOM_HEIGHT) {
      return false;
    }

    for (const layerName of LAYER_NAMES) {
      const gid = decodeTileDataValue(room.tileData[layerName][localY][localX]).gid;
      const specialKind = getSpecialTileKindForGid(gid);
      if (specialKind && GROUND_ENEMY_EDGE_SAFE_SPECIAL_TILE_KINDS.has(specialKind)) {
        return true;
      }
    }

    return false;
  }

  private groundEnemyAvoidsEdges(objectId: string): boolean {
    return objectId !== 'penguin';
  }

  private getObjectHorizontalTravelBounds(
    room: RoomSnapshot,
    config: GameObjectConfig
  ): { left: number; right: number } {
    const bounds = this.getRoomWorldBounds(room);
    const halfWidth = Math.max(4, (config.bodyWidth > 0 ? config.bodyWidth : config.frameWidth) * 0.5);
    return {
      left: bounds.left + halfWidth + 2,
      right: bounds.right - halfWidth - 2,
    };
  }

  private getObjectTangentTravelBounds(
    room: RoomSnapshot,
    config: GameObjectConfig,
    gravityDirection: PlayerGravityDirection,
  ): { min: number; max: number } {
    const bounds = this.getObjectTravelWorldBounds(room, config);
    const rightVector = getGravityRightVector(gravityDirection);
    if (rightVector.x !== 0) {
      const halfWidth = Math.max(4, (config.bodyWidth > 0 ? config.bodyWidth : config.frameWidth) * 0.5);
      return {
        min: bounds.left + halfWidth + 2,
        max: bounds.right - halfWidth - 2,
      };
    }

    const halfHeight = Math.max(4, (config.bodyHeight > 0 ? config.bodyHeight : config.frameHeight) * 0.5);
    return {
      min: bounds.top + halfHeight + 2,
      max: bounds.bottom - halfHeight - 2,
    };
  }

  private getObjectTravelWorldBounds(
    room: RoomSnapshot,
    config: GameObjectConfig,
  ): { left: number; right: number; top: number; bottom: number } {
    if (this.usesLoadedRoomTravelBounds(config.id)) {
      return this.getLoadedFullRoomWorldBounds() ?? this.getRoomWorldBounds(room);
    }

    return this.getRoomWorldBounds(room);
  }

  private getObjectResetWorldBounds(
    room: RoomSnapshot,
    config: GameObjectConfig,
  ): { left: number; right: number; top: number; bottom: number } {
    if (this.usesLoadedRoomTravelBounds(config.id)) {
      return this.getLoadedFullRoomWorldBounds() ?? this.getRoomWorldBounds(room);
    }

    return this.getRoomWorldBounds(room);
  }

  private usesLoadedRoomTravelBounds(objectId: string): boolean {
    return objectId === 'penguin';
  }

  private getLoadedFullRoomWorldBounds(): { left: number; right: number; top: number; bottom: number } | null {
    let bounds: { left: number; right: number; top: number; bottom: number } | null = null;

    for (const loadedRoom of this.options.getLoadedFullRooms()) {
      const roomBounds = this.getRoomWorldBounds(loadedRoom.room);
      if (!bounds) {
        bounds = { ...roomBounds };
        continue;
      }

      bounds.left = Math.min(bounds.left, roomBounds.left);
      bounds.right = Math.max(bounds.right, roomBounds.right);
      bounds.top = Math.min(bounds.top, roomBounds.top);
      bounds.bottom = Math.max(bounds.bottom, roomBounds.bottom);
    }

    return bounds;
  }

  private getRoomWorldBounds(room: RoomSnapshot): { left: number; right: number; top: number; bottom: number } {
    const roomOrigin = this.options.getRoomOrigin(room.coordinates);
    return {
      left: roomOrigin.x,
      right: roomOrigin.x + ROOM_PX_WIDTH,
      top: roomOrigin.y,
      bottom: roomOrigin.y + ROOM_PX_HEIGHT,
    };
  }

  private getLiveObjectGravityDirection(liveObject: LoadedRoomObject): PlayerGravityDirection {
    return liveObject.runtime.gravityDirection ?? 'down';
  }

  private setBodyVelocityAlongGravityTangent(
    body: Phaser.Physics.Arcade.Body,
    gravityDirection: PlayerGravityDirection,
    velocity: number,
  ): void {
    setBodyVelocityAlongVector(body, getGravityRightVector(gravityDirection), velocity);
  }

  private getScreenFacingDirectionForGravityTangent(
    directionX: number,
    gravityDirection: PlayerGravityDirection,
  ): number {
    const tangentFacing = directionX < 0 ? -1 : 1;
    return gravityDirection === 'left' || gravityDirection === 'right'
      ? (tangentFacing === 1 ? -1 : 1)
      : tangentFacing;
  }

  private bodyIsBlockedAlongGravityTangent(
    body: Phaser.Physics.Arcade.Body,
    gravityDirection: PlayerGravityDirection,
    directionX: number,
  ): boolean {
    const rightVector = getGravityRightVector(gravityDirection);
    return this.bodyIsBlockedAlongVector(body, {
      x: (rightVector.x * directionX) as DirectionVector['x'],
      y: (rightVector.y * directionX) as DirectionVector['y'],
    });
  }

  private bodyIsBlockedAlongVector(
    body: Phaser.Physics.Arcade.Body,
    vector: DirectionVector,
  ): boolean {
    if (vector.x < 0) {
      return Boolean(body.blocked.left || body.touching.left);
    }
    if (vector.x > 0) {
      return Boolean(body.blocked.right || body.touching.right);
    }
    if (vector.y < 0) {
      return Boolean(body.blocked.up || body.touching.up);
    }
    if (vector.y > 0) {
      return Boolean(body.blocked.down || body.touching.down);
    }
    return false;
  }

  private usesDynamicObjectBody(config: GameObjectConfig): boolean {
    return isDynamicRuntimeObjectConfig(config);
  }

  private objectUsesGravity(config: GameObjectConfig): boolean {
    return (
      config.behavior !== 'fly' &&
      config.id !== 'cannon_bullet' &&
      config.id !== 'fireball' &&
      config.id !== 'cage' &&
      !isMovingPlatformObjectId(config.id)
    );
  }

  private liveObjectUsesGravity(liveObject: LoadedRoomObject): boolean {
    if (liveObject.config.category === 'npc') {
      return (
        liveObject.layer === 'terrain' &&
        (liveObject.runtime.npcMode !== 'idle' || liveObject.runtime.npcPushable)
      );
    }
    return this.objectUsesGravity(liveObject.config);
  }

  private createLadderTopSupport(sprite: Phaser.GameObjects.Sprite): Phaser.GameObjects.Zone | null {
    const ladderBody = sprite.body as ArcadeObjectBody | null;
    if (!ladderBody) {
      return null;
    }

    const width = Math.max(16, ladderBody.width + 2);
    const height = 6;
    const centerX = sprite.x;
    const top = ladderBody.top + 2;
    const centerY = top + height * 0.5;
    const supportZone = this.options.scene.add.zone(centerX, centerY, width, height);
    this.options.scene.physics.add.existing(supportZone, true);
    const supportBody = supportZone.body as Phaser.Physics.Arcade.StaticBody | null;
    supportBody?.setSize(width, height);
    supportBody?.updateFromGameObject();
    return supportZone;
  }

  private shouldCollideWithLadderTopSupport(
    playerBody: Phaser.Physics.Arcade.Body,
    supportBody: ArcadeObjectBody
  ): boolean {
    if (this.options.isPlayerClimbingLadder() || this.options.isLadderDropRequested()) {
      return false;
    }

    if (playerBody.velocity.y < -4) {
      return false;
    }

    return playerBody.bottom <= supportBody.top + 10;
  }

  private getObjectBodyOffset(config: GameObjectConfig): [number, number] {
    return getObjectRuntimeBodyOffset(config);
  }

  private getDynamicBody(sprite: Phaser.GameObjects.Sprite): Phaser.Physics.Arcade.Body | null {
    const body = sprite.body as ArcadeObjectBody | null;
    return isDynamicArcadeBody(body) ? body : null;
  }

  private getGroundEnemySpeed(objectId: string): number {
    switch (objectId) {
      case 'crab':
        return this.options.settings.crabSpeed;
      case 'slime_blue':
      case 'slime_red':
        return this.options.settings.slimeSpeed;
      case 'bear_brown':
      case 'bear_polar':
        return this.options.settings.penguinSpeed * 0.76;
      case 'chicken':
        return this.options.settings.penguinSpeed * 1.1;
      case 'penguin':
        return this.options.settings.penguinSpeed;
      case 'snake':
      default:
        return this.options.settings.snakeSpeed;
    }
  }

  private maybeBreakBrickBox(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
  ): void {
    if (liveObject.config.id !== 'brick_box' || !liveObject.sprite.active) {
      return;
    }

    const playerBody = this.options.getPlayerBody();
    const brickBody = liveObject.sprite.body as ArcadeObjectBody | null;
    if (!playerBody || !brickBody) {
      return;
    }
    if (this.maybeBreakButtStompableObject(loadedRoom, liveObject)) {
      return;
    }

    const upwardDelta =
      typeof playerBody.deltaY === 'function'
        ? playerBody.deltaY()
        : playerBody.y - (playerBody.prev?.y ?? playerBody.y);
    const hitFromBelow =
      upwardDelta < -0.5 &&
      playerBody.center.y >= brickBody.center.y - 2 &&
      playerBody.top <= brickBody.bottom + 2;
    if (!hitFromBelow) {
      return;
    }

    if (playerBody.velocity.y < -40) {
      playerBody.setVelocityY(-40);
    }

    this.breakBrickBox(loadedRoom, liveObject);
  }

  private maybeBreakButtStompableObject(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
  ): boolean {
    if (
      !this.isButtStompBreakableObject(liveObject) ||
      !this.options.isPlayerButtStomping() ||
      !liveObject.sprite.active
    ) {
      return false;
    }

    const playerBody = this.options.getPlayerBody();
    const objectBody = liveObject.sprite.body as ArcadeObjectBody | null;
    if (!playerBody || !objectBody) {
      return false;
    }
    if (!this.isPlayerButtStompImpactFromAbove(playerBody, objectBody)) {
      return false;
    }

    this.options.handlePlayerButtStompImpact(BUTT_STOMP_BREAK_BOUNCE_VELOCITY);
    if (liveObject.config.id === 'brick_box') {
      this.breakBrickBoxButtStompStack(loadedRoom, liveObject);
      return true;
    }

    this.breakLiveObjectWithAnimation(loadedRoom, liveObject, 'crate_break_anim');
    return true;
  }

  private isButtStompBreakableObject(liveObject: LoadedRoomObject): boolean {
    return liveObject.config.id === 'brick_box' || liveObject.config.id === 'crate';
  }

  private breakBrickBoxButtStompStack(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    topBrick: LoadedRoomObject,
  ): void {
    const bricks = this.collectBrickBoxButtStompStack(loadedRoom, topBrick);
    for (const brick of bricks) {
      if (brick.sprite.active) {
        this.breakBrickBox(loadedRoom, brick);
      }
    }
  }

  private collectBrickBoxButtStompStack(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    topBrick: LoadedRoomObject,
  ): LoadedRoomObject[] {
    const topBody = topBrick.sprite.body as ArcadeObjectBody | null;
    if (!topBody) {
      return [topBrick];
    }

    const stack: LoadedRoomObject[] = [topBrick];
    const visited = new Set<LoadedRoomObject>(stack);
    const columnBounds = getArcadeBodyBounds(topBody);
    let cursorBottom = columnBounds.bottom;

    while (true) {
      let next: { liveObject: LoadedRoomObject; bounds: Phaser.Geom.Rectangle } | null = null;
      for (const candidate of loadedRoom.liveObjects) {
        if (
          visited.has(candidate) ||
          candidate.config.id !== 'brick_box' ||
          !candidate.sprite.active
        ) {
          continue;
        }

        const body = candidate.sprite.body as ArcadeObjectBody | null;
        if (!body) {
          continue;
        }

        const bounds = getArcadeBodyBounds(body);
        const verticalGap = bounds.top - cursorBottom;
        if (
          verticalGap < -BUTT_STOMP_BREAK_STACK_VERTICAL_GAP_TOLERANCE_PX ||
          verticalGap > BUTT_STOMP_BREAK_STACK_VERTICAL_GAP_TOLERANCE_PX
        ) {
          continue;
        }

        const columnOverlap =
          Math.min(columnBounds.right, bounds.right) -
          Math.max(columnBounds.left, bounds.left);
        if (columnOverlap < BUTT_STOMP_BREAK_MIN_HORIZONTAL_OVERLAP_PX) {
          continue;
        }

        if (!next || bounds.top < next.bounds.top) {
          next = { liveObject: candidate, bounds };
        }
      }

      if (!next) {
        break;
      }

      stack.push(next.liveObject);
      visited.add(next.liveObject);
      cursorBottom = next.bounds.bottom;
    }

    return stack;
  }

  private isPlayerButtStompImpactFromAbove(
    playerBody: Phaser.Physics.Arcade.Body,
    objectBody: ArcadeObjectBody,
  ): boolean {
    const playerBounds = getArcadeBodyBounds(playerBody);
    const objectBounds = getArcadeBodyBounds(objectBody);
    const horizontalOverlap =
      Math.min(playerBounds.right, objectBounds.right) -
      Math.max(playerBounds.left, objectBounds.left);
    if (horizontalOverlap < BUTT_STOMP_BREAK_MIN_HORIZONTAL_OVERLAP_PX) {
      return false;
    }

    const downwardDelta =
      typeof playerBody.deltaY === 'function'
        ? playerBody.deltaY()
        : playerBody.y - (playerBody.prev?.y ?? playerBody.y);
    const separatedDown = Boolean(playerBody.blocked?.down) || Boolean(playerBody.touching?.down);
    const movingDown = separatedDown || playerBody.velocity.y > 40 || downwardDelta > 0.5;
    return (
      movingDown &&
      playerBounds.centerY < objectBounds.centerY &&
      playerBounds.bottom <= objectBounds.top + BUTT_STOMP_BREAK_TOP_TOLERANCE_PX
    );
  }

  private breakBrickBox(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
  ): void {
    this.breakLiveObjectWithAnimation(loadedRoom, liveObject, 'brick_box_break_anim');
  }

  private breakLiveObjectWithAnimation(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    animationKey: string,
  ): void {
    const sprite = liveObject.sprite;
    const body = sprite.body as ArcadeObjectBody | null;
    const removalReason: LiveObjectExplicitRemovalReason =
      liveObject.config.id === 'crate' ? 'crate-broken' : 'brick-broken';
    const canPlayBreakAnimation = isAnimationSafelyPlayable(
      this.options.scene.anims,
      animationKey,
    );

    if (canPlayBreakAnimation) {
      sprite.play(animationKey);
      sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        sprite.destroy();
      });
    }
    const revealedObject = this.revealContainedObjectFromBrokenContainer(loadedRoom, liveObject);
    this.emitLiveObjectRemovedForObject(loadedRoom, liveObject, removalReason);
    this.destroyLiveObjectInteractions(liveObject);
    this.destroyLiveObjectWorldColliders(liveObject);
    this.destroyLiveObjectHelpers(liveObject);
    if (body) {
      body.enable = false;
    }
    loadedRoom.liveObjects = loadedRoom.liveObjects.filter((candidate) => candidate !== liveObject);
    this.syncWorldObjectColliders(this.options.getLoadedFullRooms());
    if (revealedObject) {
      this.syncLiveObjectInteractions([loadedRoom]);
    }

    if (!canPlayBreakAnimation) {
      sprite.destroy();
    }
  }

  private removeLiveObject(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    reason: LiveObjectExplicitRemovalReason = 'object-removed',
  ): void {
    const revealedObject = this.revealContainedObjectFromBrokenContainer(loadedRoom, liveObject);
    this.emitLiveObjectRemovedForObject(loadedRoom, liveObject, reason);
    this.destroyLiveObjectInteractions(liveObject);
    this.destroyLiveObjectWorldColliders(liveObject);
    this.destroyLiveObjectHelpers(liveObject);
    liveObject.sprite.destroy();
    loadedRoom.liveObjects = loadedRoom.liveObjects.filter((candidate) => candidate !== liveObject);
    this.syncWorldObjectColliders(this.options.getLoadedFullRooms());
    if (revealedObject) {
      this.syncLiveObjectInteractions([loadedRoom]);
    }
  }

  private revealContainedObjectFromBrokenContainer(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    container: LoadedRoomObject,
  ): LoadedRoomObject | null {
    if (!container.containedObjectId) {
      return null;
    }

    const containedConfig = getObjectById(container.containedObjectId);
    if (!containedConfig || !canObjectBeStoredInContainer(container.config.id, containedConfig)) {
      return null;
    }

    const roomOrigin = this.options.getRoomOrigin(loadedRoom.room.coordinates);
    const x = container.sprite.x - roomOrigin.x;
    const y = container.sprite.y - roomOrigin.y + this.getContainedObjectRevealYOffset(container);
    const key = getContainedLiveObjectKey(container.key, container.containedObjectId);
    if (this.options.isCollectedObjectKey(key)) {
      return null;
    }

    const liveObject = this.createLiveObjectEntry(loadedRoom, {
      key,
      config: containedConfig,
      x,
      y,
      facing: container.runtime.directionX >= 0 ? 'right' : 'left',
      layer: container.layer,
      baseTimeSeed: x + y,
      placedInstanceId: null,
      linkedTargetRoomId: null,
      linkedTargetInstanceId: null,
      linkedTargetInstanceIds: [],
      linkedTargetWorldX: null,
      linkedTargetWorldY: null,
      containedObjectId: null,
      signText: null,
      objectiveMode: null,
      defeatMode: null,
      policeBehaviorMode: null,
      policePatrolShoots: null,
      countsTowardGoals: true,
    });
    if (!liveObject) {
      return null;
    }

    loadedRoom.liveObjects.push(liveObject);
    return liveObject;
  }

  private getContainedObjectRevealYOffset(container: LoadedRoomObject): number {
    switch (container.config.id) {
      case 'brick_box':
      case 'treasure_chest':
        return -12;
      case 'crate':
        return -10;
      default:
        return 0;
    }
  }

  private collectLiveObject(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    options: {
      collector?: 'player' | 'enemy';
    } = {},
  ): void {
    collectLiveObjectWithFx(loadedRoom, liveObject, {
      scene: this.options.scene,
      isCollectedObjectKey: this.options.isCollectedObjectKey,
      markCollectedObjectKey: this.options.markCollectedObjectKey,
      addScore: this.options.addScore,
      onKeyCollected: this.options.onKeyCollected,
      playRoomSfx: this.options.playRoomSfx,
      playCollectFx: this.options.playCollectFx,
      showTransientStatus: this.options.showTransientStatus,
      getRoomOrigin: this.options.getRoomOrigin,
      onCollectibleCollected: this.options.onCollectibleCollected,
      onEnemyCollectibleCollected: this.options.onEnemyCollectibleCollected,
      onLiveObjectRemoved: (event) => this.emitLiveObjectRemoved(event),
      destroyLiveObjectInteractions: (target) => this.destroyLiveObjectInteractions(target),
    }, options);
  }

  private emitLiveObjectRemovedForObject(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    reason: LiveObjectExplicitRemovalReason,
  ): void {
    if (!liveObject.sprite.active) {
      return;
    }
    const roomOrigin = this.options.getRoomOrigin(loadedRoom.room.coordinates);
    this.emitLiveObjectRemoved({
      roomId: loadedRoom.room.id,
      roomCoordinates: loadedRoom.room.coordinates,
      objectKey: liveObject.key,
      objectId: liveObject.config.id,
      instanceId: liveObject.placedInstanceId,
      reason,
      x: liveObject.sprite.x - roomOrigin.x,
      y: liveObject.sprite.y - roomOrigin.y,
    });
  }

  private emitLiveObjectRemoved(event: LiveObjectRemovedEvent): void {
    if (this.roomStateEventSuppressionDepth > 0) {
      return;
    }
    this.options.onLiveObjectRemoved(event);
  }

  private emitRoomSwitchStateChanged(
    event: LiveObjectSwitchStateChangedEvent,
  ): void {
    if (this.roomStateEventSuppressionDepth > 0) {
      return;
    }
    this.options.onRoomSwitchStateChanged(event);
  }

  private withSuppressedRoomStateEvents(callback: () => void): void {
    this.roomStateEventSuppressionDepth += 1;
    try {
      callback();
    } finally {
      this.roomStateEventSuppressionDepth = Math.max(0, this.roomStateEventSuppressionDepth - 1);
    }
  }
}
