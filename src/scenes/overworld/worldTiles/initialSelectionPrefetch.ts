/**
 * Prevents an implicit startup selection from competing with viewport tiles,
 * while preserving immediate work once the selection represents user intent.
 */
export class InitialSelectionPrefetchGate {
  private observedRoomId: string;
  private prefetchedRoomId: string | null = null;
  private explicitIntentRoomId: string | null = null;

  constructor(initialRoomId: string) {
    this.observedRoomId = initialRoomId;
  }

  shouldPrefetch(roomId: string, targetLodReady: boolean): boolean {
    if (roomId !== this.observedRoomId) {
      this.observedRoomId = roomId;
      this.explicitIntentRoomId = roomId;
    }
    if (roomId === this.prefetchedRoomId) return false;
    return targetLodReady || roomId === this.explicitIntentRoomId;
  }

  markUserIntent(roomId: string): void {
    this.observedRoomId = roomId;
    this.explicitIntentRoomId = roomId;
  }

  markPrefetched(roomId: string): void {
    this.observedRoomId = roomId;
    this.prefetchedRoomId = roomId;
    if (this.explicitIntentRoomId === roomId) this.explicitIntentRoomId = null;
  }

  clearPrefetched(): void {
    this.prefetchedRoomId = null;
  }

  reset(initialRoomId: string): void {
    this.observedRoomId = initialRoomId;
    this.prefetchedRoomId = null;
    this.explicitIntentRoomId = null;
  }
}
