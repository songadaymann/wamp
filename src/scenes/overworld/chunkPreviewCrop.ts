import type { RoomCoordinates } from '../../persistence/roomModel';
import type { WorldChunkCoordinates } from '../../persistence/worldModel';
import { WORLD_CHUNK_SIZE } from '../../persistence/worldModel';

export interface ChunkPreviewCrop {
  minLocalRoomX: number;
  minLocalRoomY: number;
  maxLocalRoomX: number;
  maxLocalRoomY: number;
  roomColumns: number;
  roomRows: number;
}

export function calculateChunkPreviewCrop(
  chunkCoordinates: WorldChunkCoordinates,
  roomCoordinates: Iterable<RoomCoordinates>,
): ChunkPreviewCrop | null {
  let minLocalRoomX = Number.POSITIVE_INFINITY;
  let minLocalRoomY = Number.POSITIVE_INFINITY;
  let maxLocalRoomX = Number.NEGATIVE_INFINITY;
  let maxLocalRoomY = Number.NEGATIVE_INFINITY;

  for (const coordinates of roomCoordinates) {
    const localRoomX = coordinates.x - chunkCoordinates.x * WORLD_CHUNK_SIZE;
    const localRoomY = coordinates.y - chunkCoordinates.y * WORLD_CHUNK_SIZE;
    if (
      !Number.isSafeInteger(localRoomX)
      || !Number.isSafeInteger(localRoomY)
      || localRoomX < 0
      || localRoomX >= WORLD_CHUNK_SIZE
      || localRoomY < 0
      || localRoomY >= WORLD_CHUNK_SIZE
    ) {
      throw new RangeError('Chunk preview rooms must belong to the requested chunk.');
    }
    minLocalRoomX = Math.min(minLocalRoomX, localRoomX);
    minLocalRoomY = Math.min(minLocalRoomY, localRoomY);
    maxLocalRoomX = Math.max(maxLocalRoomX, localRoomX);
    maxLocalRoomY = Math.max(maxLocalRoomY, localRoomY);
  }

  if (!Number.isFinite(minLocalRoomX)) return null;
  return {
    minLocalRoomX,
    minLocalRoomY,
    maxLocalRoomX,
    maxLocalRoomY,
    roomColumns: maxLocalRoomX - minLocalRoomX + 1,
    roomRows: maxLocalRoomY - minLocalRoomY + 1,
  };
}
