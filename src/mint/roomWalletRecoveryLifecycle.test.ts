import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRoomRecord, createRoomSummaryFromRecord } from '../persistence/roomModel';
import { PendingRoomWalletStore } from './pendingRoomWallet';
import { RoomWalletRecoveryLifecycle } from './roomWalletRecoveryLifecycle';
import { memoryStorage, pending } from './roomWalletTestFixtures';

function fixture() {
  const store = new PendingRoomWalletStore(memoryStorage()), p = pending(), state = { enabled: true, userId: p.userId, wallet: p.wallet };
  const summary = createRoomSummaryFromRecord(createDefaultRoomRecord(p.roomId, p.coordinates));
  const check = vi.fn(async () => ({ status: 'pending' as 'complete' | 'pending', summary }));
  const lifecycle = new RoomWalletRecoveryLifecycle({ store: () => store, enabled: () => state.enabled,
    identity: () => state, check });
  return { store, p, state, check, summary, lifecycle };
}
afterEach(() => vi.useRealTimers());
describe('wallet recovery return/load lifecycle', () => {
  it.each(['empty', 'no wallet', 'other account'])('creates no idle work for %s', async kind => {
    vi.useFakeTimers(); const f = fixture();
    if (kind !== 'empty') f.store.put(f.p);
    if (kind === 'no wallet') f.state.enabled = false;
    if (kind === 'other account') f.state.userId = 'someone-else';
    await f.lifecycle.notify(); expect(f.check).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('coalesces overlapping focus/auth events and ends after three attempts', async () => {
    vi.useFakeTimers(); const f = fixture(); f.store.put(f.p);
    const one = f.lifecycle.notify(), two = f.lifecycle.notify();
    expect(one).toBe(two); expect(f.check).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(4_000); await one;
    expect(f.check).toHaveBeenCalledTimes(3); expect(vi.getTimerCount()).toBe(0);
    await f.lifecycle.notify(); expect(f.check).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(300_000); expect(f.check).toHaveBeenCalledTimes(3);
  });
  it('stops retrying once canonical state completes an operation', async () => {
    vi.useFakeTimers(); const f = fixture(); f.store.put(f.p);
    f.check.mockResolvedValueOnce({ status: 'complete', summary: f.summary });
    await f.lifecycle.notify(); expect(f.check).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['hidden', 'account', 'wallet', 'dispose'])('cancels unresolved work on %s and clears its deadline', async kind => {
    vi.useFakeTimers(); const f = fixture(); f.store.put(f.p); f.check.mockImplementation(() => new Promise(() => {}));
    const work = f.lifecycle.notify();
    if (kind === 'hidden') f.state.enabled = false;
    if (kind === 'account') f.state.userId = 'other';
    if (kind === 'wallet') f.state.wallet = '0x' + 'a'.repeat(40);
    if (kind === 'dispose') f.lifecycle.cancel(); else void f.lifecycle.notify();
    await work; expect(vi.getTimerCount()).toBe(0); expect(f.check).toHaveBeenCalledOnce();
  });
  it('keeps cancellation latched after switching away and back', async () => {
    vi.useFakeTimers(); const f = fixture(); f.store.put(f.p);
    f.check.mockImplementation(() => new Promise(() => {})); const work = f.lifecycle.notify();
    f.state.userId = 'other'; await f.lifecycle.notify(); f.state.userId = f.p.userId;
    await f.lifecycle.notify(); await work; expect(f.check).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds even a hung importer or adapter and leaves no recurring timer', async () => {
    vi.useFakeTimers(); const f = fixture(); f.store.put(f.p); f.check.mockImplementation(() => new Promise(() => {}));
    const work = f.lifecycle.notify(); await vi.advanceTimersByTimeAsync(45_000); await work;
    expect(vi.getTimerCount()).toBe(0); expect(f.check).toHaveBeenCalledOnce(); expect(f.store.list()).toHaveLength(1);
  });
});
