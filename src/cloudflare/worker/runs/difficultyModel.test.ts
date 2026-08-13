import { describe, expect, it } from 'vitest';
import type { BuilderDiscoveryEntry, RoomDiscoveryEntry } from '../../../runs/model';
import {
  compareBuilderDiscoveryEntries,
  compareRoomDiscoveryEntries,
  createEmptyRoomDifficultyCounts,
  encodeRoomDiscoveryCursor,
  getRoomDifficultyVoteTotal,
  isPersonalRoomDiscoverySort,
  isViewerRoomBuilder,
  parseBuilderDiscoverySortOrThrow,
  parseRoomDifficultyOrThrow,
  parseRoomDiscoverySortOrThrow,
  resolveRoomDifficultyConsensus,
} from './difficultyModel';

describe('difficulty model', () => {
  it('preserves difficulty totals, tie order, and exact vocabularies', () => {
    expect(createEmptyRoomDifficultyCounts()).toEqual({ easy: 0, medium: 0, hard: 0, extreme: 0 });
    expect(getRoomDifficultyVoteTotal({ easy: 1, medium: 2, hard: 3, extreme: 4 })).toBe(10);
    expect(resolveRoomDifficultyConsensus({ easy: 2, medium: 2, hard: 0, extreme: 0 })).toBe('easy');
    expect(parseRoomDifficultyOrThrow('extreme')).toBe('extreme');
    expect(parseRoomDiscoverySortOrThrow('unrated')).toBe('unrated');
    expect(parseBuilderDiscoverySortOrThrow('rooms')).toBe('rooms');
    expect(() => parseRoomDifficultyOrThrow('impossible')).toThrow(
      'difficulty must be easy, medium, hard, or extreme.',
    );
  });

  it('preserves the opaque cursor and personal-view predicates', () => {
    expect(encodeRoomDiscoveryCursor('newest', 48)).toBe(
      'eyJ2ZXJzaW9uIjoxLCJzb3J0IjoibmV3ZXN0Iiwib2Zmc2V0Ijo0OH0',
    );
    expect(isPersonalRoomDiscoverySort('unbeaten')).toBe(true);
    expect(isPersonalRoomDiscoverySort('quality')).toBe(false);
    expect(isViewerRoomBuilder(roomEntry(), 'builder')).toBe(true);
    expect(isViewerRoomBuilder(roomEntry(), null)).toBe(false);
  });

  it('preserves room and builder ordering tie breakers', () => {
    const featured = roomEntry({ roomId: 'featured', featured: true });
    const quality = roomEntry({
      roomId: 'quality',
      quality: {
        adjustedAverage: 5,
        rawAverage: 5,
        voteCount: 10,
        weightedVoteCount: 10,
        counts: { oneStar: 0, twoStar: 0, threeStar: 0, fourStar: 0, fiveStar: 10 },
      },
      voteCount: 10,
    });
    expect([quality, featured].sort((left, right) => compareRoomDiscoveryEntries(left, right, 'featured')))
      .toEqual([featured, quality]);

    const alpha = builderEntry({ userId: 'alpha', displayName: 'Alpha', roomCount: 1 });
    const prolific = builderEntry({ userId: 'prolific', displayName: 'Zulu', roomCount: 10 });
    expect([alpha, prolific].sort((left, right) => compareBuilderDiscoveryEntries(left, right, 'rooms')))
      .toEqual([prolific, alpha]);
    expect([prolific, alpha].sort((left, right) => compareBuilderDiscoveryEntries(left, right, 'alphabet')))
      .toEqual([alpha, prolific]);
  });
});

function roomEntry(overrides: Partial<RoomDiscoveryEntry> = {}): RoomDiscoveryEntry {
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
    quality: {
      adjustedAverage: null,
      rawAverage: null,
      voteCount: 0,
      weightedVoteCount: 0,
      counts: { oneStar: 0, twoStar: 0, threeStar: 0, fourStar: 0, fiveStar: 0 },
    },
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

function builderEntry(overrides: Partial<BuilderDiscoveryEntry> = {}): BuilderDiscoveryEntry {
  return {
    userId: 'builder',
    displayName: 'Builder',
    username: null,
    roomCount: 1,
    latestPublishedAt: '2026-01-01T00:00:00.000Z',
    firstPublishedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
