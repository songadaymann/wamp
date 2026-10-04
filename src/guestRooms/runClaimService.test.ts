import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuestRunClaimJournal, GUEST_RUN_CLAIM_KEY_PREFIX } from './runClaimJournal';
import { GuestRunClaimService } from './runClaimService';
import { GuestRunApiError } from './runRepository';
import type { GuestRunClaimResponse } from './runModel';

vi.mock('../auth/client', () => ({ getAuthDebugState: () => ({ authenticated: false }) }));
vi.mock('../presence/worldPresence', () => ({ resolveWorldPresenceGuestIdentity: () => ({ userId: 'guest-test' }) }));
afterEach(() => vi.restoreAllMocks());
class MemoryStorage implements Storage {
  readonly values = new Map<string, string>(); blocked = false;
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.blocked) throw new Error('blocked'); this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}
const identity = { guestUserId: 'guest-test', recoveryToken: 'a'.repeat(64) };
const id = (number = 1) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function setup() {
  const storage = new MemoryStorage(); const journal = new GuestRunClaimJournal(storage, () => 1000);
  let userId: string | null = 'account'; let pending = 1; let next = 0; let awarded = 0;
  const receipts = new Map<string, GuestRunClaimResponse>();
  const repo = {
    listPending: vi.fn(async () => ({ clears: [], totalClears: pending })),
    listClaimed: vi.fn(async () => ({ userId: userId!, clears: [], totalClears: 1 })),
    claim: vi.fn(async (claimId: string, _identity: typeof identity, expectedUserId: string) => {
      if (userId !== expectedUserId) throw new GuestRunApiError(409, 'Account changed');
      const existing = receipts.get(claimId); if (existing) return existing;
      const receipt = { userId: expectedUserId, claimId, clearsSaved: pending, pxpAwarded: pending * 20, remainingClears: 0 };
      awarded += receipt.pxpAwarded; pending = 0; receipts.set(claimId, receipt); return receipt;
    }),
  };
  const runs = { flush: vi.fn(async () => []) }; const notify = vi.fn();
  const create = (otherJournal = journal) => new GuestRunClaimService({ repository: repo, runs, journal: otherJournal,
    userId: () => userId, identity: () => identity, uuid: () => id(++next), notify });
  return { storage, journal, repo, runs, notify, create, service: create(), setUser: (value: string | null) => { userId = value; },
    awarded: () => awarded, setPending: (value: number) => { pending = value; } };
}

describe('account guest claim delivery', () => {
  it('recovers later pending IDs without repeatedly fetching already verified, unpresented receipts', async () => {
    const h = setup();
    for (let i = 1; i <= 7; i++) h.journal.create('account', identity, id(i));
    expect((await h.service.sync()).retry).toBe(true);
    expect(h.repo.claim).toHaveBeenCalledTimes(5);
    await h.service.sync(); expect(h.repo.claim).toHaveBeenCalledTimes(7);
    expect(h.repo.claim.mock.calls.map(call => call[0])).toEqual(Array.from({ length: 7 }, (_, i) => id(i + 1)));
    expect(h.awarded()).toBe(20);
  });
  it('flushes captured finishes first and persists the intended account and request before transfer', async () => {
    const h = setup(); h.repo.claim.mockImplementationOnce(async (claimId, _identity, userId) => {
      expect(h.journal.pending(userId)[0]).toMatchObject({ claimId, userId, phase: 'pending' });
      expect(h.runs.flush).toHaveBeenCalledTimes(1);
      return { claimId, userId, clearsSaved: 1, pxpAwarded: 20, remainingClears: 0 };
    });
    expect(await h.service.sync()).toEqual({ retry: false, error: null });
    expect(h.service.receipts()[0]).toMatchObject({ userId: 'account', clearsSaved: 1, pxpAwarded: 20 });
    expect(h.notify).toHaveBeenCalledTimes(1);
  });
  it('recovers the original committed receipt after a lost reply, reload and an empty pending list', async () => {
    const h = setup(); const claim = h.repo.claim.getMockImplementation()!;
    h.repo.claim.mockImplementationOnce(async (...args) => { await claim(...args); throw new TypeError('Reply lost'); });
    expect((await h.service.sync()).retry).toBe(true); expect(h.awarded()).toBe(20);
    const originalId = h.repo.claim.mock.calls[0][0];
    const reloaded = h.create(new GuestRunClaimJournal(h.storage, () => 1000));
    await reloaded.sync(); expect(h.repo.claim.mock.calls[1][0]).toBe(originalId);
    expect(reloaded.receipts()[0]).toMatchObject({ claimId: originalId, pxpAwarded: 20 });
    expect(h.awarded()).toBe(20);
  });
  it('refetches received receipts on reload instead of trusting browser XP', async () => {
    const h = setup(); await h.service.sync();
    const reloaded = h.create(new GuestRunClaimJournal(h.storage, () => 1000));
    expect(reloaded.receipts()).toEqual([]); await reloaded.sync();
    expect(reloaded.receipts()[0].pxpAwarded).toBe(20); expect(h.repo.claim).toHaveBeenCalledTimes(2);
    expect([...h.storage.values.values()][0]).not.toContain('pxpAwarded');
  });
  it('coalesces concurrent auth/focus/online wakeups in one tab', async () => {
    const h = setup(); const pending = deferred<[]>(); h.runs.flush.mockReturnValueOnce(pending.promise);
    const first = h.service.sync(); expect(h.service.sync()).toBe(first); pending.resolve([]); await first;
    expect(h.repo.claim).toHaveBeenCalledTimes(1);
  });
  it('flushes while signed out without claiming or creating a claim intent', async () => {
    const h = setup(); h.setUser(null); await h.service.sync();
    expect(h.runs.flush).toHaveBeenCalledTimes(1); expect(h.repo.claim).not.toHaveBeenCalled(); expect(h.storage.length).toBe(0);
  });
  it('stops after account change during flush, before reading or claiming progress', async () => {
    const h = setup(); h.runs.flush.mockImplementationOnce(async () => { h.setUser('other'); return []; });
    await h.service.sync(); expect(h.repo.listPending).not.toHaveBeenCalled(); expect(h.repo.claim).not.toHaveBeenCalled();
  });
  it('keeps the original identity in retry intents after browser guest identity changes', async () => {
    const h = setup(); h.repo.claim.mockRejectedValueOnce(new TypeError('Offline'));
    await h.service.sync(); const reloaded = new GuestRunClaimService({ repository: h.repo, runs: h.runs,
      journal: new GuestRunClaimJournal(h.storage, () => 1000), userId: () => 'account',
      identity: () => ({ guestUserId: 'guest-new', recoveryToken: 'b'.repeat(64) }), notify: h.notify });
    await reloaded.sync(); expect(h.repo.claim.mock.calls[1][1]).toEqual(identity);
  });
  it('does not show another account a late committed receipt, and recovers it when the original account returns', async () => {
    const h = setup(); const pending = deferred<GuestRunClaimResponse>(); h.repo.claim.mockReturnValueOnce(pending.promise);
    const check = h.service.sync(); for (let i = 0; i < 6; i++) await Promise.resolve();
    h.setUser('other'); pending.resolve({ claimId: id(), userId: 'account', clearsSaved: 1, pxpAwarded: 20, remainingClears: 0 });
    await check; expect(h.notify).not.toHaveBeenCalled(); expect(h.service.receipts()).toEqual([]);
    h.setUser('account'); expect(h.service.receipts()[0].userId).toBe('account');
  });
  it.each([401, 403, 409, 429, 500])('retains the original request after HTTP %s', async status => {
    const h = setup(); h.repo.claim.mockRejectedValueOnce(new GuestRunApiError(status, 'Retry'));
    expect((await h.service.sync()).retry).toBe(true); const intent = h.journal.pending('account')[0];
    await h.service.sync(); expect(h.repo.claim.mock.calls[1][0]).toBe(intent.claimId); expect(h.awarded()).toBe(20);
  });
  it.each(['account', 'negative', 'large', 'id'] as const)('never displays an invalid %s receipt', async defect => {
    const h = setup(); h.repo.claim.mockImplementationOnce(async claimId => ({ claimId: defect === 'id' ? id(999) : claimId,
      userId: defect === 'account' ? 'other' : 'account', clearsSaved: 1,
      pxpAwarded: defect === 'negative' ? -1 : defect === 'large' ? 1000 : 20, remainingClears: 0 }));
    expect((await h.service.sync()).retry).toBe(true); expect(h.notify).not.toHaveBeenCalled(); expect(h.service.receipts()).toEqual([]);
  });
  it('deduplicates presentation across another tab and subsequent reloads', async () => {
    const h = setup(); await h.service.sync(); const second = h.create(new GuestRunClaimJournal(h.storage, () => 1000));
    await second.sync(); const receipt = h.service.receipts()[0]; expect(h.service.markPresented(receipt)).toBe(true);
    expect(second.receipts()).toEqual([]); expect(h.service.markPresented(receipt)).toBe(false);
    await h.create(new GuestRunClaimJournal(h.storage, () => 1000)).sync(); expect(h.awarded()).toBe(20);
  });
  it('checks server history attribution before showing it after an account switch', async () => {
    const h = setup(); h.repo.listClaimed.mockResolvedValueOnce({ userId: 'other', totalClears: 1, clears: [] });
    expect(await h.service.history()).toBeNull(); h.setUser(null); expect(await h.service.history()).toBeNull();
  });
});

describe('bounded claim journal', () => {
  it('preserves other keys and discards corrupt or expired intents', () => {
    const storage = new MemoryStorage(); let now = 1000; const journal = new GuestRunClaimJournal(storage, () => now);
    storage.setItem('other-feature', 'keep'); storage.setItem(GUEST_RUN_CLAIM_KEY_PREFIX + id(2), '{broken');
    journal.create('account', identity, id()); expect(journal.list()).toHaveLength(1); now += 15 * 86400000;
    expect(journal.list()).toEqual([]); expect(storage.getItem('other-feature')).toBe('keep');
  });
  it('never evicts pending requests when full', () => {
    const journal = new GuestRunClaimJournal(null, () => 1000);
    for (let i = 1; i <= 20; i++) expect(journal.create('account', identity, id(i))).not.toBeNull();
    expect(journal.create('account', identity, id(21))).toBeNull(); expect(journal.pending('account')).toHaveLength(20);
  });
  it('retains received/presented phase when storage becomes blocked after the first write', () => {
    const storage = new MemoryStorage(); const journal = new GuestRunClaimJournal(storage, () => 1000);
    const entry = journal.create('account', identity, id())!; storage.blocked = true; journal.receive(entry);
    expect(journal.pending('account')[0].phase).toBe('received');
    expect(journal.present({ claimId: id(), userId: 'account', clearsSaved: 1, pxpAwarded: 20, remainingClears: 0 })).toBe(true);
    expect(journal.pending('account')).toEqual([]);
  });
});
