import Phaser from 'phaser';
import type { RoomCoordinates } from '../../persistence/roomModel';
import { canPlacedObjectHaveSignText } from '../../signs/model';
import type { LoadedRoomObject } from './liveObjects';
import type { LoadedFullRoom } from './worldStreaming';

const SIGN_ACTIVATION_RADIUS_PX = 52;
const SIGN_CHECK_INTERVAL_MS = 100;

export interface ActiveSignState {
  instanceId: string;
  objectId: string;
  objectLabel: string;
  roomCoordinates: RoomCoordinates;
  text: string;
}

interface OverworldSignControllerOptions<TEdgeWall> {
  getMode: () => 'browse' | 'play';
  getCurrentTime: () => number;
  getPlayerBody: () => Phaser.Physics.Arcade.Body | null;
  getLoadedFullRooms: () => Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>;
}

export class OverworldSignController<TEdgeWall = unknown> {
  private activeSign: ActiveSignState | null = null;
  private nextCheckAt = 0;
  private readonly signIndexesByRoom = new WeakMap<
    LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
    {
      source: LoadedRoomObject[];
      sourceLength: number;
      signs: LoadedRoomObject[];
    }
  >();

  constructor(private readonly options: OverworldSignControllerOptions<TEdgeWall>) {}

  update(): void {
    if (this.options.getMode() !== 'play') {
      this.activeSign = null;
      this.nextCheckAt = 0;
      return;
    }

    const playerBody = this.options.getPlayerBody();
    if (!playerBody) {
      this.activeSign = null;
      this.nextCheckAt = 0;
      return;
    }

    const now = this.options.getCurrentTime();
    if (now < this.nextCheckAt) {
      return;
    }
    this.nextCheckAt = now + SIGN_CHECK_INTERVAL_MS;

    let nextActiveSign: ActiveSignState | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const loadedRoom of this.options.getLoadedFullRooms()) {
      for (const liveObject of this.getIndexedSigns(loadedRoom)) {
        if (
          !liveObject.sprite.active ||
          !liveObject.placedInstanceId ||
          !liveObject.signText ||
          (liveObject.config.category === 'npc' && liveObject.runtime.npcVictorious)
        ) {
          continue;
        }

        const distance = Phaser.Math.Distance.Between(
          liveObject.sprite.x,
          liveObject.sprite.y,
          playerBody.center.x,
          playerBody.center.y,
        );
        if (distance > SIGN_ACTIVATION_RADIUS_PX || distance >= closestDistance) {
          continue;
        }

        closestDistance = distance;
        nextActiveSign = {
          instanceId: liveObject.placedInstanceId,
          objectId: liveObject.config.id,
          objectLabel: liveObject.npcName ?? liveObject.config.name,
          roomCoordinates: { ...loadedRoom.room.coordinates },
          text: liveObject.signText,
        };
      }
    }

    this.activeSign = nextActiveSign;
  }

  getActiveSign(): ActiveSignState | null {
    return this.activeSign ? { ...this.activeSign, roomCoordinates: { ...this.activeSign.roomCoordinates } } : null;
  }

  private getIndexedSigns(
    loadedRoom: LoadedFullRoom<LoadedRoomObject, TEdgeWall>,
  ): readonly LoadedRoomObject[] {
    const existing = this.signIndexesByRoom.get(loadedRoom);
    if (
      existing?.source === loadedRoom.liveObjects
      && existing.sourceLength === loadedRoom.liveObjects.length
    ) {
      return existing.signs;
    }

    const signs = loadedRoom.liveObjects.filter((liveObject) =>
      canPlacedObjectHaveSignText(liveObject.config)
    );
    this.signIndexesByRoom.set(loadedRoom, {
      source: loadedRoom.liveObjects,
      sourceLength: loadedRoom.liveObjects.length,
      signs,
    });
    return signs;
  }
}
