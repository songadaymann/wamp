import { isRoomMinted, type RoomCoordinates, type RoomSummary } from '../../persistence/roomModel';
import type { RoomRepository } from '../../persistence/roomRepository';

export interface RoomOwnershipEditHost {
  repository: Pick<RoomRepository, 'loadRoomSummary' | 'refreshRoomOwnership'>;
  captureContext(): () => boolean;
  subscribeInvalidation(callback: () => void): () => void;
  getWalletAddress(): string | null;
  acceptOwnership(roomId: string, summary: RoomSummary): void;
}

export interface RoomOwnershipEditPermit {
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
  const wallet = host.getWalletAddress()?.trim().toLowerCase() ?? null;
  const abort = new AbortController();
  let cancelled = false, handedOff = false;
  let stop = () => {};
  stop = host.subscribeInvalidation(() => { cancelled = true; abort.abort(); stop(); });
  const current = () => !cancelled && isCurrent() && wallet === (host.getWalletAddress()?.trim().toLowerCase() ?? null);
  const permit = { isCurrent: current, dispose: () => { cancelled = true; stop(); } };
  const timeout = setTimeout(() => abort.abort(), 15_000);
  try {
    const summary = await host.repository.loadRoomSummary(roomId, coordinates, { signal: abort.signal });
    if (!current()) return null;
    if (summary.id !== roomId) throw new Error();
    if (!isRoomMinted(summary)) { handedOff = true; return permit; }
    if (!wallet) throw new RoomOwnershipDeniedError('Link the wallet that owns this room to edit it.');
    const fresh = await host.repository.refreshRoomOwnership(roomId, coordinates, { signal: abort.signal });
    if (!current()) return null;
    if (fresh.id !== roomId) throw new Error();
    host.acceptOwnership(roomId, fresh);
    if (fresh.mintedOwnerWalletAddress?.trim().toLowerCase() !== wallet) {
      throw new RoomOwnershipDeniedError();
    }
    if (!fresh.permissions.canSaveDraft) throw new RoomOwnershipDeniedError('You do not have permission to edit this room.');
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
