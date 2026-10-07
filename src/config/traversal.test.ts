import { describe, expect, it } from 'vitest';
import { getObjectById, getSpecialTileKindForGid, getTerrainCollisionProfileForGid,
  getTilesetByKey, isTilesetLocalTileEditorEnabled, SPECIAL_TILESET_FIRST_GID, SPECIAL_TILE_LOCAL_INDICES } from '../config';
import { cloneRoomSnapshot, countRoomPlacedObjectsByCategory, createDefaultRoomRecord, normalizeRoomRecord } from '../persistence/roomModel';

describe('traversal authoring and persistence', () => {
  it('exposes one solid crumbling tile while preserving reserved portal indices', () => {
    const special = getTilesetByKey('special')!;
    const index = SPECIAL_TILE_LOCAL_INDICES.crumbling, gid = SPECIAL_TILESET_FIRST_GID + index;
    expect(index).toBe(18); expect(getSpecialTileKindForGid(gid)).toBe('crumbling');
    expect(getTerrainCollisionProfileForGid(gid).hasCollision).toBe(true);
    expect(isTilesetLocalTileEditorEnabled(special, index)).toBe(true);
    for (const portal of [16, 17]) {
      expect(getSpecialTileKindForGid(SPECIAL_TILESET_FIRST_GID + portal)).toBe(null);
      expect(isTilesetLocalTileEditorEnabled(special, portal)).toBe(false);
    }
  });

  it('preserves spring facing and new objects through room/expanded-cell record and snapshot round trips', () => {
    for (const id of ['99,99', '100,99']) {
      const record = createDefaultRoomRecord(id, { x: Number(id.split(',')[0]), y: 99 });
      record.draft.placedObjects = [
        { id: 'spring_side', x: 40, y: 64, instanceId: 'side', facing: 'left', layer: 'terrain' },
        { id: 'spring_diagonal', x: 64, y: 64, instanceId: 'diagonal', facing: 'right', layer: 'terrain' },
        { id: 'double_jump_feather', x: 80, y: 32, instanceId: 'feather', layer: 'terrain' },
      ];
      record.draft.tileData.terrain[10][10] = SPECIAL_TILESET_FIRST_GID + SPECIAL_TILE_LOCAL_INDICES.crumbling;
      record.published = cloneRoomSnapshot(record.draft);
      const restored = normalizeRoomRecord(JSON.parse(JSON.stringify(record)), id, record.draft.coordinates);
      expect(restored.draft.placedObjects.map(p => [p.id, p.facing])).toEqual([
        ['spring_side', 'left'], ['spring_diagonal', 'right'], ['double_jump_feather', undefined],
      ]);
      expect(restored.published?.tileData.terrain[10][10]).toBe(687);
      expect(countRoomPlacedObjectsByCategory(restored.draft.placedObjects, 'collectible')).toBe(0);
      expect(countRoomPlacedObjectsByCategory(restored.draft.placedObjects, 'enemy')).toBe(0);
      expect(getObjectById('double_jump_feather')?.category).toBe('interactive');
    }
  });
});
