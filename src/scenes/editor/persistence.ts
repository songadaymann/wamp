import { prepareBuildPromptEntry, completeBuildPromptEntry } from '../../buildPrompts/publishing';
import { recordReplayEditorAction } from '../../analytics/replay/editorEvents';
import { getAuthDebugState } from '../../auth/client';
import { requestRoomPublishName, suggestRoomTitle } from '../../publishing/events';
import { capturePublishProgression, reportPublishProgression } from '../../publishing/feedback';
import type {
  RoomPermissions,
  RoomRecord,
  RoomSnapshot,
} from '../../persistence/roomRepository';
import {
  getAppFeedbackDebugState,
  hideBusyOverlay,
  showBusyError,
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
  onRoomPublished?(room: RoomSnapshot, firstPublish: boolean, userId: string): void;
}

export class EditorPersistenceController {
  private publishing = false;
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

  loadHistory(): Promise<void> {
    return this.roomSession.loadHistory();
  }

  getIdleStatusDetails(): EditorStatusDetails {
    return this.roomSession.getIdleStatusDetails();
  }

  setStatusText(text: string): void {
    this.roomSession.setStatusText(text);
  }

  maybeAutoSave(isPlaying: boolean): void {
    if (this.publishing) return;
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
    recordReplayEditorAction('save_attempt');
    const record = await this.roomSession.saveDraft(force, options);
    if (record?.draft) recordReplayEditorAction('draft_saved');
    if (record?.draft) {
      this.host.syncActiveCourseRoomSessionSnapshot(record.draft, { published: false });
    }
    return record;
  }

  async publishRoom(successText?: string): Promise<RoomRecord | null> {
    if (this.publishing) return null;
    recordReplayEditorAction('publish_attempt');
    const publishValidationError = this.roomSession.getPublishValidationError();
    if (publishValidationError) {
      showBusyError(publishValidationError, {
        title: 'Cannot Publish Room',
        variant: 'danger',
        closeLabel: 'OK',
      });
      return null;
    }

    const roomId = this.roomSession.currentRoomId;
    const auth = getAuthDebugState();
    const userId = auth.authenticated ? auth.user?.id ?? null : null;
    const firstPublish = this.roomSession.currentPublishedVersion === 0;
    this.publishing = true;
    let showingBusy = false;
    try {
      if (userId && this.host.getRoomPermissions().canPublish && !this.host.getRoomTitle()?.trim()) {
        const title = await requestRoomPublishName(userId, suggestRoomTitle(this.host.getInitialRoomSnapshot()?.goal?.type));
        if (!title || this.roomSession.currentRoomId !== roomId || getAuthDebugState().user?.id !== userId) return null;
        this.setRoomTitle(title);
      }
      const promptChoice = await prepareBuildPromptEntry(userId, `room:${roomId}`);
      if (!promptChoice || this.roomSession.currentRoomId !== roomId || (userId && getAuthDebugState().user?.id !== userId)) return null;
      const previousProgression = await capturePublishProgression(userId);
      if (this.roomSession.currentRoomId !== roomId || (userId && getAuthDebugState().user?.id !== userId)) return null;
      showBusyOverlay('Publishing room...', 'Saving the latest version...'); showingBusy = true;
      const record = await this.roomSession.publishRoom(successText);
      if (record?.published) {
        this.host.syncActiveCourseRoomSessionSnapshot(record.published, { published: true });
        if (userId && record.lastPublishedByUserId === userId) {
          void reportPublishProgression({ userId, previousProgression, contentType: 'room',
            contentId: record.published.id, title: record.published.title });
          await completeBuildPromptEntry(promptChoice, userId, `room:${record.published.id}`, record.published.version, record.published.title ?? 'Your level');
          // World-seed and private World publishes retain their existing activation/access flow.
          if (!record.world && !record.published.id.startsWith('world-seed:')) {
            hideBusyOverlay(); showingBusy = false;
            this.host.onRoomPublished?.(record.published, firstPublish, userId);
          }
        }
      }
      return record;
    } finally {
      this.publishing = false;
      if (showingBusy && getAppFeedbackDebugState().busyState !== 'error') {
        hideBusyOverlay();
      }
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
      : 'This room is read-only. Changes are local only.';
  }
}
