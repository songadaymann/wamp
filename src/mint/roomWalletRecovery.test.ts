import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRoomRecord, createRoomSummaryFromRecord } from '../persistence/roomModel';
import { PendingRoomWalletStore } from './pendingRoomWallet';
import { pending, memoryStorage } from './roomWalletTestFixtures';
import { RoomWalletRecovery, waitForRoomWallet } from './roomWalletRecovery';

function fixture(artwork = false) {
  const p = pending(artwork ? { kind: 'artwork', tokenId: '42', metadataHash: 'a'.repeat(64), metadataRoomVersion: 5 } : {});
  const storage = memoryStorage(), store = new PendingRoomWalletStore(storage); store.put(p);
  const summary = createRoomSummaryFromRecord(createDefaultRoomRecord(p.roomId, p.coordinates));
  const account = { userId: p.userId as string | null, wallet: p.wallet as string | null }, world = { active: false };
  const host = { store, getIdentity: () => account, isOverworld: () => !world.active,
    refresh: vi.fn(async () => summary), receipt: vi.fn(async (): Promise<'reverted' | 'success' | null> => null) };
  return { p, store, storage, summary, account, world, host, recovery: new RoomWalletRecovery(host), signal: new AbortController() };
}
afterEach(() => vi.useRealTimers());
describe('finite room approval recovery', () => {
  it.each([false, true])('recovers %s after reload from canonical state without a send', async artwork => {
    const f = fixture(artwork);
    Object.assign(f.summary, { mintedChainId: f.p.chainId, mintedContractAddress: f.p.contractAddress, mintedTokenId: '42',
      mintedMetadataHash: f.p.metadataHash, mintedMetadataRoomVersion: f.p.metadataRoomVersion });
    const reloaded = new RoomWalletRecovery({ ...f.host, store: new PendingRoomWalletStore(f.storage) });
    expect(await reloaded.check(f.p, f.signal.signal)).toEqual({ status: 'complete', summary: f.summary });
    expect(f.store.list()).toEqual([]); expect(f.host.receipt).not.toHaveBeenCalled();
  });
  it('keeps a missing/unmined transaction pending and does not start any idle work', async () => {
    vi.useFakeTimers(); const f = fixture();
    expect((await f.recovery.check(f.p, f.signal.signal)).status).toBe('pending');
    expect(f.store.list()).toEqual([f.p]); expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(300_000); expect(f.host.refresh).toHaveBeenCalledOnce();
  });
  it.each(['chain', 'contract', 'token', 'hash', 'version'])('does not mistake another artwork %s for completion', async field => {
    const f = fixture(true);
    Object.assign(f.summary, { mintedChainId: f.p.chainId, mintedContractAddress: f.p.contractAddress, mintedTokenId: '42',
      mintedMetadataHash: f.p.metadataHash, mintedMetadataRoomVersion: 5 });
    if (field === 'chain') f.summary.mintedChainId = 84532;
    if (field === 'contract') f.summary.mintedContractAddress = '0x' + 'a'.repeat(40);
    if (field === 'token') f.summary.mintedTokenId = '43';
    if (field === 'hash') f.summary.mintedMetadataHash = 'b'.repeat(64);
    if (field === 'version') f.summary.mintedMetadataRoomVersion = 6;
    expect((await f.recovery.check(f.p, f.signal.signal)).status).toBe('pending'); expect(f.store.list()).toHaveLength(1);
  });
  it('deduplicates focus/check events even through two coordinators', async () => {
    const f = fixture(); let release!: () => void;
    f.host.refresh.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(f.summary); }));
    const one = f.recovery.check(f.p, f.signal.signal), two = new RoomWalletRecovery(f.host).check(f.p, f.signal.signal);
    expect(f.host.refresh).toHaveBeenCalledOnce(); release(); await Promise.all([one, two]);
  });
  it.each(['account', 'wallet', 'world', 'abort'])('drops a stale %s completion and retains its hash', async kind => {
    const f = fixture(); let release!: () => void;
    f.host.refresh.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(f.summary); }));
    const work = f.recovery.check(f.p, f.signal.signal); const checked = expect(work).rejects.toThrow();
    if (kind === 'account') f.account.userId = 'someone-else';
    if (kind === 'wallet') f.account.wallet = '0x' + 'a'.repeat(40);
    if (kind === 'world') f.world.active = true;
    if (kind === 'abort') f.signal.abort();
    release(); await checked; expect(f.store.list()).toEqual([f.p]);
  });
  it('bounds an adapter that ignores cancellation, clears timers, and permits a new check', async () => {
    vi.useFakeTimers(); const f = fixture(); f.host.refresh.mockImplementationOnce(() => new Promise(() => {}));
    const work = f.recovery.check(f.p, f.signal.signal), checked = expect(work).rejects.toThrow('cancelled');
    await vi.advanceTimersByTimeAsync(25_000); await checked;
    expect(vi.getTimerCount()).toBe(0); expect(f.store.list()).toEqual([f.p]);
    expect((await f.recovery.check(f.p, f.signal.signal)).status).toBe('pending');
  });
  it('allows a new approval after a definite reverted receipt', async () => {
    const f = fixture(true); f.host.receipt.mockResolvedValueOnce('reverted');
    expect((await f.recovery.check(f.p, f.signal.signal)).status).toBe('reverted'); expect(f.store.list()).toEqual([]);
  });
  it('keeps newer canonical artwork after a successful older update was superseded', async () => {
    const f = fixture(true); Object.assign(f.summary, { mintedChainId: f.p.chainId, mintedContractAddress: f.p.contractAddress,
      mintedTokenId: '42', mintedMetadataHash: 'b'.repeat(64), mintedMetadataRoomVersion: 6 });
    f.host.receipt.mockResolvedValueOnce('success');
    expect(await f.recovery.check(f.p, f.signal.signal)).toEqual({ status: 'complete', summary: f.summary });
    expect(f.summary.mintedMetadataRoomVersion).toBe(6); expect(f.store.list()).toEqual([]);
  });
  it('cannot return a classroom/different-room response as the captured public room', async () => {
    const f = fixture(); f.summary.id = 'other';
    await expect(f.recovery.check(f.p, f.signal.signal)).rejects.toThrow('another room'); expect(f.store.list()).toHaveLength(1);
  });
  it('consumes a late rejection even if a wait is cancelled before it begins', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(waitForRoomWallet(Promise.reject(new Error('late provider error')), controller.signal)).rejects.toThrow('cancelled');
  });
});
