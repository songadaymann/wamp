import type { CourseGoal, CourseGoalType } from '../courses/model';
import type {
  CourseLeaderboardEntry,
  CourseLeaderboardResponse,
  CourseRunFinishRequestBody,
} from '../courses/runModel';
import type {
  ExpandedRoomRatingRequestBody,
  ExpandedRoomRatingResponse,
} from '../progression/model';

export interface ExpandedRoomRunStartRequestBody {
  expandedRoomId: string;
  expandedRoomVersion: number;
  goal: CourseGoal;
  startedAt?: string | null;
}

export interface ExpandedRoomRunStartResponse {
  attemptId: string;
  expandedRoomId: string;
  expandedRoomVersion: number;
  legacyCourseId: string | null;
  goalType: CourseGoalType;
  startedAt: string;
  userId: string;
  userDisplayName: string;
  verificationSchemaVersion: number;
  verificationNonce: string;
  snapshotHash: string;
}

export type ExpandedRoomRunFinishRequestBody = CourseRunFinishRequestBody;

export interface ExpandedRoomLeaderboardEntry extends CourseLeaderboardEntry {
  expandedRoomId: string;
  expandedRoomVersion: number;
  legacyCourseId: string | null;
}

export interface ExpandedRoomLeaderboardResponse
  extends Omit<CourseLeaderboardResponse, 'entries' | 'viewerBest'> {
  expandedRoomId: string;
  expandedRoomTitle: string | null;
  expandedRoomVersion: number;
  legacyCourseId: string | null;
  entries: ExpandedRoomLeaderboardEntry[];
  viewerBest: ExpandedRoomLeaderboardEntry | null;
}

export interface ExpandedRoomProgressRatingRequestBody
  extends ExpandedRoomRatingRequestBody {}

export interface ExpandedRoomProgressRatingResponse extends ExpandedRoomRatingResponse {}
