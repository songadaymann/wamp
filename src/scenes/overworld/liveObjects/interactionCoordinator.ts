import { createExistingBodyGroup } from './existingBodyGroup';
import Phaser from 'phaser';
import {
  canActorTriggerBlockSwitchByContact,
} from './triggers';
import {
  isBlockSwitchObjectId,
  isClimbableObjectConfig,
  isPushableObjectConfig,
  objectCollidesWithWorld,
  placedObjectLayerAllowsRuntimeCollision,
  type GameObjectConfig,
} from '../../../config';
import type { LoadedFullRoom } from '../worldStreaming';
import { getNpcEnvironmentalObjectInteraction } from './npcEnvironment';
import type { ArcadeObjectBody } from './bodies';
import type { LoadedRoomObject } from './model';
import { liveObjectBlocksPlayerMovement } from '../playerCollisionObjects';
import { RESPAWN_CHECKPOINT_OBJECT_ID } from '../../../goals/respawnCheckpoints';
import {
  reachBuildMargin,
  reachCheckMargin,
  readBodyRect,
  readBodySpeed,
  rectNearBounds,
  setsIntersect,
  type WorldRect,
} from './colliderReach';

export interface LiveObjectInteractionCoordinatorOptions<TEdgeWall> {
  scene: Phaser.Scene;
  getPlayer: () => Phaser.GameObjects.GameObject | null;
  getPlayerPickupSensor: () => Phaser.GameObjects.GameObject | null;
  getPlayerBody: () => Phaser.Physics.Arcade.Body | null;
  destroyInteractions: (liveObject: LoadedRoomObject) => void;
  destroyWorldColliders: (liveObject: LoadedRoomObject) => void;
  collectLiveObject: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
  ) => void;
  addHazardInteraction: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    player: Phaser.GameObjects.GameObject,
  ) => void;
  handleEnemyContact: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
  ) => void;
  handleNpcContact: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
  ) => void;
  addNpcTornadoInteraction: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    npc: LoadedRoomObject,
    tornado: LoadedRoomObject,
  ) => void;
  touchNpcQuicksand: (liveObject: LoadedRoomObject) => void;
  defeatNpc: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
  ) => void;
  maybeBreakBrickBox: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
  ) => void;
  maybeBreakButtStompableObject: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
  ) => boolean;
  maybeTriggerBlockSwitch: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
  ) => void;
  addBouncePadInteraction: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    player: Phaser.GameObjects.GameObject,
  ) => void;
  addJumpFeatherInteraction?: (loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>, liveObject: LoadedRoomObject, player: Phaser.GameObjects.GameObject) => void;
  handleLockedDoorContact: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
  ) => void;
  handleRespawnCheckpointContact?: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
  ) => void;
  shouldCollideWithLiveObject: (liveObject: LoadedRoomObject) => boolean;
  isDistanceSleeping?: (liveObject: LoadedRoomObject) => boolean;
  shouldCollideWithLadderTopSupport: (
    playerBody: Phaser.Physics.Arcade.Body,
    supportBody: ArcadeObjectBody,
  ) => boolean;
  getRuntimeSolidObjects: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
  ) => readonly LoadedRoomObject[];
  /** Without it every loaded room is in every object's collider reach. */
  getRoomWorldBounds?: (room: LoadedFullRoom<LoadedRoomObject, TEdgeWall>['room']) => WorldRect;
  usesDynamicObjectBody: (config: GameObjectConfig) => boolean;
  handleBlockSwitchActorHit: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    switchObject: LoadedRoomObject,
    actor: LoadedRoomObject,
  ) => void;
  canActorPushPushableByContact: (liveObject: LoadedRoomObject) => boolean;
  handleActorPushableContact: (
    actor: LoadedRoomObject,
    pushable: LoadedRoomObject,
  ) => void;
}

interface WorldColliderObstacle<TEdgeWall> {
  loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>;
  liveObject: LoadedRoomObject;
}

interface ObstacleGroups<TEdgeWall> {
  staticGroup: Phaser.Physics.Arcade.Group;
  dynamicGroup: Phaser.Physics.Arcade.Group;
  bySprite: WeakMap<Phaser.GameObjects.GameObject, WorldColliderObstacle<TEdgeWall>>;
}

/** What the last full collider sync built, so reach can grow between syncs (F008). */
interface WorldColliderContext<TEdgeWall> {
  rooms: LoadedFullRoom<LoadedRoomObject, TEdgeWall>[];
  roomBounds: Map<LoadedFullRoom<LoadedRoomObject, TEdgeWall>, WorldRect> | null;
  obstacles: WorldColliderObstacle<TEdgeWall>[];
  dynamicSolidObstacleIndexByKey: Map<string, number>;
  /** Moving objects that collide with terrain and obstacles. */
  actors: LoadedRoomObject[];
  /** Actors and moving obstacles, whose reach is checked each frame. */
  tracked: LoadedRoomObject[];
  homeRooms: Map<LoadedRoomObject, LoadedFullRoom<LoadedRoomObject, TEdgeWall>>;
  reach: Map<LoadedRoomObject, Set<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>>;
  /** Actor to the obstacles it already has a collider with. */
  pairs: Map<LoadedRoomObject, Set<LoadedRoomObject>>;
  groups: ObstacleGroups<TEdgeWall> | null;
}

export class LiveObjectInteractionCoordinator<TEdgeWall = unknown> {
  private reconciliationGeneration = 0;
  private worldColliderContext: WorldColliderContext<TEdgeWall> | null = null;

  constructor(private readonly options: LiveObjectInteractionCoordinatorOptions<TEdgeWall>) {}

  getReconciliationGeneration(): number {
    return this.reconciliationGeneration;
  }

  syncPlayerInteractions(
    loadedRooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
  ): void {
    this.reconciliationGeneration += 1;
    const rooms = Array.from(loadedRooms).filter(
      (loadedRoom) => loadedRoom.runtimeSuspended !== true,
    );
    const player = this.options.getPlayer();
    const playerPickupSensor = this.options.getPlayerPickupSensor();
    const playerBody = this.options.getPlayerBody();

    for (const loadedRoom of rooms) {
      for (const liveObject of loadedRoom.liveObjects) {
        this.options.destroyInteractions(liveObject);

        if (!player || !playerBody || !liveObject.sprite.active || !liveObject.sprite.body) {
          continue;
        }

        switch (liveObject.config.category) {
          case 'collectible':
            if (!playerPickupSensor) break;
            liveObject.interactions.push(
              this.options.scene.physics.add.overlap(
                playerPickupSensor,
                liveObject.sprite,
                () => this.options.collectLiveObject(loadedRoom, liveObject),
              ),
            );
            break;
          case 'hazard':
            this.options.addHazardInteraction(loadedRoom, liveObject, player);
            break;
          case 'enemy':
            liveObject.interactions.push(
              this.options.scene.physics.add.overlap(player, liveObject.sprite, () => {
                this.options.handleEnemyContact(loadedRoom, liveObject);
              }),
            );
            break;
          case 'npc':
            if (placedObjectLayerAllowsRuntimeCollision(liveObject.config, liveObject)) {
              if (liveObjectBlocksPlayerMovement(liveObject)) {
                liveObject.interactions.push(
                  this.options.scene.physics.add.collider(
                    player,
                    liveObject.sprite,
                    () => this.options.handleNpcContact(loadedRoom, liveObject),
                    () => this.options.shouldCollideWithLiveObject(liveObject),
                  ),
                );
              }
              for (const dangerRoom of rooms) {
                for (const danger of dangerRoom.liveObjects) {
                  if (danger === liveObject || !danger.sprite.active || !danger.sprite.body) {
                    continue;
                  }
                  const interactionKind = getNpcEnvironmentalObjectInteraction(danger.config);
                  if (interactionKind === 'none') continue;
                  if (interactionKind === 'tornado') {
                    if (liveObject.runtime.npcMode !== 'idle' || liveObject.runtime.npcPushable) {
                      this.options.addNpcTornadoInteraction(dangerRoom, liveObject, danger);
                    }
                    continue;
                  }
                  liveObject.interactions.push(
                    this.options.scene.physics.add.overlap(
                      liveObject.sprite,
                      danger.sprite,
                      () => {
                        if (interactionKind === 'quicksand') {
                          this.options.touchNpcQuicksand(liveObject);
                        } else {
                          this.options.defeatNpc(loadedRoom, liveObject);
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
                this.options.scene.physics.add.collider(
                  player,
                  liveObject.sprite,
                  () => this.options.maybeBreakBrickBox(loadedRoom, liveObject),
                  () => this.options.shouldCollideWithLiveObject(liveObject),
                ),
              );
            } else if (liveObject.config.id === 'crate') {
              liveObject.interactions.push(
                this.options.scene.physics.add.collider(
                  player,
                  liveObject.sprite,
                  () => this.options.maybeBreakButtStompableObject(loadedRoom, liveObject),
                  () => this.options.shouldCollideWithLiveObject(liveObject),
                ),
              );
            } else if (isBlockSwitchObjectId(liveObject.config.id)) {
              liveObject.interactions.push(
                this.options.scene.physics.add.collider(
                  player,
                  liveObject.sprite,
                  () => this.options.maybeTriggerBlockSwitch(loadedRoom, liveObject),
                  () => this.options.shouldCollideWithLiveObject(liveObject),
                ),
              );
            } else {
              liveObject.interactions.push(
                this.options.scene.physics.add.collider(
                  player,
                  liveObject.sprite,
                  undefined,
                  () => this.options.shouldCollideWithLiveObject(liveObject),
                ),
              );
            }
            break;
          case 'interactive': {
            if (liveObject.config.id === RESPAWN_CHECKPOINT_OBJECT_ID) {
              liveObject.interactions.push(this.options.scene.physics.add.overlap(
                player, liveObject.sprite, () => this.options.handleRespawnCheckpointContact?.(loadedRoom, liveObject),
              ));
            } else if (isClimbableObjectConfig(liveObject.config)) {
              const supportZone = liveObject.helpers[0];
              if (supportZone?.body) {
                liveObject.interactions.push(
                  this.options.scene.physics.add.collider(
                    player,
                    supportZone,
                    undefined,
                    () => this.options.shouldCollideWithLadderTopSupport(
                      playerBody,
                      supportZone.body as ArcadeObjectBody,
                    ),
                  ),
                );
              }
            } else if (liveObject.config.id === 'double_jump_feather') {
              this.options.addJumpFeatherInteraction?.(loadedRoom, liveObject, player);
            } else if (liveObject.config.behavior === 'bounce') {
              this.options.addBouncePadInteraction(loadedRoom, liveObject, player);
            } else if (
              liveObject.config.id === 'tornado' ||
              liveObject.config.id === 'tornado_sand'
            ) {
              this.options.addHazardInteraction(loadedRoom, liveObject, player);
            } else if (
              liveObject.config.id === 'door_locked' ||
              liveObject.config.id === 'door_locked_narrow'
            ) {
              liveObject.interactions.push(
                this.options.scene.physics.add.collider(
                  player,
                  liveObject.sprite,
                  () => this.options.handleLockedDoorContact(loadedRoom, liveObject),
                  () => this.options.shouldCollideWithLiveObject(liveObject),
                ),
              );
            } else if (
              liveObject.config.id === 'trapdoor_locked' ||
              liveObject.config.id === 'barricade' ||
              liveObject.config.id === 'wooden_bridge'
            ) {
              liveObject.interactions.push(
                this.options.scene.physics.add.collider(
                  player,
                  liveObject.sprite,
                  undefined,
                  () => this.options.shouldCollideWithLiveObject(liveObject),
                ),
              );
            }
            break;
          }
          default:
            break;
        }
      }
    }
  }

  syncWorldColliders(
    loadedRooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
  ): void {
    this.worldColliderContext?.groups?.staticGroup.destroy(false, false);
    this.worldColliderContext?.groups?.dynamicGroup.destroy(false, false);
    this.reconciliationGeneration += 1;
    const rooms = Array.from(loadedRooms).filter(
      (loadedRoom) => loadedRoom.runtimeSuspended !== true,
    );
    const solidObstacles = rooms.flatMap((loadedRoom) =>
      this.options.getRuntimeSolidObjects(loadedRoom)
        .filter(
          (candidate) =>
            this.shouldCreateWorldColliders(candidate) &&
            objectCollidesWithWorld(candidate.config),
        )
        .map((liveObject) => ({ loadedRoom, liveObject })),
    );
    const dynamicSolidObstacleIndexByKey = new Map(
      solidObstacles
        .filter(({ liveObject }) => this.options.usesDynamicObjectBody(liveObject.config))
        .map(({ liveObject }, index) => [liveObject.key, index] as const),
    );
    const context: WorldColliderContext<TEdgeWall> = {
      rooms,
      roomBounds: this.measureRoomBounds(rooms),
      obstacles: solidObstacles,
      dynamicSolidObstacleIndexByKey,
      actors: [],
      tracked: [],
      homeRooms: new Map(),
      reach: new Map(),
      pairs: new Map(),
      groups: null,
    };
    context.groups = this.createObstacleGroups(solidObstacles);
    for (const { loadedRoom, liveObject } of solidObstacles) {
      context.homeRooms.set(liveObject, loadedRoom);
      context.reach.set(liveObject, this.findReachRooms(context, liveObject));
      if (dynamicSolidObstacleIndexByKey.has(liveObject.key)) context.tracked.push(liveObject);
    }

    for (const loadedRoom of rooms) {
      for (const liveObject of loadedRoom.liveObjects) {
        this.options.destroyWorldColliders(liveObject);
        if (!this.isWorldColliderActor(liveObject)) continue;

        context.actors.push(liveObject);
        context.homeRooms.set(liveObject, loadedRoom);
        let reach = context.reach.get(liveObject);
        if (!reach) {
          reach = this.findReachRooms(context, liveObject);
          context.reach.set(liveObject, reach);
          context.tracked.push(liveObject);
        }
        for (const collisionRoom of reach) this.addTerrainColliders(liveObject, collisionRoom);
        if (context.groups) {
          this.addGroupedObstacleColliders(context, liveObject);
        } else {
          for (const obstacle of solidObstacles) {
            if (!this.shouldPairWithObstacle(context, liveObject, obstacle.liveObject)) continue;
            const obstacleReach = context.reach.get(obstacle.liveObject);
            if (obstacleReach && setsIntersect(reach, obstacleReach)) this.addObstacleCollider(context, liveObject, obstacle);
          }
        }
      }
    }
    this.worldColliderContext = context;
  }

  /**
   * Called once a frame after live objects move: an object nearing a loaded room outside its
   * reach gets that room's terrain and nearby obstacles before the next physics step (F008).
   */
  refreshWorldColliderReach(): void {
    const context = this.worldColliderContext;
    if (!context?.roomBounds) return;
    for (const liveObject of context.tracked) {
      const reach = context.reach.get(liveObject);
      const body = liveObject.sprite.body as ArcadeObjectBody | null;
      if (!reach || !liveObject.sprite.active || !body?.enable) continue;
      const rect = readBodyRect(body);
      if (!rect) continue;
      const margin = reachCheckMargin(readBodySpeed(body));
      for (const [room, bounds] of context.roomBounds) {
        if (!reach.has(room) && room.runtimeSuspended !== true && rectNearBounds(rect, bounds, margin)) {
          this.growReach(context, liveObject, reach);
          break;
        }
      }
    }
  }

  private growReach(
    context: WorldColliderContext<TEdgeWall>,
    liveObject: LoadedRoomObject,
    reach: Set<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
  ): void {
    if (context.homeRooms.get(liveObject)?.runtimeSuspended === true) return;
    const added = new Set<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>();
    for (const room of this.findReachRooms(context, liveObject)) {
      if (!reach.has(room) && room.runtimeSuspended !== true) {
        reach.add(room);
        added.add(room);
      }
    }
    if (added.size === 0) return;

    const isActor = context.actors.includes(liveObject);
    if (isActor) {
      for (const room of added) this.addTerrainColliders(liveObject, room);
      for (const obstacle of context.groups ? [] : context.obstacles) {
        if (!this.canAddGrownPair(context, liveObject, obstacle.liveObject)) continue;
        const obstacleReach = context.reach.get(obstacle.liveObject);
        if (obstacleReach && setsIntersect(added, obstacleReach)) {
          this.addObstacleCollider(context, liveObject, obstacle);
        }
      }
    }

    if (context.groups) return;
    const asObstacle = context.obstacles.find((candidate) => candidate.liveObject === liveObject);
    if (!asObstacle) return;
    for (const actor of context.actors) {
      if (!this.canAddGrownPair(context, actor, liveObject)) continue;
      const actorReach = context.reach.get(actor);
      if (actorReach && setsIntersect(added, actorReach)) {
        this.addObstacleCollider(context, actor, asObstacle);
      }
    }
  }

  private canAddGrownPair(
    context: WorldColliderContext<TEdgeWall>,
    actor: LoadedRoomObject,
    obstacle: LoadedRoomObject,
  ): boolean {
    return (
      actor.sprite.active
      && context.homeRooms.get(actor)?.runtimeSuspended !== true
      && context.homeRooms.get(obstacle)?.runtimeSuspended !== true
      && !context.pairs.get(actor)?.has(obstacle)
      && this.shouldPairWithObstacle(context, actor, obstacle)
    );
  }

  private isWorldColliderActor(liveObject: LoadedRoomObject): boolean {
    return (
      this.shouldCreateWorldColliders(liveObject)
      && this.options.usesDynamicObjectBody(liveObject.config)
      && placedObjectLayerAllowsRuntimeCollision(liveObject.config, liveObject)
      && objectCollidesWithWorld(liveObject.config)
    );
  }

  private shouldPairWithObstacle(
    context: WorldColliderContext<TEdgeWall>,
    liveObject: LoadedRoomObject,
    obstacle: LoadedRoomObject,
  ): boolean {
    if (!obstacle.sprite.active || !obstacle.sprite.body || obstacle === liveObject) return false;
    const liveObjectDynamicSolidIndex = context.dynamicSolidObstacleIndexByKey.get(liveObject.key);
    const obstacleDynamicSolidIndex = context.dynamicSolidObstacleIndexByKey.get(obstacle.key);
    return !(
      liveObjectDynamicSolidIndex !== undefined &&
      obstacleDynamicSolidIndex !== undefined &&
      obstacleDynamicSolidIndex <= liveObjectDynamicSolidIndex
    );
  }

  /** Room bounds for reach checks, or null (every room in reach) when the host can't place rooms. */
  private measureRoomBounds(
    rooms: readonly LoadedFullRoom<LoadedRoomObject, TEdgeWall>[],
  ): Map<LoadedFullRoom<LoadedRoomObject, TEdgeWall>, WorldRect> | null {
    const getRoomWorldBounds = this.options.getRoomWorldBounds;
    if (!getRoomWorldBounds) return null;
    return new Map(rooms.map((loadedRoom) => [loadedRoom, getRoomWorldBounds(loadedRoom.room)] as const));
  }

  private findReachRooms(
    context: WorldColliderContext<TEdgeWall>,
    liveObject: LoadedRoomObject,
  ): Set<LoadedFullRoom<LoadedRoomObject, TEdgeWall>> {
    const body = liveObject.sprite.body;
    const rect = readBodyRect(body);
    if (!context.roomBounds || !rect) return new Set(context.rooms);
    const margin = reachBuildMargin(readBodySpeed(body));
    const reach = new Set<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>();
    for (const [room, bounds] of context.roomBounds) {
      if (rectNearBounds(rect, bounds, margin)) reach.add(room);
    }
    return reach;
  }

  private addTerrainColliders(
    liveObject: LoadedRoomObject,
    collisionRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
  ): void {
    liveObject.worldColliders.push(
      this.options.scene.physics.add.collider(
        liveObject.sprite,
        collisionRoom.terrainLayer,
        undefined,
        () => this.options.shouldCollideWithLiveObject(liveObject),
      ),
    );
    if (collisionRoom.terrainInsetBodies) {
      liveObject.worldColliders.push(
        this.options.scene.physics.add.collider(
          liveObject.sprite,
          collisionRoom.terrainInsetBodies,
          undefined,
          () => this.options.shouldCollideWithLiveObject(liveObject),
        ),
      );
    }
  }

  private createObstacleGroups(obstacles: WorldColliderObstacle<TEdgeWall>[]): ObstacleGroups<TEdgeWall> | null {
    const staticGroup = createExistingBodyGroup(this.options.scene, Phaser.Physics?.Arcade?.STATIC_BODY ?? 1);
    const dynamicGroup = createExistingBodyGroup(this.options.scene, Phaser.Physics?.Arcade?.DYNAMIC_BODY ?? 0);
    if (!staticGroup || !dynamicGroup) {
      staticGroup?.destroy(false, false); dynamicGroup?.destroy(false, false);
      return null;
    }
    const bySprite = new WeakMap<Phaser.GameObjects.GameObject, WorldColliderObstacle<TEdgeWall>>();
    for (const obstacle of obstacles) {
      bySprite.set(obstacle.liveObject.sprite, obstacle);
      const body = obstacle.liveObject.sprite.body as ArcadeObjectBody | null;
      (body?.physicsType === Phaser.Physics.Arcade.STATIC_BODY ? staticGroup : dynamicGroup).add(obstacle.liveObject.sprite);
    }
    return { staticGroup, dynamicGroup, bySprite };
  }

  private addGroupedObstacleColliders(context: WorldColliderContext<TEdgeWall>, actor: LoadedRoomObject): void {
    const groups = context.groups!;
    for (const group of [groups.staticGroup, groups.dynamicGroup]) {
      if (group.getLength() === 0) continue;
      actor.worldColliders.push(this.options.scene.physics.add.collider(actor.sprite, group,
        (_actorSprite, obstacleSprite) => {
          const obstacle = groups.bySprite.get(obstacleSprite as Phaser.GameObjects.GameObject);
          if (!obstacle) return;
          this.handleGroupedContact(actor, obstacle);
        },
        (_actorSprite, obstacleSprite) => {
          const obstacle = groups.bySprite.get(obstacleSprite as Phaser.GameObjects.GameObject)?.liveObject;
          if (!obstacle || !this.shouldPairWithObstacle(context, actor, obstacle)
            || !this.shouldCollideLiveObjectPair(actor, obstacle)
            || context.homeRooms.get(actor)?.runtimeSuspended === true
            || context.homeRooms.get(obstacle)?.runtimeSuspended === true) return false;
          const actorReach = context.reach.get(actor), obstacleReach = context.reach.get(obstacle);
          return Boolean(actorReach && obstacleReach && setsIntersect(actorReach, obstacleReach));
        }));
    }
  }

  private handleGroupedContact(actor: LoadedRoomObject, obstacle: WorldColliderObstacle<TEdgeWall>): void {
    if (isBlockSwitchObjectId(obstacle.liveObject.config.id) && canActorTriggerBlockSwitchByContact(actor)) {
      this.options.handleBlockSwitchActorHit(obstacle.loadedRoom, obstacle.liveObject, actor);
    } else if (isPushableObjectConfig(obstacle.liveObject.config) && this.options.canActorPushPushableByContact(actor)) {
      this.options.handleActorPushableContact(actor, obstacle.liveObject);
    }
  }

  private addObstacleCollider(
    context: WorldColliderContext<TEdgeWall>,
    liveObject: LoadedRoomObject,
    { loadedRoom: obstacleLoadedRoom, liveObject: obstacle }: WorldColliderObstacle<TEdgeWall>,
  ): void {
    let paired = context.pairs.get(liveObject);
    if (!paired) {
      paired = new Set();
      context.pairs.set(liveObject, paired);
    }
    paired.add(obstacle);

    if (
      isBlockSwitchObjectId(obstacle.config.id) &&
      canActorTriggerBlockSwitchByContact(liveObject)
    ) {
      liveObject.worldColliders.push(
        this.options.scene.physics.add.collider(
          liveObject.sprite,
          obstacle.sprite,
          () => this.options.handleBlockSwitchActorHit(
            obstacleLoadedRoom,
            obstacle,
            liveObject,
          ),
          () => this.shouldCollideLiveObjectPair(liveObject, obstacle),
        ),
      );
      return;
    }

    if (
      isPushableObjectConfig(obstacle.config) &&
      this.options.canActorPushPushableByContact(liveObject)
    ) {
      liveObject.worldColliders.push(
        this.options.scene.physics.add.collider(
          liveObject.sprite,
          obstacle.sprite,
          () => this.options.handleActorPushableContact(liveObject, obstacle),
          () => this.shouldCollideLiveObjectPair(liveObject, obstacle),
        ),
      );
      return;
    }

    liveObject.worldColliders.push(
      this.options.scene.physics.add.collider(
        liveObject.sprite,
        obstacle.sprite,
        undefined,
        () => this.shouldCollideLiveObjectPair(liveObject, obstacle),
      ),
    );
  }

  private shouldCreateWorldColliders(liveObject: LoadedRoomObject): boolean {
    // Distance sleep temporarily disables physics, but the actor still needs
    // its terrain and obstacle connections ready when its body wakes.
    return this.options.shouldCollideWithLiveObject(liveObject)
      || Boolean(
        liveObject.sprite.active
        && liveObject.sprite.body
        && this.options.isDistanceSleeping?.(liveObject),
      );
  }

  private shouldCollideLiveObjectPair(
    liveObject: LoadedRoomObject,
    obstacle: LoadedRoomObject,
  ): boolean {
    return (
      this.options.shouldCollideWithLiveObject(liveObject) &&
      this.options.shouldCollideWithLiveObject(obstacle)
    );
  }
}
