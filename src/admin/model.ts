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

export type SuspiciousSeverity = 'high' | 'medium' | 'low';

export type SuspiciousSignalCode =
  | 'record_gap'
  | 'too_fast_absolute'
  | 'run_burst_5m'
  | 'run_burst_60m'
  | 'repeat_identical'
  | 'point_burst_5m'
  | 'new_account_spike';

export interface SuspiciousSignal {
  code: SuspiciousSignalCode;
  severity: SuspiciousSeverity;
  label: string;
  summary: string;
  relatedAttemptIds: string[];
}

export interface SuspiciousUserCase {
  userId: string;
  userDisplayName: string;
  userCreatedAt: string;
  ogpId: string | null;
  playerId: string | null;
  totalPoints: number;
  completedRuns: number;
  recentPoints: number;
  recentCompletedRuns: number;
  strongestSeverity: SuspiciousSeverity;
  signalCodes: SuspiciousSignalCode[];
  signals: SuspiciousSignal[];
  lastActivityAt: string | null;
}

export interface SuspiciousRunCase {
  kind: 'room' | 'course';
  attemptId: string;
  sourceId: string;
  title: string | null;
  version: number;
  roomX: number | null;
  roomY: number | null;
  goalType: string;
  rankingMode: 'time' | 'score';
  userId: string;
  userDisplayName: string;
  startedAt: string;
  finishedAt: string | null;
  result: string;
  elapsedMs: number | null;
  deaths: number;
  score: number;
  severity: SuspiciousSeverity;
  ruleCodes: SuspiciousSignalCode[];
  previousBestElapsedMs: number | null;
  improvementMs: number | null;
  improvementRatio: number | null;
  repeatGroupCount: number | null;
}

export interface SuspiciousPointEventRecord {
  id: string;
  eventType: string;
  sourceKey: string;
  points: number;
  createdAt: string;
}

export interface SuspiciousInvalidationAuditSummary {
  id: string;
  targetUserId: string;
  targetUserDisplayName: string;
  operatorLabel: string;
  reason: string;
  roomRunCount: number;
  courseRunCount: number;
  pointEventCount: number;
  remoteFollowUpRequired: boolean;
  createdAt: string;
}

export interface SuspiciousSummaryResponse {
  generatedAt: string;
  windowHours: number;
  counts: {
    openCases: number;
    high: number;
    medium: number;
    low: number;
  };
  recentInvalidations: SuspiciousInvalidationAuditSummary[];
}

export interface SuspiciousUsersResponse {
  generatedAt: string;
  windowHours: number;
  total: number;
  items: SuspiciousUserCase[];
}

export interface SuspiciousUserDetailResponse {
  generatedAt: string;
  windowHours: number;
  user: SuspiciousUserCase;
  roomRuns: SuspiciousRunCase[];
  courseRuns: SuspiciousRunCase[];
  recentPointEvents: SuspiciousPointEventRecord[];
  recentInvalidations: SuspiciousInvalidationAuditSummary[];
}

export interface SuspiciousInvalidationPreviewRequest {
  roomRunAttemptIds: string[];
  courseRunAttemptIds: string[];
  pointEventIds: string[];
  reason: string;
}

export interface SuspiciousInvalidationRequest extends SuspiciousInvalidationPreviewRequest {
  operatorLabel: string;
}

export interface SuspiciousInvalidationUserRecord {
  userId: string;
  userDisplayName: string;
}

export interface SuspiciousPlayfunSyncRecord {
  pointEventId: string;
  ogpId: string;
  points: number;
  status: string;
  syncedAt: string | null;
}

export interface SuspiciousInvalidationPreviewResponse {
  targetUserId: string;
  targetUserDisplayName: string;
  reason: string;
  roomRuns: SuspiciousRunCase[];
  courseRuns: SuspiciousRunCase[];
  selectedPointEvents: SuspiciousPointEventRecord[];
  runPointEvents: SuspiciousPointEventRecord[];
  creatorPointEvents: SuspiciousPointEventRecord[];
  affectedUsers: SuspiciousInvalidationUserRecord[];
  playfunSync: SuspiciousPlayfunSyncRecord[];
  remoteFollowUpRequired: boolean;
  summary: {
    roomRunsDeleted: number;
    courseRunsDeleted: number;
    selectedPointEventsDeleted: number;
    runPointEventsDeleted: number;
    creatorPointEventsDeleted: number;
  };
}

export interface SuspiciousInvalidationResult extends SuspiciousInvalidationPreviewResponse {
  ok: true;
  auditId: string;
  operatorLabel: string;
}
