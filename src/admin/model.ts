import type { BuilderCapabilitySummary, ProgressionLaneSummary, TrustTier } from '../progression/model';

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
  guestVisitors: number;
  guestVisits: number;
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
  logins: number;
  guestVisitors: number;
  guestVisitHeartbeats: number;
  guestPlayBuildVisitors: number;
  guestPlaySeconds: number;
  guestEditSeconds: number;
  magicLinksCreated: number;
  chatMessages: number;
  roomClaims: number;
  roomPublishes: number;
  coursePublishes: number;
  roomRunStarts: number;
  roomRunFinishes: number;
  courseRunStarts: number;
  courseRunFinishes: number;
}

export type LaunchStatsActivityRangeKey =
  | 'last12h'
  | 'last24h'
  | 'last3d'
  | 'last7d'
  | 'last30d';

export interface LaunchStatsActivityRange {
  key: LaunchStatsActivityRangeKey;
  label: string;
  description: string;
  since: string;
  activity: LaunchStatsActivityWindow;
  recentSummaries: LaunchStatsRecentSummary[];
}

export interface LaunchStatsActivity {
  last5m: LaunchStatsActivityWindow;
  last15m: LaunchStatsActivityWindow;
  last60m: LaunchStatsActivityWindow;
  defaultRangeKey: LaunchStatsActivityRangeKey;
  ranges: LaunchStatsActivityRange[];
}

export type LaunchStatsRecentSummaryKind =
  | 'signup'
  | 'guest_visit'
  | 'visit_only'
  | 'room_play'
  | 'room_build'
  | 'course_build';

export type LaunchStatsSignupSource = 'email' | 'wallet' | 'unknown';

export interface LaunchStatsActivityCoordinate {
  x: number;
  y: number;
}

export interface LaunchStatsRecentRoomReference {
  roomId: string | null;
  roomTitle: string | null;
  roomX: number | null;
  roomY: number | null;
  attemptCount: number | null;
  claimCount: number | null;
  publishCount: number | null;
}

export interface LaunchStatsRecentCourseReference {
  courseId: string;
  courseTitle: string | null;
  coordinates: LaunchStatsActivityCoordinate[];
  publishCount: number | null;
}

export interface LaunchStatsRecentSummary {
  kind: LaunchStatsRecentSummaryKind;
  at: string;
  actorUserId: string | null;
  actorGuestId?: string | null;
  actorDisplayName: string;
  signupSource: LaunchStatsSignupSource | null;
  sessionCount: number | null;
  heartbeatCount?: number | null;
  durationSeconds?: number | null;
  browseSeconds?: number | null;
  playSeconds?: number | null;
  editSeconds?: number | null;
  lastPath?: string | null;
  lastRoomId?: string | null;
  lastRoomX?: number | null;
  lastRoomY?: number | null;
  roomCount: number | null;
  courseCount: number | null;
  claimCount: number | null;
  roomPublishCount: number | null;
  coursePublishCount: number | null;
  attemptCount: number | null;
  completedCount: number | null;
  failedCount: number | null;
  abandonedCount: number | null;
  topRooms: LaunchStatsRecentRoomReference[];
  topCourses: LaunchStatsRecentCourseReference[];
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
  recentSummaries: LaunchStatsRecentSummary[];
  partykit: LaunchStatsPartykitStatus;
}

export type SuspiciousSeverity = 'high' | 'medium' | 'low';

export type SuspiciousUserBucket = 'real_players' | 'playfun_signals';

export type SuspiciousUserIdentityKind =
  | 'no_playfun_signal'
  | 'playfun_linked'
  | 'playfun_only'
  | 'playfun_name_heuristic';

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

export interface SuspiciousUserIdentity {
  bucket: SuspiciousUserBucket;
  kind: SuspiciousUserIdentityKind;
  label: string;
  summary: string;
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
  identity: SuspiciousUserIdentity;
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
  runFinalizedPoints: number | null;
  runFinalizedPointEventId: string | null;
  runFinalizedPointCreatedAt: string | null;
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

export type SuspiciousUserListScope = 'review_window' | 'player_history_search';
export type SuspiciousUserDetailScope = 'review_window' | 'player_history';

export interface SuspiciousUsersResponse {
  generatedAt: string;
  windowHours: number;
  scope: SuspiciousUserListScope;
  total: number;
  items: SuspiciousUserCase[];
}

export interface SuspiciousUserDetailResponse {
  generatedAt: string;
  windowHours: number;
  scope: SuspiciousUserDetailScope;
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

export interface AdminBuilderCapOverride {
  claimLimitPerDay: number | null;
  publishLimitPerDay: number | null;
  objectLimit: number | null;
  collectibleLimit: number | null;
  reason: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface AdminTrustSummary {
  rawScore: number;
  rawTier: TrustTier;
  effectiveScore: number;
  effectiveTier: TrustTier;
  penaltyActive: boolean;
  suspiciousPenaltyActive: boolean;
  chatPenaltyActive: boolean;
}

export interface AdminProgressionStatsSummary {
  player: ProgressionLaneSummary;
  builder: ProgressionLaneSummary;
  curator: ProgressionLaneSummary;
  badgeCount: number;
  trophyCount: number;
  firstIdentityQualifiedAt: string | null;
}

export interface AdminProgressionUserLookupEntry {
  userId: string;
  displayName: string;
  email: string | null;
  founderNumber: number | null;
  trust: AdminTrustSummary;
  stats: AdminProgressionStatsSummary;
  builderCaps: BuilderCapabilitySummary;
  override: AdminBuilderCapOverride;
}

export interface AdminProgressionUserLookupResponse {
  query: string;
  items: AdminProgressionUserLookupEntry[];
}

export interface AdminProgressionUserCapsResponse extends AdminProgressionUserLookupEntry {}

export interface AdminProgressionCapsUpdateRequest {
  claimLimitPerDay: number | null;
  publishLimitPerDay: number | null;
  objectLimit: number | null;
  collectibleLimit: number | null;
  reason: string | null;
  operatorLabel: string;
}

export interface AdminProgressionCapsUpdateResponse extends AdminProgressionUserCapsResponse {
  ok: true;
}
