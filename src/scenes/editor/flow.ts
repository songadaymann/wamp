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
  CourseEditorSceneData,
  CourseEditedRoomData,
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
  wakeCourseComposer(data: CourseEditorSceneData): void;
  updateBottomBar(): void;
  hasActiveCourseEdit(): boolean;
  canReturnToCourseBuilder(): boolean;
  shouldReturnToCourseEditor(): boolean;
  buildCourseEditorWakeData(wakeData: OverworldPlaySceneData): CourseEditorSceneData;
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
    const wakeData: OverworldPlaySceneData = {
      centerCoordinates: { ...this.host.getRoomCoordinates() },
      roomCoordinates: { ...this.host.getRoomCoordinates() },
      statusMessage: 'This minted room can only be edited by its token owner.',
      draftRoom: null,
      clearDraftRoomId: this.roomSession.currentRoomId,
      mode: 'browse',
    };

    this.host.stopEditorScene();
    if (this.host.shouldReturnToCourseEditor()) {
      this.host.wakeCourseComposer(this.host.buildCourseEditorWakeData(wakeData));
      return;
    }

    this.host.wakeOverworld(wakeData);
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
    if (this.host.shouldReturnToCourseEditor()) {
      this.host.wakeCourseComposer(this.host.buildCourseEditorWakeData(wakeData));
      return;
    }

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
    this.host.setCourseEditorStatusText('Room order is no longer used in course editing.');
    this.host.updateGoalUi();
  }

  async editNextCourseRoom(): Promise<void> {
    this.host.setCourseEditorStatusText('Room order is no longer used in course editing.');
    this.host.updateGoalUi();
  }
}
