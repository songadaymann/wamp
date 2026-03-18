import type {
  LaunchStatsActivityWindow,
  LaunchStatsPartykitStatus,
  LaunchStatsResponse,
  LaunchStatsTotals,
  PartyKitLaunchStats,
} from '../../../admin/model';
import type { Env } from '../core/types';

const METRICS_ROOM_ID = '__launch-stats__';

export async function loadLaunchStats(env: Env): Promise<LaunchStatsResponse> {
  const now = new Date();
  const generatedAt = now.toISOString();
  const config = {
    emailConfigured: Boolean(env.RESEND_API_KEY?.trim()),
    debugMagicLinks: env.AUTH_DEBUG_MAGIC_LINKS === '1',
    testResetEnabled: env.ENABLE_TEST_RESET === '1',
    partykitConfigured: isPartykitConfigured(env),
  };

  const [totals, last5m, last15m, last60m, partykit] = await Promise.all([
    loadTotals(env, generatedAt),
    loadActivityWindow(env, minutesAgoIso(now, 5)),
    loadActivityWindow(env, minutesAgoIso(now, 15)),
    loadActivityWindow(env, minutesAgoIso(now, 60)),
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
    partykit,
  };
}

function isPartykitConfigured(env: Env): boolean {
  return Boolean(env.PARTYKIT_HOST?.trim() && env.PARTYKIT_INTERNAL_TOKEN?.trim());
}

function minutesAgoIso(base: Date, minutes: number): string {
  return new Date(base.getTime() - minutes * 60 * 1000).toISOString();
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
    countQuery(env, 'SELECT COUNT(*) AS count FROM users WHERE created_at >= ?', [sinceIso]),
    countQuery(env, 'SELECT COUNT(*) AS count FROM magic_link_tokens WHERE created_at >= ?', [sinceIso]),
    countQuery(env, 'SELECT COUNT(*) AS count FROM chat_messages WHERE created_at >= ?', [sinceIso]),
    countQuery(env, 'SELECT COUNT(*) AS count FROM room_versions WHERE created_at >= ?', [sinceIso]),
    countQuery(env, 'SELECT COUNT(*) AS count FROM room_runs WHERE started_at >= ?', [sinceIso]),
    countQuery(
      env,
      'SELECT COUNT(*) AS count FROM room_runs WHERE finished_at IS NOT NULL AND finished_at >= ?',
      [sinceIso]
    ),
    countQuery(env, 'SELECT COUNT(*) AS count FROM course_runs WHERE started_at >= ?', [sinceIso]),
    countQuery(
      env,
      'SELECT COUNT(*) AS count FROM course_runs WHERE finished_at IS NOT NULL AND finished_at >= ?',
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
