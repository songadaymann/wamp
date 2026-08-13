import type { MapScreenshotDb } from './tiles';

/** Dashboard-style counts used on the screenshot info overlay. */
export interface MapScreenshotStats {
  players: number;
  builders: number;
  rooms: number;
}

/**
 * Players = non-legacy users (not linked in playfun_user_links).
 * Builders = distinct claimer_user_id on rooms.
 * Rooms = total rooms rows.
 */
export async function loadMapScreenshotStats(db: MapScreenshotDb): Promise<MapScreenshotStats> {
  const row = await db.prepare(
    `
      SELECT
        (
          SELECT COUNT(*)
          FROM users u
          WHERE NOT EXISTS (
            SELECT 1
            FROM playfun_user_links l
            WHERE l.user_id = u.id
          )
        ) AS players,
        (
          SELECT COUNT(DISTINCT claimer_user_id)
          FROM rooms
          WHERE claimer_user_id IS NOT NULL
        ) AS builders,
        (SELECT COUNT(*) FROM rooms) AS rooms
    `,
  ).bind().first<{
    players: number | string | null;
    builders: number | string | null;
    rooms: number | string | null;
  }>();

  return {
    players: toCount(row?.players),
    builders: toCount(row?.builders),
    rooms: toCount(row?.rooms),
  };
}

function toCount(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}
