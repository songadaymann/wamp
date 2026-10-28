import { normalizeCourseSnapshot } from '../../../courses/model';
import { ROOM_VERSION_FACTS_VERSION } from '../../../persistence/roomVersionLineage';
import type { Env } from '../core/types';
import { parseStoredSnapshot } from '../rooms/store';
import { computeCourseWeightedChange, computeRoomWeightedChange } from './changeMetrics';
import { COURSE_SIGNIFICANT_CHANGE_THRESHOLD, ROOM_SIGNIFICANT_CHANGE_THRESHOLD } from './shared';

type Kind = 'room' | 'expanded_room';
interface VersionKey { id: string; version: number }
interface VersionRow { id: string; version: number; snapshot_json: string | null; change_from_previous: number | null }
export const ratingVersionIdentity = (id: string, version: number): string => JSON.stringify([id, version]);

/** Resolve immutable published versions to the same significant-change buckets as rating writes.
 * Batch history reads, using compact room facts instead of hydrating room snapshots when available.
 * Keep these separate from run/display versions: a small republish retains votes, not run metrics.
 */
export async function loadDiscoveryRatingVersionKeys(
  env: Env, kind: Kind, targets: readonly VersionKey[], persist = false,
): Promise<Map<string, number>> {
  const keys = new Map(targets.map(t => [ratingVersionIdentity(t.id, t.version), t.version]));
  const table = kind === 'room' ? 'room_versions' : 'expanded_room_versions';
  const idColumn = kind === 'room' ? 'room_id' : 'expanded_room_id';
  const missing = new Set(keys.keys());
  for (let offset = 0; offset < targets.length; offset += 40) {
    const batch = targets.slice(offset, offset + 40);
    const cached = await env.DB.prepare(`SELECT ${idColumn} AS id,version,rating_version_key FROM ${table}
      WHERE rating_version_key IS NOT NULL AND (${batch.map(() => `(${idColumn}=? AND version=?)`).join(' OR ')})`)
      .bind(...batch.flatMap(t => [t.id,t.version])).all<{ id: string; version: number; rating_version_key: number }>();
    for (const row of cached.results) {
      const key = ratingVersionIdentity(row.id,row.version);
      keys.set(key,row.rating_version_key); missing.delete(key);
    }
  }
  const ids = [...new Set(targets.filter(t => missing.has(ratingVersionIdentity(t.id,t.version))).map(t => t.id))];
  for (let offset = 0; offset < ids.length; offset += 40) {
    const batch = ids.slice(offset, offset + 40);
    const placeholders = batch.map(() => '?').join(',');
    const sql = kind === 'room' ? `SELECT v.room_id AS id, v.version,
      NULL AS snapshot_json,
      CASE WHEN f.facts_version = ${ROOM_VERSION_FACTS_VERSION} THEN f.change_from_previous ELSE NULL END AS change_from_previous
      FROM room_versions v LEFT JOIN room_version_facts f ON f.room_id = v.room_id AND f.version = v.version
      WHERE v.room_id IN (${placeholders}) ORDER BY v.room_id, v.version`
      : `SELECT expanded_room_id AS id, version, snapshot_json, NULL AS change_from_previous
        FROM expanded_room_versions WHERE expanded_room_id IN (${placeholders}) ORDER BY expanded_room_id, version`;
    const rows = (await env.DB.prepare(sql).bind(...batch).all<VersionRow>()).results;
    const updates = [];
    let previous: VersionRow | null = null, bucket = 0;
    for (const row of rows) {
      const changedId = row.id !== previous?.id;
      let change = changedId ? 1 : row.change_from_previous;
      if (change === null) {
        if (kind === 'room') {
          // Cold history is read one snapshot at a time: large old rooms must not
          // turn a 40-target metadata lookup into a D1 result-size failure.
          const [prior, current] = await Promise.all([
            env.DB.prepare('SELECT snapshot_json FROM room_versions WHERE room_id=? AND version=?')
              .bind(row.id,previous!.version).first<{ snapshot_json: string }>(),
            env.DB.prepare('SELECT snapshot_json FROM room_versions WHERE room_id=? AND version=?')
              .bind(row.id,row.version).first<{ snapshot_json: string }>(),
          ]);
          change = computeRoomWeightedChange(prior ? parseStoredSnapshot(prior.snapshot_json,row.id) : null,
            parseStoredSnapshot(current!.snapshot_json,row.id));
        } else {
          change = computeCourseWeightedChange(normalizeCourseSnapshot(JSON.parse(previous!.snapshot_json!), row.id),
            normalizeCourseSnapshot(JSON.parse(row.snapshot_json!), row.id));
        }
      }
      if (changedId || change >= (kind === 'room' ? ROOM_SIGNIFICANT_CHANGE_THRESHOLD : COURSE_SIGNIFICANT_CHANGE_THRESHOLD)) bucket = row.version;
      const key = ratingVersionIdentity(row.id, row.version);
      if (keys.has(key)) keys.set(key, bucket);
      if (persist) updates.push(env.DB.prepare(`UPDATE ${table} SET rating_version_key=? WHERE ${idColumn}=? AND version=? AND rating_version_key IS NULL`)
        .bind(bucket,row.id,row.version));
      previous = row;
    }
    for (let offset = 0; offset < updates.length; offset += 40) await env.DB.batch(updates.slice(offset,offset+40));
  }
  return keys;
}
