import { listEmbeddedCustomSpriteIds, maskBlockedCustomArt } from '../../../customSprites/blockedArt';
import type { RoomSnapshot } from '../../../persistence/roomModel';
import type { Env } from '../core/types';

/**
 * Share and Wamp-O-Gram images never show a community sprite an admin blocked (F189). One query
 * covers every snapshot drawn together; snapshots without community art cost no query.
 */
export async function maskBlockedArtInSnapshots(env: Env, snapshots: readonly RoomSnapshot[]): Promise<RoomSnapshot[]> {
  const ids = [...new Set(snapshots.flatMap(listEmbeddedCustomSpriteIds))];
  if (ids.length === 0) return [...snapshots];
  const rows = await env.DB.prepare(`SELECT id FROM custom_sprites WHERE status = 'blocked' AND id IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(ids)).all<{ id: string }>();
  const blocked = new Set(rows.results.map((row) => row.id));
  return snapshots.map((snapshot) => maskBlockedCustomArt(snapshot, blocked));
}
