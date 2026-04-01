export interface DashboardUserStats {
  total: number;
  playfunLinked: number;
  nonPlayfun: number;
}

export interface DashboardRoomStats {
  totalBuilt: number;
  uniqueBuilders: number;
  buildersWithMultipleRooms: number;
}

export interface DashboardChallengeStats {
  completed: number;
}

export interface DashboardStatsResponse {
  generatedAt: string;
  users: DashboardUserStats;
  rooms: DashboardRoomStats;
  challenges: DashboardChallengeStats;
}
