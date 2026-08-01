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
import { logBootPhase, startBootStallWatch } from '../../main/bootDiagnostics';
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
  isWithinLoadedRoomBounds(coordinates: RoomCoordinates): boolean;
  getRoomSnapshotForCoordinates(coordinates: RoomCoordinates): RoomSnapshot | null;
  getPlayableRoomSnapshotForCoordinates(coordinates: RoomCoordinates): RoomSnapshot | null;
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
  setEditorPlaytestReturnTarget(
    target: OverworldPlaySceneData['editorPlaytestReturnTarget'] | null
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
  syncRoomComments(): void;
  redrawWorld(): void;
  renderHud(statusOverride?: string): void;
  hideLoadingText(): void;
  getTimeNow(): number;
  getBrowseRefreshIntervalMs(): number;
  getPlayRefreshIntervalMs(): number;
}

const RECENTER_REFRESH_CANCELLED_RETRY_DELAY_MS = 250;
const RECENTER_REFRESH_ERROR_RETRY_DELAY_MS = 5_000;

export class OverworldWindowController {
  private visibleChunkRefreshInFlight = false;
  private nextVisibleChunkRefreshAt = 0;
  private pendingPlayableSnapshotRefresh: {
    token: number;
    centerCoordinates: RoomCoordinates;
    options: { forceChunkReload?: boolean };
  } | null = null;
  private playableSnapshotRefreshInFlightToken: number | null = null;
  private nextPlayableSnapshotRefreshAt = 0;
  private playableSnapshotRefreshToken = 0;
  private pendingRecenterRefresh: {
    centerCoordinates: RoomCoordinates;
    options: { forceChunkReload?: boolean };
  } | null = null;
  private recenterRefreshInFlight = false;
  private nextRecenterRefreshAt = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly host: OverworldWindowControllerHost
  ) {}

  reset(): void {
    this.visibleChunkRefreshInFlight = false;
    this.nextVisibleChunkRefreshAt = 0;
    this.pendingPlayableSnapshotRefresh = null;
    this.playableSnapshotRefreshInFlightToken = null;
    this.nextPlayableSnapshotRefreshAt = 0;
    this.playableSnapshotRefreshToken += 1;
    this.pendingRecenterRefresh = null;
    this.recenterRefreshInFlight = false;
    this.nextRecenterRefreshAt = 0;
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
    if (data?.editorPlaytestReturnTarget !== undefined) {
      this.host.setEditorPlaytestReturnTarget(data.editorPlaytestReturnTarget ?? null);
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
    return (await this.performRefreshAround(centerCoordinates, options)) === 'success';
  }

  private async performRefreshAround(
    centerCoordinates: RoomCoordinates,
    options: { forceChunkReload?: boolean } = {}
  ): Promise<WorldRefreshResult> {
    const bootRefresh = !isAppReady();
    const cancelBootRefreshStallWatch = bootRefresh
      ? startBootStallWatch('overworld refresh', 12000, () => ({
          center: centerCoordinates,
          mode: this.host.getMode(),
          forceChunkReload: Boolean(options.forceChunkReload),
        }))
      : () => {};
    if (bootRefresh) {
      logBootPhase('overworld-refresh:start', {
        center: centerCoordinates,
        mode: this.host.getMode(),
        forceChunkReload: Boolean(options.forceChunkReload),
      });
    }

    this.host.setWindowCenterCoordinates({ ...centerCoordinates });
    this.host.renderHud('Loading world...');
    if (!isAppReady()) {
      setBootProgress(1);
      setBootStatus('Loading world...');
    }

    const retry = async (): Promise<void> => {
      if (!isAppReady()) {
        setBootProgress(1);
        setBootStatus('Retrying world...');
      } else {
        showBusyOverlay('Retrying world...', 'Loading world...');
      }
      await this.refreshAround(centerCoordinates, { forceChunkReload: true });
    };

    try {
      const refreshed = await this.host.worldStreamingController.refreshAround(
        centerCoordinates,
        options
      );
      if (bootRefresh) {
        logBootPhase('overworld-refresh:stream-result', { result: refreshed });
      }
      const sceneAvailable =
        this.scene.scene.isActive(this.scene.scene.key) ||
        this.scene.scene.isPaused(this.scene.scene.key);
      if (refreshed === 'success') {
        if (!sceneAvailable) {
          return 'success';
        }

        if (bootRefresh) {
          logBootPhase('overworld-refresh:hydrate-start');
        }
        this.host.updateSelectedSummary();
        void this.host.refreshLeaderboardForSelection();
        this.host.updateCameraBounds();
        this.host.syncModeRuntime();
        this.host.syncPreviewVisibility();
        this.host.syncPresenceSubscriptions();
        this.host.syncGhostVisibility();
        this.host.syncRoomComments();
        this.host.redrawWorld();
        this.host.renderHud();
        this.host.hideLoadingText();
        this.nextVisibleChunkRefreshAt =
          this.host.getTimeNow() + this.getVisibleChunkRefreshIntervalMs();
        if (!isAppReady()) {
          markAppReady();
        }
        hideBusyOverlay();
        if (bootRefresh) {
          logBootPhase('overworld-refresh:ready');
        }
        return 'success';
      }

      if (refreshed === 'cancelled') {
        return 'cancelled';
      }

      if (!sceneAvailable) {
        return 'error';
      }

      console.error('Failed to load overworld window');
      if (!isAppReady()) {
        showBootFailure('Failed to load world. Check your connection and retry.', retry);
      } else if (isBusyOverlayVisible()) {
        showBusyError('Failed to load world. Check your connection and try again.', {
          retryHandler: retry,
        });
      } else {
        this.host.renderHud('Failed to load world.');
      }

      return 'error';
    } catch (error) {
      logBootPhase(
        'overworld-refresh:error',
        { message: error instanceof Error ? error.message : String(error) },
        { level: 'error' }
      );
      console.error('[wamp boot] Failed while preparing the overworld', error);
      if (!isAppReady()) {
        showBootFailure('Loaded world data, but failed to enter the world. Check the console and retry.', retry);
      } else if (isBusyOverlayVisible()) {
        showBusyError('Failed to prepare the world. Check the console and try again.', {
          retryHandler: retry,
        });
      } else {
        this.host.renderHud('Failed to prepare world.');
      }
      return 'error';
    } finally {
      cancelBootRefreshStallWatch();
    }
  }

  refreshAroundIfNeededOrFromCache(
    centerCoordinates: RoomCoordinates,
    options: { forceChunkReload?: boolean; refreshLeaderboards?: boolean; preferCachedWindow?: boolean } = {},
  ): void {
    const needsRefresh = this.host.worldStreamingController.needsRefreshAround(centerCoordinates);
    if (
      options.preferCachedWindow
      && !options.forceChunkReload
      && this.host.worldStreamingController.isWithinLoadedRoomBounds(centerCoordinates)
    ) {
      this.refreshFromCurrentCache(centerCoordinates, options);
      const needsPlayableSnapshot =
        this.host.getMode() === 'play'
        && !this.host.worldStreamingController.getPlayableRoomSnapshotForCoordinates(centerCoordinates);
      if (needsPlayableSnapshot) {
        this.requestPlayableSnapshotRefresh(centerCoordinates);
      } else if (needsRefresh) {
        this.requestRecenterRefresh(centerCoordinates);
      }
      return;
    }

    const needsPlayableSnapshot =
      this.host.getMode() === 'play'
      && !this.host.worldStreamingController.getPlayableRoomSnapshotForCoordinates(centerCoordinates);
    if (
      options.forceChunkReload
      || needsRefresh
      || needsPlayableSnapshot
    ) {
      const refreshOptions = { forceChunkReload: options.forceChunkReload };
      if (needsPlayableSnapshot) {
        this.requestPlayableSnapshotRefresh(centerCoordinates, refreshOptions);
      } else {
        this.requestRecenterRefresh(centerCoordinates, refreshOptions);
      }
      return;
    }

    this.refreshFromCurrentCache(centerCoordinates, options);
  }

  private refreshFromCurrentCache(
    centerCoordinates: RoomCoordinates,
    options: { refreshLeaderboards?: boolean } = {},
  ): void {
    this.host.setWindowCenterCoordinates({ ...centerCoordinates });
    this.host.worldStreamingController.refreshVisibleSelectionFromCache();
    this.host.updateSelectedSummary();
    if (options.refreshLeaderboards !== false) {
      void this.host.refreshLeaderboardForSelection();
    }
    this.host.updateCameraBounds();
    this.host.syncModeRuntime();
    this.host.syncPreviewVisibility();
    this.host.syncPresenceSubscriptions();
    this.host.syncGhostVisibility();
    this.host.syncRoomComments();
    this.host.redrawWorld();
    this.host.renderHud();
    this.host.hideLoadingText();
    this.nextVisibleChunkRefreshAt =
      this.host.getTimeNow() + this.getVisibleChunkRefreshIntervalMs();
    if (!isAppReady()) {
      markAppReady();
    }
    hideBusyOverlay();
  }

  refreshChunkWindowIfNeeded(centerCoordinates: RoomCoordinates): void {
    if (this.host.worldStreamingController.needsRefreshAround(centerCoordinates)) {
      this.requestRecenterRefresh(centerCoordinates);
      return;
    }

    this.host.worldStreamingController.refreshVisibleSelectionFromCache();
    this.host.syncPreviewVisibility();
  }

  maybeRefreshVisibleChunks(): void {
    if (this.maybeRunRecenterRefresh()) {
      return;
    }
    if (this.maybeRunPlayableSnapshotRefresh()) {
      return;
    }
    if (this.visibleChunkRefreshInFlight) {
      return;
    }

    const now = this.host.getTimeNow();
    if (now < this.nextVisibleChunkRefreshAt) {
      return;
    }

    const centerCoordinates = this.host.getRefreshCenterCoordinates();
    if (this.host.worldStreamingController.needsRefreshAround(centerCoordinates)) {
      // The loaded window no longer covers the active center (e.g. a
      // transition-time recenter lost a race with an in-flight refresh).
      // Repair it instead of waiting for a page reload.
      this.requestRecenterRefresh(centerCoordinates);
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

  private requestRecenterRefresh(
    centerCoordinates: RoomCoordinates,
    options: { forceChunkReload?: boolean } = {},
  ): void {
    this.pendingRecenterRefresh = {
      centerCoordinates: { ...centerCoordinates },
      options: { ...options },
    };
    this.nextRecenterRefreshAt = 0;
    this.maybeRunRecenterRefresh();
  }

  private maybeRunRecenterRefresh(): boolean {
    const request = this.pendingRecenterRefresh;
    if (!request) {
      return false;
    }

    if (
      !request.options.forceChunkReload
      && !this.host.worldStreamingController.needsRefreshAround(request.centerCoordinates)
    ) {
      // Another refresh already covered this center while we were waiting.
      this.pendingRecenterRefresh = null;
      return false;
    }

    if (
      this.recenterRefreshInFlight
      || this.host.getTimeNow() < this.nextRecenterRefreshAt
    ) {
      return true;
    }

    this.recenterRefreshInFlight = true;
    void this.performRefreshAround(request.centerCoordinates, request.options)
      .then((result) => {
        if (this.pendingRecenterRefresh !== request) {
          return;
        }
        if (result === 'success') {
          this.pendingRecenterRefresh = null;
          return;
        }
        // 'cancelled' means another chunk request was in flight; retry soon
        // instead of dropping the recenter and leaving the window stale.
        // Errors retry with a longer backoff so a flaky connection recovers.
        this.nextRecenterRefreshAt = this.host.getTimeNow()
          + (result === 'cancelled'
            ? RECENTER_REFRESH_CANCELLED_RETRY_DELAY_MS
            : RECENTER_REFRESH_ERROR_RETRY_DELAY_MS);
      })
      .finally(() => {
        this.recenterRefreshInFlight = false;
      });
    return true;
  }

  private requestPlayableSnapshotRefresh(
    centerCoordinates: RoomCoordinates,
    options: { forceChunkReload?: boolean } = {},
  ): void {
    this.playableSnapshotRefreshToken += 1;
    this.pendingPlayableSnapshotRefresh = {
      token: this.playableSnapshotRefreshToken,
      centerCoordinates: { ...centerCoordinates },
      options: { ...options },
    };
    this.nextPlayableSnapshotRefreshAt = 0;
    this.maybeRunPlayableSnapshotRefresh();
  }

  private maybeRunPlayableSnapshotRefresh(): boolean {
    const request = this.pendingPlayableSnapshotRefresh;
    if (!request) {
      return false;
    }

    if (
      this.host.getMode() !== 'play'
      || this.host.worldStreamingController.getPlayableRoomSnapshotForCoordinates(
        request.centerCoordinates,
      )
    ) {
      this.pendingPlayableSnapshotRefresh = null;
      return false;
    }

    if (
      this.playableSnapshotRefreshInFlightToken !== null
      || this.visibleChunkRefreshInFlight
      || this.host.getTimeNow() < this.nextPlayableSnapshotRefreshAt
    ) {
      return true;
    }

    this.playableSnapshotRefreshInFlightToken = request.token;
    void this.performRefreshAround(request.centerCoordinates, request.options)
      .then((result) => {
        if (this.pendingPlayableSnapshotRefresh?.token !== request.token) {
          return;
        }
        if (
          result === 'success'
          || this.host.getMode() !== 'play'
          || this.host.worldStreamingController.getPlayableRoomSnapshotForCoordinates(
            request.centerCoordinates,
          )
        ) {
          this.pendingPlayableSnapshotRefresh = null;
          return;
        }
        if (result === 'cancelled') {
          this.nextPlayableSnapshotRefreshAt = this.host.getTimeNow() + 50;
          return;
        }
        this.pendingPlayableSnapshotRefresh = null;
      })
      .finally(() => {
        if (this.playableSnapshotRefreshInFlightToken === request.token) {
          this.playableSnapshotRefreshInFlightToken = null;
        }
      });
    return true;
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
