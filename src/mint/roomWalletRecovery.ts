import type { RoomSummary } from '../persistence/roomModel';
import type { PendingRoomWallet, PendingRoomWalletStore } from './pendingRoomWallet';

export function waitForRoomWallet<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('Room wallet check cancelled.', 'AbortError'));
    if (signal.aborted) { void work.catch(() => {}); abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export interface RoomWalletIdentity { userId: string | null; wallet: string | null }
export interface RoomWalletRecoveryResult {
  status: 'complete' | 'pending' | 'reverted';
  summary: RoomSummary;
}
interface RecoveryHost {
  store: PendingRoomWalletStore;
  getIdentity(): RoomWalletIdentity;
  isOverworld(): boolean;
  refresh(pending: PendingRoomWallet, signal: AbortSignal): Promise<RoomSummary>;
  receipt?(pending: PendingRoomWallet, signal: AbortSignal): Promise<'success' | 'reverted' | null>;
}
const checks = new WeakMap<PendingRoomWalletStore, Map<string, Promise<RoomWalletRecoveryResult>>>();
const observers = new Set<(pending: PendingRoomWallet, result: RoomWalletRecoveryResult) => void>();
export function watchRoomWalletRecovery(observer: (pending: PendingRoomWallet, result: RoomWalletRecoveryResult) => void): () => void {
  observers.add(observer);
  return () => { observers.delete(observer); };
}

/** Finite, shared checks. A chain read can recover permissions, never authorize a send. */
export class RoomWalletRecovery {
  private readonly active: Map<string, Promise<RoomWalletRecoveryResult>>;
  constructor(private readonly host: RecoveryHost) {
    this.active = checks.get(host.store) ?? new Map();
    checks.set(host.store, this.active);
  }

  check(pending: PendingRoomWallet, signal: AbortSignal): Promise<RoomWalletRecoveryResult> {
    const existing = this.active.get(pending.id);
    if (existing) return waitForRoomWallet(existing, signal);
    const promise = this.run(pending, signal).then(result => {
      if (!signal.aborted) for (const observer of observers) observer(pending, result);
      return result;
    }).finally(() => {
      if (this.active.get(pending.id) === promise) this.active.delete(pending.id);
    });
    this.active.set(pending.id, promise);
    return promise;
  }

  private async run(pending: PendingRoomWallet, signal: AbortSignal): Promise<RoomWalletRecoveryResult> {
    const current = () => {
      const identity = this.host.getIdentity();
      if (signal.aborted || !this.host.isOverworld() || identity.userId !== pending.userId
        || identity.wallet?.toLowerCase() !== pending.wallet.toLowerCase()) {
        throw new DOMException('Room wallet account changed.', 'AbortError');
      }
    };
    current();
    // Even an adapter that fails to honor AbortSignal cannot hold this check indefinitely.
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 25_000);
    try {
      const summary = await waitForRoomWallet(this.host.refresh(pending, controller.signal), controller.signal);
      current();
      if (summary.id !== pending.roomId || summary.coordinates.x !== pending.coordinates.x
        || summary.coordinates.y !== pending.coordinates.y || summary.world?.worldId) {
        throw new Error('The wallet check returned another room.');
      }
      const matched = summary.mintedTokenId !== null && summary.mintedChainId === pending.chainId
        && summary.mintedContractAddress?.toLowerCase() === pending.contractAddress.toLowerCase();
      const complete = matched && (pending.kind === 'mint'
        || summary.mintedTokenId === pending.tokenId && summary.mintedMetadataHash?.toLowerCase() === pending.metadataHash
          && summary.mintedMetadataRoomVersion === pending.metadataRoomVersion);
      if (complete) {
        this.host.store.remove(pending.id, pending.txHash);
        return { status: 'complete', summary };
      }
      const receipt = pending.txHash && this.host.receipt
        ? await waitForRoomWallet(this.host.receipt(pending, controller.signal), controller.signal) : null;
      current();
      if (receipt === 'reverted' || receipt === 'success' && matched) {
        // A mined older artwork update may have been superseded. Keep the fresh canonical URI.
        this.host.store.remove(pending.id, pending.txHash);
        return { status: receipt === 'reverted' ? 'reverted' : 'complete', summary };
      }
      return { status: 'pending', summary };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      controller.abort();
    }
  }
}
