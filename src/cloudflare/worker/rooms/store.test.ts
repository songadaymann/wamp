import { describe, expect, it } from 'vitest';
import { createDefaultRoomSnapshot } from '../../../persistence/roomModel';
import type { D1Database, D1PreparedStatement, Env } from '../core/types';
import {
  createOverviewRoomSnapshot,
  decodeRoomVersionCursor,
  dedupeSnapshotReferences,
  encodeRoomVersionCursor,
  loadRoomSummary,
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

  it('keeps published unminted rooms editable when building a compact summary', async () => {
    const summary = await loadRoomSummary(
      createCompactSummaryEnv({ publishedVersion: 12 }),
      '2,1',
      { x: 2, y: 1 },
      'another-user',
      null,
    );

    expect(summary.permissions).toMatchObject({
      canSaveDraft: true,
      canPublish: true,
      canRevert: false,
    });
  });

  it('keeps claimed unpublished rooms private to their claimer in compact summaries', async () => {
    const summary = await loadRoomSummary(
      createCompactSummaryEnv({ publishedVersion: null }),
      '2,1',
      { x: 2, y: 1 },
      'another-user',
      null,
    );

    expect(summary.permissions).toMatchObject({
      canSaveDraft: false,
      canPublish: false,
      canRevert: false,
    });
  });
});

function createCompactSummaryEnv(options: { publishedVersion: number | null }): Env {
  const row = {
    id: '2,1',
    x: 2,
    y: 1,
    draft_title: 'Draft',
    published_title: options.publishedVersion === null ? null : 'Published',
    claimer_user_id: 'room-claimer',
    claimer_principal_type: 'user',
    claimer_agent_id: null,
    claimer_display_name: 'Room Claimer',
    claimed_at: '2026-03-14T20:00:40.750Z',
    last_published_by_user_id: 'room-claimer',
    last_published_by_principal_type: 'user',
    last_published_by_agent_id: null,
    last_published_by_display_name: 'Room Claimer',
    minted_chain_id: null,
    minted_contract_address: null,
    minted_token_id: null,
    minted_owner_wallet_address: null,
    minted_owner_synced_at: null,
    minted_metadata_room_version: null,
    minted_metadata_updated_at: null,
    minted_metadata_hash: null,
    canonical_version: options.publishedVersion,
    draft_version: options.publishedVersion ?? 1,
    published_version: options.publishedVersion,
    draft_updated_at: '2026-08-10T00:00:00.000Z',
    published_updated_at:
      options.publishedVersion === null ? null : '2026-08-10T00:00:00.000Z',
  };
  const statement: D1PreparedStatement = {
    bind: () => statement,
    first: async <T>() => row as T,
    all: async <T>() => ({ results: [] as T[] }),
  };
  const database: D1Database = {
    prepare: () => statement,
    batch: async <T>() => [] as T[],
  };

  return {
    DB: database,
    JAM_DB: database,
    ASSETS: { fetch: async () => new Response() },
  };
}
