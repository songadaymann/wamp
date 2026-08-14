import type { RoomSnapshot } from '../persistence/roomModel';
import type { RoomPreviewPayload, SharedRoomPreview } from './presenceProtocol';
import { roomIdFromPresenceCoordinates } from './presencePopulation';

export const ROOM_PREVIEW_STORAGE_PREFIX = 'preview:';
export const ROOM_PREVIEW_TTL_MS = 120_000;

export interface PreviewOwnerIdentity {
  userId: string;
  displayName: string;
}

export function roomPreviewStorageKey(roomId: string): string {
  return `${ROOM_PREVIEW_STORAGE_PREFIX}${roomId}`;
}

export function isRoomPreviewExpired(
  preview: Pick<RoomPreviewPayload, 'timestamp'>,
  now: number,
): boolean {
  return now - preview.timestamp > ROOM_PREVIEW_TTL_MS;
}

export function normalizeRoomPreviewPayload(value: unknown): RoomPreviewPayload | null {
  if (!value || typeof value !== 'object') return null;

  const payload = value as Partial<RoomPreviewPayload>;
  if (
    !payload.roomCoordinates ||
    !Number.isInteger(payload.roomCoordinates.x) ||
    !Number.isInteger(payload.roomCoordinates.y) ||
    typeof payload.timestamp !== 'number' ||
    !Number.isFinite(payload.timestamp) ||
    !payload.snapshot ||
    typeof payload.snapshot !== 'object'
  ) {
    return null;
  }

  const snapshot = payload.snapshot as Partial<RoomSnapshot>;
  if (
    typeof snapshot.id !== 'string' ||
    !snapshot.coordinates ||
    snapshot.coordinates.x !== payload.roomCoordinates.x ||
    snapshot.coordinates.y !== payload.roomCoordinates.y
  ) {
    return null;
  }

  try {
    if (JSON.stringify(payload.snapshot).length > 120_000) return null;
  } catch {
    return null;
  }

  return {
    roomCoordinates: {
      x: payload.roomCoordinates.x,
      y: payload.roomCoordinates.y,
    },
    snapshot: payload.snapshot as RoomSnapshot,
    timestamp: payload.timestamp,
    ...(typeof payload.constructionPreviewToken === 'string' &&
    payload.constructionPreviewToken.trim().length > 0 &&
    payload.constructionPreviewToken.length <= 2048
      ? { constructionPreviewToken: payload.constructionPreviewToken.trim() }
      : {}),
  };
}

export function toSharedRoomPreview(
  preview: RoomPreviewPayload,
  owner: PreviewOwnerIdentity,
  shardId: string,
  timestamp = preview.timestamp,
): SharedRoomPreview {
  const { constructionPreviewToken: _token, ...sharedPreview } = preview;
  return {
    ...sharedPreview,
    roomId: roomIdFromPresenceCoordinates(preview.roomCoordinates),
    userId: owner.userId,
    displayName: owner.displayName,
    shardId,
    timestamp,
  };
}

export function normalizeStoredSharedPreview(value: unknown): SharedRoomPreview | null {
  if (!value || typeof value !== 'object') return null;

  const preview = value as Partial<SharedRoomPreview>;
  if (
    typeof preview.roomId !== 'string' ||
    typeof preview.userId !== 'string' ||
    typeof preview.displayName !== 'string' ||
    typeof preview.shardId !== 'string'
  ) {
    return null;
  }

  const normalizedPayload = normalizeRoomPreviewPayload(preview);
  if (!normalizedPayload) return null;

  return {
    ...toSharedRoomPreview(
    normalizedPayload,
    { userId: preview.userId, displayName: preview.displayName },
    preview.shardId,
    ),
    roomId: preview.roomId,
  };
}

export function collectLatestRoomPreviews(
  persistedPreviews: Iterable<SharedRoomPreview>,
  activePreviews: Iterable<SharedRoomPreview>,
  now: number,
): Record<string, SharedRoomPreview> {
  const previewsByRoomId = new Map<string, SharedRoomPreview>();
  for (const preview of persistedPreviews) {
    if (!isRoomPreviewExpired(preview, now)) previewsByRoomId.set(preview.roomId, preview);
  }
  for (const preview of activePreviews) {
    if (isRoomPreviewExpired(preview, now)) continue;
    const existing = previewsByRoomId.get(preview.roomId) ?? null;
    if (!existing || preview.timestamp >= existing.timestamp) {
      previewsByRoomId.set(preview.roomId, preview);
    }
  }
  return Object.fromEntries(
    Array.from(previewsByRoomId.entries()).sort(([left], [right]) => left.localeCompare(right)),
  );
}
