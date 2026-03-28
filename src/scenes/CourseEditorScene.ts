import Phaser from 'phaser';
import {
  canObjectBeStoredInContainer,
  canPlacedObjectBeContainer,
  canPlacedObjectBePressurePlateTarget,
  canPlacedObjectTriggerOtherObjects,
  getObjectById,
  LAYER_NAMES,
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_WIDTH,
  TILESETS,
  TILE_SIZE,
  editorState,
  type PlacedObject,
} from '../config';
import { createCourseRepository } from '../courses/courseRepository';
import {
  cloneCourseSnapshot,
  createDefaultCourseGoal,
  type CourseGoalType,
  type CourseMarkerPoint,
  type CourseRecord,
  type CourseRoomRef,
  type CourseSnapshot,
} from '../courses/model';
import {
  clearActiveCourseDraftSessionRoomOverride,
  getActiveCourseDraftSessionCourseId,
  getActiveCourseDraftSessionDraft,
  getActiveCourseDraftSessionRecord,
  getActiveCourseDraftSessionRoomOverride,
  getActiveCourseDraftSessionSelectedRoomId,
  isActiveCourseDraftSessionDirty,
  setActiveCourseDraftSessionRecord,
  setActiveCourseDraftSessionRoomOverride,
  setActiveCourseDraftSessionSelectedRoom,
  updateActiveCourseDraftSession,
} from '../courses/draftSession';
import {
  getCurrentCourseDraftPublishDisabledReason,
  getCurrentCourseDraftSaveDisabledReason,
} from '../courses/editor/state';
import {
  getCourseWorkspaceBounds,
  getCourseWorkspacePixelSize,
  getCourseWorkspaceRoomOrigin,
  type CourseWorkspaceBounds,
} from '../courses/editor/workspace';
import { createGoalMarkerFlagSprite } from '../goals/markerFlags';
import {
  cloneRoomSnapshot,
  createRoomRepository,
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomPermissions,
  type RoomRecord,
  type RoomSnapshot,
  type RoomVersionRecord,
} from '../persistence/roomRepository';
import { setAppMode } from '../ui/appMode';
import { hideBusyOverlay, showBusyError, showBusyOverlay } from '../ui/appFeedback';
import { isTextInputFocused } from '../ui/keyboardFocus';
import type { EditorCourseUiState, EditorMarkerPlacementMode } from '../ui/setup/sceneBridge';
import { EditorUiBridge, type EditorInspectorState } from './editor/uiBridge';
import type { EditorStatusDetails } from './editor/roomSession';
import { buildEditorUiViewModel } from './editor/viewModel';
import {
  EditorEditRuntime,
  type EditorClipboardState,
  type GoalPlacementMode,
} from './editor/editRuntime';
import { getCourseGoalSummaryText } from './editor/courseEditing';
import type { CourseComposerSceneData, CourseEditorSceneData, OverworldPlaySceneData } from './sceneData';
import { RETRO_COLORS } from '../visuals/starfield';
import {
  createCourseEditorRoomBackgroundVisuals,
  destroyCourseEditorRoomBackgroundVisuals,
  syncCourseEditorRoomBackgroundVisuals,
  type CourseEditorRoomBackgroundVisuals,
} from './courseEditorBackgrounds';

const MIN_ZOOM = 0.08;
const MAX_ZOOM = 3;
const BUTTON_ZOOM_FACTOR = 1.18;
const FIT_PADDING = 64;
const PAN_THRESHOLD = 5;

type TileDragMode = 'pencil' | 'eraser' | null;
type RectMode = 'rect' | 'copy' | null;
type CourseGoalPlacementMode = EditorMarkerPlacementMode | null;

interface CourseRoomSlice {
  roomId: string;
  coordinates: RoomCoordinates;
  roomTitle: string | null;
  backgroundId: string;
  placedObjects: PlacedObject[];
  permissions: RoomPermissions;
  roomVersionHistory: RoomVersionRecord[];
  publishedVersion: number;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  origin: { x: number; y: number };
  backgroundVisuals: CourseEditorRoomBackgroundVisuals;
  map: Phaser.Tilemaps.Tilemap;
  layers: Map<string, Phaser.Tilemaps.TilemapLayer>;
  border: Phaser.GameObjects.Graphics;
  grid: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  runtime: EditorEditRuntime;
}

export class CourseEditorScene extends Phaser.Scene {
  private readonly roomRepository = createRoomRepository();
  private readonly courseRepository = createCourseRepository();
  private uiBridge: EditorUiBridge | null = null;
  private courseRecord: CourseRecord | null = null;
  private workspaceBounds: CourseWorkspaceBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  private roomSlices = new Map<string, CourseRoomSlice>();
  private courseMarkerSprites: Phaser.GameObjects.Sprite[] = [];
  private courseMarkerLabels: Phaser.GameObjects.Text[] = [];
  private selectionGraphics: Phaser.GameObjects.Graphics | null = null;
  private cursorGraphics: Phaser.GameObjects.Graphics | null = null;
  private rectPreviewGraphics: Phaser.GameObjects.Graphics | null = null;
  private pressurePlateGraphics: Phaser.GameObjects.Graphics | null = null;
  private containerGraphics: Phaser.GameObjects.Graphics | null = null;
  private selectedRoomId: string | null = null;
  private loading = false;
  private statusText: string | null = null;
  private inspectZoom = 0.22;
  private isPanning = false;
  private panStartPointer = { x: 0, y: 0 };
  private panStartScroll = { x: 0, y: 0 };
  private tileDragMode: TileDragMode = null;
  private activeTileDragRoomId: string | null = null;
  private rectMode: RectMode = null;
  private rectStart:
    | {
        roomId: string;
        x: number;
        y: number;
      }
    | null = null;
  private clipboardSourceRoomId: string | null = null;
  private clipboardState: EditorClipboardState | null = null;
  private clipboardPastePreviewActive = false;
  private courseGoalPlacementMode: CourseGoalPlacementMode = null;
  private focusedPressurePlateInstanceId: string | null = null;
  private connectingPressurePlateInstanceId: string | null = null;
  private pressurePlateStatusText: string | null = null;
  private focusedContainerInstanceId: string | null = null;
  private containerStatusText: string | null = null;
  private pinnedInspector: { kind: 'pressure' | 'container'; instanceId: string } | null = null;
  private modifierKeys: {
    SPACE: Phaser.Input.Keyboard.Key | null;
    ALT: Phaser.Input.Keyboard.Key | null;
  } = { SPACE: null, ALT: null };

  private readonly handleWake = (_sys: Phaser.Scenes.Systems, data?: CourseEditorSceneData): void => {
    void this.openFromData(data);
  };

  private readonly handleBackgroundChanged = (): void => {
    const slice = this.getSelectedSlice();
    if (!slice) {
      return;
    }

    if (slice.backgroundId === editorState.selectedBackground) {
      return;
    }

    slice.backgroundId = editorState.selectedBackground;
    slice.runtime.isRoomDirty = true;
    slice.runtime.currentLastDirtyAt = performance.now();
    this.redrawRoomSliceBackground(slice);
    this.statusText = `Updated background for ${this.getSliceLabel(slice)}.`;
    this.renderUi();
  };

  private readonly handleDocumentKeyDown = (event: KeyboardEvent): void => {
    if (!this.scene.isActive(this.scene.key) || editorState.isPlaying || isTextInputFocused()) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === 'escape') {
      event.preventDefault();
      event.stopPropagation();
      if (this.connectingPressurePlateInstanceId) {
        this.cancelPressurePlateConnection();
        return;
      }
      if (this.pinnedInspector) {
        this.clearPinnedInspector();
        return;
      }
      if (this.clipboardPastePreviewActive) {
        this.cancelClipboardPastePreview();
        return;
      }
      if (this.courseGoalPlacementMode) {
        this.courseGoalPlacementMode = null;
        this.renderUi();
        return;
      }
      if (this.rectStart) {
        this.clearRectPreview();
        return;
      }
      void this.returnToCourseBuilder();
      return;
    }

    const primaryModifier = event.metaKey || event.ctrlKey;
    if (primaryModifier && key === 's') {
      event.preventDefault();
      event.stopPropagation();
      void this.saveDraft(true);
      return;
    }

    if (primaryModifier && key === 'v') {
      if (!this.clipboardState || editorState.paletteMode !== 'tiles') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.clipboardPastePreviewActive = true;
      this.statusText = 'Click a course room to paste the copied tiles.';
      this.renderUi();
      return;
    }

    if (primaryModifier && event.shiftKey && key === 'p') {
      event.preventDefault();
      event.stopPropagation();
      void this.publishRoom();
      return;
    }

    if (primaryModifier && key === 'z') {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) {
        this.redoAction();
      } else {
        this.undoAction();
      }
      return;
    }

    if (event.ctrlKey && !event.metaKey && key === 'y') {
      event.preventDefault();
      event.stopPropagation();
      this.redoAction();
      return;
    }

    if (event.code === 'Digit1') {
      event.preventDefault();
      editorState.activeTool = 'pencil';
      this.updateToolUi();
      return;
    }

    if (event.code === 'Digit2') {
      event.preventDefault();
      editorState.activeTool = 'eraser';
      this.updateToolUi();
      return;
    }

    if (event.code === 'Digit3') {
      event.preventDefault();
      editorState.activeTool = 'copy';
      this.updateToolUi();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      void this.startPlayMode();
    }
  };

  private readonly handleResize = (): void => {
    this.fitToScreen();
    this.renderUi();
  };

  private readonly handleCanvasWheel = (event: WheelEvent): void => {
    if (!this.scene.isActive(this.scene.key)) {
      return;
    }

    event.preventDefault();
    const zoomFactor = Phaser.Math.Clamp(Math.exp(-event.deltaY * 0.0018), 0.92, 1.08);
    this.adjustZoomByFactor(zoomFactor, event.clientX, event.clientY);
  };

  constructor() {
    super({ key: 'CourseEditorScene' });
  }

  create(data?: CourseEditorSceneData): void {
    setAppMode('editor');
    this.uiBridge = new EditorUiBridge();
    this.selectionGraphics = this.add.graphics();
    this.selectionGraphics.setDepth(120);
    this.cursorGraphics = this.add.graphics();
    this.cursorGraphics.setDepth(121);
    this.rectPreviewGraphics = this.add.graphics();
    this.rectPreviewGraphics.setDepth(122);
    this.pressurePlateGraphics = this.add.graphics();
    this.pressurePlateGraphics.setDepth(123);
    this.containerGraphics = this.add.graphics();
    this.containerGraphics.setDepth(124);
    this.cameras.main.setRoundPixels(true);
    this.events.on('wake', this.handleWake, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);
    this.scale.on('resize', this.handleResize, this);
    document.addEventListener('keydown', this.handleDocumentKeyDown);
    window.addEventListener('background-changed', this.handleBackgroundChanged);
    this.game.canvas.addEventListener('wheel', this.handleCanvasWheel, { passive: false });
    this.setupPointerControls();
    this.setupKeyboard();
    void this.openFromData(data);
  }

  update(): void {
    this.syncRoomSliceBackgrounds();
    this.updatePressurePlateOverlay();
    this.updateContainerOverlay();
  }

  getCourseEditorState(): EditorCourseUiState {
    const draft = this.getActiveCourseDraft();
    const goal = draft?.goal ?? null;

    return {
      visible: true,
      statusHidden: !this.statusText,
      statusText: this.statusText,
      roomStepText: draft
        ? `${draft.roomRefs.length} room${draft.roomRefs.length === 1 ? '' : 's'} · editing ${this.getSelectedSlice()?.coordinates.x ?? 0},${this.getSelectedSlice()?.coordinates.y ?? 0}`
        : '',
      canReturnToCourseBuilder: true,
      goalTypeValue: goal?.type ?? '',
      goalTypeDisabled: false,
      timeLimitHidden:
        !(goal?.type === 'reach_exit' || goal?.type === 'collect_target' || goal?.type === 'defeat_all' || goal?.type === 'checkpoint_sprint'),
      timeLimitDisabled: false,
      timeLimitValue:
        goal &&
        'timeLimitMs' in goal &&
        goal.timeLimitMs
          ? String(Math.round(goal.timeLimitMs / 1000))
          : '',
      requiredCountHidden: goal?.type !== 'collect_target',
      requiredCountDisabled: false,
      requiredCountValue: goal?.type === 'collect_target' ? String(goal.requiredCount) : '1',
      survivalHidden: goal?.type !== 'survival',
      survivalDisabled: false,
      survivalValue: goal?.type === 'survival' ? String(Math.round(goal.durationMs / 1000)) : '30',
      markerControlsHidden: !(goal?.type === 'reach_exit' || goal?.type === 'checkpoint_sprint'),
      placementHintHidden: this.courseGoalPlacementMode === null,
      placementHintText:
        this.courseGoalPlacementMode === 'start'
          ? 'Click a course room to place the course start.'
          : this.courseGoalPlacementMode === 'exit'
            ? 'Click a course room to place the exit.'
            : this.courseGoalPlacementMode === 'checkpoint'
              ? 'Click a course room to add a checkpoint.'
              : this.courseGoalPlacementMode === 'finish'
                ? 'Click a course room to place the finish.'
                : '',
      summaryText: draft ? getCourseGoalSummaryText(draft) : 'No course selected.',
      placeStartHidden: !(goal?.type === 'reach_exit' || goal?.type === 'checkpoint_sprint'),
      placeStartActive: this.courseGoalPlacementMode === 'start',
      placeExitHidden: goal?.type !== 'reach_exit',
      placeExitActive: this.courseGoalPlacementMode === 'exit',
      addCheckpointHidden: goal?.type !== 'checkpoint_sprint',
      addCheckpointActive: this.courseGoalPlacementMode === 'checkpoint',
      placeFinishHidden: goal?.type !== 'checkpoint_sprint',
      placeFinishActive: this.courseGoalPlacementMode === 'finish',
      canEditPreviousRoom: false,
      canEditNextRoom: false,
    };
  }

  async returnToWorld(): Promise<void> {
    await this.returnToCourseBuilder();
  }

  async returnToCourseBuilder(): Promise<void> {
    this.persistSessionOverridesForDirtySlices();
    const selectedSlice = this.getSelectedSlice();
    const wakeData: CourseComposerSceneData = {
      courseId: this.courseRecord?.draft.id ?? null,
      selectedCoordinates: selectedSlice?.coordinates,
      centerCoordinates: selectedSlice?.coordinates,
      statusMessage: this.statusText ?? null,
    };
    this.scene.stop();
    this.scene.wake('CourseComposerScene', wakeData);
  }

  setRoomTitle(title: string | null): void {
    const slice = this.getSelectedSlice();
    if (!slice || !slice.permissions.canSaveDraft) {
      return;
    }

    const normalized = title?.trim() ? title.trim() : null;
    if (slice.roomTitle === normalized) {
      return;
    }

    slice.roomTitle = normalized;
    slice.runtime.isRoomDirty = true;
    slice.runtime.currentLastDirtyAt = performance.now();
    this.statusText = `Updated title for ${this.getSliceLabel(slice)}.`;
    this.renderUi();
  }

  setGoalType(_nextType: CourseGoalType | null): void {
    // Room goals stay hidden in course edit mode.
  }

  setGoalTimeLimitSeconds(_seconds: number | null): void {
    // Room goals stay hidden in course edit mode.
  }

  setGoalRequiredCount(_requiredCount: number): void {
    // Room goals stay hidden in course edit mode.
  }

  setGoalSurvivalSeconds(_seconds: number): void {
    // Room goals stay hidden in course edit mode.
  }

  setCourseGoalType(goalType: CourseGoalType | null): void {
    const draft = this.getActiveCourseDraft();
    if (!draft) {
      return;
    }

    const nextDraft = cloneCourseSnapshot(draft);
    nextDraft.goal = goalType ? createDefaultCourseGoal(goalType) : null;
    if (!goalType) {
      nextDraft.startPoint = null;
    }
    this.courseGoalPlacementMode = null;
    this.setActiveCourseDraft(nextDraft);
  }

  setCourseGoalTimeLimitSeconds(seconds: number | null): void {
    const draft = this.getActiveCourseDraft();
    if (!draft?.goal || draft.goal.type === 'survival' || !('timeLimitMs' in draft.goal)) {
      return;
    }

    const nextDraft = cloneCourseSnapshot(draft);
    if (nextDraft.goal && 'timeLimitMs' in nextDraft.goal) {
      nextDraft.goal.timeLimitMs = seconds === null ? null : Math.max(1, seconds) * 1000;
      this.setActiveCourseDraft(nextDraft);
    }
  }

  setCourseGoalRequiredCount(requiredCount: number): void {
    const draft = this.getActiveCourseDraft();
    if (draft?.goal?.type !== 'collect_target') {
      return;
    }

    const nextDraft = cloneCourseSnapshot(draft);
    if (nextDraft.goal?.type === 'collect_target') {
      nextDraft.goal.requiredCount = Math.max(1, requiredCount);
      this.setActiveCourseDraft(nextDraft);
    }
  }

  setCourseGoalSurvivalSeconds(seconds: number): void {
    const draft = this.getActiveCourseDraft();
    if (draft?.goal?.type !== 'survival') {
      return;
    }

    const nextDraft = cloneCourseSnapshot(draft);
    if (nextDraft.goal?.type === 'survival') {
      nextDraft.goal.durationMs = Math.max(1, seconds) * 1000;
      this.setActiveCourseDraft(nextDraft);
    }
  }

  startGoalMarkerPlacement(_mode: EditorMarkerPlacementMode): void {
    // Room goals stay hidden in course edit mode.
  }

  clearGoalMarkers(): void {
    // Room goals stay hidden in course edit mode.
  }

  startCourseGoalMarkerPlacement(mode: EditorMarkerPlacementMode): void {
    const draft = this.getActiveCourseDraft();
    if (!draft?.goal) {
      return;
    }

    this.courseGoalPlacementMode = this.courseGoalPlacementMode === mode ? null : mode;
    this.renderUi();
  }

  clearCourseGoalMarkers(): void {
    const draft = this.getActiveCourseDraft();
    if (!draft) {
      return;
    }

    const nextDraft = cloneCourseSnapshot(draft);
    nextDraft.startPoint = null;
    if (nextDraft.goal?.type === 'reach_exit') {
      nextDraft.goal.exit = null;
    } else if (nextDraft.goal?.type === 'checkpoint_sprint') {
      nextDraft.goal.checkpoints = [];
      nextDraft.goal.finish = null;
    }
    this.courseGoalPlacementMode = null;
    this.setActiveCourseDraft(nextDraft);
  }

  fitToScreen(): void {
    const size = getCourseWorkspacePixelSize(this.workspaceBounds);
    const fitZoom = Phaser.Math.Clamp(
      Math.min(
        (this.scale.width - FIT_PADDING) / Math.max(ROOM_PX_WIDTH, size.width),
        (this.scale.height - FIT_PADDING) / Math.max(ROOM_PX_HEIGHT, size.height),
      ),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    this.inspectZoom = Number(fitZoom.toFixed(3));
    this.cameras.main.setZoom(this.inspectZoom);
    this.centerCameraOnWorkspace();
    this.renderUi();
  }

  zoomIn(): void {
    this.adjustButtonZoom(BUTTON_ZOOM_FACTOR);
  }

  zoomOut(): void {
    this.adjustButtonZoom(1 / BUTTON_ZOOM_FACTOR);
  }

  updateToolUi(): void {
    if (this.clipboardPastePreviewActive && editorState.activeTool !== 'copy') {
      this.cancelClipboardPastePreview();
    }

    if (editorState.activeTool !== 'rect' && editorState.activeTool !== 'copy') {
      this.clearRectPreview();
    }

    this.renderUi();
  }

  async saveDraft(_force?: boolean): Promise<RoomRecord | null> {
    const dirtySlices = this.getDirtySlices();
    if (dirtySlices.length === 0) {
      this.statusText = 'No room draft changes to save.';
      this.renderUi();
      return null;
    }

    showBusyOverlay('Saving course rooms...', `Saving ${dirtySlices.length} room draft${dirtySlices.length === 1 ? '' : 's'}...`);
    let lastRecord: RoomRecord | null = null;
    try {
      for (const slice of dirtySlices) {
        const record = await this.roomRepository.saveDraft(slice.runtime.exportRoomSnapshot());
        this.applyStoredRoomRecordToSlice(slice, record, { keepDirty: false, keepOverride: true });
        lastRecord = record;
      }
      this.statusText = `Saved ${dirtySlices.length} room draft${dirtySlices.length === 1 ? '' : 's'}.`;
      this.renderUi();
      return lastRecord;
    } catch (error) {
      this.statusText = error instanceof Error ? error.message : 'Failed to save course room drafts.';
      this.renderUi();
      return null;
    } finally {
      hideBusyOverlay();
    }
  }

  async publishRoom(): Promise<RoomRecord | null> {
    const targetSlices = this.getChangedSlicesForPublish();
    if (targetSlices.length === 0) {
      this.statusText = 'No changed rooms to publish.';
      this.renderUi();
      return null;
    }

    showBusyOverlay('Publishing course rooms...', `Publishing ${targetSlices.length} room${targetSlices.length === 1 ? '' : 's'}...`);
    let lastRecord: RoomRecord | null = null;
    try {
      for (const slice of targetSlices) {
        const record = await this.roomRepository.publish(slice.runtime.exportRoomSnapshot());
        this.applyStoredRoomRecordToSlice(slice, record, { keepDirty: false, keepOverride: false });
        lastRecord = record;
      }
      this.statusText = `Published ${targetSlices.length} room${targetSlices.length === 1 ? '' : 's'}.`;
      this.renderUi();
      return lastRecord;
    } catch (error) {
      this.statusText = error instanceof Error ? error.message : 'Failed to publish changed course rooms.';
      this.renderUi();
      return null;
    } finally {
      hideBusyOverlay();
    }
  }

  async saveCourseDraft(): Promise<void> {
    if (!this.courseRecord) {
      return;
    }

    const disabledReason = this.getCourseSaveDisabledReason();
    if (disabledReason) {
      this.statusText = disabledReason;
      this.renderUi();
      return;
    }

    showBusyOverlay('Saving course...', 'Saving course goal and setup...');
    try {
      const saved = await this.courseRepository.saveDraft(this.courseRecord.draft);
      setActiveCourseDraftSessionRecord(saved, { selectedRoomId: this.selectedRoomId });
      this.courseRecord = getActiveCourseDraftSessionRecord();
      this.statusText = 'Course changes saved.';
      this.redrawCourseMarkers();
      this.renderUi();
    } catch (error) {
      this.statusText = error instanceof Error ? error.message : 'Failed to save course changes.';
      this.renderUi();
    } finally {
      hideBusyOverlay();
    }
  }

  async publishCourseDraft(): Promise<void> {
    if (!this.courseRecord) {
      return;
    }

    const disabledReason = this.getCoursePublishDisabledReason();
    if (disabledReason) {
      this.statusText = disabledReason;
      this.renderUi();
      return;
    }

    showBusyOverlay('Publishing course...', 'Saving course goal and publishing the course...');
    try {
      const saved = await this.courseRepository.saveDraft(this.courseRecord.draft);
      setActiveCourseDraftSessionRecord(saved, { selectedRoomId: this.selectedRoomId });
      this.courseRecord = getActiveCourseDraftSessionRecord();
      const published = await this.courseRepository.publishCourse(this.courseRecord?.draft.id ?? saved.draft.id);
      setActiveCourseDraftSessionRecord(published, { selectedRoomId: this.selectedRoomId });
      this.courseRecord = getActiveCourseDraftSessionRecord();
      this.statusText = 'Course published.';
      this.redrawCourseMarkers();
      this.renderUi();
    } catch (error) {
      this.statusText = error instanceof Error ? error.message : 'Failed to publish course.';
      this.renderUi();
    } finally {
      hideBusyOverlay();
    }
  }

  async startPlayMode(): Promise<void> {
    const draft = this.getActiveCourseDraft();
    if (!draft || draft.roomRefs.length === 0) {
      this.statusText = 'Add course rooms before testing.';
      this.renderUi();
      return;
    }

    this.persistSessionOverridesForDirtySlices();
    const startRoom =
      (draft.startPoint
        ? draft.roomRefs.find((roomRef) => roomRef.roomId === draft.startPoint?.roomId) ?? null
        : draft.roomRefs[0] ?? null);
    if (!startRoom) {
      this.statusText = 'Course draft has no playable rooms.';
      this.renderUi();
      return;
    }

    const selectedSlice = this.getSelectedSlice();
    const wakeData: OverworldPlaySceneData = {
      centerCoordinates: { ...startRoom.coordinates },
      roomCoordinates: { ...startRoom.coordinates },
      mode: 'play',
      statusMessage: 'Testing draft course.',
      courseDraftPreviewId: draft.id,
      courseEditorReturnTarget: {
        courseId: draft.id,
        selectedCoordinates: { ...(selectedSlice?.coordinates ?? startRoom.coordinates) },
        centerCoordinates: { ...(selectedSlice?.coordinates ?? startRoom.coordinates) },
      },
    };

    this.scene.sleep();
    this.scene.wake('OverworldPlayScene', wakeData);
  }

  undoAction(): void {
    const slice = this.getSelectedSlice();
    if (!slice) {
      return;
    }

    slice.runtime.undo();
    this.renderUi();
  }

  redoAction(): void {
    const slice = this.getSelectedSlice();
    if (!slice) {
      return;
    }

    slice.runtime.redo();
    this.renderUi();
  }

  describeState(): Record<string, unknown> {
    return {
      scene: 'course-editor',
      courseId: this.courseRecord?.draft.id ?? null,
      roomCount: this.courseRecord?.draft.roomRefs.length ?? 0,
      selectedRoomId: this.selectedRoomId,
      zoom: this.cameras.main.zoom,
      dirtyRoomCount: this.getDirtySlices().length,
      courseGoalPlacementMode: this.courseGoalPlacementMode,
    };
  }

  private async openFromData(data?: CourseEditorSceneData): Promise<void> {
    setAppMode('editor');
    this.loading = true;
    this.statusText = data?.statusMessage ?? 'Loading course editor...';
    this.renderUi();

    try {
      const record = await this.resolveCourseRecord(data?.courseId ?? null);
      this.courseRecord = record;
      this.rebuildWorkspace(record);

      const nextSelectedRoomId =
        data?.selectedRoomId ??
        (data?.selectedCoordinates ? roomIdFromCoordinates(data.selectedCoordinates) : null) ??
        getActiveCourseDraftSessionSelectedRoomId() ??
        record.draft.roomRefs[0]?.roomId ??
        null;
      this.selectRoomById(nextSelectedRoomId);
      if (data?.statusMessage) {
        this.statusText = data.statusMessage;
      } else {
        this.statusText = `Editing ${record.draft.title?.trim() || 'course'} across ${record.draft.roomRefs.length} room${record.draft.roomRefs.length === 1 ? '' : 's'}.`;
      }
      this.fitToScreen();
      this.redrawCourseMarkers();
      this.redrawSelection();
    } catch (error) {
      console.error('Failed to open course editor', error);
      this.statusText = error instanceof Error ? error.message : 'Failed to open the course editor.';
    } finally {
      this.loading = false;
      this.renderUi();
    }
  }

  private async resolveCourseRecord(courseId: string | null): Promise<CourseRecord> {
    const session = getActiveCourseDraftSessionRecord();
    if (session && (!courseId || session.draft.id === courseId)) {
      return session;
    }

    if (!courseId) {
      throw new Error('No active course to edit.');
    }

    const record = await this.courseRepository.loadCourse(courseId);
    setActiveCourseDraftSessionRecord(record);
    return record;
  }

  private rebuildWorkspace(record: CourseRecord): void {
    this.destroyWorkspace();
    this.workspaceBounds = getCourseWorkspaceBounds(record.draft.roomRefs);
    for (const roomRef of record.draft.roomRefs) {
      this.createRoomSlice(roomRef);
    }
    this.syncCameraBounds();
  }

  private destroyWorkspace(): void {
    this.clearCourseMarkers();
    for (const slice of this.roomSlices.values()) {
      destroyCourseEditorRoomBackgroundVisuals(slice.backgroundVisuals);
      slice.runtime.reset();
      slice.map.destroy();
      slice.border.destroy();
      slice.grid.destroy();
      slice.label.destroy();
    }
    this.roomSlices.clear();
    this.selectionGraphics?.clear();
    this.cursorGraphics?.clear();
    this.pressurePlateGraphics?.clear();
    this.containerGraphics?.clear();
    this.clearTransientObjectInspectorState();
    this.renderInspectorUi();
    this.clearRectPreview();
  }

  private createRoomSlice(roomRef: CourseRoomRef): void {
    const origin = getCourseWorkspaceRoomOrigin(roomRef.coordinates, this.workspaceBounds);
    const map = this.make.tilemap({
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      width: ROOM_WIDTH,
      height: ROOM_HEIGHT,
    });

    const tilesets = TILESETS.map((tileset) =>
      map.addTilesetImage(tileset.key, tileset.key, TILE_SIZE, TILE_SIZE, 0, 0, tileset.firstGid)
    ).filter((tileset): tileset is Phaser.Tilemaps.Tileset => Boolean(tileset));

    const layers = new Map<string, Phaser.Tilemaps.TilemapLayer>();
    for (const layerName of LAYER_NAMES) {
      const layer = map.createBlankLayer(layerName, tilesets, origin.x, origin.y);
      if (!layer) {
        continue;
      }
      if (layerName === 'foreground') {
        layer.setDepth(50);
      } else if (layerName === 'terrain') {
        layer.setDepth(10);
      } else {
        layer.setDepth(1);
      }
      layers.set(layerName, layer);
    }

    const border = this.add.graphics();
    border.lineStyle(2, RETRO_COLORS.published, 0.75);
    border.strokeRect(origin.x, origin.y, ROOM_PX_WIDTH, ROOM_PX_HEIGHT);
    border.setDepth(90);

    const grid = this.add.graphics();
    grid.lineStyle(1, RETRO_COLORS.grid, 0.12);
    for (let x = 0; x <= ROOM_WIDTH; x += 1) {
      grid.moveTo(origin.x + x * TILE_SIZE, origin.y);
      grid.lineTo(origin.x + x * TILE_SIZE, origin.y + ROOM_PX_HEIGHT);
    }
    for (let y = 0; y <= ROOM_HEIGHT; y += 1) {
      grid.moveTo(origin.x, origin.y + y * TILE_SIZE);
      grid.lineTo(origin.x + ROOM_PX_WIDTH, origin.y + y * TILE_SIZE);
    }
    grid.strokePath();
    grid.setDepth(95);

    const label = this.add.text(origin.x + 10, origin.y + 10, roomRef.roomTitle?.trim() || `${roomRef.coordinates.x},${roomRef.coordinates.y}`, {
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: '12px',
      color: '#f6f1de',
      backgroundColor: '#121109cc',
      padding: { x: 6, y: 3 },
    });
    label.setDepth(96);

    const slice: CourseRoomSlice = {
      roomId: roomRef.roomId,
      coordinates: { ...roomRef.coordinates },
      roomTitle: roomRef.roomTitle,
      backgroundId: 'none',
      placedObjects: [],
      permissions: {
        canSaveDraft: true,
        canPublish: true,
        canRevert: false,
        canMint: false,
      },
      roomVersionHistory: [],
      publishedVersion: 0,
      currentVersion: roomRef.roomVersion,
      createdAt: '',
      updatedAt: '',
      publishedAt: null,
      origin,
      backgroundVisuals: createCourseEditorRoomBackgroundVisuals(this, origin, 'none'),
      map,
      layers,
      border,
      grid,
      label,
      runtime: new EditorEditRuntime(this, {
        getLayers: () => slice.layers,
        getRoomSnapshotMetadata: () => ({
          roomId: slice.roomId,
          coordinates: slice.coordinates,
          title: slice.roomTitle,
          version: slice.currentVersion,
          createdAt: slice.createdAt,
          updatedAt: slice.updatedAt,
          publishedAt: slice.publishedAt,
        }),
        getRoomOrigin: () => slice.origin,
        getSelectedBackground: () => slice.backgroundId,
        setSelectedBackground: (backgroundId) => {
          slice.backgroundId = backgroundId;
        },
        getPlacedObjects: () => slice.placedObjects,
        setPlacedObjects: (placedObjects) => {
          slice.placedObjects = placedObjects.map((placed) => ({ ...placed }));
        },
        updateBackgroundSelectValue: (backgroundId) => {
          if (this.selectedRoomId !== slice.roomId) {
            return;
          }
          const select = document.getElementById('background-select') as HTMLSelectElement | null;
          if (select) {
            select.value = backgroundId;
          }
        },
        updateBackground: () => {
          this.redrawRoomSliceBackground(slice);
          this.renderUi();
        },
        updateGoalUi: () => {
          this.renderUi();
        },
        syncBackgroundCameraIgnores: () => {
          // Multi-room editor does not use separate background cameras yet.
        },
        updatePersistenceStatus: (text) => {
          this.statusText = text;
          this.renderUi();
        },
        canSaveDraft: () => slice.permissions.canSaveDraft,
      }),
    };

    this.roomSlices.set(slice.roomId, slice);
    void this.loadRoomSliceState(slice);
  }

  private async loadRoomSliceState(slice: CourseRoomSlice): Promise<void> {
    const record = await this.roomRepository.loadRoom(slice.roomId, slice.coordinates);
    const override = getActiveCourseDraftSessionRoomOverride(slice.roomId);
    const snapshot = override ?? record.draft ?? record.published ?? null;
    if (!snapshot) {
      return;
    }

    this.applyStoredRoomRecordToSlice(slice, record, {
      keepDirty: Boolean(override),
      keepOverride: Boolean(override),
    });
    slice.runtime.applyRoomSnapshot(cloneRoomSnapshot(snapshot));
    if (override) {
      slice.runtime.isRoomDirty = true;
    }
    this.renderUi();
  }

  private applyStoredRoomRecordToSlice(
    slice: CourseRoomSlice,
    record: RoomRecord,
    options: { keepDirty: boolean; keepOverride: boolean },
  ): void {
    const snapshot = record.draft ?? record.published ?? null;
    if (!snapshot) {
      return;
    }

    slice.permissions = record.permissions;
    slice.roomVersionHistory = record.versions;
    slice.publishedVersion = record.published?.version ?? 0;
    slice.currentVersion = snapshot.version;
    slice.roomTitle = snapshot.title ?? null;
    slice.createdAt = snapshot.createdAt;
    slice.updatedAt = snapshot.updatedAt;
    slice.publishedAt = snapshot.publishedAt;
    slice.backgroundId = snapshot.background;
    slice.placedObjects = snapshot.placedObjects.map((placed) => ({ ...placed }));
    slice.label.setText(slice.roomTitle?.trim() || `${slice.coordinates.x},${slice.coordinates.y}`);
    slice.runtime.applyRoomSnapshot(cloneRoomSnapshot(snapshot));
    slice.runtime.isRoomDirty = options.keepDirty;
    if (options.keepOverride) {
      setActiveCourseDraftSessionRoomOverride(slice.runtime.exportRoomSnapshot());
    } else {
      clearActiveCourseDraftSessionRoomOverride(slice.roomId);
    }

    updateActiveCourseDraftSession((draft) => {
      const roomRef = draft.roomRefs.find((entry) => entry.roomId === slice.roomId);
      if (!roomRef) {
        return;
      }
      roomRef.roomTitle = slice.roomTitle;
      if (!options.keepOverride) {
        roomRef.roomVersion = record.published?.version ?? roomRef.roomVersion;
      }
    });
    this.redrawCourseMarkers();
  }

  private getActiveCourseDraft(): CourseSnapshot | null {
    const courseId = this.courseRecord?.draft.id ?? null;
    if (!courseId || getActiveCourseDraftSessionCourseId() !== courseId) {
      return null;
    }
    return getActiveCourseDraftSessionDraft();
  }

  private setActiveCourseDraft(nextDraft: CourseSnapshot): void {
    const courseId = this.courseRecord?.draft.id ?? null;
    if (!courseId || getActiveCourseDraftSessionCourseId() !== courseId) {
      return;
    }

    const normalized = cloneCourseSnapshot(nextDraft);
    updateActiveCourseDraftSession((draft) => {
      draft.title = normalized.title;
      draft.roomRefs = normalized.roomRefs;
      draft.startPoint = normalized.startPoint;
      draft.goal = normalized.goal;
    });
    this.courseRecord = getActiveCourseDraftSessionRecord();
    this.redrawCourseMarkers();
    this.renderUi();
  }

  private getDirtySlices(): CourseRoomSlice[] {
    return Array.from(this.roomSlices.values()).filter((slice) => slice.runtime.isRoomDirty);
  }

  private getCourseSaveDisabledReason(): string | null {
    if (!this.courseRecord) {
      return 'No course loaded.';
    }

    return this.courseRecord.permissions.canSaveDraft
      ? getCurrentCourseDraftSaveDisabledReason(this.courseRecord, isActiveCourseDraftSessionDirty())
      : 'This course is read-only for your account.';
  }

  private getCoursePublishDisabledReason(): string | null {
    if (!this.courseRecord) {
      return 'No course loaded.';
    }

    return this.courseRecord.permissions.canPublish
      ? getCurrentCourseDraftPublishDisabledReason(this.courseRecord)
      : 'This course is read-only for your account.';
  }

  private getChangedSlicesForPublish(): CourseRoomSlice[] {
    return Array.from(this.roomSlices.values()).filter(
      (slice) =>
        slice.runtime.isRoomDirty ||
        getActiveCourseDraftSessionRoomOverride(slice.roomId) !== null
    );
  }

  private persistSessionOverridesForDirtySlices(): void {
    for (const slice of this.roomSlices.values()) {
      if (!slice.runtime.isRoomDirty) {
        continue;
      }
      setActiveCourseDraftSessionRoomOverride(slice.runtime.exportRoomSnapshot());
    }
  }

  private getSelectedSlice(): CourseRoomSlice | null {
    return this.selectedRoomId ? this.roomSlices.get(this.selectedRoomId) ?? null : null;
  }

  private selectRoomById(roomId: string | null): void {
    const fallback = this.courseRecord?.draft.roomRefs[0]?.roomId ?? null;
    const nextRoomId = roomId && this.roomSlices.has(roomId) ? roomId : fallback;
    const roomChanged = nextRoomId !== this.selectedRoomId;
    this.selectedRoomId = nextRoomId;
    if (roomChanged) {
      this.clearTransientObjectInspectorState();
    }
    setActiveCourseDraftSessionSelectedRoom(nextRoomId);
    const slice = this.getSelectedSlice();
    if (slice) {
      editorState.selectedBackground = slice.backgroundId;
      const select = document.getElementById('background-select') as HTMLSelectElement | null;
      if (select) {
        select.value = slice.backgroundId;
      }
    }
    this.redrawSelection();
    this.renderUi();
  }

  private redrawSelection(): void {
    this.selectionGraphics?.clear();
    const slice = this.getSelectedSlice();
    if (!slice || !this.selectionGraphics) {
      return;
    }

    this.selectionGraphics.lineStyle(3, 0x7de5ff, 0.95);
    this.selectionGraphics.strokeRect(
      slice.origin.x + 2,
      slice.origin.y + 2,
      ROOM_PX_WIDTH - 4,
      ROOM_PX_HEIGHT - 4,
    );
  }

  private redrawRoomSliceBackground(slice: CourseRoomSlice): void {
    destroyCourseEditorRoomBackgroundVisuals(slice.backgroundVisuals);
    slice.backgroundVisuals = createCourseEditorRoomBackgroundVisuals(this, slice.origin, slice.backgroundId);
    syncCourseEditorRoomBackgroundVisuals(slice.backgroundVisuals, this.cameras.main);
  }

  private syncRoomSliceBackgrounds(): void {
    const camera = this.cameras.main;
    for (const slice of this.roomSlices.values()) {
      syncCourseEditorRoomBackgroundVisuals(slice.backgroundVisuals, camera);
    }
  }

  private clearCourseMarkers(): void {
    for (const sprite of this.courseMarkerSprites) {
      sprite.destroy();
    }
    this.courseMarkerSprites = [];
    for (const label of this.courseMarkerLabels) {
      label.destroy();
    }
    this.courseMarkerLabels = [];
  }

  private redrawCourseMarkers(): void {
    this.clearCourseMarkers();
    const draft = this.getActiveCourseDraft();
    const goal = draft?.goal ?? null;
    if (!draft || !goal) {
      return;
    }

    const addMarker = (
      point: CourseMarkerPoint,
      labelText: string | null,
      finish: boolean,
    ): void => {
      const slice = this.roomSlices.get(point.roomId);
      if (!slice) {
        return;
      }
      const sprite = createGoalMarkerFlagSprite(
        this,
        finish ? 'finish-pending' : 'checkpoint-pending',
        slice.origin.x + point.x,
        slice.origin.y + point.y + 2,
        130,
      );
      this.courseMarkerSprites.push(sprite);

      if (!labelText) {
        return;
      }

      const label = this.add.text(slice.origin.x + point.x, slice.origin.y + point.y - 28, labelText, {
        fontFamily: 'Courier New',
        fontSize: '12px',
        color: '#ffefef',
        stroke: '#050505',
        strokeThickness: 4,
      });
      label.setOrigin(0.5, 1);
      label.setDepth(131);
      this.courseMarkerLabels.push(label);
    };

    if (draft.startPoint) {
      addMarker(draft.startPoint, 'START', false);
    }

    if (goal.type === 'reach_exit' && goal.exit) {
      addMarker(goal.exit, 'EXIT', true);
    }

    if (goal.type === 'checkpoint_sprint') {
      goal.checkpoints.forEach((checkpoint, index) => {
        addMarker(checkpoint, `${index + 1}`, false);
      });
      if (goal.finish) {
        addMarker(goal.finish, 'FINISH', true);
      }
    }
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

      this.handlePrimaryPointerDown(pointer);
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.isPanning) {
        const distance = Phaser.Math.Distance.Between(
          this.panStartPointer.x,
          this.panStartPointer.y,
          pointer.x,
          pointer.y,
        );
        if (distance >= PAN_THRESHOLD) {
          const dx = (this.panStartPointer.x - pointer.x) / this.cameras.main.zoom;
          const dy = (this.panStartPointer.y - pointer.y) / this.cameras.main.zoom;
          this.cameras.main.setScroll(this.panStartScroll.x + dx, this.panStartScroll.y + dy);
          this.constrainCamera();
        }
        return;
      }

      this.updateCursorHighlight(pointer);
      this.handlePointerDrag(pointer);
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (this.isPanning) {
        this.isPanning = false;
        return;
      }

      this.finishPointerAction(pointer);
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
      this.fitToScreen();
    });
  }

  private handlePrimaryPointerDown(pointer: Phaser.Input.Pointer): void {
    const slice = this.getSliceForPointer(pointer);
    if (!slice) {
      return;
    }

    const selectedSlice = this.getSelectedSlice();
    if (
      this.connectingPressurePlateInstanceId &&
      selectedSlice &&
      selectedSlice.roomId !== slice.roomId
    ) {
      this.pressurePlateStatusText = 'Pick a door, metal door, cage, or chest in the same room.';
      this.renderUi();
      return;
    }

    this.selectRoomById(slice.roomId);
    const localTile = this.getLocalTileForPointer(pointer, slice);
    if (!localTile) {
      return;
    }

    if (this.courseGoalPlacementMode) {
      this.placeCourseGoalMarker(slice, localTile.tileX, localTile.tileY);
      return;
    }

    if (editorState.paletteMode === 'objects') {
      if (this.connectingPressurePlateInstanceId) {
        this.handlePressurePlateConnectionClick(slice, pointer.worldX, pointer.worldY);
        this.renderUi();
        return;
      }

      const clickedPressurePlate = slice.runtime.findPlacedObjectAt(
        pointer.worldX,
        pointer.worldY,
        (placed) => canPlacedObjectTriggerOtherObjects(placed)
      );
      if (clickedPressurePlate) {
        this.focusedPressurePlateInstanceId = clickedPressurePlate.instanceId ?? null;
        this.focusedContainerInstanceId = null;
        this.pinInspector('pressure', clickedPressurePlate.instanceId ?? '');
        this.pressurePlateStatusText = null;
        this.renderUi();
        return;
      }

      if (this.handleContainerContentsClick(slice, pointer.worldX, pointer.worldY)) {
        return;
      }

      if (this.pinnedInspector) {
        const hasSelectedObject = Boolean(editorState.selectedObjectId);
        this.clearPinnedInspector();
        if (!hasSelectedObject) {
          return;
        }
      }

      if (editorState.activeTool === 'eraser') {
        this.removeObjectAt(slice, pointer.worldX, pointer.worldY);
      } else {
        this.handleObjectPlace(slice, pointer, localTile.tileX, localTile.tileY);
      }
      this.renderUi();
      return;
    }

    if (this.clipboardPastePreviewActive) {
      this.pasteClipboardIntoSlice(slice, localTile.tileX, localTile.tileY);
      return;
    }

    switch (editorState.activeTool) {
      case 'pencil':
        slice.runtime.beginTileBatch();
        slice.runtime.placeTileAt(pointer.worldX, pointer.worldY);
        this.tileDragMode = 'pencil';
        this.activeTileDragRoomId = slice.roomId;
        break;
      case 'eraser':
        slice.runtime.beginTileBatch();
        slice.runtime.eraseTileAt(pointer.worldX, pointer.worldY);
        this.tileDragMode = 'eraser';
        this.activeTileDragRoomId = slice.roomId;
        break;
      case 'fill':
        slice.runtime.beginTileBatch();
        slice.runtime.floodFill(localTile.tileX, localTile.tileY);
        slice.runtime.commitTileBatch();
        this.renderUi();
        break;
      case 'rect':
      case 'copy':
        this.rectMode = editorState.activeTool;
        this.rectStart = { roomId: slice.roomId, x: localTile.tileX, y: localTile.tileY };
        this.drawRectPreview(slice, this.rectStart.x, this.rectStart.y, localTile.tileX, localTile.tileY);
        break;
      default:
        break;
    }
  }

  private handleObjectPlace(
    slice: CourseRoomSlice,
    pointer: Phaser.Input.Pointer,
    tileX: number,
    tileY: number,
  ): void {
    const placed = slice.runtime.handleObjectPlace(pointer.worldX, pointer.worldY, tileX, tileY);
    if (placed && canPlacedObjectTriggerOtherObjects(placed)) {
      this.focusedContainerInstanceId = null;
      this.focusedPressurePlateInstanceId = placed.instanceId ?? null;
      this.pinInspector('pressure', placed.instanceId ?? '');
      this.beginPressurePlateConnection(placed.instanceId ?? '', true);
      return;
    }

    if (placed && canPlacedObjectBeContainer(placed)) {
      this.focusedContainerInstanceId = placed.instanceId ?? null;
      this.focusedPressurePlateInstanceId = null;
      this.pinInspector('container', placed.instanceId ?? '');
      this.containerStatusText = `${this.getContainerName(placed.id)} placed. Select a ${this.getContainerAcceptedContentsLabel(placed.id)} and click it to fill the container.`;
    }
  }

  private removeObjectAt(slice: CourseRoomSlice, worldX: number, worldY: number): void {
    const removed = slice.runtime.removeObjectAt(worldX, worldY);
    if (!removed) {
      return;
    }

    if (removed.instanceId === this.connectingPressurePlateInstanceId) {
      this.connectingPressurePlateInstanceId = null;
    }
    if (removed.instanceId === this.focusedPressurePlateInstanceId) {
      this.focusedPressurePlateInstanceId = null;
    }
    if (removed.instanceId === this.focusedContainerInstanceId) {
      this.focusedContainerInstanceId = null;
    }
    if (this.pinnedInspector?.instanceId === removed.instanceId) {
      this.pinnedInspector = null;
    }
    if (canPlacedObjectBePressurePlateTarget(removed)) {
      this.pressurePlateStatusText = `${this.getPressurePlateTargetLabel(removed.id)} removed. Linked plates were cleared.`;
    }
    if (canPlacedObjectBeContainer(removed)) {
      this.containerStatusText = `${this.getContainerName(removed.id)} removed.`;
    }
  }

  private handlePointerDrag(pointer: Phaser.Input.Pointer): void {
    if (!pointer.leftButtonDown()) {
      return;
    }

    const slice = this.getSliceForPointer(pointer);
    if (!slice) {
      return;
    }

    const localTile = this.getLocalTileForPointer(pointer, slice);
    if (!localTile) {
      return;
    }

    if (this.tileDragMode) {
      if (this.activeTileDragRoomId !== slice.roomId) {
        const previous = this.activeTileDragRoomId
          ? this.roomSlices.get(this.activeTileDragRoomId) ?? null
          : null;
        previous?.runtime.commitTileBatch();
        slice.runtime.beginTileBatch();
        this.activeTileDragRoomId = slice.roomId;
      }

      if (this.tileDragMode === 'pencil') {
        slice.runtime.placeTileAt(pointer.worldX, pointer.worldY);
      } else {
        slice.runtime.eraseTileAt(pointer.worldX, pointer.worldY);
      }
      return;
    }

    if (this.rectStart) {
      const startSlice = this.roomSlices.get(this.rectStart.roomId) ?? null;
      if (!startSlice) {
        return;
      }

      const previewTile = startSlice.roomId === slice.roomId
        ? localTile
        : this.getClosestTileInSlice(startSlice, pointer.worldX, pointer.worldY);
      this.drawRectPreview(startSlice, this.rectStart.x, this.rectStart.y, previewTile.tileX, previewTile.tileY);
    }
  }

  private finishPointerAction(pointer: Phaser.Input.Pointer): void {
    const activeSlice = this.activeTileDragRoomId
      ? this.roomSlices.get(this.activeTileDragRoomId) ?? null
      : null;
    if (activeSlice && this.tileDragMode) {
      activeSlice.runtime.commitTileBatch();
      this.tileDragMode = null;
      this.activeTileDragRoomId = null;
      this.renderUi();
      return;
    }

    if (!this.rectStart || !this.rectMode) {
      return;
    }

    const startSlice = this.roomSlices.get(this.rectStart.roomId) ?? null;
    if (!startSlice) {
      this.clearRectPreview();
      return;
    }

    const pointerSlice = this.getSliceForPointer(pointer);
    const endTile = pointerSlice && pointerSlice.roomId === startSlice.roomId
      ? this.getLocalTileForPointer(pointer, startSlice)
      : this.getClosestTileInSlice(startSlice, pointer.worldX, pointer.worldY);
    if (!endTile) {
      this.clearRectPreview();
      return;
    }

    if (this.rectMode === 'rect') {
      startSlice.runtime.beginTileBatch();
      startSlice.runtime.fillRect(this.rectStart.x, this.rectStart.y, endTile.tileX, endTile.tileY);
      startSlice.runtime.commitTileBatch();
      this.statusText =
        pointerSlice && pointerSlice.roomId !== startSlice.roomId
          ? 'Rectangle fill stayed within the starting room.'
          : 'Filled room area.';
    } else {
      const copied = startSlice.runtime.copyTilesToClipboard(
        this.rectStart.x,
        this.rectStart.y,
        endTile.tileX,
        endTile.tileY,
      );
      if (copied) {
        this.clipboardState = startSlice.runtime.currentClipboardState;
        this.clipboardSourceRoomId = startSlice.roomId;
        this.clipboardPastePreviewActive = true;
        this.statusText = 'Copied tile region. Click any course room to paste.';
      } else {
        this.statusText = 'No tiles in that selection to copy.';
      }
    }

    this.clearRectPreview();
    this.renderUi();
  }

  private getSliceForPointer(pointer: Phaser.Input.Pointer): CourseRoomSlice | null {
    return this.getSliceAtWorldPoint(pointer.worldX, pointer.worldY);
  }

  private getSliceAtWorldPoint(worldX: number, worldY: number): CourseRoomSlice | null {
    for (const slice of this.roomSlices.values()) {
      if (
        worldX >= slice.origin.x &&
        worldX < slice.origin.x + ROOM_PX_WIDTH &&
        worldY >= slice.origin.y &&
        worldY < slice.origin.y + ROOM_PX_HEIGHT
      ) {
        return slice;
      }
    }

    return null;
  }

  private getLocalTileForPointer(
    pointer: Phaser.Input.Pointer,
    slice: CourseRoomSlice,
  ): { tileX: number; tileY: number } | null {
    const localX = pointer.worldX - slice.origin.x;
    const localY = pointer.worldY - slice.origin.y;
    const tileX = Math.floor(localX / TILE_SIZE);
    const tileY = Math.floor(localY / TILE_SIZE);
    if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) {
      return null;
    }

    return { tileX, tileY };
  }

  private getClosestTileInSlice(
    slice: CourseRoomSlice,
    worldX: number,
    worldY: number,
  ): { tileX: number; tileY: number } {
    const localX = Phaser.Math.Clamp(worldX - slice.origin.x, 0, ROOM_PX_WIDTH - 1);
    const localY = Phaser.Math.Clamp(worldY - slice.origin.y, 0, ROOM_PX_HEIGHT - 1);
    return {
      tileX: Math.floor(localX / TILE_SIZE),
      tileY: Math.floor(localY / TILE_SIZE),
    };
  }

  private placeCourseGoalMarker(slice: CourseRoomSlice, tileX: number, tileY: number): void {
    const draft = this.getActiveCourseDraft();
    const goal = draft?.goal ?? null;
    if (!draft || !goal || !this.courseGoalPlacementMode) {
      return;
    }

    const point: CourseMarkerPoint = {
      roomId: slice.roomId,
      x: tileX * TILE_SIZE + TILE_SIZE * 0.5,
      y: tileY * TILE_SIZE + TILE_SIZE,
    };
    const nextDraft = cloneCourseSnapshot(draft);

    if (this.courseGoalPlacementMode === 'start') {
      nextDraft.startPoint = point;
      this.courseGoalPlacementMode = null;
      this.setActiveCourseDraft(nextDraft);
      return;
    }

    if (goal.type === 'reach_exit' && nextDraft.goal?.type === 'reach_exit' && this.courseGoalPlacementMode === 'exit') {
      nextDraft.goal.exit = point;
      this.courseGoalPlacementMode = null;
      this.setActiveCourseDraft(nextDraft);
      return;
    }

    if (goal.type !== 'checkpoint_sprint' || nextDraft.goal?.type !== 'checkpoint_sprint') {
      return;
    }

    if (this.courseGoalPlacementMode === 'checkpoint') {
      nextDraft.goal.checkpoints = [...nextDraft.goal.checkpoints, point];
      this.courseGoalPlacementMode = null;
      this.setActiveCourseDraft(nextDraft);
      return;
    }

    if (this.courseGoalPlacementMode === 'finish') {
      nextDraft.goal.finish = point;
      this.courseGoalPlacementMode = null;
      this.setActiveCourseDraft(nextDraft);
    }
  }

  private pasteClipboardIntoSlice(slice: CourseRoomSlice, tileX: number, tileY: number): void {
    if (!this.clipboardState) {
      this.statusText = 'Nothing to paste yet.';
      this.renderUi();
      return;
    }

    slice.runtime.setClipboardState(this.clipboardState);
    slice.runtime.beginTileBatch();
    const pasted = slice.runtime.pasteClipboardAt(tileX, tileY);
    slice.runtime.commitTileBatch();
    this.statusText = pasted
      ? this.clipboardSourceRoomId === slice.roomId
        ? 'Pasted tile region.'
        : `Pasted tile region into ${this.getSliceLabel(slice)}.`
      : 'Nothing to paste at that position.';
    this.renderUi();
  }

  private cancelClipboardPastePreview(): void {
    this.clipboardPastePreviewActive = false;
    this.clipboardSourceRoomId = null;
    this.clearRectPreview();
    this.statusText = 'Paste preview canceled.';
    this.renderUi();
  }

  beginFocusedPressurePlateConnection(): void {
    const focused = this.getFocusedPressurePlate();
    if (!focused) {
      this.pressurePlateStatusText = 'Hover or place a pressure plate first.';
      this.renderInspectorUi();
      return;
    }

    this.beginPressurePlateConnection(focused.instanceId ?? '', false);
  }

  clearFocusedPressurePlateConnection(): void {
    const slice = this.getSelectedSlice();
    const focused = this.getFocusedPressurePlate();
    if (!slice || !focused || !canPlacedObjectTriggerOtherObjects(focused)) {
      return;
    }

    if (slice.runtime.setPressurePlateTarget(focused.instanceId ?? '', null)) {
      this.pressurePlateStatusText = 'Pressure plate link cleared.';
      this.connectingPressurePlateInstanceId = null;
      this.focusedPressurePlateInstanceId = focused.instanceId ?? null;
      this.pinInspector('pressure', focused.instanceId ?? '');
      this.renderInspectorUi();
    }
  }

  cancelPressurePlateConnection(): void {
    if (!this.connectingPressurePlateInstanceId) {
      return;
    }

    this.connectingPressurePlateInstanceId = null;
    this.pressurePlateStatusText = 'Pressure plate left unlinked for now.';
    if (this.focusedPressurePlateInstanceId) {
      this.pinInspector('pressure', this.focusedPressurePlateInstanceId);
    }
    this.renderInspectorUi();
  }

  clearFocusedContainerContents(): void {
    const slice = this.getSelectedSlice();
    const focused = this.getFocusedContainer();
    if (!slice || !focused || !canPlacedObjectBeContainer(focused)) {
      return;
    }

    if (slice.runtime.setContainerContents(focused.instanceId ?? '', null)) {
      this.focusedContainerInstanceId = focused.instanceId ?? null;
      this.pinInspector('container', focused.instanceId ?? '');
      this.containerStatusText = `${this.getContainerName(focused.id)} is now empty.`;
      this.renderInspectorUi();
    }
  }

  private createEmptyInspectorState(): EditorInspectorState {
    return {
      visible: false,
      pressureVisible: false,
      pressureStatusText: '',
      pressureConnectHidden: true,
      pressureConnectDisabled: true,
      pressureConnectTitle: '',
      pressureClearHidden: true,
      pressureClearDisabled: true,
      pressureDoneLaterHidden: true,
      containerVisible: false,
      containerStatusText: '',
      containerClearDisabled: true,
      containerClearTitle: '',
    };
  }

  private clearTransientObjectInspectorState(): void {
    this.focusedPressurePlateInstanceId = null;
    this.connectingPressurePlateInstanceId = null;
    this.pressurePlateStatusText = null;
    this.focusedContainerInstanceId = null;
    this.containerStatusText = null;
    this.pinnedInspector = null;
  }

  private pinInspector(kind: 'pressure' | 'container', instanceId: string): void {
    this.pinnedInspector = { kind, instanceId };
  }

  private clearPinnedInspector(): void {
    this.clearTransientObjectInspectorState();
    this.renderInspectorUi();
  }

  private getFocusedPressurePlate(): PlacedObject | null {
    const slice = this.getSelectedSlice();
    if (!slice) {
      return null;
    }

    const pinnedPressureId = this.pinnedInspector?.kind === 'pressure'
      ? this.pinnedInspector.instanceId
      : null;
    const activeId =
      this.connectingPressurePlateInstanceId ?? pinnedPressureId ?? this.focusedPressurePlateInstanceId;
    const focused = slice.runtime.getPlacedObjectByInstanceId(activeId);
    if (focused && canPlacedObjectTriggerOtherObjects(focused)) {
      return focused;
    }

    return null;
  }

  private getFocusedContainer(): PlacedObject | null {
    const slice = this.getSelectedSlice();
    if (!slice) {
      return null;
    }

    const pinnedContainerId = this.pinnedInspector?.kind === 'container'
      ? this.pinnedInspector.instanceId
      : null;
    const focused = slice.runtime.getPlacedObjectByInstanceId(
      pinnedContainerId ?? this.focusedContainerInstanceId
    );
    if (focused && canPlacedObjectBeContainer(focused)) {
      return focused;
    }

    return null;
  }

  private getConnectingPressurePlate(): PlacedObject | null {
    const slice = this.getSelectedSlice();
    if (!slice) {
      return null;
    }

    const focused = slice.runtime.getPlacedObjectByInstanceId(this.connectingPressurePlateInstanceId);
    if (focused && canPlacedObjectTriggerOtherObjects(focused)) {
      return focused;
    }

    return null;
  }

  private beginPressurePlateConnection(triggerInstanceId: string, autoPlaced: boolean): void {
    const slice = this.getSelectedSlice();
    if (!slice) {
      return;
    }

    const trigger = slice.runtime.getPlacedObjectByInstanceId(triggerInstanceId);
    if (!trigger || !canPlacedObjectTriggerOtherObjects(trigger)) {
      return;
    }

    this.focusedPressurePlateInstanceId = trigger.instanceId ?? null;
    this.connectingPressurePlateInstanceId = trigger.instanceId ?? null;
    this.pinInspector('pressure', trigger.instanceId ?? '');
    const eligibleTargets = slice.runtime.getPressurePlateEligibleTargets(trigger.instanceId);
    this.pressurePlateStatusText =
      eligibleTargets.length > 0
        ? autoPlaced
          ? 'Pressure plate placed. Click a door, metal door, cage, or chest to link it.'
          : 'Click a door, metal door, cage, or chest to link this pressure plate.'
        : 'No door, metal door, cage, or chest is in this room yet. You can link this pressure plate later.';
    this.renderInspectorUi();
  }

  private handlePressurePlateConnectionClick(
    slice: CourseRoomSlice,
    worldX: number,
    worldY: number,
  ): boolean {
    const source = this.getConnectingPressurePlate();
    if (!source || this.getSelectedSlice()?.roomId !== slice.roomId) {
      this.connectingPressurePlateInstanceId = null;
      return false;
    }

    const target = slice.runtime.findPlacedObjectAt(
      worldX,
      worldY,
      (placed) => canPlacedObjectBePressurePlateTarget(placed) && placed.instanceId !== source.instanceId
    );
    if (!target) {
      this.pressurePlateStatusText = 'Pick a door, metal door, cage, or chest in this room.';
      this.renderInspectorUi();
      return true;
    }

    if (slice.runtime.setPressurePlateTarget(source.instanceId ?? '', target.instanceId ?? null)) {
      this.connectingPressurePlateInstanceId = null;
      this.focusedPressurePlateInstanceId = source.instanceId ?? null;
      this.pinInspector('pressure', source.instanceId ?? '');
      this.pressurePlateStatusText = `Pressure plate linked to ${this.getPressurePlateTargetLabel(target.id)}.`;
      this.renderInspectorUi();
    }
    return true;
  }

  private handleContainerContentsClick(
    slice: CourseRoomSlice,
    worldX: number,
    worldY: number,
  ): boolean {
    const focused = slice.runtime.findPlacedObjectAt(
      worldX,
      worldY,
      (placed) => canPlacedObjectBeContainer(placed)
    );
    if (!focused || !focused.instanceId) {
      return false;
    }

    this.focusedContainerInstanceId = focused.instanceId;
    this.focusedPressurePlateInstanceId = null;
    this.pinInspector('container', focused.instanceId);
    const selectedObject = editorState.selectedObjectId
      ? getObjectById(editorState.selectedObjectId)
      : null;
    if (!selectedObject) {
      this.renderInspectorUi();
      return true;
    }

    const selectedLooksLikeContents =
      selectedObject.category === 'enemy' || selectedObject.category === 'collectible';
    if (!selectedLooksLikeContents) {
      this.renderInspectorUi();
      return true;
    }

    if (!canObjectBeStoredInContainer(focused.id, selectedObject)) {
      this.containerStatusText = `${this.getContainerName(focused.id)} can only hold ${this.getContainerAcceptedContentsLabel(focused.id)}.`;
      this.renderInspectorUi();
      return true;
    }

    if (slice.runtime.setContainerContents(focused.instanceId, selectedObject.id)) {
      this.containerStatusText = `${this.getContainerName(focused.id)} now holds ${selectedObject.name}.`;
      this.renderInspectorUi();
      return true;
    }

    return true;
  }

  private updatePressurePlateOverlay(): void {
    this.pressurePlateGraphics?.clear();
    if (!this.pressurePlateGraphics || editorState.isPlaying) {
      this.renderPressurePlatePanel();
      return;
    }

    const slice = this.getSelectedSlice();
    if (!slice) {
      this.renderPressurePlatePanel();
      return;
    }

    if (
      this.focusedPressurePlateInstanceId &&
      !slice.runtime.hasPlacedObjectInstanceId(this.focusedPressurePlateInstanceId)
    ) {
      this.focusedPressurePlateInstanceId = null;
    }
    if (
      this.connectingPressurePlateInstanceId &&
      !slice.runtime.hasPlacedObjectInstanceId(this.connectingPressurePlateInstanceId)
    ) {
      this.connectingPressurePlateInstanceId = null;
    }
    if (
      this.pinnedInspector?.kind === 'pressure' &&
      !slice.runtime.hasPlacedObjectInstanceId(this.pinnedInspector.instanceId)
    ) {
      this.pinnedInspector = null;
    }

    const pointer = this.input.activePointer;
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    if (!this.connectingPressurePlateInstanceId) {
      const hoveredTrigger = slice.runtime.findPlacedObjectAt(
        worldPoint.x,
        worldPoint.y,
        (placed) => canPlacedObjectTriggerOtherObjects(placed)
      );
      if (hoveredTrigger) {
        if (this.focusedPressurePlateInstanceId !== hoveredTrigger.instanceId) {
          this.pressurePlateStatusText = null;
        }
        this.focusedPressurePlateInstanceId = hoveredTrigger.instanceId ?? null;
      } else if (this.pinnedInspector?.kind !== 'pressure') {
        this.focusedPressurePlateInstanceId = null;
      }
    }

    const source = this.getFocusedPressurePlate();
    if (!source) {
      this.renderPressurePlatePanel();
      return;
    }

    const currentTarget = slice.runtime.getPlacedObjectByInstanceId(source.triggerTargetInstanceId ?? null);
    if (currentTarget) {
      this.drawPressurePlateLink(source, currentTarget, 0x6dd5ff, 0.9);
    }

    const sourceBounds = slice.runtime.getPlacedObjectBounds(source);
    this.pressurePlateGraphics.lineStyle(2, 0xc3f4ff, 0.88);
    this.pressurePlateGraphics.strokeRoundedRect(
      sourceBounds.x,
      sourceBounds.y,
      sourceBounds.width,
      sourceBounds.height,
      6
    );

    if (this.connectingPressurePlateInstanceId === source.instanceId) {
      const hoveredTarget = slice.runtime.findPlacedObjectAt(
        worldPoint.x,
        worldPoint.y,
        (placed) => canPlacedObjectBePressurePlateTarget(placed) && placed.instanceId !== source.instanceId
      );
      const eligibleTargets = slice.runtime.getPressurePlateEligibleTargets(source.instanceId);
      for (const target of eligibleTargets) {
        const bounds = slice.runtime.getPlacedObjectBounds(target);
        this.pressurePlateGraphics.lineStyle(
          2,
          hoveredTarget?.instanceId === target.instanceId ? 0x9dff8a : 0x7ad3ff,
          hoveredTarget?.instanceId === target.instanceId ? 0.95 : 0.55
        );
        this.pressurePlateGraphics.strokeRoundedRect(
          bounds.x,
          bounds.y,
          bounds.width,
          bounds.height,
          6
        );
      }

      if (hoveredTarget) {
        this.drawPressurePlateLink(source, hoveredTarget, 0x9dff8a, 0.95);
      } else {
        this.pressurePlateGraphics.lineStyle(2, 0xffd36b, 0.5);
        this.pressurePlateGraphics.beginPath();
        this.pressurePlateGraphics.moveTo(
          slice.origin.x + source.x,
          slice.origin.y + source.y - 4
        );
        this.pressurePlateGraphics.lineTo(worldPoint.x, worldPoint.y);
        this.pressurePlateGraphics.strokePath();
      }
    }

    this.renderPressurePlatePanel();
  }

  private drawPressurePlateLink(
    source: PlacedObject,
    target: PlacedObject,
    color: number,
    alpha: number,
  ): void {
    const slice = this.getSelectedSlice();
    if (!this.pressurePlateGraphics || !slice) {
      return;
    }

    this.pressurePlateGraphics.lineStyle(2, color, alpha);
    this.pressurePlateGraphics.beginPath();
    this.pressurePlateGraphics.moveTo(slice.origin.x + source.x, slice.origin.y + source.y - 4);
    this.pressurePlateGraphics.lineTo(slice.origin.x + target.x, slice.origin.y + target.y - 6);
    this.pressurePlateGraphics.strokePath();
    this.pressurePlateGraphics.fillStyle(color, alpha * 0.9);
    this.pressurePlateGraphics.fillCircle(slice.origin.x + source.x, slice.origin.y + source.y - 4, 3);
    this.pressurePlateGraphics.fillCircle(slice.origin.x + target.x, slice.origin.y + target.y - 6, 3);
  }

  private renderPressurePlatePanel(): void {
    this.renderInspectorUi();
  }

  private updateContainerOverlay(): void {
    this.containerGraphics?.clear();
    if (
      !this.containerGraphics ||
      editorState.isPlaying ||
      this.connectingPressurePlateInstanceId
    ) {
      this.renderContainerContentsPanel();
      return;
    }

    const slice = this.getSelectedSlice();
    if (!slice) {
      this.renderContainerContentsPanel();
      return;
    }

    if (
      this.focusedContainerInstanceId &&
      !slice.runtime.hasPlacedObjectInstanceId(this.focusedContainerInstanceId)
    ) {
      this.focusedContainerInstanceId = null;
    }
    if (
      this.pinnedInspector?.kind === 'container' &&
      !slice.runtime.hasPlacedObjectInstanceId(this.pinnedInspector.instanceId)
    ) {
      this.pinnedInspector = null;
    }

    const pointer = this.input.activePointer;
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const hoveredContainer = slice.runtime.findPlacedObjectAt(
      worldPoint.x,
      worldPoint.y,
      (placed) => canPlacedObjectBeContainer(placed)
    );
    if (hoveredContainer) {
      if (this.focusedContainerInstanceId !== hoveredContainer.instanceId) {
        this.containerStatusText = null;
      }
      this.focusedContainerInstanceId = hoveredContainer.instanceId ?? null;
    } else if (this.pinnedInspector?.kind !== 'container') {
      this.focusedContainerInstanceId = null;
    }

    const focused = this.getFocusedContainer();
    if (!focused) {
      this.renderContainerContentsPanel();
      return;
    }

    const bounds = slice.runtime.getPlacedObjectBounds(focused);
    const selectedObject = editorState.selectedObjectId
      ? getObjectById(editorState.selectedObjectId)
      : null;
    const canStoreSelected = canObjectBeStoredInContainer(focused.id, selectedObject);
    const selectedLooksLikeContents =
      selectedObject?.category === 'enemy' || selectedObject?.category === 'collectible';
    const strokeColor = canStoreSelected
      ? 0x9dff8a
      : selectedLooksLikeContents
        ? 0xffc76b
        : 0xffe0a6;
    const strokeAlpha = canStoreSelected ? 0.92 : 0.74;
    this.containerGraphics.lineStyle(2, strokeColor, strokeAlpha);
    this.containerGraphics.strokeRoundedRect(bounds.x, bounds.y, bounds.width, bounds.height, 6);
    this.containerGraphics.fillStyle(strokeColor, 0.86);
    this.containerGraphics.fillCircle(
      slice.origin.x + focused.x,
      slice.origin.y + focused.y - 6,
      3
    );

    this.renderContainerContentsPanel();
  }

  private renderContainerContentsPanel(): void {
    this.renderInspectorUi();
  }

  private renderInspectorUi(): void {
    const hiddenState = this.createEmptyInspectorState();
    const slice = this.getSelectedSlice();
    if (!slice || editorState.isPlaying) {
      this.uiBridge?.renderInspector(hiddenState);
      return;
    }

    const connectMode = this.connectingPressurePlateInstanceId !== null;
    const source =
      this.pinnedInspector?.kind === 'container' && !connectMode
        ? null
        : this.getFocusedPressurePlate();
    if (source && (editorState.paletteMode === 'objects' || connectMode)) {
      const target = slice.runtime.getPlacedObjectByInstanceId(source.triggerTargetInstanceId ?? null);
      const eligibleTargetCount = slice.runtime.getPressurePlateEligibleTargets(source.instanceId).length;
      const state: EditorInspectorState = {
        ...hiddenState,
        visible: true,
        pressureVisible: true,
        pressureStatusText:
          this.pressurePlateStatusText ??
          (connectMode
            ? eligibleTargetCount > 0
              ? 'Click a door, metal door, cage, or chest to link this pressure plate.'
              : 'No door, metal door, cage, or chest is in this room yet.'
            : target
              ? `Linked to ${this.getPressurePlateTargetLabel(target.id)}.`
              : 'This pressure plate is not linked yet.'),
        pressureConnectHidden: connectMode,
        pressureConnectDisabled: connectMode || eligibleTargetCount === 0,
        pressureConnectTitle: eligibleTargetCount === 0 ? 'Add a door, metal door, cage, or chest first.' : '',
        pressureClearHidden: connectMode,
        pressureClearDisabled: !target,
        pressureDoneLaterHidden: !connectMode,
        containerVisible: false,
        containerStatusText: '',
        containerClearDisabled: true,
        containerClearTitle: '',
      };
      this.uiBridge?.renderInspector(state);
      return;
    }

    const focusedContainer =
      this.pinnedInspector?.kind === 'pressure' && !connectMode
        ? null
        : this.getFocusedContainer();
    if (
      focusedContainer &&
      editorState.paletteMode === 'objects' &&
      !this.connectingPressurePlateInstanceId
    ) {
      const selectedObject = editorState.selectedObjectId
        ? getObjectById(editorState.selectedObjectId)
        : null;
      const selectedLooksLikeContents =
        selectedObject?.category === 'enemy' || selectedObject?.category === 'collectible';
      const canStoreSelected = canObjectBeStoredInContainer(focusedContainer.id, selectedObject);
      const currentContentsLabel = slice.runtime.getContainerContentsLabel(focusedContainer);
      const state: EditorInspectorState = {
        ...hiddenState,
        visible: true,
        containerVisible: true,
        containerStatusText:
          this.containerStatusText ??
          (canStoreSelected && selectedObject
            ? `Click this ${this.getContainerLabel(focusedContainer.id)} to stash ${selectedObject.name} inside.`
            : selectedLooksLikeContents && selectedObject
              ? `${this.getContainerName(focusedContainer.id)} can only hold ${this.getContainerAcceptedContentsLabel(focusedContainer.id)}.`
              : currentContentsLabel
                ? `${this.getContainerName(focusedContainer.id)} currently holds ${currentContentsLabel}. Select a ${this.getContainerAcceptedContentsLabel(focusedContainer.id)} and click it to change the contents.`
                : `${this.getContainerName(focusedContainer.id)} is empty. Select a ${this.getContainerAcceptedContentsLabel(focusedContainer.id)} from the object list, then click it to fill the container.`),
        containerClearDisabled: !focusedContainer.containedObjectId,
        containerClearTitle: focusedContainer.containedObjectId ? '' : 'This container is empty.',
        pressureVisible: false,
        pressureStatusText: '',
        pressureConnectHidden: true,
        pressureConnectDisabled: true,
        pressureConnectTitle: '',
        pressureClearHidden: true,
        pressureClearDisabled: true,
        pressureDoneLaterHidden: true,
      };
      this.uiBridge?.renderInspector(state);
      return;
    }

    this.uiBridge?.renderInspector(hiddenState);
  }

  private getPressurePlateTargetLabel(objectId: string): string {
    switch (objectId) {
      case 'door_locked':
        return 'door';
      case 'door_metal':
        return 'metal door';
      case 'treasure_chest':
        return 'treasure chest';
      case 'cage':
        return 'cage';
      default:
        return getObjectById(objectId)?.name ?? 'object';
    }
  }

  private getContainerLabel(objectId: string): string {
    return objectId === 'cage' ? 'cage' : 'treasure chest';
  }

  private getContainerName(objectId: string): string {
    return objectId === 'cage' ? 'This cage' : 'This treasure chest';
  }

  private getContainerAcceptedContentsLabel(objectId: string): string {
    return objectId === 'cage' ? 'enemies' : 'collectibles';
  }

  private drawRectPreview(
    slice: CourseRoomSlice,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): void {
    this.rectPreviewGraphics?.clear();
    if (!this.rectPreviewGraphics) {
      return;
    }

    const minX = Math.min(x1, x2);
    const minY = Math.min(y1, y2);
    const width = Math.abs(x2 - x1) + 1;
    const height = Math.abs(y2 - y1) + 1;
    this.rectPreviewGraphics.lineStyle(2, 0xffd36a, 0.92);
    this.rectPreviewGraphics.fillStyle(0xffd36a, 0.12);
    this.rectPreviewGraphics.fillRect(
      slice.origin.x + minX * TILE_SIZE,
      slice.origin.y + minY * TILE_SIZE,
      width * TILE_SIZE,
      height * TILE_SIZE,
    );
    this.rectPreviewGraphics.strokeRect(
      slice.origin.x + minX * TILE_SIZE,
      slice.origin.y + minY * TILE_SIZE,
      width * TILE_SIZE,
      height * TILE_SIZE,
    );
  }

  private clearRectPreview(): void {
    this.rectPreviewGraphics?.clear();
    this.rectStart = null;
    this.rectMode = null;
  }

  private updateCursorHighlight(pointer: Phaser.Input.Pointer): void {
    this.cursorGraphics?.clear();
    if (!this.cursorGraphics) {
      return;
    }

    const slice = this.getSliceForPointer(pointer);
    if (!slice) {
      return;
    }

    const tile = this.getLocalTileForPointer(pointer, slice);
    if (!tile) {
      return;
    }

    const color = this.courseGoalPlacementMode ? RETRO_COLORS.frontier : 0x7de5ff;
    this.cursorGraphics.lineStyle(2, color, 0.88);
    this.cursorGraphics.fillStyle(color, 0.12);
    this.cursorGraphics.fillRect(
      slice.origin.x + tile.tileX * TILE_SIZE,
      slice.origin.y + tile.tileY * TILE_SIZE,
      TILE_SIZE,
      TILE_SIZE,
    );
    this.cursorGraphics.strokeRect(
      slice.origin.x + tile.tileX * TILE_SIZE,
      slice.origin.y + tile.tileY * TILE_SIZE,
      TILE_SIZE,
      TILE_SIZE,
    );
  }

  private pointerRequestsPan(pointer: Phaser.Input.Pointer): boolean {
    return (
      pointer.rightButtonDown() ||
      Boolean(this.modifierKeys.SPACE?.isDown) ||
      Boolean(this.modifierKeys.ALT?.isDown)
    );
  }

  private syncCameraBounds(): void {
    const size = getCourseWorkspacePixelSize(this.workspaceBounds);
    const margin = TILE_SIZE * 4;
    this.cameras.main.setBounds(
      -margin,
      -margin,
      size.width + margin * 2,
      size.height + margin * 2,
    );
  }

  private centerCameraOnWorkspace(): void {
    const size = getCourseWorkspacePixelSize(this.workspaceBounds);
    this.cameras.main.centerOn(size.width * 0.5, size.height * 0.5);
    this.constrainCamera();
  }

  private constrainCamera(): void {
    const camera = this.cameras.main;
    const bounds = camera.getBounds();
    if (!bounds) {
      return;
    }
    const maxScrollX = bounds.x + bounds.width - camera.width / camera.zoom;
    const maxScrollY = bounds.y + bounds.height - camera.height / camera.zoom;
    camera.scrollX = Phaser.Math.Clamp(camera.scrollX, bounds.x, Math.max(bounds.x, maxScrollX));
    camera.scrollY = Phaser.Math.Clamp(camera.scrollY, bounds.y, Math.max(bounds.y, maxScrollY));
  }

  private adjustButtonZoom(factor: number): void {
    this.adjustZoomByFactor(factor, this.scale.width * 0.5, this.scale.height * 0.5);
  }

  private adjustZoomByFactor(factor: number, screenX: number, screenY: number): void {
    const camera = this.cameras.main;
    const anchor = camera.getWorldPoint(screenX, screenY);
    this.inspectZoom = Phaser.Math.Clamp(Number((camera.zoom * factor).toFixed(3)), MIN_ZOOM, MAX_ZOOM);
    camera.setZoom(this.inspectZoom);
    camera.scrollX = anchor.x - screenX / camera.zoom;
    camera.scrollY = anchor.y - screenY / camera.zoom;
    this.constrainCamera();
    this.renderUi();
  }

  private renderUi(): void {
    const selectedSlice = this.getSelectedSlice();
    const draft = this.getActiveCourseDraft();
    const dirtySlices = this.getDirtySlices();
    const selectedPermissions = selectedSlice?.permissions ?? {
      canSaveDraft: false,
      canPublish: false,
      canRevert: false,
      canMint: false,
    };
    const saveStatus: EditorStatusDetails = {
      text:
        this.loading
          ? 'Loading course...'
          : this.statusText ??
            (dirtySlices.length > 0
              ? `${dirtySlices.length} room draft${dirtySlices.length === 1 ? '' : 's'} changed.`
              : 'Course rooms are ready.'),
      accentText: '',
      linkLabel: '',
      linkHref: null,
    };

    this.uiBridge?.render(
      buildEditorUiViewModel({
        roomTitle: selectedSlice?.roomTitle ?? '',
        roomCoordinates: selectedSlice?.coordinates ?? { x: 0, y: 0 },
        roomGoal: null,
        roomPlacementMode: null as GoalPlacementMode,
        goalUsesMarkers: false,
        goalSummaryText: 'Room goals are hidden while editing the whole course.',
        roomPermissions: selectedPermissions,
        mintedTokenId: null,
        canRefreshMintMetadata: false,
        saveInFlight: this.loading,
        mintedMetadataCurrent: true,
        roomVersionHistory: selectedSlice?.roomVersionHistory ?? [],
        entrySource: 'world',
        zoomText: `Zoom: ${this.cameras.main.zoom.toFixed(2)}x`,
        saveStatus,
        publishNudgeVisible: false,
        publishNudgeText: '',
        publishNudgeActionText: '',
        courseEditorState: this.getCourseEditorState(),
      }),
    );

    this.syncEditorChrome(draft, dirtySlices.length);
  }

  private syncEditorChrome(draft: CourseSnapshot | null, dirtyRoomCount: number): void {
    const courseSaveDisabledReason = this.getCourseSaveDisabledReason();
    const coursePublishDisabledReason = this.getCoursePublishDisabledReason();
    const courseDirty = isActiveCourseDraftSessionDirty();

    document.getElementById('goal-section')?.classList.add('hidden');
    document.getElementById('course-goal-section')?.classList.remove('hidden');
    document.getElementById('room-title-section')?.classList.remove('hidden');
    document.getElementById('btn-mint-room')?.classList.add('hidden');
    document.getElementById('btn-refresh-room-metadata')?.classList.add('hidden');
    document.getElementById('btn-room-history')?.classList.add('hidden');
    document.getElementById('editor-advanced')?.classList.add('hidden');

    const saveLabel = document.querySelector('#btn-save-draft .tool-label');
    if (saveLabel) {
      saveLabel.textContent = 'Save Rooms';
    }
    const backLabel = document.querySelector('#btn-editor-back .tool-label');
    if (backLabel) {
      backLabel.textContent = 'Setup';
    }
    const publishLabel = document.querySelector('#btn-publish-room .tool-label');
    if (publishLabel) {
      publishLabel.textContent = 'Publish Rooms';
    }
    const playLabel = document.querySelector('#btn-test-play .tool-label');
    if (playLabel) {
      playLabel.textContent = 'Test';
    }

    const backButton = document.getElementById('btn-editor-back');
    if (backButton) {
      backButton.setAttribute('title', 'Return to Course Setup (Esc)');
    }
    const publishButton = document.getElementById('btn-publish-room');
    if (publishButton) {
      publishButton.setAttribute(
        'title',
        'Publish changed room drafts only. Course goal and course publish actions live in the Course Goal section.'
      );
    }

    const courseSaveButton = document.getElementById('btn-course-editor-save-course') as HTMLButtonElement | null;
    if (courseSaveButton) {
      courseSaveButton.disabled = Boolean(courseSaveDisabledReason);
      courseSaveButton.title = courseSaveDisabledReason ?? 'Save the course goal, markers, and room membership.';
    }

    const coursePublishButton = document.getElementById('btn-course-editor-publish-course') as HTMLButtonElement | null;
    if (coursePublishButton) {
      coursePublishButton.disabled = Boolean(coursePublishDisabledReason);
      coursePublishButton.title =
        coursePublishDisabledReason ??
        'Publish the course goal and room membership. Room changes still publish separately.';
    }

    const topStatus = document.getElementById('editor-top-save-status');
    if (topStatus) {
      topStatus.textContent = draft
        ? `${dirtyRoomCount} changed room${dirtyRoomCount === 1 ? '' : 's'} · ${courseDirty ? 'course draft dirty' : 'course saved'} · room edits and course edits publish separately`
        : 'No course loaded.';
    }
  }

  private getSliceLabel(slice: CourseRoomSlice): string {
    return slice.roomTitle?.trim() || `Room ${slice.coordinates.x},${slice.coordinates.y}`;
  }

  private handleShutdown = (): void => {
    document.removeEventListener('keydown', this.handleDocumentKeyDown);
    window.removeEventListener('background-changed', this.handleBackgroundChanged);
    this.events.off('wake', this.handleWake, this);
    this.scale.off('resize', this.handleResize, this);
    this.game.canvas.removeEventListener('wheel', this.handleCanvasWheel);
    this.selectionGraphics?.destroy();
    this.selectionGraphics = null;
    this.cursorGraphics?.destroy();
    this.cursorGraphics = null;
    this.rectPreviewGraphics?.destroy();
    this.rectPreviewGraphics = null;
    this.pressurePlateGraphics?.destroy();
    this.pressurePlateGraphics = null;
    this.containerGraphics?.destroy();
    this.containerGraphics = null;
    this.uiBridge?.destroy();
    this.uiBridge = null;
    this.destroyWorkspace();
  };
}
