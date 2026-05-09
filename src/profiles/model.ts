import type { AuthUser } from '../auth/model';
import type { RoomGoalType } from '../goals/roomGoals';
import type { RoomCoordinates } from '../persistence/roomModel';
import type { PlayerAvatarChoice } from '../player/avatar/model';
import type { ProgressionSummary } from '../progression/model';

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
  username: string | null;
  createdAt: string;
  avatarUrl: string | null;
  bio: string | null;
  selectedAvatarId: string;
  avatarChoices: PlayerAvatarChoice[];
  isSelf: boolean;
  canEdit: boolean;
  stats: ProfileStatsSummary;
  progression: ProgressionSummary;
  publishedRooms: ProfilePublishedRoomEntry[];
  publishedCourseCount: number;
}

export interface UserProfileUpdateRequestBody {
  displayName: string;
  username?: string | null;
  avatarUrl: string | null;
  bio: string | null;
  selectedAvatarId?: string | null;
}

export interface UserProfileUpdateResponse {
  ok: true;
  user: AuthUser;
  profile: UserProfileResponse;
}
