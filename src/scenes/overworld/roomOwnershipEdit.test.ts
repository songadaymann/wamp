import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRoomRecord, createRoomSummaryFromRecord, type RoomSummary } from '../../persistence/roomModel';
import type { RoomRepository } from '../../persistence/roomRepository';
import { prepareRoomOwnershipEdit, type RoomOwnershipEditHost } from './roomOwnershipEdit';

const seller = '0x1111111111111111111111111111111111111111';
const buyer = '0x2222222222222222222222222222222222222222';
function summary(owner: string | null, canSaveDraft = true): RoomSummary {
  const s = createRoomSummaryFromRecord(createDefaultRoomRecord('0,0', { x: 0, y: 0 }));
  return { ...s, claimerUserId: 'original-builder', mintedChainId: owner ? 8453 : null,
    mintedContractAddress: owner ? seller : null, mintedTokenId: owner ? '42' : null,
    mintedOwnerWalletAddress: owner, permissions: { ...s.permissions, canSaveDraft } };
}
function harness() {
  const state = { current: true, wallet: buyer as string | null };
  const repository = { loadRoomSummary: vi.fn<RoomRepository['loadRoomSummary']>(async () => summary(seller)), refreshRoomOwnership: vi.fn<RoomRepository['refreshRoomOwnership']>(async () => summary(buyer)) };
  const acceptOwnership = vi.fn();
  const host: RoomOwnershipEditHost = { repository, subscribeInvalidation: () => () => {}, captureContext: () => () => state.current,
    getUserId: () => 'buyer', getWalletAddress: () => state.wallet, acceptOwnership };
  return { host, state, repository, acceptOwnership, run: () => prepareRoomOwnershipEdit(host, '0,0', { x: 0, y: 0 }) };
}
afterEach(() => vi.useRealTimers());

describe('current token ownership before editor entry', () => {
  it('refreshes a stale seller record and permits its new holder without moving builder credit', async () => {
    vi.useFakeTimers(); const f = harness(), canOpen = await f.run();
    expect(canOpen?.isCurrent()).toBe(true); expect(f.repository.refreshRoomOwnership).toHaveBeenCalledOnce();
    expect(f.acceptOwnership).toHaveBeenCalledWith('0,0', expect.objectContaining({ mintedOwnerWalletAddress: buyer, claimerUserId: 'original-builder' }));
    expect(vi.getTimerCount()).toBe(0); f.state.current = false; expect(canOpen?.isCurrent()).toBe(false);
  });
  it('keeps a transferred token room-scoped while preserving the original builder route', async () => {
    const f = harness(); const acquired = await f.run(); expect(acquired?.roomOnly).toBe(true); acquired?.dispose();
    f.host.getUserId = () => 'original-builder'; const original = await f.run(); expect(original?.roomOnly).toBe(false); original?.dispose();
  });
  it('rechecks a cached owner and updates their HUD before denying a sold room', async () => {
    const f = harness(); f.state.wallet = seller;
    await expect(f.run()).rejects.toThrow('Your linked wallet does not own this room.');
    expect(f.acceptOwnership).toHaveBeenCalledWith('0,0', expect.objectContaining({ mintedOwnerWalletAddress: buyer }));
  });
  it('does not infer permission from a matching wallet alone', async () => {
    const f = harness(); f.repository.refreshRoomOwnership.mockResolvedValue(summary(buyer, false));
    await expect(f.run()).rejects.toThrow('permission to edit');
  });
  it('retains unminted local/anonymous entry without a chain refresh', async () => {
    const f = harness(); f.state.wallet = null; f.repository.loadRoomSummary.mockResolvedValue(summary(null));
    expect((await f.run())?.isCurrent()).toBe(true); expect(f.repository.refreshRoomOwnership).not.toHaveBeenCalled();
  });
  it('does not request a signed-in refresh without a linked wallet', async () => {
    const f = harness(); f.state.wallet = null;
    await expect(f.run()).rejects.toThrow('Link the wallet'); expect(f.repository.refreshRoomOwnership).not.toHaveBeenCalled();
  });
  it('does not continue a changed context after its initial summary', async () => {
    const f = harness(); f.repository.loadRoomSummary.mockImplementation(async () => { f.state.current = false; return summary(seller); });
    expect(await f.run()).toBeNull(); expect(f.repository.refreshRoomOwnership).not.toHaveBeenCalled(); expect(f.acceptOwnership).not.toHaveBeenCalled();
  });
  it.each(['context', 'wallet'] as const)('discards a delayed refresh after changing %s', async kind => {
    const f = harness(); f.repository.refreshRoomOwnership.mockImplementation(async () => {
      if (kind === 'context') f.state.current = false; else f.state.wallet = seller; return summary(buyer);
    });
    expect(await f.run()).toBeNull(); expect(f.acceptOwnership).not.toHaveBeenCalled();
  });
  it('sanitizes provider failures and allows an independent retry', async () => {
    vi.useFakeTimers(); const f = harness(); f.repository.refreshRoomOwnership.mockRejectedValueOnce(new Error('https://private-provider.example/secret'));
    await expect(f.run()).rejects.toThrow('Could not check room ownership. Please try again.');
    expect(f.acceptOwnership).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    expect((await f.run())?.isCurrent()).toBe(true); expect(f.repository.refreshRoomOwnership).toHaveBeenCalledTimes(2);
  });
  it('bounds the whole operation, including a stalled initial summary, and cleans up', async () => {
    vi.useFakeTimers(); const f = harness();
    f.repository.loadRoomSummary.mockImplementation((_id, _coordinates, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const result = f.run().catch((error: unknown) => error); await vi.advanceTimersByTimeAsync(15_001);
    expect(await result).toEqual(new Error('Could not check room ownership. Please try again.'));
    expect(f.repository.refreshRoomOwnership).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('aborts and cleans up immediately when the owning context is invalidated', async () => {
    vi.useFakeTimers(); const f = harness(); let cancel!: () => void; const stop = vi.fn();
    f.host.subscribeInvalidation = callback => { cancel = callback; return stop; };
    f.repository.loadRoomSummary.mockImplementation((_id, _coordinates, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const pending = f.run(); cancel(); expect(await pending).toBeNull();
    expect(vi.getTimerCount()).toBe(0); expect(stop).toHaveBeenCalled(); expect(f.acceptOwnership).not.toHaveBeenCalled();
  });
  it('keeps a permit fenced through lazy editor loading and releases its subscription', async () => {
    const f = harness(); let cancel!: () => void; const stop = vi.fn();
    f.host.subscribeInvalidation = callback => { cancel = callback; return stop; };
    const permit = await f.run(); expect(permit?.isCurrent()).toBe(true); cancel();
    expect(permit?.isCurrent()).toBe(false); permit?.dispose(); expect(stop).toHaveBeenCalled();
  });
  it('rejects an unrelated room response instead of contaminating the selected cache', async () => {
    const f = harness(); f.repository.refreshRoomOwnership.mockResolvedValue({ ...summary(buyer), id: '1,1' });
    await expect(f.run()).rejects.toThrow('Could not check'); expect(f.acceptOwnership).not.toHaveBeenCalled();
  });
});
