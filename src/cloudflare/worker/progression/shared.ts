import { HttpError } from '../core/http';
import {
  type ProgressionDelta,
  type ProgressionDifficulty,
  PROGRESSION_DIFFICULTIES,
  type ProgressionDifficultyCounts,
  type ProgressionLane,
  type ProgressionLaneSummary,
  type ProgressionQualityCounts,
  type TrustTier,
} from '../../../progression/model';

export interface LaneEventConfig {
  table: 'pxp_events' | 'bxp_events' | 'cxp_events' | 'trust_events';
  amount: number;
  eventType: string;
  sourceType: string;
  sourceId: string;
  dedupeKey: string;
  createdAt: string;
  breakdown?: Record<string, unknown> | null;
}

export interface ProgressSeedMetrics {
  roomClearCount: number;
  courseClearCount: number;
  ratingCount: number;
  roomPublishCount: number;
  coursePublishCount: number;
  creatorUniqueCompletionCount: number;
}

export interface RatingWindow {
  versionKey: number;
  lineageKey: string;
  versionFamily: number[];
}

export interface RatingSummaryOptions {
  viewerUserId: string | null;
  viewerCanVote: boolean;
  viewerNeedsRun: boolean;
}

export interface DifficultyAccumulator {
  easy: number;
  medium: number;
  hard: number;
  extreme: number;
}

export const QUALITY_PRIOR_MEAN = 3.5;
export const QUALITY_PRIOR_WEIGHT = 5;
export const TROPHY_THRESHOLD = 4.2;
export const TROPHY_MIN_WEIGHTED_VOTES = 10;
export const ROOM_SIGNIFICANT_CHANGE_THRESHOLD = 0.1;
export const COURSE_SIGNIFICANT_CHANGE_THRESHOLD = 0.1;
export const TRUST_PENALTY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const UTC_WEEK_PREFIX = 'UTC';

export const LANE_BASE_XP = {
  roomClear: 20,
  courseClear: 40,
  ratingPxp: 5,
  roomRatingCxp: 5,
  courseRatingCxp: 7,
  weeklyPlay: 10,
  weeklyCuration: 3,
  dailyPb: 8,
  top10Entry: 10,
  top10Improve: 5,
  top1: 15,
  roomPublish: 25,
  coursePublish: 40,
  uniqueRoomCompletion: 10,
  uniqueCourseCompletion: 16,
  uniqueRating: 5,
} as const;

export function createEmptyProgressionDelta(): ProgressionDelta {
  return {
    pxp: 0,
    bxp: 0,
    cxp: 0,
    trust: 0,
  };
}

export function createEmptyDifficultyCounts(): ProgressionDifficultyCounts {
  return {
    easy: 0,
    medium: 0,
    hard: 0,
    extreme: 0,
  };
}

export function createEmptyQualityCounts(): ProgressionQualityCounts {
  return {
    oneStar: 0,
    twoStar: 0,
    threeStar: 0,
    fourStar: 0,
    fiveStar: 0,
  };
}

export function normalizeDifficulty(value: unknown): ProgressionDifficulty | null {
  return typeof value === 'string' && PROGRESSION_DIFFICULTIES.includes(value as ProgressionDifficulty)
    ? (value as ProgressionDifficulty)
    : null;
}

export function normalizeQualityStars(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 5) {
    throw new HttpError(400, 'qualityStars must be an integer from 1 to 5 or null.');
  }

  return numeric;
}

export function getUtcDayKey(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

export function getUtcWeekKey(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${UTC_WEEK_PREFIX}-${utcDate.getUTCFullYear()}-${String(weekNo).padStart(2, '0')}`;
}

export function xpRequiredForLevel(level: number): number {
  if (level <= 1) {
    return 0;
  }

  return Math.round(Math.pow(level - 1, 2) * 100);
}

export function levelForXp(totalXp: number): number {
  let level = 1;
  while (xpRequiredForLevel(level + 1) <= totalXp) {
    level += 1;
  }

  return level;
}

export function trustTierFromScore(score: number): TrustTier {
  if (score >= 260) {
    return 'T4';
  }
  if (score >= 160) {
    return 'T3';
  }
  if (score >= 90) {
    return 'T2';
  }
  if (score >= 40) {
    return 'T1';
  }
  return 'T0';
}

export function trustWeightFromTier(tier: TrustTier): number {
  switch (tier) {
    case 'T0':
      return 0.6;
    case 'T1':
      return 0.85;
    case 'T2':
      return 1;
    case 'T3':
      return 1.1;
    case 'T4':
      return 1.2;
  }
}

export function builderContributionWeightFromTier(tier: TrustTier): number {
  switch (tier) {
    case 'T0':
      return 0.6;
    case 'T1':
      return 0.8;
    case 'T2':
      return 1;
    case 'T3':
      return 1.1;
    case 'T4':
      return 1.2;
  }
}

export function buildLaneSummary(lane: ProgressionLane, xp: number): ProgressionLaneSummary {
  const level = levelForXp(xp);
  const currentLevelStartXp = xpRequiredForLevel(level);
  const nextLevelXp = xpRequiredForLevel(level + 1);
  const progressFraction =
    nextLevelXp <= currentLevelStartXp
      ? 1
      : Math.max(0, Math.min(1, (xp - currentLevelStartXp) / (nextLevelXp - currentLevelStartXp)));
  const tierIndex =
    level >= 25 ? 4 : level >= 15 ? 3 : level >= 8 ? 2 : level >= 4 ? 1 : 0;
  const tint = ['#9f8163', '#aab5d6', '#d5ba57', '#4db7ac', '#e47f5f'][tierIndex] ?? '#9f8163';
  const labelPrefix =
    lane === 'player' ? 'Player' : lane === 'builder' ? 'Builder' : 'Curator';
  const emblem =
    lane === 'player' ? 'crown' : lane === 'builder' ? 'hammer' : 'star';

  return {
    lane,
    xp,
    level,
    currentLevelStartXp,
    nextLevelXp,
    progressFraction,
    medalLabel: `${labelPrefix} Lv.${level}`,
    medalTint: tint,
    emblem,
    crown: level >= 20,
    ribbons: level >= 12 ? 2 : level >= 6 ? 1 : 0,
  };
}

export function parseRowNumber(value: number | string | null | undefined): number {
  return Number(value ?? 0);
}

export function parseRowFloat(value: number | string | null | undefined): number {
  return Number(value ?? 0);
}

export function createLineageKey(contentId: string, versionKey: number): string {
  return `${contentId}:${versionKey}`;
}

export function roundQuality(value: number): number {
  return Math.round(value * 100) / 100;
}
