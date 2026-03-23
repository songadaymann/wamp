import type { RoomCoordinates } from '../persistence/roomModel';
import type { RoomGoal, RoomGoalType } from '../goals/roomGoals';

export type RunResult = 'active' | 'completed' | 'failed' | 'abandoned';
export type LeaderboardRankingMode = 'time' | 'score';
export const ROOM_DIFFICULTIES = ['easy', 'medium', 'hard', 'extreme'] as const;
export type RoomDifficulty = typeof ROOM_DIFFICULTIES[number];

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
}

export interface RunFinishRequestBody {
  result: Exclude<RunResult, 'active'>;
  elapsedMs: number;
  deaths: number;
  collectiblesCollected: number;
  enemiesDefeated: number;
  checkpointsReached: number;
  score?: number | null;
  finishedAt?: string | null;
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
  canonicalRoomVersion: number | null;
  goalType: RoomGoalType;
  rankingMode: LeaderboardRankingMode;
  difficulty: RoomDifficultySummary;
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
  roomVersion: number;
  displayRoomVersion: number;
  canonicalRoomVersion: number | null;
  goalType: RoomGoalType;
  consensusDifficulty: RoomDifficulty | null;
  voteCount: number;
  publishedAt: string | null;
}

export interface RoomDiscoveryResponse {
  difficultyFilter: RoomDifficulty | null;
  results: RoomDiscoveryEntry[];
}

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
