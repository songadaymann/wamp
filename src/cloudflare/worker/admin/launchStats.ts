import type {
  LaunchStatsActivityWindow,
  LaunchStatsRecentEvent,
  LaunchStatsPartykitStatus,
  LaunchStatsResponse,
  LaunchStatsTotals,
  PartyKitLaunchStats,
} from '../../../admin/model';
import type { Env } from '../core/types';
import {
  sqlHasPlayfunDisplayNamePrefix,
  sqlUserIdIsPlayfunOnly,
} from '../playfun/leaderboardIsolation';

const METRICS_ROOM_ID = '__launch-stats__';
const RECENT_EVENT_LIMIT = 120;
const RECENT_EVENT_WINDOW_DAYS = 7;
const ATTEMPT_BURST_MIN_ATTEMPTS = 3;
const ATTEMPT_BURST_WINDOW_HOURS = RECENT_EVENT_WINDOW_DAYS * 24;

export async function loadLaunchStats(env: Env): Promise<LaunchStatsResponse> {
  const now = new Date();
  const generatedAt = now.toISOString();
  const config = {
    emailConfigured: Boolean(env.RESEND_API_KEY?.trim()),
    debugMagicLinks: env.AUTH_DEBUG_MAGIC_LINKS === '1',
    testResetEnabled: env.ENABLE_TEST_RESET === '1',
    partykitConfigured: isPartykitConfigured(env),
  };

  const [totals, last5m, last15m, last60m, recentEvents, partykit] = await Promise.all([
    loadTotals(env, generatedAt),
    loadActivityWindow(env, minutesAgoIso(now, 5)),
    loadActivityWindow(env, minutesAgoIso(now, 15)),
    loadActivityWindow(env, minutesAgoIso(now, 60)),
    loadRecentEvents(env, generatedAt),
    loadPartykitStatus(env),
  ]);

  return {
    generatedAt,
    config,
    totals,
    activity: {
      last5m,
      last15m,
      last60m,
    },
    recentEvents,
    partykit,
  };
}

function isPartykitConfigured(env: Env): boolean {
  return Boolean(env.PARTYKIT_HOST?.trim() && env.PARTYKIT_INTERNAL_TOKEN?.trim());
}

function minutesAgoIso(base: Date, minutes: number): string {
  return new Date(base.getTime() - minutes * 60 * 1000).toISOString();
}

function daysAgoIso(base: Date, days: number): string {
  return new Date(base.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
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
    magicLinksCreated,
    chatMessages,
    roomPublishes,
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
    magicLinksCreated,
    chatMessages,
    roomPublishes,
    roomRunStarts,
    roomRunFinishes,
    courseRunStarts,
    courseRunFinishes,
  };
}

interface RoomClaimEventRow {
  at: string;
  actor_user_id: string | null;
  actor_display_name: string | null;
  room_id: string;
  room_title: string | null;
  room_x: number;
  room_y: number;
}

interface RoomPublishEventRow {
  at: string;
  actor_user_id: string | null;
  actor_display_name: string | null;
  room_id: string;
  room_title: string | null;
  room_x: number;
  room_y: number;
  room_version: number;
}

interface RoomAttemptBurstRow {
  at: string;
  actor_user_id: string;
  actor_display_name: string;
  room_id: string;
  room_title: string | null;
  room_x: number;
  room_y: number;
  room_version: number;
  attempt_count: number;
  completed_count: number;
}

interface RoomRunFinishRow {
  at: string;
  actor_user_id: string;
  actor_display_name: string;
  room_id: string;
  room_title: string | null;
  room_x: number;
  room_y: number;
  room_version: number;
  result: string;
}

async function loadRecentEvents(env: Env, nowIso: string): Promise<LaunchStatsRecentEvent[]> {
  const recentSinceIso = daysAgoIso(new Date(nowIso), RECENT_EVENT_WINDOW_DAYS);
  const attemptSinceIso = new Date(
    Date.parse(nowIso) - ATTEMPT_BURST_WINDOW_HOURS * 60 * 60 * 1000
  ).toISOString();

  const [claims, publishes, attemptBursts, runFinishes] = await Promise.all([
    env.DB.prepare(
      `
        SELECT
          rooms.claimed_at AS at,
          rooms.claimer_user_id AS actor_user_id,
          rooms.claimer_display_name AS actor_display_name,
          rooms.id AS room_id,
          COALESCE(rooms.published_title, rooms.draft_title) AS room_title,
          rooms.x AS room_x,
          rooms.y AS room_y
        FROM rooms
        WHERE rooms.claimed_at IS NOT NULL
          AND rooms.claimer_display_name IS NOT NULL
          AND rooms.claimed_at >= ?
          AND ${sqlLaunchActivityIsNotPlayfunIdentity(
            'rooms.claimer_user_id',
            'rooms.claimer_display_name'
          )}
        ORDER BY rooms.claimed_at DESC
        LIMIT ?
      `
    )
      .bind(recentSinceIso, RECENT_EVENT_LIMIT)
      .all<RoomClaimEventRow>(),
    env.DB.prepare(
      `
        SELECT
          room_versions.created_at AS at,
          room_versions.published_by_user_id AS actor_user_id,
          room_versions.published_by_display_name AS actor_display_name,
          room_versions.room_id AS room_id,
          COALESCE(room_versions.title, rooms.published_title, rooms.draft_title) AS room_title,
          rooms.x AS room_x,
          rooms.y AS room_y,
          room_versions.version AS room_version
        FROM room_versions
        JOIN rooms ON rooms.id = room_versions.room_id
        WHERE room_versions.published_by_display_name IS NOT NULL
          AND room_versions.created_at >= ?
          AND ${sqlLaunchActivityIsNotPlayfunIdentity(
            'room_versions.published_by_user_id',
            'room_versions.published_by_display_name'
          )}
        ORDER BY room_versions.created_at DESC
        LIMIT ?
      `
    )
      .bind(recentSinceIso, RECENT_EVENT_LIMIT)
      .all<RoomPublishEventRow>(),
    env.DB.prepare(
      `
        SELECT
          MAX(COALESCE(room_runs.finished_at, room_runs.started_at)) AS at,
          room_runs.user_id AS actor_user_id,
          room_runs.user_display_name AS actor_display_name,
          room_runs.room_id AS room_id,
          COALESCE(rooms.published_title, rooms.draft_title) AS room_title,
          room_runs.room_x AS room_x,
          room_runs.room_y AS room_y,
          room_runs.room_version AS room_version,
          COUNT(*) AS attempt_count,
          SUM(CASE WHEN room_runs.result = 'completed' THEN 1 ELSE 0 END) AS completed_count
        FROM room_runs
        LEFT JOIN rooms ON rooms.id = room_runs.room_id
        WHERE room_runs.started_at >= ?
          AND ${sqlLaunchActivityIsNotPlayfunIdentity(
            'room_runs.user_id',
            'room_runs.user_display_name'
          )}
        GROUP BY
          room_runs.user_id,
          room_runs.user_display_name,
          room_runs.room_id,
          room_runs.room_x,
          room_runs.room_y,
          room_runs.room_version,
          COALESCE(rooms.published_title, rooms.draft_title)
        HAVING COUNT(*) >= ?
        ORDER BY at DESC
        LIMIT ?
      `
    )
      .bind(attemptSinceIso, ATTEMPT_BURST_MIN_ATTEMPTS, RECENT_EVENT_LIMIT)
      .all<RoomAttemptBurstRow>(),
    env.DB.prepare(
      `
        SELECT
          room_runs.finished_at AS at,
          room_runs.user_id AS actor_user_id,
          room_runs.user_display_name AS actor_display_name,
          room_runs.room_id AS room_id,
          COALESCE(rooms.published_title, rooms.draft_title) AS room_title,
          room_runs.room_x AS room_x,
          room_runs.room_y AS room_y,
          room_runs.room_version AS room_version,
          room_runs.result AS result
        FROM room_runs
        LEFT JOIN rooms ON rooms.id = room_runs.room_id
        WHERE room_runs.finished_at IS NOT NULL
          AND room_runs.finished_at >= ?
          AND room_runs.result IN ('completed', 'abandoned', 'failed')
          AND ${sqlLaunchActivityIsNotPlayfunIdentity(
            'room_runs.user_id',
            'room_runs.user_display_name'
          )}
        ORDER BY room_runs.finished_at DESC
        LIMIT ?
      `
    )
      .bind(recentSinceIso, RECENT_EVENT_LIMIT)
      .all<RoomRunFinishRow>(),
  ]);

  const items: LaunchStatsRecentEvent[] = [];

  for (const row of claims.results) {
    if (!row.at || !row.actor_display_name) {
      continue;
    }

    items.push({
      kind: 'room_claim',
      at: row.at,
      actorUserId: row.actor_user_id,
      actorDisplayName: row.actor_display_name,
      roomId: row.room_id,
      roomTitle: row.room_title,
      roomX: Number(row.room_x),
      roomY: Number(row.room_y),
      roomVersion: null,
      result: null,
      attemptCount: null,
      completedCount: null,
    });
  }

  for (const row of publishes.results) {
    if (!row.at || !row.actor_display_name) {
      continue;
    }

    items.push({
      kind: 'room_publish',
      at: row.at,
      actorUserId: row.actor_user_id,
      actorDisplayName: row.actor_display_name,
      roomId: row.room_id,
      roomTitle: row.room_title,
      roomX: Number(row.room_x),
      roomY: Number(row.room_y),
      roomVersion: Number(row.room_version),
      result: null,
      attemptCount: null,
      completedCount: null,
    });
  }

  for (const row of attemptBursts.results) {
    if (!row.at || !row.actor_display_name) {
      continue;
    }

    items.push({
      kind: 'room_attempt_burst',
      at: row.at,
      actorUserId: row.actor_user_id,
      actorDisplayName: row.actor_display_name,
      roomId: row.room_id,
      roomTitle: row.room_title,
      roomX: Number(row.room_x),
      roomY: Number(row.room_y),
      roomVersion: Number(row.room_version),
      result: null,
      attemptCount: Number(row.attempt_count),
      completedCount: Number(row.completed_count),
    });
  }

  for (const row of runFinishes.results) {
    if (!row.at || !row.actor_display_name) {
      continue;
    }

    items.push({
      kind: 'room_run_finish',
      at: row.at,
      actorUserId: row.actor_user_id,
      actorDisplayName: row.actor_display_name,
      roomId: row.room_id,
      roomTitle: row.room_title,
      roomX: Number(row.room_x),
      roomY: Number(row.room_y),
      roomVersion: Number(row.room_version),
      result: row.result,
      attemptCount: null,
      completedCount: null,
    });
  }

  items.sort((left, right) => right.at.localeCompare(left.at));
  return items.slice(0, RECENT_EVENT_LIMIT);
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
