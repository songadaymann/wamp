import Phaser from 'phaser';
import {
  clearActiveCourseDraftSessionRoomOverride,
  getActiveCourseDraftSessionCourseId,
  getActiveCourseDraftSessionDraft,
  setActiveCourseDraftSessionRoomOverride,
  setActiveCourseDraftSessionSelectedRoom,
  updateActiveCourseDraftSession,
} from '../../courses/draftSession';
import { cloneCourseSnapshot, type CourseSnapshot } from '../../courses/model';
import { getFocusedCoordinatesFromUrl } from '../../navigation/worldNavigation';
import { cloneRoomSnapshot, type RoomCoordinates, type RoomSnapshot } from '../../persistence/roomModel';
import {
  hideBusyOverlay,
  isAppReady,
  isBusyOverlayVisible,
  markAppReady,
  setBootProgress,
  setBootStatus,
  showBootFailure,
  showBusyError,
  showBusyOverlay,
} from '../../ui/appFeedback';
import type { CameraMode } from './camera';
import type { OverworldMode, OverworldPlaySceneData } from '../sceneData';

type WorldRefreshResult = 'success' | 'cancelled' | 'error';
type ChunkWindowRefreshResult = 'updated' | 'unchanged' | 'cancelled' | 'error';

interface WindowStreamingController {
  reset(): void;
  applyOptimisticMutation(mutation: {
    clearDraftRoomId?: string | null;
    draftRoom?: RoomSnapshot | null;
    publishedRoom?: RoomSnapshot | null;
    invalidateRoomId?: string | null;
  }): void;
  refreshAround(
    centerCoordinates: RoomCoordinates,
    options?: { forceChunkReload?: boolean }
  ): Promise<WorldRefreshResult>;
  needsRefreshAround(centerCoordinates: RoomCoordinates): boolean;
  refreshVisibleSelectionFromCache(): void;
  refreshLoadedChunksIfChanged(
    centerCoordinates: RoomCoordinates
  ): Promise<ChunkWindowRefreshResult>;
}

interface OverworldWindowControllerHost {
  worldStreamingController: WindowStreamingController;
  getMode(): OverworldMode;
  setMode(mode: OverworldMode): void;
  setCameraMode(mode: CameraMode): void;
  getInspectZoom(): number;
  setInspectZoom(zoom: number): void;
  getBrowseInspectZoom(): number;
  setBrowseInspectZoom(zoom: number): void;
  getFitZoomForRoom(): number;
  getRefreshCenterCoordinates(): RoomCoordinates;
  getWindowCenterCoordinates(): RoomCoordinates;
  setWindowCenterCoordinates(coordinates: RoomCoordinates): void;
  setSelectedCoordinates(coordinates: RoomCoordinates): void;
  setCurrentRoomCoordinates(coordinates: RoomCoordinates): void;
  getCurrentRoomCoordinates(): RoomCoordinates;
  setShouldCenterCamera(value: boolean): void;
  setShouldRespawnPlayer(value: boolean): void;
  syncAppMode(): void;
  resetPlaySession(): void;
  showTransientStatus(message: string): void;
  setCourseEditorReturnTarget(
    target: OverworldPlaySceneData['courseEditorReturnTarget'] | null
  ): void;
  syncCourseComposerRecordFromSession(): void;
  handleCourseEditorReturned(): void;
  activateDraftCoursePreview(
    snapshot: CourseSnapshot,
    draftRoom: RoomSnapshot | null
  ): Promise<void>;
  updateSelectedSummary(): void;
  refreshLeaderboardForSelection(): Promise<void>;
  updateCameraBounds(): void;
  syncModeRuntime(): void;
  syncPreviewVisibility(): void;
  syncPresenceSubscriptions(): void;
  syncGhostVisibility(): void;
  redrawWorld(): void;
  renderHud(statusOverride?: string): void;
  hideLoadingText(): void;
  getTimeNow(): number;
  getBrowseRefreshIntervalMs(): number;
  getPlayRefreshIntervalMs(): number;
}

export class OverworldWindowController {
  private visibleChunkRefreshInFlight = false;
  private nextVisibleChunkRefreshAt = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly host: OverworldWindowControllerHost
  ) {}

  reset(): void {
    this.visibleChunkRefreshInFlight = false;
    this.nextVisibleChunkRefreshAt = 0;
  }

  async handleWakeAsync(data?: OverworldPlaySceneData): Promise<void> {
    this.applySceneData(data);
    if (data?.courseDraftPreviewId) {
      const draft = getActiveCourseDraftSessionDraft();
      if (draft?.id === data.courseDraftPreviewId && draft.goal) {
        await this.host.activateDraftCoursePreview(
          cloneCourseSnapshot(draft),
          data.draftRoom ? cloneRoomSnapshot(data.draftRoom) : null
        );
      }
    }
    this.host.syncAppMode();
    if (data?.forceRefreshAround) {
      this.host.worldStreamingController.reset();
      this.host.updateSelectedSummary();
      this.host.renderHud();
      await this.refreshAround(this.host.getWindowCenterCoordinates(), {
        forceChunkReload: true,
      });
      return;
    }

    this.host.updateSelectedSummary();
    this.host.redrawWorld();
    this.host.renderHud();
    await this.refreshAround(this.host.getWindowCenterCoordinates(), {
      forceChunkReload: data?.forceRefreshAround ?? false,
    });
  }

  applySceneData(data?: OverworldPlaySceneData): void {
    const fallback =
      data?.centerCoordinates ?? data?.roomCoordinates ?? getFocusedCoordinatesFromUrl();
    const wasPlaying = this.host.getMode() === 'play';

    if (
      data?.clearDraftRoomId ||
      data?.draftRoom ||
      data?.publishedRoom ||
      data?.invalidateRoomId
    ) {
      this.host.worldStreamingController.applyOptimisticMutation({
        clearDraftRoomId: data.clearDraftRoomId ?? null,
        draftRoom: data.draftRoom ? cloneRoomSnapshot(data.draftRoom) : null,
        publishedRoom: data.publishedRoom ? cloneRoomSnapshot(data.publishedRoom) : null,
        invalidateRoomId: data.invalidateRoomId ?? null,
      });
    }

    if (data?.courseEditedRoom) {
      this.applyCourseEditedRoomReturn(
        data.courseEditedRoom,
        data.draftRoom ? cloneRoomSnapshot(data.draftRoom) : null,
        data.publishedRoom ? cloneRoomSnapshot(data.publishedRoom) : null
      );
    }

    if (data?.statusMessage) {
      this.host.showTransientStatus(data.statusMessage);
    }

    if (data?.courseEditorReturnTarget !== undefined) {
      this.host.setCourseEditorReturnTarget(data.courseEditorReturnTarget ?? null);
    }

    this.host.syncCourseComposerRecordFromSession();
    if (data?.courseEditorReturned) {
      this.host.handleCourseEditorReturned();
    }

    if (data?.mode) {
      if (data.mode === 'play') {
        if (!wasPlaying) {
          this.host.setBrowseInspectZoom(this.host.getInspectZoom());
        }
        this.host.resetPlaySession();
        this.host.setCameraMode('follow');
      }
      this.host.setMode(data.mode);
      this.host.syncAppMode();
    }

    const focusCoordinates = data?.roomCoordinates ?? data?.draftRoom?.coordinates ?? fallback;
    const centerCoordinates = data?.centerCoordinates ?? focusCoordinates;

    this.host.setSelectedCoordinates({ ...focusCoordinates });
    this.host.setCurrentRoomCoordinates({ ...focusCoordinates });
    this.host.setWindowCenterCoordinates({ ...centerCoordinates });
    this.host.setShouldCenterCamera(true);
    this.host.setShouldRespawnPlayer(this.host.getMode() === 'play');

    if (this.host.getMode() === 'play') {
      this.host.setInspectZoom(this.host.getFitZoomForRoom());
    } else {
      this.host.setCameraMode('inspect');
      this.host.setInspectZoom(this.host.getBrowseInspectZoom());
    }
  }

  async refreshAround(
    centerCoordinates: RoomCoordinates,
    options: { forceChunkReload?: boolean } = {}
  ): Promise<boolean> {
    this.host.setWindowCenterCoordinates({ ...centerCoordinates });
    this.host.renderHud('Loading world...');
    if (!isAppReady()) {
      setBootProgress(1);
      setBootStatus('Loading world...');
    }

    const refreshed = await this.host.worldStreamingController.refreshAround(
      centerCoordinates,
      options
    );
    const sceneAvailable =
      this.scene.scene.isActive(this.scene.scene.key) ||
      this.scene.scene.isPaused(this.scene.scene.key);
    if (refreshed === 'success') {
      if (!sceneAvailable) {
        return true;
      }

      this.host.updateSelectedSummary();
      void this.host.refreshLeaderboardForSelection();
      this.host.updateCameraBounds();
      this.host.syncModeRuntime();
      this.host.syncPreviewVisibility();
      this.host.syncPresenceSubscriptions();
      this.host.syncGhostVisibility();
      this.host.redrawWorld();
      this.host.renderHud();
      this.host.hideLoadingText();
      this.nextVisibleChunkRefreshAt =
        this.host.getTimeNow() + this.getVisibleChunkRefreshIntervalMs();
      if (!isAppReady()) {
        markAppReady();
      }
      hideBusyOverlay();
      return true;
    }

    if (refreshed === 'cancelled') {
      return false;
    }

    if (!sceneAvailable) {
      return false;
    }

    console.error('Failed to load overworld window');
    const retry = async (): Promise<void> => {
      if (!isAppReady()) {
        setBootProgress(1);
        setBootStatus('Retrying world...');
      } else {
        showBusyOverlay('Retrying world...', 'Loading world...');
      }
      await this.refreshAround(centerCoordinates, { forceChunkReload: true });
    };

    if (!isAppReady()) {
      showBootFailure('Failed to load world. Check your connection and retry.', retry);
    } else if (isBusyOverlayVisible()) {
      showBusyError('Failed to load world. Check your connection and try again.', {
        retryHandler: retry,
      });
    } else {
      this.host.renderHud('Failed to load world.');
    }

    return false;
  }

  refreshChunkWindowIfNeeded(centerCoordinates: RoomCoordinates): void {
    if (this.host.worldStreamingController.needsRefreshAround(centerCoordinates)) {
      void this.refreshAround(centerCoordinates);
      return;
    }

    this.host.worldStreamingController.refreshVisibleSelectionFromCache();
    this.host.syncPreviewVisibility();
  }

  maybeRefreshVisibleChunks(): void {
    if (this.visibleChunkRefreshInFlight) {
      return;
    }

    const now = this.host.getTimeNow();
    if (now < this.nextVisibleChunkRefreshAt) {
      return;
    }

    const centerCoordinates = this.host.getRefreshCenterCoordinates();
    if (this.host.worldStreamingController.needsRefreshAround(centerCoordinates)) {
      return;
    }

    this.visibleChunkRefreshInFlight = true;
    void this.host.worldStreamingController
      .refreshLoadedChunksIfChanged(centerCoordinates)
      .then((result) => {
        if (result !== 'updated') {
          return;
        }

        this.host.updateSelectedSummary();
        void this.host.refreshLeaderboardForSelection();
        this.host.syncModeRuntime();
        this.host.syncPreviewVisibility();
        this.host.syncPresenceSubscriptions();
        this.host.syncGhostVisibility();
        this.host.redrawWorld();
        this.host.renderHud();
      })
      .finally(() => {
        this.visibleChunkRefreshInFlight = false;
        this.nextVisibleChunkRefreshAt =
          this.host.getTimeNow() + this.getVisibleChunkRefreshIntervalMs();
      });
  }

  private getVisibleChunkRefreshIntervalMs(): number {
    return this.host.getMode() === 'browse'
      ? this.host.getBrowseRefreshIntervalMs()
      : this.host.getPlayRefreshIntervalMs();
  }

  private applyCourseEditedRoomReturn(
    courseEditedRoom: NonNullable<OverworldPlaySceneData['courseEditedRoom']>,
    draftRoom: RoomSnapshot | null,
    publishedRoom: RoomSnapshot | null
  ): void {
    if (getActiveCourseDraftSessionCourseId() !== courseEditedRoom.courseId) {
      return;
    }

    const currentDraft = getActiveCourseDraftSessionDraft();
    const currentRoomRef =
      currentDraft?.roomRefs.find((roomRef) => roomRef.roomId === courseEditedRoom.roomId) ??
      null;
    if (!currentRoomRef) {
      return;
    }

    setActiveCourseDraftSessionSelectedRoom(courseEditedRoom.roomId);

    const nextDraftRoom =
      draftRoom?.id === courseEditedRoom.roomId ? cloneRoomSnapshot(draftRoom) : null;
    const nextPublishedRoom =
      publishedRoom?.id === courseEditedRoom.roomId ? cloneRoomSnapshot(publishedRoom) : null;

    if (nextPublishedRoom) {
      clearActiveCourseDraftSessionRoomOverride(courseEditedRoom.roomId);
    } else if (nextDraftRoom) {
      setActiveCourseDraftSessionRoomOverride(nextDraftRoom);
    }

    const nextTitle =
      (nextPublishedRoom ?? nextDraftRoom)?.title ?? currentRoomRef.roomTitle ?? null;
    const nextVersion = nextPublishedRoom?.version ?? currentRoomRef.roomVersion;
    if (currentRoomRef.roomTitle === nextTitle && currentRoomRef.roomVersion === nextVersion) {
      return;
    }

    updateActiveCourseDraftSession((draft) => {
      const roomRef = draft.roomRefs.find((entry) => entry.roomId === courseEditedRoom.roomId);
      if (!roomRef) {
        return;
      }

      roomRef.roomTitle = nextTitle;
      if (nextPublishedRoom) {
        roomRef.roomVersion = nextPublishedRoom.version;
      }
    });
  }
}
