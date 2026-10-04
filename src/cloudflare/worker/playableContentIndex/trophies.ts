import type { TrophyAwardSummary, TrophyContentType } from '../../../progression/model';
import type { ContentTrophyRow, Env } from '../core/types';

interface ExpandedTarget { expandedRoomId: string; expandedRoomVersion: number }
export function expandedTrophyKey(id: string, version: number): string { return id + ':' + version; }

/** Prefer an expanded award over its legacy-course mirror, always on the exact version. */
export async function loadExpandedDiscoveryTrophies(
  env: Env, targets: ExpandedTarget[],
): Promise<Map<string, TrophyAwardSummary>> {
  const trophies = new Map<string, TrophyAwardSummary>();
  for (let offset = 0; offset < targets.length; offset += 24) {
    const batch = targets.slice(offset, offset + 24);
    const where = batch.map(() => `((content_type = 'expanded_room' AND content_id = ? AND version_key = ?)
      OR (content_type = 'course' AND 'course:' || content_id = ? AND version_key = ?))`).join(' OR ');
    const values = batch.flatMap(target => [target.expandedRoomId, target.expandedRoomVersion,
      target.expandedRoomId, target.expandedRoomVersion]);
    const rows = await env.DB.prepare(`SELECT * FROM content_trophies WHERE ${where}
      ORDER BY (content_type = 'expanded_room') DESC, awarded_at DESC`).bind(...values).all<ContentTrophyRow>();
    for (const row of rows.results) {
      const id = row.content_type === 'course' ? 'course:' + row.content_id : row.content_id;
      const key = expandedTrophyKey(id, Number(row.version_key));
      if (!trophies.has(key)) trophies.set(key, {
        contentType: row.content_type as TrophyContentType, contentId: row.content_id, versionKey: Number(row.version_key),
        trophyType: row.trophy_type, awardedAt: row.awarded_at,
      });
    }
  }
  return trophies;
}
