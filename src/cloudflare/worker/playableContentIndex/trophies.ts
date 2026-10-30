import { loadDiscoveryRatingVersionKeys, ratingVersionIdentity } from '../progression/discoveryRatingWindows';
import type { TrophyAwardSummary, TrophyContentType } from '../../../progression/model';
import type { ContentTrophyRow, Env } from '../core/types';

interface ExpandedTarget { expandedRoomId: string; expandedRoomVersion: number }
export function expandedTrophyKey(id: string, version: number): string { return id + ':' + version; }

/** Prefer an expanded award over its legacy-course mirror, with quality awards on the rating bucket and other awards on the exact version. */
export async function loadExpandedDiscoveryTrophies(
  env: Env, targets: ExpandedTarget[],
): Promise<Map<string, TrophyAwardSummary>> {
  const trophies = new Map<string, TrophyAwardSummary>();
  for (let offset = 0; offset < targets.length; offset += 16) {
    const batch = targets.slice(offset, offset + 16);
    const buckets = await loadDiscoveryRatingVersionKeys(env, 'expanded_room', batch.map(t => ({ id: t.expandedRoomId, version: t.expandedRoomVersion })));
    const where = batch.map(() => `((content_type = 'expanded_room' AND content_id = ? AND ((trophy_type = 'quality' AND version_key = ?) OR (trophy_type <> 'quality' AND version_key = ?)))
      OR (content_type = 'course' AND 'course:' || content_id = ? AND ((trophy_type = 'quality' AND version_key = ?) OR (trophy_type <> 'quality' AND version_key = ?))))`).join(' OR ');
    const values = batch.flatMap(target => {
      const bucket = buckets.get(ratingVersionIdentity(target.expandedRoomId, target.expandedRoomVersion)) ?? target.expandedRoomVersion;
      return [target.expandedRoomId, bucket, target.expandedRoomVersion, target.expandedRoomId, bucket, target.expandedRoomVersion];
    });
    const rows = await env.DB.prepare(`SELECT * FROM content_trophies WHERE ${where}
      ORDER BY (content_type = 'expanded_room') DESC, awarded_at DESC`).bind(...values).all<ContentTrophyRow>();
    for (const row of rows.results) {
      const id = row.content_type === 'course' ? 'course:' + row.content_id : row.content_id;
      for (const target of batch) {
        if (target.expandedRoomId !== id || Number(row.version_key) !== (row.trophy_type === 'quality'
          ? buckets.get(ratingVersionIdentity(id, target.expandedRoomVersion)) : target.expandedRoomVersion)) continue;
        const key = expandedTrophyKey(id, target.expandedRoomVersion);
        if (!trophies.has(key)) trophies.set(key, {
          contentType: row.content_type as TrophyContentType, contentId: row.content_id, versionKey: Number(row.version_key),
          trophyType: row.trophy_type, awardedAt: row.awarded_at,
        });
      }
    }
  }
  return trophies;
}
