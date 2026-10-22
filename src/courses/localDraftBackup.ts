import { cloneCourseSnapshot, normalizeCourseSnapshot, type CourseSnapshot } from './model';
import { cloneRoomSnapshot, type RoomSnapshot } from '../persistence/roomModel';
import { LAYER_NAMES, ROOM_HEIGHT, ROOM_WIDTH } from '../config';

export const EXPANDED_DRAFT_BACKUP_PREFIX = 'wamp:expanded-draft-backup:v1:';
interface SnapshotBase { id: string; updatedAt: string; version: number }
interface DraftBackup<T> {
  schema: 1;
  snapshot: T;
  baseUpdatedAt: string;
  baseVersion: number;
  savedAt: string;
}
export type DraftRecovery<T> =
  | { status: 'none' }
  | { status: 'recovered'; snapshot: T }
  | { status: 'conflict'; snapshot: T };

/** Compare editable contents, independently of timestamps assigned by the server. */
export function draftBackupRevision(snapshot: SnapshotBase): string {
  const { updatedAt: _updatedAt, version: _version, ...contents } = snapshot;
  const value = { ...contents } as Record<string, unknown>;
  delete value.createdAt;
  delete value.publishedAt;
  delete value.status;
  const stable = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(stable);
    if (entry && typeof entry === 'object') {
      return Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)]));
    }
    return entry;
  };
  return JSON.stringify(stable(value));
}

/**
 * A room's editable contents after the normalization the server and this backup apply on write, so an
 * editor snapshot (a freshly placed object lacks keys they fill in) matches its stored copies (F379).
 */
export function roomContentRevision(room: RoomSnapshot): string {
  return draftBackupRevision(cloneRoomSnapshot(room));
}

/** Separate from repository Save: this never touches runtime state, permissions, or dirty flags. */
export class ExpandedRoomDraftBackup {
  constructor(
    readonly scope: string,
    private readonly getStorage: () => Storage = () => window.localStorage,
  ) {}

  private key(courseId: string, roomId?: string): string {
    return `${EXPANDED_DRAFT_BACKUP_PREFIX}${encodeURIComponent(this.scope)}:${encodeURIComponent(courseId)}:${roomId ? `room:${encodeURIComponent(roomId)}` : 'course'}`;
  }

  private read<T extends SnapshotBase>(key: string, id: string, normalize: (value: T) => T): DraftBackup<T> | null {
    try {
      const raw = this.getStorage().getItem(key);
      if (!raw) return null;
      const value = JSON.parse(raw) as DraftBackup<T>;
      if (value.schema !== 1 || value.snapshot?.id !== id || !Number.isFinite(Date.parse(value.baseUpdatedAt))
        || !Number.isInteger(value.baseVersion) || !Number.isFinite(Date.parse(value.savedAt))
        || !Number.isFinite(Date.parse(value.snapshot.updatedAt)) || !Number.isInteger(value.snapshot.version)) return null;
      return { ...value, snapshot: normalize(value.snapshot) };
    } catch {
      return null;
    }
  }

  private write<T extends SnapshotBase>(key: string, snapshot: T, base: SnapshotBase): boolean {
    try {
      if (snapshot.id !== base.id) return false;
      const value: DraftBackup<T> = {
        schema: 1, snapshot, baseUpdatedAt: base.updatedAt, baseVersion: base.version,
        savedAt: new Date().toISOString(),
      };
      this.getStorage().setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  private recover<T extends SnapshotBase>(backup: DraftBackup<T> | null, remote: T): DraftRecovery<T> {
    if (!backup) return { status: 'none' };
    if (draftBackupRevision(backup.snapshot) === draftBackupRevision(remote)) return { status: 'none' };
    // Local clock order cannot establish which remote revision was edited. Only the original baseline can.
    if (backup.baseUpdatedAt !== remote.updatedAt || backup.baseVersion !== remote.version) {
      return { status: 'conflict', snapshot: backup.snapshot };
    }
    return { status: 'recovered', snapshot: backup.snapshot };
  }

  writeCourse(snapshot: CourseSnapshot, base: CourseSnapshot): boolean {
    return this.write(this.key(snapshot.id), cloneCourseSnapshot(snapshot), base);
  }

  recoverCourse(remote: CourseSnapshot): DraftRecovery<CourseSnapshot> {
    const backup = this.read(this.key(remote.id), remote.id, (value: CourseSnapshot) => {
      if (!Array.isArray(value.roomRefs) || !Array.isArray(value.objectLinks)
        || !('goal' in value) || !('startPoint' in value)) throw new Error('Invalid expanded room backup');
      return normalizeCourseSnapshot(value, remote.id);
    });
    return this.recover(backup, remote);
  }

  writeRoom(courseId: string, snapshot: RoomSnapshot, base: SnapshotBase): boolean {
    return this.write(this.key(courseId, snapshot.id), cloneRoomSnapshot(snapshot), base);
  }

  recoverRoom(courseId: string, remote: RoomSnapshot): DraftRecovery<RoomSnapshot> {
    const backup = this.read(this.key(courseId, remote.id), remote.id, (value: RoomSnapshot) => {
      if (value.coordinates?.x !== remote.coordinates.x || value.coordinates?.y !== remote.coordinates.y
        || !value.tileData || !Array.isArray(value.placedObjects)
        || !LAYER_NAMES.every((layer) => Array.isArray(value.tileData[layer]) && value.tileData[layer].length === ROOM_HEIGHT
          && value.tileData[layer].every((row) => Array.isArray(row) && row.length === ROOM_WIDTH))) throw new Error('Invalid room backup');
      return cloneRoomSnapshot(value);
    });
    return this.recover(backup, remote);
  }

  private discard<T extends SnapshotBase>(key: string, sent: T, revision: (snapshot: T) => string = draftBackupRevision): boolean {
    try {
      const storage = this.getStorage();
      const raw = storage.getItem(key);
      if (!raw) return true;
      const backup = JSON.parse(raw) as DraftBackup<T>;
      if (backup.snapshot?.id !== sent.id || revision(backup.snapshot) !== revision(sent)) return false;
      storage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  discardCourse(sent: CourseSnapshot): boolean {
    return this.discard(this.key(sent.id), sent);
  }

  /** Drops a cell's backup whatever it holds, for when the cell was replaced with the server's version. */
  forgetRoom(courseId: string, roomId: string): void {
    try {
      this.getStorage().removeItem(this.key(courseId, roomId));
    } catch {
      // Storage unavailable: nothing to forget.
    }
  }

  discardRoom(courseId: string, sent: RoomSnapshot): boolean {
    // The backup holds a normalized copy and `sent` is the raw editor snapshot, so compare normalized.
    return this.discard(this.key(courseId, sent.id), sent, roomContentRevision);
  }
}
