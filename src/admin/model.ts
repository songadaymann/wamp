export interface PartyKitShardHeartbeat {
  shardId: string;
  totalConnections: number;
  playConnections: number;
  editConnections: number;
  updatedAt: string;
}

export interface PartyKitLaunchStats {
  fetchedAt: string;
  shardCount: number;
  staleShardCount: number;
  totalConnections: number;
  totalPlayConnections: number;
  totalEditConnections: number;
  shards: PartyKitShardHeartbeat[];
}

export interface LaunchStatsConfig {
  emailConfigured: boolean;
  debugMagicLinks: boolean;
  testResetEnabled: boolean;
  partykitConfigured: boolean;
}

export interface LaunchStatsTotals {
  users: number;
  activeSessions: number;
  rooms: number;
  publishedRooms: number;
  roomRuns: number;
  courses: number;
  courseRuns: number;
  chatMessages: number;
  agents: number;
  agentTokens: number;
}

export interface LaunchStatsActivityWindow {
  newUsers: number;
  magicLinksCreated: number;
  chatMessages: number;
  roomPublishes: number;
  roomRunStarts: number;
  roomRunFinishes: number;
  courseRunStarts: number;
  courseRunFinishes: number;
}

export interface LaunchStatsActivity {
  last5m: LaunchStatsActivityWindow;
  last15m: LaunchStatsActivityWindow;
  last60m: LaunchStatsActivityWindow;
}

export interface LaunchStatsPartykitStatus {
  configured: boolean;
  reachable: boolean;
  error: string | null;
  stats: PartyKitLaunchStats | null;
}

export interface LaunchStatsResponse {
  generatedAt: string;
  config: LaunchStatsConfig;
  totals: LaunchStatsTotals;
  activity: LaunchStatsActivity;
  partykit: LaunchStatsPartykitStatus;
}
