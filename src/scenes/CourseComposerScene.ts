import Phaser from 'phaser';
import { getAuthDebugState } from '../auth/client';
import { ROOM_PX_HEIGHT, ROOM_PX_WIDTH } from '../config';
import { createCourseRepository } from '../courses/courseRepository';
import {
  cloneCourseRecord,
  cloneCourseSnapshot,
  courseRoomRefsFormConnectedCluster,
  createDefaultCourseGoal,
  createDefaultCourseRecord,
  getCourseRoomOrder,
  MAX_COURSE_ROOMS,
  sortCourseRoomRefsForStorage,
  type CourseCheckpointSprintGoal,
  type CourseGoal,
  type CourseGoalType,
  type CourseMarkerPoint,
  type CourseRecord,
  type CourseRoomRef,
} from '../courses/model';
import {
  buildCourseEditorUiState,
} from '../courses/editor/viewModel';
import type {
  CourseEditorCheckpointEntry,
  CourseEditorRoomEntry,
  CourseEditorTool,
  CourseEditorUiState,
} from '../courses/editor/state';
import {
  clearActiveCourseDraftSessionRoomOverride,
  getActiveCourseDraftSessionCourseId,
  getActiveCourseDraftSessionDraft,
  getActiveCourseDraftSessionRecord,
  getActiveCourseDraftSessionSelectedRoomId,
  isActiveCourseDraftSessionDirty,
  setActiveCourseDraftSessionRecord,
  setActiveCourseDraftSessionRoomOverride,
  setActiveCourseDraftSessionSelectedRoom,
  updateActiveCourseDraftSession,
} from '../courses/draftSession';
import { createGoalMarkerFlagSprite } from '../goals/markerFlags';
import {
  cloneRoomSnapshot,
  DEFAULT_ROOM_COORDINATES,
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomRecord,
  type RoomSnapshot,
} from '../persistence/roomRepository';
import { createRoomRepository } from '../persistence/roomRepository';
import type { WorldRoomSummary } from '../persistence/worldModel';
import { createWorldRepository } from '../persistence/worldRepository';
import { setAppMode } from '../ui/appMode';
import { hideBusyOverlay, showBusyError, showBusyOverlay } from '../ui/appFeedback';
import { getPerformanceProfile } from '../ui/deviceLayout';
import {
  COURSE_COMPOSER_STATE_CHANGED_EVENT,
  type CourseComposerSceneBridge,
} from '../ui/setup/sceneBridge';
import { constrainInspectCamera, getFitZoomForRoom, getScrollForScreenAnchor, getScreenAnchorWorldPoint } from './overworld/camera';
import { OverworldWorldStreamingController } from './overworld/worldStreaming';
import type { CourseComposerSceneData, EditorSceneData, OverworldPlaySceneData } from './sceneData';

const MIN_ZOOM = 0.08;
const MAX_ZOOM = 1.5;
const BUTTON_ZOOM_FACTOR = 1.2;
const FIT_PADDING = 96;
const PAN_THRESHOLD = 5;
const DEFAULT_COURSE_COMPOSER_STATUS_TEXT = 'Select published rooms you authored to build a course.';

interface CoursePublishedRoomMeta {
  roomId: string;
  coordinates: RoomCoordinates;
  roomVersion: number;
  roomTitle: string | null;
  publishedByUserId: string | null;
  courseId: string | null;
}

export class CourseComposerScene extends Phaser.Scene implements CourseComposerSceneBridge {
  private readonly worldRepository = createWorldRepository();
  private readonly roomRepository = createRoomRepository();
  private readonly courseRepository = createCourseRepository();
  private worldStreamingController!: OverworldWorldStreamingController;
  private record: CourseRecord | null = null;
  private uiState: CourseEditorUiState | null = null;
  private selectedCoordinates: RoomCoordinates = { ...DEFAULT_ROOM_COORDINATES };
  private centerCoordinates: RoomCoordinates = { ...DEFAULT_ROOM_COORDINATES };
  private inspectZoom = 0.18;
  private tool: CourseEditorTool = 'select';
  private statusText: string | null = null;
  private selectionGraphics!: Phaser.GameObjects.Graphics;
  private markerSprites: Phaser.GameObjects.Sprite[] = [];
  private markerLabels: Phaser.GameObjects.Text[] = [];
  private modifierKeys: {
    SPACE: Phaser.Input.Keyboard.Key | null;
    ALT: Phaser.Input.Keyboard.Key | null;
  } = { SPACE: null, ALT: null };
  private isPanning = false;
  private panStartPointer = { x: 0, y: 0 };
  private panStartScroll = { x: 0, y: 0 };
  private loading = false;
  private roomMetaByRoomId = new Map<string, CoursePublishedRoomMeta>();

  constructor() {
    super({ key: 'CourseComposerScene' });
  }

  private readonly handleWake = (_sys: Phaser.Scenes.Systems, data?: CourseComposerSceneData): void => {
    void this.openFromData(data);
  };

  private readonly handleResize = (): void => {
    if (!this.scene.isActive(this.scene.key)) {
      return;
    }

    this.syncCameraBounds();
    this.fitCourseToView(false);
    this.redraw();
  };

  private readonly handleCanvasWheel = (event: WheelEvent): void => {
    if (!this.scene.isActive(this.scene.key)) {
      return;
    }

    event.preventDefault();
    const zoomFactor = Phaser.Math.Clamp(Math.exp(-event.deltaY * 0.0018), 0.92, 1.08);
    this.adjustZoomByFactor(zoomFactor, event.clientX, event.clientY);
  };

  create(data?: CourseComposerSceneData): void {
    this.worldStreamingController = new OverworldWorldStreamingController({
      scene: this,
      worldRepository: this.worldRepository,
      getMode: () => 'browse',
      getPerformanceProfile: () => getPerformanceProfile(),
      getSelectedCoordinates: () => this.centerCoordinates,
      getCurrentRoomCoordinates: () => this.centerCoordinates,
      getRoomOrigin: (coordinates) => this.getRoomOrigin(coordinates),
      getPlayer: () => null,
      createLiveObjects: () => {},
      destroyLiveObjects: () => {},
      destroyEdgeWalls: () => {},
    });

    setAppMode('course-composer');
    this.selectionGraphics = this.add.graphics();
    this.selectionGraphics.setDepth(120);
    this.setupCamera();
    this.setupPointerControls();
    this.setupKeyboard();
    this.events.on('wake', this.handleWake, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);
    this.scale.on('resize', this.handleResize, this);
    this.game.canvas.addEventListener('wheel', this.handleCanvasWheel, { passive: false });

    void this.openFromData(data);
  }

  getCourseEditorState(): CourseEditorUiState | null {
    return this.uiState;
  }

  describeState(): Record<string, unknown> {
    return {
      scene: 'course-composer',
      courseId: this.record?.draft.id ?? null,
      selectedCoordinates: { ...this.selectedCoordinates },
      centerCoordinates: { ...this.centerCoordinates },
      roomCount: this.record?.draft.roomRefs.length ?? 0,
      tool: this.tool,
      zoom: this.cameras.main.zoom,
    };
  }

  async returnToWorld(): Promise<void> {
    const wakeData: OverworldPlaySceneData = {
      centerCoordinates: { ...this.centerCoordinates },
      roomCoordinates: { ...this.selectedCoordinates },
      mode: 'browse',
      statusMessage:
        this.statusText && this.statusText !== DEFAULT_COURSE_COMPOSER_STATUS_TEXT
          ? this.statusText
          : null,
      forceRefreshAround: true,
    };

    this.scene.stop('CourseComposerScene');
    this.scene.wake('OverworldPlayScene', wakeData);
  }

  setCourseTitle(title: string | null): void {
    this.mutateDraft((draft) => {
      draft.title = title?.trim() ? title.trim() : null;
    });
  }

  setCourseGoalType(goalType: CourseGoalType | null): void {
    this.mutateDraft((draft) => {
      draft.goal = goalType ? createDefaultCourseGoal(goalType) : null;
    });
    this.tool = 'select';
  }

  setCourseGoalTimeLimitSeconds(seconds: number | null): void {
    this.mutateDraft((draft) => {
      const goal = draft.goal;
      if (!goal || !('timeLimitMs' in goal)) {
        return;
      }

      goal.timeLimitMs =
        seconds === null || !Number.isFinite(seconds) || seconds <= 0
          ? null
          : Math.round(seconds * 1000);
    });
  }

  setCourseGoalRequiredCount(requiredCount: number): void {
    this.mutateDraft((draft) => {
      if (draft.goal?.type !== 'collect_target') {
        return;
      }

      draft.goal.requiredCount = Math.max(1, Math.round(requiredCount));
    });
  }

  setCourseGoalSurvivalSeconds(seconds: number): void {
    this.mutateDraft((draft) => {
      if (draft.goal?.type !== 'survival') {
        return;
      }

      draft.goal.durationMs = Math.max(1, Math.round(seconds)) * 1000;
    });
  }

  startMarkerPlacement(tool: Exclude<CourseEditorTool, 'select' | 'rooms'> | null): void {
    this.tool = tool ?? 'select';
    this.renderUi();
  }

  clearMarkers(): void {
    this.mutateDraft((draft) => {
      draft.startPoint = null;
      if (draft.goal?.type === 'reach_exit') {
        draft.goal.exit = null;
      }
      if (draft.goal?.type === 'checkpoint_sprint') {
        draft.goal.checkpoints = [];
        draft.goal.finish = null;
      }
    });
    this.tool = 'select';
  }

  centerSelectedRoom(): void {
    this.centerCoordinates = { ...this.selectedCoordinates };
    this.centerCameraOnCoordinates(this.centerCoordinates);
    void this.refreshAround(this.centerCoordinates);
  }

  selectRoom(roomId: string): void {
    const draft = this.record?.draft ?? null;
    const draftRoom = draft?.roomRefs.find((roomRef) => roomRef.roomId === roomId) ?? null;
    if (draftRoom) {
      this.selectedCoordinates = { ...draftRoom.coordinates };
      this.centerCoordinates = { ...draftRoom.coordinates };
      setActiveCourseDraftSessionSelectedRoom(roomId);
      this.centerCameraOnCoordinates(this.selectedCoordinates);
      void this.refreshAround(this.centerCoordinates);
      return;
    }

    const summary = this.worldStreamingController.getRoomSummariesById().get(roomId) ?? null;
    if (!summary) {
      return;
    }

    this.selectedCoordinates = { ...summary.coordinates };
    this.centerCoordinates = { ...summary.coordinates };
    this.centerCameraOnCoordinates(this.selectedCoordinates);
    void this.refreshAround(this.centerCoordinates);
  }

  toggleSelectedRoomMembership(): void {
    const selectedRoomId = roomIdFromCoordinates(this.selectedCoordinates);
    const selectedMeta = this.getSelectedRoomMeta();
    const draft = this.record?.draft ?? null;
    const selectedRoomInDraft = Boolean(draft?.roomRefs.some((roomRef) => roomRef.roomId === selectedRoomId));
    if (!draft) {
      return;
    }

    if (selectedRoomInDraft) {
      const removalBlockedReason = this.getSelectedRoomRemovalDisabledReason(selectedRoomId);
      if (removalBlockedReason) {
        this.statusText = removalBlockedReason;
        this.renderUi();
        return;
      }

      this.mutateDraft((mutableDraft) => {
        mutableDraft.roomRefs = mutableDraft.roomRefs.filter((roomRef) => roomRef.roomId !== selectedRoomId);
      });
      this.statusText = 'Removed room from course.';
      this.renderUi();
      return;
    }

    if (!selectedMeta) {
      this.statusText = 'Only published rooms can be added to a course.';
      this.renderUi();
      return;
    }

    const addBlockedReason = this.getSelectedRoomAddDisabledReason(selectedMeta);
    if (addBlockedReason) {
      this.statusText = addBlockedReason;
      this.renderUi();
      return;
    }

    this.mutateDraft((mutableDraft) => {
      mutableDraft.roomRefs = sortCourseRoomRefsForStorage([
        ...mutableDraft.roomRefs,
        {
          roomId: selectedMeta.roomId,
          coordinates: { ...selectedMeta.coordinates },
          roomVersion: selectedMeta.roomVersion,
          roomTitle: selectedMeta.roomTitle,
        },
      ]);
    });
    setActiveCourseDraftSessionSelectedRoom(selectedMeta.roomId);
    this.statusText = 'Added room to course.';
    this.renderUi();
  }

  async openSelectedRoom(): Promise<void> {
    const draft = this.record?.draft ?? null;
    if (!draft) {
      return;
    }

    const roomId = roomIdFromCoordinates(this.selectedCoordinates);
    const roomRef = draft.roomRefs.find((entry) => entry.roomId === roomId) ?? null;
    if (!roomRef) {
      return;
    }

    showBusyOverlay('Opening room...', 'Loading room...');
    let roomSnapshot =
      this.worldStreamingController.getRoomSnapshotForCoordinates(roomRef.coordinates) ?? null;
    if (!roomSnapshot) {
      const record = await this.roomRepository.loadRoom(roomRef.roomId, roomRef.coordinates);
      roomSnapshot = record.draft ?? record.published ?? null;
    }

    if (!roomSnapshot) {
      showBusyError('Failed to load the selected room.', {
        closeHandler: () => hideBusyOverlay(),
      });
      return;
    }

    const editorData: EditorSceneData = {
      roomCoordinates: { ...roomRef.coordinates },
      source: 'world',
      roomSnapshot,
        courseEdit: {
          courseId: draft.id,
          roomId: roomRef.roomId,
        },
      };

    if (
      this.scene.isActive('EditorScene') ||
      this.scene.isSleeping('EditorScene') ||
      this.scene.isPaused('EditorScene')
    ) {
      this.scene.stop('EditorScene');
    }

    this.scene.run('EditorScene', editorData);
    this.scene.sleep();
  }

  async openCourseEditor(): Promise<void> {
    const draft = this.record?.draft ?? null;
    if (!draft) {
      return;
    }

    if (draft.roomRefs.length === 0) {
      this.statusText = 'Add at least one room before opening the course editor.';
      this.renderUi();
      return;
    }

    const selectedRoomId =
      this.getSelectedRoomRef()?.roomId ?? getActiveCourseDraftSessionSelectedRoomId() ?? draft.roomRefs[0]?.roomId ?? null;

    const sceneData = {
      courseId: draft.id,
      selectedRoomId,
      statusMessage:
        this.statusText && this.statusText !== DEFAULT_COURSE_COMPOSER_STATUS_TEXT
          ? this.statusText
          : null,
    };

    if (this.scene.isSleeping('CourseEditorScene') || this.scene.isPaused('CourseEditorScene')) {
      this.scene.wake('CourseEditorScene', sceneData);
      this.scene.sleep();
      return;
    }

    if (this.scene.isActive('CourseEditorScene')) {
      this.scene.bringToTop('CourseEditorScene');
      this.scene.sleep();
      return;
    }

    this.scene.run('CourseEditorScene', sceneData);
    this.scene.sleep();
  }

  moveCheckpoint(index: number, direction: -1 | 1): void {
    this.mutateDraft((draft) => {
      if (draft.goal?.type !== 'checkpoint_sprint') {
        return;
      }

      const nextIndex = Phaser.Math.Clamp(index + direction, 0, draft.goal.checkpoints.length - 1);
      if (nextIndex === index) {
        return;
      }

      const nextCheckpoints = [...draft.goal.checkpoints];
      const [moved] = nextCheckpoints.splice(index, 1);
      nextCheckpoints.splice(nextIndex, 0, moved);
      draft.goal.checkpoints = nextCheckpoints;
    });
  }

  removeCheckpoint(index: number): void {
    this.mutateDraft((draft) => {
      if (draft.goal?.type !== 'checkpoint_sprint') {
        return;
      }
      draft.goal.checkpoints = draft.goal.checkpoints.filter((_, checkpointIndex) => checkpointIndex !== index);
    });
  }

  zoomIn(): void {
    this.adjustButtonZoom(BUTTON_ZOOM_FACTOR);
  }

  zoomOut(): void {
    this.adjustButtonZoom(1 / BUTTON_ZOOM_FACTOR);
  }

  fitCourseToView(shouldRefresh: boolean = true): void {
    const focusBounds = this.getCourseBounds();
    const roomCount =
      (focusBounds.maxX - focusBounds.minX + 1) * (focusBounds.maxY - focusBounds.minY + 1);
    const fitZoom = getFitZoomForRoom(
      this.scale.width,
      this.scale.height,
      Math.max(ROOM_PX_WIDTH, (focusBounds.maxX - focusBounds.minX + 1) * ROOM_PX_WIDTH),
      Math.max(ROOM_PX_HEIGHT, (focusBounds.maxY - focusBounds.minY + 1) * ROOM_PX_HEIGHT),
      roomCount > 1 ? FIT_PADDING : 48,
      MIN_ZOOM,
      MAX_ZOOM,
    );
    this.inspectZoom = Number(fitZoom.toFixed(3));
    this.cameras.main.setZoom(this.inspectZoom);

    const focusCoordinates = this.getCourseCenterCoordinates();
    this.centerCoordinates = { ...focusCoordinates };
    this.centerCameraOnCoordinates(focusCoordinates);
    if (shouldRefresh) {
      void this.refreshAround(this.centerCoordinates);
    } else {
      this.redraw();
    }
  }

  async saveCourseDraft(): Promise<void> {
    if (!this.record) {
      return;
    }

    const state = this.uiState;
    if (!state?.canSaveDraft) {
      this.statusText = state?.saveDraftDisabledReason ?? 'Course draft is not ready to save.';
      this.renderUi();
      return;
    }

    this.loading = true;
    this.statusText = 'Saving course draft...';
    this.renderUi();
    try {
      const saved = await this.courseRepository.saveDraft(this.record.draft);
      this.setRecord(saved, getActiveCourseDraftSessionSelectedRoomId());
      this.statusText = 'Course setup saved. Open Edit Course to place goals and edit the rooms together.';
      await this.refreshAround(this.centerCoordinates, true);
    } catch (error) {
      this.statusText = error instanceof Error ? error.message : 'Failed to save course draft.';
      this.renderUi();
    } finally {
      this.loading = false;
      this.renderUi();
    }
  }

  async publishCourseDraft(): Promise<void> {
    if (!this.record) {
      return;
    }

    const state = this.uiState;
    if (!state?.canPublishCourse) {
      this.statusText = state?.publishCourseDisabledReason ?? 'Course draft is not ready to publish.';
      this.renderUi();
      return;
    }

    this.loading = true;
    this.statusText = 'Publishing course...';
    this.renderUi();
    try {
      const saved = await this.courseRepository.saveDraft(this.record.draft);
      this.setRecord(saved, getActiveCourseDraftSessionSelectedRoomId());
      const published = await this.courseRepository.publishCourse(this.record.draft.id);
      this.setRecord(published, getActiveCourseDraftSessionSelectedRoomId());
      this.statusText = 'Course published.';
      await this.refreshAround(this.centerCoordinates, true);
    } catch (error) {
      this.statusText = error instanceof Error ? error.message : 'Failed to publish course.';
      this.renderUi();
    } finally {
      this.loading = false;
      this.renderUi();
    }
  }

  async unpublishCourse(): Promise<void> {
    if (!this.record) {
      return;
    }

    const state = this.uiState;
    if (!state?.canUnpublishCourse) {
      this.statusText = state?.unpublishCourseDisabledReason ?? 'Course is not ready to unpublish.';
      this.renderUi();
      return;
    }

    this.loading = true;
    this.statusText = 'Unpublishing course...';
    this.renderUi();
    try {
      const unpublished = await this.courseRepository.unpublishCourse(this.record.draft.id);
      const preservedDraft = cloneCourseSnapshot(this.record.draft);
      preservedDraft.status = 'draft';
      preservedDraft.publishedAt = null;
      this.setRecord(
        {
          ...unpublished,
          draft: preservedDraft,
        },
        getActiveCourseDraftSessionSelectedRoomId(),
      );
      this.statusText = 'Course unpublished.';
      await this.refreshAround(this.centerCoordinates, true);
    } catch (error) {
      this.statusText = error instanceof Error ? error.message : 'Failed to unpublish course.';
      this.renderUi();
    } finally {
      this.loading = false;
      this.renderUi();
    }
  }

  async testDraftCourse(): Promise<void> {
    const draft = this.record?.draft ?? null;
    const state = this.uiState;
    if (!draft || !state?.canTestDraft) {
      this.statusText = state?.testDraftDisabledReason ?? 'Course draft is not ready to test.';
      this.renderUi();
      return;
    }

    const startRoom =
      (draft.startPoint
        ? draft.roomRefs.find((roomRef) => roomRef.roomId === draft.startPoint?.roomId) ?? null
        : draft.roomRefs[0] ?? null);
    if (!startRoom) {
      this.statusText = 'Course draft has no playable rooms.';
      this.renderUi();
      return;
    }

    const wakeData: OverworldPlaySceneData = {
      centerCoordinates: { ...startRoom.coordinates },
      roomCoordinates: { ...startRoom.coordinates },
      mode: 'play',
      statusMessage: 'Testing draft course.',
      courseDraftPreviewId: draft.id,
      courseEditorReturnTarget: {
        courseId: draft.id,
        selectedCoordinates: { ...this.selectedCoordinates },
        centerCoordinates: { ...this.centerCoordinates },
      },
    };

    this.scene.wake('OverworldPlayScene', wakeData);
    this.scene.sleep();
  }

  private async openFromData(data?: CourseComposerSceneData): Promise<void> {
    setAppMode('course-composer');
    this.loading = true;
    this.applySceneData(data);
    this.renderUi();

    try {
      const nextRecord = await this.resolveInitialRecord(data?.courseId ?? null);
      this.setRecord(nextRecord, data?.courseEditedRoom?.roomId ?? roomIdFromCoordinates(this.selectedCoordinates));

      if (data?.courseEditedRoom) {
        setActiveCourseDraftSessionSelectedRoom(data.courseEditedRoom.roomId);
        const currentDraft = this.record?.draft ?? null;
        const roomRef =
          currentDraft?.roomRefs.find((entry) => entry.roomId === data.courseEditedRoom?.roomId) ?? null;
        if (roomRef) {
          this.selectedCoordinates = { ...roomRef.coordinates };
        }
      }

      if (data?.statusMessage) {
        this.statusText = data.statusMessage;
      } else if (!this.statusText) {
        this.statusText = this.record?.draft.title?.trim()
          ? `Editing ${this.record.draft.title}`
          : DEFAULT_COURSE_COMPOSER_STATUS_TEXT;
      }

      if (this.record?.draft.roomRefs.length) {
        this.fitCourseToView(false);
      } else {
        this.centerCameraOnCoordinates(this.centerCoordinates);
      }

      await this.refreshAround(this.centerCoordinates, true);
    } catch (error) {
      console.error('Failed to open course composer', error);
      this.statusText = error instanceof Error ? error.message : 'Failed to open course editor.';
      this.renderUi();
    } finally {
      this.loading = false;
      this.renderUi();
    }
  }

  private applySceneData(data?: CourseComposerSceneData): void {
    if (data?.selectedCoordinates) {
      this.selectedCoordinates = { ...data.selectedCoordinates };
    }
    if (data?.centerCoordinates) {
      this.centerCoordinates = { ...data.centerCoordinates };
    } else if (data?.selectedCoordinates) {
      this.centerCoordinates = { ...data.selectedCoordinates };
    }

    if (
      data?.clearDraftRoomId ||
      data?.draftRoom ||
      data?.publishedRoom ||
      data?.invalidateRoomId
    ) {
      this.worldStreamingController.applyOptimisticMutation({
        clearDraftRoomId: data.clearDraftRoomId ?? null,
        draftRoom: data.draftRoom ? cloneRoomSnapshot(data.draftRoom) : null,
        publishedRoom: data.publishedRoom ? cloneRoomSnapshot(data.publishedRoom) : null,
        invalidateRoomId: data.invalidateRoomId ?? null,
      });
    }
  }

  private async resolveInitialRecord(courseId: string | null): Promise<CourseRecord> {
    const sessionRecord = getActiveCourseDraftSessionRecord();
    const selectedRoomId = roomIdFromCoordinates(this.selectedCoordinates);
    if (sessionRecord && getCourseRoomOrder(sessionRecord.draft.roomRefs, selectedRoomId) >= 0) {
      return this.normalizeRecord(sessionRecord);
    }

    if (courseId) {
      if (sessionRecord?.draft.id === courseId) {
        return this.normalizeRecord(sessionRecord);
      }
      const loaded = await this.courseRepository.loadCourse(courseId);
      return this.normalizeRecord(loaded);
    }

    const authState = getAuthDebugState();
    if (authState.authenticated) {
      const savedDraftForSelectedRoom = await this.courseRepository.loadLatestDraftForRoom(selectedRoomId);
      if (savedDraftForSelectedRoom) {
        return this.normalizeRecord(savedDraftForSelectedRoom);
      }
    }

    if (sessionRecord) {
      return this.normalizeRecord(sessionRecord);
    }

    const record = createDefaultCourseRecord();
    record.ownerUserId = authState.user?.id ?? null;
    record.ownerDisplayName = authState.user?.displayName ?? null;
    record.permissions = {
      canSaveDraft: Boolean(authState.authenticated),
      canPublish: Boolean(authState.authenticated),
      canUnpublish: Boolean(authState.authenticated),
    };
    return this.normalizeRecord(record);
  }

  private normalizeRecord(record: CourseRecord): CourseRecord {
    const next = cloneCourseRecord(record);
    next.draft.roomRefs = sortCourseRoomRefsForStorage(next.draft.roomRefs);
    if (next.published) {
      next.published.roomRefs = sortCourseRoomRefsForStorage(next.published.roomRefs);
    }
    next.versions = next.versions.map((version) => ({
      ...version,
      snapshot: {
        ...version.snapshot,
        roomRefs: sortCourseRoomRefsForStorage(version.snapshot.roomRefs),
      },
    }));
    return next;
  }

  private setRecord(record: CourseRecord | null, selectedRoomId: string | null = null): void {
    setActiveCourseDraftSessionRecord(record, { selectedRoomId });
    this.record = getActiveCourseDraftSessionRecord();
    this.renderUi();
  }

  private mutateDraft(mutator: (draft: CourseRecord['draft']) => void): void {
    if (!this.record?.permissions.canSaveDraft) {
      return;
    }

    updateActiveCourseDraftSession((draft) => {
      mutator(draft);
      draft.roomRefs = sortCourseRoomRefsForStorage(draft.roomRefs);
    });
    this.record = getActiveCourseDraftSessionRecord();
    this.renderUi();
  }

  private async refreshAround(
    centerCoordinates: RoomCoordinates,
    forceChunkReload: boolean = false
  ): Promise<void> {
    this.centerCoordinates = { ...centerCoordinates };
    await this.worldStreamingController.refreshAround(centerCoordinates, { forceChunkReload });
    this.syncCameraBounds();
    this.redraw();
  }

  private redraw(): void {
    this.redrawSelection();
    this.redrawMarkers();
    this.renderUi();
  }

  private renderUi(): void {
    const zoom = this.cameras.main?.zoom ?? this.inspectZoom;

    this.uiState = buildCourseEditorUiState({
      record: this.record,
      dirty: isActiveCourseDraftSessionDirty(),
      zoomText: `Zoom: ${zoom.toFixed(2)}x`,
      tool: this.tool,
      statusText: this.loading ? 'Loading course…' : this.statusText,
      selectedRoomSummary: this.getSelectedRoomSummaryText(),
      selectedRoomStatusText: this.getSelectedRoomStatusText(),
      selectedRoomId: this.getSelectedRoomRef()?.roomId ?? this.getSelectedSummary()?.id ?? null,
      canToggleSelectedRoom: this.canToggleSelectedRoomMembership(),
      toggleSelectedRoomLabel: this.getSelectedRoomToggleLabel(),
      toggleSelectedRoomDisabledReason: this.getSelectedRoomToggleDisabledReason(),
      canOpenSelectedRoom: this.getSelectedRoomRef() !== null,
      canCenterSelectedRoom: true,
      canOpenCourseEditor: this.getOpenCourseEditorDisabledReason() === null,
      openCourseEditorDisabledReason: this.getOpenCourseEditorDisabledReason(),
      roomEntries: this.buildRoomEntries(),
      checkpointEntries: this.buildCheckpointEntries(),
    });

    window.dispatchEvent(new Event(COURSE_COMPOSER_STATE_CHANGED_EVENT));
  }

  private getSelectedSummary(): WorldRoomSummary | null {
    return this.worldStreamingController.getRoomSummariesById().get(
      roomIdFromCoordinates(this.selectedCoordinates)
    ) ?? null;
  }

  private getSelectedRoomMeta(): CoursePublishedRoomMeta | null {
    const roomId = roomIdFromCoordinates(this.selectedCoordinates);
    const cached = this.roomMetaByRoomId.get(roomId);
    if (cached) {
      return cached;
    }

    const summary = this.getSelectedSummary();
    if (!summary || summary.state !== 'published') {
      return null;
    }

    const meta: CoursePublishedRoomMeta = {
      roomId,
      coordinates: { ...summary.coordinates },
      roomVersion: summary.version ?? 1,
      roomTitle: summary.title,
      publishedByUserId: summary.publishedByUserId ?? summary.creatorUserId ?? null,
      courseId: summary.course?.courseId ?? null,
    };
    this.roomMetaByRoomId.set(roomId, meta);
    return meta;
  }

  private getSelectedRoomRef(): CourseRoomRef | null {
    const draft = this.record?.draft ?? null;
    if (!draft) {
      return null;
    }

    const roomId = roomIdFromCoordinates(this.selectedCoordinates);
    return draft.roomRefs.find((roomRef) => roomRef.roomId === roomId) ?? null;
  }

  private getSelectedRoomSummaryText(): string {
    const summary = this.getSelectedSummary();
    const selectedRef = this.getSelectedRoomRef();
    const coordinates = `${this.selectedCoordinates.x},${this.selectedCoordinates.y}`;
    const title =
      selectedRef?.roomTitle?.trim() ??
      summary?.title?.trim() ??
      `Room ${coordinates}`;
    const membershipText = selectedRef ? 'In this course' : 'Not in this course';

    return `${title} · ${coordinates} · ${membershipText}`;
  }

  private getSelectedRoomStatusText(): string {
    const selectedRef = this.getSelectedRoomRef();
    if (selectedRef) {
      const removalBlockedReason = this.getSelectedRoomRemovalDisabledReason(selectedRef.roomId);
      return removalBlockedReason ?? 'Room is part of this course cluster.';
    }

    const meta = this.getSelectedRoomMeta();
    if (!meta) {
      return 'Only published rooms you authored can be added.';
    }

    return this.getSelectedRoomAddDisabledReason(meta) ?? 'Room can join the current connected cluster.';
  }

  private canToggleSelectedRoomMembership(): boolean {
    const selectedRef = this.getSelectedRoomRef();
    if (selectedRef) {
      return this.getSelectedRoomRemovalDisabledReason(selectedRef.roomId) === null;
    }

    const meta = this.getSelectedRoomMeta();
    return meta !== null && this.getSelectedRoomAddDisabledReason(meta) === null;
  }

  private getSelectedRoomToggleLabel(): string {
    return this.getSelectedRoomRef() ? 'Remove Room' : 'Add Room';
  }

  private getSelectedRoomToggleDisabledReason(): string | null {
    const selectedRef = this.getSelectedRoomRef();
    if (selectedRef) {
      return this.getSelectedRoomRemovalDisabledReason(selectedRef.roomId);
    }

    const meta = this.getSelectedRoomMeta();
    return meta ? this.getSelectedRoomAddDisabledReason(meta) : 'Only published rooms can be added.';
  }

  private getOpenCourseEditorDisabledReason(): string | null {
    const draft = this.record?.draft ?? null;
    if (!draft) {
      return 'No active course draft.';
    }

    if (!this.record?.permissions.canSaveDraft) {
      return 'This course is read-only for your account.';
    }

    if (!draft.title?.trim()) {
      return 'Add a course title before editing.';
    }

    if (draft.roomRefs.length === 0) {
      return 'Add at least one room before editing the course.';
    }

    if (isActiveCourseDraftSessionDirty()) {
      return 'Save course setup before editing.';
    }

    return null;
  }

  private getSelectedRoomAddDisabledReason(meta: CoursePublishedRoomMeta): string | null {
    if (!this.record?.permissions.canSaveDraft) {
      return 'This course is read-only for your account.';
    }

    const authState = getAuthDebugState();
    if (!authState.authenticated || !authState.user?.id) {
      return 'Sign in to edit courses.';
    }

    if (meta.publishedByUserId !== authState.user.id) {
      return 'You can only add rooms you authored.';
    }

    if (meta.courseId && meta.courseId !== this.record.draft.id) {
      return 'This room is already published in another course.';
    }

    if (this.record.ownerUserId && this.record.ownerUserId !== meta.publishedByUserId) {
      return 'All course rooms must belong to the same creator.';
    }

    if (this.record.draft.roomRefs.some((roomRef) => roomRef.roomId === meta.roomId)) {
      return 'Room is already in this course.';
    }

    if (this.record.draft.roomRefs.length >= MAX_COURSE_ROOMS) {
      return `Courses are limited to ${MAX_COURSE_ROOMS} rooms for now.`;
    }

    const nextRoomRefs = [
      ...this.record.draft.roomRefs,
      {
        roomId: meta.roomId,
        coordinates: { ...meta.coordinates },
        roomVersion: meta.roomVersion,
        roomTitle: meta.roomTitle,
      },
    ];
    return courseRoomRefsFormConnectedCluster(nextRoomRefs)
      ? null
      : 'Course rooms must stay in one connected cluster.';
  }

  private getSelectedRoomRemovalDisabledReason(roomId: string): string | null {
    const draft = this.record?.draft ?? null;
    if (!draft) {
      return 'No active course draft.';
    }

    if (draft.startPoint?.roomId === roomId) {
      return 'Remove the course start marker first.';
    }

    if (draft.goal?.type === 'reach_exit' && draft.goal.exit?.roomId === roomId) {
      return 'Remove the course exit marker first.';
    }

    if (draft.goal?.type === 'checkpoint_sprint') {
      if (draft.goal.finish?.roomId === roomId) {
        return 'Remove the finish marker first.';
      }
      if (draft.goal.checkpoints.some((checkpoint) => checkpoint.roomId === roomId)) {
        return 'Remove checkpoints in this room first.';
      }
    }

    const nextRoomRefs = draft.roomRefs.filter((roomRef) => roomRef.roomId !== roomId);
    if (nextRoomRefs.length > 0 && !courseRoomRefsFormConnectedCluster(nextRoomRefs)) {
      return 'Removing this room would split the course cluster.';
    }

    return null;
  }

  private buildRoomEntries(): CourseEditorRoomEntry[] {
    const draft = this.record?.draft ?? null;
    if (!draft) {
      return [];
    }

    const checkpointIndexesByRoomId = new Map<string, number[]>();
    if (draft.goal?.type === 'checkpoint_sprint') {
      draft.goal.checkpoints.forEach((checkpoint, index) => {
        const existing = checkpointIndexesByRoomId.get(checkpoint.roomId) ?? [];
        existing.push(index);
        checkpointIndexesByRoomId.set(checkpoint.roomId, existing);
      });
    }

    const roomEntries = sortCourseRoomRefsForStorage(draft.roomRefs).map((roomRef) => ({
      roomId: roomRef.roomId,
      coordinates: { ...roomRef.coordinates },
      roomVersion: roomRef.roomVersion,
      roomTitle: roomRef.roomTitle,
      selected: roomRef.roomId === roomIdFromCoordinates(this.selectedCoordinates),
      isStartRoom: draft.startPoint?.roomId === roomRef.roomId,
      isFinishRoom:
        draft.goal?.type === 'reach_exit'
          ? draft.goal.exit?.roomId === roomRef.roomId
          : draft.goal?.type === 'checkpoint_sprint'
            ? draft.goal.finish?.roomId === roomRef.roomId
            : false,
      checkpointIndexes: checkpointIndexesByRoomId.get(roomRef.roomId) ?? [],
    }));

    return roomEntries;
  }

  private buildCheckpointEntries(): CourseEditorCheckpointEntry[] {
    const draft = this.record?.draft ?? null;
    const goal = draft?.goal?.type === 'checkpoint_sprint' ? draft.goal : null;
    if (!draft || !goal) {
      return [];
    }

    return goal.checkpoints.map((point, index) => {
      const roomRef = draft.roomRefs.find((room) => room.roomId === point.roomId) ?? null;
      return {
        index,
        point: { ...point },
        roomTitle: roomRef?.roomTitle ?? null,
        coordinates: roomRef?.coordinates ? { ...roomRef.coordinates } : { ...this.selectedCoordinates },
        canMoveEarlier: index > 0,
        canMoveLater: index < goal.checkpoints.length - 1,
      };
    });
  }

  private redrawSelection(): void {
    const draft = this.record?.draft ?? null;
    this.selectionGraphics.clear();
    if (!draft) {
      return;
    }

    this.selectionGraphics.lineStyle(2, 0xffd36a, 0.88);
    for (const roomRef of draft.roomRefs) {
      const origin = this.getRoomOrigin(roomRef.coordinates);
      this.selectionGraphics.strokeRect(origin.x, origin.y, ROOM_PX_WIDTH, ROOM_PX_HEIGHT);
    }

    const selectedOrigin = this.getRoomOrigin(this.selectedCoordinates);
    this.selectionGraphics.lineStyle(3, 0x7de5ff, 0.95);
    this.selectionGraphics.strokeRect(selectedOrigin.x + 2, selectedOrigin.y + 2, ROOM_PX_WIDTH - 4, ROOM_PX_HEIGHT - 4);
  }

  private redrawMarkers(): void {
    this.markerSprites.forEach((sprite) => sprite.destroy());
    this.markerLabels.forEach((label) => label.destroy());
    this.markerSprites = [];
    this.markerLabels = [];

    const draft = this.record?.draft ?? null;
    if (!draft?.goal) {
      return;
    }

    const addLabel = (point: CourseMarkerPoint, labelText: string | null, finish: boolean): void => {
      const roomRef = draft.roomRefs.find((room) => room.roomId === point.roomId) ?? null;
      if (!roomRef) {
        return;
      }
      const origin = this.getRoomOrigin(roomRef.coordinates);
      const sprite = createGoalMarkerFlagSprite(
        this,
        finish ? 'finish-pending' : 'checkpoint-pending',
        origin.x + point.x,
        origin.y + point.y + 2,
        130,
      );
      this.markerSprites.push(sprite);

      if (!labelText) {
        return;
      }
      const label = this.add.text(origin.x + point.x, origin.y + point.y - 28, labelText, {
        fontFamily: 'Courier New',
        fontSize: '12px',
        color: '#ffefef',
        stroke: '#050505',
        strokeThickness: 4,
      });
      label.setOrigin(0.5, 1);
      label.setDepth(131);
      this.markerLabels.push(label);
    };

    if (draft.startPoint) {
      addLabel(draft.startPoint, 'START', false);
    }

    if (draft.goal.type === 'reach_exit' && draft.goal.exit) {
      addLabel(draft.goal.exit, 'EXIT', true);
    }

    if (draft.goal.type === 'checkpoint_sprint') {
      draft.goal.checkpoints.forEach((checkpoint, index) => {
        addLabel(checkpoint, `${index + 1}`, false);
      });
      if (draft.goal.finish) {
        addLabel(draft.goal.finish, 'FINISH', true);
      }
    }
  }

  private setupCamera(): void {
    this.cameras.main.setRoundPixels(true);
    this.cameras.main.setZoom(this.inspectZoom);
    this.syncCameraBounds();
    this.centerCameraOnCoordinates(this.centerCoordinates);
  }

  private setupPointerControls(): void {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.pointerRequestsPan(pointer)) {
        this.isPanning = true;
        this.panStartPointer = { x: pointer.x, y: pointer.y };
        this.panStartScroll = {
          x: this.cameras.main.scrollX,
          y: this.cameras.main.scrollY,
        };
        return;
      }
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.isPanning) {
        return;
      }

      const distance = Phaser.Math.Distance.Between(
        this.panStartPointer.x,
        this.panStartPointer.y,
        pointer.x,
        pointer.y,
      );
      if (distance < PAN_THRESHOLD) {
        return;
      }

      const dx = (this.panStartPointer.x - pointer.x) / this.cameras.main.zoom;
      const dy = (this.panStartPointer.y - pointer.y) / this.cameras.main.zoom;
      this.cameras.main.setScroll(this.panStartScroll.x + dx, this.panStartScroll.y + dy);
      this.constrainInspectCamera();
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (this.isPanning) {
        this.isPanning = false;
        this.centerCoordinates = this.getCameraCenterCoordinates();
        void this.refreshAround(this.centerCoordinates);
        return;
      }

      this.handlePointerAction(pointer);
    });
  }

  private setupKeyboard(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) {
      return;
    }

    this.modifierKeys = {
      SPACE: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      ALT: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ALT),
    };

    keyboard.on('keydown-F', () => {
      this.fitCourseToView();
    });
    keyboard.on('keydown-ESC', () => {
      void this.returnToWorld();
    });
  }

  private handlePointerAction(pointer: Phaser.Input.Pointer): void {
    const coordinates = this.getPointerRoomCoordinates(pointer);
    this.selectedCoordinates = { ...coordinates };
    const roomId = roomIdFromCoordinates(coordinates);
    if (this.record?.draft.roomRefs.some((roomRef) => roomRef.roomId === roomId)) {
      setActiveCourseDraftSessionSelectedRoom(roomId);
    }

    const activePlacementMode =
      this.tool === 'start' || this.tool === 'exit' || this.tool === 'checkpoint' || this.tool === 'finish'
        ? this.tool
        : null;

    if (!activePlacementMode) {
      this.redraw();
      return;
    }

    if (!this.getSelectedRoomRef()) {
      this.statusText = 'Add this room to the course first.';
      this.redraw();
      return;
    }

    const point = this.createMarkerPointFromPointer(pointer, coordinates);
    this.mutateDraft((draft) => {
      if (activePlacementMode === 'start') {
        draft.startPoint = point;
        return;
      }

      if (draft.goal?.type === 'reach_exit' && activePlacementMode === 'exit') {
        draft.goal.exit = point;
        return;
      }

      if (draft.goal?.type === 'checkpoint_sprint' && activePlacementMode === 'checkpoint') {
        draft.goal.checkpoints = [...draft.goal.checkpoints, point];
        return;
      }

      if (draft.goal?.type === 'checkpoint_sprint' && activePlacementMode === 'finish') {
        draft.goal.finish = point;
      }
    });
    this.tool = 'select';
    this.statusText = 'Marker updated.';
    this.redraw();
  }

  private createMarkerPointFromPointer(
    pointer: Phaser.Input.Pointer,
    coordinates: RoomCoordinates
  ): CourseMarkerPoint {
    const origin = this.getRoomOrigin(coordinates);
    return {
      roomId: roomIdFromCoordinates(coordinates),
      x: Phaser.Math.Clamp(Math.round(pointer.worldX - origin.x), 0, ROOM_PX_WIDTH - 1),
      y: Phaser.Math.Clamp(Math.round(pointer.worldY - origin.y), 0, ROOM_PX_HEIGHT - 1),
    };
  }

  private pointerRequestsPan(pointer: Phaser.Input.Pointer): boolean {
    return (
      pointer.rightButtonDown() ||
      Boolean(this.modifierKeys.SPACE?.isDown) ||
      Boolean(this.modifierKeys.ALT?.isDown)
    );
  }

  private getPointerRoomCoordinates(pointer: Phaser.Input.Pointer): RoomCoordinates {
    return {
      x: Math.floor(pointer.worldX / ROOM_PX_WIDTH),
      y: Math.floor(pointer.worldY / ROOM_PX_HEIGHT),
    };
  }

  private adjustButtonZoom(factor: number): void {
    const nextZoom = Phaser.Math.Clamp(this.cameras.main.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(nextZoom - this.cameras.main.zoom) < 0.0001) {
      return;
    }

    this.inspectZoom = Number(nextZoom.toFixed(3));
    this.cameras.main.setZoom(this.inspectZoom);
    this.centerCameraOnCoordinates(this.centerCoordinates);
    void this.refreshAround(this.centerCoordinates);
  }

  private adjustZoomByFactor(factor: number, screenX: number, screenY: number): void {
    const camera = this.cameras.main;
    const nextZoom = Phaser.Math.Clamp(camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(nextZoom - camera.zoom) < 0.0001) {
      return;
    }

    const anchorWorldPoint = getScreenAnchorWorldPoint(screenX, screenY, camera);
    this.inspectZoom = Number(nextZoom.toFixed(3));
    camera.setZoom(this.inspectZoom);
    const nextScroll = getScrollForScreenAnchor(
      anchorWorldPoint.x,
      anchorWorldPoint.y,
      screenX,
      screenY,
      camera,
    );
    camera.setScroll(nextScroll.x, nextScroll.y);
    this.constrainInspectCamera();
    this.centerCoordinates = this.getCameraCenterCoordinates();
    void this.refreshAround(this.centerCoordinates);
  }

  private centerCameraOnCoordinates(coordinates: RoomCoordinates): void {
    const origin = this.getRoomOrigin(coordinates);
    this.syncCameraBounds();
    this.cameras.main.setZoom(this.inspectZoom);
    this.cameras.main.centerOn(origin.x + ROOM_PX_WIDTH / 2, origin.y + ROOM_PX_HEIGHT / 2);
    this.constrainInspectCamera();
  }

  private syncCameraBounds(): void {
    const worldWindow = this.worldStreamingController.getWorldWindow();
    if (!worldWindow) {
      return;
    }

    const minX = (worldWindow.center.x - worldWindow.radius) * ROOM_PX_WIDTH;
    const minY = (worldWindow.center.y - worldWindow.radius) * ROOM_PX_HEIGHT;
    const width = (worldWindow.radius * 2 + 1) * ROOM_PX_WIDTH;
    const height = (worldWindow.radius * 2 + 1) * ROOM_PX_HEIGHT;
    this.cameras.main.setBounds(minX, minY, width, height);
  }

  private constrainInspectCamera(): void {
    if (!this.worldStreamingController.getWorldWindow()) {
      return;
    }
    constrainInspectCamera(this.cameras.main);
  }

  private getCameraCenterCoordinates(): RoomCoordinates {
    const camera = this.cameras.main;
    return {
      x: Math.floor((camera.scrollX + camera.width * 0.5 / camera.zoom) / ROOM_PX_WIDTH),
      y: Math.floor((camera.scrollY + camera.height * 0.5 / camera.zoom) / ROOM_PX_HEIGHT),
    };
  }

  private getRoomOrigin(coordinates: RoomCoordinates): { x: number; y: number } {
    return {
      x: coordinates.x * ROOM_PX_WIDTH,
      y: coordinates.y * ROOM_PX_HEIGHT,
    };
  }

  private getCourseBounds(): { minX: number; minY: number; maxX: number; maxY: number } {
    const roomRefs = this.record?.draft.roomRefs ?? [];
    if (roomRefs.length === 0) {
      return {
        minX: this.selectedCoordinates.x,
        maxX: this.selectedCoordinates.x,
        minY: this.selectedCoordinates.y,
        maxY: this.selectedCoordinates.y,
      };
    }

    return roomRefs.reduce(
      (bounds, roomRef) => ({
        minX: Math.min(bounds.minX, roomRef.coordinates.x),
        maxX: Math.max(bounds.maxX, roomRef.coordinates.x),
        minY: Math.min(bounds.minY, roomRef.coordinates.y),
        maxY: Math.max(bounds.maxY, roomRef.coordinates.y),
      }),
      {
        minX: roomRefs[0].coordinates.x,
        maxX: roomRefs[0].coordinates.x,
        minY: roomRefs[0].coordinates.y,
        maxY: roomRefs[0].coordinates.y,
      },
    );
  }

  private getCourseCenterCoordinates(): RoomCoordinates {
    const bounds = this.getCourseBounds();
    return {
      x: Math.floor((bounds.minX + bounds.maxX) * 0.5),
      y: Math.floor((bounds.minY + bounds.maxY) * 0.5),
    };
  }

  private handleShutdown(): void {
    this.events.off('wake', this.handleWake, this);
    this.scale.off('resize', this.handleResize, this);
    this.worldStreamingController.destroy();
    this.game.canvas.removeEventListener('wheel', this.handleCanvasWheel);
    this.markerSprites.forEach((sprite) => sprite.destroy());
    this.markerLabels.forEach((label) => label.destroy());
    this.markerSprites = [];
    this.markerLabels = [];
  }
}
