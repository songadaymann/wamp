import type { RoomCoordinates } from '../../../persistence/roomModel';
import type { WorldTileManifest } from './types';

export interface WorldTileRoomManifestPrefetcherOptions {
  load: (coordinates: RoomCoordinates, signal: AbortSignal) => Promise<WorldTileManifest | null>;
  onManifest: (coordinates: RoomCoordinates, manifest: WorldTileManifest) => void;
  onFailure: (error: unknown) => void;
  shouldContinue: () => boolean;
  timeoutMs: number;
}

interface InFlightRoomPrefetch {
  abortController: AbortController;
  owners: Set<string>;
  promise: Promise<void>;
}

export class WorldTileRoomManifestPrefetcher {
  private readonly inFlightByRoomId = new Map<string, InFlightRoomPrefetch>();

  constructor(private readonly options: WorldTileRoomManifestPrefetcherOptions) {}

  get pendingCount(): number {
    return this.inFlightByRoomId.size;
  }

  prefetch(coordinates: RoomCoordinates, owner = 'default'): Promise<void> {
    const roomId = `${coordinates.x},${coordinates.y}`;
    const existing = this.inFlightByRoomId.get(roomId);
    if (existing) {
      existing.owners.add(owner);
      return existing.promise;
    }

    const abortController = new AbortController();
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        abortController.abort();
        reject(new Error('World tile room manifest prefetch timed out.'));
      }, this.options.timeoutMs);
    });
    const promise = Promise.race([
      this.options.load(coordinates, abortController.signal),
      timeout,
    ])
      .then((manifest) => {
        if (!manifest || abortController.signal.aborted || !this.options.shouldContinue()) return;
        this.options.onManifest(coordinates, manifest);
      })
      .catch((error) => {
        if (timedOut) {
          this.options.onFailure(new Error('World tile room manifest prefetch timed out.'));
        } else if (!isAbortError(error)) {
          this.options.onFailure(error);
        }
      })
      .finally(() => {
        if (timeoutId !== null) clearTimeout(timeoutId);
        if (this.inFlightByRoomId.get(roomId)?.promise === promise) {
          this.inFlightByRoomId.delete(roomId);
        }
      });
    this.inFlightByRoomId.set(roomId, { abortController, owners: new Set([owner]), promise });
    return promise;
  }

  cancelOwner(owner: string, exceptRoomId: string | null = null): void {
    for (const [roomId, request] of this.inFlightByRoomId) {
      if (roomId === exceptRoomId || !request.owners.delete(owner)) continue;
      if (request.owners.size > 0) continue;
      request.abortController.abort();
      this.inFlightByRoomId.delete(roomId);
    }
  }

  cancelAll(): void {
    for (const request of this.inFlightByRoomId.values()) request.abortController.abort();
    this.inFlightByRoomId.clear();
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
