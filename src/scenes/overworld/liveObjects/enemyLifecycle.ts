import Phaser from 'phaser';
import { getObjectDisplayOffset } from '../../../config';
import type { RoomCoordinates } from '../../../persistence/roomModel';
import type { SfxCue } from '../../../audio/sfx';
import {
  SWORDSMAN_AI_OBJECT_ID,
} from '../../../enemies/swordsmanAi';
import type {
  SwordsmanDefeatMode,
  SwordsmanObjectiveMode,
} from '../../../enemies/swordsmanObjectives';
import type {
  CreateLiveObjectEntryOptions,
  LoadedRoomObject,
  WeaponHitResult,
} from '../liveObjects';
import type { LoadedFullRoom } from '../worldStreaming';
import {
  getArcadeBodyBounds,
} from './bodies';
import type { ArcadeObjectBody } from './bodies';

const SWORDSMAN_AI_RESPAWN_DELAY_MS = 1500;

interface EnemyLifecycleSettings {
  enemyStompBounceVelocity: number;
}

interface EnemyLifecycleOptions<TEdgeWall> {
  scene: Phaser.Scene;
  settings: EnemyLifecycleSettings;
  getLoadedFullRooms: () => Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>;
  getRoomOrigin: (coordinates: RoomCoordinates) => { x: number; y: number };
  getPlayer: () => Phaser.GameObjects.GameObject | null;
  getPlayerBody: () => Phaser.Physics.Arcade.Body | null;
  addScore: (delta: number) => void;
  playEnemyKillFx: (x: number, y: number, roomCoordinates: RoomCoordinates) => void;
  playBounceFx: (
    x: number,
    y: number,
    roomCoordinates: RoomCoordinates,
    cue?: SfxCue | null
  ) => void;
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
  getSwordsmanObjectiveMode: (liveObject: LoadedRoomObject) => SwordsmanObjectiveMode;
  getSwordsmanDefeatMode: (liveObject: LoadedRoomObject) => SwordsmanDefeatMode;
  swordsmanSwordCanDamagePlayer: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
    playerBody: Phaser.Physics.Arcade.Body,
  ) => boolean;
  createLiveObjectEntry: (
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    options: CreateLiveObjectEntryOptions,
  ) => LoadedRoomObject | null;
  destroyLiveObjectInteractions: (liveObject: LoadedRoomObject) => void;
  destroyLiveObjectWorldColliders: (liveObject: LoadedRoomObject) => void;
  destroyLiveObjectHelpers: (liveObject: LoadedRoomObject) => void;
  syncWorldObjectColliders: (
    loadedRooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
  ) => void;
  syncLiveObjectInteractions: (
    loadedRooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
  ) => void;
}

export class LiveObjectEnemyLifecycleController<TEdgeWall = unknown> {
  constructor(private readonly options: EnemyLifecycleOptions<TEdgeWall>) {}

  attackEnemiesInRect(
    loadedRooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
    attackRect: Phaser.Geom.Rectangle,
    maxHits = Number.POSITIVE_INFINITY
  ): WeaponHitResult[] {
    const hits: WeaponHitResult[] = [];

    for (const loadedRoom of loadedRooms) {
      for (const liveObject of [...loadedRoom.liveObjects]) {
        if (
          liveObject.config.category !== 'enemy' ||
          !liveObject.sprite.active ||
          !liveObject.sprite.body
        ) {
          continue;
        }

        const enemyBounds = getArcadeBodyBounds(liveObject.sprite.body as ArcadeObjectBody);
        if (!Phaser.Geom.Intersects.RectangleToRectangle(attackRect, enemyBounds)) {
          continue;
        }

        const hit = this.defeatEnemy(loadedRoom, liveObject);
        if (!hit) {
          continue;
        }

        hits.push(hit);
        if (hits.length >= maxHits) {
          return hits;
        }
      }
    }

    return hits;
  }

  attackEnemyAtPoint(
    loadedRooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
    x: number,
    y: number,
    radius = 6
  ): WeaponHitResult | null {
    const attackRect = new Phaser.Geom.Rectangle(x - radius, y - radius, radius * 2, radius * 2);
    return this.attackEnemiesInRect(loadedRooms, attackRect, 1)[0] ?? null;
  }

  handleEnemyContact(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject
  ): void {
    const playerBody = this.options.getPlayerBody();
    const player = this.options.getPlayer();
    if (!playerBody || !player || !liveObject.sprite.body) {
      return;
    }

    const enemyBody = liveObject.sprite.body as ArcadeObjectBody;
    const stomped = playerBody.velocity.y > 40 && playerBody.bottom <= enemyBody.top + 10;

    if (liveObject.config.id === SWORDSMAN_AI_OBJECT_ID) {
      if (stomped) {
        playerBody.setVelocityY(this.options.settings.enemyStompBounceVelocity);
        this.defeatEnemy(loadedRoom, liveObject);
        if (this.options.getSwordsmanDefeatMode(liveObject) === 'invincible') {
          this.options.playBounceFx(liveObject.sprite.x, liveObject.sprite.y, loadedRoom.room.coordinates);
        }
      } else if (
        this.options.getSwordsmanObjectiveMode(liveObject) === 'duel' &&
        this.options.swordsmanSwordCanDamagePlayer(loadedRoom, liveObject, playerBody)
      ) {
        this.options.handlePlayerDeath(`${liveObject.config.name} cut you down.`);
      }
      return;
    }

    if (!stomped) {
      this.options.handlePlayerDeath(`${liveObject.config.name} hit you.`);
      return;
    }

    playerBody.setVelocityY(this.options.settings.enemyStompBounceVelocity);
    this.defeatEnemy(loadedRoom, liveObject);
  }

  private defeatEnemy(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject
  ): WeaponHitResult | null {
    if (!liveObject.sprite.active) {
      return null;
    }
    if (
      liveObject.config.id === SWORDSMAN_AI_OBJECT_ID &&
      this.options.getSwordsmanDefeatMode(liveObject) === 'invincible'
    ) {
      this.options.showTransientStatus(`${liveObject.config.name} can't be defeated.`);
      return null;
    }

    const x = liveObject.sprite.x;
    const y = liveObject.sprite.y;
    const enemyName = liveObject.config.name;
    const respawnOptions =
      liveObject.config.id === SWORDSMAN_AI_OBJECT_ID &&
      this.options.getSwordsmanDefeatMode(liveObject) === 'respawn'
        ? this.createLiveObjectRespawnOptions(loadedRoom, liveObject)
        : null;

    this.options.addScore(10);
    this.options.playEnemyKillFx(x, y, loadedRoom.room.coordinates);
    this.options.destroyLiveObjectInteractions(liveObject);
    this.options.destroyLiveObjectWorldColliders(liveObject);
    this.options.destroyLiveObjectHelpers(liveObject);
    liveObject.sprite.destroy();
    loadedRoom.liveObjects = loadedRoom.liveObjects.filter((candidate) => candidate !== liveObject);

    const handledStatus = liveObject.countsTowardGoals
      ? this.options.onEnemyDefeated({
          roomId: loadedRoom.room.id,
          roomCoordinates: loadedRoom.room.coordinates,
          enemyName,
          instanceId: liveObject.placedInstanceId,
          x: x - this.options.getRoomOrigin(loadedRoom.room.coordinates).x,
          y: y - this.options.getRoomOrigin(loadedRoom.room.coordinates).y,
        })
      : false;
    if (!handledStatus) {
      this.options.showTransientStatus(
        respawnOptions ? `${enemyName} will respawn.` : `${enemyName} defeated.`
      );
    }

    if (respawnOptions) {
      this.scheduleLiveObjectRespawn(loadedRoom, respawnOptions);
    }

    return {
      roomId: loadedRoom.room.id,
      enemyName,
      x,
      y,
    };
  }

  private createLiveObjectRespawnOptions(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    liveObject: LoadedRoomObject,
  ): CreateLiveObjectEntryOptions {
    const roomOrigin = this.options.getRoomOrigin(loadedRoom.room.coordinates);
    const displayOffset = getObjectDisplayOffset(liveObject.config);
    const x = liveObject.runtime.baseX - roomOrigin.x - displayOffset.x;
    const y = liveObject.runtime.baseY - roomOrigin.y - displayOffset.y;
    return {
      key: liveObject.key,
      config: liveObject.config,
      x,
      y,
      facing: liveObject.runtime.initialDirectionX >= 0 ? 'right' : 'left',
      layer: liveObject.layer,
      baseTimeSeed: x + y,
      placedInstanceId: liveObject.placedInstanceId,
      linkedTargetRoomId: liveObject.linkedTargetRoomId,
      linkedTargetInstanceId: liveObject.linkedTargetInstanceId,
      containedObjectId: liveObject.containedObjectId,
      signText: liveObject.signText,
      objectiveMode: liveObject.runtime.aiObjectiveMode,
      defeatMode: liveObject.runtime.aiDefeatMode,
      countsTowardGoals: liveObject.countsTowardGoals,
    };
  }

  private scheduleLiveObjectRespawn(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    options: CreateLiveObjectEntryOptions,
  ): void {
    this.options.scene.time.delayedCall(SWORDSMAN_AI_RESPAWN_DELAY_MS, () => {
      if (!this.isLoadedRoomStillActive(loadedRoom)) {
        return;
      }
      if (loadedRoom.liveObjects.some((liveObject) => liveObject.key === options.key)) {
        return;
      }

      const respawned = this.options.createLiveObjectEntry(loadedRoom, options);
      if (!respawned) {
        return;
      }

      loadedRoom.liveObjects.push(respawned);
      this.options.syncWorldObjectColliders(this.options.getLoadedFullRooms());
      this.options.syncLiveObjectInteractions([loadedRoom]);
    });
  }

  private isLoadedRoomStillActive(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
  ): boolean {
    for (const candidate of this.options.getLoadedFullRooms()) {
      if (candidate === loadedRoom) {
        return true;
      }
    }
    return false;
  }
}
