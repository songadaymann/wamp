import type { RoomCoordinates, RoomRecord, RoomSnapshot } from '../persistence/roomModel';

export type GuestRoomDraftStatus = 'active' | 'claimed' | 'submitted' | 'discarded' | 'hidden';

export interface GuestRoomDraftSummary {
  id: string;
  guestUserId: string;
  guestDisplayName: string;
  roomId: string;
  roomX: number;
  roomY: number;
  title: string | null;
  status: GuestRoomDraftStatus;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  moderationStatus: string;
  snapshot: RoomSnapshot;
  claimedByUserId?: string | null;
  claimedRoomId?: string | null;
  claimedAt?: string | null;
}

export interface GuestRoomDraftClaimBody {
  expectedUserId: string;
  coordinates?: RoomCoordinates;
}

export type GuestRoomDraftClaimResponse = {
  outcome: 'claimed';
  userId: string;
  draftId: string;
  roomId: string;
  claimedAt: string;
  room: RoomRecord;
} | {
  outcome: 'conflict';
  userId: string;
  draftId: string;
  reason: 'occupied' | 'not_frontier';
  message: string;
  coordinates: RoomCoordinates;
  suggestedCoordinates: RoomCoordinates[];
};

export interface GuestRoomDraftSaveRequestBody {
  guestUserId: string;
  guestDisplayName: string;
  recoveryToken: string;
  snapshot: RoomSnapshot;
}

export interface GuestRoomDraftSaveResponse {
  draft: GuestRoomDraftSummary;
}

export interface GuestRoomDraftListResponse {
  drafts: GuestRoomDraftSummary[];
}

export interface GuestRoomDraftGetResponse {
  draft: GuestRoomDraftSummary;
}

export interface GuestRoomDraftSubmitResponse {
  draft: GuestRoomDraftSummary;
}
