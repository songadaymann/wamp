import Phaser from 'phaser';
import {
  getBlockSwitchRuntimeTextureKey,
  getObjectById,
  getObjectDefaultFrame,
  isBlockSwitchObjectId,
  isSwitchBlockInitiallyActive,
  isSwitchBlockObjectId,
} from '../../../config';
import type { RoomCoordinates } from '../../../persistence/roomModel';
import type { SfxCue } from '../../../audio/sfx';
import type {
  CreateLiveObjectEntryOptions,
  LoadedRoomObject,
} from '../liveObjects';
import type { LoadedFullRoom } from '../worldStreaming';
import {
  arcadeBodiesTouchOrOverlap,
  getArcadeBodyBounds,
} from './bodies';
import type { ArcadeObjectBody } from './bodies';
import { buildLiveObjectKeyIndex } from './indexing';
import {
  buildPressurePlateScanIndex,
  canActorTriggerBlockSwitchByContact,
  canActivatePressurePlate,
  getLinkedTargetKey,
  getPressurePlateBounds,
  isPressureControlledObject,
} from './triggers';

const BLOCK_SWITCH_COOLDOWN_MS = 320;

interface LiveObjectTriggerControllerOptions<TEdgeWall> {
  getLoadedFullRooms: () => Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>;
  getPlayerBody: () => Phaser.Physics.Arcade.Body | null;
  getCurrentTime: () => number;
  getRoomOrigin: (coordinates: RoomCoordinates) => { x: number; y: number };
  playRoomSfx: (cue: SfxCue, roomCoordinates: RoomCoordinates) => void;
  playBounceFx: (
    x: number,
    y: number,
    roomCoordinates: RoomCoordinates,
    cue?: SfxCue | null
  ) => void;
  showTransientStatus: (message: string) => void;
  tryConsumeHeldKey: () => boolean;
  createLiveObjectEntry: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    options: CreateLiveObjectEntryOptions,
  ) => LoadedRoomObject | null;
  removeLiveObject: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    reason?: 'object-removed',
  ) => void;
  onRoomSwitchStateChanged: (event: {
    roomId: string;
    roomCoordinates: RoomCoordinates;
    active: boolean;
  }) => void;
  syncWorldObjectColliders: (
    loadedRooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
  ) => void;
  syncLiveObjectInteractions: (
    loadedRooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
  ) => void;
}

export class LiveObjectTriggerController<TEdgeWall = unknown> {
  private readonly switchStateByRoomId = new Map<string, boolean>();
  private readonly blockSwitchActorLatchesBySwitchKey = new Map<string, Set<string>>();

  constructor(private readonly options: LiveObjectTriggerControllerOptions<TEdgeWall>) {}

  resetSwitchStates(): void {
    this.switchStateByRoomId.clear();
    this.blockSwitchActorLatchesBySwitchKey.clear();
    for (const loadedRoom of this.options.getLoadedFullRooms()) {
      this.applySwitchBlockStates(loadedRoom);
    }
  }

  resetSwitchStateForRoom(roomId: string): void {
    this.switchStateByRoomId.delete(roomId);
    for (const loadedRoom of this.options.getLoadedFullRooms()) {
      if (loadedRoom.room.id === roomId) {
        this.clearBlockSwitchActorLatchesForRoom(loadedRoom);
        this.applySwitchBlockStates(loadedRoom);
      }
    }
  }

  clearBlockSwitchActorLatchesForRoom(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>
  ): void {
    const roomObjectKeys = new Set(loadedRoom.liveObjects.map((liveObject) => liveObject.key));
    for (const liveObject of loadedRoom.liveObjects) {
      this.blockSwitchActorLatchesBySwitchKey.delete(liveObject.key);
    }
    for (const [switchKey, actorKeys] of this.blockSwitchActorLatchesBySwitchKey) {
      for (const actorKey of roomObjectKeys) {
        actorKeys.delete(actorKey);
      }
      if (actorKeys.size === 0) {
        this.blockSwitchActorLatchesBySwitchKey.delete(switchKey);
      }
    }
  }

  initializePressureControlledObjectState(liveObject: LoadedRoomObject): void {
    switch (liveObject.config.id) {
      case 'blast_door':
        liveObject.runtime.pressureActive = false;
        this.applyPressureDoorState(liveObject, true);
        break;
      case 'barricade':
        liveObject.runtime.pressureActive = false;
        liveObject.runtime.triggerLatched = false;
        this.applyBarricadeUnbuiltState(liveObject);
        break;
      default:
        break;
    }
  }

  updatePressurePlates(
    loadedRooms: LoadedFullRoom<LoadedRoomObject, TEdgeWall>[]
  ): void {
    const pressureIndex = buildPressurePlateScanIndex(loadedRooms);
    if (pressureIndex.triggers.length === 0 || pressureIndex.controlledObjects.length === 0) {
      return;
    }

    const activeTargetKeys = new Set<string>();

    for (const { loadedRoom, liveObject } of pressureIndex.triggers) {
      if (liveObject.config.id !== 'floor_trigger' || !liveObject.sprite.active) {
        continue;
      }

      const wasPressed = liveObject.runtime.pressureActive;
      const pressed = this.isPressurePlatePressed(liveObject, pressureIndex.pressCandidates);
      liveObject.runtime.pressureActive = pressed;
      if (liveObject.config.frameCount > 1) {
        liveObject.sprite.setFrame(pressed ? 1 : 0);
      }
      if (pressed && !wasPressed) {
        this.options.playRoomSfx('pressure-plate-down', loadedRoom.room.coordinates);
      }
      if (pressed && liveObject.linkedTargetInstanceId) {
        const targetRoomId = liveObject.linkedTargetRoomId ?? loadedRoom.room.id;
        activeTargetKeys.add(getLinkedTargetKey(targetRoomId, liveObject.linkedTargetInstanceId));
      }
    }

    for (const { loadedRoom, liveObject } of pressureIndex.controlledObjects) {
      if (!liveObject.sprite.active || !isPressureControlledObject(liveObject)) {
        continue;
      }

      const placedInstanceId = liveObject.placedInstanceId;
      const active = placedInstanceId
        ? activeTargetKeys.has(getLinkedTargetKey(loadedRoom.room.id, placedInstanceId))
        : false;

      switch (liveObject.config.id) {
        case 'door_metal':
        case 'trapdoor_metal':
          // Opens while plate is pressed
          if (liveObject.runtime.pressureActive !== active) {
            liveObject.runtime.pressureActive = active;
            this.applyPressureDoorState(liveObject, active);
            if (active) {
              this.options.playRoomSfx('door-open', loadedRoom.room.coordinates);
            }
          }
          break;

        case 'blast_door':
          // Closes while plate is pressed (opposite of metal door)
          const shouldBeClosed = active;
          if (liveObject.runtime.pressureActive !== shouldBeClosed) {
            liveObject.runtime.pressureActive = shouldBeClosed;
            this.applyPressureDoorState(liveObject, !shouldBeClosed); // true = open
            if (shouldBeClosed) {
              this.options.playRoomSfx('door-open', loadedRoom.room.coordinates);
            }
          }
          break;

        case 'barricade':
          // Builds permanently the first time plate is pressed
          if (active && !liveObject.runtime.triggerLatched) {
            liveObject.runtime.triggerLatched = true;
            this.applyBarricadeBuiltState(liveObject);
            this.options.playRoomSfx('door-open', loadedRoom.room.coordinates);
          }
          break;

        case 'door_locked':
        case 'trapdoor_locked':
          if (active) {
            this.triggerLinkedLockedDoor(loadedRoom, liveObject);
          }
          break;

        case 'cage':
          if (active) {
            this.openTriggeredCage(loadedRoom, liveObject);
          }
          break;

        case 'treasure_chest':
          if (active) {
            this.openTriggeredChest(loadedRoom, liveObject);
          }
          break;

        default:
          break;
      }
    }
  }

  updateBlockSwitchObject(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject
  ): void {
    if (!this.isPlayerTouchingBlockSwitchUnderside(liveObject)) {
      liveObject.runtime.triggerLatched = false;
    }

    this.releaseSeparatedBlockSwitchActorLatches(loadedRoom, liveObject);
    this.checkBlockSwitchActorContacts(loadedRoom, liveObject);
  }

  triggerBlockSwitch(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    switchObject: LoadedRoomObject
  ): void {
    const now = this.options.getCurrentTime();
    if (now < switchObject.runtime.cooldownUntil) {
      return;
    }

    if (!loadedRoom.liveObjects.some((liveObject) => isSwitchBlockObjectId(liveObject.config.id))) {
      switchObject.runtime.cooldownUntil = now + BLOCK_SWITCH_COOLDOWN_MS;
      this.options.showTransientStatus('No switch blocks in this room.');
      return;
    }

    const nextState = !this.getRoomSwitchState(loadedRoom.room.id);
    this.setRoomSwitchState(loadedRoom.room.id, nextState);
    switchObject.runtime.cooldownUntil = now + BLOCK_SWITCH_COOLDOWN_MS;
    this.applySwitchBlockStates(loadedRoom);
    this.options.onRoomSwitchStateChanged({
      roomId: loadedRoom.room.id,
      roomCoordinates: loadedRoom.room.coordinates,
      active: nextState,
    });
    this.options.playBounceFx(
      switchObject.sprite.x,
      switchObject.sprite.y - 4,
      loadedRoom.room.coordinates,
      'switch-block-toggle'
    );
    this.options.showTransientStatus(nextState ? 'Red blocks active.' : 'Blue blocks active.');
  }

  handleBlockSwitchActorHit(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    switchObject: LoadedRoomObject,
    actor: LoadedRoomObject
  ): void {
    if (
      !isBlockSwitchObjectId(switchObject.config.id) ||
      !switchObject.sprite.active ||
      !actor.sprite.active ||
      !canActorTriggerBlockSwitchByContact(actor)
    ) {
      return;
    }

    const switchBody = switchObject.sprite.body as ArcadeObjectBody | null;
    const actorBody = actor.sprite.body as ArcadeObjectBody | null;
    if (!switchBody || !switchBody.enable || !actorBody || !actorBody.enable) {
      return;
    }

    if (this.isBlockSwitchActorLatched(switchObject, actor)) {
      return;
    }

    this.triggerBlockSwitch(loadedRoom, switchObject);
    this.latchBlockSwitchActor(switchObject, actor);
  }

  maybeTriggerBlockSwitch(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
  ): void {
    if (!isBlockSwitchObjectId(liveObject.config.id) || !liveObject.sprite.active) {
      return;
    }
    if (!this.isPlayerHittingBlockSwitchFromBelow(liveObject)) {
      return;
    }
    if (liveObject.runtime.triggerLatched) {
      return;
    }

    const playerBody = this.options.getPlayerBody();
    if (playerBody && playerBody.velocity.y < -40) {
      playerBody.setVelocityY(-40);
    }
    liveObject.runtime.triggerLatched = true;
    this.triggerBlockSwitch(loadedRoom, liveObject);
  }

  handleLockedDoorContact(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
  ): void {
    if (this.options.tryConsumeHeldKey()) {
      this.options.playBounceFx(
        liveObject.sprite.x,
        liveObject.sprite.y - 6,
        loadedRoom.room.coordinates,
        'door-open'
      );
      this.options.showTransientStatus('Unlocked the door.');
      this.options.removeLiveObject(loadedRoom, liveObject, 'object-removed');
      return;
    }

    if (this.options.getCurrentTime() >= liveObject.runtime.cooldownUntil) {
      liveObject.runtime.cooldownUntil = this.options.getCurrentTime() + 900;
      this.options.showTransientStatus('Need a key.');
    }
  }

  applySwitchBlockStates(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>
  ): void {
    const roomSwitchActive = this.getRoomSwitchState(loadedRoom.room.id);

    for (const liveObject of loadedRoom.liveObjects) {
      if (isBlockSwitchObjectId(liveObject.config.id)) {
        this.setBlockSwitchFace(liveObject, roomSwitchActive);
        continue;
      }

      if (!isSwitchBlockObjectId(liveObject.config.id)) {
        continue;
      }

      const enabled = isSwitchBlockInitiallyActive(liveObject.config.id)
        ? !roomSwitchActive
        : roomSwitchActive;
      this.setSwitchBlockEnabled(liveObject, enabled);
    }
  }

  setRoomSwitchState(roomId: string, active: boolean): void {
    this.switchStateByRoomId.set(roomId, active);
  }

  private checkBlockSwitchActorContacts(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    switchObject: LoadedRoomObject
  ): void {
    if (!isBlockSwitchObjectId(switchObject.config.id) || !switchObject.sprite.active) {
      return;
    }

    const switchBody = switchObject.sprite.body as ArcadeObjectBody | null;
    if (!switchBody || !switchBody.enable) {
      return;
    }

    for (const actor of loadedRoom.liveObjects) {
      if (
        actor === switchObject ||
        !actor.sprite.active ||
        !canActorTriggerBlockSwitchByContact(actor)
      ) {
        continue;
      }

      const actorBody = actor.sprite.body as ArcadeObjectBody | null;
      if (!actorBody || !actorBody.enable || !arcadeBodiesTouchOrOverlap(switchBody, actorBody)) {
        continue;
      }

      this.handleBlockSwitchActorHit(loadedRoom, switchObject, actor);
    }
  }

  private getRoomSwitchState(roomId: string): boolean {
    return this.switchStateByRoomId.get(roomId) ?? false;
  }

  private setBlockSwitchFace(liveObject: LoadedRoomObject, redActive: boolean): void {
    const textureKey = getBlockSwitchRuntimeTextureKey(redActive);
    if (textureKey === liveObject.config.id) {
      liveObject.sprite.setTexture(textureKey, getObjectDefaultFrame(liveObject.config));
    } else {
      liveObject.sprite.setTexture(textureKey);
    }
  }

  private setSwitchBlockEnabled(liveObject: LoadedRoomObject, enabled: boolean): void {
    liveObject.sprite.setTexture(liveObject.config.id, getObjectDefaultFrame(liveObject.config));

    const body = liveObject.sprite.body as ArcadeObjectBody | null;
    if (body) {
      body.enable = enabled;
      if (enabled && 'updateFromGameObject' in body) {
        body.updateFromGameObject();
      }
    }

    liveObject.sprite.setAlpha(enabled ? 1 : 0.16);
  }

  private latchBlockSwitchActor(switchObject: LoadedRoomObject, actor: LoadedRoomObject): void {
    const actorKeys =
      this.blockSwitchActorLatchesBySwitchKey.get(switchObject.key) ?? new Set<string>();
    actorKeys.add(actor.key);
    this.blockSwitchActorLatchesBySwitchKey.set(switchObject.key, actorKeys);
  }

  private isBlockSwitchActorLatched(
    switchObject: LoadedRoomObject,
    actor: LoadedRoomObject
  ): boolean {
    return this.blockSwitchActorLatchesBySwitchKey.get(switchObject.key)?.has(actor.key) ?? false;
  }

  private releaseSeparatedBlockSwitchActorLatches(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    switchObject: LoadedRoomObject
  ): void {
    const actorKeys = this.blockSwitchActorLatchesBySwitchKey.get(switchObject.key);
    if (!actorKeys) {
      return;
    }

    const switchBody = switchObject.sprite.body as ArcadeObjectBody | null;
    if (!switchObject.sprite.active || !switchBody) {
      this.blockSwitchActorLatchesBySwitchKey.delete(switchObject.key);
      return;
    }

    const liveObjectByKey = buildLiveObjectKeyIndex(loadedRoom.liveObjects);
    for (const actorKey of [...actorKeys]) {
      const actor = liveObjectByKey.get(actorKey) ?? null;
      const actorBody = actor?.sprite.body as ArcadeObjectBody | null;
      if (
        !actor ||
        !actor.sprite.active ||
        !actorBody ||
        !arcadeBodiesTouchOrOverlap(switchBody, actorBody)
      ) {
        actorKeys.delete(actorKey);
      }
    }

    if (actorKeys.size === 0) {
      this.blockSwitchActorLatchesBySwitchKey.delete(switchObject.key);
    }
  }

  private isPressurePlatePressed(
    trigger: LoadedRoomObject,
    pressCandidates: LoadedRoomObject[]
  ): boolean {
    const triggerBounds = getPressurePlateBounds(trigger);
    const playerBody = this.options.getPlayerBody();
    if (playerBody && Phaser.Geom.Intersects.RectangleToRectangle(triggerBounds, getArcadeBodyBounds(playerBody))) {
      return true;
    }

    for (const liveObject of pressCandidates) {
      if (
        liveObject === trigger ||
        !liveObject.sprite.active ||
        !liveObject.sprite.body ||
        !canActivatePressurePlate(liveObject)
      ) {
        continue;
      }

      const body = liveObject.sprite.body as ArcadeObjectBody;
      if (
        Phaser.Geom.Intersects.RectangleToRectangle(
          triggerBounds,
          getArcadeBodyBounds(body)
        )
      ) {
        return true;
      }
    }

    return false;
  }

  private applyPressureDoorState(liveObject: LoadedRoomObject, open: boolean): void {
    const body = liveObject.sprite.body as ArcadeObjectBody | null;
    if (body) {
      body.enable = !open;
      if (!open && 'updateFromGameObject' in body) {
        body.updateFromGameObject();
      }
    }

    liveObject.sprite.setAlpha(open ? 0.28 : 1);
    liveObject.sprite.setTint(open ? 0x8ea0ba : 0xb8c4d8);
  }

  private triggerLinkedLockedDoor(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject
  ): void {
    if (liveObject.runtime.triggerLatched) {
      return;
    }

    liveObject.runtime.triggerLatched = true;
    this.options.playBounceFx(
      liveObject.sprite.x,
      liveObject.sprite.y - 6,
      loadedRoom.room.coordinates,
      'door-open'
    );
    this.options.removeLiveObject(loadedRoom, liveObject, 'object-removed');
  }

  private applyBarricadeBuiltState(liveObject: LoadedRoomObject): void {
    const body = liveObject.sprite.body as ArcadeObjectBody | null;
    if (body) {
      body.enable = true;
      if ('updateFromGameObject' in body) {
        body.updateFromGameObject();
      }
    }

    liveObject.sprite.setAlpha(1);
    liveObject.sprite.clearTint();
  }

  private applyBarricadeUnbuiltState(liveObject: LoadedRoomObject): void {
    const body = liveObject.sprite.body as ArcadeObjectBody | null;
    if (body) {
      body.enable = false;
    }

    liveObject.sprite.setAlpha(0.28);
    liveObject.sprite.setTint(0x8ea0ba);
  }

  private openTriggeredCage(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject
  ): void {
    if (liveObject.runtime.triggerLatched) {
      return;
    }

    liveObject.runtime.triggerLatched = true;
    this.options.playRoomSfx('cage-open', loadedRoom.room.coordinates);
    if (liveObject.config.frameCount > 0) {
      liveObject.sprite.setFrame(Math.max(0, liveObject.config.frameCount - 1));
    }
    this.setLiveObjectBodyEnabled(liveObject, false);
    if (liveObject.containedObjectId && getObjectById(liveObject.containedObjectId)?.category === 'enemy') {
      this.spawnTriggeredObject(loadedRoom, liveObject.containedObjectId, {
        x: liveObject.sprite.x - this.options.getRoomOrigin(loadedRoom.room.coordinates).x,
        y: liveObject.sprite.y + 2 - this.options.getRoomOrigin(loadedRoom.room.coordinates).y,
        facing: 'right',
        countsTowardGoals: true,
      });
    }
    this.options.syncWorldObjectColliders(this.options.getLoadedFullRooms());
  }

  private openTriggeredChest(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject
  ): void {
    if (liveObject.runtime.triggerLatched) {
      return;
    }

    liveObject.runtime.triggerLatched = true;
    this.options.playRoomSfx('treasure-open', loadedRoom.room.coordinates);
    if (liveObject.config.frameCount > 0) {
      liveObject.sprite.setFrame(Math.max(0, liveObject.config.frameCount - 1));
    }
    if (
      liveObject.containedObjectId &&
      getObjectById(liveObject.containedObjectId)?.category === 'collectible'
    ) {
      const roomOrigin = this.options.getRoomOrigin(loadedRoom.room.coordinates);
      this.spawnTriggeredObject(loadedRoom, liveObject.containedObjectId, {
        x: liveObject.sprite.x - roomOrigin.x,
        y: liveObject.sprite.y - roomOrigin.y - 12,
        countsTowardGoals: true,
      });
    }
  }

  private setLiveObjectBodyEnabled(liveObject: LoadedRoomObject, enabled: boolean): void {
    const body = liveObject.sprite.body as ArcadeObjectBody | null;
    if (!body) {
      return;
    }

    body.enable = enabled;
    if (enabled && 'updateFromGameObject' in body) {
      body.updateFromGameObject();
    }
  }

  private spawnTriggeredObject(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    objectId: string,
    options: {
      x: number;
      y: number;
      facing?: 'left' | 'right';
      countsTowardGoals: boolean;
    }
  ): void {
    const config = getObjectById(objectId);
    if (!config) {
      return;
    }

    const liveObject = this.options.createLiveObjectEntry(loadedRoom, {
      key: `trigger:${objectId}:${this.options.getCurrentTime()}:${Math.round(options.x)}:${Math.round(options.y)}`,
      config,
      x: options.x,
      y: options.y,
      facing: options.facing,
      layer: 'terrain',
      baseTimeSeed: options.x + options.y,
      placedInstanceId: null,
      linkedTargetRoomId: null,
      linkedTargetInstanceId: null,
      containedObjectId: null,
      signText: null,
      objectiveMode: null,
      defeatMode: null,
      countsTowardGoals: options.countsTowardGoals,
    });
    if (!liveObject) {
      return;
    }

    loadedRoom.liveObjects.push(liveObject);
    this.options.syncWorldObjectColliders(this.options.getLoadedFullRooms());
    this.options.syncLiveObjectInteractions([loadedRoom]);
  }

  private isPlayerHittingBlockSwitchFromBelow(liveObject: LoadedRoomObject): boolean {
    const playerBody = this.options.getPlayerBody();
    if (!playerBody) {
      return false;
    }

    const upwardDelta =
      typeof playerBody.deltaY === 'function'
        ? playerBody.deltaY()
        : playerBody.y - (playerBody.prev?.y ?? playerBody.y);
    const separatedUp =
      Boolean(playerBody.blocked?.up) ||
      Boolean(playerBody.touching?.up);
    return (
      (upwardDelta < -0.5 || playerBody.velocity.y < -20 || separatedUp) &&
      this.isPlayerTouchingBlockSwitchUnderside(liveObject)
    );
  }

  private isPlayerTouchingBlockSwitchUnderside(liveObject: LoadedRoomObject): boolean {
    const playerBody = this.options.getPlayerBody();
    const blockBody = liveObject.sprite.body as ArcadeObjectBody | null;
    if (!playerBody || !blockBody) {
      return false;
    }

    const horizontallyOverlapping =
      playerBody.right > blockBody.left + 1 &&
      playerBody.left < blockBody.right - 1;
    return (
      horizontallyOverlapping &&
      playerBody.center.y >= blockBody.center.y - 2 &&
      playerBody.top <= blockBody.bottom + 4
    );
  }
}
