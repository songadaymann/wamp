import { isRoomMinted, type RoomCoordinates, type RoomSummary } from '../../persistence/roomModel';
import type { RoomRepository } from '../../persistence/roomRepository';

export interface RoomOwnershipEditHost {
  repository: Pick<RoomRepository, 'loadRoomSummary' | 'refreshRoomOwnership'>;
  captureContext(): () => boolean;
  subscribeInvalidation(callback: () => void): () => void;
  getWalletAddress(): string | null;
  canCheckWallet?(): boolean;
  getUserId(): string | null;
  acceptOwnership(roomId: string, summary: RoomSummary): void;
}

export interface RoomOwnershipEditPermit {
  roomOnly: boolean;
  isCurrent(): boolean;
  dispose(): void;
}

/** One user-requested ownership check; it never polls or retains a failed result. */
export async function prepareRoomOwnershipEdit(
  host: RoomOwnershipEditHost,
  roomId: string,
  coordinates: RoomCoordinates,
): Promise<RoomOwnershipEditPermit | null> {
  const isCurrent = host.captureContext();
  if (!isCurrent()) return null;
  const userId = host.getUserId();
  const canCheckWallet = host.canCheckWallet?.() ?? true;
  const wallet = canCheckWallet ? host.getWalletAddress()?.trim().toLowerCase() ?? null : null;
  const abort = new AbortController();
  let cancelled = false, handedOff = false;
  let stop = () => {};
  stop = host.subscribeInvalidation(() => { cancelled = true; abort.abort(); stop(); });
  const current = () => !cancelled && isCurrent() && userId === host.getUserId()
    && canCheckWallet === (host.canCheckWallet?.() ?? true)
    && (!canCheckWallet || wallet === (host.getWalletAddress()?.trim().toLowerCase() ?? null));
  const permit = { roomOnly: false, isCurrent: current, dispose: () => { cancelled = true; stop(); } };
  const timeout = setTimeout(() => abort.abort(), 15_000);
  try {
    const summary = await host.repository.loadRoomSummary(roomId, coordinates, { signal: abort.signal });
    if (!current()) return null;
    if (summary.id !== roomId) throw new Error();
    if (!isRoomMinted(summary)) { handedOff = true; return permit; }
    if (!canCheckWallet) {
      if (!summary.permissions.canSaveDraft) throw new RoomOwnershipDeniedError('This room is protected.');
      permit.roomOnly = summary.claimerUserId !== userId;
      handedOff = true; return permit;
    }
    if (!wallet) throw new RoomOwnershipDeniedError('Link the wallet that owns this room to edit it.');
    const fresh = await host.repository.refreshRoomOwnership(roomId, coordinates, { signal: abort.signal });
    if (!current()) return null;
    if (fresh.id !== roomId) throw new Error();
    host.acceptOwnership(roomId, fresh);
    if (fresh.mintedOwnerWalletAddress
      ? fresh.mintedOwnerWalletAddress.trim().toLowerCase() !== wallet : !fresh.permissions.canSaveDraft) {
      throw new RoomOwnershipDeniedError();
    }
    if (!fresh.permissions.canSaveDraft) throw new RoomOwnershipDeniedError('You do not have permission to edit this room.');
    // Acquiring one room token does not convey its original builder's group rights.
    permit.roomOnly = fresh.claimerUserId !== userId;
    handedOff = true;
    return permit;
  } catch (error) {
    if (!current()) return null;
    if (error instanceof RoomOwnershipDeniedError) throw error;
    // Provider diagnostics and internal routes do not belong in this interaction.
    throw new Error('Could not check room ownership. Please try again.');
  } finally {
    clearTimeout(timeout);
    if (!handedOff) stop();
  }
}

class RoomOwnershipDeniedError extends Error {
  constructor(message = 'Your linked wallet does not own this room.') { super(message); }
}
