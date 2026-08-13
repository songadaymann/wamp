import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LaunchStatsActivityWindow } from '../../../admin/model';
import type { Env } from '../core/types';
import { loadLaunchStats } from './launchStats';
import {
  createRecordingDatabase,
  normalizeSql,
  readRepoFile,
  readTypeScriptImportClosure,
  type RecordedD1Query,
} from './t14ContractTestSupport';

const NOW = '2026-08-13T16:00:00.000Z';
const ZERO_ACTIVITY: LaunchStatsActivityWindow = {
  newUsers: 0,
  logins: 0,
  guestVisitors: 0,
  guestVisitHeartbeats: 0,
  guestPlayBuildVisitors: 0,
  guestPlaySeconds: 0,
  guestEditSeconds: 0,
  magicLinksCreated: 0,
  chatMessages: 0,
  roomClaims: 0,
  roomPublishes: 0,
  coursePublishes: 0,
  expandedRoomPublishes: 0,
  roomRunStarts: 0,
  roomRunFinishes: 0,
  courseRunStarts: 0,
  courseRunFinishes: 0,
  expandedRoomRunStarts: 0,
  expandedRoomRunFinishes: 0,
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('T14 launch statistics response contract', () => {
  it('preserves the complete zero-data payload, activity ranges, defaults, and query budget', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const { env, appQueries, jamQueries } = createEmptyLaunchEnv();

    const response = await loadLaunchStats(env);

    expect(response).toEqual({
      generatedAt: NOW,
      config: {
        emailConfigured: false,
        debugMagicLinks: false,
        testResetEnabled: false,
        partykitConfigured: false,
      },
      totals: {
        users: 0,
        jamRegistrations: 0,
        activeSessions: 0,
        guestVisitors: 0,
        guestVisits: 0,
        rooms: 0,
        publishedRooms: 0,
        roomRuns: 0,
        courses: 0,
        courseRuns: 0,
        expandedRooms: 0,
        expandedRoomRuns: 0,
        chatMessages: 0,
        agents: 0,
        agentTokens: 0,
      },
      activity: {
        last5m: ZERO_ACTIVITY,
        last15m: ZERO_ACTIVITY,
        last60m: ZERO_ACTIVITY,
        defaultRangeKey: 'last24h',
        ranges: [
          {
            key: 'last12h',
            label: 'Last 12h',
            description: 'the last 12 hours',
            since: '2026-08-13T04:00:00.000Z',
            activity: ZERO_ACTIVITY,
            recentSummaries: [],
          },
          {
            key: 'last24h',
            label: 'Last 24h',
            description: 'the last 24 hours',
            since: '2026-08-12T16:00:00.000Z',
            activity: ZERO_ACTIVITY,
            recentSummaries: [],
          },
          {
            key: 'last3d',
            label: 'Last 3d',
            description: 'the last 3 days',
            since: '2026-08-10T16:00:00.000Z',
            activity: ZERO_ACTIVITY,
            recentSummaries: [],
          },
          {
            key: 'last7d',
            label: 'Last 7d',
            description: 'the last 7 days',
            since: '2026-08-06T16:00:00.000Z',
            activity: ZERO_ACTIVITY,
            recentSummaries: [],
          },
          {
            key: 'last30d',
            label: 'Last 30d',
            description: 'the last 30 days',
            since: '2026-07-14T16:00:00.000Z',
            activity: ZERO_ACTIVITY,
            recentSummaries: [],
          },
        ],
      },
      recentSummaries: [],
      partykit: {
        configured: false,
        reachable: false,
        error: null,
        stats: null,
      },
    });

    expect(appQueries).toHaveLength(201);
    expect(jamQueries).toHaveLength(1);
    expect(jamQueries[0]).toEqual({
      database: 'jam',
      sql: 'SELECT COUNT(*) AS count FROM jam_registrations WHERE jam_slug = ?',
      bindings: ['solo-room-jam-2026-07'],
    });
    expect(appQueries.filter((query) => query.bindings.includes(80))).toHaveLength(20);
    expect(appQueries.filter((query) => query.bindings.includes(3))).toHaveLength(5);
  });

  it.each([
    {
      label: 'rejected fetch',
      fetchImpl: vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
        throw new Error('fixture PartyKit offline');
      }),
      expectedError: 'fixture PartyKit offline',
    },
    {
      label: 'non-ok response',
      fetchImpl: vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response('fixture denied', { status: 503 })),
      expectedError: 'fixture denied',
    },
  ])('fails open when PartyKit returns a $label', async ({ fetchImpl, expectedError }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    vi.stubGlobal('fetch', fetchImpl);
    const { env } = createEmptyLaunchEnv({
      PARTYKIT_HOST: 'wss://presence.example.test///',
      PARTYKIT_PARTY: 'safety party',
      PARTYKIT_INTERNAL_TOKEN: '  fixture-token  ',
    });

    const response = await loadLaunchStats(env);

    expect(response.totals.users).toBe(0);
    expect(response.config.partykitConfigured).toBe(true);
    expect(response.partykit).toEqual({
      configured: true,
      reachable: false,
      error: expectedError,
      stats: null,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(
      'https://presence.example.test/parties/safety%20party/__launch-stats__/stats',
    );
    expect(init).toEqual({
      headers: { 'x-partykit-internal-token': 'fixture-token' },
    });
  });
});

describe('T14 launch statistics route and SQL source contract', () => {
  const routeSource = readRepoFile('src/cloudflare/worker/admin/routes.ts');
  const launchClosure = readTypeScriptImportClosure('src/cloudflare/worker/admin/launchStats.ts');

  it('keeps the launch route read-only and admin-protected', () => {
    expect(routeSource).toMatch(
      /url\.pathname === '\/api\/admin\/launch-stats'\s*&&\s*request\.method === 'GET'/,
    );
    expect(routeSource).toContain("requireAdminRequest(env, request, 'read launch stats')");
    expect(routeSource).toContain('jsonResponse(request, await loadLaunchStats(env))');
  });

  it('pins launch constants and the public response model fields', () => {
    for (const sourceLine of [
      "const METRICS_ROOM_ID = '__launch-stats__';",
      'const RECENT_SUMMARY_LIMIT = 80;',
      'const TOP_REFERENCE_LIMIT = 3;',
      "const DEFAULT_ACTIVITY_RANGE_KEY: LaunchStatsActivityRangeKey = 'last24h';",
      "{ key: 'last12h', label: 'Last 12h', description: 'the last 12 hours', hours: 12 }",
      "{ key: 'last24h', label: 'Last 24h', description: 'the last 24 hours', hours: 24 }",
      "{ key: 'last3d', label: 'Last 3d', description: 'the last 3 days', hours: 72 }",
      "{ key: 'last7d', label: 'Last 7d', description: 'the last 7 days', hours: 168 }",
      "{ key: 'last30d', label: 'Last 30d', description: 'the last 30 days', hours: 720 }",
    ]) {
      expect(launchClosure).toContain(sourceLine);
    }

    const modelSource = readRepoFile('src/admin/model.ts');
    expect(modelSource).toMatch(
      /export interface LaunchStatsResponse \{\s*generatedAt: string;\s*config: LaunchStatsConfig;\s*totals: LaunchStatsTotals;\s*activity: LaunchStatsActivity;\s*recentSummaries: LaunchStatsRecentSummary\[\];\s*partykit: LaunchStatsPartykitStatus;\s*\}/,
    );
  });

  it('pins the D1 table surface and expanded-room compatibility fallbacks', () => {
    for (const table of [
      'users',
      'sessions',
      'guest_visits',
      'rooms',
      'room_versions',
      'room_runs',
      'courses',
      'course_versions',
      'course_room_refs',
      'course_runs',
      'expanded_rooms',
      'expanded_room_versions',
      'expanded_room_runs',
      'chat_messages',
      'magic_link_tokens',
      'agents',
      'agent_tokens',
    ]) {
      expect(normalizeSql(launchClosure)).toMatch(
        new RegExp(`\\b(?:FROM|JOIN) ${table}\\b`, 'i'),
      );
    }
    expect(launchClosure).toContain('isExpandedRoomSchemaMissingError(error)');
    expect(launchClosure).toContain("'SELECT COUNT(*) AS count FROM course_runs'");
  });
});

function createEmptyLaunchEnv(overrides: Partial<Env> = {}): {
  env: Env;
  appQueries: RecordedD1Query[];
  jamQueries: RecordedD1Query[];
} {
  const appQueries: RecordedD1Query[] = [];
  const jamQueries: RecordedD1Query[] = [];
  return {
    env: {
      ASSETS: { fetch: async () => new Response() },
      DB: createRecordingDatabase('app', appQueries),
      JAM_DB: createRecordingDatabase('jam', jamQueries),
      ...overrides,
    },
    appQueries,
    jamQueries,
  };
}
