import { AUTH_STATE_CHANGED_EVENT, getAuthDebugState, promptForSignIn, refreshAuthSession, sendPreparedWalletTransaction } from '../../auth/client';
import { WalletRequestNotSubmittedError, WalletTransactionRevertedError } from '../../auth/walletTransaction';
import { cloneRoomSnapshot, createRoomRecordFromCurrent, isRoomApiError, type RoomCoordinates, type RoomPermissions, type RoomRecord, type RoomRepository, type RoomSnapshot, type RoomSummary } from '../../persistence/roomRepository';
import { type RoomMintChainInfo, type PreparedWalletTransaction } from '../../mint/roomOwnership';
import { buildRoomTokenViewerUrl } from '../../mint/roomTokenLinks';
import { buildRoomTokenArtwork } from '../../mint/roomTokenArtwork';
import { roomWalletErrorMessage } from '../../mint/roomWalletError';
import { hasCryptoWallet } from '../../mint/walletGate';
import { requestRoomWalletConsent } from '../../ui/roomWalletConsent';
import { getPendingRoomWalletStore, type PendingRoomWallet } from '../../mint/pendingRoomWallet';
import { RoomWalletRecovery, waitForRoomWallet, type RoomWalletRecoveryResult } from '../../mint/roomWalletRecovery';
import { checkRoomWalletReceipt } from '../../mint/roomWalletReceipt';
import { getActiveWorldId, WORLD_CONTEXT_CHANGED_EVENT } from '../../worlds/clientContext';
import { hideBusyOverlay, showBusyOverlay, showBusyError, updateBusyOverlay, getAppFeedbackDebugState } from '../../ui/appFeedback';
import type { EditorStatusDetails } from './roomSession';
import type { RoomCollectionStageOptions, RoomCollectionFlowHost } from './roomCollectionFlow';

interface RoomWalletActionsHost {
  isActive(): boolean;
  events?: RoomCollectionFlowHost['events'];
  readonly roomId: string;
  readonly roomCoordinates: RoomCoordinates;
  readonly publishedVersion: number;
  readonly publishedRoomSnapshot: RoomSnapshot | null;
  readonly roomPermissions: RoomPermissions;
  readonly mintedTokenId: string | null;
  readonly mintedChainId: number | null;
  readonly mintedContractAddress: string | null;
  readonly sessionGeneration: number;
  applyRecovery(summary: RoomSummary): void;
  saveInFlight: boolean;
  getRoomDirty(): boolean;
  refreshUi(): void;
  canRefreshMintMetadata(): boolean;
  publishRoom(status: string): Promise<RoomRecord | null>;
  syncRoomMetadata(record: RoomRecord): void;
  setStatusText(text: string): void;
  setStatusDetails(status: EditorStatusDetails): void;
}

interface WalletRun {
  controller: AbortController;
  current(): boolean;
  wait<T>(promise: Promise<T>): Promise<T>;
  title: string;
  pending: PendingRoomWallet | null;
  durable: boolean;
  chainName?: string;
  cancel(): void;
}

function identity() {
  const auth = getAuthDebugState();
  return { userId: auth.authenticated ? auth.user?.id ?? null : null,
    wallet: auth.authenticated ? auth.user?.walletAddress?.toLowerCase() ?? null : null,
    signer: auth.walletAddress?.toLowerCase() ?? null };
}
function definitelyRejected(error: unknown): boolean {
  const visited = new Set<unknown>();
  for (let e = error; e && typeof e === 'object' && !visited.has(e); e = (e as { cause?: unknown }).cause) {
    visited.add(e);
    if ((e as { code?: unknown }).code === 4001) return true;
  }
  return false;
}

export class RoomWalletActions {
  private active: WalletRun | null = null;
  private readonly checks = new Set<AbortController>();
  constructor(private readonly roomRepository: RoomRepository, private readonly host: RoomWalletActionsHost) {}

  private getPending(kind?: PendingRoomWallet['kind']): PendingRoomWallet | undefined {
    const account = identity();
    return getPendingRoomWalletStore().list().find(p => p.roomId === this.host.roomId
      && (!kind || p.kind === kind && p.userId === account.userId && p.wallet === account.wallet));
  }
  get hasPendingArtworkConfirmation(): boolean { return !!this.getPending('artwork')?.txHash; }
  get hasPendingWalletConfirmation(): boolean { return !!this.getPending(); }
  reset(): void { this.active?.controller.abort(); for (const check of this.checks) check.abort(); }
  ownsPending(id: string): boolean { return this.active?.pending?.id === id; }

  acceptRecovery(pending: PendingRoomWallet, result: RoomWalletRecoveryResult): void {
    const run = this.active;
    if (!run || run.pending?.id !== pending.id || result.status === 'pending') return;
    run.cancel(); // A recovered action finishes this wait; a background provider cannot start stage two.
    this.host.setStatusText(result.status === 'reverted' ? 'The wallet transaction reverted. You can try again.'
      : !result.summary.permissions.canSaveDraft ? 'Room ownership checked. This room is protected.'
      : pending.kind === 'mint' && result.summary.mintedMetadataRoomVersion !== result.summary.publishedVersion
        ? 'Your room is collected. Choose Add/update artwork to add its artwork.' : 'Your room approval is confirmed.');
  }

  async recoverPending(): Promise<void> {
    const pending = this.getPending();
    if (pending && !this.active && !getActiveWorldId()
      && globalThis.document?.documentElement?.dataset.wallet === 'yes') await this.checkPending(pending);
  }

  mintRoom(options: RoomCollectionStageOptions = {}): Promise<RoomRecord | null> {
    return this.run('mint', options, async run => {
      const pending = this.getPending();
      if (pending) return this.resume(run, pending);
      if (this.host.mintedTokenId) {
        this.host.setStatusText(`Room token #${this.host.mintedTokenId} is already collected and locked.`); return null;
      }
      if (this.host.getRoomDirty() || this.host.publishedVersion === 0) {
        const published = await run.wait(this.host.publishRoom('Published latest changes before Collect & Lock.'));
        if (!published || !run.current()) return null;
      }
      this.host.saveInFlight = true;
      await run.wait(refreshAuthSession());
      if (!run.current() || !this.requireWallet('mint')) return null;
      if (!this.host.roomPermissions.canMint) {
        this.host.setStatusText('Only the current claimer with a linked wallet can Collect & Lock this room.'); return null;
      }
      this.beginWait(run);
      const prepare = await run.wait(this.roomRepository.prepareMint(this.host.roomId, this.host.roomCoordinates));
      if (!run.current()) return null;
      if (prepare.roomId !== this.host.roomId || prepare.roomCoordinates.x !== this.host.roomCoordinates.x
        || prepare.roomCoordinates.y !== this.host.roomCoordinates.y || prepare.linkedWalletAddress.toLowerCase() !== identity().wallet
        || prepare.transaction.to.toLowerCase() !== prepare.contractAddress.toLowerCase()) throw new Error('The room cost or network changed.');
      const transaction = { ...prepare.transaction }, chain = { ...prepare.chain, nativeCurrency: { ...prepare.chain.nativeCurrency } };
      run.chainName = chain.name;
      const accepted = await run.wait(requestRoomWalletConsent({ title: run.title, kind: 'mint', transaction, chain,
        priceWei: prepare.priceWei, wallet: identity().wallet!, signal: run.controller.signal, isCurrent: run.current }));
      if (!run.current()) return null;
      if (!accepted) { options.onDeclined?.(); this.host.setStatusText(hasCryptoWallet() ? 'Collection cancelled. No wallet approval was requested.' : 'Room action cancelled.'); return null; }
      const pendingMint = this.intent('mint', chain, transaction);
      run.pending = pendingMint;
      this.beginWait(run);
      updateBusyOverlay(run.title, `Approve the ${prepare.chain.name} transaction in your wallet.`);
      this.host.setStatusText(`Waiting for wallet confirmation on ${prepare.chain.name}...`);
      const tx = await run.wait(this.send(run, transaction, chain));
      if (!run.current()) return null;
      updateBusyOverlay(run.title, 'Checking your collected room...');
      const record = await run.wait(this.roomRepository.confirmMint(pendingMint.roomId, pendingMint.coordinates, { txHash: tx.hash }));
      if (!run.current()) return null;
      this.acceptRecord(run, record);
      const viewer = buildRoomTokenViewerUrl(record);
      this.host.setStatusDetails({ text: '', accentText: `Collected & Locked · Token #${record.mintedTokenId}`,
        linkLabel: viewer ? 'View collectible' : '', linkHref: viewer });
      return record;
    });
  }

  refreshMintMetadata(options: RoomCollectionStageOptions = {}): Promise<RoomRecord | null> {
    return this.run('artwork', options, async run => {
      const pending = this.getPending();
      if (pending) return this.resume(run, pending);
      if (!this.host.mintedTokenId || !this.host.mintedContractAddress || this.host.mintedChainId === null) {
        this.host.setStatusText('Collect & Lock this room before adding artwork.'); return null;
      }
      if (!this.host.publishedRoomSnapshot) { this.host.setStatusText('Publish the room before refreshing NFT metadata.'); return null; }
      if (!this.host.canRefreshMintMetadata()) { this.host.setStatusText('Only the room token owner can refresh NFT metadata.'); return null; }
      this.host.saveInFlight = true;
      await run.wait(refreshAuthSession());
      if (!run.current() || !this.requireWallet('artwork')) return null;
      this.beginWait(run);
      const snapshot = cloneRoomSnapshot(this.host.publishedRoomSnapshot);
      const built = await run.wait(buildRoomTokenArtwork(snapshot, { origin: window.location.origin,
        chainId: this.host.mintedChainId, contractAddress: this.host.mintedContractAddress, tokenId: this.host.mintedTokenId }));
      if (!run.current()) return null;
      const prepare = await run.wait(this.roomRepository.prepareMetadataRefresh(this.host.roomId, this.host.roomCoordinates, { tokenUri: built.tokenUri }));
      if (!run.current()) return null;
      const transaction = { ...prepare.transaction }, chain = { ...prepare.chain, nativeCurrency: { ...prepare.chain.nativeCurrency } };
      if (chain.chainId !== this.host.mintedChainId || transaction.to.toLowerCase() !== this.host.mintedContractAddress.toLowerCase()) {
        throw new Error('The room cost or network changed.');
      }
      run.chainName = chain.name;
      const accepted = await run.wait(requestRoomWalletConsent({ title: run.title, kind: 'artwork', transaction, chain,
        wallet: identity().wallet!, signal: run.controller.signal, isCurrent: run.current }));
      if (!run.current()) return null;
      if (!accepted) { options.onDeclined?.(); this.host.setStatusText(hasCryptoWallet() ? 'Artwork was not added. Your room is already collected.' : 'Room action cancelled.'); return null; }
      run.pending = { ...this.intent('artwork', chain, transaction), tokenId: this.host.mintedTokenId,
        metadataRoomVersion: snapshot.version, metadataHash: built.metadataHash };
      this.beginWait(run);
      updateBusyOverlay(run.title, `Approve the ${prepare.chain.name} artwork transaction in your wallet.`);
      this.host.setStatusText(`Waiting for artwork approval on ${prepare.chain.name}...`);
      await run.wait(this.send(run, transaction, chain));
      if (!run.current()) return null;
      return this.confirmArtwork(run, run.pending);
    });
  }

  private requireWallet(kind: 'mint' | 'artwork'): boolean {
    const account = identity();
    if (!account.userId) { promptForSignIn('Sign in and link a wallet to collect this room or add artwork.'); return false; }
    if (!account.wallet) { this.host.setStatusText(`Link a wallet from the account menu before ${kind === 'mint' ? 'using Collect & Lock' : 'updating artwork'}.`); return false; }
    return true;
  }

  private intent(kind: PendingRoomWallet['kind'], chain: RoomMintChainInfo, tx: PreparedWalletTransaction): PendingRoomWallet {
    const account = identity();
    if (!account.userId || !account.wallet || tx.chainId !== chain.chainId || getActiveWorldId()) throw new Error('The room or wallet changed.');
    return { id: crypto.randomUUID(), kind, roomId: this.host.roomId, coordinates: { ...this.host.roomCoordinates },
      userId: account.userId, wallet: account.wallet, chainId: chain.chainId, contractAddress: tx.to.toLowerCase(),
      txHash: null, tokenId: null, metadataHash: null, metadataRoomVersion: null, createdAt: Date.now() };
  }

  private send(run: WalletRun, transaction: PreparedWalletTransaction, chain: RoomMintChainInfo) {
    const pending = run.pending!, store = getPendingRoomWalletStore();
    const remember = (hash?: string) => {
      // This callback deliberately survives cancellation/reset. It only records the captured action.
      if (hash) pending.txHash = hash.toLowerCase();
      run.durable = store.put(pending).durable;
      if (!run.durable && run.current()) {
        const text = 'Keep this tab open: recovery could not be saved on this device. You can still check your approval here.';
        this.host.setStatusText(text);
        if (getAppFeedbackDebugState().busyTitle === run.title) updateBusyOverlay(run.title, text);
      }
    };
    return sendPreparedWalletTransaction(transaction, chain, {
      expectedWalletAddress: pending.wallet, isCurrent: run.current, signal: run.controller.signal,
      onBeforeSend: () => { if (!run.current()) throw new Error('This room action is no longer current.'); remember(); },
      onSubmitted: tx => remember(tx.hash),
    }).then(tx => { if (!pending.txHash) remember(tx.hash); return tx; }, error => {
      if (!pending.txHash && (definitelyRejected(error) || error instanceof WalletRequestNotSubmittedError)
        || error instanceof WalletTransactionRevertedError && pending.txHash === error.hash.toLowerCase()) {
        store.remove(pending.id, pending.txHash);
      }
      throw error;
    });
  }

  private async confirmArtwork(run: WalletRun, pending: PendingRoomWallet): Promise<RoomRecord | null> {
    if (!pending.txHash || pending.metadataRoomVersion === null || !pending.metadataHash) return null;
    updateBusyOverlay(run.title, 'Checking the artwork transaction...');
    const record = await run.wait(this.roomRepository.confirmMetadataRefresh(pending.roomId, pending.coordinates, {
      txHash: pending.txHash, metadataRoomVersion: pending.metadataRoomVersion, metadataHash: pending.metadataHash,
    }));
    if (!run.current()) return null;
    this.acceptRecord(run, record);
    const viewer = buildRoomTokenViewerUrl(record);
    this.host.setStatusDetails({ text: 'Room artwork is saved.', accentText: `Artwork added to token #${record.mintedTokenId}`,
      linkLabel: viewer ? 'View collectible' : '', linkHref: viewer });
    return record;
  }

  private acceptRecord(run: WalletRun, record: RoomRecord): void {
    if (run.pending) getPendingRoomWalletStore().remove(run.pending.id, run.pending.txHash);
    this.host.syncRoomMetadata(record);
  }

  private async resume(run: WalletRun, pending: PendingRoomWallet): Promise<RoomRecord | null> {
    const account = identity();
    if (account.userId !== pending.userId || account.wallet !== pending.wallet) {
      this.host.setStatusText('Your wallet or room changed. Return to the original account to check this pending approval.'); return null;
    }
    run.pending = pending;
    this.host.saveInFlight = true;
    this.beginWait(run);
    // These server routes verify the transaction and canonical chain state. No wallet request.
    if (pending.txHash) {
      if (pending.kind === 'artwork') return this.confirmArtwork(run, pending);
      const record = await run.wait(this.roomRepository.confirmMint(pending.roomId, pending.coordinates, { txHash: pending.txHash }));
      if (!run.current()) return null;
      this.acceptRecord(run, record);
      this.host.setStatusText(record.permissions.canSaveDraft
        ? 'Your room is collected. Choose Add/update artwork to add its artwork.' : 'Room ownership checked. This room is protected.');
      return record;
    }
    await this.checkPending(pending, run.controller.signal, run.current);
    return null;
  }

  private beginWait(run: WalletRun): void {
    const close = () => {
      run.cancel();
      if (getAppFeedbackDebugState().busyTitle === run.title) hideBusyOverlay();
    };
    showBusyOverlay(run.title, 'Preparing your room approval...', { close, check: async () => {
      const pending = run.pending;
      close();
      if (pending) await this.checkPending(pending);
    } });
  }

  private async checkPending(pending: PendingRoomWallet, signal?: AbortSignal, current?: () => boolean): Promise<void> {
    const generation = this.host.sessionGeneration, account = identity();
    const controller = new AbortController();
    this.checks.add(controller);
    const same = () => this.host.isActive() && this.host.sessionGeneration === generation && this.host.roomId === pending.roomId
      && identity().userId === account.userId && identity().wallet === account.wallet && (!current || current());
    const invalidate = () => { if (!same()) controller.abort(); };
    const abort = () => controller.abort();
    for (const event of ['sleep', 'shutdown', 'destroy']) this.host.events?.on(event, abort);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    window.addEventListener(AUTH_STATE_CHANGED_EVENT, invalidate);
    window.addEventListener(WORLD_CONTEXT_CHANGED_EVENT, abort);
    try {
      const recovery = new RoomWalletRecovery({ store: getPendingRoomWalletStore(), getIdentity: identity,
        isOverworld: () => !getActiveWorldId(),
        refresh: (p, s) => this.roomRepository.refreshRoomOwnership(p.roomId, p.coordinates, { signal: s, recoverPendingWallet: true }), receipt: checkRoomWalletReceipt });
      const result = await recovery.check(pending, controller.signal);
      if (!same() || controller.signal.aborted) return;
      this.host.applyRecovery(result.summary);
      const text = result.status === 'complete' ? 'Your room approval is confirmed.' : result.status === 'reverted'
        ? 'The wallet transaction reverted. You can try again.'
        : 'The wallet approval is not confirmed yet. Check again before starting another approval.';
      this.host.setStatusText(text);
      showBusyError(text, { title: 'Room approval', closeLabel: 'Back to room', retryLabel: 'Check again',
        tone: result.status === 'complete' ? 'success' : result.status === 'reverted' ? 'error' : 'choice',
        retryHandler: result.status === 'pending' ? () => this.checkPending(pending) : null });
    } catch {
      if (!same() || controller.signal.aborted) return;
      this.host.setStatusText('Could not check the room approval. Check again before starting another approval.');
      showBusyError('Could not check the room approval. Your pending approval is saved.', {
        title: 'Room approval', retryLabel: 'Check again', retryHandler: () => this.checkPending(pending) });
    } finally {
      signal?.removeEventListener('abort', abort);
      window.removeEventListener(AUTH_STATE_CHANGED_EVENT, invalidate);
      window.removeEventListener(WORLD_CONTEXT_CHANGED_EVENT, abort);
      for (const event of ['sleep', 'shutdown', 'destroy']) this.host.events?.off(event, abort);
      this.checks.delete(controller);
      controller.abort();
    }
  }

  private async run(kind: PendingRoomWallet['kind'], options: RoomCollectionStageOptions,
    action: (run: WalletRun) => Promise<RoomRecord | null>): Promise<RoomRecord | null> {
    if (this.active || this.host.saveInFlight || getActiveWorldId() || !this.host.isActive()) return null;
    const generation = this.host.sessionGeneration, roomId = this.host.roomId, account = identity();
    let signerSeen = Boolean(account.signer);
    const controller = new AbortController();
    const signerCurrent = () => {
      const signer = identity().signer;
      const valid = !account.wallet || (signer ? signer === account.wallet : !signerSeen);
      if (account.wallet && signer === account.wallet) signerSeen = true;
      return valid;
    };
    const current = () => !controller.signal.aborted && this.host.isActive() && this.host.sessionGeneration === generation
      && this.host.roomId === roomId && !getActiveWorldId() && options.isCurrent?.() !== false
      && identity().userId === account.userId && identity().wallet === account.wallet && signerCurrent();
    const abort = () => controller.abort();
    const identityChange = () => { if (!current()) abort(); };
    const run: WalletRun = { controller, current, wait: work => waitForRoomWallet(work, controller.signal), cancel: () => { options.cancel?.(); abort(); },
      title: options.stageLabel ?? (kind === 'mint' ? 'Collect & Lock' : 'Add/update artwork'), pending: null, durable: true };
    this.active = run;
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    window.addEventListener(AUTH_STATE_CHANGED_EVENT, identityChange);
    window.addEventListener(WORLD_CONTEXT_CHANGED_EVENT, abort);
    for (const event of ['sleep', 'shutdown', 'destroy']) this.host.events?.on(event, abort);
    try {
      if (!current()) return null;
      const result = await action(run);
      return current() ? result : null;
    } catch (error) {
      if (!current()) return null;
      // A 409 may mean the chain already healed a mint/artwork. Keep the captured room fenced.
      if (isRoomApiError(error) && error.status === 409) {
        try {
          const record = createRoomRecordFromCurrent(await run.wait(this.roomRepository.loadRoomCurrent(roomId, this.host.roomCoordinates)));
          if (current()) {
            this.host.syncRoomMetadata(record);
            const p = run.pending;
            if (p && record.mintedTokenId && record.mintedChainId === p.chainId
              && record.mintedContractAddress?.toLowerCase() === p.contractAddress
              && (p.kind === 'mint' || record.mintedMetadataHash === p.metadataHash
                && record.mintedMetadataRoomVersion === p.metadataRoomVersion)) {
              this.acceptRecord(run, record);
              this.host.setStatusText('Your room approval is already confirmed.'); return record;
            }
          }
        } catch { /* Keep the durable hash for a fresh check. */ }
      }
      const pending = this.getPending();
      if (current()) this.host.setStatusText(pending
        ? `${run.durable ? pending.txHash ? 'The approval was submitted.' : 'The wallet approval is not confirmed yet.'
          : 'Keep this tab open: recovery could not be saved on this device.'} Choose ${kind === 'mint' ? 'Collect & Lock' : 'Add/update artwork'} to check it again without another wallet approval.`
        : roomWalletErrorMessage(error, kind, run.chainName, account.wallet));
      return null;
    } finally {
      options.signal?.removeEventListener('abort', abort);
      window.removeEventListener(AUTH_STATE_CHANGED_EVENT, identityChange);
      window.removeEventListener(WORLD_CONTEXT_CHANGED_EVENT, abort);
      for (const event of ['sleep', 'shutdown', 'destroy']) this.host.events?.off(event, abort);
      if (getAppFeedbackDebugState().busyTitle === run.title) hideBusyOverlay();
      if (this.active === run) this.active = null;
      if (this.host.sessionGeneration === generation) { this.host.saveInFlight = false; this.host.refreshUi(); }
    }
  }
}
