import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloneRoomSnapshot, createDefaultRoomRecord, createRoomSummaryFromRecord, RoomApiError, type RoomRecord, type RoomRepository } from '../../persistence/roomRepository';
import { EditorRoomSession } from './roomSession';
import { EditorPersistenceController } from './persistence';
import { sendPreparedWalletTransaction, promptForSignIn } from '../../auth/client';
import { renderRoomSnapshotToPngDataUrl } from '../../mint/roomMetadataRender';
import { updateBusyOverlay } from '../../ui/appFeedback';
import { prepareBuildPromptEntry } from '../../buildPrompts/publishing';
import { WalletTransactionRevertedError } from '../../auth/walletTransaction';

const wallet = '0x2222222222222222222222222222222222222222';
const state = vi.hoisted(() => ({ authenticated: true, userId: 'buyer', wallet: '0x2222222222222222222222222222222222222222', busyTitle: null as string | null }));
vi.mock('../../auth/client', () => ({ AUTH_STATE_CHANGED_EVENT: 'auth-state-changed', getAuthDebugState: () => ({ authenticated: state.authenticated, user: { id: state.userId, walletAddress: state.wallet } }), refreshAuthSession: vi.fn(async () => {}), sendPreparedWalletTransaction: vi.fn(), promptForSignIn: vi.fn() }));
vi.mock('../../mint/roomMetadataRender', () => ({ renderRoomSnapshotToPngDataUrl: vi.fn(async () => 'data:image/png;base64,aGVsbG8=') }));
vi.mock('../../ui/appFeedback', () => ({
  showBusyOverlay: vi.fn((title: string) => { state.busyTitle = title; }), updateBusyOverlay: vi.fn((title: string) => { state.busyTitle = title; }),
  hideBusyOverlay: vi.fn(() => { state.busyTitle = null; }), showBusyError: vi.fn(), getAppFeedbackDebugState: () => ({ busyTitle: state.busyTitle }),
}));
vi.mock('../../buildPrompts/publishing', () => ({ prepareBuildPromptEntry: vi.fn(), completeBuildPromptEntry: vi.fn() }));
vi.mock('../../publishing/events', () => ({ requestRoomPublishName: vi.fn(), suggestRoomTitle: vi.fn() }));
vi.mock('../../publishing/feedback', () => ({ capturePublishProgression: vi.fn(), reportPublishProgression: vi.fn() }));
vi.mock('../../analytics/replay/editorEvents', () => ({ recordReplayEditorAction: vi.fn() }));

const chain = { chainId: 8453, name: 'Base', rpcUrl: 'https://mainnet.base.org', blockExplorerUrl: 'https://basescan.org', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } };
beforeEach(() => {
  vi.clearAllMocks(); state.authenticated = true; state.userId = 'buyer'; state.wallet = wallet; state.busyTitle = null;
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { origin: 'https://wamp.land' } }));
  vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.mocked(renderRoomSnapshotToPngDataUrl).mockResolvedValue('data:image/png;base64,aGVsbG8=');
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function fixture() {
  let record: RoomRecord = createDefaultRoomRecord('0,1', { x: 0, y: 1 });
  record.draft.version = 5; record.published = { ...cloneRoomSnapshot(record.draft), status: 'published', publishedAt: record.draft.updatedAt };
  record.claimerUserId = 'buyer'; record.permissions = { canSaveDraft: true, canPublish: true, canRevert: false, canMint: true };
  const calls: string[] = []; let counter = 0;
  const send: typeof sendPreparedWalletTransaction = async (transaction, _chain, options) => {
    expect(options?.expectedWalletAddress).toBe(wallet); expect(options?.isCurrent?.()).toBe(true);
    calls.push(transaction.data === '0x01' ? 'mint-wallet' : 'artwork-wallet');
    const tx = { hash: '0x' + (++counter).toString().padStart(64, '0'), from: wallet }; options?.onSubmitted?.(tx); return tx;
  };
  vi.mocked(sendPreparedWalletTransaction).mockImplementation(send);
  const repository = {
    loadRoomCurrent: vi.fn(async () => ({ summary: createRoomSummaryFromRecord(record), draft: record.draft, published: record.published })),
    getLastPersistenceTarget: () => 'remote',
    prepareMint: vi.fn(async () => { calls.push('mint-prepare'); return { chain, transaction: { to: wallet, data: '0x01', value: '1000', chainId: 8453 } }; }),
    confirmMint: vi.fn(async () => { calls.push('mint-confirm'); record = { ...record, mintedChainId: 8453, mintedContractAddress: wallet, mintedTokenId: '42', mintedOwnerWalletAddress: wallet, permissions: { ...record.permissions, canMint: false } }; return record; }),
    prepareMetadataRefresh: vi.fn(async () => { calls.push('artwork-prepare'); return { chain, transaction: { to: wallet, data: '0x02', value: '0', chainId: 8453 } }; }),
    confirmMetadataRefresh: vi.fn(async (_id: string, _coords: unknown, body: { metadataRoomVersion: number; metadataHash: string }) => {
      calls.push('artwork-confirm'); record = { ...record, mintedMetadataRoomVersion: body.metadataRoomVersion, mintedMetadataHash: body.metadataHash, mintedMetadataUpdatedAt: record.draft.updatedAt }; return record;
    }),
  };
  const session = new EditorRoomSession(repository as unknown as RoomRepository, {
    applyRoomSnapshot: vi.fn(), exportRoomSnapshot: () => record.draft, getPublishValidationError: () => null,
    getRoomDirty: () => false, setRoomDirty: vi.fn(), getLastDirtyAt: () => 0, refreshUi: vi.fn(), refreshSurroundingRoomPreviews: vi.fn(),
  });
  session.currentRoomId = '0,1'; session.currentRoomCoordinates = { x: 0, y: 1 }; await session.loadPersistedRoom(null);
  const events = new EventEmitter();
  const controller = new EditorPersistenceController(session, {
    isActive: () => true, events, getRoomPermissions: () => record.permissions, getRoomTitle: () => record.draft.title,
    setRoomTitle: vi.fn(), getRoomDirty: () => false, setRoomDirty: vi.fn(), getLastDirtyAt: () => 0,
    setLastDirtyAt: vi.fn(), getInitialRoomSnapshot: () => record.draft, syncActiveCourseRoomSessionSnapshot: vi.fn(), onRoomMarkedDirty: vi.fn(),
  });
  return { session, controller, repository, events, calls, send, record: () => record };
}

describe('real room session collection and artwork sequence', () => {
  it('confirms the mint before a strict artwork render and second wallet approval', async () => {
    const f = await fixture(), result = await f.controller.mintRoom();
    expect(result).toMatchObject({ mintedTokenId: '42', mintedMetadataRoomVersion: 5 });
    expect(f.calls).toEqual(['mint-prepare', 'mint-wallet', 'mint-confirm', 'artwork-prepare', 'artwork-wallet', 'artwork-confirm']);
    expect(renderRoomSnapshotToPngDataUrl).toHaveBeenCalledWith(expect.objectContaining({ version: 5 }), { tilePixelSize: 2, strictAssets: true });
    expect(f.session.getHistoryState().mintedMetadataCurrent).toBe(true); expect(f.controller.isCollecting).toBe(false); expect(f.session.isSaveInFlight).toBe(false); expect(f.events.eventNames()).toEqual([]);
  });
  it('does not start artwork if the first wallet approval is rejected', async () => {
    const f = await fixture(); vi.mocked(sendPreparedWalletTransaction).mockRejectedValueOnce(new Error('User rejected'));
    expect(await f.controller.mintRoom()).toBeNull(); expect(f.repository.confirmMint).not.toHaveBeenCalled(); expect(renderRoomSnapshotToPngDataUrl).not.toHaveBeenCalled();
  });
  it('keeps a confirmed mint after an artwork rejection and retries only artwork', async () => {
    const f = await fixture(); vi.mocked(sendPreparedWalletTransaction).mockImplementationOnce(f.send).mockRejectedValueOnce(new Error('User rejected artwork'));
    expect(await f.controller.mintRoom()).toMatchObject({ mintedTokenId: '42', mintedMetadataRoomVersion: null });
    expect(f.session.statusDetails.text).toContain('already collected'); expect(f.record().mintedTokenId).toBe('42');
    expect(await f.controller.refreshMintMetadata()).toMatchObject({ mintedMetadataRoomVersion: 5 });
    expect(f.repository.prepareMint).toHaveBeenCalledOnce(); expect(f.repository.confirmMint).toHaveBeenCalledOnce(); expect(f.repository.prepareMetadataRefresh).toHaveBeenCalledTimes(2);
  });
  it('does not ask for the artwork wallet approval if faithful rendering fails', async () => {
    const f = await fixture(); vi.mocked(renderRoomSnapshotToPngDataUrl).mockRejectedValueOnce(new Error('Missing custom asset'));
    expect(await f.controller.mintRoom()).toMatchObject({ mintedTokenId: '42' }); expect(sendPreparedWalletTransaction).toHaveBeenCalledOnce(); expect(f.repository.prepareMetadataRefresh).not.toHaveBeenCalled();
    expect(f.session.statusDetails.text).toContain('already collected');
  });
  it('checks a known artwork transaction instead of requesting another approval after a confirm failure', async () => {
    const f = await fixture(); f.repository.confirmMetadataRefresh.mockRejectedValueOnce(new Error('Connection lost'));
    expect(await f.controller.mintRoom()).toMatchObject({ mintedTokenId: '42', mintedMetadataRoomVersion: null });
    expect(f.session.hasPendingArtworkConfirmation).toBe(true); expect(f.session.statusDetails.text).toContain('without another wallet approval');
    expect(await f.controller.refreshMintMetadata()).toMatchObject({ mintedMetadataRoomVersion: 5 });
    expect(sendPreparedWalletTransaction).toHaveBeenCalledTimes(2); expect(renderRoomSnapshotToPngDataUrl).toHaveBeenCalledOnce(); expect(f.repository.prepareMetadataRefresh).toHaveBeenCalledOnce();
    expect(f.repository.confirmMetadataRefresh).toHaveBeenCalledTimes(2); expect(f.session.hasPendingArtworkConfirmation).toBe(false);
  });
  it('retains the submitted artwork hash when wallet receipt waiting fails', async () => {
    const f = await fixture(); vi.mocked(sendPreparedWalletTransaction).mockImplementationOnce(f.send).mockImplementationOnce(async (_tx, _chain, options) => {
      options?.onSubmitted?.({ hash: '0x' + 'a'.repeat(64), from: wallet }); throw new Error('Receipt timeout');
    });
    await f.controller.mintRoom(); expect(f.repository.confirmMetadataRefresh).not.toHaveBeenCalled();
    await f.controller.refreshMintMetadata(); expect(sendPreparedWalletTransaction).toHaveBeenCalledTimes(2);
    expect(f.repository.confirmMetadataRefresh).toHaveBeenCalledWith('0,1', { x: 0, y: 1 }, expect.objectContaining({ txHash: '0x' + 'a'.repeat(64) }));
  });
  it.each([false, true])('allows an artwork-only replacement after a verified revert (scene slept: %s)', async slept => {
    const f = await fixture(); vi.mocked(sendPreparedWalletTransaction).mockImplementationOnce(f.send).mockImplementationOnce(async (_tx, _chain, options) => {
      const txHash = '0x' + 'c'.repeat(64); options?.onSubmitted?.({ hash: txHash, from: wallet }); if (slept) f.events.emit('sleep'); throw new WalletTransactionRevertedError(txHash);
    });
    expect(await f.controller.mintRoom()).toMatchObject({ mintedTokenId: '42' }); expect(f.session.hasPendingArtworkConfirmation).toBe(false);
    expect(f.repository.confirmMetadataRefresh).not.toHaveBeenCalled();
    expect(await f.controller.refreshMintMetadata()).toMatchObject({ mintedMetadataRoomVersion: 5 });
    expect(f.repository.prepareMint).toHaveBeenCalledOnce(); expect(f.repository.prepareMetadataRefresh).toHaveBeenCalledTimes(2);
    expect(sendPreparedWalletTransaction).toHaveBeenCalledTimes(3);
  });
  it('does not send the second approval after leaving and returning to the same scene', async () => {
    const f = await fixture(); const confirm = f.repository.confirmMint.getMockImplementation()!;
    f.repository.confirmMint.mockImplementationOnce(async () => { const result = await confirm(); f.events.emit('sleep'); f.events.emit('wake'); return result; });
    await f.controller.mintRoom(); expect(sendPreparedWalletTransaction).toHaveBeenCalledOnce(); expect(f.repository.prepareMetadataRefresh).not.toHaveBeenCalled(); expect(f.events.eventNames()).toEqual([]);
  });
  it('does not use an old pending artwork approval for another linked identity', async () => {
    const f = await fixture(); f.repository.confirmMetadataRefresh.mockRejectedValueOnce(new Error('Connection lost')); await f.controller.mintRoom();
    state.userId = 'other'; state.wallet = '0x3333333333333333333333333333333333333333';
    expect(await f.controller.refreshMintMetadata()).toBeNull(); expect(sendPreparedWalletTransaction).toHaveBeenCalledTimes(2); expect(f.repository.confirmMetadataRefresh).toHaveBeenCalledOnce();
    expect(f.session.statusText).toContain('wallet or room changed');
  });

  it('retains a hash returned after scene sleep and checks it on manual re-entry without another send', async () => {
    const f = await fixture(); vi.mocked(sendPreparedWalletTransaction).mockImplementationOnce(f.send).mockImplementationOnce(async (_tx, _chain, options) => {
      f.events.emit('sleep'); options?.onSubmitted?.({ hash: '0x' + 'b'.repeat(64), from: wallet });
      throw new Error('Receipt interrupted');
    });
    await f.controller.mintRoom(); expect(f.session.hasPendingArtworkConfirmation).toBe(true);
    expect(f.repository.confirmMetadataRefresh).not.toHaveBeenCalled();
    await f.controller.refreshMintMetadata(); expect(sendPreparedWalletTransaction).toHaveBeenCalledTimes(2);
    expect(f.repository.confirmMetadataRefresh).toHaveBeenCalledWith('0,1', { x: 0, y: 1 }, expect.objectContaining({ txHash: '0x' + 'b'.repeat(64) }));
  });

  it.each(['sleep', 'account', 'wallet'] as const)('cancels a manual artwork retry during rendering after %s changes', async kind => {
    const f = await fixture(); await f.controller.mintRoom();
    const sends = vi.mocked(sendPreparedWalletTransaction).mock.calls.length;
    vi.mocked(renderRoomSnapshotToPngDataUrl).mockImplementationOnce(async () => {
      if (kind === 'sleep') f.events.emit('sleep');
      if (kind === 'account') state.userId = 'other';
      if (kind === 'wallet') state.wallet = '0x3333333333333333333333333333333333333333';
      return 'data:image/png;base64,aGVsbG8=';
    });
    expect(await f.controller.refreshMintMetadata()).toBeNull();
    expect(sendPreparedWalletTransaction).toHaveBeenCalledTimes(sends);
    expect(f.repository.prepareMetadataRefresh).toHaveBeenCalledOnce(); expect(f.events.eventNames()).toEqual([]);
  });

  it('holds the collection lock through artwork preparation and blocks duplicate clicks and unrelated saves', async () => {
    const f = await fixture(); let release!: (value: string) => void;
    vi.mocked(renderRoomSnapshotToPngDataUrl).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const work = f.controller.mintRoom(); await vi.waitFor(() => expect(renderRoomSnapshotToPngDataUrl).toHaveBeenCalledOnce());
    const autosave = vi.spyOn(f.session, 'maybeAutoSave');
    expect(f.controller.isCollecting).toBe(true); f.controller.maybeAutoSave(false); expect(autosave).not.toHaveBeenCalled();
    expect(await f.controller.mintRoom()).toBeNull(); expect(await f.controller.refreshMintMetadata()).toBeNull();
    expect(await f.controller.saveDraft()).toBeNull(); expect(await f.controller.publishRoom()).toBeNull();
    release('data:image/png;base64,aGVsbG8='); await work;
    expect(f.repository.prepareMint).toHaveBeenCalledOnce(); expect(f.repository.prepareMetadataRefresh).toHaveBeenCalledOnce();
  });

  it('does not overwrite a changed scene with a late mint preparation response', async () => {
    const f = await fixture(), prepare = f.repository.prepareMint.getMockImplementation()!;
    f.repository.prepareMint.mockImplementationOnce(async () => { const result = await prepare(); f.events.emit('sleep'); state.busyTitle = 'Other operation'; return result; });
    expect(await f.controller.mintRoom()).toBeNull(); expect(sendPreparedWalletTransaction).not.toHaveBeenCalled();
    expect(updateBusyOverlay).not.toHaveBeenCalled(); expect(state.busyTitle).toBe('Other operation');
  });

  it('keeps server-denied mint permissions, including protected and classroom rooms', async () => {
    const f = await fixture(); f.record().permissions.canMint = false; await f.session.loadPersistedRoom(null);
    expect(await f.controller.mintRoom()).toBeNull(); expect(f.repository.prepareMint).not.toHaveBeenCalled();
    expect(sendPreparedWalletTransaction).not.toHaveBeenCalled();
  });
  it('does not collect a second token for an already minted room', async () => {
    const f = await fixture(); await f.controller.mintRoom();
    expect(await f.controller.mintRoom()).toBeNull(); expect(f.repository.prepareMint).toHaveBeenCalledOnce();
    expect(sendPreparedWalletTransaction).toHaveBeenCalledTimes(2);
  });
  it('does not request artwork on an unminted room', async () => {
    const f = await fixture(); expect(await f.controller.refreshMintMetadata()).toBeNull();
    expect(f.repository.prepareMetadataRefresh).not.toHaveBeenCalled(); expect(sendPreparedWalletTransaction).not.toHaveBeenCalled();
  });
  it('does not request manual artwork after editing rights are removed', async () => {
    const f = await fixture(); await f.controller.mintRoom(); f.record().permissions.canSaveDraft = false; await f.session.loadPersistedRoom(null);
    expect(await f.controller.refreshMintMetadata()).toBeNull(); expect(f.repository.prepareMetadataRefresh).toHaveBeenCalledOnce();
    expect(sendPreparedWalletTransaction).toHaveBeenCalledTimes(2);
  });
  it('requests sign-in instead of preparing a transaction for a guest', async () => {
    const f = await fixture(); state.authenticated = false;
    expect(await f.controller.mintRoom()).toBeNull(); expect(promptForSignIn).toHaveBeenCalledOnce();
    expect(f.repository.prepareMint).not.toHaveBeenCalled();
  });
  it('does not prepare a collection without a linked wallet', async () => {
    const f = await fixture(); state.wallet = '';
    expect(await f.controller.mintRoom()).toBeNull(); expect(f.repository.prepareMint).not.toHaveBeenCalled();
    expect(f.session.statusText).toContain('Link a wallet');
  });
  it('confirms the version and metadata actually rendered even if the backing published snapshot changes', async () => {
    const f = await fixture(); vi.mocked(renderRoomSnapshotToPngDataUrl).mockImplementationOnce(async snapshot => {
      expect(snapshot.version).toBe(5); f.record().published!.version = 6; return 'data:image/png;base64,aGVsbG8=';
    });
    await f.controller.mintRoom(); expect(f.repository.confirmMetadataRefresh).toHaveBeenCalledWith('0,1', { x: 0, y: 1 }, expect.objectContaining({ metadataRoomVersion: 5 }));
  });
  it('recognizes an already-confirmed matching hash/version after a 409 without another approval', async () => {
    const f = await fixture(), confirm = f.repository.confirmMetadataRefresh.getMockImplementation()!;
    f.repository.confirmMetadataRefresh.mockImplementationOnce(async (...args) => { await confirm(...args); throw new RoomApiError('Already recorded', 409); });
    expect(await f.controller.mintRoom()).toMatchObject({ mintedMetadataRoomVersion: 5 });
    expect(f.session.hasPendingArtworkConfirmation).toBe(false); expect(sendPreparedWalletTransaction).toHaveBeenCalledTimes(2);
  });
  it('blocks collection and manual artwork while a publish prompt owns the room operation', async () => {
    const f = await fixture(); f.record().draft.title = 'Named room'; let release!: () => void;
    vi.mocked(prepareBuildPromptEntry).mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(null); }));
    const publishing = f.controller.publishRoom(); await vi.waitFor(() => expect(prepareBuildPromptEntry).toHaveBeenCalledOnce());
    expect(await f.controller.mintRoom()).toBeNull(); expect(await f.controller.refreshMintMetadata()).toBeNull();
    expect(sendPreparedWalletTransaction).not.toHaveBeenCalled(); expect(f.repository.prepareMint).not.toHaveBeenCalled();
    release(); expect(await publishing).toBeNull();
  });
  it('cancels artwork after the account changes away and back during preparation', async () => {
    const f = await fixture(), prepare = f.repository.prepareMetadataRefresh.getMockImplementation()!;
    f.repository.prepareMetadataRefresh.mockImplementationOnce(async () => {
      const value = await prepare(); state.userId = 'other'; window.dispatchEvent(new Event('auth-state-changed'));
      state.userId = 'buyer'; window.dispatchEvent(new Event('auth-state-changed')); return value;
    });
    await f.controller.mintRoom(); expect(sendPreparedWalletTransaction).toHaveBeenCalledOnce(); expect(f.repository.confirmMetadataRefresh).not.toHaveBeenCalled();
    expect(f.controller.isCollecting).toBe(false); expect(f.events.eventNames()).toEqual([]);
  });
});
