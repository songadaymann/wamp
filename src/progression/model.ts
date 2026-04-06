export const PROGRESSION_DIFFICULTIES = ['easy', 'medium', 'hard', 'extreme'] as const;
export type ProgressionDifficulty = typeof PROGRESSION_DIFFICULTIES[number];

export type TrustTier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4';
export type ProgressionLane = 'player' | 'builder' | 'curator';
export type ProgressionBadgeCategory = 'founder' | 'player' | 'builder' | 'curator';
export type TrophyContentType = 'room' | 'course';

export interface ProgressionDifficultyCounts {
  easy: number;
  medium: number;
  hard: number;
  extreme: number;
}

export interface ProgressionQualityCounts {
  oneStar: number;
  twoStar: number;
  threeStar: number;
  fourStar: number;
  fiveStar: number;
}

export interface ProgressionDelta {
  pxp: number;
  bxp: number;
  cxp: number;
  trust: number;
}

export interface ProgressionLaneSummary {
  lane: ProgressionLane;
  xp: number;
  level: number;
  currentLevelStartXp: number;
  nextLevelXp: number;
  progressFraction: number;
  medalLabel: string;
  medalTint: string;
  emblem: string;
  crown: boolean;
  ribbons: number;
}

export interface BadgeAwardSummary {
  badgeId: string;
  category: ProgressionBadgeCategory;
  label: string;
  description: string;
  awardedAt: string;
}

export interface TrophyAwardSummary {
  contentType: TrophyContentType;
  contentId: string;
  versionKey: number;
  trophyType: string;
  awardedAt: string;
}

export interface ProgressionSummary {
  founderNumber: number | null;
  player: ProgressionLaneSummary;
  builder: ProgressionLaneSummary;
  curator: ProgressionLaneSummary;
  builderCaps: BuilderCapabilitySummary;
  featuredBadges: BadgeAwardSummary[];
  badgeCount: number;
  trophyCount: number;
  recentTrophies: TrophyAwardSummary[];
}

export interface BuilderCapabilitySummary {
  trustTier: TrustTier;
  claimLimitPerDay: number;
  publishLimitPerDay: number;
  objectLimit: number;
  collectibleLimit: number;
  overrideActive: boolean;
}

export interface ViewerRatingSummary {
  qualityStars: number | null;
  difficultyChoice: ProgressionDifficulty | null;
  autoSuggestedDifficulty: ProgressionDifficulty | null;
  updatedAt: string | null;
}

export interface QualityRatingSummary {
  adjustedAverage: number | null;
  rawAverage: number | null;
  voteCount: number;
  weightedVoteCount: number;
  counts: ProgressionQualityCounts;
}

export interface DifficultyRatingSummary {
  consensus: ProgressionDifficulty | null;
  counts: ProgressionDifficultyCounts;
  totalVotes: number;
  viewerVote: ProgressionDifficulty | null;
  viewerSignedIn: boolean;
  viewerCanVote: boolean;
  viewerNeedsRun: boolean;
}

export interface RatingAggregateSummary {
  quality: QualityRatingSummary;
  difficulty: DifficultyRatingSummary;
  viewerRating: ViewerRatingSummary | null;
  trophy: TrophyAwardSummary | null;
}

export interface RoomRatingRequestBody {
  roomCoordinates: { x: number; y: number };
  roomVersion: number;
  qualityStars: number | null;
  difficultyChoice: ProgressionDifficulty | null;
  autoSuggestedDifficulty: ProgressionDifficulty | null;
}

export interface CourseRatingRequestBody {
  courseVersion: number;
  qualityStars: number | null;
  difficultyChoice: ProgressionDifficulty | null;
  autoSuggestedDifficulty: ProgressionDifficulty | null;
}

export interface RoomRatingResponse {
  ok: true;
  roomId: string;
  roomVersion: number;
  progressionDelta: ProgressionDelta;
  summary: RatingAggregateSummary;
  progression: ProgressionSummary;
}

export interface CourseRatingResponse {
  ok: true;
  courseId: string;
  courseVersion: number;
  progressionDelta: ProgressionDelta;
  summary: RatingAggregateSummary;
  progression: ProgressionSummary;
}
