import { apiRequest } from '../api/request';
import { getApiBaseUrl } from '../api/baseUrl';
import { readApiErrorMessage } from '../api/readApiErrorMessage';
import { resolveWorldPresenceGuestIdentity } from '../presence/worldPresence';
import type { RoomSnapshot } from '../persistence/roomModel';
import { resolveGuestRecoveryToken } from './identity';
import type {
  GuestRoomDraftGetResponse,
  GuestRoomDraftListResponse,
  GuestRoomDraftSaveRequestBody,
  GuestRoomDraftSaveResponse,
  GuestRoomDraftSubmitResponse,
  GuestRoomDraftClaimBody,
  GuestRoomDraftClaimResponse,
} from './model';
import { captureGuestRunIdentity, type GuestRunRecoveryIdentity } from './runRepository';

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

export function listMyGuestRoomDrafts(identity = captureGuestRunIdentity()): Promise<GuestRoomDraftListResponse> {
  return apiRequest<GuestRoomDraftListResponse>('/api/guest-room-drafts/mine', {
    credentials: 'omit',
    prepareHeaders: headers => appendGuestRecoveryHeaders(headers, identity),
    signal: AbortSignal.timeout(15_000),
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

export class GuestRoomDraftApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function claimGuestRoomDraft(draftId: string, body: GuestRoomDraftClaimBody,
  identity: GuestRunRecoveryIdentity = captureGuestRunIdentity()): Promise<GuestRoomDraftClaimResponse> {
  const headers = new Headers({ 'Content-Type': 'application/json' }); appendGuestRecoveryHeaders(headers, identity);
  const response = await fetch(`${getApiBaseUrl()}/api/guest-room-drafts/${encodeURIComponent(draftId)}/claim`, {
    method: 'POST', headers, credentials: 'include', body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 409) {
    const data = await response.clone().json().catch(() => null) as GuestRoomDraftClaimResponse | null;
    if (data?.outcome === 'conflict') return data;
  }
  if (!response.ok) throw new GuestRoomDraftApiError(response.status, await readApiErrorMessage(response, 'Your guest draft is still saved. Try again.'));
  return response.json() as Promise<GuestRoomDraftClaimResponse>;
}

function appendGuestRecoveryHeaders(headers: Headers, identity: GuestRunRecoveryIdentity = captureGuestRunIdentity()): void {
  headers.set('X-Guest-User-Id', identity.guestUserId);
  headers.set('X-Guest-Recovery-Token', identity.recoveryToken);
}
