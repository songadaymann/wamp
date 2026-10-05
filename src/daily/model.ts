export const DAILY_CLEAR_PXP = 5;
export interface DailyPick {
  date: string;
  targetKey: string;
  contentType: 'room' | 'expanded_room';
  contentId: string;
  version: number;
  roomId: string;
  roomVersion: number;
  coordinates: { x: number; y: number };
  title: string;
  builderUserId: string;
  builderDisplayName: string;
  cellCount: number;
  legacyCourseId: string | null;
  playPath: string;
  available: boolean;
}
export interface DailyLeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  elapsedMs: number;
  deaths: number;
  score: number;
}
export interface DailyResponse {
  date: string;
  resetsAt: string;
  pick: DailyPick | null;
  recentPicks: Pick<DailyPick, 'date' | 'contentType' | 'contentId' | 'version' | 'legacyCourseId'>[];
  leaderboard: DailyLeaderboardEntry[];
  rankingMode: 'time' | 'score';
  viewer: { completed: boolean; completedLast7: number; rank: number | null } | null;
  bonusPxp: number;
}
