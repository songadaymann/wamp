import type { CourseSnapshot } from '../../../courses/model';
import type { RoomSnapshot } from '../../../persistence/roomModel';
import { COOP_ROOM_PRACTICE_MESSAGE, hasCoopPressurePlates } from '../../../placedObjects/coopPressurePlates';
import type { RoomDiscoveryEntry } from '../../../runs/model';
import { HttpError } from '../core/http';
import type { Env } from '../core/types';

/** Expressions are internal SQL column names, never user input. Match the shared object normalizer. */
function sqlHasCoopPlates(snapshotExpression: string): string {
  return `EXISTS (SELECT 1 FROM json_each(${snapshotExpression}, '$.placedObjects') coop_plate
    WHERE json_extract(coop_plate.value, '$.id') = 'floor_trigger'
      AND json_type(coop_plate.value, '$.coopPlate') = 'true'
      AND COALESCE(json_extract(coop_plate.value, '$.layer'), 'terrain') NOT IN ('background', 'foreground'))`;
}

export function assertSoloRoomRun(snapshot: RoomSnapshot): void {
  if (hasCoopPressurePlates(snapshot.placedObjects)) throw new HttpError(400, COOP_ROOM_PRACTICE_MESSAGE);
}

export async function assertSoloCourseRun(env: Env, course: CourseSnapshot): Promise<void> {
  // Read only the referenced versions' co-op flags, rather than hydrating every tile grid or history.
  for (let offset = 0; offset < course.roomRefs.length; offset += 40) {
    const refs = course.roomRefs.slice(offset, offset + 40);
    const row = await env.DB.prepare(`WITH wanted(room_id, room_version) AS (VALUES ${refs.map(() => '(?,?)').join(',')})
      SELECT wanted.room_id FROM wanted
      JOIN room_versions v ON v.room_id = wanted.room_id AND v.version = wanted.room_version
      WHERE ${sqlHasCoopPlates('v.snapshot_json')} LIMIT 1`)
      .bind(...refs.flatMap(ref => [ref.roomId, ref.roomVersion])).first();
    if (row) throw new HttpError(400, COOP_ROOM_PRACTICE_MESSAGE);
  }
}

export async function attachCoopDiscoveryFlags(env: Env, entries: RoomDiscoveryEntry[]): Promise<RoomDiscoveryEntry[]> {
  const cooperative = new Set<string>();
  const targets = entries.map(entry => entry.expandedRoom && entry.expandedRoom.source !== 'standalone_room'
    ? { kind: 'expanded_room', id: entry.expandedRoom.expandedRoomId,
      version: entry.expandedRoom.expandedRoomVersion ?? entry.roomVersion }
    : { kind: 'room', id: entry.roomId, version: entry.roomVersion });
  for (let offset = 0; offset < targets.length; offset += 30) {
    const page = targets.slice(offset, offset + 30);
    const rows = await env.DB.prepare(`WITH wanted(kind, content_id, version_key) AS (VALUES ${page.map(() => '(?,?,?)').join(',')})
      SELECT wanted.kind, wanted.content_id, wanted.version_key FROM wanted WHERE
        (wanted.kind = 'room' AND EXISTS (SELECT 1 FROM room_versions v
          WHERE v.room_id = wanted.content_id AND v.version = wanted.version_key AND ${sqlHasCoopPlates('v.snapshot_json')}))
        OR (wanted.kind = 'expanded_room' AND EXISTS (SELECT 1 FROM playable_content_index i
          JOIN playable_content_index_members m ON m.target_key = i.target_key
          JOIN room_versions v ON v.room_id = m.room_id AND v.version = m.room_version
          WHERE i.target_type = 'expanded_room' AND i.content_id = wanted.content_id
            AND i.version_key = wanted.version_key AND ${sqlHasCoopPlates('v.snapshot_json')}))`)
      .bind(...page.flatMap(target => [target.kind, target.id, target.version]))
      .all<{ kind: string; content_id: string; version_key: number }>();
    for (const row of rows.results) cooperative.add(`${row.kind}:${row.content_id}:${row.version_key}`);
  }
  return entries.map((entry, i) => ({ ...entry, cooperative: cooperative.has(`${targets[i].kind}:${targets[i].id}:${targets[i].version}`) }));
}
