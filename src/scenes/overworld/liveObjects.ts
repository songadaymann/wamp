import Phaser from 'phaser';
import type { SfxCue } from '../../audio/sfx';
import {
  decodeTileDataValue,
  getObjectDefaultFrame,
  getObjectDisplayOffset,
  getObjectDisplayScale,
  getObjectRuntimeBodyOffset,
  objectCollidesWithWorld,
  placedObjectLayerAllowsRuntimeCollision,
  isDynamicRuntimeObjectConfig,
  isBlockSwitchObjectId,
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
import { GHOST_OBJECT_ID } from '../../enemies/ghost';
import {
  SWORDSMAN_AI_OBJECT_ID,
  type SwordsmanAiState,
} from '../../enemies/swordsmanAi';
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
import { collectLiveObject as collectLiveObjectWithFx } from './liveObjects/collection';
import {
  canActorTriggerBlockSwitchByContact,
} from './liveObjects/triggers';
import { LiveObjectTriggerController } from './liveObjects/triggerController';
import { LiveObjectHazardController } from './liveObjects/hazardController';
import { LiveObjectEnemyLifecycleController } from './liveObjects/enemyLifecycle';
import { LiveObjectSwordsmanController } from './liveObjects/swordsmanController';

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
  initialDirectionX: number;
  directionX: number;
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
  pressureActive: boolean;
  triggerLatched: boolean;
}

export interface LoadedRoomObject {
  key: string;
  placedInstanceId: string | null;
  linkedTargetRoomId: string | null;
  linkedTargetInstanceId: string | null;
  linkedTargetWorldX: number | null;
  linkedTargetWorldY: number | null;
  containedObjectId: string | null;
  signText: string | null;
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
  getGravityPlateDirectionForBody: (
    body: Phaser.Physics.Arcade.Body,
    currentGravityDirection: PlayerGravityDirection,
  ) => PlayerGravityDirection | null;
  getBodyRoomId: (body: Phaser.Physics.Arcade.Body) => string;
  isBodyInWater: (body: Phaser.Physics.Arcade.Body) => boolean;
  swordsmanTraversalPlannerMode: SwordsmanTraversalPlannerMode;
  isPlayerClimbingLadder: () => boolean;
  isLadderDropRequested: () => boolean;
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

const MOVING_PLATFORM_CARRY_MAX_UPWARD_PLAYER_SPEED = -60;
const MOVING_PLATFORM_CARRY_EDGE_INSET_PX = 1;
const MOVING_PLATFORM_CARRY_HOVER_TOLERANCE_PX = 10;
const MOVING_PLATFORM_CARRY_PENETRATION_TOLERANCE_PX = 8;
const MOVING_PLATFORM_OBJECT_CARRY_HOVER_TOLERANCE_PX = TILE_SIZE + 2;
const MOVING_PLATFORM_OBJECT_CARRY_PENETRATION_TOLERANCE_PX = 8;
const LIVE_OBJECT_CONVEYOR_SPEED = 48;
const LIVE_OBJECT_GRAVITY_ACCELERATION = 700;
const LIVE_OBJECT_MAX_GRAVITY_SPEED = 500;
const LIVE_OBJECT_WATER_GRAVITY_FACTOR = 0.35;
const LIVE_OBJECT_WATER_MAX_GRAVITY_SPEED = 118;
const LIVE_OBJECT_WATER_DAMPING_FACTOR = 0.965;
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
  linkedTargetWorldX?: number | null;
  linkedTargetWorldY?: number | null;
  containedObjectId: string | null;
  signText: string | null;
  objectiveMode?: SwordsmanObjectiveMode | null;
  defeatMode?: SwordsmanDefeatMode | null;
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
  | 'collectible-collected'
  | 'enemy-collected'
  | 'object-removed'
  | 'brick-broken';

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

export class OverworldLiveObjectController<TEdgeWall = unknown> {
  private readonly triggerController: LiveObjectTriggerController<TEdgeWall>;
  private readonly hazardController: LiveObjectHazardController<TEdgeWall>;
  private readonly swordsmanController: LiveObjectSwordsmanController<TEdgeWall>;
  private readonly enemyLifecycleController: LiveObjectEnemyLifecycleController<TEdgeWall>;
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
    for (let index = 0; index < loadedRoom.room.placedObjects.length; index += 1) {
      const placedObject = loadedRoom.room.placedObjects[index];
      const config = getEditorObjectConfigById(placedObject.id);
      if (!config) {
        continue;
      }

      const objectKey = this.options.getPlacedObjectRuntimeKey(loadedRoom.room.id, placedObject, index);
      if (this.options.isCollectedObjectKey(objectKey)) {
        continue;
      }

      const liveObject = this.createLiveObjectEntry(loadedRoom, {
        key: objectKey,
        config,
        x: placedObject.x,
        y: placedObject.y,
        facing: placedObject.facing,
        layer: placedObject.layer,
        baseTimeSeed: placedObject.x + placedObject.y,
        placedInstanceId: placedObject.instanceId,
        linkedTargetRoomId: placedObject.triggerTargetInstanceId ? loadedRoom.room.id : null,
        linkedTargetInstanceId: placedObject.triggerTargetInstanceId ?? null,
        linkedTargetWorldX: null,
        linkedTargetWorldY: null,
        containedObjectId: placedObject.containedObjectId ?? null,
        signText: placedObject.signText ?? null,
        objectiveMode: placedObject.swordsmanObjectiveMode ?? null,
        defeatMode: placedObject.swordsmanDefeatMode ?? null,
        countsTowardGoals: true,
      });
      if (liveObject) {
        loadedRoom.liveObjects.push(liveObject);
      }
    }

    this.triggerController.applySwitchBlockStates(loadedRoom);
    this.syncWorldObjectColliders(this.options.getLoadedFullRooms());
  }

  destroyLiveObjects(loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>): void {
    this.triggerController.clearBlockSwitchActorLatchesForRoom(loadedRoom);
    this.triggerController.clearPressureTriggerStatesForRoom(loadedRoom);
    for (const liveObject of loadedRoom.liveObjects) {
      this.destroyLiveObjectInteractions(liveObject);
      this.destroyLiveObjectWorldColliders(liveObject);
      this.destroyLiveObjectHelpers(liveObject);
      liveObject.sprite.destroy();
    }

    loadedRoom.liveObjects = [];
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
      linkedTargetWorldX = null,
      linkedTargetWorldY = null,
      containedObjectId,
      signText,
      objectiveMode = null,
      defeatMode = null,
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
      if (this.options.scene.anims.exists(animationKey)) {
        sprite.play(animationKey);
      }
    }

    if (config.id === 'lightning') {
      sprite.stop();
      sprite.setVisible(false);
    }
    if (config.id === 'door_metal') {
      sprite.setTint(0xb8c4d8);
    }
    if (config.id === 'trapdoor_metal') {
      sprite.setTint(0xb8c4d8);
    }
    if (
      config.bodyWidth > 0 &&
      config.bodyHeight > 0 &&
      placedObjectLayerAllowsRuntimeCollision(config, { layer: normalizedLayer })
    ) {
      if (this.usesDynamicObjectBody(config)) {
        this.options.scene.physics.add.existing(sprite);
        const body = sprite.body as Phaser.Physics.Arcade.Body;
        body.setSize(config.bodyWidth, config.bodyHeight, true);
        body.setOffset(...this.getObjectBodyOffset(config));
        body.setCollideWorldBounds(false);
        body.setAllowGravity(this.objectUsesGravity(config));
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
      linkedTargetWorldX,
      linkedTargetWorldY,
      containedObjectId,
      signText,
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
        swordsmanTraversalPlannerMode: this.options.swordsmanTraversalPlannerMode,
      }),
    };

    this.triggerController.initializePressureControlledObjectState(liveObject);

    return liveObject;
  }

  syncLiveObjectInteractions(loadedRooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>): void {
    const player = this.options.getPlayer();
    const playerPickupSensor = this.options.getPlayerPickupSensor();
    const playerBody = this.options.getPlayerBody();

    for (const loadedRoom of loadedRooms) {
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
          case 'platform':
            if (liveObject.config.id === 'brick_box') {
              liveObject.interactions.push(
                this.options.scene.physics.add.collider(player, liveObject.sprite, () => {
                  this.maybeBreakBrickBox(loadedRoom, liveObject);
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
            } else if (liveObject.config.id === 'door_locked') {
              liveObject.interactions.push(
                this.options.scene.physics.add.collider(player, liveObject.sprite, () => {
                  this.triggerController.handleLockedDoorContact(loadedRoom, liveObject);
                }, () => this.shouldCollideWithLiveObject(liveObject))
              );
            } else if (liveObject.config.id === 'trapdoor_locked') {
              liveObject.interactions.push(
                this.options.scene.physics.add.collider(player, liveObject.sprite, () => {
                  this.triggerController.handleLockedDoorContact(loadedRoom, liveObject);
                }, () => this.shouldCollideWithLiveObject(liveObject))
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
    const rooms = Array.from(loadedRooms);

    for (const loadedRoom of rooms) {
      for (const liveObject of loadedRoom.liveObjects) {
        if (!liveObject.sprite.active) {
          continue;
        }

        const dynamicBody = this.getDynamicBody(liveObject.sprite);
        if (dynamicBody) {
          this.updateLiveObjectSpecialTileState(liveObject, dynamicBody);
        }

        switch (liveObject.config.id) {
          case 'bat':
            this.updateFlyingEnemyObject(
              loadedRoom.room,
              liveObject,
              delta,
              this.options.settings.batSpeed,
              this.options.settings.batWaveAmplitude,
              this.options.settings.batWaveSpeed
            );
            break;
          case 'bird':
            this.updateFlyingEnemyObject(
              loadedRoom.room,
              liveObject,
              delta,
              this.options.settings.birdSpeed,
              this.options.settings.birdWaveAmplitude,
              this.options.settings.birdWaveSpeed
            );
            break;
          case GHOST_OBJECT_ID:
            this.updateFlyingEnemyObject(
              loadedRoom.room,
              liveObject,
              delta,
              this.options.settings.batSpeed * 0.62,
              5,
              0.006
            );
            break;
          case 'fish':
            this.updateFlyingEnemyObject(
              loadedRoom.room,
              liveObject,
              delta,
              this.options.settings.birdSpeed * 0.58,
              3,
              0.008
            );
            break;
          case 'shark':
            this.updateFlyingEnemyObject(
              loadedRoom.room,
              liveObject,
              delta,
              this.options.settings.birdSpeed * 0.82,
              3,
              0.006
            );
            break;
          case 'crab':
          case 'slime_blue':
          case 'slime_red':
          case 'snake':
          case 'penguin':
          case 'bear_brown':
          case 'bear_polar':
          case 'chicken':
            this.updatePatrolEnemy(loadedRoom.room, liveObject);
            break;
          case SWORDSMAN_AI_OBJECT_ID:
            this.swordsmanController.updateEnemy(loadedRoom, liveObject);
            break;
          case 'frog':
            this.updateFrogEnemy(loadedRoom.room, liveObject);
            break;
          case 'cannon':
            this.hazardController.updateCannonObject(loadedRoom, liveObject);
            break;
          case 'cannon_bullet':
            this.hazardController.updateCannonBullet(loadedRoom, liveObject);
            break;
          case 'bomb':
            this.hazardController.updateBombObject(liveObject);
            break;
          case 'lightning':
            this.hazardController.updateLightningObject(liveObject);
            break;
          case 'bounce_pad':
            this.hazardController.updateBouncePadObject(liveObject);
            break;
          case 'moving_platform':
            this.updateMovingPlatformObject(rooms, liveObject, delta);
            break;
          case 'block_switch':
            this.triggerController.updateBlockSwitchObject(loadedRoom, liveObject);
            break;
          default:
            break;
        }

        this.applyConveyorToLiveObject(liveObject);
        if (dynamicBody) {
          this.applyLiveObjectSpecialTileForces(liveObject, dynamicBody, delta);
        }
        if (liveObject.sprite.active) {
          this.syncLiveObjectGravityPresentation(liveObject);
        }
      }
    }

    this.carryMovingPlatformRiders(rooms);
    this.stabilizePushableStacks(rooms);
    this.triggerController.updatePressurePlates(rooms);
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
      body.setAllowGravity(this.objectUsesGravity(liveObject.config));
      return;
    }

    const currentRoomId = this.options.getBodyRoomId(body);
    if (liveObject.runtime.gravityRoomId !== currentRoomId) {
      liveObject.runtime.gravityRoomId = currentRoomId;
      liveObject.runtime.gravityDirection = 'down';
    }

    const nextGravityDirection = this.options.getGravityPlateDirectionForBody(
      body,
      liveObject.runtime.gravityDirection,
    );
    if (nextGravityDirection) {
      liveObject.runtime.gravityDirection = nextGravityDirection;
      liveObject.runtime.gravityRoomId = currentRoomId;
    }

    liveObject.runtime.inWater = this.options.isBodyInWater(body);
    body.setAllowGravity(
      this.objectUsesGravity(liveObject.config) &&
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
    body.setAllowGravity(this.objectUsesGravity(liveObject.config) && !usesManualGravity);

    if (usesManualGravity) {
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
  }

  private shouldLiveObjectUseSpecialTilePhysics(liveObject: LoadedRoomObject): boolean {
    const config = liveObject.config;
    if (
      isMovingPlatformObjectId(config.id) ||
      config.behavior === 'fly' ||
      config.id === 'cannon_bullet' ||
      config.id === 'cage'
    ) {
      return false;
    }
    if (config.id === SWORDSMAN_AI_OBJECT_ID && liveObject.runtime.aiLadderTraversalEdgeId) {
      return false;
    }

    return (
      isPushableObjectConfig(config) ||
      config.category === 'enemy'
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
      (config.category === 'enemy' && config.behavior !== 'fly')
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

    const target = this.findLinkedMovingPlatformEndpoint(rooms, liveObject);
    if (!target) {
      liveObject.runtime.previousX = liveObject.sprite.x;
      liveObject.runtime.previousY = liveObject.sprite.y;
      body.setVelocity(0, 0);
      return;
    }

    const start = new Phaser.Math.Vector2(liveObject.runtime.baseX, liveObject.runtime.baseY);
    const end = new Phaser.Math.Vector2(target.x, target.y);
    const distance = Phaser.Math.Distance.Between(start.x, start.y, end.x, end.y);
    if (distance < 2) {
      liveObject.runtime.previousX = liveObject.sprite.x;
      liveObject.runtime.previousY = liveObject.sprite.y;
      body.setVelocity(0, 0);
      return;
    }

    const destination = liveObject.runtime.directionX >= 0 ? end : start;
    const current = new Phaser.Math.Vector2(liveObject.sprite.x, liveObject.sprite.y);
    const deltaSeconds = Math.max(delta / 1000, 1 / 60);
    const step = Math.max(1, 44 * deltaSeconds);
    const remaining = Phaser.Math.Distance.Between(
      current.x,
      current.y,
      destination.x,
      destination.y,
    );
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
      liveObject.runtime.directionX *= -1;
    }
  }

  private carryMovingPlatformRiders(
    rooms: Array<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
  ): void {
    for (const loadedRoom of rooms) {
      for (const liveObject of loadedRoom.liveObjects) {
        if (!isMovingPlatformObjectId(liveObject.config.id)) {
          continue;
        }

        const body = this.getDynamicBody(liveObject.sprite);
        if (!body) {
          continue;
        }

        const deltaX = liveObject.sprite.x - liveObject.runtime.previousX;
        const deltaY = liveObject.sprite.y - liveObject.runtime.previousY;
        this.carryPlayerOnMovingPlatform(body, deltaX, deltaY);
        this.carryObjectsOnMovingPlatform(rooms, liveObject, body, deltaX, deltaY);
      }
    }
  }

  private findLinkedMovingPlatformEndpoint(
    rooms: Array<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
    liveObject: LoadedRoomObject,
  ): { x: number; y: number } | null {
    if (!liveObject.linkedTargetInstanceId) {
      return null;
    }

    for (const loadedRoom of rooms) {
      if (liveObject.linkedTargetRoomId && loadedRoom.room.id !== liveObject.linkedTargetRoomId) {
        continue;
      }
      for (const candidate of loadedRoom.liveObjects) {
        if (
          candidate.placedInstanceId === liveObject.linkedTargetInstanceId &&
          candidate.sprite.active &&
          isMovingPlatformEndpointObjectId(candidate.config.id)
        ) {
          return { x: candidate.sprite.x, y: candidate.sprite.y };
        }
      }
    }

    if (
      liveObject.linkedTargetWorldX !== null &&
      liveObject.linkedTargetWorldY !== null
    ) {
      return {
        x: liveObject.linkedTargetWorldX,
        y: liveObject.linkedTargetWorldY,
      };
    }

    return null;
  }

  private carryPlayerOnMovingPlatform(
    platformBody: Phaser.Physics.Arcade.Body,
    deltaX: number,
    deltaY: number,
  ): void {
    if (deltaX === 0 && deltaY === 0) {
      return;
    }

    const playerBody = this.options.getPlayerBody();
    if (!playerBody || playerBody.velocity.y < MOVING_PLATFORM_CARRY_MAX_UPWARD_PLAYER_SPEED) {
      return;
    }

    if (!this.bodyIsOnMovingPlatformTop(playerBody, platformBody, {
      edgeInsetPx: MOVING_PLATFORM_CARRY_EDGE_INSET_PX,
      hoverTolerancePx: MOVING_PLATFORM_CARRY_HOVER_TOLERANCE_PX,
      penetrationTolerancePx: MOVING_PLATFORM_CARRY_PENETRATION_TOLERANCE_PX,
    })) {
      return;
    }

    const velocityX = playerBody.velocity.x;
    const playerBounds = getArcadeBodyBounds(playerBody);
    playerBody.reset(
      playerBounds.centerX + deltaX,
      platformBody.top - playerBounds.height * 0.5,
    );
    playerBody.setVelocity(velocityX, 0);
  }

  private carryObjectsOnMovingPlatform(
    rooms: Array<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
    platformObject: LoadedRoomObject,
    platformBody: Phaser.Physics.Arcade.Body,
    deltaX: number,
    deltaY: number,
  ): void {
    if (deltaX === 0 && deltaY === 0) {
      return;
    }

    for (const loadedRoom of rooms) {
      for (const liveObject of loadedRoom.liveObjects) {
        if (
          liveObject === platformObject ||
          !this.shouldCarryObjectOnMovingPlatform(liveObject) ||
          !liveObject.sprite.active ||
          !liveObject.sprite.body
        ) {
          continue;
        }

        const body = liveObject.sprite.body as ArcadeObjectBody;
        if (
          !body.enable ||
          (
            isDynamicArcadeBody(body) &&
            body.velocity.y < MOVING_PLATFORM_CARRY_MAX_UPWARD_PLAYER_SPEED
          ) ||
          !this.bodyIsOnMovingPlatformTop(body, platformBody, {
            edgeInsetPx: MOVING_PLATFORM_CARRY_EDGE_INSET_PX,
            hoverTolerancePx: MOVING_PLATFORM_OBJECT_CARRY_HOVER_TOLERANCE_PX,
            penetrationTolerancePx: MOVING_PLATFORM_OBJECT_CARRY_PENETRATION_TOLERANCE_PX,
          })
        ) {
          continue;
        }

        this.moveCarriedLiveObjectToPlatformTop(liveObject, body, platformBody, deltaX);
      }
    }
  }

  private shouldCarryObjectOnMovingPlatform(liveObject: LoadedRoomObject): boolean {
    return liveObject.config.category === 'collectible' || liveObject.config.category === 'enemy';
  }

  private bodyIsOnMovingPlatformTop(
    body: ArcadeObjectBody,
    platformBody: Phaser.Physics.Arcade.Body,
    options: {
      edgeInsetPx: number;
      hoverTolerancePx: number;
      penetrationTolerancePx: number;
    },
  ): boolean {
    const bodyBounds = getArcadeBodyBounds(body);
    const platformBounds = getArcadeBodyBounds(platformBody);
    const horizontalOverlap =
      bodyBounds.right - options.edgeInsetPx > platformBounds.left + options.edgeInsetPx &&
      bodyBounds.left + options.edgeInsetPx < platformBounds.right - options.edgeInsetPx;
    const footDistanceFromTop = bodyBounds.bottom - platformBounds.top;

    return (
      horizontalOverlap &&
      footDistanceFromTop >= -options.hoverTolerancePx &&
      footDistanceFromTop <= options.penetrationTolerancePx &&
      bodyBounds.top < platformBounds.top
    );
  }

  private moveCarriedLiveObjectToPlatformTop(
    liveObject: LoadedRoomObject,
    body: ArcadeObjectBody,
    platformBody: Phaser.Physics.Arcade.Body,
    deltaX: number,
  ): void {
    const bodyBounds = getArcadeBodyBounds(body);
    const targetBodyCenterX = bodyBounds.centerX + deltaX;
    const targetBodyCenterY = platformBody.top - bodyBounds.height * 0.5;
    const nextSpriteX = liveObject.sprite.x + targetBodyCenterX - bodyBounds.centerX;
    const nextSpriteY = liveObject.sprite.y + targetBodyCenterY - bodyBounds.centerY;

    if (isDynamicArcadeBody(body)) {
      const velocityX = body.velocity.x;
      body.reset(nextSpriteX, nextSpriteY);
      body.updateFromGameObject();
      body.setVelocity(velocityX, 0);
      liveObject.sprite.setPosition(nextSpriteX, nextSpriteY);
      return;
    }

    body.reset(nextSpriteX, nextSpriteY);
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

    for (const loadedRoom of loadedRooms) {
      for (const liveObject of loadedRoom.liveObjects) {
        if (liveObject.config.id !== 'ladder' || !liveObject.sprite.active || !liveObject.sprite.body) {
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
      for (const liveObject of loadedRoom.liveObjects) {
        const body = liveObject.sprite.body as ArcadeObjectBody | null;
        if (
          liveObject.sprite.active &&
          isPushableObjectConfig(liveObject.config) &&
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
      }
    }
  }

  private destroyLiveObjectInteractions(liveObject: LoadedRoomObject): void {
    for (const interaction of liveObject.interactions) {
      interaction.destroy();
    }
    liveObject.interactions = [];
  }

  private destroyLiveObjectHelpers(liveObject: LoadedRoomObject): void {
    for (const helper of liveObject.helpers) {
      helper.destroy();
    }
    liveObject.helpers = [];
  }

  private destroyLiveObjectWorldColliders(liveObject: LoadedRoomObject): void {
    for (const collider of liveObject.worldColliders) {
      collider.destroy();
    }
    liveObject.worldColliders = [];
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
    const rooms = Array.from(loadedRooms);
    const solidObstacles = rooms.flatMap((loadedRoom) =>
      loadedRoom.liveObjects.filter(
        (candidate) =>
          candidate.sprite.body &&
          placedObjectLayerAllowsRuntimeCollision(candidate.config, candidate) &&
          objectCollidesWithWorld(candidate.config) &&
          isSolidRuntimeObjectConfig(candidate.config)
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

        if (!this.usesDynamicObjectBody(liveObject.config) || !liveObject.sprite.body) {
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
    for (const loadedRoom of this.options.getLoadedFullRooms()) {
      for (const candidate of loadedRoom.liveObjects) {
        if (
          candidate === actor ||
          !candidate.sprite.active ||
          !isPushableObjectConfig(candidate.config) ||
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
    liveObject.runtime.elapsedMs = 0;
    liveObject.runtime.nextActionAt = this.options.getCurrentTime() + 250;
    body.reset(liveObject.runtime.baseX, liveObject.runtime.baseY);
    liveObject.sprite.setPosition(liveObject.runtime.baseX, liveObject.runtime.baseY);
    body.setAllowGravity(this.objectUsesGravity(liveObject.config));
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
      config.id !== 'cage' &&
      !isMovingPlatformObjectId(config.id)
    );
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

  private breakBrickBox(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
  ): void {
    const sprite = liveObject.sprite;
    const body = sprite.body as ArcadeObjectBody | null;

    this.emitLiveObjectRemovedForObject(loadedRoom, liveObject, 'brick-broken');
    this.destroyLiveObjectInteractions(liveObject);
    this.destroyLiveObjectWorldColliders(liveObject);
    this.destroyLiveObjectHelpers(liveObject);
    if (body) {
      body.enable = false;
    }
    loadedRoom.liveObjects = loadedRoom.liveObjects.filter((candidate) => candidate !== liveObject);
    this.syncWorldObjectColliders(this.options.getLoadedFullRooms());

    sprite.play('brick_box_break_anim');
    sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      sprite.destroy();
    });
  }

  private removeLiveObject(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    reason: 'object-removed' = 'object-removed',
  ): void {
    this.emitLiveObjectRemovedForObject(loadedRoom, liveObject, reason);
    this.destroyLiveObjectInteractions(liveObject);
    this.destroyLiveObjectWorldColliders(liveObject);
    this.destroyLiveObjectHelpers(liveObject);
    liveObject.sprite.destroy();
    loadedRoom.liveObjects = loadedRoom.liveObjects.filter((candidate) => candidate !== liveObject);
    this.syncWorldObjectColliders(this.options.getLoadedFullRooms());
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
    reason: 'object-removed' | 'brick-broken',
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
