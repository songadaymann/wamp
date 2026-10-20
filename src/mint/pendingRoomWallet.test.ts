import { describe, expect, it } from 'vitest';
import { PENDING_ROOM_WALLET_KEY, PendingRoomWalletStore } from './pendingRoomWallet';

import { pending, memoryStorage } from './roomWalletTestFixtures';

describe('durable room wallet hints', () => {
  it('roundtrips both approvals and an unknown hash through a new store', () => {
    const storage = memoryStorage(), first = new PendingRoomWalletStore(storage);
    const mint = pending({ txHash: null });
    const artwork = pending({ id: 'artwork', kind: 'artwork', tokenId: '42', metadataHash: 'a'.repeat(64), metadataRoomVersion: 5 });
    expect(first.put(mint)).toEqual({ durable: true }); first.put(artwork);
    const reloaded = new PendingRoomWalletStore(storage);
    expect(reloaded.list()).toEqual([mint, artwork]);
    reloaded.put({ ...mint, txHash: '0x' + 'c'.repeat(64) });
    first.remove(mint.id, null); // An old rejection must not erase a later returned hash.
    expect(first.list()[0].txHash).toBe('0x' + 'c'.repeat(64));
  });
  it.each(['junk', '{}', '[null]', JSON.stringify([pending({ chainId: 1 })]),
    JSON.stringify([pending({ roomId: 'school-room' })]), JSON.stringify([pending({ coordinates: { x: 1.5, y: 1 } })]),
    JSON.stringify([pending({ wallet: 'javascript:alert(1)' })]), JSON.stringify([pending({ txHash: '0x123' })]),
    JSON.stringify([pending(), pending()]), ' '.repeat(32_769)])('ignores corrupt or untrusted data %s', raw => {
    const storage = memoryStorage(); storage.setItem(PENDING_ROOM_WALLET_KEY, raw);
    expect(new PendingRoomWalletStore(storage).list()).toEqual([]);
  });
  it('keeps late hashes in memory if storage is unavailable, and reports the durability failure', () => {
    const storage = { getItem: () => { throw new Error('Blocked'); }, setItem: () => { throw new Error('Quota'); } };
    const store = new PendingRoomWalletStore(storage);
    expect(store.put(pending({ txHash: null }))).toEqual({ durable: false });
    expect(store.put(pending())).toEqual({ durable: false }); expect(store.list()).toEqual([pending()]);
    store.remove(pending().id, pending().txHash); expect(store.list()).toEqual([]);
  });
  it('refuses a seventeenth approval without discarding any unknown transaction', () => {
    const store = new PendingRoomWalletStore(memoryStorage());
    for (let i = 0; i < 16; i++) store.put(pending({ id: `operation-${i}` }));
    expect(() => store.put(pending({ id: 'overflow' }))).toThrow('pending room approvals');
    expect(store.list()).toHaveLength(16);
    store.put(pending({ id: 'operation-0', txHash: '0x' + '4'.repeat(64) }));
    expect(store.list()[0].txHash).toBe('0x' + '4'.repeat(64));
  });
  it('normalizes address case and returns isolated copies', () => {
    const store = new PendingRoomWalletStore(memoryStorage()); store.put(pending({ wallet: '0x' + 'A'.repeat(40) }));
    const first = store.list(); first[0].coordinates.x = 999;
    expect(store.list()[0]).toMatchObject({ coordinates: { x: 0, y: 1 }, wallet: '0x' + 'a'.repeat(40) });
  });
  it('removes a definitely declined unhashed intent while preserving a different operation', () => {
    const store = new PendingRoomWalletStore(memoryStorage());
    store.put(pending({ txHash: null })); store.put(pending({ id: 'other' }));
    store.remove('test-operation', null); expect(store.list().map(p => p.id)).toEqual(['other']);
  });
});
