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
import {
  cloneRoomSnapshot,
  type RoomCoordinates,
  type RoomSnapshot,
  type RoomSnapshotView,
} from '../../persistence/roomModel';
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

const REQUIRED_WINDOW_REFRESH_RETRY_MS = 50;
const REQUIRED_WINDOW_REFRESH_ERROR_RETRY_MS = 5_000;

interface RequiredWindowRefreshRequirements {
  playableSnapshot: boolean;
  windowCoverage: boolean;
  successfulAttempt: boolean;
}

interface PendingRequiredWindowRefresh {
  token: number;
  centerCoordinates: RoomCoordinates;
  options: { forceChunkReload?: boolean };
  requirements: RequiredWindowRefreshRequirements;
}

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
  getPlayableRoomSnapshotViewForCoordinates(coordinates: RoomCoordinates): RoomSnapshotView | null;
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
  syncFocusedRoomRuntime(
    previousCoordinates: RoomCoordinates,
    currentCoordinates: RoomCoordinates,
  ): void;
  syncFocusedRoomVisuals(): void;
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

export class OverworldWindowController {
  private visibleChunkRefreshInFlight = false;
  private nextVisibleChunkRefreshAt = 0;
  private pendingRequiredWindowRefresh: PendingRequiredWindowRefresh | null = null;
  private requiredWindowRefreshInFlightToken: number | null = null;
  private nextRequiredWindowRefreshAt = 0;
  private requiredWindowRefreshToken = 0;
  private requiredWindowRefreshResetGeneration = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly host: OverworldWindowControllerHost
  ) {}

  reset(): void {
    this.visibleChunkRefreshInFlight = false;
    this.nextVisibleChunkRefreshAt = 0;
    this.pendingRequiredWindowRefresh = null;
    this.requiredWindowRefreshInFlightToken = null;
    this.nextRequiredWindowRefreshAt = 0;
    this.requiredWindowRefreshToken += 1;
    this.requiredWindowRefreshResetGeneration += 1;
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
    const resetGeneration = this.requiredWindowRefreshResetGeneration;
    const result = await this.performRefreshAround(centerCoordinates, options);
    if (
      result === 'cancelled'
      && resetGeneration === this.requiredWindowRefreshResetGeneration
    ) {
      this.requestRequiredWindowRefresh(
        centerCoordinates,
        options,
        { successfulAttempt: true },
        this.host.getTimeNow() + REQUIRED_WINDOW_REFRESH_RETRY_MS,
      );
    }
    return result === 'success';
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
    options: {
      forceChunkReload?: boolean;
      refreshLeaderboards?: boolean;
      preferCachedWindow?: boolean;
      focusChangeFrom?: RoomCoordinates;
    } = {},
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
        && !this.host.worldStreamingController.getPlayableRoomSnapshotViewForCoordinates(centerCoordinates);
      if (needsPlayableSnapshot || needsRefresh) {
        this.requestRequiredWindowRefresh(centerCoordinates, {}, {
          playableSnapshot: needsPlayableSnapshot,
          windowCoverage: needsRefresh,
        });
      }
      return;
    }

    const needsPlayableSnapshot =
      this.host.getMode() === 'play'
      && !this.host.worldStreamingController.getPlayableRoomSnapshotViewForCoordinates(centerCoordinates);
    if (
      options.forceChunkReload
      || needsRefresh
      || needsPlayableSnapshot
    ) {
      const refreshOptions = { forceChunkReload: options.forceChunkReload };
      this.requestRequiredWindowRefresh(centerCoordinates, refreshOptions, {
        playableSnapshot: needsPlayableSnapshot,
        windowCoverage: needsRefresh,
        successfulAttempt: Boolean(options.forceChunkReload),
      });
      return;
    }

    this.refreshFromCurrentCache(centerCoordinates, options);
  }

  private refreshFromCurrentCache(
    centerCoordinates: RoomCoordinates,
    options: {
      refreshLeaderboards?: boolean;
      focusChangeFrom?: RoomCoordinates;
    } = {},
  ): void {
    this.host.setWindowCenterCoordinates({ ...centerCoordinates });
    this.host.worldStreamingController.refreshVisibleSelectionFromCache();
    this.host.updateSelectedSummary();
    if (options.refreshLeaderboards !== false) {
      void this.host.refreshLeaderboardForSelection();
    }
    this.host.updateCameraBounds();
    const isTargetedFocusChange = Boolean(
      options.focusChangeFrom &&
      (
        options.focusChangeFrom.x !== centerCoordinates.x ||
        options.focusChangeFrom.y !== centerCoordinates.y
      )
    );
    if (isTargetedFocusChange && options.focusChangeFrom) {
      this.host.syncFocusedRoomRuntime(options.focusChangeFrom, centerCoordinates);
    } else {
      this.host.syncModeRuntime();
    }
    this.host.syncPreviewVisibility();
    this.host.syncPresenceSubscriptions();
    this.host.syncGhostVisibility();
    this.host.syncRoomComments();
    if (isTargetedFocusChange) {
      this.host.syncFocusedRoomVisuals();
    } else {
      this.host.redrawWorld();
    }
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
      this.requestRequiredWindowRefresh(centerCoordinates, {}, { windowCoverage: true });
      return;
    }

    this.host.worldStreamingController.refreshVisibleSelectionFromCache();
    this.host.syncPreviewVisibility();
  }

  maybeRefreshVisibleChunks(): void {
    if (this.maybeRunRequiredWindowRefresh()) {
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
      this.requestRequiredWindowRefresh(centerCoordinates, {}, { windowCoverage: true });
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

  private requestRequiredWindowRefresh(
    centerCoordinates: RoomCoordinates,
    options: { forceChunkReload?: boolean } = {},
    requirements: Partial<RequiredWindowRefreshRequirements> = {},
    notBefore = 0,
  ): void {
    const normalizedRequirements: RequiredWindowRefreshRequirements = {
      playableSnapshot: requirements.playableSnapshot === true,
      windowCoverage: requirements.windowCoverage === true,
      successfulAttempt:
        requirements.successfulAttempt === true || options.forceChunkReload === true,
    };
    const pending = this.pendingRequiredWindowRefresh;
    const sameCenter = Boolean(
      pending
      && pending.centerCoordinates.x === centerCoordinates.x
      && pending.centerCoordinates.y === centerCoordinates.y
    );

    if (pending && sameCenter) {
      const forceStrengthened =
        options.forceChunkReload === true && pending.options.forceChunkReload !== true;
      const requirementsStrengthened =
        (normalizedRequirements.playableSnapshot && !pending.requirements.playableSnapshot)
        || (normalizedRequirements.windowCoverage && !pending.requirements.windowCoverage)
        || (normalizedRequirements.successfulAttempt && !pending.requirements.successfulAttempt);

      if (
        forceStrengthened
        && this.requiredWindowRefreshInFlightToken === pending.token
      ) {
        this.requiredWindowRefreshToken += 1;
        this.pendingRequiredWindowRefresh = {
          token: this.requiredWindowRefreshToken,
          centerCoordinates: { ...centerCoordinates },
          options: { forceChunkReload: true },
          requirements: {
            playableSnapshot:
              pending.requirements.playableSnapshot || normalizedRequirements.playableSnapshot,
            windowCoverage:
              pending.requirements.windowCoverage || normalizedRequirements.windowCoverage,
            successfulAttempt: true,
          },
        };
        this.nextRequiredWindowRefreshAt = notBefore;
      } else {
        pending.options.forceChunkReload =
          pending.options.forceChunkReload === true || options.forceChunkReload === true;
        pending.requirements.playableSnapshot =
          pending.requirements.playableSnapshot || normalizedRequirements.playableSnapshot;
        pending.requirements.windowCoverage =
          pending.requirements.windowCoverage || normalizedRequirements.windowCoverage;
        pending.requirements.successfulAttempt =
          pending.requirements.successfulAttempt || normalizedRequirements.successfulAttempt;
        if (requirementsStrengthened && this.requiredWindowRefreshInFlightToken === null) {
          this.nextRequiredWindowRefreshAt = notBefore;
        } else if (notBefore > 0) {
          this.nextRequiredWindowRefreshAt = Math.max(
            this.nextRequiredWindowRefreshAt,
            notBefore,
          );
        }
      }
      this.maybeRunRequiredWindowRefresh();
      return;
    }

    this.requiredWindowRefreshToken += 1;
    this.pendingRequiredWindowRefresh = {
      token: this.requiredWindowRefreshToken,
      centerCoordinates: { ...centerCoordinates },
      options: { ...options },
      requirements: normalizedRequirements,
    };
    this.nextRequiredWindowRefreshAt = notBefore;
    this.maybeRunRequiredWindowRefresh();
  }

  private maybeRunRequiredWindowRefresh(): boolean {
    const request = this.pendingRequiredWindowRefresh;
    if (!request) {
      return false;
    }

    if (this.isRequiredWindowRefreshSatisfied(request)) {
      this.pendingRequiredWindowRefresh = null;
      return false;
    }

    if (
      this.requiredWindowRefreshInFlightToken !== null
      || this.visibleChunkRefreshInFlight
      || this.host.getTimeNow() < this.nextRequiredWindowRefreshAt
    ) {
      return true;
    }

    const resetGeneration = this.requiredWindowRefreshResetGeneration;
    this.requiredWindowRefreshInFlightToken = request.token;
    void this.performRefreshAround(request.centerCoordinates, request.options)
      .then((result) => {
        if (
          resetGeneration !== this.requiredWindowRefreshResetGeneration
          || this.pendingRequiredWindowRefresh?.token !== request.token
        ) {
          return;
        }
        if (result === 'success') {
          request.requirements.successfulAttempt = false;
          request.options.forceChunkReload = undefined;
          if (this.isRequiredWindowRefreshSatisfied(request)) {
            this.pendingRequiredWindowRefresh = null;
          } else {
            this.nextRequiredWindowRefreshAt =
              this.host.getTimeNow() + REQUIRED_WINDOW_REFRESH_RETRY_MS;
          }
          return;
        }
        if (this.isRequiredWindowRefreshSatisfied(request)) {
          this.pendingRequiredWindowRefresh = null;
          return;
        }
        if (result === 'cancelled') {
          this.nextRequiredWindowRefreshAt =
            this.host.getTimeNow() + REQUIRED_WINDOW_REFRESH_RETRY_MS;
          return;
        }
        this.nextRequiredWindowRefreshAt =
          this.host.getTimeNow() + REQUIRED_WINDOW_REFRESH_ERROR_RETRY_MS;
      })
      .finally(() => {
        if (
          resetGeneration === this.requiredWindowRefreshResetGeneration
          && this.requiredWindowRefreshInFlightToken === request.token
        ) {
          this.requiredWindowRefreshInFlightToken = null;
        }
      });
    return true;
  }

  private isRequiredWindowRefreshSatisfied(
    request: PendingRequiredWindowRefresh,
  ): boolean {
    if (request.requirements.successfulAttempt) {
      return false;
    }
    if (
      request.requirements.playableSnapshot
      && this.host.getMode() === 'play'
      && !this.host.worldStreamingController.getPlayableRoomSnapshotViewForCoordinates(
        request.centerCoordinates,
      )
    ) {
      return false;
    }
    if (
      request.requirements.windowCoverage
      && this.host.worldStreamingController.needsRefreshAround(request.centerCoordinates)
    ) {
      return false;
    }
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
