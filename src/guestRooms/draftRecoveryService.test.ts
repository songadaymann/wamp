import { describe, expect, it, vi } from 'vitest';
vi.mock('../auth/client', () => ({ getAuthDebugState: () => ({ authenticated: false }) }));
vi.mock('./client', () => ({ claimGuestRoomDraft: vi.fn(), listMyGuestRoomDrafts: vi.fn(),
  GuestRoomDraftApiError: class extends Error { constructor(readonly status: number, message: string) { super(message); } } }));
import { GuestRoomDraftApiError } from './client';
import { createDefaultRoomRecord } from '../persistence/roomRepository';
import type { GuestRoomDraftClaimResponse, GuestRoomDraftSummary } from './model';
import { GuestDraftRecoveryService } from './draftRecoveryService';

const identity = { guestUserId: 'guest-builder', recoveryToken: 'secret-for-browser-only' };
const room = createDefaultRoomRecord('1,0', { x: 1, y: 0 }); room.draft.title = 'Saved guest room'; room.claimerUserId = 'account';
const draft: GuestRoomDraftSummary = { id: 'draft-id', guestUserId: identity.guestUserId, guestDisplayName: 'Guest',
  roomId: '1,0', roomX: 1, roomY: 0, title: room.draft.title, status: 'active', createdAt: room.draft.createdAt,
  updatedAt: room.draft.updatedAt, submittedAt: null, moderationStatus: 'private', snapshot: room.draft };
const receipt: GuestRoomDraftClaimResponse = { outcome: 'claimed', userId: 'account', draftId: draft.id, roomId: '1,0', claimedAt: room.draft.updatedAt, room };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }
function fixture() {
  let account: string | null = 'account'; let captured = identity;
  const list = vi.fn(async () => ({ drafts: [{ ...draft }] })); const claim = vi.fn(async () => receipt);
  const service = new GuestDraftRecoveryService({ account: () => account, identity: () => captured, list, claim });
  return { service, list, claim, account: (id: string | null) => { account = id; }, identity: () => { captured = { guestUserId: 'guest-new', recoveryToken: 'new-secret' }; } };
}
describe('account-safe guest draft recovery', () => {
  it('discovers drafts after any sign-in and recovers the same server receipt after reload or lost acknowledgement', async () => {
    const f = fixture(); expect(await f.service.sync()).toMatchObject({ userId: 'account', items: [{ transfer: receipt }] });
    expect(f.claim).toHaveBeenCalledWith(draft.id, { expectedUserId: 'account' }, identity);
    f.list.mockResolvedValue({ drafts: [{ ...draft, status: 'claimed', claimedByUserId: 'account' }] });
    expect(await f.service.sync()).toMatchObject({ items: [{ transfer: receipt }] });
  });
  it('does not transfer anonymous, submitted, hidden or another account drafts', async () => {
    const f = fixture(); f.account(null); await f.service.sync(); expect(f.claim).not.toHaveBeenCalled();
    f.account('account'); f.list.mockResolvedValue({ drafts: [{ ...draft, status: 'submitted' }, { ...draft, status: 'hidden' },
      { ...draft, status: 'claimed', claimedByUserId: 'other' }, { ...draft, guestUserId: 'guest-other' }] });
    expect(await f.service.sync()).toMatchObject({ items: [] }); expect(f.claim).not.toHaveBeenCalled();
  });
  it('stops after account switch while listing or claiming, and keeps the original guest identity for the request', async () => {
    const f = fixture(); const pending = deferred<{ drafts: GuestRoomDraftSummary[] }>(); f.list.mockReturnValue(pending.promise);
    const sync = f.service.sync(); f.account('other'); pending.resolve({ drafts: [draft] });
    expect(await sync).toBeNull(); expect(f.claim).not.toHaveBeenCalled();
    f.account('account'); f.list.mockResolvedValue({ drafts: [draft] }); const reply = deferred<GuestRoomDraftClaimResponse>(); f.claim.mockReturnValue(reply.promise);
    const second = f.service.sync(); await Promise.resolve(); f.identity(); f.account('other'); reply.resolve(receipt);
    expect(await second).toBeNull(); expect(f.claim).toHaveBeenCalledWith(draft.id, { expectedUserId: 'account' }, identity);
  });
  it('retains interrupted drafts for retry and never presents a forged or wrong-account receipt', async () => {
    const f = fixture(); f.claim.mockRejectedValueOnce(new Error('Offline'));
    expect(await f.service.sync()).toMatchObject({ items: [{ draft, transfer: null, error: 'Offline' }] });
    f.claim.mockResolvedValue({ ...receipt, userId: 'other' });
    expect(await f.service.sync()).toMatchObject({ items: [{ transfer: null, error: expect.stringContaining('could not be confirmed') }] });
  });
  it('requires a deliberate new location and rejects a late reply after an account change', async () => {
    const f = fixture(); const coordinates = { x: -1, y: 0 };
    await f.service.transfer(draft.id, 'account', coordinates); expect(f.claim).toHaveBeenCalledWith(draft.id, { expectedUserId: 'account', coordinates }, identity);
    f.account('other'); expect(await f.service.transfer(draft.id, 'account', coordinates)).toBeNull();
    expect(f.claim).toHaveBeenCalledTimes(1);
    f.account('account'); const reply = deferred<GuestRoomDraftClaimResponse>(); f.claim.mockReturnValue(reply.promise);
    const promise = f.service.transfer(draft.id, 'account'); f.account('other'); reply.resolve(receipt); expect(await promise).toBeNull();
  });
  it('holds daily quota and permanent failures for deliberate retry instead of polling all day', async () => {
    const f = fixture(); f.claim.mockRejectedValue(new GuestRoomDraftApiError(429, 'Daily limit reached'));
    expect(await f.service.sync()).toMatchObject({ items: [{ error: 'Daily limit reached', retry: false }] });
    f.claim.mockRejectedValue(new GuestRoomDraftApiError(503, 'Unavailable'));
    expect(await f.service.sync()).toMatchObject({ items: [{ retry: true }] });
  });
});
