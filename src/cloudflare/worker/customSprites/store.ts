import { roomSnapshotUsesCustomSprite } from '../../../customSprites/usage';
import type { Env } from '../core/types';

interface StoredRoomUsageCandidate {
  draft_json: string;
  published_json: string | null;
}

interface StoredGuestRoomUsageCandidate {
  snapshot_json: string;
}

export async function isCustomSpriteUsedInStoredRooms(env: Env, spriteId: string): Promise<boolean> {
  const [roomRows, guestRows] = await Promise.all([
    env.DB.prepare(
      `
        SELECT draft_json, published_json
        FROM rooms
        WHERE instr(draft_json, ?) > 0
           OR instr(COALESCE(published_json, ''), ?) > 0
      `,
    )
      .bind(spriteId, spriteId)
      .all<StoredRoomUsageCandidate>(),
    env.DB.prepare(
      `
        SELECT snapshot_json
        FROM guest_room_drafts
        WHERE status = 'active'
          AND instr(snapshot_json, ?) > 0
      `,
    )
      .bind(spriteId)
      .all<StoredGuestRoomUsageCandidate>(),
  ]);

  for (const row of roomRows.results) {
    if (
      storedSnapshotUsesCustomSprite(row.draft_json, spriteId)
      || storedSnapshotUsesCustomSprite(row.published_json, spriteId)
    ) {
      return true;
    }
  }

  return guestRows.results.some((row) => storedSnapshotUsesCustomSprite(row.snapshot_json, spriteId));
}

function storedSnapshotUsesCustomSprite(raw: string | null, spriteId: string): boolean {
  if (!raw) {
    return false;
  }

  try {
    return roomSnapshotUsesCustomSprite(JSON.parse(raw), spriteId);
  } catch {
    return false;
  }
}
