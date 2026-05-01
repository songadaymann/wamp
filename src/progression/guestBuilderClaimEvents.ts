import type { RoomCoordinates } from '../persistence/roomModel';

export const GUEST_BUILDER_CLAIM_REQUEST_EVENT = 'guest-builder-claim-request';
export const GUEST_BUILDER_POTENTIAL_BXP = 25;
export const GUEST_BUILDER_BUILD_PLACEMENT_THRESHOLD = 30;

export type GuestBuilderClaimSource = 'auto-save' | 'manual-save' | 'publish-attempt' | 'build-threshold';

export interface GuestBuilderClaimRequestDetail {
  roomId: string;
  roomCoordinates: RoomCoordinates;
  roomTitle: string | null;
  potentialBxp: number;
  source: GuestBuilderClaimSource;
  buildActivityCount?: number;
}

export function requestGuestBuilderClaim(
  detail: Omit<GuestBuilderClaimRequestDetail, 'potentialBxp'> & {
    potentialBxp?: number;
  },
): void {
  const buildActivityCount = Number.isFinite(detail.buildActivityCount)
    ? Math.max(0, Math.round(detail.buildActivityCount ?? 0))
    : undefined;

  window.dispatchEvent(
    new CustomEvent<GuestBuilderClaimRequestDetail>(GUEST_BUILDER_CLAIM_REQUEST_EVENT, {
      detail: {
        ...detail,
        roomCoordinates: { ...detail.roomCoordinates },
        potentialBxp: Math.max(0, Math.round(detail.potentialBxp ?? GUEST_BUILDER_POTENTIAL_BXP)),
        ...(buildActivityCount === undefined ? {} : { buildActivityCount }),
      },
    }),
  );
}
