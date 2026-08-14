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
  handleLockedDoorContact: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
  ) => void;
  shouldCollideWithLiveObject: (liveObject: LoadedRoomObject) => boolean;
  shouldCollideWithLadderTopSupport: (
    playerBody: Phaser.Physics.Arcade.Body,
    supportBody: ArcadeObjectBody,
  ) => boolean;
  getRuntimeSolidObjects: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
  ) => readonly LoadedRoomObject[];
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

export class LiveObjectInteractionCoordinator<TEdgeWall = unknown> {
  private reconciliationGeneration = 0;

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
            if (isClimbableObjectConfig(liveObject.config)) {
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
            } else if (liveObject.config.id === 'bounce_pad') {
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
    this.reconciliationGeneration += 1;
    const rooms = Array.from(loadedRooms).filter(
      (loadedRoom) => loadedRoom.runtimeSuspended !== true,
    );
    const solidObstacles = rooms.flatMap((loadedRoom) =>
      this.options.getRuntimeSolidObjects(loadedRoom)
        .filter(
          (candidate) =>
            this.options.shouldCollideWithLiveObject(candidate) &&
            objectCollidesWithWorld(candidate.config),
        )
        .map((liveObject) => ({ loadedRoom, liveObject })),
    );
    const dynamicSolidObstacleIndexByKey = new Map(
      solidObstacles
        .filter(({ liveObject }) => this.options.usesDynamicObjectBody(liveObject.config))
        .map(({ liveObject }, index) => [liveObject.key, index] as const),
    );

    for (const loadedRoom of rooms) {
      for (const liveObject of loadedRoom.liveObjects) {
        this.options.destroyWorldColliders(liveObject);

        if (
          !this.options.shouldCollideWithLiveObject(liveObject) ||
          !this.options.usesDynamicObjectBody(liveObject.config)
        ) {
          continue;
        }
        if (!placedObjectLayerAllowsRuntimeCollision(liveObject.config, liveObject)) continue;
        if (!objectCollidesWithWorld(liveObject.config)) continue;

        for (const collisionRoom of rooms) {
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

        const liveObjectDynamicSolidIndex = dynamicSolidObstacleIndexByKey.get(liveObject.key);
        for (const { loadedRoom: obstacleLoadedRoom, liveObject: obstacle } of solidObstacles) {
          if (!obstacle.sprite.active || !obstacle.sprite.body || obstacle === liveObject) continue;

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
            continue;
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
            continue;
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
      }
    }
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
