import { ROOM_STORAGE_PREFIX } from '../persistence/browserStorage';
import { roomSnapshotUsesCustomSprite } from './usage';

export function isCustomSpriteUsedInLocalRoomStorage(
  spriteId: string,
  storage: Storage = window.localStorage,
): boolean {
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(ROOM_STORAGE_PREFIX)) {
      continue;
    }

    const raw = storage.getItem(key);
    if (!raw || !raw.includes(spriteId)) {
      continue;
    }

    try {
      const record = JSON.parse(raw) as { draft?: unknown; published?: unknown };
      if (
        roomSnapshotUsesCustomSprite(record.draft, spriteId)
        || roomSnapshotUsesCustomSprite(record.published, spriteId)
      ) {
        return true;
      }
    } catch {
      // An unrelated malformed local room should not prevent checking the rest.
    }
  }

  return false;
}
