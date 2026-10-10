import type { CourseRecord } from '../../../courses/model';
import type { RoomRecord } from '../../../persistence/roomModel';
import { buildCourseRatingWindow, buildRoomRatingWindow } from './ratings';

/**
 * Which published versions count as the same content for a player's clear rewards,
 * and whether the player made it. Versions inside one significant-change window share
 * first-clear, personal-best and creator rewards, so republishing does not reset them.
 * Builders earn no clear points or play XP from their own room; the leaderboard still
 * lists their runs.
 */
export interface ClearRewardScope {
  versions: number[];
  ownContent: boolean;
}

export function resolveRoomClearRewardScope(
  record: Pick<RoomRecord, 'versions' | 'claimerUserId'>,
  roomVersion: number,
  userId: string,
): ClearRewardScope {
  const window = buildRoomRatingWindow(record.versions, roomVersion);
  const publisherUserId = record.versions.find((entry) => entry.version === roomVersion)?.publishedByUserId ?? null;
  return {
    versions: window.versionFamily.includes(roomVersion) ? window.versionFamily : [roomVersion],
    ownContent: userId === record.claimerUserId || userId === publisherUserId,
  };
}

export function resolveCourseClearRewardScope(
  record: Pick<CourseRecord, 'versions'>,
  courseId: string,
  courseVersion: number,
  userId: string,
  ownerUserId: string | null,
): ClearRewardScope {
  const window = buildCourseRatingWindow(record.versions, courseVersion, courseId);
  const publisherUserId = record.versions.find((entry) => entry.version === courseVersion)?.publishedByUserId ?? null;
  return {
    versions: window.versionFamily.includes(courseVersion) ? window.versionFamily : [courseVersion],
    ownContent: userId === ownerUserId || userId === publisherUserId,
  };
}

/** Clear rewards a run may earn once its scope is known; ownership withholds them. */
export function scopeClearRewardFlags(
  scope: ClearRewardScope,
  flags: { isFirstCompletion: boolean; isNewPersonalBest: boolean },
): { isFirstCompletion: boolean; isNewPersonalBest: boolean } {
  return scope.ownContent ? { isFirstCompletion: false, isNewPersonalBest: false } : flags;
}
