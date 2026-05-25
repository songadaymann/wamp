import type { RoomSnapshot } from '../persistence/roomModel';

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
}

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
