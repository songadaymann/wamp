import { roomToChunkCoordinates, type WorldChunkBounds } from '../../persistence/worldModel';
import type { RoomCoordinates } from '../../persistence/roomModel';

/** Realtime follows the camera's streaming center, with at most nine nearby chunks. */
export function realtimeChunkBounds(bounds: WorldChunkBounds | null, localRoom?: RoomCoordinates): WorldChunkBounds | null {
  if (!bounds) return null;
  if (localRoom) {
    const { x, y } = roomToChunkCoordinates(localRoom);
    return { minChunkX: x - 1, maxChunkX: x + 1, minChunkY: y - 1, maxChunkY: y + 1 };
  }
  const x = Math.floor((bounds.minChunkX + bounds.maxChunkX) / 2);
  const y = Math.floor((bounds.minChunkY + bounds.maxChunkY) / 2);
  return { minChunkX: Math.max(bounds.minChunkX, x - 1), maxChunkX: Math.min(bounds.maxChunkX, x + 1),
    minChunkY: Math.max(bounds.minChunkY, y - 1), maxChunkY: Math.min(bounds.maxChunkY, y + 1) };
}
