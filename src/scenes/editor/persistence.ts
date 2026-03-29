import type {
  RoomPermissions,
  RoomRecord,
  RoomSnapshot,
} from '../../persistence/roomRepository';
import {
  hideBusyOverlay,
  showBusyOverlay,
} from '../../ui/appFeedback';
import type {
  EditorHistoryState,
  EditorRoomSession,
  EditorStatusDetails,
} from './roomSession';

interface SaveDraftOptions {
  promptForSignInOnUnauthorized?: boolean;
}

interface EditorPersistenceControllerHost {
  getRoomPermissions(): RoomPermissions;
  getRoomTitle(): string | null;
  setRoomTitle(title: string | null): void;
  getRoomDirty(): boolean;
  setRoomDirty(dirty: boolean): void;
  getLastDirtyAt(): number;
  setLastDirtyAt(value: number): void;
  getInitialRoomSnapshot(): RoomSnapshot | null;
  syncActiveCourseRoomSessionSnapshot(room: RoomSnapshot, options: { published: boolean }): void;
  onRoomMarkedDirty(): void;
}

export class EditorPersistenceController {
  constructor(
    private readonly roomSession: EditorRoomSession,
    private readonly host: EditorPersistenceControllerHost,
  ) {}

  get statusText(): string {
    return this.roomSession.statusText;
  }

  get statusDetails(): EditorStatusDetails {
    return this.roomSession.statusDetails;
  }

  getHistoryState(): EditorHistoryState {
    return this.roomSession.getHistoryState();
  }

  getIdleStatusDetails(): EditorStatusDetails {
    return this.roomSession.getIdleStatusDetails();
  }

  setStatusText(text: string): void {
    this.roomSession.setStatusText(text);
  }

  maybeAutoSave(isPlaying: boolean): void {
    this.roomSession.maybeAutoSave(isPlaying);
  }

  markRoomDirty(): void {
    this.host.setRoomDirty(true);
    this.host.setLastDirtyAt(performance.now());
    this.roomSession.setStatusText(this.getDirtyPersistenceStatusText());
    this.host.onRoomMarkedDirty();
  }

  restorePersistenceStatus(): void {
    if (this.host.getRoomDirty()) {
      this.roomSession.setStatusText(this.getDirtyPersistenceStatusText());
      return;
    }

    this.roomSession.setStatusDetails(this.roomSession.getIdleStatusDetails());
  }

  setRoomTitle(nextTitle: string | null): void {
    const normalized = typeof nextTitle === 'string' ? nextTitle.trim().slice(0, 40) || null : null;
    if (this.host.getRoomTitle() === normalized) {
      return;
    }

    this.host.setRoomTitle(normalized);
    this.markRoomDirty();
  }

  async saveDraft(
    force: boolean = false,
    options?: SaveDraftOptions,
  ): Promise<RoomRecord | null> {
    const record = await this.roomSession.saveDraft(force, options);
    if (record?.draft) {
      this.host.syncActiveCourseRoomSessionSnapshot(record.draft, { published: false });
    }
    return record;
  }

  async publishRoom(successText?: string): Promise<RoomRecord | null> {
    showBusyOverlay('Publishing room...', 'Saving the latest version...');
    try {
      const record = await this.roomSession.publishRoom(successText);
      if (record?.published) {
        this.host.syncActiveCourseRoomSessionSnapshot(record.published, { published: true });
      }
      return record;
    } finally {
      hideBusyOverlay();
    }
  }

  async revertToVersion(targetVersion: number): Promise<RoomRecord | null> {
    showBusyOverlay(`Reverting room...`, `Loading version ${targetVersion}...`);
    try {
      return await this.roomSession.revertToVersion(targetVersion, this.host.getInitialRoomSnapshot());
    } finally {
      hideBusyOverlay();
    }
  }

  async adminRestoreToVersion(targetVersion: number): Promise<RoomRecord | null> {
    showBusyOverlay(`Admin restoring room...`, `Loading version ${targetVersion}...`);
    try {
      return await this.roomSession.adminRestoreToVersion(
        targetVersion,
        this.host.getInitialRoomSnapshot()
      );
    } finally {
      hideBusyOverlay();
    }
  }

  async mintRoom(): Promise<RoomRecord | null> {
    return this.roomSession.mintRoom();
  }

  async refreshMintMetadata(): Promise<RoomRecord | null> {
    return this.roomSession.refreshMintMetadata();
  }

  async setCanonicalVersion(targetVersion: number): Promise<RoomRecord | null> {
    return this.roomSession.setCanonicalVersion(targetVersion);
  }

  async setLeaderboardSourceVersion(
    targetVersion: number,
    sourceVersion: number | null,
  ): Promise<RoomRecord | null> {
    return this.roomSession.setLeaderboardSourceVersion(targetVersion, sourceVersion);
  }

  private getDirtyPersistenceStatusText(): string {
    return this.host.getRoomPermissions().canSaveDraft
      ? 'Draft changes...'
      : 'Read-only minted room. Changes are local only.';
  }
}
