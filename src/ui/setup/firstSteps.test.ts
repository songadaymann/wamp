import { describe, expect, it, vi } from 'vitest';
import { getTerrainCollisionProfileForGid, ROOM_WIDTH, ROOM_HEIGHT, TILE_SIZE } from '../../config';
import { createRoomSummaryFromRecord, createDefaultRoomRecord, getRoomPublishValidationError } from '../../persistence/roomModel';
import { createStarterRoomSnapshot, FIRST_STEPS_COORDINATES, loadFirstSteps } from './firstSteps';

describe('First Steps destinations', () => {
  it('loads the six published tutorial versions in order with controls and objectives', async () => {
    const loadRoomCurrent = vi.fn(async (id: string, coordinates: { x: number; y: number }) => {
      const record = createDefaultRoomRecord(id, coordinates);
      record.published = { ...createStarterRoomSnapshot(id, coordinates), status: 'published' as const, version: coordinates.x + 30 };
      return { summary: createRoomSummaryFromRecord(record), draft: record.draft, published: record.published };
    });
    const sequence = await loadFirstSteps({ loadRoomCurrent });
    expect(sequence.entries.map(entry => entry.roomId)).toEqual(['-11,-6', '-10,-6', '-9,-6', '-8,-6', '-7,-6', '-6,-6']);
    expect(sequence.entries.map(entry => entry.roomVersion)).toEqual([19, 20, 21, 22, 23, 24]);
    expect(sequence).toMatchObject({ kind: 'welcome', mode: 'play', forceGoalIntro: true, showDesktopControlsIntro: true });
  });

  it('keeps an unavailable tutorial as a visible retry instead of a partial run', async () => {
    const record = createDefaultRoomRecord('0,0', { x: 0, y: 0 });
    await expect(loadFirstSteps({ loadRoomCurrent: async () => ({ summary: createRoomSummaryFromRecord(record), draft: record.draft, published: record.published }) })).rejects.toThrow('tutorial room is unavailable');
  });

  it('starts a valid single-room exit challenge on walkable ground without changing another snapshot', () => {
    const starter = createStarterRoomSnapshot('24,9', { x: 24, y: 9 });
    expect(getRoomPublishValidationError(starter)).toBeNull();
    expect(starter.goal?.type).toBe('reach_exit');
    expect(starter.spawnPoint).not.toBeNull();
    expect(starter.tileData.terrain).toHaveLength(ROOM_HEIGHT);
    for (const gid of starter.tileData.terrain[ROOM_HEIGHT - 3]) expect(getTerrainCollisionProfileForGid(gid).hasCollision).toBe(true);
    expect(starter.tileData.terrain[ROOM_HEIGHT - 3]).toHaveLength(ROOM_WIDTH);
    expect(starter.spawnPoint!.y).toBeLessThan((ROOM_HEIGHT - 3) * TILE_SIZE);
    const other = createStarterRoomSnapshot('25,9', { x: 25, y: 9 });
    other.tileData.terrain[ROOM_HEIGHT - 3][0] = 0;
    expect(starter.tileData.terrain[ROOM_HEIGHT - 3][0]).not.toBe(0);
    expect(FIRST_STEPS_COORDINATES[0]).toEqual({ x: -11, y: -6 });
  });
});
