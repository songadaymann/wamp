import type { DashboardStatsResponse } from '../../../dashboard/model';
import { jsonResponse } from '../core/http';
import type { Env } from '../core/types';

const MIN_COMPLETED_DASHBOARD_ELAPSED_MS = 500;
const DASHBOARD_HISTORY_DAYS = 30;

interface DashboardStatsRow {
  total_users: number | string | null;
  playfun_linked_users: number | string | null;
  non_playfun_users: number | string | null;
  total_rooms: number | string | null;
  unique_room_builders: number | string | null;
  multi_room_builders: number | string | null;
  completed_room_challenges: number | string | null;
}

interface DashboardDailyCountRow {
  day: string | null;
  count: number | string | null;
}

export async function handleDashboardStatsRequest(
  request: Request,
  env: Env
): Promise<Response> {
  return jsonResponse(request, await loadDashboardStats(env), {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

async function loadDashboardStats(env: Env): Promise<DashboardStatsResponse> {
  const historyStartIso = startOfUtcDayDaysAgo(DASHBOARD_HISTORY_DAYS - 1).toISOString();

  const [row, nonPlayfunRows, roomClaimRows] = await Promise.all([
    env.DB.prepare(
      `
        SELECT
          (SELECT COUNT(*) FROM users) AS total_users,
          (
            SELECT COUNT(*)
            FROM users u
            WHERE EXISTS (
              SELECT 1
              FROM playfun_user_links l
              WHERE l.user_id = u.id
            )
          ) AS playfun_linked_users,
          (
            SELECT COUNT(*)
            FROM users u
            WHERE NOT EXISTS (
              SELECT 1
              FROM playfun_user_links l
              WHERE l.user_id = u.id
            )
          ) AS non_playfun_users,
          (SELECT COUNT(*) FROM rooms) AS total_rooms,
          (
            SELECT COUNT(DISTINCT claimer_user_id)
            FROM rooms
            WHERE claimer_user_id IS NOT NULL
          ) AS unique_room_builders,
          (
            SELECT COUNT(*)
            FROM (
              SELECT claimer_user_id
              FROM rooms
              WHERE claimer_user_id IS NOT NULL
              GROUP BY claimer_user_id
              HAVING COUNT(*) > 1
            ) AS multi_room_builder_counts
          ) AS multi_room_builders,
          (
            SELECT COUNT(*)
            FROM (
              SELECT user_id, room_id, room_version
              FROM room_runs
              WHERE result = 'completed'
                AND elapsed_ms IS NOT NULL
                AND elapsed_ms >= ?
                AND NOT EXISTS (
                  SELECT 1
                  FROM playfun_user_links l
                  WHERE l.user_id = room_runs.user_id
                )
              GROUP BY user_id, room_id, room_version
            ) AS distinct_completed_room_runs
          ) AS completed_room_challenges
      `
    )
      .bind(MIN_COMPLETED_DASHBOARD_ELAPSED_MS)
      .first<DashboardStatsRow>(),
    env.DB.prepare(
      `
        SELECT
          substr(u.created_at, 1, 10) AS day,
          COUNT(*) AS count
        FROM users u
        WHERE u.created_at >= ?
          AND NOT EXISTS (
            SELECT 1
            FROM playfun_user_links l
            WHERE l.user_id = u.id
          )
        GROUP BY substr(u.created_at, 1, 10)
        ORDER BY day ASC
      `
    )
      .bind(historyStartIso)
      .all<DashboardDailyCountRow>(),
    env.DB.prepare(
      `
        SELECT
          substr(claimed_at, 1, 10) AS day,
          COUNT(*) AS count
        FROM rooms
        WHERE claimed_at IS NOT NULL
          AND claimed_at >= ?
        GROUP BY substr(claimed_at, 1, 10)
        ORDER BY day ASC
      `
    )
      .bind(historyStartIso)
      .all<DashboardDailyCountRow>(),
  ]);

  const nonPlayfunSignupsPerDay = createDailySeries(
    DASHBOARD_HISTORY_DAYS,
    nonPlayfunRows.results
  );
  const roomClaimsPerDay = createDailySeries(
    DASHBOARD_HISTORY_DAYS,
    roomClaimRows.results
  );

  return {
    generatedAt: new Date().toISOString(),
    users: {
      total: toCount(row?.total_users),
      playfunLinked: toCount(row?.playfun_linked_users),
      nonPlayfun: toCount(row?.non_playfun_users),
    },
    rooms: {
      totalBuilt: toCount(row?.total_rooms),
      uniqueBuilders: toCount(row?.unique_room_builders),
      buildersWithMultipleRooms: toCount(row?.multi_room_builders),
    },
    challenges: {
      completed: toCount(row?.completed_room_challenges),
    },
    history: {
      windowDays: DASHBOARD_HISTORY_DAYS,
      nonPlayfunSignupsPerDay,
      roomClaimsPerDay,
    },
  };
}

function toCount(value: number | string | null | undefined): number {
  return Number(value ?? 0);
}

function createDailySeries(
  days: number,
  rows: DashboardDailyCountRow[]
): DashboardStatsResponse['history']['nonPlayfunSignupsPerDay'] {
  const countsByDay = new Map<string, number>();
  for (const row of rows) {
    if (!row.day) {
      continue;
    }

    countsByDay.set(row.day, toCount(row.count));
  }

  const series: DashboardStatsResponse['history']['nonPlayfunSignupsPerDay'] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = startOfUtcDayDaysAgo(offset).toISOString().slice(0, 10);
    series.push({
      date: day,
      count: countsByDay.get(day) ?? 0,
    });
  }

  return series;
}

function startOfUtcDayDaysAgo(daysAgo: number): Date {
  const now = new Date();
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - daysAgo,
    0,
    0,
    0,
    0
  ));
}
