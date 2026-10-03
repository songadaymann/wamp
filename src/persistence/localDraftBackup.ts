import {
  cloneRoomSnapshot,
  createDefaultRoomRecord,
  normalizeRoomRecord,
  type RoomSnapshot,
} from './roomModel';
import { ROOM_STORAGE_PREFIX } from './browserStorage';

export interface RoomDraftBackupMetadata {
  userId: string | null;
  baseUpdatedAt: string | null;
}

// Page-exit handlers must finish the write synchronously; LocalRoomRepository's
// async save first awaits a load and may never resume when a phone discards a tab.
export function writeRoomDraftBackup(
  snapshot: RoomSnapshot,
  metadata: RoomDraftBackupMetadata,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): boolean {
  try {
    const target = storage ?? localStorage;
    const key = `${ROOM_STORAGE_PREFIX}${snapshot.id}`;
    const raw = target.getItem(key);
    let record = createDefaultRoomRecord(snapshot.id, snapshot.coordinates);
    if (raw) {
      try {
        record = normalizeRoomRecord(JSON.parse(raw), snapshot.id, snapshot.coordinates);
      } catch {
        // An unreadable older copy must not prevent a fresh backup.
      }
    }
    target.setItem(key, JSON.stringify({
      ...record,
      draft: {
        ...cloneRoomSnapshot(snapshot),
        status: 'draft',
        updatedAt: new Date().toISOString(),
      },
      localBackup: metadata,
    }));
    return true;
  } catch {
    return false;
  }
}

export function readRoomDraftBackupMetadata(
  roomId: string,
  storage?: Pick<Storage, 'getItem'>,
): RoomDraftBackupMetadata | null {
  try {
    const raw = (storage ?? localStorage).getItem(`${ROOM_STORAGE_PREFIX}${roomId}`);
    const metadata = raw ? JSON.parse(raw)?.localBackup : null;
    if (!metadata || (metadata.userId !== null && typeof metadata.userId !== 'string')
      || (metadata.baseUpdatedAt !== null && typeof metadata.baseUpdatedAt !== 'string')) {
      return null;
    }
    return { userId: metadata.userId, baseUpdatedAt: metadata.baseUpdatedAt };
  } catch {
    return null;
  }
}
