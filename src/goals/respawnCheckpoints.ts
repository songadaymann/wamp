import { getObjectById, placedObjectLayerAllowsRuntimeCollision } from '../config/objects';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../config/room';
import type { RoomCoordinates, RoomSnapshot } from '../persistence/roomModel';

export const RESPAWN_CHECKPOINT_OBJECT_ID = 'checkpoint_flag';

export interface RespawnCheckpointReference {
  kind: 'start' | 'object' | 'goal';
  instanceId: string | null;
  checkpointIndex: number | null;
}

export interface RespawnCheckpoint extends RespawnCheckpointReference {
  kind: 'object' | 'goal';
  roomId: string;
  roomCoordinates: RoomCoordinates;
  /** Local coordinates of the player's feet at respawn. */
  x: number;
  y: number;
}

export function getObjectRespawnCheckpointPoint(
  placed: RoomSnapshot['placedObjects'][number],
): { x: number; y: number } | null {
  if (placed.id !== RESPAWN_CHECKPOINT_OBJECT_ID) return null;
  const config = getObjectById(placed.id);
  if (!config || !placedObjectLayerAllowsRuntimeCollision(config, placed)) return null;
  return {
    x: Math.max(0, Math.min(ROOM_PX_WIDTH, placed.x)),
    y: Math.max(0, Math.min(ROOM_PX_HEIGHT, placed.y + config.frameHeight / 2)),
  };
}
