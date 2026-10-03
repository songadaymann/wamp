import { chooseLocalDraftRecovery } from '../scenes/editor/localRecoveryPrompt';
import { getAuthDebugState } from '../auth/client';
import { resolveWorldPresenceGuestIdentity } from '../presence/worldPresence';
import { ExpandedRoomDraftBackup } from './localDraftBackup';
import {
  acknowledgeActiveCourseDraftSessionSave,
  getActiveCourseDraftSessionDraft,
  getActiveCourseDraftSessionPersistedDraft,
  getActiveCourseDraftSessionRecord,
  isActiveCourseDraftSessionDirty,
  setActiveCourseDraftSessionRecord,
  updateActiveCourseDraftSession,
} from './draftSession';
import type { CourseRecord, CourseSnapshot } from './model';
import type { RoomSnapshot } from '../persistence/roomModel';

function currentScope(): string | null {
  const userId = getAuthDebugState().user?.id;
  if (userId) return `user:${userId}`;
  try {
    return `guest:${resolveWorldPresenceGuestIdentity().userId}`;
  } catch {
    return null;
  }
}

export const RECOVERED_EXPANDED_DRAFT_TEXT = 'Recovered unsaved expanded room changes from this device. Save to keep them in your account.';
export const BACKUP_FAILED_TEXT = 'Could not back up changes on this device. Keep this tab open and Save your changes.';

/** Owns persistence and recovery; scene adapters supply snapshots without mutating their runtimes. */
export class CourseDraftBackupController {
  private backup: ExpandedRoomDraftBackup | null = null;
  recoveryStatus: string | null = null;
  backupFailed = false;
  private ownedCourseBackup: CourseSnapshot | null = null;
  private accountRoomChoices = new Set<string>();
  private recoveryQueue: Promise<void> = Promise.resolve();

  async open(record: CourseRecord, preserveSession: boolean): Promise<CourseRecord> {
    const scope = currentScope();
    const userId = getAuthDebugState().user?.id ?? null;
    this.backup = scope && (!record.ownerUserId || record.ownerUserId === userId) ? new ExpandedRoomDraftBackup(scope) : null;
    if (!preserveSession) this.ownedCourseBackup = null;
    this.backupFailed = false;
    this.recoveryStatus = null;
    this.accountRoomChoices.clear();
    setActiveCourseDraftSessionRecord(record, { preserveBaseline: preserveSession });
    if (preserveSession && this.backup) {
      const base = getActiveCourseDraftSessionPersistedDraft();
      const recovery = base ? this.backup.recoverCourse(base) : null;
      if (recovery?.status === 'recovered') this.ownedCourseBackup = recovery.snapshot;
    }
    if (!preserveSession && this.backup && record.permissions.canSaveDraft) {
      const recovery = this.backup.recoverCourse(record.draft);
      if (recovery.status === 'recovered') {
        this.ownedCourseBackup = recovery.snapshot;
        updateActiveCourseDraftSession((draft) => Object.assign(draft, recovery.snapshot, { version: record.draft.version }));
        this.recoveryStatus = RECOVERED_EXPANDED_DRAFT_TEXT;
      } else if (recovery.status === 'conflict') {
        const restore = await this.chooseRecovery(record.draft.title?.trim() || 'expanded room setup');
        if (!this.currentBackup() || getActiveCourseDraftSessionRecord()?.draft.id !== record.draft.id) return getActiveCourseDraftSessionRecord() ?? record;
        if (restore) {
          updateActiveCourseDraftSession((draft) => Object.assign(draft, recovery.snapshot, { version: record.draft.version }));
          this.recoveryStatus = RECOVERED_EXPANDED_DRAFT_TEXT;
          this.flushCourse();
        } else {
          this.backup.discardCourse(recovery.snapshot);
          this.recoveryStatus = 'Loaded the account draft.';
        }
      }
    }
    return getActiveCourseDraftSessionRecord() ?? record;
  }

  private currentBackup(): ExpandedRoomDraftBackup | null {
    return this.backup?.scope === currentScope() ? this.backup : null;
  }

  flushCourse(): boolean {
    const draft = getActiveCourseDraftSessionDraft();
    if (!isActiveCourseDraftSessionDirty()) {
      if (draft && this.ownedCourseBackup?.id === draft.id) {
        this.currentBackup()?.discardCourse(this.ownedCourseBackup);
        this.ownedCourseBackup = null;
      }
      this.backupFailed = false;
      return true;
    }
    const base = getActiveCourseDraftSessionPersistedDraft();
    const saved = Boolean(draft && base && this.currentBackup()?.writeCourse(draft, base));
    if (saved) this.ownedCourseBackup = draft;
    this.backupFailed = !saved;
    return saved;
  }

  private chooseRecovery(label: string): Promise<boolean> {
    const choice = this.recoveryQueue.then(() => chooseLocalDraftRecovery(label));
    this.recoveryQueue = choice.then(() => {});
    return choice;
  }

  async recoverRoom(courseId: string, remote: RoomSnapshot): Promise<RoomSnapshot | null> {
    const recovery = this.currentBackup()?.recoverRoom(courseId, remote);
    if (recovery?.status === 'recovered') {
      this.recoveryStatus = RECOVERED_EXPANDED_DRAFT_TEXT;
      return recovery.snapshot;
    }
    if (recovery?.status === 'conflict') {
      const restore = await this.chooseRecovery(`cell ${remote.coordinates.x},${remote.coordinates.y}`);
      if (!this.currentBackup() || getActiveCourseDraftSessionRecord()?.draft.id !== courseId) return null;
      if (restore) {
        this.recoveryStatus = RECOVERED_EXPANDED_DRAFT_TEXT;
        this.currentBackup()?.writeRoom(courseId, recovery.snapshot, remote);
        return recovery.snapshot;
      }
      this.currentBackup()?.discardRoom(courseId, recovery.snapshot);
      this.accountRoomChoices.add(remote.id);
      this.recoveryStatus = 'Loaded the account draft.';
    }
    return null;
  }

  mayRestoreSessionRoom(roomId: string): boolean {
    return !this.accountRoomChoices.has(roomId);
  }

  writeRoom(courseId: string, snapshot: RoomSnapshot, base: Pick<RoomSnapshot, 'id' | 'updatedAt' | 'version'>): boolean {
    return this.currentBackup()?.writeRoom(courseId, snapshot, base) ?? false;
  }

  savedRoom(courseId: string, sent: RoomSnapshot): void {
    this.currentBackup()?.discardRoom(courseId, sent);
  }

  savedCourse(sent: CourseSnapshot, saved: CourseRecord): CourseRecord {
    const current = acknowledgeActiveCourseDraftSessionSave(sent, saved) ?? saved;
    this.currentBackup()?.discardCourse(sent);
    this.flushCourse();
    return current;
  }
}
