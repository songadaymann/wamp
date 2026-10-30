import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRoomRecord, createRoomSummaryFromRecord, type RoomRepository, type RoomSummary, type RoomCoordinates } from '../../persistence/roomRepository';
import { EditorRoomSession } from './roomSession';
import { shouldShowPublishNudge } from './viewModel';

const auth = vi.hoisted(() => ({ authenticated: true, user: { id: 'owner' }, walletAddress: '0xowner' }));
vi.mock('../../auth/client', () => ({ getAuthDebugState: () => auth, refreshAuthSession: vi.fn() }));
vi.mock('../../ui/appFeedback', () => ({ showBusyError: vi.fn(), showBusyOverlay: vi.fn(), hideBusyOverlay: vi.fn(), updateBusyOverlay: vi.fn() }));
vi.mock('../../mint/roomMetadataRender', () => ({ renderRoomSnapshotToPngDataUrl: vi.fn() }));

const dataset = { wallet: 'yes', walletConnected: 'false' };
beforeEach(() => {
  auth.user = { id: 'owner' }; auth.walletAddress = '0xowner'; dataset.walletConnected = 'false';
  vi.stubGlobal('document', { documentElement: { dataset } });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

async function fixture() {
  const record = { ...createDefaultRoomRecord('0,1', { x: 0, y: 1 }), isProtected: true };
  record.permissions = { canSaveDraft: true, canPublish: true, canRevert: true, canMint: false };
  const summary = createRoomSummaryFromRecord(record);
  let dirty = false;
  const apply = vi.fn(), setDirty = vi.fn((value: boolean) => { dirty = value; });
  const load = vi.fn(async (_id: string, _xy: RoomCoordinates, _options?: { signal?: AbortSignal }): Promise<RoomSummary> => summary);
  const session = new EditorRoomSession({ loadRoomSummary: load,
    loadRoomCurrent: async () => ({ summary, draft: record.draft, published: null }),
  } as unknown as RoomRepository, {
    applyRoomSnapshot: apply, exportRoomSnapshot: () => record.draft,
    getPublishValidationError: () => null, getRoomDirty: () => dirty,
    setRoomDirty: setDirty, getLastDirtyAt: () => 0, refreshUi: vi.fn(), refreshSurroundingRoomPreviews: vi.fn(),
  });
  session.currentRoomId = '0,1'; session.currentRoomCoordinates = { x: 0, y: 1 };
  await session.loadPersistedRoom(null);
  apply.mockClear(); setDirty.mockClear(); dirty = true;
  return { session, summary, load, apply, setDirty, isDirty: () => dirty };
}

describe('protected editor without a crypto payload', () => {
  it('keeps rights and protection, and builds status without token/address wording', async () => {
    const f = await fixture();
    expect(f.session.currentIsProtected).toBe(true);
    expect(f.session.currentRoomPermissions.canSaveDraft).toBe(true);
    expect(f.session.currentMintedTokenId).toBeNull();
    expect(f.session.getIdleStatusDetails()).toMatchObject({ accentText: 'Protected', text: 'Your account can edit this protected room.' });
    expect(shouldShowPublishNudge(0, true, f.session.currentIsProtected, 99, 3)).toBe(false);
  });

  it('loads wallet details once on connection without replacing or clearing an unsaved draft', async () => {
    const f = await fixture(); dataset.walletConnected = 'true';
    f.load.mockResolvedValue({ ...f.summary, mintedTokenId: '42', mintedOwnerWalletAddress: '0xowner' });
    await f.session.refreshOwnershipPresentation(); await f.session.refreshOwnershipPresentation();
    expect(f.load).toHaveBeenCalledOnce(); expect(f.session.currentMintedTokenId).toBe('42');
    expect(f.session.getIdleStatusDetails().accentText).toContain('Token #42');
    expect(f.isDirty()).toBe(true); expect(f.apply).not.toHaveBeenCalled(); expect(f.setDirty).not.toHaveBeenCalled();
  });

  it('discards delayed ownership from a previous account and clears details immediately on disconnect', async () => {
    const f = await fixture(); dataset.walletConnected = 'true';
    let oldResult!: (value: RoomSummary) => void;
    f.load.mockImplementationOnce(() => new Promise(resolve => { oldResult = resolve; }));
    const old = f.session.refreshOwnershipPresentation();
    const oldSignal = f.load.mock.calls[0]?.[2]?.signal;
    auth.user = { id: 'other' }; dataset.walletConnected = 'false';
    f.load.mockResolvedValueOnce({ ...f.summary, permissions: { ...f.summary.permissions, canSaveDraft: false, canPublish: false } });
    await f.session.refreshOwnershipPresentation();
    expect(oldSignal?.aborted).toBe(true);
    oldResult({ ...f.summary, mintedTokenId: '42', mintedOwnerWalletAddress: '0xowner' }); await old;
    expect(f.session.currentMintedTokenId).toBeNull(); expect(f.session.currentIsProtected).toBe(true);
    expect(f.session.currentRoomPermissions.canSaveDraft).toBe(false);
    expect(f.isDirty()).toBe(true); expect(f.apply).not.toHaveBeenCalled(); expect(f.setDirty).not.toHaveBeenCalled();
  });

  it('cancels the outstanding read when the editor leaves the room', async () => {
    const f = await fixture(); dataset.walletConnected = 'true';
    let finish!: (value: RoomSummary) => void;
    f.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.session.refreshOwnershipPresentation();
    const signal = f.load.mock.calls[0]?.[2]?.signal;
    f.session.reset(); finish({ ...f.summary, mintedTokenId: '42' }); await pending;
    expect(signal?.aborted).toBe(true); expect(f.session.currentIsProtected).toBe(false);
    expect(f.session.currentMintedTokenId).toBeNull();
  });
});
