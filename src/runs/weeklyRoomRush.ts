import type { RoomCoordinates } from '../persistence/roomModel';
import type { RoomRushLeaderboardEntry } from './model';

export const WEEKLY_ROOM_RUSH_LIMIT_MS = 5 * 60 * 1000;

export interface WeeklyRoomRushPeriod {
  weekKey: string;
  startsAt: string;
  endsAt: string;
}

export interface WeeklyRoomRushPick {
  roomId: string;
  coordinates: RoomCoordinates;
  roomVersion: number;
  title: string;
  available: boolean;
  unavailableReason: string | null;
}

export interface WeeklyRoomRushResponse {
  period: WeeklyRoomRushPeriod;
  pick: WeeklyRoomRushPick | null;
  difficulty: 'hard';
  timeLimitMs: number;
  serverTime: string;
  previousWeek: WeeklyRoomRushPeriod;
  previousWinners: RoomRushLeaderboardEntry[];
}

export interface WeeklyRoomRushAdminWeek extends WeeklyRoomRushPeriod {
  pick: WeeklyRoomRushPick | null;
  lockedAt: string | null;
}

export interface WeeklyRoomRushAdminResponse {
  weeks: WeeklyRoomRushAdminWeek[];
  serverTime: string;
}
