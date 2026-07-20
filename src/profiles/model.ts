import type { AuthUser } from '../auth/model';
import type { ExpandedRoomSource } from '../expandedRooms/model';
import type { RoomGoalType } from '../goals/roomGoals';
import type { RoomCoordinates } from '../persistence/roomModel';
import type { PlayerAvatarChoice } from '../player/avatar/model';
import type { RoomPlaylistSummary } from '../playlists/model';
import type { ProgressionSummary, QualityRatingSummary } from '../progression/model';
import type { RoomDifficulty } from '../runs/model';

export interface ProfilePublishedRoomEntry {
  roomId: string;
  roomCoordinates: RoomCoordinates;
  roomTitle: string | null;
  roomVersion: number;
  goalType: RoomGoalType | null;
  publishedAt: string | null;
  consensusDifficulty: RoomDifficulty | null;
  quality: QualityRatingSummary;
  expandedRoom?: ProfilePublishedRoomExpandedRoomTarget | null;
}

export interface ProfilePublishedRoomExpandedRoomTarget {
  expandedRoomId: string;
  expandedRoomVersion: number | null;
  title: string | null;
  source: ExpandedRoomSource;
  legacyCourseId: string | null;
  cellCount: number;
  anchorCoordinates: RoomCoordinates;
  focusedCoordinates: RoomCoordinates;
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
  pvpWins: number;
  pvpLosses: number;
  pvpDraws: number;
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
  playlists: RoomPlaylistSummary[];
  publishedCourseCount: number;
}

export type UserProfileSummaryResponse = Omit<UserProfileResponse, 'publishedRooms' | 'playlists'>;

export interface UserProfileRoomsResponse {
  results: ProfilePublishedRoomEntry[];
  nextCursor?: string;
}

export interface UserProfilePlaylistsResponse {
  results: RoomPlaylistSummary[];
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
