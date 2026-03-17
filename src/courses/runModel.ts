import type { CourseGoal, CourseGoalType } from './model';
import type { LeaderboardRankingMode, RunResult } from '../runs/model';

export interface CourseRunStartRequestBody {
  courseId: string;
  courseVersion: number;
  goal: CourseGoal;
  startedAt?: string | null;
}

export interface CourseRunStartResponse {
  attemptId: string;
  courseId: string;
  courseVersion: number;
  goalType: CourseGoalType;
  startedAt: string;
  userId: string;
  userDisplayName: string;
}

export interface CourseRunFinishRequestBody {
  result: Exclude<RunResult, 'active'>;
  elapsedMs: number;
  deaths: number;
  collectiblesCollected: number;
  enemiesDefeated: number;
  checkpointsReached: number;
  score?: number | null;
  finishedAt?: string | null;
}

export interface CourseRunRecord {
  attemptId: string;
  courseId: string;
  courseVersion: number;
  goalType: CourseGoalType;
  goal: CourseGoal;
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

export interface CourseLeaderboardEntry {
  rank: number;
  userId: string;
  userDisplayName: string;
  attemptId: string;
  courseId: string;
  courseVersion: number;
  goalType: CourseGoalType;
  elapsedMs: number;
  deaths: number;
  score: number;
  finishedAt: string;
}

export interface CourseLeaderboardResponse {
  courseId: string;
  courseTitle: string | null;
  courseVersion: number;
  goalType: CourseGoalType;
  rankingMode: LeaderboardRankingMode;
  entries: CourseLeaderboardEntry[];
  viewerBest: CourseLeaderboardEntry | null;
  viewerRank: number | null;
}
