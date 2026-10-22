import { buildCustomSpriteObjectId } from '../../../customSprites/model';
import { roomSnapshotUsesCustomSprite } from '../../../customSprites/usage';
import type { Env } from '../core/types';

interface StoredRoomUsageCandidate {
  draft_json: string;
  published_json: string | null;
}

interface StoredGuestRoomUsageCandidate {
  snapshot_json: string;
}

/**
 * Only rooms that contain one of the two exact JSON tokens a use can produce are read back and
 * checked: a placed object (`"custom_sprite:<id>"`) or a tile made from the sprite
 * (`"sourceSpriteId":"<id>"`). Matching the bare id let a one-letter id return almost every
 * room (F411).
 */
export async function isCustomSpriteUsedInStoredRooms(env: Env, spriteId: string): Promise<boolean> {
  const objectToken = `"${buildCustomSpriteObjectId(spriteId)}"`;
  const tileToken = `"sourceSpriteId":"${spriteId}"`;
  const [roomRows, guestRows] = await Promise.all([
    env.DB.prepare(
      `
        SELECT draft_json, published_json
        FROM rooms
        WHERE instr(draft_json, ?1) > 0 OR instr(draft_json, ?2) > 0
           OR instr(COALESCE(published_json, ''), ?1) > 0 OR instr(COALESCE(published_json, ''), ?2) > 0
      `,
    )
      .bind(objectToken, tileToken)
      .all<StoredRoomUsageCandidate>(),
    env.DB.prepare(
      `
        SELECT snapshot_json
        FROM guest_room_drafts
        WHERE status = 'active'
          AND (instr(snapshot_json, ?1) > 0 OR instr(snapshot_json, ?2) > 0)
      `,
    )
      .bind(objectToken, tileToken)
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
