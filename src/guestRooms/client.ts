import { apiRequest } from '../api/request';
import { resolveWorldPresenceGuestIdentity } from '../presence/worldPresence';
import type { RoomSnapshot } from '../persistence/roomModel';
import { resolveGuestRecoveryToken } from './identity';
import type {
  GuestRoomDraftGetResponse,
  GuestRoomDraftListResponse,
  GuestRoomDraftSaveRequestBody,
  GuestRoomDraftSaveResponse,
  GuestRoomDraftSubmitResponse,
} from './model';

export async function saveGuestRoomDraft(snapshot: RoomSnapshot): Promise<GuestRoomDraftSaveResponse> {
  const identity = resolveWorldPresenceGuestIdentity();
  const body: GuestRoomDraftSaveRequestBody = {
    guestUserId: identity.userId,
    guestDisplayName: identity.displayName,
    recoveryToken: resolveGuestRecoveryToken(),
    snapshot,
  };

  return apiRequest<GuestRoomDraftSaveResponse>(
    `/api/guest-room-drafts/${encodeURIComponent(snapshot.id)}`,
    {
      method: 'PUT',
      body: JSON.stringify(body),
      credentials: 'omit',
    },
  );
}

export function listMyGuestRoomDrafts(): Promise<GuestRoomDraftListResponse> {
  return apiRequest<GuestRoomDraftListResponse>('/api/guest-room-drafts/mine', {
    credentials: 'omit',
    prepareHeaders: appendGuestRecoveryHeaders,
  });
}

export function listSubmittedGuestRoomDrafts(limit = 48): Promise<GuestRoomDraftListResponse> {
  const params = new URLSearchParams({
    limit: String(limit),
  });
  return apiRequest<GuestRoomDraftListResponse>(`/api/guest-room-drafts/submitted?${params.toString()}`, {
    credentials: 'omit',
  });
}

export function loadGuestRoomDraft(draftId: string): Promise<GuestRoomDraftGetResponse> {
  return apiRequest<GuestRoomDraftGetResponse>(
    `/api/guest-room-drafts/${encodeURIComponent(draftId)}`,
    {
      credentials: 'omit',
      prepareHeaders: appendGuestRecoveryHeaders,
    },
  );
}

export function submitGuestRoomDraft(draftId: string): Promise<GuestRoomDraftSubmitResponse> {
  return apiRequest<GuestRoomDraftSubmitResponse>(
    `/api/guest-room-drafts/${encodeURIComponent(draftId)}/submit`,
    {
      method: 'POST',
      credentials: 'omit',
      prepareHeaders: appendGuestRecoveryHeaders,
    },
  );
}

export async function submitLatestGuestRoomDraftForRoom(roomId: string): Promise<GuestRoomDraftSubmitResponse> {
  const response = await listMyGuestRoomDrafts();
  const draft = response.drafts.find((candidate) => candidate.roomId === roomId && candidate.status === 'active');
  if (!draft) {
    throw new Error('No saved guest draft was found for this room.');
  }

  return submitGuestRoomDraft(draft.id);
}

function appendGuestRecoveryHeaders(headers: Headers): void {
  const identity = resolveWorldPresenceGuestIdentity();
  headers.set('X-Guest-User-Id', identity.userId);
  headers.set('X-Guest-Recovery-Token', resolveGuestRecoveryToken());
}
