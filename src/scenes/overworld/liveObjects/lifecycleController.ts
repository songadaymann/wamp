import Phaser from 'phaser';
import { isSwitchBlockObjectId } from '../../../config';
import { getEditorObjectConfigById } from '../../../customSprites/objectConfig';
import {
  getPlacedPoliceBehaviorMode,
  getPlacedPolicePatrolShoots,
} from '../../../enemies/policeEnemy';
import {
  getPlacedNpcDefeatMode,
  getPlacedNpcMode,
  getPlacedNpcName,
  normalizeNpcCanJumpFall,
  normalizeNpcFriendlyFire,
  normalizeNpcPlayerCollision,
  normalizeNpcPushable,
} from '../../../npcs/model';
import { getPlacedObjectPathTargetIds } from '../../../placedObjects/objectPaths';
import type { RoomSnapshot } from '../../../persistence/roomModel';
import type { LoadedFullRoom } from '../worldStreaming';
import type { ArcadeObjectBody } from './bodies';
import type { CreateLiveObjectEntryOptions, LoadedRoomObject } from './model';

export interface LiveObjectLifecycleControllerOptions<TEdgeWall> {
  getLoadedFullRooms: () => Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>;
  getPlacedObjectRuntimeKey: (
    roomId: string,
    placedObject: RoomSnapshot['placedObjects'][number],
    placedIndex: number,
  ) => string;
  isCollectedObjectKey: (key: string) => boolean;
  createLiveObjectEntry: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    options: CreateLiveObjectEntryOptions,
  ) => LoadedRoomObject | null;
  applySwitchBlockStates: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
  ) => void;
  clearBlockSwitchActorLatchesForRoom: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
  ) => void;
  clearPressureTriggerStatesForRoom: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
  ) => void;
  invalidateRoomPartition: (roomId: string) => void;
}

export class LiveObjectLifecycleController<TEdgeWall = unknown> {
  private readonly colliderDormancyStates = new WeakMap<
    Phaser.Physics.Arcade.Collider,
    boolean
  >();

  constructor(private readonly options: LiveObjectLifecycleControllerOptions<TEdgeWall>) {}

  createBatch(
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

      const objectKey = this.options.getPlacedObjectRuntimeKey(
        loadedRoom.room.id,
        placedObject,
        index,
      );
      if (this.options.isCollectedObjectKey(objectKey)) {
        continue;
      }

      const linkedTargetInstanceIds = getPlacedObjectPathTargetIds(placedObject);
      const liveObject = this.options.createLiveObjectEntry(loadedRoom, {
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
        npcPlayerCollision: normalizeNpcPlayerCollision(placedObject.npcPlayerCollision),
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

  finalizeCreation(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    dormant: boolean,
  ): void {
    this.options.applySwitchBlockStates(loadedRoom);
    if (dormant) {
      for (const liveObject of loadedRoom.liveObjects) {
        if (!isSwitchBlockObjectId(liveObject.config.id)) continue;
        this.captureFinalizedDormantBodyState(liveObject.sprite);
      }
    }
    this.options.invalidateRoomPartition(loadedRoom.room.id);
  }

  setRoomDormant(
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
    this.options.invalidateRoomPartition(loadedRoom.room.id);
  }

  setRoomWorldCollisionTargetDormant(
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
            collisionTargets.has(targets.object1) ||
            collisionTargets.has(targets.object2)
          ) {
            this.setColliderDormant(collider, dormant);
          }
        }
      }
    }
  }

  destroyBatch(
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
      attempt(() => this.options.clearBlockSwitchActorLatchesForRoom(loadedRoom));
      attempt(() => this.options.clearPressureTriggerStatesForRoom(loadedRoom));
    }
    const destroyCount = Math.min(
      loadedRoom.liveObjects.length,
      Math.max(1, Math.floor(maxObjectCount)),
    );
    for (let index = 0; index < destroyCount; index += 1) {
      const liveObject = loadedRoom.liveObjects.at(-1);
      if (!liveObject) break;
      attempt(() => this.destroyInteractions(liveObject));
      attempt(() => this.destroyWorldColliders(liveObject));
      attempt(() => this.destroyHelpers(liveObject));
      attempt(() => liveObject.sprite.destroy());
      loadedRoom.liveObjects.pop();
    }

    this.options.invalidateRoomPartition(loadedRoom.room.id);
    if (hasError) throw firstError;
    return loadedRoom.liveObjects.length === 0;
  }

  clearRoomInteractions(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
  ): void {
    for (const liveObject of loadedRoom.liveObjects) {
      this.destroyInteractions(liveObject);
    }
  }

  destroyInteractions(liveObject: LoadedRoomObject): void {
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

  destroyWorldColliders(liveObject: LoadedRoomObject): void {
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

  destroyHelpers(liveObject: LoadedRoomObject): void {
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

    // Switch finalization runs after the object was made dormant. Preserve its
    // resolved collision state for activation without making the detached body live.
    gameObject.setData('wampPreparedBodyEnabled', body.enable);
    body.enable = false;
  }

  private setGameObjectDormant(
    gameObject: Phaser.GameObjects.GameObject,
    dormant: boolean,
  ): void {
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
}
