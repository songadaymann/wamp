import { describe, expect, it } from 'vitest';
import { encodeTileDataValue } from '../config/editorState';
import { createDefaultRoomSnapshot } from '../persistence/roomModel';
import { roomSnapshotUsesCustomSprite } from './usage';

describe('roomSnapshotUsesCustomSprite', () => {
  it('finds placed and contained custom sprite objects', () => {
    const room = createDefaultRoomSnapshot('0,0', { x: 0, y: 0 });
    room.placedObjects = [
      { instanceId: 'placed-1', id: 'custom_sprite:placed', x: 16, y: 16 },
      {
        instanceId: 'container-1',
        id: 'question_box',
        x: 32,
        y: 16,
        containedObjectId: 'custom_sprite:contained',
      },
    ];

    expect(roomSnapshotUsesCustomSprite(room, 'placed')).toBe(true);
    expect(roomSnapshotUsesCustomSprite(room, 'contained')).toBe(true);
    expect(roomSnapshotUsesCustomSprite(room, 'missing')).toBe(false);
  });

  it('counts a custom tile only when a room layer actually paints it', () => {
    const room = createDefaultRoomSnapshot('0,0', { x: 0, y: 0 });
    room.customTiles = [
      {
        id: 'tile_unused',
        name: 'Unused',
        pixels: Array.from({ length: 256 }, () => null),
        collision: 'none',
        sourceSpriteId: 'unused',
        createdAt: '2026-08-14T00:00:00.000Z',
        updatedAt: '2026-08-14T00:00:00.000Z',
      },
      {
        id: 'tile_used',
        name: 'Used',
        pixels: Array.from({ length: 256 }, () => '#ffffff'),
        collision: 'solid',
        sourceSpriteId: 'used',
        createdAt: '2026-08-14T00:00:00.000Z',
        updatedAt: '2026-08-14T00:00:00.000Z',
      },
    ];
    room.tileData.terrain[2][3] = encodeTileDataValue(10_001, true, true);

    expect(roomSnapshotUsesCustomSprite(room, 'used')).toBe(true);
    expect(roomSnapshotUsesCustomSprite(room, 'unused')).toBe(false);
  });

  it('does not count an unplaced custom sprite definition as usage', () => {
    const room = createDefaultRoomSnapshot('0,0', { x: 0, y: 0 });
    room.customSprites = [{
      id: 'test-only',
      name: 'Test only',
      size: 16,
      kind: 'decoration',
      pixels: Array.from({ length: 256 }, () => null),
      status: 'active',
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    }];

    expect(roomSnapshotUsesCustomSprite(room, 'test-only')).toBe(false);
  });
});
