import Phaser from 'phaser';
import type {
  CourseSnapshot,
} from '../../courses/model';
import type {
  RoomCoordinates,
  RoomSnapshot,
} from '../../persistence/roomModel';
import {
  DEFAULT_PLAYER_ANIMATION_KEYS,
  DEFAULT_PLAYER_IDLE_FRAME,
  DEFAULT_PLAYER_IDLE_TEXTURE_KEY,
} from '../../player/defaultPlayer';
import {
  RETRO_COLORS,
} from '../../visuals/starfield';
import {
  resolveGoalRunStartPoint,
} from './goalRunStartGate';
import type {
  OverworldRoomEdgeWall,
} from './runtimeController';
import type {
  LoadedFullRoom,
} from './worldStreaming';

export interface OverworldPlayerEntities {
  player: Phaser.GameObjects.Rectangle;
  playerBody: Phaser.Physics.Arcade.Body;
  playerPickupSensor: Phaser.GameObjects.Rectangle;
  playerPickupSensorBody: Phaser.Physics.Arcade.Body;
  playerSprite: Phaser.GameObjects.Sprite;
}

interface OverworldPlayerLifecycleHost<TLiveObject> {
  scene: Phaser.Scene;
  getActiveCourseSnapshot(): CourseSnapshot | null;
  getRoomOrigin(coordinates: RoomCoordinates): { x: number; y: number };
  clearRoomInteractions(
    loadedRoom: LoadedFullRoom<TLiveObject, OverworldRoomEdgeWall>,
  ): void;
  destroyRoomEdgeWalls(
    loadedRoom: LoadedFullRoom<TLiveObject, OverworldRoomEdgeWall>,
  ): void;
  syncBackdropCameraIgnores(): void;
}

interface OverworldPlayerLifecycleOptions {
  playerWidth: number;
  playerHeight: number;
  playerPickupSensorExtraHeight: number;
}

export class OverworldPlayerLifecycleController<TLiveObject = unknown> {
  constructor(
    private readonly host: OverworldPlayerLifecycleHost<TLiveObject>,
    private readonly options: OverworldPlayerLifecycleOptions,
  ) {}

  createPlayer(startRoom: RoomSnapshot): OverworldPlayerEntities {
    const spawn = this.getPlayerSpawn(startRoom);
    const { scene } = this.host;

    const player = scene.add.rectangle(
      spawn.x,
      spawn.y,
      this.options.playerWidth,
      this.options.playerHeight,
      RETRO_COLORS.draft,
    );
    player.setVisible(false);
    player.setDepth(25);

    scene.physics.add.existing(player);
    const playerBody = player.body as Phaser.Physics.Arcade.Body;
    playerBody.setCollideWorldBounds(false);
    playerBody.setMaxVelocityY(500);
    playerBody.setAllowGravity(true);

    const playerPickupSensor = scene.add.rectangle(
      spawn.x,
      spawn.y,
      this.options.playerWidth,
      this.options.playerHeight + this.options.playerPickupSensorExtraHeight,
      RETRO_COLORS.draft,
    );
    playerPickupSensor.setVisible(false);
    scene.physics.add.existing(playerPickupSensor);
    const playerPickupSensorBody =
      playerPickupSensor.body as Phaser.Physics.Arcade.Body;
    playerPickupSensorBody.setAllowGravity(false);
    playerPickupSensorBody.setImmovable(true);
    playerPickupSensorBody.moves = false;

    const playerSprite = scene.add.sprite(
      spawn.x,
      spawn.y,
      DEFAULT_PLAYER_IDLE_TEXTURE_KEY,
      DEFAULT_PLAYER_IDLE_FRAME,
    );
    playerSprite.setOrigin(0.5, 1);
    playerSprite.setDepth(26);
    playerSprite.play(DEFAULT_PLAYER_ANIMATION_KEYS.idle);
    playerSprite.texture.setFilter(Phaser.Textures.FilterMode.NEAREST);

    this.host.syncBackdropCameraIgnores();
    return {
      player,
      playerBody,
      playerPickupSensor,
      playerPickupSensorBody,
      playerSprite,
    };
  }

  destroyPlayer(
    entities: OverworldPlayerEntities | null,
    loadedRooms: Iterable<LoadedFullRoom<TLiveObject, OverworldRoomEdgeWall>>,
  ): void {
    for (const loadedRoom of loadedRooms) {
      loadedRoom.terrainCollider?.destroy();
      loadedRoom.terrainCollider = null;
      loadedRoom.terrainInsetCollider?.destroy();
      loadedRoom.terrainInsetCollider = null;
      this.host.clearRoomInteractions(loadedRoom);
      this.host.destroyRoomEdgeWalls(loadedRoom);
    }

    entities?.playerBody.destroy();
    entities?.playerPickupSensorBody.destroy();
    entities?.playerPickupSensor.destroy();
    entities?.playerSprite.destroy();
    entities?.player.destroy();
    this.host.syncBackdropCameraIgnores();
  }

  respawnPlayerToRoom(
    currentRoom: RoomSnapshot,
    entities: OverworldPlayerEntities,
  ): void {
    const spawn = this.getPlayerSpawn(currentRoom);
    entities.playerBody.reset(spawn.x, spawn.y);
    entities.player.setPosition(spawn.x, spawn.y);
    entities.playerBody.setVelocity(0, 0);
  }

  private getPlayerSpawn(room: RoomSnapshot): { x: number; y: number } {
    const activeCourseSnapshot = this.host.getActiveCourseSnapshot();
    if (activeCourseSnapshot?.startPoint?.roomId === room.id) {
      const origin = this.host.getRoomOrigin(room.coordinates);
      return {
        x: origin.x + activeCourseSnapshot.startPoint.x,
        y: origin.y + activeCourseSnapshot.startPoint.y - this.options.playerHeight / 2,
      };
    }

    const startPoint = resolveGoalRunStartPoint(room, this.options.playerHeight);
    return {
      x: startPoint.x,
      y: startPoint.y - this.options.playerHeight / 2,
    };
  }
}
