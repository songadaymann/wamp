import Phaser from 'phaser';
import type { SfxCue } from '../../audio/sfx';
import {
  getObjectDefaultFrame,
  getObjectDisplayOffset,
  getObjectDisplayScale,
  getObjectRuntimeBodyOffset,
  objectCollidesWithWorld,
  isDynamicRuntimeObjectConfig,
  isBlockSwitchObjectId,
  isPushableObjectConfig,
  isSolidRuntimeObjectConfig,
  getPlacedObjectLayer,
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_WIDTH,
  TILE_SIZE,
  type GameObjectConfig,
  type LayerName,
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
      swordsmanSwordCanDamagePlayer: (liveObject, playerBody) =>
        this.swordsmanController.swordCanDamagePlayer(liveObject, playerBody),
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
    sprite.setDepth(this.getPlacedObjectRuntimeDepth({ layer }));

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
    if (config.bodyWidth > 0 && config.bodyHeight > 0) {
      if (this.usesDynamicObjectBody(config)) {
        this.options.scene.physics.add.existing(sprite);
        const body = sprite.body as Phaser.Physics.Arcade.Body;
        body.setSize(config.bodyWidth, config.bodyHeight, true);
        body.setOffset(...this.getObjectBodyOffset(config));
        body.setCollideWorldBounds(false);
        body.setAllowGravity(this.objectUsesGravity(config));
        if (isPushableObjectConfig(config)) {
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
      containedObjectId,
      signText,
      layer: getPlacedObjectLayer({ layer }),
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
                })
              );
            } else if (isBlockSwitchObjectId(liveObject.config.id)) {
              liveObject.interactions.push(
                this.options.scene.physics.add.collider(player, liveObject.sprite, () => {
                  this.triggerController.maybeTriggerBlockSwitch(loadedRoom, liveObject);
                })
              );
            } else {
              liveObject.interactions.push(
                this.options.scene.physics.add.collider(player, liveObject.sprite)
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
                })
              );
            } else if (liveObject.config.id === 'trapdoor_locked') {
              liveObject.interactions.push(
                this.options.scene.physics.add.collider(player, liveObject.sprite, () => {
                  this.triggerController.handleLockedDoorContact(loadedRoom, liveObject);
                })
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
          case 'block_switch':
            this.triggerController.updateBlockSwitchObject(loadedRoom, liveObject);
            break;
          default:
            break;
        }
      }
    }

    this.stabilizePushableStacks(rooms);
    this.triggerController.updatePressurePlates(rooms);
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

  private syncWorldObjectColliders(
    loadedRooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
  ): void {
    const rooms = Array.from(loadedRooms);
    const solidObstacles = rooms.flatMap((loadedRoom) =>
      loadedRoom.liveObjects.filter(
        (candidate) =>
          candidate.sprite.body &&
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
        if (!objectCollidesWithWorld(liveObject.config)) {
          continue;
        }

        for (const collisionRoom of rooms) {
          liveObject.worldColliders.push(
            this.options.scene.physics.add.collider(liveObject.sprite, collisionRoom.terrainLayer)
          );
          if (collisionRoom.terrainInsetBodies) {
            liveObject.worldColliders.push(
              this.options.scene.physics.add.collider(
                liveObject.sprite,
                collisionRoom.terrainInsetBodies,
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
              })
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
              })
            );
            continue;
          }

          liveObject.worldColliders.push(
            this.options.scene.physics.add.collider(liveObject.sprite, obstacle.sprite)
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
    this.applyDirectionalFacing(liveObject.sprite, liveObject.config, liveObject.runtime.directionX);
    body.setVelocityX(liveObject.runtime.directionX * this.getGroundEnemySpeed(liveObject.config.id));
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
    const onFloor = body.blocked.down || body.touching.down;

    if (onFloor) {
      this.applyDirectionalFacing(liveObject.sprite, liveObject.config, liveObject.runtime.directionX);
      if (this.options.getCurrentTime() >= liveObject.runtime.nextActionAt) {
        body.setVelocityX(liveObject.runtime.directionX * this.options.settings.frogHopSpeed);
        body.setVelocityY(this.options.settings.frogHopVelocity);
        liveObject.runtime.nextActionAt =
          this.options.getCurrentTime() + this.options.settings.frogHopDelayMs;
      } else {
        body.setVelocityX(0);
      }
      return;
    }

    this.applyDirectionalFacing(liveObject.sprite, liveObject.config, liveObject.runtime.directionX);
    if (Math.abs(body.velocity.x) < this.options.settings.frogHopSpeed * 0.8) {
      body.setVelocityX(liveObject.runtime.directionX * this.options.settings.frogHopSpeed);
    }
  }

  private maybeReverseGroundEnemy(
    room: RoomSnapshot,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body
  ): void {
    const bounds = this.getObjectHorizontalTravelBounds(room, liveObject.config);
    const pushableAhead = this.getPushableContactAhead(liveObject, body);
    const pushableBlockedAhead =
      pushableAhead !== null &&
      (
        (liveObject.runtime.directionX < 0 && (pushableAhead.blocked.left || pushableAhead.touching.left)) ||
        (liveObject.runtime.directionX > 0 && (pushableAhead.blocked.right || pushableAhead.touching.right))
      );
    const touchingWall =
      (
        (body.blocked.left && liveObject.runtime.directionX < 0) ||
        (body.blocked.right && liveObject.runtime.directionX > 0)
      ) &&
      (pushableAhead === null || pushableBlockedAhead);
    const reachedBounds =
      (liveObject.sprite.x <= bounds.left && liveObject.runtime.directionX < 0) ||
      (liveObject.sprite.x >= bounds.right && liveObject.runtime.directionX > 0);
    const onFloor = body.blocked.down || body.touching.down;
    const missingGroundAhead =
      onFloor &&
      this.groundEnemyAvoidsEdges(liveObject.config.id) &&
      !this.hasSolidTerrainAhead(room, body, liveObject.runtime.directionX);

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
    const roomOrigin = this.options.getRoomOrigin(room.coordinates);
    if (liveObject.sprite.y <= roomOrigin.y + ROOM_PX_HEIGHT + this.options.settings.respawnFallDistance) {
      return false;
    }

    liveObject.runtime.directionX = liveObject.runtime.initialDirectionX;
    liveObject.runtime.elapsedMs = 0;
    liveObject.runtime.nextActionAt = this.options.getCurrentTime() + 250;
    body.reset(liveObject.runtime.baseX, liveObject.runtime.baseY);
    liveObject.sprite.setPosition(liveObject.runtime.baseX, liveObject.runtime.baseY);
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

  private hasSolidTerrainAhead(
    room: RoomSnapshot,
    body: Phaser.Physics.Arcade.Body,
    directionX: number,
    leadPx = 4,
  ): boolean {
    const probeX = body.center.x + directionX * (body.halfWidth + leadPx);
    const probeY = body.bottom + 2;
    return this.hasSolidTerrainAtWorldPoint(room, probeX, probeY);
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

  private groundEnemyAvoidsEdges(objectId: string): boolean {
    return objectId !== 'penguin';
  }

  private getObjectHorizontalTravelBounds(
    room: RoomSnapshot,
    config: GameObjectConfig
  ): { left: number; right: number } {
    const roomOrigin = this.options.getRoomOrigin(room.coordinates);
    const halfWidth = Math.max(4, (config.bodyWidth > 0 ? config.bodyWidth : config.frameWidth) * 0.5);
    return {
      left: roomOrigin.x + halfWidth + 2,
      right: roomOrigin.x + ROOM_PX_WIDTH - halfWidth - 2,
    };
  }

  private usesDynamicObjectBody(config: GameObjectConfig): boolean {
    return isDynamicRuntimeObjectConfig(config);
  }

  private objectUsesGravity(config: GameObjectConfig): boolean {
    return config.behavior !== 'fly' && config.id !== 'cannon_bullet';
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
