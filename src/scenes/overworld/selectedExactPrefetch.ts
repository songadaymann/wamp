import { InitialSelectionPrefetchGate } from './worldTiles/initialSelectionPrefetch';

export const SELECTED_EXACT_PREFETCH_RETRY_DELAYS_MS = [500, 1_000, 2_000, 5_000] as const;

export interface SelectedExactPrefetchRequest {
  readonly generation: number;
  readonly roomId: string;
  readonly missingAtStart: boolean;
}

export interface SelectedExactPrefetchCompletion {
  accepted: boolean;
  shouldRefreshSelectedState: boolean;
}

/**
 * Owns selection-prefetch completion and retry state without performing I/O.
 * At most one request is active and repeated failures retry at a capped rate.
 */
export class SelectedExactPrefetchLifecycle {
  private readonly intentGate: InitialSelectionPrefetchGate;
  private generation = 0;
  private activeRequest: SelectedExactPrefetchRequest | null = null;
  private readyRoomId: string | null = null;
  private retryRoomId: string | null = null;
  private retryAttempt = 0;
  private retryAtMs = 0;
  private paused = false;

  constructor(
    initialRoomId: string,
    private readonly retryDelaysMs: readonly number[] = SELECTED_EXACT_PREFETCH_RETRY_DELAYS_MS,
  ) {
    if (retryDelaysMs.length === 0 || retryDelaysMs.some((delay) => !Number.isFinite(delay) || delay < 0)) {
      throw new RangeError('Selected exact-prefetch retry delays must be finite non-negative values.');
    }
    this.intentGate = new InitialSelectionPrefetchGate(initialRoomId);
  }

  begin(input: {
    roomId: string;
    targetLodReady: boolean;
    missingAtStart: boolean;
    nowMs: number;
  }): SelectedExactPrefetchRequest | null {
    this.paused = false;
    this.cancelDifferentActiveRoom(input.roomId);
    if (this.retryRoomId !== null && this.retryRoomId !== input.roomId) this.clearRetry();
    if (this.readyRoomId === input.roomId || this.activeRequest?.roomId === input.roomId) return null;
    if (this.retryRoomId === input.roomId && input.nowMs < this.retryAtMs) return null;
    if (!this.intentGate.shouldPrefetch(input.roomId, input.targetLodReady)) return null;

    const request: SelectedExactPrefetchRequest = {
      generation: ++this.generation,
      roomId: input.roomId,
      missingAtStart: input.missingAtStart,
    };
    this.activeRequest = request;
    return request;
  }

  complete(input: {
    request: SelectedExactPrefetchRequest;
    snapshotAvailable: boolean;
    currentRoomId: string;
    nowMs: number;
  }): SelectedExactPrefetchCompletion {
    if (
      this.activeRequest !== input.request
      || input.request.generation !== this.generation
    ) {
      return { accepted: false, shouldRefreshSelectedState: false };
    }

    this.activeRequest = null;
    if (input.currentRoomId !== input.request.roomId) {
      this.clearRetry();
      return { accepted: true, shouldRefreshSelectedState: false };
    }

    if (!input.snapshotAvailable) {
      const retryDelay = this.retryDelaysMs[Math.min(
        this.retryAttempt,
        this.retryDelaysMs.length - 1,
      )];
      this.retryRoomId = input.request.roomId;
      this.retryAtMs = input.nowMs + retryDelay;
      this.retryAttempt = Math.min(this.retryAttempt + 1, this.retryDelaysMs.length);
      return { accepted: true, shouldRefreshSelectedState: false };
    }

    this.clearRetry();
    this.readyRoomId = input.request.roomId;
    this.intentGate.markPrefetched(input.request.roomId);
    return {
      accepted: true,
      shouldRefreshSelectedState: input.request.missingAtStart,
    };
  }

  markAvailable(roomId: string): void {
    this.paused = false;
    this.cancelDifferentActiveRoom(roomId);
    if (this.activeRequest?.roomId === roomId) {
      this.generation += 1;
      this.activeRequest = null;
    }
    this.clearRetry();
    this.readyRoomId = roomId;
    this.intentGate.markPrefetched(roomId);
  }

  invalidate(roomId: string): void {
    if (this.activeRequest?.roomId === roomId) {
      this.generation += 1;
      this.activeRequest = null;
    }
    if (this.retryRoomId === roomId) this.clearRetry();
    if (this.readyRoomId !== roomId) return;
    this.readyRoomId = null;
    this.intentGate.clearPrefetched();
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.generation += 1;
    this.activeRequest = null;
    this.readyRoomId = null;
    this.clearRetry();
    this.intentGate.clearPrefetched();
  }

  reset(initialRoomId: string): void {
    this.paused = false;
    this.generation += 1;
    this.activeRequest = null;
    this.readyRoomId = null;
    this.clearRetry();
    this.intentGate.reset(initialRoomId);
  }

  private cancelDifferentActiveRoom(roomId: string): void {
    if (!this.activeRequest || this.activeRequest.roomId === roomId) return;
    this.generation += 1;
    this.activeRequest = null;
    this.clearRetry();
  }

  private clearRetry(): void {
    this.retryRoomId = null;
    this.retryAttempt = 0;
    this.retryAtMs = 0;
  }
}
