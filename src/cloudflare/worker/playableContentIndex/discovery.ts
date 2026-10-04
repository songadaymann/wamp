import type { RoomDifficulty, RoomDiscoverySort } from '../../../runs/model';
import type { ExpandedRoomSource } from '../../../expandedRooms/model';
import type { Env } from '../core/types';
import { DISCOVERY_RUN_METRICS_CTE, POPULAR_WINDOW_MS } from './runMetrics';

export interface IndexedDiscoveryRow {
  target_type: 'room' | 'expanded_room';
  content_id: string;
  version_key: number | string;
  representative_room_id: string;
  representative_room_version: number | string;
  room_x: number | string;
  room_y: number | string;
  builder_user_id: string | null;
  builder_display_name: string | null;
  title: string | null;
  goal_type: string | null;
  published_at: string;
  first_published_at: string | null;
  cell_count: number | string;
  anchor_x: number | string;
  anchor_y: number | string;
  source_type: ExpandedRoomSource;
  legacy_course_id: string | null;
  canonical_room_version: number | string | null;
  featured_at: string | null;
  quality_adjusted_average: number | string | null;
  quality_vote_count: number | string | null;
  consensus_difficulty: string | null;
  difficulty_vote_count: number | string | null;
  difficulty_source: 'votes' | 'measured' | null;
  measured_players: number | string | null;
  recent_players: number | string | null;
}

export async function loadIndexedDiscoveryRows(
  env: Env, difficulty: RoomDifficulty | null, limit: number, sort: RoomDiscoverySort,
  includeAll: boolean, offset: number,
): Promise<IndexedDiscoveryRow[] | null> {
  const enabled = /^(1|true|on)$/i.test(env.PLAYABLE_CONTENT_INDEX_READS?.trim() ?? '');
  if (!enabled || !['newest', 'featured', 'quality', 'popular'].includes(sort)) return null;
  const order = sort === 'popular'
    ? 'index_row.recent_players DESC, index_row.first_published_at DESC, index_row.published_at DESC, index_row.target_key ASC'
    : sort === 'newest'
      ? 'index_row.first_published_at DESC, index_row.published_at DESC, index_row.target_key ASC'
      : sort === 'quality'
        ? 'index_row.quality_adjusted_average DESC, index_row.quality_vote_count DESC, index_row.published_at DESC, index_row.target_key ASC'
        : 'index_row.featured_at DESC, index_row.quality_adjusted_average DESC, index_row.quality_vote_count DESC, index_row.published_at DESC, index_row.target_key ASC';
  try {
    const rows = await env.DB.prepare(`
      WITH ${DISCOVERY_RUN_METRICS_CTE}, resolved AS (
        SELECT current_target.*,
          CASE WHEN current_target.difficulty_vote_count >= 3 AND current_target.consensus_difficulty IS NOT NULL
            THEN current_target.consensus_difficulty
            ELSE COALESCE(metrics.measured_difficulty, current_target.consensus_difficulty) END AS effective_difficulty,
          CASE WHEN current_target.difficulty_vote_count >= 3 AND current_target.consensus_difficulty IS NOT NULL THEN 'votes'
            WHEN metrics.measured_difficulty IS NOT NULL THEN 'measured'
            WHEN current_target.consensus_difficulty IS NOT NULL THEN 'votes' ELSE NULL END AS difficulty_source,
          COALESCE(metrics.measured_players, 0) AS measured_players,
          COALESCE(metrics.recent_players, 0) AS recent_players
        FROM playable_content_index current_target
        LEFT JOIN run_metrics metrics
          ON metrics.target_key = current_target.target_key AND metrics.version_key = current_target.version_key
      )
      SELECT
        index_row.target_type,
        index_row.content_id,
        index_row.version_key,
        index_row.representative_room_id,
        index_row.room_x,
        index_row.room_y,
        index_row.builder_user_id,
        index_row.builder_display_name,
        index_row.title,
        index_row.goal_type,
        index_row.published_at,
        index_row.first_published_at,
        index_row.cell_count,
        index_row.anchor_x,
        index_row.anchor_y,
        index_row.source_type,
        index_row.legacy_course_id,
        index_row.canonical_room_version,
        index_row.featured_at,
        index_row.quality_adjusted_average,
        index_row.quality_vote_count,
        index_row.difficulty_vote_count,
        index_row.difficulty_source,
        index_row.measured_players,
        index_row.recent_players,
        COALESCE(member.room_version, index_row.version_key) AS representative_room_version,
        index_row.effective_difficulty AS consensus_difficulty
      FROM resolved index_row
      LEFT JOIN playable_content_index_members member
        ON member.target_key = index_row.target_key AND member.room_id = index_row.representative_room_id
      WHERE (? = 1 OR index_row.goal_type IS NOT NULL)
        AND (? IS NULL OR index_row.effective_difficulty = ?)
        AND (? = 0 OR index_row.featured_at IS NOT NULL)
      ORDER BY ${order} LIMIT ? OFFSET ?
    `).bind(new Date(Date.now() - POPULAR_WINDOW_MS).toISOString(), includeAll ? 1 : 0,
      difficulty, difficulty, sort === 'featured' ? 1 : 0, limit + 1, offset).all<IndexedDiscoveryRow>();
    return rows.results;
  } catch (error) {
    if (/no such table: (playable_content_index|discovery_run_players)/i.test(String(error))) {
      console.warn('Discovery index is unavailable; falling back to legacy discovery reads.');
      return null;
    }
    throw error;
  }
}
