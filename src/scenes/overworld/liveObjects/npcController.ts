import Phaser from 'phaser';
import {
  JIMOTHY_ANIMATION_KEYS,
  type NpcMode,
} from '../../../npcs/model';
import type { RoomSnapshot } from '../../../persistence/roomModel';
import type { LoadedRoomObject } from '../liveObjects';
import type { LoadedFullRoom } from '../worldStreaming';
import { getArcadeBodyBounds } from './bodies';
import { resolveNpcHorizontalVelocity } from './npcEnvironment';

const NPC_WALK_SPEED = 70;
const NPC_JUMP_VELOCITY = -210;
const NPC_FOLLOW_STOP_DISTANCE = 7;
const NPC_EDGE_PROBE_LEAD_PX = 4;
const NPC_WANDER_WALK_MIN_MS = 1800;
const NPC_WANDER_WALK_MAX_MS = 4500;
const NPC_WANDER_PAUSE_MIN_MS = 1000;
const NPC_WANDER_PAUSE_MAX_MS = 5000;
const NPC_QUICKSAND_CONTACT_BUFFER_MS = 120;

interface NpcControllerOptions {
  scene: Phaser.Scene;
  getCurrentTime(): number;
  getPlayerBody(): Phaser.Physics.Arcade.Body | null;
  resetDynamicObjectIfOutOfBounds(
    room: RoomSnapshot,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
  ): boolean;
  applyDirectionalFacing(
    sprite: Phaser.GameObjects.Sprite,
    config: LoadedRoomObject['config'],
    directionX: number,
  ): void;
  hasSupportAhead(
    room: RoomSnapshot,
    body: Phaser.Physics.Arcade.Body,
    directionX: number,
    leadPx?: number,
  ): boolean;
  hasSolidTerrainAtWorldPoint(room: RoomSnapshot, worldX: number, worldY: number): boolean;
  playBounceFx(
    x: number,
    y: number,
    roomCoordinates: RoomSnapshot['coordinates'],
  ): void;
  bouncePadVelocity: number;
  bouncePadCooldownMs: number;
}

export interface NpcRuntimeStateSnapshot {
  instanceId: string | null;
  name: string;
  alive: boolean;
  victorious: boolean;
  x: number;
  y: number;
}

export class LiveObjectNpcController<TEdgeWall = unknown> {
  constructor(private readonly options: NpcControllerOptions) {}

  updateNpc(
    rooms: Array<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    delta: number,
  ): void {
    const body = liveObject.sprite.body as Phaser.Physics.Arcade.Body | null;
    if (!body) {
      this.syncNameLabel(liveObject);
      return;
    }

    const mode = liveObject.runtime.npcMode ?? 'idle';
    const terrainActor = liveObject.layer === 'terrain';
    const movable = mode !== 'idle' || liveObject.runtime.npcPushable;
    const externallyLaunched =
      this.options.getCurrentTime() < liveObject.runtime.npcBounceCooldownUntil &&
      !body.blocked.down &&
      !body.touching.down;
    const inQuicksand =
      this.options.getCurrentTime() < liveObject.runtime.npcQuicksandUntil;

    body.setAllowGravity(terrainActor && movable);
    body.setImmovable(!movable);
    body.pushable = movable;
    body.setDragX(
      movable
        ? liveObject.runtime.specialTileOnIce
          ? 8
          : liveObject.runtime.specialTileOnSticky || inQuicksand
            ? 900
            : 550
        : 0,
    );
    body.setMaxVelocity(
      externallyLaunched || liveObject.runtime.specialTileWindX !== 0 ? 280 : 140,
      externallyLaunched ? 980 : 500,
    );

    if (liveObject.runtime.npcVictorious) {
      body.setVelocityX(0);
      this.playAnimation(liveObject, JIMOTHY_ANIMATION_KEYS.victory);
      this.syncNameLabel(liveObject);
      return;
    }

    if (terrainActor && movable) {
      this.options.resetDynamicObjectIfOutOfBounds(loadedRoom.room, liveObject, body);
      this.maybeLaunchFromBouncePad(rooms, loadedRoom, liveObject, body);
    }

    switch (mode) {
      case 'idle':
        this.updateIdle(liveObject, body, delta);
        break;
      case 'wander':
        this.updateWander(loadedRoom.room, liveObject, body, terrainActor, delta);
        break;
      case 'patrol':
        this.updatePatrol(loadedRoom.room, liveObject, body, terrainActor, delta);
        break;
      case 'follow':
        this.updateFollow(loadedRoom.room, liveObject, body, terrainActor, delta);
        break;
    }

    this.syncNameLabel(liveObject);
  }

  touchQuicksand(liveObject: LoadedRoomObject): void {
    liveObject.runtime.npcQuicksandUntil = Math.max(
      liveObject.runtime.npcQuicksandUntil,
      this.options.getCurrentTime() + NPC_QUICKSAND_CONTACT_BUFFER_MS,
    );
  }

  setRoomVictory(
    loadedRooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
    roomId: string,
    victorious: boolean,
  ): void {
    for (const loadedRoom of loadedRooms) {
      if (loadedRoom.room.id !== roomId) {
        continue;
      }
      for (const liveObject of loadedRoom.liveObjects) {
        if (liveObject.config.category !== 'npc') {
          continue;
        }
        liveObject.runtime.npcVictorious = victorious;
        if (!victorious) {
          this.playAnimation(liveObject, JIMOTHY_ANIMATION_KEYS.idle);
        }
      }
    }
  }

  getRoomNpcState(
    loadedRooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
    roomId: string,
    requestedInstanceId: string | null,
  ): NpcRuntimeStateSnapshot | null {
    for (const loadedRoom of loadedRooms) {
      if (loadedRoom.room.id !== roomId) {
        continue;
      }
      const npcs = loadedRoom.liveObjects.filter(
        (candidate) => candidate.config.category === 'npc' && candidate.sprite.active,
      );
      const npc = (
        requestedInstanceId
          ? npcs.find((candidate) => candidate.placedInstanceId === requestedInstanceId)
          : null
      ) ?? npcs[0];
      if (!npc) {
        return null;
      }
      return {
        instanceId: npc.placedInstanceId,
        name: npc.npcName ?? npc.config.name,
        alive: true,
        victorious: npc.runtime.npcVictorious,
        x: npc.sprite.x,
        y: npc.sprite.y,
      };
    }
    return null;
  }

  private updateIdle(
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
    delta: number,
  ): void {
    this.applyHorizontalMovement(liveObject, body, delta, false);
    const playerBody = this.options.getPlayerBody();
    if (playerBody && Math.abs(playerBody.center.x - body.center.x) > 2) {
      liveObject.runtime.directionX = playerBody.center.x >= body.center.x ? 1 : -1;
    }
    this.options.applyDirectionalFacing(
      liveObject.sprite,
      liveObject.config,
      liveObject.runtime.directionX,
    );
    this.playAnimation(liveObject, JIMOTHY_ANIMATION_KEYS.idle);
  }

  private updateWander(
    room: RoomSnapshot,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
    terrainActor: boolean,
    delta: number,
  ): void {
    const now = this.options.getCurrentTime();
    if (liveObject.runtime.nextActionAt <= 0) {
      liveObject.runtime.npcWalking = true;
      liveObject.runtime.nextActionAt =
        now + Phaser.Math.Between(NPC_WANDER_WALK_MIN_MS, NPC_WANDER_WALK_MAX_MS);
    }

    if (now >= liveObject.runtime.nextActionAt) {
      if (liveObject.runtime.npcWalking) {
        liveObject.runtime.npcWalking = false;
        liveObject.runtime.nextActionAt =
          now + Phaser.Math.Between(NPC_WANDER_PAUSE_MIN_MS, NPC_WANDER_PAUSE_MAX_MS);
      } else {
        liveObject.runtime.npcWalking = true;
        liveObject.runtime.directionX *= -1;
        liveObject.runtime.nextActionAt =
          now + Phaser.Math.Between(NPC_WANDER_WALK_MIN_MS, NPC_WANDER_WALK_MAX_MS);
      }
    }

    if (!liveObject.runtime.npcWalking) {
      this.applyHorizontalMovement(liveObject, body, delta, false);
      this.playAnimation(liveObject, JIMOTHY_ANIMATION_KEYS.idle);
      return;
    }

    if (this.handleBlockedPath(room, liveObject, body, terrainActor, 'wander')) {
      return;
    }
    this.walk(liveObject, body, delta);
  }

  private updatePatrol(
    room: RoomSnapshot,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
    terrainActor: boolean,
    delta: number,
  ): void {
    this.handleBlockedPath(room, liveObject, body, terrainActor, 'patrol');
    this.walk(liveObject, body, delta);
  }

  private updateFollow(
    room: RoomSnapshot,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
    terrainActor: boolean,
    delta: number,
  ): void {
    const playerBody = this.options.getPlayerBody();
    if (!playerBody) {
      this.updateIdle(liveObject, body, delta);
      return;
    }

    const deltaX = playerBody.center.x - body.center.x;
    if (Math.abs(deltaX) <= NPC_FOLLOW_STOP_DISTANCE) {
      this.applyHorizontalMovement(liveObject, body, delta, false);
      this.playAnimation(liveObject, JIMOTHY_ANIMATION_KEYS.idle);
      return;
    }

    liveObject.runtime.directionX = deltaX > 0 ? 1 : -1;
    this.handleBlockedPath(room, liveObject, body, terrainActor, 'follow');
    this.walk(liveObject, body, delta);
  }

  private handleBlockedPath(
    room: RoomSnapshot,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
    terrainActor: boolean,
    mode: NpcMode,
  ): boolean {
    const directionX = liveObject.runtime.directionX;
    const grounded = body.blocked.down || body.touching.down;
    const blocked =
      directionX < 0
        ? body.blocked.left || body.touching.left
        : body.blocked.right || body.touching.right;
    const canJumpFall = mode === 'follow' || liveObject.runtime.npcCanJumpFall;

    if (
      terrainActor &&
      grounded &&
      canJumpFall &&
      blocked &&
      this.hasOneTileJumpSpace(room, body, directionX)
    ) {
      body.setVelocityY(NPC_JUMP_VELOCITY);
      return false;
    }

    const missingGround =
      terrainActor &&
      grounded &&
      !canJumpFall &&
      !this.options.hasSupportAhead(room, body, directionX, NPC_EDGE_PROBE_LEAD_PX);
    if (!blocked && !missingGround) {
      return false;
    }

    if (mode === 'follow') {
      body.setVelocityX(0);
      this.playAnimation(liveObject, JIMOTHY_ANIMATION_KEYS.idle);
      return true;
    }

    liveObject.runtime.directionX *= -1;
    if (mode === 'wander') {
      liveObject.runtime.npcWalking = false;
      liveObject.runtime.nextActionAt =
        this.options.getCurrentTime() +
        Phaser.Math.Between(NPC_WANDER_PAUSE_MIN_MS, NPC_WANDER_PAUSE_MAX_MS);
      body.setVelocityX(0);
      this.playAnimation(liveObject, JIMOTHY_ANIMATION_KEYS.idle);
      return true;
    }
    return false;
  }

  private hasOneTileJumpSpace(
    room: RoomSnapshot,
    body: Phaser.Physics.Arcade.Body,
    directionX: number,
  ): boolean {
    const frontX = directionX > 0 ? body.right + 2 : body.left - 2;
    const obstacleY = body.bottom - 8;
    const oneTileUpY = obstacleY - 16;
    const twoTilesUpY = obstacleY - 32;
    return (
      this.options.hasSolidTerrainAtWorldPoint(room, frontX, obstacleY) &&
      !this.options.hasSolidTerrainAtWorldPoint(room, frontX, oneTileUpY) &&
      !this.options.hasSolidTerrainAtWorldPoint(room, frontX, twoTilesUpY)
    );
  }

  private walk(
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
    delta: number,
  ): void {
    this.applyHorizontalMovement(liveObject, body, delta, true);
    this.options.applyDirectionalFacing(
      liveObject.sprite,
      liveObject.config,
      liveObject.runtime.directionX,
    );
    this.playAnimation(liveObject, JIMOTHY_ANIMATION_KEYS.walk);
  }

  private applyHorizontalMovement(
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
    delta: number,
    walking: boolean,
  ): void {
    const externallyLaunched =
      this.options.getCurrentTime() < liveObject.runtime.npcBounceCooldownUntil &&
      !body.blocked.down &&
      !body.touching.down;
    body.setVelocityX(resolveNpcHorizontalVelocity({
      currentVelocityX: body.velocity.x,
      directionX: liveObject.runtime.directionX,
      baseSpeed: NPC_WALK_SPEED,
      deltaMs: delta,
      walking,
      externallyLaunched,
      onIce: liveObject.runtime.specialTileOnIce,
      onSticky: liveObject.runtime.specialTileOnSticky,
      inQuicksand:
        this.options.getCurrentTime() < liveObject.runtime.npcQuicksandUntil,
      windX: liveObject.runtime.specialTileWindX,
    }));
  }

  private maybeLaunchFromBouncePad(
    rooms: Array<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    body: Phaser.Physics.Arcade.Body,
  ): void {
    const now = this.options.getCurrentTime();
    if (now < liveObject.runtime.npcBounceCooldownUntil || body.velocity.y < -20) {
      return;
    }
    const npcBounds = getArcadeBodyBounds(body);
    for (const room of rooms) {
      for (const candidate of room.liveObjects) {
        if (
          candidate.config.id !== 'bounce_pad' ||
          !candidate.sprite.active ||
          !candidate.sprite.body
        ) {
          continue;
        }
        const padBounds = getArcadeBodyBounds(
          candidate.sprite.body as Phaser.Physics.Arcade.Body | Phaser.Physics.Arcade.StaticBody,
        );
        const horizontalOverlap =
          npcBounds.right > padBounds.left + 2 && npcBounds.left < padBounds.right - 2;
        const footDistance = npcBounds.bottom - padBounds.top;
        if (!horizontalOverlap || footDistance < -5 || footDistance > 9) {
          continue;
        }
        body.setVelocityY(this.options.bouncePadVelocity);
        liveObject.runtime.npcBounceCooldownUntil = now + this.options.bouncePadCooldownMs;
        this.options.playBounceFx(
          liveObject.sprite.x,
          liveObject.sprite.y,
          loadedRoom.room.coordinates,
        );
        return;
      }
    }
  }

  private playAnimation(liveObject: LoadedRoomObject, key: string): void {
    if (
      this.options.scene.anims.exists(key) &&
      liveObject.sprite.anims.currentAnim?.key !== key
    ) {
      liveObject.sprite.play(key);
    }
  }

  private syncNameLabel(liveObject: LoadedRoomObject): void {
    const label = liveObject.npcNameLabel;
    if (!label) {
      return;
    }
    label
      .setPosition(liveObject.sprite.x, liveObject.sprite.y - 19)
      .setDepth(liveObject.sprite.depth + 0.05)
      .setVisible(liveObject.sprite.visible && liveObject.sprite.active);
  }
}
