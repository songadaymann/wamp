import { getAuthDebugState } from '../../auth/client';
import type { RoomCoordinates } from '../../persistence/roomRepository';
import {
  GUEST_BUILDER_BUILD_PLACEMENT_THRESHOLD,
  requestGuestBuilderClaim,
} from '../../progression/guestBuilderClaimEvents';

interface GuestBuilderActivityTrackerHost {
  getRoomId(): string;
  getRoomCoordinates(): RoomCoordinates;
  getRoomTitle(): string | null;
}

export class GuestBuilderActivityTracker {
  private placementCount = 0;
  private readonly promptedRoomIds = new Set<string>();

  constructor(private readonly host: GuestBuilderActivityTrackerHost) {}

  reset(): void {
    this.placementCount = 0;
  }

  recordPlacedBuildContent(count: number): void {
    const addedCount = Math.max(0, Math.floor(count));
    if (addedCount <= 0 || getAuthDebugState().authenticated) {
      return;
    }

    this.placementCount += addedCount;
    if (this.placementCount < GUEST_BUILDER_BUILD_PLACEMENT_THRESHOLD) {
      return;
    }

    const roomId = this.host.getRoomId();
    if (this.promptedRoomIds.has(roomId)) {
      return;
    }

    this.promptedRoomIds.add(roomId);
    requestGuestBuilderClaim({
      roomId,
      roomCoordinates: this.host.getRoomCoordinates(),
      roomTitle: this.host.getRoomTitle(),
      source: 'build-threshold',
      buildActivityCount: this.placementCount,
    });
  }
}
