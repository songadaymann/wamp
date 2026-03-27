import type { DashboardStatsResponse } from '../../../dashboard/model';
import { jsonResponse } from '../core/http';
import type { Env } from '../core/types';

const MIN_COMPLETED_DASHBOARD_ELAPSED_MS = 500;

interface DashboardStatsRow {
  total_users: number | string | null;
  playfun_linked_users: number | string | null;
  non_playfun_users: number | string | null;
  total_rooms: number | string | null;
  unique_room_builders: number | string | null;
  multi_room_builders: number | string | null;
  completed_room_challenges: number | string | null;
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
  const row = await env.DB.prepare(
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
            GROUP BY user_id, room_id, room_version
          ) AS distinct_completed_room_runs
        ) AS completed_room_challenges
    `
  )
    .bind(MIN_COMPLETED_DASHBOARD_ELAPSED_MS)
    .first<DashboardStatsRow>();

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
  };
}

function toCount(value: number | string | null | undefined): number {
  return Number(value ?? 0);
}
