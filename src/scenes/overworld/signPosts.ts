import Phaser from 'phaser';
import type { RoomCoordinates } from '../../persistence/roomModel';
import { canPlacedObjectHaveSignText } from '../../signs/model';
import type { LoadedRoomObject } from './liveObjects';
import type { LoadedFullRoom } from './worldStreaming';

const SIGN_ACTIVATION_RADIUS_PX = 52;

export interface ActiveSignState {
  instanceId: string;
  objectId: string;
  objectLabel: string;
  roomCoordinates: RoomCoordinates;
  text: string;
}

interface OverworldSignControllerOptions<TEdgeWall> {
  getMode: () => 'browse' | 'play';
  getPlayerBody: () => Phaser.Physics.Arcade.Body | null;
  getLoadedFullRooms: () => Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>;
}

export class OverworldSignController<TEdgeWall = unknown> {
  private activeSign: ActiveSignState | null = null;

  constructor(private readonly options: OverworldSignControllerOptions<TEdgeWall>) {}

  update(): void {
    if (this.options.getMode() !== 'play') {
      this.activeSign = null;
      return;
    }

    const playerBody = this.options.getPlayerBody();
    if (!playerBody) {
      this.activeSign = null;
      return;
    }

    let nextActiveSign: ActiveSignState | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const loadedRoom of this.options.getLoadedFullRooms()) {
      for (const liveObject of loadedRoom.liveObjects) {
        if (
          !liveObject.sprite.active ||
          !liveObject.placedInstanceId ||
          !canPlacedObjectHaveSignText(liveObject.config) ||
          !liveObject.signText
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
          objectLabel: liveObject.config.name,
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
}
