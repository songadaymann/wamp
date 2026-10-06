import type Phaser from 'phaser';
import { getObjectRespawnCheckpointPoint, RESPAWN_CHECKPOINT_OBJECT_ID, type RespawnCheckpoint } from '../../../goals/respawnCheckpoints';
import type { LoadedFullRoom } from '../worldStreaming';
import type { LoadedRoomObject } from './model';

interface CheckpointPresentationHost {
  scene: Phaser.Scene;
  isReached(roomId: string, instanceId: string): boolean;
  onTouched(checkpoint: RespawnCheckpoint): void;
}

/** Authored flag contacts and their visible, non-colour-only reached state. */
export class LiveObjectRespawnCheckpointController<TEdgeWall = unknown> {
  private readonly marks = new WeakMap<LoadedRoomObject, Phaser.GameObjects.Graphics>();

  constructor(private readonly host: CheckpointPresentationHost) {}

  touch(room: LoadedFullRoom<LoadedRoomObject, TEdgeWall>, object: LoadedRoomObject): void {
    if (room.runtimeSuspended || !object.sprite.active || !object.placedInstanceId) return;
    const placed = room.room.placedObjects.find(candidate => candidate.instanceId === object.placedInstanceId);
    const point = placed ? getObjectRespawnCheckpointPoint(placed) : null;
    if (!point) return;
    this.host.onTouched({ kind: 'object', roomId: room.room.id, roomCoordinates: { ...room.room.coordinates },
      ...point, instanceId: object.placedInstanceId, checkpointIndex: null });
  }

  sync(rooms: Iterable<LoadedFullRoom<LoadedRoomObject, TEdgeWall>>): void {
    for (const room of rooms) {
      for (const object of room.liveObjects) this.syncObject(room, object);
    }
  }

  syncObject(room: LoadedFullRoom<LoadedRoomObject, TEdgeWall>, object: LoadedRoomObject): void {
    if (object.config.id !== RESPAWN_CHECKPOINT_OBJECT_ID || !object.sprite.active) return;
    const reached = Boolean(object.placedInstanceId && this.host.isReached(room.room.id, object.placedInstanceId));
    const green = reached && this.host.scene.textures.exists('goal-marker-flag-green');
    const texture = green ? 'goal-marker-flag-green' : object.config.id;
    const animation = green ? 'goal-marker-flag-green-anim' : `${object.config.id}_anim`;
    if (object.sprite.texture.key !== texture) {
      object.sprite.stop(); object.sprite.setTexture(texture, 0);
      if (this.host.scene.anims.exists(animation)) object.sprite.play(animation);
    }
    let mark = this.marks.get(object);
    if (!mark?.active) {
      mark = this.host.scene.add.graphics();
      // A check shape stays legible without relying on the flag's colour.
      for (const [width, color] of [[4, 0x101522], [2, 0xffffff]]) {
        mark.lineStyle(width, color, 1);
        mark.beginPath(); mark.moveTo(-5, 0); mark.lineTo(-1, 4); mark.lineTo(6, -5); mark.strokePath();
      }
      mark.setPosition(object.sprite.x, object.sprite.y - 22);
      mark.setDepth(object.sprite.depth + 0.05);
      object.helpers.push(mark); this.marks.set(object, mark);
    }
    mark.setVisible(reached);
  }
}
