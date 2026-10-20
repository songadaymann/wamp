import type Phaser from 'phaser';
import type { LoadedFullRoom } from '../worldStreaming';
import type { LoadedRoomObject } from './model';

/** Side pushes are applied after the player velocity is set, and only when the NPC is not against a wall. */
export function pushActiveNpcsFromPlayer<TEdgeWall>(
  playerBody: Phaser.Physics.Arcade.Body | null,
  rooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>,
  getDynamicBody: (sprite: Phaser.GameObjects.Sprite) => Phaser.Physics.Arcade.Body | null,
  applyPlayerPush: (
    liveObject: LoadedRoomObject,
    npcBody: Phaser.Physics.Arcade.Body,
    playerBody: Phaser.Physics.Arcade.Body,
  ) => void,
): void {
  if (!playerBody) {
    return;
  }

  for (const loadedRoom of rooms) {
    if (loadedRoom.runtimeSuspended === true) {
      continue;
    }
    for (const liveObject of loadedRoom.liveObjects) {
      if (liveObject.config.category !== 'npc' || !liveObject.sprite.active) {
        continue;
      }
      const body = getDynamicBody(liveObject.sprite);
      if (!body?.enable) {
        continue;
      }
      applyPlayerPush(liveObject, body, playerBody);
    }
  }
}
