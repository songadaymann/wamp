import type { BuilderDiscoveryEntry, BuilderDiscoverySort, RoomDifficulty, RoomDifficultyCounts, RoomDiscoveryEntry, RoomDiscoverySort } from '../../../runs/model';
import {
  normalizeBuilderDiscoverySort,
  normalizeRoomDifficulty,
  normalizeRoomDiscoverySort,
  ROOM_DIFFICULTIES,
} from '../../../runs/model';
import { HttpError } from '../core/http';

export function createEmptyRoomDifficultyCounts(): RoomDifficultyCounts {
  return {
    easy: 0,
    medium: 0,
    hard: 0,
    extreme: 0,
  };
}

export function getRoomDifficultyVoteTotal(counts: RoomDifficultyCounts): number {
  return counts.easy + counts.medium + counts.hard + counts.extreme;
}

export function resolveRoomDifficultyConsensus(
  counts: RoomDifficultyCounts,
): RoomDifficulty | null {
  let bestDifficulty: RoomDifficulty | null = null;
  let bestCount = 0;
  for (const difficulty of ROOM_DIFFICULTIES) {
    const nextCount = counts[difficulty];
    if (nextCount > bestCount) {
      bestCount = nextCount;
      bestDifficulty = difficulty;
    }
  }

  return bestCount > 0 ? bestDifficulty : null;
}

export function encodeRoomDiscoveryCursor(sort: RoomDiscoverySort, offset: number): string {
  return btoa(JSON.stringify({ version: 1, sort, offset }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function parseRoomDifficultyOrThrow(value: unknown): RoomDifficulty {
  const normalized = normalizeRoomDifficulty(value);
  if (!normalized) {
    throw new HttpError(400, 'difficulty must be easy, medium, hard, or extreme.');
  }

  return normalized;
}

export function parseRoomDiscoverySortOrThrow(value: unknown): RoomDiscoverySort {
  const normalized = normalizeRoomDiscoverySort(value);
  if (!normalized) {
    throw new HttpError(
      400,
      'sort must be featured, quality, newest, builder, unbeaten, unvisited, or unrated.',
    );
  }

  return normalized;
}

export function parseBuilderDiscoverySortOrThrow(value: unknown): BuilderDiscoverySort {
  const normalized = normalizeBuilderDiscoverySort(value);
  if (!normalized) {
    throw new HttpError(400, 'sort must be alphabet, rooms, or recent.');
  }

  return normalized;
}

export function compareRoomDiscoveryEntries(
  left: RoomDiscoveryEntry,
  right: RoomDiscoveryEntry,
  sort: RoomDiscoverySort,
): number {
  if (sort === 'featured') {
    const featuredCompare = compareBooleansDesc(left.featured, right.featured);
    if (featuredCompare !== 0) return featuredCompare;
    const featuredAtCompare = compareTimestampsDesc(left.featuredAt, right.featuredAt);
    if (featuredAtCompare !== 0) return featuredAtCompare;
    const qualityCompare = compareQualityDesc(left, right);
    if (qualityCompare !== 0) return qualityCompare;
    const voteCompare = right.voteCount - left.voteCount;
    if (voteCompare !== 0) return voteCompare;
    return compareTimestampsDesc(left.publishedAt, right.publishedAt);
  }

  if (sort === 'quality') {
    const qualityCompare = compareQualityDesc(left, right);
    if (qualityCompare !== 0) return qualityCompare;
    const voteCompare = right.voteCount - left.voteCount;
    if (voteCompare !== 0) return voteCompare;
    return compareTimestampsDesc(left.publishedAt, right.publishedAt);
  }

  if (sort === 'builder') {
    const builderLevelCompare = (right.builderLevel ?? 0) - (left.builderLevel ?? 0);
    if (builderLevelCompare !== 0) return builderLevelCompare;
    const builderXpCompare = (right.builderTotalBxp ?? 0) - (left.builderTotalBxp ?? 0);
    if (builderXpCompare !== 0) return builderXpCompare;
    const qualityCompare = compareQualityDesc(left, right);
    if (qualityCompare !== 0) return qualityCompare;
    const voteCompare = right.voteCount - left.voteCount;
    if (voteCompare !== 0) return voteCompare;
    const builderCompare = compareNullableStringsAsc(
      left.builderDisplayName,
      right.builderDisplayName,
    );
    if (builderCompare !== 0) return builderCompare;
    const titleCompare = compareNullableStringsAsc(left.roomTitle, right.roomTitle);
    if (titleCompare !== 0) return titleCompare;
    return compareTimestampsDesc(left.publishedAt, right.publishedAt);
  }

  if (isPersonalRoomDiscoverySort(sort)) {
    const featuredCompare = compareBooleansDesc(left.featured, right.featured);
    if (featuredCompare !== 0) return featuredCompare;
    const qualityCompare = compareQualityDesc(left, right);
    if (qualityCompare !== 0) return qualityCompare;
    const voteCompare = right.voteCount - left.voteCount;
    if (voteCompare !== 0) return voteCompare;
    return compareTimestampsDesc(left.publishedAt, right.publishedAt);
  }

  const firstPublishedCompare = compareTimestampsDesc(
    left.firstPublishedAt,
    right.firstPublishedAt,
  );
  if (firstPublishedCompare !== 0) return firstPublishedCompare;
  return compareTimestampsDesc(left.publishedAt, right.publishedAt);
}

export function compareBuilderDiscoveryEntries(
  left: BuilderDiscoveryEntry,
  right: BuilderDiscoveryEntry,
  sort: BuilderDiscoverySort,
): number {
  if (sort === 'rooms') {
    const countCompare = right.roomCount - left.roomCount;
    if (countCompare !== 0) return countCompare;
    const latestCompare = compareTimestampsDesc(
      left.latestPublishedAt,
      right.latestPublishedAt,
    );
    if (latestCompare !== 0) return latestCompare;
    return compareBuilderNames(left, right);
  }

  if (sort === 'recent') {
    const latestCompare = compareTimestampsDesc(
      left.latestPublishedAt,
      right.latestPublishedAt,
    );
    if (latestCompare !== 0) return latestCompare;
    const countCompare = right.roomCount - left.roomCount;
    if (countCompare !== 0) return countCompare;
    return compareBuilderNames(left, right);
  }

  return compareBuilderNames(left, right);
}

export function isPersonalRoomDiscoverySort(sort: RoomDiscoverySort): boolean {
  return sort === 'unbeaten' || sort === 'unvisited' || sort === 'unrated';
}

export function isViewerRoomBuilder(
  entry: RoomDiscoveryEntry,
  viewerUserId: string | null,
): boolean {
  return viewerUserId !== null && entry.builderUserId === viewerUserId;
}

function compareQualityDesc(left: RoomDiscoveryEntry, right: RoomDiscoveryEntry): number {
  const leftQuality = left.quality.adjustedAverage ?? -1;
  const rightQuality = right.quality.adjustedAverage ?? -1;
  return rightQuality !== leftQuality ? rightQuality - leftQuality : 0;
}

function compareTimestampsDesc(left: string | null, right: string | null): number {
  const leftMs = left ? Date.parse(left) : 0;
  const rightMs = right ? Date.parse(right) : 0;
  return rightMs - leftMs;
}

function compareBooleansDesc(left: boolean, right: boolean): number {
  if (left === right) return 0;
  return right ? 1 : -1;
}

function compareNullableStringsAsc(left: string | null, right: string | null): number {
  const leftValue = left?.trim() || '';
  const rightValue = right?.trim() || '';
  if (!leftValue && !rightValue) return 0;
  if (!leftValue) return 1;
  if (!rightValue) return -1;
  return leftValue.localeCompare(rightValue, undefined, { sensitivity: 'base' });
}

function compareBuilderNames(left: BuilderDiscoveryEntry, right: BuilderDiscoveryEntry): number {
  const nameCompare = left.displayName.localeCompare(right.displayName, undefined, {
    sensitivity: 'base',
  });
  return nameCompare !== 0 ? nameCompare : left.userId.localeCompare(right.userId);
}
