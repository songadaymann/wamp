import type { AuthUser } from '../auth/model';
import type { RoomGoalType } from '../goals/roomGoals';
import type { RoomCoordinates } from '../persistence/roomModel';

export interface ProfilePublishedRoomEntry {
  roomId: string;
  roomCoordinates: RoomCoordinates;
  roomTitle: string | null;
  roomVersion: number;
  goalType: RoomGoalType | null;
  publishedAt: string | null;
}

export interface ProfileStatsSummary {
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
  globalRank: number | null;
}

export interface UserProfileResponse {
  userId: string;
  displayName: string;
  createdAt: string;
  avatarUrl: string | null;
  bio: string | null;
  isSelf: boolean;
  canEdit: boolean;
  stats: ProfileStatsSummary;
  publishedRooms: ProfilePublishedRoomEntry[];
  publishedCourseCount: number;
}

export interface UserProfileUpdateRequestBody {
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
}

export interface UserProfileUpdateResponse {
  ok: true;
  user: AuthUser;
  profile: UserProfileResponse;
}
