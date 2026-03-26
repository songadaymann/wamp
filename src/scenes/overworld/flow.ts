import Phaser from 'phaser';
import { getAuthDebugState } from '../../auth/client';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../../config';
import { createCourseRepository } from '../../courses/courseRepository';
import {
  getActiveCourseDraftSessionRecord,
} from '../../courses/draftSession';
import {
  cloneCourseSnapshot,
  getCourseRoomOrder,
  type CourseRoomRef,
  type CourseSnapshot,
} from '../../courses/model';
import { setFocusedCoordinatesInUrl } from '../../navigation/worldNavigation';
import { roomIdFromCoordinates, type RoomCoordinates, type RoomSnapshot } from '../../persistence/roomModel';
import { hideBusyOverlay, showBusyError, showBusyOverlay } from '../../ui/appFeedback';
import type {
  CourseComposerReturnTarget,
  CourseComposerSceneData,
  EditorCourseEditData,
  EditorSceneData,
  OverworldMode,
} from '../sceneData';
import type { CameraMode } from './camera';
import type { ActiveCourseRunState } from './courseRuns';
import type { SelectedCellState } from './hudViewModel';

type CoursePlaybackRoomSourceMode = 'published' | 'draftPreview';

interface OverworldSceneFlowHost {
  getMode(): OverworldMode;
  setMode(mode: OverworldMode): void;
  setCameraMode(mode: CameraMode): void;
  getSelectedCoordinates(): RoomCoordinates;
  setSelectedCoordinates(coordinates: RoomCoordinates): void;
  getCurrentRoomCoordinates(): RoomCoordinates;
  setCurrentRoomCoordinates(coordinates: RoomCoordinates): void;
  getSelectedPublishedCourseId(): string | null;
  getCourseEditorReturnTarget(): CourseComposerReturnTarget | null;
  setCourseEditorReturnTarget(target: CourseComposerReturnTarget | null): void;
  getCellStateAt(coordinates: RoomCoordinates): SelectedCellState;
  isFrontierBuildBlockedByClaimLimit(): boolean;
  getSelectedRoomSnapshot(coordinates: RoomCoordinates): RoomSnapshot | null;
  getActiveCourseEditContext(roomId: string): EditorCourseEditData | null;
  resetPlaySession(): void;
  clearTouchGestureState(): void;
  clearGoalRun(): void;
  getInspectZoom(): number;
  setInspectZoom(zoom: number): void;
  getBrowseInspectZoom(): number;
  setBrowseInspectZoom(zoom: number): void;
  getFitZoomForRoom(): number;
  syncAppMode(): void;
  setShouldCenterCamera(value: boolean): void;
  setShouldRespawnPlayer(value: boolean): void;
  refreshAround(
    coordinates: RoomCoordinates,
    options?: { forceChunkReload?: boolean }
  ): Promise<unknown>;
  prepareActiveCourseRoomOverrides(
    snapshot: CourseSnapshot,
    options: { mode: CoursePlaybackRoomSourceMode }
  ): Promise<void>;
  createCourseRunState(snapshot: CourseSnapshot): ActiveCourseRunState;
  getCourseStartRoomRef(course: CourseSnapshot): CourseRoomRef | null;
  getActiveCourseRun(): ActiveCourseRunState | null;
  setActiveCourseRun(runState: ActiveCourseRunState | null): void;
  startRemoteCourseRun(runState: ActiveCourseRunState): void;
  setCourseComposerStatusText(text: string | null): void;
  emitCourseComposerStateChanged(): void;
  renderHud(): void;
}

export class OverworldSceneFlowController {
  private readonly courseRepository = createCourseRepository();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly host: OverworldSceneFlowHost,
  ) {}

  fitLoadedWorld(worldWindow: { radius: number } | null): void {
    if (!worldWindow) {
      return;
    }

    const camera = this.scene.cameras.main;
    const totalWidth = (worldWindow.radius * 2 + 1) * ROOM_PX_WIDTH;
    const totalHeight = (worldWindow.radius * 2 + 1) * ROOM_PX_HEIGHT;
    const padding = 48;
    const fitZoom = Math.min(
      (this.scene.scale.width - padding) / totalWidth,
      (this.scene.scale.height - padding) / totalHeight,
    );

    const clampedZoom = Phaser.Math.Clamp(fitZoom, 0.08, 2.5);
    this.host.setInspectZoom(clampedZoom);
    if (this.host.getMode() === 'browse') {
      this.host.setBrowseInspectZoom(clampedZoom);
    }
    camera.setZoom(clampedZoom);
  }

  playSelectedRoom(): void {
    if (this.host.getMode() === 'play') {
      this.returnToWorld();
      return;
    }

    const selectedCoordinates = this.host.getSelectedCoordinates();
    const selectedState = this.host.getCellStateAt(selectedCoordinates);
    if (selectedState !== 'published' && selectedState !== 'draft') {
      return;
    }

    this.host.resetPlaySession();
    this.host.clearTouchGestureState();
    this.host.setBrowseInspectZoom(this.host.getInspectZoom());
    this.host.setMode('play');
    this.host.setCameraMode('follow');
    this.host.setInspectZoom(this.host.getFitZoomForRoom());
    this.host.syncAppMode();
    this.host.setCurrentRoomCoordinates({ ...selectedCoordinates });
    this.host.setShouldCenterCamera(true);
    this.host.setShouldRespawnPlayer(true);
    setFocusedCoordinatesInUrl(selectedCoordinates);
    void this.host.refreshAround(selectedCoordinates);
  }

  returnToWorld(): void {
    const returnCoordinates =
      this.host.getActiveCourseRun()?.returnCoordinates ?? this.host.getCurrentRoomCoordinates();
    const courseEditorReturnTarget = this.host.getCourseEditorReturnTarget();
    this.host.setCourseEditorReturnTarget(null);
    this.host.resetPlaySession();
    this.host.clearTouchGestureState();
    this.host.setMode('browse');
    this.host.setCameraMode('inspect');
    this.host.setInspectZoom(this.host.getBrowseInspectZoom());
    this.host.syncAppMode();
    this.host.setSelectedCoordinates({ ...returnCoordinates });
    this.host.setCurrentRoomCoordinates({ ...returnCoordinates });
    this.host.setShouldCenterCamera(true);
    this.host.setShouldRespawnPlayer(false);

    if (courseEditorReturnTarget) {
      this.scene.scene.wake('CourseEditorScene', {
        courseId: courseEditorReturnTarget.courseId,
        selectedCoordinates: { ...courseEditorReturnTarget.selectedCoordinates },
        centerCoordinates: { ...courseEditorReturnTarget.centerCoordinates },
      });
      this.scene.scene.sleep();
      return;
    }

    void this.host.refreshAround(returnCoordinates);
  }

  buildSelectedRoom(): void {
    const selectedCoordinates = this.host.getSelectedCoordinates();
    const selectedState = this.host.getCellStateAt(selectedCoordinates);
    if (selectedState !== 'frontier' || this.host.isFrontierBuildBlockedByClaimLimit()) {
      return;
    }

    this.openEditor({
      roomCoordinates: { ...selectedCoordinates },
      source: 'world',
    });
  }

  editSelectedRoom(): void {
    const selectedCoordinates = this.host.getSelectedCoordinates();
    const selectedState = this.host.getCellStateAt(selectedCoordinates);
    if (selectedState !== 'published' && selectedState !== 'draft') {
      return;
    }

    const selectedRoomId = roomIdFromCoordinates(selectedCoordinates);
    this.openEditor({
      roomCoordinates: { ...selectedCoordinates },
      source: 'world',
      roomSnapshot: this.host.getSelectedRoomSnapshot(selectedCoordinates),
      courseEdit: this.host.getActiveCourseEditContext(selectedRoomId),
    });
  }

  openEditor(editorData: EditorSceneData): void {
    showBusyOverlay('Opening editor...', 'Loading room...');

    if (
      this.scene.scene.isActive('EditorScene')
      || this.scene.scene.isSleeping('EditorScene')
      || this.scene.scene.isPaused('EditorScene')
    ) {
      this.scene.scene.stop('EditorScene');
    }

    this.scene.scene.run('EditorScene', editorData);
    this.scene.scene.sleep();
  }

  async playSelectedCourse(): Promise<void> {
    if (this.host.getActiveCourseRun()) {
      this.returnToWorld();
      return;
    }

    const selectedCourseId = this.host.getSelectedPublishedCourseId();
    if (!selectedCourseId) {
      return;
    }

    showBusyOverlay('Starting course...', 'Loading course...');
    try {
      const record = await this.courseRepository.loadCourse(selectedCourseId);
      const snapshot = record.published ? cloneCourseSnapshot(record.published) : null;
      if (!snapshot) {
        throw new Error('This course is not published yet.');
      }
      if (!snapshot.goal) {
        throw new Error('Published course is missing objective data. Reopen the builder and publish again.');
      }

      await this.startCoursePlayback(snapshot, 'published');
      hideBusyOverlay();
    } catch (error) {
      console.error('Failed to start course', error);
      showBusyError(error instanceof Error ? error.message : 'Failed to start course.', {
        closeHandler: () => hideBusyOverlay(),
      });
    }
  }

  async startCoursePlayback(
    snapshot: CourseSnapshot,
    roomSourceMode: CoursePlaybackRoomSourceMode,
  ): Promise<void> {
    this.host.resetPlaySession();
    this.host.clearTouchGestureState();
    this.host.clearGoalRun();
    await this.host.prepareActiveCourseRoomOverrides(snapshot, { mode: roomSourceMode });
    const runState = this.host.createCourseRunState(snapshot);
    this.host.setActiveCourseRun(runState);

    if (runState.leaderboardEligible) {
      this.host.startRemoteCourseRun(runState);
    }

    const startRoom = this.host.getCourseStartRoomRef(snapshot) ?? snapshot.roomRefs[0] ?? null;
    if (!startRoom) {
      throw new Error('This course has no playable rooms.');
    }

    this.host.setBrowseInspectZoom(this.host.getInspectZoom());
    this.host.setMode('play');
    this.host.setCameraMode('follow');
    this.host.setInspectZoom(this.host.getFitZoomForRoom());
    this.host.syncAppMode();
    this.host.setCurrentRoomCoordinates({ ...startRoom.coordinates });
    this.host.setSelectedCoordinates({ ...startRoom.coordinates });
    this.host.setShouldCenterCamera(true);
    this.host.setShouldRespawnPlayer(true);
    this.host.setCourseComposerStatusText(null);
    this.host.emitCourseComposerStateChanged();
    setFocusedCoordinatesInUrl(startRoom.coordinates);
    await this.host.refreshAround(startRoom.coordinates, { forceChunkReload: true });
  }

  async openCourseEditor(): Promise<void> {
    await this.openCourseComposer();
  }

  async openCourseComposer(): Promise<void> {
    const authState = getAuthDebugState();
    const sessionRecord = getActiveCourseDraftSessionRecord();
    const selectedCoordinates = this.host.getSelectedCoordinates();
    const selectedRoomId = roomIdFromCoordinates(selectedCoordinates);
    const selectedRoomInSession = Boolean(
      sessionRecord &&
      getCourseRoomOrder(sessionRecord.draft.roomRefs, selectedRoomId) >= 0,
    );
    const selectedCourseId = selectedRoomInSession
      ? sessionRecord?.draft.id ?? null
      : this.host.getSelectedPublishedCourseId() ?? sessionRecord?.draft.id ?? null;
    const wakeData: CourseComposerSceneData = {
      courseId: selectedCourseId,
      selectedCoordinates: { ...selectedCoordinates },
      centerCoordinates: { ...this.host.getCurrentRoomCoordinates() },
      statusMessage: authState.authenticated ? null : 'Sign in to author and publish courses.',
    };

    this.host.setCourseComposerStatusText(null);
    this.host.emitCourseComposerStateChanged();
    this.host.renderHud();

    if (
      this.scene.scene.isSleeping('CourseComposerScene')
      || this.scene.scene.isPaused('CourseComposerScene')
    ) {
      this.scene.scene.wake('CourseComposerScene', wakeData);
      this.scene.scene.sleep();
      return;
    }

    if (this.scene.scene.isActive('CourseComposerScene')) {
      this.scene.scene.bringToTop('CourseComposerScene');
      this.scene.scene.sleep();
      return;
    }

    this.scene.scene.run('CourseComposerScene', wakeData);
    this.scene.scene.sleep();
  }
}
