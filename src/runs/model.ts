import type { RoomCoordinates } from '../persistence/roomModel';
import type { RoomGoal, RoomGoalType } from '../goals/roomGoals';
import type { RankedRunVerificationTrace } from './verificationTrace';
import type {
  QualityRatingSummary,
  RoomRatingRequestBody,
  RoomRatingResponse,
  TrophyAwardSummary,
  ViewerRatingSummary,
} from '../progression/model';

export type RunResult = 'active' | 'completed' | 'failed' | 'abandoned';
export type LeaderboardRankingMode = 'time' | 'score';
export const ROOM_DIFFICULTIES = ['easy', 'medium', 'hard', 'extreme'] as const;
export type RoomDifficulty = typeof ROOM_DIFFICULTIES[number];
export const ROOM_DISCOVERY_SORTS = ['featured', 'quality', 'newest', 'builder'] as const;
export type RoomDiscoverySort = typeof ROOM_DISCOVERY_SORTS[number];
export const ROOM_RUSH_DIFFICULTIES = ['easy', 'hard'] as const;
export type RoomRushDifficulty = typeof ROOM_RUSH_DIFFICULTIES[number];
export const ROOM_RUSH_START_RULES = ['selected', 'origin'] as const;
export type RoomRushStartRule = typeof ROOM_RUSH_START_RULES[number];
export type RoomRushLeaderboardModeKey =
  `${RoomRushDifficulty}:${RoomRushStartRule}`;

export const ROOM_DIFFICULTY_LABELS: Record<RoomDifficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  extreme: 'Extreme',
};

export interface RunStartRequestBody {
  roomId: string;
  roomCoordinates: RoomCoordinates;
  roomVersion: number;
  goal: RoomGoal;
  startedAt?: string | null;
}

export interface RunStartResponse {
  attemptId: string;
  roomId: string;
  roomVersion: number;
  goalType: RoomGoalType;
  startedAt: string;
  userId: string;
  userDisplayName: string;
  verificationSchemaVersion: number;
  verificationNonce: string;
  snapshotHash: string;
}

export interface RunFinishRequestBody {
  result: Exclude<RunResult, 'active'>;
  elapsedMs: number;
  deaths: number;
  collectiblesCollected: number;
  enemyCollectiblesCollected: number;
  enemiesDefeated: number;
  checkpointsReached: number;
  score?: number | null;
  finishedAt?: string | null;
  verificationTrace?: RankedRunVerificationTrace | null;
}

export interface RoomRunRecord {
  attemptId: string;
  roomId: string;
  roomCoordinates: RoomCoordinates;
  roomVersion: number;
  goalType: RoomGoalType;
  goal: RoomGoal;
  userId: string;
  userDisplayName: string;
  startedAt: string;
  finishedAt: string | null;
  result: RunResult;
  elapsedMs: number | null;
  deaths: number;
  score: number;
  collectiblesCollected: number;
  enemiesDefeated: number;
  checkpointsReached: number;
  verificationStatus?: 'not_required' | 'passed' | 'failed' | 'timeout';
  verificationReason?: string | null;
  verificationNonce?: string | null;
  verificationSnapshotHash?: string | null;
}

export interface RoomLeaderboardEntry {
  rank: number;
  userId: string;
  userDisplayName: string;
  attemptId: string;
  roomId: string;
  roomVersion: number;
  goalType: RoomGoalType;
  elapsedMs: number;
  deaths: number;
  score: number;
  finishedAt: string;
}

export interface RoomDifficultyCounts {
  easy: number;
  medium: number;
  hard: number;
  extreme: number;
}

export interface RoomDifficultySummary {
  consensus: RoomDifficulty | null;
  counts: RoomDifficultyCounts;
  totalVotes: number;
  viewerVote: RoomDifficulty | null;
  viewerSignedIn: boolean;
  viewerCanVote: boolean;
  viewerNeedsRun: boolean;
}

export interface RoomLeaderboardResponse {
  roomId: string;
  roomCoordinates: RoomCoordinates;
  roomTitle: string | null;
  roomVersion: number;
  displayRoomVersion: number;
  equivalentRoomVersions: number[];
  leaderboardFamilyVersions: number[];
  leaderboardSourceVersion: number | null;
  canonicalRoomVersion: number | null;
  goalType: RoomGoalType;
  rankingMode: LeaderboardRankingMode;
  difficulty: RoomDifficultySummary;
  quality: QualityRatingSummary;
  viewerRating: ViewerRatingSummary | null;
  trophy: TrophyAwardSummary | null;
  entries: RoomLeaderboardEntry[];
  viewerBest: RoomLeaderboardEntry | null;
  viewerRank: number | null;
}

export interface RoomDifficultyVoteRequestBody {
  roomCoordinates: RoomCoordinates;
  roomVersion: number;
  difficulty: RoomDifficulty;
}

export interface RoomDiscoveryEntry {
  roomId: string;
  roomCoordinates: RoomCoordinates;
  roomTitle: string | null;
  builderUserId: string | null;
  builderDisplayName: string | null;
  builderLevel: number | null;
  builderTotalBxp: number | null;
  roomVersion: number;
  displayRoomVersion: number;
  leaderboardSourceVersion: number | null;
  canonicalRoomVersion: number | null;
  goalType: RoomGoalType;
  consensusDifficulty: RoomDifficulty | null;
  voteCount: number;
  quality: QualityRatingSummary;
  trophy: TrophyAwardSummary | null;
  publishedAt: string | null;
  firstPublishedAt: string | null;
  featured: boolean;
  featuredAt: string | null;
}

export interface RoomDiscoveryResponse {
  difficultyFilter: RoomDifficulty | null;
  sort: RoomDiscoverySort;
  results: RoomDiscoveryEntry[];
}

export type RoomProgressRatingRequestBody = RoomRatingRequestBody;
export type RoomProgressRatingResponse = RoomRatingResponse;

export interface GlobalLeaderboardEntry {
  rank: number;
  userId: string;
  userDisplayName: string;
  totalPoints: number;
  totalScore: number;
  totalRoomsPublished: number;
  completedRuns: number;
  failedRuns: number;
  abandonedRuns: number;
  bestScore: number;
  fastestClearMs: number | null;
  updatedAt: string;
}

export interface GlobalLeaderboardResponse {
  entries: GlobalLeaderboardEntry[];
  viewerEntry: GlobalLeaderboardEntry | null;
}

export interface RoomRushRouteStepRecord {
  routeIndex: number;
  roomId: string;
  coordinates: RoomCoordinates;
  uniqueVisitIndex: number;
}

export interface RoomRushRunSubmissionRequestBody {
  clientRunId: string;
  difficulty: RoomRushDifficulty;
  startRule: RoomRushStartRule;
  result: Exclude<RunResult, 'active' | 'abandoned'>;
  elapsedMs: number;
  deaths: number;
  visitedRoomIds: string[];
  route: RoomRushRouteStepRecord[];
  startCoordinates: RoomCoordinates;
  finishCoordinates: RoomCoordinates;
  finishedAt?: string | null;
}

export interface RoomRushRunSubmissionResponse {
  saved: boolean;
  attemptId: string;
}

export interface RoomRushLeaderboardEntry {
  rank: number;
  attemptId: string;
  userId: string;
  userDisplayName: string;
  difficulty: RoomRushDifficulty;
  startRule: RoomRushStartRule;
  result: Exclude<RunResult, 'active' | 'abandoned'>;
  uniqueRooms: number;
  elapsedMs: number;
  deaths: number;
  startRoomId: string;
  startCoordinates: RoomCoordinates;
  finishRoomId: string;
  finishCoordinates: RoomCoordinates;
  finishedAt: string;
}

export interface RoomRushLeaderboardResponse {
  difficulty: RoomRushDifficulty;
  startRule: RoomRushStartRule;
  modeKey: RoomRushLeaderboardModeKey;
  entries: RoomRushLeaderboardEntry[];
  viewerBest: RoomRushLeaderboardEntry | null;
  viewerRank: number | null;
}

export interface RoomRushLeaderboardsResponse {
  modes: RoomRushLeaderboardResponse[];
}

export interface UserStatsRecord {
  userId: string;
  userDisplayName: string;
  totalPoints: number;
  totalScore: number;
  totalDeaths: number;
  totalCollectibles: number;
  totalEnemiesDefeated: number;
  totalCheckpoints: number;
  totalRoomsPublished: number;
  completedRuns: number;
  failedRuns: number;
  abandonedRuns: number;
  bestScore: number;
  fastestClearMs: number | null;
  updatedAt: string;
}

export function normalizeRoomDifficulty(value: unknown): RoomDifficulty | null {
  return typeof value === 'string' && ROOM_DIFFICULTIES.includes(value as RoomDifficulty)
    ? (value as RoomDifficulty)
    : null;
}

export function normalizeRoomDiscoverySort(value: unknown): RoomDiscoverySort | null {
  return typeof value === 'string' && ROOM_DISCOVERY_SORTS.includes(value as RoomDiscoverySort)
    ? (value as RoomDiscoverySort)
    : null;
}
