import { describe, expect, it } from 'vitest';
import type { RoomDiscoveryEntry } from '../../../runs/model';
import { compareRoomDiscoveryEntries, encodeRoomDiscoveryCursor } from './difficulty';

function entry(overrides: Partial<RoomDiscoveryEntry>): RoomDiscoveryEntry {
  return {
    roomId: 'room',
    roomCoordinates: { x: 0, y: 0 },
    roomTitle: 'Room',
    builderUserId: 'builder',
    builderDisplayName: 'Builder',
    builderLevel: 1,
    builderTotalBxp: 0,
    roomVersion: 1,
    displayRoomVersion: 1,
    leaderboardSourceVersion: null,
    canonicalRoomVersion: null,
    goalType: 'reach_exit',
    consensusDifficulty: null,
    voteCount: 0,
    quality: { adjustedAverage: null, rawAverage: null, voteCount: 0, weightedVoteCount: 0, counts: { oneStar: 0, twoStar: 0, threeStar: 0, fourStar: 0, fiveStar: 0 } },
    trophy: null,
    publishedAt: '2026-01-01T00:00:00.000Z',
    firstPublishedAt: '2026-01-01T00:00:00.000Z',
    featured: false,
    featuredAt: null,
    viewerState: null,
    expandedRoom: null,
    ...overrides,
  };
}

describe('room discovery ordering', () => {
  it('orders newest by first publication with republish as the tie breaker', () => {
    const rows = [
      entry({ roomId: 'old-republished', firstPublishedAt: '2026-01-01T00:00:00.000Z', publishedAt: '2026-07-17T00:00:00.000Z' }),
      entry({ roomId: 'new', firstPublishedAt: '2026-07-01T00:00:00.000Z', publishedAt: '2026-07-01T00:00:00.000Z' }),
    ].sort((left, right) => compareRoomDiscoveryEntries(left, right, 'newest'));
    expect(rows.map((row) => row.roomId)).toEqual(['new', 'old-republished']);
  });

  it('prioritizes featured time, then quality', () => {
    const rows = [
      entry({ roomId: 'quality', quality: { adjustedAverage: 4.9, rawAverage: 5, voteCount: 10, weightedVoteCount: 10, counts: { oneStar: 0, twoStar: 0, threeStar: 0, fourStar: 1, fiveStar: 9 } } }),
      entry({ roomId: 'featured', featured: true, featuredAt: '2026-07-17T00:00:00.000Z' }),
    ].sort((left, right) => compareRoomDiscoveryEntries(left, right, 'featured'));
    expect(rows[0]?.roomId).toBe('featured');
  });

  it('emits deterministic opaque cursors for stable sort pages', () => {
    expect(encodeRoomDiscoveryCursor('newest', 48)).toBe(
      encodeRoomDiscoveryCursor('newest', 48),
    );
    expect(encodeRoomDiscoveryCursor('newest', 48)).not.toContain('{');
    expect(encodeRoomDiscoveryCursor('quality', 48)).not.toBe(
      encodeRoomDiscoveryCursor('newest', 48),
    );
  });
});
