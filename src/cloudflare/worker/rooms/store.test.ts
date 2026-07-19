import { describe, expect, it } from 'vitest';
import { createDefaultRoomSnapshot } from '../../../persistence/roomModel';
import {
  createOverviewRoomSnapshot,
  decodeRoomVersionCursor,
  dedupeSnapshotReferences,
  encodeRoomVersionCursor,
  loadRoomSnapshotsByReferences,
  snapshotReferenceKey,
} from './store';

describe('compact room reads', () => {
  it('uses stable opaque room-version cursors', () => {
    const cursor = encodeRoomVersionCursor(176);
    expect(cursor).not.toContain('176');
    expect(decodeRoomVersionCursor(cursor)).toBe(176);
    expect(() => decodeRoomVersionCursor('not-a-cursor')).toThrow('Invalid room version cursor');
  });

  it('deduplicates exact versions without merging mutable preview states', () => {
    const references = dedupeSnapshotReferences([
      { kind: 'version', roomId: '0,0', version: 5 },
      { kind: 'version', roomId: '0,0', version: 5 },
      { kind: 'current_preview', roomId: '0,0', state: 'published', updatedAt: '2026-07-18T00:00:00.000Z' },
      { kind: 'current_preview', roomId: '0,0', state: 'claimed_unpublished', updatedAt: '2026-07-18T00:00:00.000Z' },
    ]);

    expect(references).toHaveLength(3);
    expect(new Set(references.map(snapshotReferenceKey)).size).toBe(3);
  });

  it('rejects snapshot batches larger than 128 before issuing D1 statements', async () => {
    const references = Array.from({ length: 129 }, (_, version) => ({
      kind: 'version' as const,
      roomId: '0,0',
      version: version + 1,
    }));
    await expect(loadRoomSnapshotsByReferences({} as never, references)).rejects.toThrow(
      'A maximum of 128 room snapshot references is allowed.',
    );
  });

  it('keeps overview rendering data while dropping unused full-room fields', () => {
    const snapshot = createDefaultRoomSnapshot('2,3', { x: 2, y: 3 });
    snapshot.background = 'grassland';
    snapshot.tileData.background[0][0] = 1;
    snapshot.tileData.terrain[1][1] = 2;
    snapshot.tileData.foreground[2][2] = 3;
    snapshot.goalIntroText = 'Reach the goal';

    const overview = createOverviewRoomSnapshot(snapshot);

    expect(overview.background).toBe('grassland');
    expect(overview.tileData.background[0][0]).toBe(1);
    expect(overview.tileData.terrain[1][1]).toBe(2);
    expect(overview.tileData.foreground.flat().every((tile) => tile === -1)).toBe(true);
    expect(overview.goalIntroText).toBeNull();
    expect(overview.placedObjects).toEqual([]);
    expect(overview.customSprites).toEqual([]);
  });
});
