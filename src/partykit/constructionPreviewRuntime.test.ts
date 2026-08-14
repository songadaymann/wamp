import { describe, expect, it } from 'vitest';
import { createDefaultRoomSnapshot } from '../persistence/roomModel';
import {
  collectLatestRoomPreviews,
  isRoomPreviewExpired,
  normalizeRoomPreviewPayload,
  normalizeStoredSharedPreview,
  ROOM_PREVIEW_TTL_MS,
  roomPreviewStorageKey,
  toSharedRoomPreview,
} from './constructionPreviewRuntime';

describe('construction preview runtime', () => {
  it('normalizes valid payloads, trims bounded tokens, and rejects mismatched or oversized data', () => {
    const payload = roomPreview(1, 2, 10, ' token ');
    expect(normalizeRoomPreviewPayload(payload)).toMatchObject({
      roomCoordinates: { x: 1, y: 2 },
      constructionPreviewToken: 'token',
    });
    expect(normalizeRoomPreviewPayload({ ...payload, roomCoordinates: { x: 2, y: 2 } })).toBeNull();
    expect(normalizeRoomPreviewPayload({ ...payload, timestamp: Number.NaN })).toBeNull();
    expect(
      normalizeRoomPreviewPayload({
        ...payload,
        snapshot: { ...payload.snapshot, title: 'x'.repeat(120_001) },
      }),
    ).toBeNull();
    expect(
      normalizeRoomPreviewPayload({ ...payload, constructionPreviewToken: 'x'.repeat(2049) }),
    ).not.toHaveProperty('constructionPreviewToken');
  });

  it('creates shared storage/output records without leaking the authorization token', () => {
    const shared = toSharedRoomPreview(
      roomPreview(3, 4, 10, 'secret'),
      { userId: 'user', displayName: 'Editor' },
      'shard',
      20,
    );
    expect(shared).toMatchObject({ roomId: '3,4', userId: 'user', shardId: 'shard', timestamp: 20 });
    expect(shared).not.toHaveProperty('constructionPreviewToken');
    expect(roomPreviewStorageKey('3,4')).toBe('preview:3,4');

    expect(normalizeStoredSharedPreview({ ...shared, constructionPreviewToken: 'stored-secret' }))
      .toEqual(shared);
    expect(normalizeStoredSharedPreview({ ...shared, roomId: 'legacy-storage-id' }))
      .toMatchObject({ roomId: 'legacy-storage-id', roomCoordinates: { x: 3, y: 4 } });
  });

  it('keeps the exact TTL boundary and chooses the newest active preview per sorted room id', () => {
    const now = 500_000;
    const boundary = sharedPreview(2, 2, now - ROOM_PREVIEW_TTL_MS, 'boundary');
    const expired = sharedPreview(3, 3, now - ROOM_PREVIEW_TTL_MS - 1, 'expired');
    const older = sharedPreview(1, 1, now - 20, 'older');
    const newer = sharedPreview(1, 1, now - 10, 'newer');

    expect(isRoomPreviewExpired(boundary, now)).toBe(false);
    expect(isRoomPreviewExpired(expired, now)).toBe(true);
    expect(collectLatestRoomPreviews([boundary, expired, older], [newer], now)).toEqual({
      '1,1': newer,
      '2,2': boundary,
    });
  });
});

function roomPreview(x: number, y: number, timestamp: number, constructionPreviewToken?: string) {
  const roomId = `${x},${y}`;
  return {
    roomCoordinates: { x, y },
    snapshot: createDefaultRoomSnapshot(roomId, { x, y }),
    timestamp,
    ...(constructionPreviewToken ? { constructionPreviewToken } : {}),
  };
}

function sharedPreview(x: number, y: number, timestamp: number, displayName: string) {
  return toSharedRoomPreview(
    roomPreview(x, y, timestamp),
    { userId: `user-${displayName}`, displayName },
    'shard',
  );
}
