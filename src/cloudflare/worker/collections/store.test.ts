import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoveryFixture } from '../runs/discoveryTestDatabase';
import { loadCollectionAttribution, loadCollectionShelf } from './store';
const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
describe('public collections use recorded owners and preserve builders', () => {
  let f: ReturnType<typeof discoveryFixture>;
  beforeEach(() => {
    f = discoveryFixture();
    f.sqlite.prepare("UPDATE users SET wallet_address=?, display_name='Collector One' WHERE id='p1'").run(A);
    f.sqlite.prepare("UPDATE users SET wallet_address=? WHERE id='p2'").run(B);
    for (const id of ['1,0', '7,0', '8,0', '9,0', '10,0']) f.sqlite.prepare(`UPDATE rooms SET
      minted_chain_id=8453, minted_contract_address=?,minted_token_id='42',minted_owner_wallet_address=?,minted_owner_synced_at='2026-10-21T00:00:00.000Z' WHERE id=?`).run(A, A, id);
  });
  afterEach(() => f.sqlite.close());
  it('attributes standalone cells to a collector independently of the builder', async () => {
    expect(await loadCollectionAttribution(f.env, 'room:1,0')).toMatchObject({ cellCount: 1, collectors: [{ userId: 'p1', displayName: 'Collector One', cellCount: 1 }] });
    const shelf = await loadCollectionShelf(f.env, 'p1', 48, null);
    expect(shelf.results).toHaveLength(5);
    expect(shelf.results.find(r => r.roomId === '1,0')).toMatchObject({ builder: { userId: 'builder' }, viewerUrl: expect.stringContaining('/minted-room.html?chainId=8453') });
    expect(shelf.results.find(r => r.roomId === '8,0')?.expandedRoomTitle).toBeTruthy();
  });
  it('counts distinct native/legacy cells by current recorded owner, not the whole board', async () => {
    f.sqlite.prepare("UPDATE rooms SET minted_owner_wallet_address=? WHERE id='8,0'").run(B);
    expect(await loadCollectionAttribution(f.env, 'native')).toMatchObject({ cellCount: 2, collectors: expect.arrayContaining([{ userId: 'p1', displayName: 'Collector One', walletAddress: A, cellCount: 1 }, { userId: 'p2', displayName: 'p2', walletAddress: B, cellCount: 1 }]) });
    expect(await loadCollectionAttribution(f.env, 'course:legacy')).toMatchObject({ cellCount: 2, collectors: [{ cellCount: 2, userId: 'p1', displayName: 'Collector One', walletAddress: A }] });
  });
  it('moves a refreshed transfer between shelves without changing builder credit', async () => {
    f.sqlite.prepare("UPDATE rooms SET minted_owner_wallet_address=? WHERE id='1,0'").run(B);
    expect((await loadCollectionShelf(f.env, 'p1', 48, null)).results.some(r => r.roomId === '1,0')).toBe(false);
    expect((await loadCollectionShelf(f.env, 'p2', 48, null)).results[0]).toMatchObject({ roomId: '1,0', builder: { userId: 'builder' } });
    expect((await loadCollectionAttribution(f.env, 'room:1,0')).collectors[0].userId).toBe('p2');
  });
  it('paginates stably without duplicates and binds cursors to the profile', async () => {
    const seen = []; let cursor: string | null = null;
    do { const page = await loadCollectionShelf(f.env, 'p1', 2, cursor); seen.push(...page.results.map(r => r.roomId)); cursor = page.nextCursor ?? null; } while (cursor);
    expect(seen).toHaveLength(5); expect(new Set(seen).size).toBe(5);
    const first = await loadCollectionShelf(f.env, 'p1', 1, null);
    await expect(loadCollectionShelf(f.env, 'p2', 1, first.nextCursor!)).rejects.toMatchObject({ status: 400 });
    await expect(loadCollectionShelf(f.env, 'p1', 1, 'bad')).rejects.toMatchObject({ status: 400 });
  });
  it('omits drafts, unminted cells and zero/unavailable owners; no profile means a short wallet label', async () => {
    f.sqlite.prepare("UPDATE rooms SET published_json=NULL WHERE id='1,0'").run();
    f.sqlite.prepare("UPDATE rooms SET minted_chain_id=NULL,minted_contract_address=NULL,minted_token_id=NULL WHERE id='7,0'").run();
    expect((await loadCollectionShelf(f.env, 'p1', 48, null)).results).toHaveLength(3);
    f.sqlite.prepare("UPDATE rooms SET minted_owner_wallet_address='0x3333333333333333333333333333333333333333' WHERE id='8,0'").run();
    expect((await loadCollectionAttribution(f.env, 'native')).collectors[0]).toMatchObject({ userId: null, displayName: '0x3333…3333' });
    f.sqlite.prepare("UPDATE rooms SET minted_owner_wallet_address='0x0000000000000000000000000000000000000000' WHERE id='8,0'").run();
    expect((await loadCollectionAttribution(f.env, 'native')).collectors).toEqual([]);
    expect(await loadCollectionShelf(f.env, 'builder', 24, null)).toEqual({ results: [] });
    await expect(loadCollectionShelf(f.env, 'missing', 24, null)).rejects.toMatchObject({ status: 404 });
  });
  it('uses null freshness for incomplete snapshots and never returns private profile fields', async () => {
    f.sqlite.prepare("UPDATE rooms SET minted_owner_synced_at=NULL WHERE id='8,0'").run();
    const result = await loadCollectionAttribution(f.env, 'native'); expect(result.ownerSyncedAt).toBeNull();
    expect(JSON.stringify(result)).not.toContain('@example.test');
    expect(JSON.stringify(await loadCollectionShelf(f.env, 'p1', 48, null))).not.toMatch(/email|token_hash|walletAddress/);
  });
});
