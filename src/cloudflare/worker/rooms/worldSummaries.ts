import type { WorldRoomSummary } from '../../../persistence/worldModel';
import type { Env } from '../core/types';
import { storedRoomProtectionSql } from './protection';

export async function loadWorldRoomSummariesInBounds(
  env: Env,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): Promise<WorldRoomSummary[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        CASE WHEN ${storedRoomProtectionSql()} THEN 1 ELSE 0 END AS is_minted,
        id,
        x,
        y,
        CASE WHEN published_json IS NOT NULL THEN 'published' ELSE 'claimed_unpublished' END AS state,
        CASE WHEN published_json IS NOT NULL THEN published_title ELSE draft_title END AS title,
        CASE WHEN published_json IS NOT NULL
          THEN json_extract(published_json, '$.background')
          ELSE json_extract(draft_json, '$.background') END AS background,
        CASE WHEN published_json IS NOT NULL
          THEN json_extract(published_json, '$.goal.type')
          ELSE json_extract(draft_json, '$.goal.type') END AS goal_type,
        CAST(CASE WHEN published_json IS NOT NULL
          THEN json_extract(published_json, '$.version')
          ELSE json_extract(draft_json, '$.version') END AS INTEGER) AS version,
        CASE WHEN published_json IS NOT NULL THEN json_extract(published_json, '$.publishedAt') ELSE NULL END AS published_at,
        CASE WHEN published_json IS NOT NULL
          THEN json_extract(published_json, '$.updatedAt')
          ELSE json_extract(draft_json, '$.updatedAt') END AS preview_updated_at,
        claimer_user_id,
        claimer_display_name,
        last_published_by_user_id,
        last_published_by_display_name
      FROM rooms
      WHERE x BETWEEN ? AND ?
        AND y BETWEEN ? AND ?
        AND (published_json IS NOT NULL OR (claimer_user_id IS NOT NULL AND claimed_at IS NOT NULL))
    `,
  ).bind(minX, maxX, minY, maxY).all<{
    is_minted: number;
    id: string;
    x: number;
    y: number;
    state: 'published' | 'claimed_unpublished';
    title: string | null;
    background: string | null;
    goal_type: WorldRoomSummary['goalType'];
    version: number | null;
    published_at: string | null;
    preview_updated_at: string | null;
    claimer_user_id: string | null;
    claimer_display_name: string | null;
    last_published_by_user_id: string | null;
    last_published_by_display_name: string | null;
  }>();
  return result.results.map((row) => ({
    ...(row.is_minted === 1 ? { isMinted: true } : {}),
    id: row.id,
    coordinates: { x: Number(row.x), y: Number(row.y) },
    title: row.title,
    state: row.state,
    background: row.background,
    goalType: row.goal_type,
    version: row.version === null ? null : Number(row.version),
    publishedAt: row.published_at,
    previewUpdatedAt: row.preview_updated_at,
    creatorUserId: row.claimer_user_id ?? (row.state === 'published' ? row.last_published_by_user_id : null),
    creatorDisplayName: row.claimer_display_name ?? (row.state === 'published' ? row.last_published_by_display_name : null),
    publishedByUserId: row.state === 'published' ? row.last_published_by_user_id : null,
    publishedByDisplayName: row.state === 'published' ? row.last_published_by_display_name : null,
    course: null,
    expandedRoom: null,
  }));
}
