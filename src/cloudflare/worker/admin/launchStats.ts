import type {
  LaunchStatsActivityRange,
  LaunchStatsActivityRangeKey,
  LaunchStatsActivityWindow,
  LaunchStatsRecentCourseReference,
  LaunchStatsRecentRoomReference,
  LaunchStatsRecentSummary,
  LaunchStatsPartykitStatus,
  LaunchStatsResponse,
  LaunchStatsSignupSource,
  LaunchStatsTotals,
  PartyKitLaunchStats,
} from '../../../admin/model';
import type { Env } from '../core/types';
import {
  sqlHasPlayfunDisplayNamePrefix,
  sqlUserIdIsPlayfunOnly,
} from '../playfun/leaderboardIsolation';

const METRICS_ROOM_ID = '__launch-stats__';
const RECENT_SUMMARY_LIMIT = 80;
const TOP_REFERENCE_LIMIT = 3;
const DEFAULT_ACTIVITY_RANGE_KEY: LaunchStatsActivityRangeKey = 'last24h';
const ACTIVITY_RANGES: Array<{
  key: LaunchStatsActivityRangeKey;
  label: string;
  description: string;
  hours: number;
}> = [
  { key: 'last12h', label: 'Last 12h', description: 'the last 12 hours', hours: 12 },
  { key: 'last24h', label: 'Last 24h', description: 'the last 24 hours', hours: 24 },
  { key: 'last3d', label: 'Last 3d', description: 'the last 3 days', hours: 72 },
  { key: 'last7d', label: 'Last 7d', description: 'the last 7 days', hours: 168 },
  { key: 'last30d', label: 'Last 30d', description: 'the last 30 days', hours: 720 },
];

export async function loadLaunchStats(env: Env): Promise<LaunchStatsResponse> {
  const now = new Date();
  const generatedAt = now.toISOString();
  const config = {
    emailConfigured: Boolean(env.RESEND_API_KEY?.trim()),
    debugMagicLinks: env.AUTH_DEBUG_MAGIC_LINKS === '1',
    testResetEnabled: env.ENABLE_TEST_RESET === '1',
    partykitConfigured: isPartykitConfigured(env),
  };

  const [totals, last5m, last15m, last60m, ranges, partykit] = await Promise.all([
    loadTotals(env, generatedAt),
    loadActivityWindow(env, minutesAgoIso(now, 5)),
    loadActivityWindow(env, minutesAgoIso(now, 15)),
    loadActivityWindow(env, minutesAgoIso(now, 60)),
    Promise.all(ACTIVITY_RANGES.map((range) => loadActivityRange(env, now, range))),
    loadPartykitStatus(env),
  ]);
  const defaultRange =
    ranges.find((range) => range.key === DEFAULT_ACTIVITY_RANGE_KEY) ??
    ranges[0] ??
    null;

  return {
    generatedAt,
    config,
    totals,
    activity: {
      last5m,
      last15m,
      last60m,
      defaultRangeKey: DEFAULT_ACTIVITY_RANGE_KEY,
      ranges,
    },
    recentSummaries: defaultRange?.recentSummaries ?? [],
    partykit,
  };
}

function isPartykitConfigured(env: Env): boolean {
  return Boolean(env.PARTYKIT_HOST?.trim() && env.PARTYKIT_INTERNAL_TOKEN?.trim());
}

function minutesAgoIso(base: Date, minutes: number): string {
  return new Date(base.getTime() - minutes * 60 * 1000).toISOString();
}

function hoursAgoIso(base: Date, hours: number): string {
  return new Date(base.getTime() - hours * 60 * 60 * 1000).toISOString();
}

async function loadActivityRange(
  env: Env,
  now: Date,
  range: (typeof ACTIVITY_RANGES)[number],
): Promise<LaunchStatsActivityRange> {
  const since = hoursAgoIso(now, range.hours);
  const [activity, recentSummaries] = await Promise.all([
    loadActivityWindow(env, since),
    loadRecentSummaries(env, since),
  ]);

  return {
    key: range.key,
    label: range.label,
    description: range.description,
    since,
    activity,
    recentSummaries,
  };
}

function sqlLaunchActivityIsPlayfunIdentity(
  userIdExpression: string,
  displayNameExpression: string
): string {
  return `(
    ${sqlUserIdIsPlayfunOnly(userIdExpression)}
    OR COALESCE(${sqlHasPlayfunDisplayNamePrefix(displayNameExpression)}, 0)
  )`;
}

function sqlLaunchActivityIsNotPlayfunIdentity(
  userIdExpression: string,
  displayNameExpression: string
): string {
  return `NOT ${sqlLaunchActivityIsPlayfunIdentity(userIdExpression, displayNameExpression)}`;
}

async function loadTotals(env: Env, nowIso: string): Promise<LaunchStatsTotals> {
  const [
    users,
    activeSessions,
    guestVisitors,
    guestVisits,
    rooms,
    publishedRooms,
    roomRuns,
    courses,
    courseRuns,
    chatMessages,
    agents,
    agentTokens,
  ] = await Promise.all([
    countQuery(env, 'SELECT COUNT(*) AS count FROM users'),
    countQuery(env, 'SELECT COUNT(*) AS count FROM sessions WHERE expires_at > ?', [nowIso]),
    countQuery(env, 'SELECT COUNT(DISTINCT guest_user_id) AS count FROM guest_visits'),
    countQuery(env, 'SELECT COUNT(*) AS count FROM guest_visits'),
    countQuery(env, 'SELECT COUNT(*) AS count FROM rooms'),
    countQuery(env, 'SELECT COUNT(*) AS count FROM rooms WHERE published_json IS NOT NULL'),
    countQuery(env, 'SELECT COUNT(*) AS count FROM room_runs'),
    countQuery(env, 'SELECT COUNT(*) AS count FROM courses'),
    countQuery(env, 'SELECT COUNT(*) AS count FROM course_runs'),
    countQuery(env, 'SELECT COUNT(*) AS count FROM chat_messages'),
    countQuery(env, 'SELECT COUNT(*) AS count FROM agents'),
    countQuery(env, 'SELECT COUNT(*) AS count FROM agent_tokens'),
  ]);

  return {
    users,
    activeSessions,
    guestVisitors,
    guestVisits,
    rooms,
    publishedRooms,
    roomRuns,
    courses,
    courseRuns,
    chatMessages,
    agents,
    agentTokens,
  };
}

async function loadActivityWindow(
  env: Env,
  sinceIso: string
): Promise<LaunchStatsActivityWindow> {
  const [
    newUsers,
    logins,
    guestVisitors,
    guestVisitHeartbeats,
    guestPlayBuildVisitors,
    guestPlaySeconds,
    guestEditSeconds,
    magicLinksCreated,
    chatMessages,
    roomClaims,
    roomPublishes,
    coursePublishes,
    roomRunStarts,
    roomRunFinishes,
    courseRunStarts,
    courseRunFinishes,
  ] = await Promise.all([
    countQuery(
      env,
      `
        SELECT COUNT(*) AS count
        FROM users
        WHERE created_at >= ?
          AND ${sqlLaunchActivityIsNotPlayfunIdentity('users.id', 'users.display_name')}
      `,
      [sinceIso]
    ),
    countQuery(
      env,
      `
        SELECT COUNT(*) AS count
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.created_at >= ?
          AND ${sqlLaunchActivityIsNotPlayfunIdentity('users.id', 'users.display_name')}
      `,
      [sinceIso]
    ),
    countQuery(
      env,
      `
        SELECT COUNT(DISTINCT guest_user_id) AS count
        FROM guest_visits
        WHERE last_seen_at >= ?
      `,
      [sinceIso]
    ),
    countQuery(
      env,
      `
        SELECT COALESCE(SUM(heartbeat_count), 0) AS count
        FROM guest_visits
        WHERE last_seen_at >= ?
      `,
      [sinceIso]
    ),
    countQuery(
      env,
      `
        SELECT COUNT(DISTINCT guest_user_id) AS count
        FROM guest_visits
        WHERE last_play_at >= ?
           OR last_edit_at >= ?
      `,
      [sinceIso, sinceIso]
    ),
    countQuery(
      env,
      `
        SELECT COALESCE(SUM(play_seconds), 0) AS count
        FROM guest_visits
        WHERE last_play_at >= ?
      `,
      [sinceIso]
    ),
    countQuery(
      env,
      `
        SELECT COALESCE(SUM(edit_seconds), 0) AS count
        FROM guest_visits
        WHERE last_edit_at >= ?
      `,
      [sinceIso]
    ),
    countQuery(
      env,
      `
        SELECT COUNT(*) AS count
        FROM magic_link_tokens
        JOIN users ON users.id = magic_link_tokens.user_id
        WHERE magic_link_tokens.created_at >= ?
          AND ${sqlLaunchActivityIsNotPlayfunIdentity('users.id', 'users.display_name')}
      `,
      [sinceIso]
    ),
    countQuery(
      env,
      `
        SELECT COUNT(*) AS count
        FROM chat_messages
        WHERE created_at >= ?
          AND ${sqlLaunchActivityIsNotPlayfunIdentity('chat_messages.user_id', 'chat_messages.user_display_name')}
      `,
      [sinceIso]
    ),
    countQuery(
      env,
      `
        SELECT COUNT(*) AS count
        FROM rooms
        WHERE claimed_at >= ?
          AND claimer_display_name IS NOT NULL
          AND ${sqlLaunchActivityIsNotPlayfunIdentity(
            'rooms.claimer_user_id',
            'rooms.claimer_display_name'
          )}
      `,
      [sinceIso]
    ),
    countQuery(
      env,
      `
        SELECT COUNT(*) AS count
        FROM room_versions
        WHERE created_at >= ?
          AND published_by_display_name IS NOT NULL
          AND ${sqlLaunchActivityIsNotPlayfunIdentity(
            'room_versions.published_by_user_id',
            'room_versions.published_by_display_name'
          )}
      `,
      [sinceIso]
    ),
    countQuery(
      env,
      `
        SELECT COUNT(*) AS count
        FROM course_versions
        WHERE created_at >= ?
          AND published_by_display_name IS NOT NULL
          AND ${sqlLaunchActivityIsNotPlayfunIdentity(
            'course_versions.published_by_user_id',
            'course_versions.published_by_display_name'
          )}
      `,
      [sinceIso]
    ),
    countQuery(
      env,
      `
        SELECT COUNT(*) AS count
        FROM room_runs
        WHERE started_at >= ?
          AND ${sqlLaunchActivityIsNotPlayfunIdentity(
            'room_runs.user_id',
            'room_runs.user_display_name'
          )}
      `,
      [sinceIso]
    ),
    countQuery(
      env,
      `
        SELECT COUNT(*) AS count
        FROM room_runs
        WHERE finished_at IS NOT NULL
          AND finished_at >= ?
          AND ${sqlLaunchActivityIsNotPlayfunIdentity(
            'room_runs.user_id',
            'room_runs.user_display_name'
          )}
      `,
      [sinceIso]
    ),
    countQuery(
      env,
      `
        SELECT COUNT(*) AS count
        FROM course_runs
        WHERE started_at >= ?
          AND ${sqlLaunchActivityIsNotPlayfunIdentity(
            'course_runs.user_id',
            'course_runs.user_display_name'
          )}
      `,
      [sinceIso]
    ),
    countQuery(
      env,
      `
        SELECT COUNT(*) AS count
        FROM course_runs
        WHERE finished_at IS NOT NULL
          AND finished_at >= ?
          AND ${sqlLaunchActivityIsNotPlayfunIdentity(
            'course_runs.user_id',
            'course_runs.user_display_name'
          )}
      `,
      [sinceIso]
    ),
  ]);

  return {
    newUsers,
    logins,
    guestVisitors,
    guestVisitHeartbeats,
    guestPlayBuildVisitors,
    guestPlaySeconds,
    guestEditSeconds,
    magicLinksCreated,
    chatMessages,
    roomClaims,
    roomPublishes,
    coursePublishes,
    roomRunStarts,
    roomRunFinishes,
    courseRunStarts,
    courseRunFinishes,
  };
}

interface SignupSummaryRow {
  at: string;
  actor_user_id: string;
  actor_display_name: string;
  email: string | null;
  wallet_address: string | null;
}

interface VisitOnlySummaryRow {
  at: string;
  actor_user_id: string;
  actor_display_name: string;
  session_count: number;
}

interface GuestVisitSummaryRow {
  at: string;
  actor_guest_id: string;
  actor_display_name: string;
  heartbeat_count: number | string | null;
  duration_seconds: number | string | null;
  browse_seconds: number | string | null;
  play_seconds: number | string | null;
  edit_seconds: number | string | null;
  last_path: string | null;
  last_room_id: string | null;
  last_room_x: number | string | null;
  last_room_y: number | string | null;
}

interface RoomBuildActivityRow {
  at: string;
  actor_user_id: string | null;
  actor_display_name: string | null;
  room_id: string;
  room_title: string | null;
  room_x: number;
  room_y: number;
  claim_count: number;
  publish_count: number;
}

interface CourseBuildActivityRow {
  at: string;
  actor_user_id: string | null;
  actor_display_name: string | null;
  course_id: string;
  course_title: string | null;
  course_version: number;
  room_x: number | null;
  room_y: number | null;
  room_order: number | null;
}

interface RoomPlaySummaryRow {
  at: string;
  actor_user_id: string;
  actor_display_name: string;
  attempt_count: number;
  completed_count: number;
  failed_count: number;
  abandoned_count: number;
  room_count: number;
}

interface RoomPlayTopRoomRow {
  actor_user_id: string;
  room_id: string;
  room_title: string | null;
  room_x: number;
  room_y: number;
  attempt_count: number;
  last_at: string;
  room_rank: number;
}

interface RoomReferenceAccumulator extends LaunchStatsRecentRoomReference {
  lastAt: string;
}

interface CourseCoordinateAccumulator {
  x: number;
  y: number;
  order: number;
}

interface CourseReferenceAccumulator {
  courseId: string;
  courseTitle: string | null;
  lastAt: string;
  latestVersion: number;
  publishVersions: Set<string>;
  latestCoordinates: CourseCoordinateAccumulator[];
}

async function loadRecentSummaries(
  env: Env,
  recentSinceIso: string
): Promise<LaunchStatsRecentSummary[]> {
  const [signups, guestVisits, visitOnly, roomPlay, roomBuild, courseBuild] = await Promise.all([
    loadSignupSummaries(env, recentSinceIso),
    loadGuestVisitSummaries(env, recentSinceIso),
    loadVisitOnlySummaries(env, recentSinceIso),
    loadRoomPlaySummaries(env, recentSinceIso),
    loadRoomBuildSummaries(env, recentSinceIso),
    loadCourseBuildSummaries(env, recentSinceIso),
  ]);

  return [...signups, ...guestVisits, ...visitOnly, ...roomPlay, ...roomBuild, ...courseBuild]
    .sort((left, right) => compareIsoDesc(left.at, right.at))
    .slice(0, RECENT_SUMMARY_LIMIT);
}

async function loadSignupSummaries(
  env: Env,
  recentSinceIso: string
): Promise<LaunchStatsRecentSummary[]> {
  const rows = await env.DB.prepare(
    `
      SELECT
        users.created_at AS at,
        users.id AS actor_user_id,
        users.display_name AS actor_display_name,
        users.email AS email,
        users.wallet_address AS wallet_address
      FROM users
      WHERE users.created_at >= ?
        AND ${sqlLaunchActivityIsNotPlayfunIdentity('users.id', 'users.display_name')}
      ORDER BY users.created_at DESC
      LIMIT ?
    `
  )
    .bind(recentSinceIso, RECENT_SUMMARY_LIMIT)
    .all<SignupSummaryRow>();

  return rows.results
    .filter((row) => Boolean(row.at && row.actor_display_name))
    .map((row) => ({
      kind: 'signup',
      at: row.at,
      actorUserId: row.actor_user_id,
      actorDisplayName: row.actor_display_name,
      signupSource: inferSignupSource(row),
      sessionCount: null,
      roomCount: null,
      courseCount: null,
      claimCount: null,
      roomPublishCount: null,
      coursePublishCount: null,
      attemptCount: null,
      completedCount: null,
      failedCount: null,
      abandonedCount: null,
      topRooms: [],
      topCourses: [],
    }));
}

function inferSignupSource(row: SignupSummaryRow): LaunchStatsSignupSource {
  if (row.wallet_address?.trim()) {
    return 'wallet';
  }

  if (row.email?.trim()) {
    return 'email';
  }

  return 'unknown';
}

async function loadGuestVisitSummaries(
  env: Env,
  recentSinceIso: string
): Promise<LaunchStatsRecentSummary[]> {
  const rows = await env.DB.prepare(
    `
      SELECT
        MAX(
          COALESCE(guest_visits.last_play_at, ''),
          COALESCE(guest_visits.last_edit_at, '')
        ) AS at,
        guest_visits.guest_user_id AS actor_guest_id,
        guest_visits.guest_display_name AS actor_display_name,
        guest_visits.heartbeat_count AS heartbeat_count,
        MAX(
          0,
          CAST((julianday(guest_visits.last_seen_at) - julianday(guest_visits.first_seen_at)) * 86400 AS INTEGER)
        ) AS duration_seconds,
        guest_visits.browse_seconds AS browse_seconds,
        guest_visits.play_seconds AS play_seconds,
        guest_visits.edit_seconds AS edit_seconds,
        guest_visits.last_path AS last_path,
        guest_visits.room_id AS last_room_id,
        guest_visits.room_x AS last_room_x,
        guest_visits.room_y AS last_room_y
      FROM guest_visits
      WHERE guest_visits.last_play_at >= ?
         OR guest_visits.last_edit_at >= ?
      ORDER BY at DESC
      LIMIT ?
    `
  )
    .bind(recentSinceIso, recentSinceIso, RECENT_SUMMARY_LIMIT)
    .all<GuestVisitSummaryRow>();

  return rows.results
    .filter((row) => Boolean(row.at && row.actor_guest_id && row.actor_display_name))
    .map((row) => ({
      kind: 'guest_visit',
      at: row.at,
      actorUserId: null,
      actorGuestId: row.actor_guest_id,
      actorDisplayName: row.actor_display_name,
      signupSource: null,
      sessionCount: null,
      heartbeatCount: parseOptionalInteger(row.heartbeat_count),
      durationSeconds: parseOptionalInteger(row.duration_seconds),
      browseSeconds: parseOptionalInteger(row.browse_seconds),
      playSeconds: parseOptionalInteger(row.play_seconds),
      editSeconds: parseOptionalInteger(row.edit_seconds),
      lastPath: row.last_path,
      lastRoomId: row.last_room_id,
      lastRoomX: parseOptionalInteger(row.last_room_x),
      lastRoomY: parseOptionalInteger(row.last_room_y),
      roomCount: null,
      courseCount: null,
      claimCount: null,
      roomPublishCount: null,
      coursePublishCount: null,
      attemptCount: null,
      completedCount: null,
      failedCount: null,
      abandonedCount: null,
      topRooms: [],
      topCourses: [],
    }));
}

async function loadVisitOnlySummaries(
  env: Env,
  recentSinceIso: string
): Promise<LaunchStatsRecentSummary[]> {
  const rows = await env.DB.prepare(
    `
      SELECT
        MAX(sessions.created_at) AS at,
        users.id AS actor_user_id,
        users.display_name AS actor_display_name,
        COUNT(*) AS session_count
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.created_at >= ?
        AND users.created_at < ?
        AND ${sqlLaunchActivityIsNotPlayfunIdentity('users.id', 'users.display_name')}
      GROUP BY users.id, users.display_name
      HAVING NOT EXISTS (
        SELECT 1
        FROM rooms
        WHERE rooms.claimer_user_id = users.id
          AND rooms.claimed_at >= ?
      )
        AND NOT EXISTS (
          SELECT 1
          FROM room_versions
          WHERE room_versions.published_by_user_id = users.id
            AND room_versions.created_at >= ?
        )
        AND NOT EXISTS (
          SELECT 1
          FROM course_versions
          WHERE course_versions.published_by_user_id = users.id
            AND course_versions.created_at >= ?
        )
        AND NOT EXISTS (
          SELECT 1
          FROM room_runs
          WHERE room_runs.user_id = users.id
            AND room_runs.started_at >= ?
        )
        AND NOT EXISTS (
          SELECT 1
          FROM course_runs
          WHERE course_runs.user_id = users.id
            AND course_runs.started_at >= ?
        )
      ORDER BY at DESC
      LIMIT ?
    `
  )
    .bind(
      recentSinceIso,
      recentSinceIso,
      recentSinceIso,
      recentSinceIso,
      recentSinceIso,
      recentSinceIso,
      recentSinceIso,
      RECENT_SUMMARY_LIMIT
    )
    .all<VisitOnlySummaryRow>();

  return rows.results
    .filter((row) => Boolean(row.at && row.actor_display_name))
    .map((row) => ({
      kind: 'visit_only',
      at: row.at,
      actorUserId: row.actor_user_id,
      actorDisplayName: row.actor_display_name,
      signupSource: null,
      sessionCount: Number(row.session_count ?? 0),
      roomCount: null,
      courseCount: null,
      claimCount: null,
      roomPublishCount: null,
      coursePublishCount: null,
      attemptCount: null,
      completedCount: null,
      failedCount: null,
      abandonedCount: null,
      topRooms: [],
      topCourses: [],
    }));
}

async function loadRoomPlaySummaries(
  env: Env,
  recentSinceIso: string
): Promise<LaunchStatsRecentSummary[]> {
  const [summaryRows, topRoomRows] = await Promise.all([
    env.DB.prepare(
      `
        SELECT
          MAX(COALESCE(room_runs.finished_at, room_runs.started_at)) AS at,
          room_runs.user_id AS actor_user_id,
          room_runs.user_display_name AS actor_display_name,
          COUNT(*) AS attempt_count,
          SUM(CASE WHEN room_runs.result = 'completed' THEN 1 ELSE 0 END) AS completed_count,
          SUM(CASE WHEN room_runs.result = 'failed' THEN 1 ELSE 0 END) AS failed_count,
          SUM(CASE WHEN room_runs.result = 'abandoned' THEN 1 ELSE 0 END) AS abandoned_count,
          COUNT(DISTINCT room_runs.room_id) AS room_count
        FROM room_runs
        WHERE room_runs.started_at >= ?
          AND ${sqlLaunchActivityIsNotPlayfunIdentity(
            'room_runs.user_id',
            'room_runs.user_display_name'
          )}
        GROUP BY room_runs.user_id, room_runs.user_display_name
        ORDER BY at DESC
        LIMIT ?
      `
    )
      .bind(recentSinceIso, RECENT_SUMMARY_LIMIT)
      .all<RoomPlaySummaryRow>(),
    env.DB.prepare(
      `
        SELECT
          ranked.actor_user_id,
          ranked.room_id,
          ranked.room_title,
          ranked.room_x,
          ranked.room_y,
          ranked.attempt_count,
          ranked.last_at,
          ranked.room_rank
        FROM (
          SELECT
            room_runs.user_id AS actor_user_id,
            room_runs.room_id AS room_id,
            COALESCE(rooms.published_title, rooms.draft_title) AS room_title,
            room_runs.room_x AS room_x,
            room_runs.room_y AS room_y,
            COUNT(*) AS attempt_count,
            MAX(COALESCE(room_runs.finished_at, room_runs.started_at)) AS last_at,
            ROW_NUMBER() OVER (
              PARTITION BY room_runs.user_id
              ORDER BY
                COUNT(*) DESC,
                MAX(COALESCE(room_runs.finished_at, room_runs.started_at)) DESC,
                room_runs.room_id ASC
            ) AS room_rank
          FROM room_runs
          LEFT JOIN rooms ON rooms.id = room_runs.room_id
          WHERE room_runs.started_at >= ?
            AND ${sqlLaunchActivityIsNotPlayfunIdentity(
              'room_runs.user_id',
              'room_runs.user_display_name'
            )}
          GROUP BY
            room_runs.user_id,
            room_runs.room_id,
            room_runs.room_x,
            room_runs.room_y,
            COALESCE(rooms.published_title, rooms.draft_title)
        ) ranked
        WHERE ranked.room_rank <= ?
        ORDER BY ranked.actor_user_id ASC, ranked.room_rank ASC
      `
    )
      .bind(recentSinceIso, TOP_REFERENCE_LIMIT)
      .all<RoomPlayTopRoomRow>(),
  ]);

  const topRoomsByActorId = new Map<string, LaunchStatsRecentRoomReference[]>();
  for (const row of topRoomRows.results) {
    const actorKey = row.actor_user_id;
    const list = topRoomsByActorId.get(actorKey) ?? [];
    list.push({
      roomId: row.room_id,
      roomTitle: row.room_title,
      roomX: Number(row.room_x),
      roomY: Number(row.room_y),
      attemptCount: Number(row.attempt_count ?? 0),
      claimCount: null,
      publishCount: null,
    });
    topRoomsByActorId.set(actorKey, list);
  }

  return summaryRows.results
    .filter((row) => Boolean(row.at && row.actor_display_name))
    .map((row) => ({
      kind: 'room_play',
      at: row.at,
      actorUserId: row.actor_user_id,
      actorDisplayName: row.actor_display_name,
      signupSource: null,
      sessionCount: null,
      roomCount: Number(row.room_count ?? 0),
      courseCount: null,
      claimCount: null,
      roomPublishCount: null,
      coursePublishCount: null,
      attemptCount: Number(row.attempt_count ?? 0),
      completedCount: Number(row.completed_count ?? 0),
      failedCount: Number(row.failed_count ?? 0),
      abandonedCount: Number(row.abandoned_count ?? 0),
      topRooms: topRoomsByActorId.get(row.actor_user_id) ?? [],
      topCourses: [],
    }));
}

async function loadRoomBuildSummaries(
  env: Env,
  recentSinceIso: string
): Promise<LaunchStatsRecentSummary[]> {
  const rows = await env.DB.prepare(
    `
      SELECT
        activity.at,
        activity.actor_user_id,
        activity.actor_display_name,
        activity.room_id,
        activity.room_title,
        activity.room_x,
        activity.room_y,
        activity.claim_count,
        activity.publish_count
      FROM (
        SELECT
          rooms.claimed_at AS at,
          rooms.claimer_user_id AS actor_user_id,
          rooms.claimer_display_name AS actor_display_name,
          rooms.id AS room_id,
          COALESCE(rooms.published_title, rooms.draft_title) AS room_title,
          rooms.x AS room_x,
          rooms.y AS room_y,
          1 AS claim_count,
          0 AS publish_count
        FROM rooms
        WHERE rooms.claimed_at IS NOT NULL
          AND rooms.claimer_display_name IS NOT NULL
          AND rooms.claimed_at >= ?
          AND ${sqlLaunchActivityIsNotPlayfunIdentity(
            'rooms.claimer_user_id',
            'rooms.claimer_display_name'
          )}

        UNION ALL

        SELECT
          room_versions.created_at AS at,
          room_versions.published_by_user_id AS actor_user_id,
          room_versions.published_by_display_name AS actor_display_name,
          room_versions.room_id AS room_id,
          COALESCE(room_versions.title, rooms.published_title, rooms.draft_title) AS room_title,
          rooms.x AS room_x,
          rooms.y AS room_y,
          0 AS claim_count,
          1 AS publish_count
        FROM room_versions
        JOIN rooms ON rooms.id = room_versions.room_id
        WHERE room_versions.published_by_display_name IS NOT NULL
          AND room_versions.created_at >= ?
          AND ${sqlLaunchActivityIsNotPlayfunIdentity(
            'room_versions.published_by_user_id',
            'room_versions.published_by_display_name'
          )}
      ) activity
      ORDER BY activity.at DESC
    `
  )
    .bind(recentSinceIso, recentSinceIso)
    .all<RoomBuildActivityRow>();

  const summaries = new Map<
    string,
    {
      at: string;
      actorUserId: string | null;
      actorDisplayName: string;
      claimCount: number;
      roomPublishCount: number;
      topRooms: Map<string, RoomReferenceAccumulator>;
    }
  >();

  for (const row of rows.results) {
    if (!row.at || !row.actor_display_name) {
      continue;
    }

    const actorKey = buildActorKey(row.actor_user_id, row.actor_display_name);
    const summary =
      summaries.get(actorKey) ??
      {
        at: row.at,
        actorUserId: row.actor_user_id,
        actorDisplayName: row.actor_display_name,
        claimCount: 0,
        roomPublishCount: 0,
        topRooms: new Map<string, RoomReferenceAccumulator>(),
      };

    summary.at = maxIso(summary.at, row.at);
    summary.claimCount += Number(row.claim_count ?? 0);
    summary.roomPublishCount += Number(row.publish_count ?? 0);

    const roomKey = row.room_id || `${row.room_x},${row.room_y}`;
    const room =
      summary.topRooms.get(roomKey) ??
      {
        roomId: row.room_id,
        roomTitle: row.room_title,
        roomX: Number(row.room_x),
        roomY: Number(row.room_y),
        attemptCount: null,
        claimCount: 0,
        publishCount: 0,
        lastAt: row.at,
      };

    room.roomTitle = room.roomTitle || row.room_title;
    room.claimCount = (room.claimCount ?? 0) + Number(row.claim_count ?? 0);
    room.publishCount = (room.publishCount ?? 0) + Number(row.publish_count ?? 0);
    room.lastAt = maxIso(room.lastAt, row.at);

    summary.topRooms.set(roomKey, room);
    summaries.set(actorKey, summary);
  }

  return [...summaries.values()]
    .map((summary) => ({
      kind: 'room_build' as const,
      at: summary.at,
      actorUserId: summary.actorUserId,
      actorDisplayName: summary.actorDisplayName,
      signupSource: null,
      sessionCount: null,
      roomCount: summary.topRooms.size,
      courseCount: null,
      claimCount: summary.claimCount,
      roomPublishCount: summary.roomPublishCount,
      coursePublishCount: null,
      attemptCount: null,
      completedCount: null,
      failedCount: null,
      abandonedCount: null,
      topRooms: [...summary.topRooms.values()]
        .sort(
          (left, right) =>
            compareIsoDesc(left.lastAt, right.lastAt) ||
            Number(right.publishCount ?? 0) - Number(left.publishCount ?? 0) ||
            Number(right.claimCount ?? 0) - Number(left.claimCount ?? 0)
        )
        .slice(0, TOP_REFERENCE_LIMIT)
        .map(stripRoomReferenceAccumulator),
      topCourses: [],
    }))
    .sort((left, right) => compareIsoDesc(left.at, right.at))
    .slice(0, RECENT_SUMMARY_LIMIT);
}

async function loadCourseBuildSummaries(
  env: Env,
  recentSinceIso: string
): Promise<LaunchStatsRecentSummary[]> {
  const rows = await env.DB.prepare(
    `
      SELECT
        course_versions.created_at AS at,
        course_versions.published_by_user_id AS actor_user_id,
        course_versions.published_by_display_name AS actor_display_name,
        course_versions.course_id AS course_id,
        COALESCE(course_versions.title, courses.published_title, courses.draft_title) AS course_title,
        course_versions.version AS course_version,
        course_room_refs.room_x AS room_x,
        course_room_refs.room_y AS room_y,
        course_room_refs.room_order AS room_order
      FROM course_versions
      JOIN courses ON courses.id = course_versions.course_id
      LEFT JOIN course_room_refs
        ON course_room_refs.course_id = course_versions.course_id
       AND course_room_refs.course_version = course_versions.version
      WHERE course_versions.published_by_display_name IS NOT NULL
        AND course_versions.created_at >= ?
        AND ${sqlLaunchActivityIsNotPlayfunIdentity(
          'course_versions.published_by_user_id',
          'course_versions.published_by_display_name'
        )}
      ORDER BY course_versions.created_at DESC, course_versions.course_id ASC, course_room_refs.room_order ASC
    `
  )
    .bind(recentSinceIso)
    .all<CourseBuildActivityRow>();

  const summaries = new Map<
    string,
    {
      at: string;
      actorUserId: string | null;
      actorDisplayName: string;
      courses: Map<string, CourseReferenceAccumulator>;
    }
  >();

  for (const row of rows.results) {
    if (!row.at || !row.actor_display_name) {
      continue;
    }

    const actorKey = buildActorKey(row.actor_user_id, row.actor_display_name);
    const summary =
      summaries.get(actorKey) ??
      {
        at: row.at,
        actorUserId: row.actor_user_id,
        actorDisplayName: row.actor_display_name,
        courses: new Map<string, CourseReferenceAccumulator>(),
      };

    summary.at = maxIso(summary.at, row.at);

    const course =
      summary.courses.get(row.course_id) ??
      {
        courseId: row.course_id,
        courseTitle: row.course_title,
        lastAt: row.at,
        latestVersion: Number(row.course_version),
        publishVersions: new Set<string>(),
        latestCoordinates: [],
      };

    const publishVersionKey = `${row.course_id}:v${Number(row.course_version)}`;
    course.publishVersions.add(publishVersionKey);

    if (row.at > course.lastAt) {
      course.lastAt = row.at;
      course.latestVersion = Number(row.course_version);
      course.latestCoordinates = [];
    }

    if (
      row.at === course.lastAt &&
      Number(row.course_version) === course.latestVersion &&
      row.room_x !== null &&
      row.room_y !== null
    ) {
      const nextCoordinate = {
        x: Number(row.room_x),
        y: Number(row.room_y),
        order: Number(row.room_order ?? course.latestCoordinates.length),
      };

      if (
        !course.latestCoordinates.some(
          (coordinate) => coordinate.x === nextCoordinate.x && coordinate.y === nextCoordinate.y
        )
      ) {
        course.latestCoordinates.push(nextCoordinate);
      }
    }

    if (!course.courseTitle && row.course_title) {
      course.courseTitle = row.course_title;
    }

    summary.courses.set(row.course_id, course);
    summaries.set(actorKey, summary);
  }

  return [...summaries.values()]
    .map((summary) => {
      const topCourses = [...summary.courses.values()]
        .sort(
          (left, right) =>
            compareIsoDesc(left.lastAt, right.lastAt) ||
            right.publishVersions.size - left.publishVersions.size ||
            left.courseId.localeCompare(right.courseId)
        )
        .slice(0, TOP_REFERENCE_LIMIT)
        .map<LaunchStatsRecentCourseReference>((course) => ({
          courseId: course.courseId,
          courseTitle: course.courseTitle,
          coordinates: [...course.latestCoordinates]
            .sort((left, right) => left.order - right.order || left.x - right.x || left.y - right.y)
            .map((coordinate) => ({ x: coordinate.x, y: coordinate.y })),
          publishCount: course.publishVersions.size,
        }));

      const coursePublishCount = [...summary.courses.values()].reduce(
        (total, course) => total + course.publishVersions.size,
        0
      );

      return {
        kind: 'course_build' as const,
        at: summary.at,
        actorUserId: summary.actorUserId,
        actorDisplayName: summary.actorDisplayName,
        signupSource: null,
        sessionCount: null,
        roomCount: null,
        courseCount: summary.courses.size,
        claimCount: null,
        roomPublishCount: null,
        coursePublishCount,
        attemptCount: null,
        completedCount: null,
        failedCount: null,
        abandonedCount: null,
        topRooms: [],
        topCourses,
      };
    })
    .sort((left, right) => compareIsoDesc(left.at, right.at))
    .slice(0, RECENT_SUMMARY_LIMIT);
}

function buildActorKey(actorUserId: string | null, actorDisplayName: string): string {
  return actorUserId?.trim() ? `user:${actorUserId}` : `name:${actorDisplayName.trim().toLowerCase()}`;
}

function stripRoomReferenceAccumulator(
  value: RoomReferenceAccumulator
): LaunchStatsRecentRoomReference {
  return {
    roomId: value.roomId,
    roomTitle: value.roomTitle,
    roomX: value.roomX,
    roomY: value.roomY,
    attemptCount: value.attemptCount,
    claimCount: value.claimCount,
    publishCount: value.publishCount,
  };
}

function compareIsoDesc(left: string, right: string): number {
  return right.localeCompare(left);
}

function maxIso(current: string, candidate: string): string {
  return candidate > current ? candidate : current;
}

function parseOptionalInteger(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

async function loadPartykitStatus(env: Env): Promise<LaunchStatsPartykitStatus> {
  if (!isPartykitConfigured(env)) {
    return {
      configured: false,
      reachable: false,
      error: null,
      stats: null,
    };
  }

  const statsUrl = buildPartykitStatsUrl(env);
  if (!statsUrl) {
    return {
      configured: false,
      reachable: false,
      error: null,
      stats: null,
    };
  }

  try {
    const response = await fetch(statsUrl, {
      headers: {
        'x-partykit-internal-token': env.PARTYKIT_INTERNAL_TOKEN!.trim(),
      },
    });

    if (!response.ok) {
      const text = (await response.text()).trim();
      return {
        configured: true,
        reachable: false,
        error: text || `PartyKit stats request failed with status ${response.status}.`,
        stats: null,
      };
    }

    return {
      configured: true,
      reachable: true,
      error: null,
      stats: (await response.json()) as PartyKitLaunchStats,
    };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      error: error instanceof Error ? error.message : 'Unknown PartyKit fetch failure.',
      stats: null,
    };
  }
}

function buildPartykitStatsUrl(env: Env): string | null {
  const rawHost = env.PARTYKIT_HOST?.trim();
  if (!rawHost) {
    return null;
  }

  const normalized = rawHost.replace(/\/+$/, '');
  const protocol =
    normalized.startsWith('http://') || normalized.startsWith('ws://') ? 'http' : 'https';
  const host = normalized.replace(/^(https?:\/\/|wss?:\/\/)/, '');
  const party = env.PARTYKIT_PARTY?.trim() || 'main';

  return `${protocol}://${host}/parties/${encodeURIComponent(party)}/${encodeURIComponent(
    METRICS_ROOM_ID
  )}/stats`;
}

async function countQuery(env: Env, query: string, bindings: unknown[] = []): Promise<number> {
  const prepared = env.DB.prepare(query);
  const row =
    bindings.length > 0
      ? await prepared.bind(...bindings).first<{ count: number | string | null }>()
      : await prepared.first<{ count: number | string | null }>();

  return Number(row?.count ?? 0);
}
