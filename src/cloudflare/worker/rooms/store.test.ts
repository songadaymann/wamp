import { describe, expect, it } from 'vitest';
import { createDefaultRoomRecord, createDefaultRoomSnapshot } from '../../../persistence/roomModel';
import {
  buildRoomPermissions,
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
    expect(overview.tileData.foreground).toEqual([]);
    expect(overview.goalIntroText).toBeNull();
    expect(overview.placedObjects).toEqual([]);
    expect(overview.customSprites).toEqual([]);
  });
});

describe('buildRoomPermissions', () => {
  it('allows anyone to edit another user\'s published unminted room', () => {
    const record = createDefaultRoomRecord('1,2', { x: 1, y: 2 });
    record.claimerUserId = 'claimer-user';
    record.published = {
      ...record.draft,
      status: 'published',
      version: 3,
      publishedAt: '2026-08-01T00:00:00.000Z',
    };

    const permissions = buildRoomPermissions(record, 'other-user', null, false);

    expect(permissions.canSaveDraft).toBe(true);
    expect(permissions.canPublish).toBe(true);
    expect(permissions.canMint).toBe(false);
  });

  it('locks unpublished claimed drafts to the claimer only', () => {
    const record = createDefaultRoomRecord('1,2', { x: 1, y: 2 });
    record.claimerUserId = 'claimer-user';
    record.published = null;

    expect(buildRoomPermissions(record, 'other-user', null, false).canSaveDraft).toBe(false);
    expect(buildRoomPermissions(record, 'claimer-user', null, false).canSaveDraft).toBe(true);
  });

  it('locks minted rooms to the token owner wallet', () => {
    const record = createDefaultRoomRecord('1,2', { x: 1, y: 2 });
    record.claimerUserId = 'claimer-user';
    record.published = {
      ...record.draft,
      status: 'published',
      version: 3,
      publishedAt: '2026-08-01T00:00:00.000Z',
    };
    record.mintedChainId = 8453;
    record.mintedContractAddress = '0xabc';
    record.mintedTokenId = '7';
    record.mintedOwnerWalletAddress = '0xOwner';

    expect(buildRoomPermissions(record, 'claimer-user', '0xOther', false).canSaveDraft).toBe(false);
    expect(buildRoomPermissions(record, 'claimer-user', '0xOwner', false).canSaveDraft).toBe(true);
  });
});
