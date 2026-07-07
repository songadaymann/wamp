export interface DashboardUserStats {
  total: number;
  legacyGeneratedLinked: number;
  standard: number;
}

export interface DashboardRoomStats {
  totalBuilt: number;
  uniqueBuilders: number;
  buildersWithMultipleRooms: number;
}

export interface DashboardChallengeStats {
  completed: number;
}

export interface DashboardDailyCountPoint {
  date: string;
  count: number;
}

export interface DashboardHistoryStats {
  windowDays: number;
  standardSignupsPerDay: DashboardDailyCountPoint[];
  roomClaimsPerDay: DashboardDailyCountPoint[];
}

export interface DashboardStatsResponse {
  generatedAt: string;
  users: DashboardUserStats;
  rooms: DashboardRoomStats;
  challenges: DashboardChallengeStats;
  history: DashboardHistoryStats;
}
