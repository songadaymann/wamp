import {
  getAuthDebugState,
  promptForSignIn,
} from '../../auth/client';
import type { CourseSnapshot } from '../../courses/model';
import type {
  RoomCoordinates,
  RoomPermissions,
  RoomRecord,
  RoomSnapshot,
} from '../../persistence/roomRepository';
import {
  hideBusyOverlay,
  showBusyError,
  showBusyOverlay,
} from '../../ui/appFeedback';
import type {
  CourseEditedRoomData,
  EditorCourseEditData,
  OverworldPlaySceneData,
} from '../sceneData';
import { buildEditorPlayModeData } from './playMode';
import { type EditorRoomSession } from './roomSession';
import { shouldShowPublishNudge as shouldShowPublishNudgeHelper } from './viewModel';

interface EditorSceneFlowHost {
  cancelClipboardPastePreview(): void;
  getSelectedCoursePreviewForPlay(): CourseSnapshot | null;
  getRoomPermissions(): RoomPermissions;
  saveDraft(force?: boolean): Promise<RoomRecord | null>;
  exportRoomSnapshot(): RoomSnapshot;
  getRoomDirty(): boolean;
  getPublishedVersion(): number;
  getRoomCoordinates(): RoomCoordinates;
  buildCourseEditedRoomData(): CourseEditedRoomData | null;
  syncActiveCourseRoomSessionSnapshot(room: RoomSnapshot, options: { published: boolean }): void;
  clearEditorPresence(): void;
  sleepEditorScene(): void;
  stopEditorScene(): void;
  wakeOverworld(data: OverworldPlaySceneData): void;
  updateBottomBar(): void;
  hasActiveCourseEdit(): boolean;
  canReturnToCourseBuilder(): boolean;
  getAdjacentCourseEdit(offset: -1 | 1): EditorCourseEditData | null;
  setCourseEditorStatusText(text: string | null): void;
  updateGoalUi(): void;
  getPersistenceStatusText(): string;
  getMintedTokenId(): string | null;
  getRoomEditCount(): number;
  publishRoom(): Promise<RoomRecord | null>;
}

export class EditorSceneFlowController {
  private readonly PUBLISH_NUDGE_EDIT_THRESHOLD = 10;
  private publishNudgeTriggered = false;

  constructor(
    private readonly roomSession: EditorRoomSession,
    private readonly host: EditorSceneFlowHost,
  ) {}

  reset(): void {
    this.publishNudgeTriggered = false;
  }

  async startPlayMode(): Promise<void> {
    this.host.cancelClipboardPastePreview();
    const coursePreview = this.host.getSelectedCoursePreviewForPlay();
    if (this.host.getRoomPermissions().canSaveDraft) {
      void this.host.saveDraft(true);
    }
    const currentRoomSnapshot = this.host.exportRoomSnapshot();
    const usePublishedCourseRoomVersion =
      !this.host.getRoomDirty() &&
      this.host.getPublishedVersion() > 0 &&
      !this.roomSession.hasDraftPreviewInWorld();
    this.host.syncActiveCourseRoomSessionSnapshot(currentRoomSnapshot, {
      published: usePublishedCourseRoomVersion,
    });
    const playData: OverworldPlaySceneData = buildEditorPlayModeData({
      roomCoordinates: this.host.getRoomCoordinates(),
      roomSnapshot: currentRoomSnapshot,
      usePublishedCourseRoomVersion,
      coursePreview,
      courseEditedRoom: this.host.buildCourseEditedRoomData(),
    });

    this.host.clearEditorPresence();
    this.host.sleepEditorScene();
    this.host.wakeOverworld(playData);
    this.host.updateBottomBar();
  }

  async handlePublishNudgeAction(): Promise<void> {
    if (!this.shouldShowPublishNudge()) {
      return;
    }

    if (!getAuthDebugState().authenticated) {
      promptForSignIn('People can’t see this room until you publish it. Sign in to publish.');
      return;
    }

    if (this.host.getRoomPermissions().canPublish) {
      await this.host.publishRoom();
    }
  }

  maybeTriggerPublishNudge(): void {
    if (this.publishNudgeTriggered || !this.shouldShowPublishNudge()) {
      return;
    }

    this.publishNudgeTriggered = true;
    if (!getAuthDebugState().authenticated) {
      promptForSignIn('People can’t see this room until you publish it. Sign in to publish.');
      return;
    }

    this.roomSession.setStatusText('Draft only. Not visible in the world until published.');
  }

  shouldShowPublishNudge(): boolean {
    return shouldShowPublishNudgeHelper(
      this.host.getPublishedVersion(),
      this.host.getRoomPermissions().canSaveDraft,
      this.host.getMintedTokenId(),
      this.host.getRoomEditCount(),
      this.PUBLISH_NUDGE_EDIT_THRESHOLD,
    );
  }

  returnToWorldReadOnly(): void {
    this.host.stopEditorScene();
    this.host.wakeOverworld({
      centerCoordinates: { ...this.host.getRoomCoordinates() },
      roomCoordinates: { ...this.host.getRoomCoordinates() },
      statusMessage: 'This minted room can only be edited by its token owner.',
      draftRoom: null,
      clearDraftRoomId: this.roomSession.currentRoomId,
      mode: 'browse',
    });
  }

  async returnToWorld(): Promise<void> {
    showBusyOverlay('Returning to world...', 'Saving room state...');
    const wakeData = await this.roomSession.buildReturnToWorldWakeData();
    if (!wakeData) {
      showBusyError(this.host.getPersistenceStatusText() || 'Failed to return to world.', {
        closeHandler: () => hideBusyOverlay(),
      });
      return;
    }

    wakeData.courseEditorReturned = this.host.hasActiveCourseEdit();
    wakeData.courseEditedRoom = this.host.buildCourseEditedRoomData();

    this.host.stopEditorScene();
    this.host.wakeOverworld(wakeData);
  }

  async returnToCourseBuilder(): Promise<void> {
    await this.returnToWorld();
  }

  async handleEditorBackAction(): Promise<void> {
    if (this.host.canReturnToCourseBuilder()) {
      await this.returnToCourseBuilder();
      return;
    }

    await this.returnToWorld();
  }

  async editPreviousCourseRoom(): Promise<void> {
    await this.editAdjacentCourseRoom(-1);
  }

  async editNextCourseRoom(): Promise<void> {
    await this.editAdjacentCourseRoom(1);
  }

  private async editAdjacentCourseRoom(offset: -1 | 1): Promise<void> {
    const adjacent = this.host.getAdjacentCourseEdit(offset);
    if (!adjacent) {
      this.host.setCourseEditorStatusText(
        offset < 0 ? 'Already at the first course room.' : 'Already at the last course room.',
      );
      this.host.updateGoalUi();
      return;
    }

    showBusyOverlay(
      offset < 0 ? 'Opening previous room...' : 'Opening next room...',
      'Saving room state...',
    );
    const wakeData = await this.roomSession.buildReturnToWorldWakeData();
    if (!wakeData) {
      showBusyError(this.host.getPersistenceStatusText() || 'Failed to open the adjacent room.', {
        closeHandler: () => hideBusyOverlay(),
      });
      return;
    }

    wakeData.courseEditorReturned = false;
    wakeData.courseEditedRoom = this.host.buildCourseEditedRoomData();
    wakeData.courseEditorNavigateOffset = offset;

    this.host.stopEditorScene();
    this.host.wakeOverworld(wakeData);
  }
}
