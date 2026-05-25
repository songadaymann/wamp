import {
  cloneRoomSnapshot,
  isRoomSnapshotBlank,
  roomIdFromCoordinates,
  type RoomSnapshot,
} from '../../../persistence/roomModel';
import type {
  GuestRoomDraftGetResponse,
  GuestRoomDraftListResponse,
  GuestRoomDraftSaveRequestBody,
  GuestRoomDraftSaveResponse,
  GuestRoomDraftSubmitResponse,
} from '../../../guestRooms/model';
import {
  HttpError,
  isRoomSnapshot,
  jsonResponse,
  parseJsonBody,
} from '../core/http';
import type { Env } from '../core/types';
import {
  listOwnedGuestRoomDrafts,
  listSubmittedGuestRoomDrafts,
  loadOwnedGuestRoomDraft,
  submitOwnedGuestRoomDraft,
  upsertGuestRoomDraft,
} from './store';

const MAX_GUEST_ROOM_SNAPSHOT_JSON_BYTES = 512_000;

interface GuestRecoveryIdentity {
  guestUserId: string;
  recoveryTokenHash: string;
}

export async function handleGuestRoomDraftRequest(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  if (url.pathname === '/api/guest-room-drafts/mine' && request.method === 'GET') {
    const identity = await resolveGuestRecoveryIdentityFromHeaders(request);
    const responseBody: GuestRoomDraftListResponse = {
      drafts: await listOwnedGuestRoomDrafts(env, identity.guestUserId, identity.recoveryTokenHash),
    };
    return jsonResponse(request, responseBody);
  }

  if (url.pathname === '/api/guest-room-drafts/submitted' && request.method === 'GET') {
    const limit = parseLimit(url.searchParams.get('limit'), 48, 1, 100);
    const responseBody: GuestRoomDraftListResponse = {
      drafts: await listSubmittedGuestRoomDrafts(env, limit),
    };
    return jsonResponse(request, responseBody);
  }

  const submitMatch = /^\/api\/guest-room-drafts\/([^/]+)\/submit$/.exec(url.pathname);
  if (submitMatch && request.method === 'POST') {
    const identity = await resolveGuestRecoveryIdentityFromHeaders(request);
    const draft = await submitOwnedGuestRoomDraft(env, {
      draftId: normalizeDraftId(decodeURIComponent(submitMatch[1])),
      guestUserId: identity.guestUserId,
      recoveryTokenHash: identity.recoveryTokenHash,
      nowIso: new Date().toISOString(),
    });
    if (!draft) {
      throw new HttpError(404, 'Guest room draft not found.');
    }

    const responseBody: GuestRoomDraftSubmitResponse = { draft };
    return jsonResponse(request, responseBody);
  }

  const draftMatch = /^\/api\/guest-room-drafts\/([^/]+)$/.exec(url.pathname);
  if (draftMatch && request.method === 'GET') {
    const identity = await resolveGuestRecoveryIdentityFromHeaders(request);
    const draft = await loadOwnedGuestRoomDraft(env, {
      draftId: normalizeDraftId(decodeURIComponent(draftMatch[1])),
      guestUserId: identity.guestUserId,
      recoveryTokenHash: identity.recoveryTokenHash,
    });
    if (!draft) {
      throw new HttpError(404, 'Guest room draft not found.');
    }

    const responseBody: GuestRoomDraftGetResponse = { draft };
    return jsonResponse(request, responseBody);
  }

  if (draftMatch && request.method === 'PUT') {
    const roomId = decodeURIComponent(draftMatch[1]);
    const body = await parseJsonBody<GuestRoomDraftSaveRequestBody>(request);
    const guestUserId = normalizeGuestUserId(body.guestUserId);
    const guestDisplayName = normalizeDisplayName(body.guestDisplayName);
    const recoveryTokenHash = await hashRecoveryToken(normalizeRecoveryToken(body.recoveryToken));
    const snapshot = normalizeSnapshot(roomId, body.snapshot);
    if (isRoomSnapshotBlank(snapshot)) {
      throw new HttpError(400, 'Blank guest room drafts are not saved.');
    }

    const snapshotJson = JSON.stringify(snapshot);
    if (new TextEncoder().encode(snapshotJson).byteLength > MAX_GUEST_ROOM_SNAPSHOT_JSON_BYTES) {
      throw new HttpError(413, 'Guest room draft is too large.');
    }

    const draft = await upsertGuestRoomDraft(env, {
      guestUserId,
      guestDisplayName,
      recoveryTokenHash,
      snapshot,
      nowIso: new Date().toISOString(),
    });
    const responseBody: GuestRoomDraftSaveResponse = { draft };
    return jsonResponse(request, responseBody);
  }

  throw new HttpError(404, 'Guest room draft route not found.');
}

async function resolveGuestRecoveryIdentityFromHeaders(request: Request): Promise<GuestRecoveryIdentity> {
  const guestUserId = normalizeGuestUserId(request.headers.get('X-Guest-User-Id'));
  const recoveryToken = normalizeRecoveryToken(request.headers.get('X-Guest-Recovery-Token'));
  return {
    guestUserId,
    recoveryTokenHash: await hashRecoveryToken(recoveryToken),
  };
}

function normalizeSnapshot(roomId: string, value: unknown): RoomSnapshot {
  if (!isRoomSnapshot(value)) {
    throw new HttpError(400, 'snapshot must be a room snapshot.');
  }

  const canonicalRoomId = roomIdFromCoordinates(value.coordinates);
  if (roomId !== canonicalRoomId || value.id !== canonicalRoomId) {
    throw new HttpError(400, 'Room id must match snapshot coordinates.');
  }

  const snapshot = cloneRoomSnapshot(value);
  snapshot.status = 'draft';
  snapshot.publishedAt = null;
  return snapshot;
}

function normalizeGuestUserId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'guestUserId is required.');
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith('guest-') || trimmed.length > 80) {
    throw new HttpError(400, 'guestUserId must be a guest identity.');
  }
  return trimmed;
}

function normalizeDisplayName(value: unknown): string {
  if (typeof value !== 'string') {
    return 'Guest';
  }

  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed.slice(0, 48) : 'Guest';
}

function normalizeRecoveryToken(value: unknown): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'recoveryToken is required.');
  }

  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(trimmed)) {
    throw new HttpError(400, 'recoveryToken is invalid.');
  }
  return trimmed;
}

function normalizeDraftId(value: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(trimmed)) {
    throw new HttpError(400, 'Guest room draft id is invalid.');
  }
  return trimmed;
}

function parseLimit(value: string | null, defaultValue: number, min: number, max: number): number {
  if (value === null || value.trim() === '') {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new HttpError(400, `limit must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

async function hashRecoveryToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
