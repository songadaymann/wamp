import { describe, expect, it } from 'vitest';
import { WORLD_CHUNK_SIZE } from '../../persistence/worldModel';
import { calculateChunkPreviewCrop } from './chunkPreviewCrop';

describe('chunk preview crop geometry', () => {
  it('returns the tight inclusive local-room bounds', () => {
    expect(calculateChunkPreviewCrop(
      { x: 0, y: 0 },
      [{ x: 2, y: 3 }, { x: 5, y: 6 }, { x: 4, y: 4 }],
    )).toEqual({
      minLocalRoomX: 2,
      minLocalRoomY: 3,
      maxLocalRoomX: 5,
      maxLocalRoomY: 6,
      roomColumns: 4,
      roomRows: 4,
    });
  });

  it('uses floor-divided chunk origins for negative coordinates', () => {
    const chunk = { x: -2, y: -3 };
    const chunkOriginX = chunk.x * WORLD_CHUNK_SIZE;
    const chunkOriginY = chunk.y * WORLD_CHUNK_SIZE;
    expect(calculateChunkPreviewCrop(chunk, [
      { x: chunkOriginX + 1, y: chunkOriginY + 2 },
      { x: chunkOriginX + 3, y: chunkOriginY + 5 },
    ])).toMatchObject({
      minLocalRoomX: 1,
      minLocalRoomY: 2,
      maxLocalRoomX: 3,
      maxLocalRoomY: 5,
      roomColumns: 3,
      roomRows: 4,
    });
  });

  it('preserves the legacy full-chunk extent when edge cells are present', () => {
    expect(calculateChunkPreviewCrop({ x: 1, y: 1 }, [
      { x: WORLD_CHUNK_SIZE, y: WORLD_CHUNK_SIZE },
      { x: WORLD_CHUNK_SIZE * 2 - 1, y: WORLD_CHUNK_SIZE * 2 - 1 },
    ])).toMatchObject({
      minLocalRoomX: 0,
      minLocalRoomY: 0,
      maxLocalRoomX: WORLD_CHUNK_SIZE - 1,
      maxLocalRoomY: WORLD_CHUNK_SIZE - 1,
      roomColumns: WORLD_CHUNK_SIZE,
      roomRows: WORLD_CHUNK_SIZE,
    });
  });

  it('returns null for an empty chunk and rejects cross-chunk rooms', () => {
    expect(calculateChunkPreviewCrop({ x: 0, y: 0 }, [])).toBeNull();
    expect(() => calculateChunkPreviewCrop(
      { x: 0, y: 0 },
      [{ x: WORLD_CHUNK_SIZE, y: 0 }],
    )).toThrow('must belong to the requested chunk');
  });
});
