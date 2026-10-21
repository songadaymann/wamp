import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoveryFixture } from '../runs/discoveryTestDatabase';
import { loadRoomDiscoveryResponse } from '../runs/difficulty';
import { loadUserProfileRoomsPage } from '../profiles/store';
import { loadClaimedUnpublishedRoomsInBounds, loadPublishedRoomsInBounds, loadWorldRoomSummariesInBounds } from './store';
import { computeCompactWorldChunkWindow, computeWorldChunkWindow, computeWorldWindow } from '../../../persistence/worldModel';
import { loadProtectedRoomIds } from './protection';

let f: ReturnType<typeof discoveryFixture>;
beforeEach(() => {
  f = discoveryFixture();
  // The general discovery fixture only needs each target's representative. Protection counts every pinned cell.
  for (const [target, id] of [['native', '8,0'], ['course:legacy', '10,0']]) {
    f.sqlite.prepare('INSERT INTO playable_content_index_members(target_key,room_id,room_version) VALUES (?,?,1)')
      .run(`expanded_room:${target}`, id);
  }
});
afterEach(() => { f.sqlite.close(); vi.restoreAllMocks(); });
const protect = (id: string, field = 'minted_token_id') => {
  if (!['minted_token_id', 'minted_contract_address', 'minted_chain_id'].includes(field)) throw new Error('Unexpected fixture field');
  f.sqlite.prepare(`UPDATE rooms SET ${field}=? WHERE id=?`).run(field === 'minted_chain_id' ? 8453 : field === 'minted_token_id' ? '42' : '0x1111111111111111111111111111111111111111', id);
};

describe('public room protection metadata', () => {
  it.each(['minted_token_id', 'minted_contract_address', 'minted_chain_id'])('preserves conservative protection from %s across compact and legacy world reads', async field => {
    const before = computeCompactWorldChunkWindow(await loadWorldRoomSummariesInBounds(f.env, -1, 15, -1, 1), { minChunkX: 0, maxChunkX: 1, minChunkY: 0, maxChunkY: 0 });
    protect('0,0', field);
    const bounds = { minChunkX: 0, maxChunkX: 1, minChunkY: 0, maxChunkY: 0 };
    const compact = computeCompactWorldChunkWindow(await loadWorldRoomSummariesInBounds(f.env, -1, 15, -1, 1), bounds);
    const sources = await loadPublishedRoomsInBounds(f.env, -1, 15, -1, 1);
    const legacy = computeWorldChunkWindow(sources, bounds);
    const world = computeWorldWindow(sources, { x: 0, y: 0 }, 2);
    for (const rooms of [compact.chunks.flatMap(c => c.rooms), legacy.chunks.flatMap(c => c.rooms), world.rooms]) {
      expect(rooms.find(r => r.id === '0,0')).toMatchObject({ isMinted: true, creatorUserId: 'builder' });
      expect(rooms.find(r => r.id === '1,0')).not.toHaveProperty('isMinted');
      expect(JSON.stringify(rooms)).not.toContain('minted_token_id');
      expect(JSON.stringify(rooms)).not.toContain('0x111111');
    }
    expect(compact.chunks.map(c => c.chunkPreviewHash)).toEqual(before.chunks.map(c => c.chunkPreviewHash));
  });
  it('retains stored protection on private claimed cells without exposing private snapshots in compact reads', async () => {
    protect('0,0'); f.sqlite.prepare("UPDATE rooms SET published_json=NULL,claimed_at='2026-10-21T00:00:00Z' WHERE id='0,0'").run();
    const sources = await loadClaimedUnpublishedRoomsInBounds(f.env, -1, 1, -1, 1);
    expect(sources.find(r => r.snapshot.id === '0,0')?.isMinted).toBe(true);
    const summary = (await loadWorldRoomSummariesInBounds(f.env, -1, 1, -1, 1)).find(r => r.id === '0,0');
    expect(summary).toMatchObject({ state: 'claimed_unpublished', isMinted: true });
    expect(summary).not.toHaveProperty('snapshot');
  });
  it.each([false, true])('counts partial native/legacy targets, omits ordinary rooms and keeps builder credit; index=%s', async index => {
    f.env.PLAYABLE_CONTENT_INDEX_READS = index ? '1' : '0';
    protect('1,0'); protect('8,0', 'minted_chain_id'); protect('9,0'); protect('10,0');
    // A collector is not the original builder.
    f.sqlite.prepare("UPDATE rooms SET minted_owner_wallet_address='0x2222222222222222222222222222222222222222' WHERE minted_token_id IS NOT NULL").run();
    const rooms = (await loadRoomDiscoveryResponse(f.env, null, 100, 'newest', true)).results;
    expect(rooms.find(r => r.roomId === '1,0')).toMatchObject({ protectedCellCount: 1, builderUserId: 'builder', builderDisplayName: 'builder' });
    expect(rooms.find(r => r.expandedRoom?.expandedRoomId === 'native')).toMatchObject({ protectedCellCount: 1, expandedRoom: { cellCount: 2 } });
    expect(rooms.find(r => r.expandedRoom?.expandedRoomId === 'course:legacy')).toMatchObject({ protectedCellCount: 2, expandedRoom: { cellCount: 2 } });
    expect(rooms.find(r => r.roomId === '2,0')).not.toHaveProperty('protectedCellCount');
    expect(JSON.stringify(rooms)).not.toContain('0x222222');
    const profile = (await loadUserProfileRoomsPage(f.env, 'builder', 100, null)).results;
    expect(profile.find(r => r.expandedRoom?.expandedRoomId === 'native')).toMatchObject({ protectedCellCount: 1 });
    expect(profile.find(r => r.expandedRoom?.expandedRoomId === 'course:legacy')).toMatchObject({ protectedCellCount: 2 });
    expect(profile.find(r => r.roomId === '2,0')).not.toHaveProperty('protectedCellCount');
  });
  it('counts pinned cells even when a cell has a newer standalone version', async () => {
    protect('8,0');
    const snapshot = JSON.parse((f.sqlite.prepare("SELECT published_json FROM rooms WHERE id='8,0'").get() as { published_json: string }).published_json);
    f.sqlite.prepare("UPDATE rooms SET published_json=? WHERE id='8,0'").run(JSON.stringify({ ...snapshot, version: 2 }));
    f.sqlite.prepare("INSERT INTO room_versions(room_id,version,snapshot_json,title,created_at) VALUES ('8,0',2,?,'Newer cell',?)").run(JSON.stringify({ ...snapshot, version: 2 }), snapshot.publishedAt);
    const rooms = (await loadRoomDiscoveryResponse(f.env, null, 100, 'newest', true)).results;
    expect(rooms.find(r => r.expandedRoom?.expandedRoomId === 'native')?.protectedCellCount).toBe(1);
    expect(rooms.find(r => r.roomId === '8,0' && !r.expandedRoom)?.protectedCellCount).toBe(1);
  });
  it('looks up only foreign-author cells missing from a legacy profile without transferring builder credit', async () => {
    f.sqlite.prepare("UPDATE rooms SET claimer_user_id='p2' WHERE id='8,0'").run(); protect('8,0');
    const prepare = vi.spyOn(f.env.DB, 'prepare');
    const profile = (await loadUserProfileRoomsPage(f.env, 'builder', 100, null)).results;
    expect(profile.find(r => r.expandedRoom?.expandedRoomId === 'native')?.protectedCellCount).toBe(1);
    expect(prepare.mock.calls.filter(([sql]) => sql.includes('SELECT id FROM rooms') && sql.includes('minted_chain_id'))).toHaveLength(1);
  });
  it('bounds and deduplicates metadata reads and does not query empty input', async () => {
    const prepare = vi.spyOn(f.env.DB, 'prepare'); expect(await loadProtectedRoomIds(f.env, [])).toEqual(new Set()); expect(prepare).not.toHaveBeenCalled();
    protect('0,0'); expect(await loadProtectedRoomIds(f.env, ['0,0', '0,0', ...Array.from({ length: 161 }, (_, n) => `absent-${n}`)])).toEqual(new Set(['0,0']));
    expect(prepare).toHaveBeenCalledTimes(3);
  });
});
