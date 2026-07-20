import { describe, expect, it } from 'vitest';
import { createDefaultRoomSnapshot } from './roomModel';
import {
  computeCompactWorldChunkWindow,
  computeWorldChunkWindow,
  createClaimedUnpublishedRoomSummary,
  createPublishedRoomSummary,
} from './worldModel';

describe('compact world chunks', () => {
  it('preserves legacy room summary ordering and preview hashes without embedding snapshots', () => {
    const published = {
      ...createDefaultRoomSnapshot('0,0', { x: 0, y: 0 }),
      version: 7,
      status: 'published' as const,
      updatedAt: '2026-07-18T01:00:00.000Z',
      publishedAt: '2026-07-18T01:00:00.000Z',
    };
    const claimed = {
      ...createDefaultRoomSnapshot('1,0', { x: 1, y: 0 }),
      version: 2,
      updatedAt: '2026-07-18T02:00:00.000Z',
    };
    const bounds = { minChunkX: 0, maxChunkX: 0, minChunkY: 0, maxChunkY: 0 };
    const legacy = computeWorldChunkWindow([
      { state: 'published', snapshot: published, creatorUserId: 'builder', creatorDisplayName: 'Builder' },
      { state: 'claimed_unpublished', snapshot: claimed, claimerUserId: 'draft-builder', claimerDisplayName: 'Draft Builder' },
    ], bounds);
    const compact = computeCompactWorldChunkWindow([
      { ...createPublishedRoomSummary(published), creatorUserId: 'builder', creatorDisplayName: 'Builder' },
      { ...createClaimedUnpublishedRoomSummary(claimed), creatorUserId: 'draft-builder', creatorDisplayName: 'Draft Builder' },
    ], bounds);

    expect(compact.chunks[0]?.rooms.map((room) => room.id)).toEqual(
      legacy.chunks[0]?.rooms.map((room) => room.id),
    );
    expect(compact.chunks[0]?.chunkPreviewHash).toBe(legacy.chunks[0]?.chunkPreviewHash);
    expect(compact).not.toHaveProperty('chunks.0.previewRooms');
  });
});
