import Phaser from 'phaser';
import { getAuthDebugState, promptForSignIn, refreshAuthSession } from '../auth/client';
import { globalRoomMusicController } from '../music/controller';
import {
  cloneRoomMusic,
  type RoomMusic,
  type RoomMusicKeyMode,
  type RoomMusicKeyTonic,
  type RoomPatternInstrumentId,
  type RoomPatternPitchMode,
} from '../music/model';
import {
  canPlacedObjectUseObjectLink,
  getObjectById,
  LAYER_NAMES,
  placedObjectContributesToCategory,
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_WIDTH,
  TILESETS,
  TILE_SIZE,
  editorState,
  type PlacedObject,
} from '../config';
import { createExpandedRoomEditorRepository } from '../expandedRooms/editorRepository';
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
  getBackgroundSelectionValue,
  getSolidColorFromBackgroundValue,
} from '../backgrounds/model';
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
  formatExpandedRoomCellCount,
  getExpandedRoomCellUsageText,
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
import type { RoomGoalType } from '../goals/roomGoals';
import {
  cloneRoomSnapshot,
  createLocalRoomRepository,
  isRoomApiError,
  createRoomRepository,
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomPermissions,
  type RoomRecord,
  type RoomVersionRecord,
} from '../persistence/roomRepository';
import { clearLocalRoomStorageEntry } from '../persistence/browserStorage';
import { setAppMode } from '../ui/appMode';
import { getAppFeedbackDebugState, hideBusyOverlay, showBusyError, showBusyOverlay } from '../ui/appFeedback';
import { isNativeTextEditingFocused, isTextInputFocused } from '../ui/keyboardFocus';
import { requestSignTextEdit } from '../signs/events';
import { canPlacedObjectHaveSignText, getPlacedObjectSignText } from '../signs/model';
import type { EditorCourseUiState, EditorMarkerPlacementMode } from '../ui/setup/sceneBridge';
import { EditorUiBridge } from './editor/uiBridge';
import type { EditorStatusDetails } from './editor/roomSession';
import { buildEditorUiViewModel } from './editor/viewModel';
import {
  EditorEditRuntime,
  type EditorClipboardState,
  type GoalPlacementMode,
} from './editor/editRuntime';
import { EditorMusicPatternController } from './editor/musicPatternEditor';
import {
  type EditorMusicComposerMode,
} from './editor/musicUi';
import {
  EditorMusicWorkflowCoordinator,
  type EditorMusicPhraseSaveOptions,
} from './editor/musicWorkflow';
import { getCourseGoalSummaryText } from './editor/courseEditing';
import type { CourseComposerSceneData, CourseEditorSceneData, OverworldPlaySceneData } from './sceneData';
import { constrainInspectCamera, getScrollForScreenAnchor, getScreenAnchorWorldPoint } from './overworld/camera';
import { RETRO_COLORS } from '../visuals/starfield';
import { cloneRoomLightingSettings, type RoomLightingSettings } from '../lighting/model';
import { cloneRoomWeatherSettings, type RoomWeatherSettings } from '../weather/model';
import {
  createCourseEditorRoomBackgroundVisuals,
  destroyCourseEditorRoomBackgroundVisuals,
  syncCourseEditorRoomBackgroundVisuals,
  type CourseEditorRoomBackgroundVisuals,
} from './courseEditorBackgrounds';
import {
  createEmptyCourseInspectorState,
} from './courseEditor/inspectorUi';
import { CourseEditorObjectInspectorController } from './courseEditor/objectInspector';
import { selectCustomSpriteTileForCourseRoom } from './courseEditor/customSpriteTiles';
import type { CustomSpriteDefinition } from '../customSprites/model';
import { roomSnapshotUsesCustomSprite } from '../customSprites/usage';

const DAILY_ROOM_CLAIM_LIMIT_ERROR_PREFIX = 'Daily room claim limit reached.';
const DAILY_ROOM_CLAIM_LIMIT_TITLE = "You've Reached Today's Room Claim Limit";
const DAILY_ROOM_CLAIM_LIMIT_MESSAGE =
  "You've reached your daily room claim limit. To claim more rooms per day, increase your Builder XP by publishing more high quality rooms.";

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
  lighting: RoomLightingSettings;
  weather: RoomWeatherSettings;
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
  private readonly localRoomRepository = createLocalRoomRepository();
  private readonly expandedRoomEditorRepository = createExpandedRoomEditorRepository();
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
  private readonly objectInspectorController: CourseEditorObjectInspectorController;
  private readonly musicPatternController: EditorMusicPatternController;
  private readonly musicWorkflow: EditorMusicWorkflowCoordinator;
  private selectedRoomId: string | null = null;
  private loading = false;
  private statusText: string | null = null;
  private inspectZoom = 0.22;
  private isPanning = false;
  private pendingRightClickPanPointerId: number | null = null;
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
  private isShuttingDown = false;
  private modifierKeys: {
    SPACE: Phaser.Input.Keyboard.Key | null;
    ALT: Phaser.Input.Keyboard.Key | null;
  } = { SPACE: null, ALT: null };

  private readonly handleWake = (_sys: Phaser.Scenes.Systems, data?: CourseEditorSceneData): void => {
    void this.openFromData(data);
  };

  private get musicModeActive(): boolean {
    return this.musicWorkflow.isActive();
  }

  private get musicComposerMode(): EditorMusicComposerMode {
    return this.musicWorkflow.getComposerMode();
  }

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

  private readonly handleCanvasContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private readonly handleDocumentKeyDown = (event: KeyboardEvent): void => {
    if (!this.scene.isActive(this.scene.key) || editorState.isPlaying) {
      return;
    }

    const key = event.key.toLowerCase();
    const primaryModifier = event.metaKey || event.ctrlKey;
    const undoRequested = primaryModifier && key === 'z';
    const ctrlRedoRequested = event.ctrlKey && !event.metaKey && key === 'y';

    if (undoRequested || ctrlRedoRequested) {
      if (isNativeTextEditingFocused()) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if ((undoRequested && event.shiftKey) || ctrlRedoRequested) {
        this.redoAction();
      } else {
        this.undoAction();
      }
      return;
    }

    if (isTextInputFocused()) {
      return;
    }

    if (key === 'escape') {
      event.preventDefault();
      event.stopPropagation();
      if (this.objectInspectorController.isConnectingPressurePlate()) {
        this.objectInspectorController.cancelPressurePlateConnection();
        return;
      }
      if (this.objectInspectorController.hasPinnedInspector()) {
        this.objectInspectorController.clearPinnedInspector();
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

    if (primaryModifier && key === 's') {
      event.preventDefault();
      event.stopPropagation();
      void this.saveDraft(true, { promptForSignInOnUnauthorized: true });
      return;
    }

    if (primaryModifier && key === 'v') {
      if (!this.clipboardState || editorState.paletteMode !== 'tiles') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.clipboardPastePreviewActive = true;
      this.statusText = 'Click an expanded room cell to paste the copied tiles.';
      this.renderUi();
      return;
    }

    if (primaryModifier && event.shiftKey && key === 'p') {
      event.preventDefault();
      event.stopPropagation();
      void this.publishRoom();
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
    this.musicWorkflow = new EditorMusicWorkflowCoordinator({
      canActivateMusicMode: () => this.getSelectedSlice() !== null,
      commitRoomMusic: (nextMusic) => {
        const slice = this.getSelectedSlice();
        return slice ? slice.runtime.setRoomMusic(nextMusic) : cloneRoomMusic(this.roomMusic);
      },
      getCurrentUserId: () => getAuthDebugState().user?.id ?? null,
      getPublishValidationError: () => this.getSelectedSlice()?.runtime.getPublishValidationError() ?? null,
      getRoomMusic: () => this.roomMusic,
      getRoomPermissions: () => this.roomPermissions,
      getRoomVersion: () => this.roomVersion,
      getSaveInFlight: () => this.saveInFlight,
      getSummaryScope: () => {
        const selectedSlice = this.getSelectedSlice();
        return {
          kind: 'cell',
          label: selectedSlice ? `${selectedSlice.coordinates.x},${selectedSlice.coordinates.y}` : 'selected cell',
        };
      },
      prepareSaveContext: () => {
        const selectedSlice = this.getSelectedSlice();
        return selectedSlice
          ? { getSavedSnapshot: () => selectedSlice.runtime.exportRoomSnapshot() }
          : null;
      },
      replaceLegacyRoomMusicWithPattern: () => {
        const slice = this.getSelectedSlice();
        return slice ? slice.runtime.replaceRoomMusicWithPattern() : cloneRoomMusic(this.roomMusic);
      },
      requestRender: () => this.renderUi(),
      saveDraft: (force = false, options) => this.saveDraft(force, options),
      shouldRenderAfterPreviewStop: () => !this.isShuttingDown,
      updatePersistenceStatus: (text) => this.updatePersistenceStatus(text),
    });
    this.objectInspectorController = new CourseEditorObjectInspectorController(this, {
      getRoomSlices: () => this.roomSlices.values(),
      getRoomSliceById: (roomId) => this.roomSlices.get(roomId) ?? null,
      getSelectedSlice: () => this.getSelectedSlice(),
      getSliceAtWorldPoint: (worldX, worldY) => this.getSliceAtWorldPoint(worldX, worldY),
      getActiveCourseDraft: () => this.getActiveCourseDraft(),
      setActiveCourseDraft: (draft) => this.setActiveCourseDraft(draft),
      getSliceLabel: (slice) => this.getSliceLabel(slice as CourseRoomSlice),
      renderInspector: (state) => this.uiBridge?.renderInspector(state),
    });
    this.musicPatternController = new EditorMusicPatternController(this, {
      getRoomMusic: () => this.roomMusic,
      commitRoomMusic: (nextMusic) => this.musicWorkflow.commitRoomMusic(nextMusic),
      replaceLegacyRoomMusicWithPattern: () => this.musicWorkflow.commitLegacyRoomMusicPatternReplacement(),
      getWorkspaceOrigin: () => this.getSelectedSlice()?.origin ?? { x: 0, y: 0 },
      renderUi: () => this.renderUi(),
      getMusicPlaybackDebugState: () => globalRoomMusicController.getDebugState(),
      getMusicPreviewState: () => this.musicWorkflow.getPreviewState(),
      previewPatternCell: (pattern, instrumentId, row) =>
        globalRoomMusicController.previewPatternCell(pattern, instrumentId, row),
    });
    this.musicWorkflow.attachPatternController(this.musicPatternController);
  }

  create(data?: CourseEditorSceneData): void {
    setAppMode('editor');
    document.body.dataset.editorCourseMode = 'true';
    this.uiBridge = new EditorUiBridge({
      onRequestRender: () => this.renderUi(),
      onDocumentKeyDown: this.handleDocumentKeyDown,
      onAuthStateChanged: () => this.renderUi(),
      onBack: () => this.returnToCourseBuilder(),
      onStartPlayMode: async () => {
        await this.startPlayMode();
      },
      onSaveDraft: async () => {
        await this.saveDraft(true, { promptForSignInOnUnauthorized: true });
      },
      onPublishRoom: async () => {
        await this.publishRoom();
      },
      onPublishNudge: async () => {
        await this.publishRoom();
      },
      onMintRoom: async () => {},
      onRefreshMintMetadata: async () => {},
      onFitToScreen: () => this.fitToScreen(),
      onZoomIn: () => this.zoomIn(),
      onZoomOut: () => this.zoomOut(),
      onSetRoomTitle: (title) => this.setRoomTitle(title),
      onSelectTool: (tool) => {
        editorState.activeTool = tool;
        this.updateToolUi();
      },
      onClearCurrentLayer: () => {
        const slice = this.getSelectedSlice();
        if (!slice) {
          return;
        }

        slice.runtime.clearCurrentLayer();
        this.statusText = `Cleared ${editorState.activeLayer} in ${this.getSliceLabel(slice)}.`;
        this.renderUi();
      },
      onClearAllTiles: () => {
        const slice = this.getSelectedSlice();
        if (!slice) {
          return;
        }

        slice.runtime.clearAllTiles();
        this.statusText = `Cleared all tiles in ${this.getSliceLabel(slice)}.`;
        this.renderUi();
      },
      onClearAllObjects: () => {
        const slice = this.getSelectedSlice();
        if (!slice) {
          return;
        }

        slice.runtime.clearAllObjects();
        this.statusText = `Cleared all objects in ${this.getSliceLabel(slice)}.`;
        this.renderUi();
      },
      onSelectBackground: (backgroundId) => {
        editorState.selectedBackground = backgroundId;
        this.handleBackgroundChanged();
      },
      onSelectLighting: (mode) => {
        editorState.selectedLightingMode = mode;
        const slice = this.getSelectedSlice();
        if (slice) {
          slice.lighting = cloneRoomLightingSettings({
            ...slice.lighting,
            mode,
          });
        }
        this.renderUi();
      },
      onSetLightingDarkness: (darkness) => {
        editorState.selectedLightingDarkness = darkness;
        const slice = this.getSelectedSlice();
        if (slice) {
          slice.lighting = cloneRoomLightingSettings({
            ...slice.lighting,
            darkness,
          });
        }
        this.renderUi();
      },
      onSetLightingRadius: (radius) => {
        editorState.selectedLightingRadius = radius;
        const slice = this.getSelectedSlice();
        if (slice) {
          slice.lighting = cloneRoomLightingSettings({
            ...slice.lighting,
            radius,
          });
        }
        this.renderUi();
      },
      onSelectWeather: (mode) => {
        editorState.selectedWeatherMode = mode;
        const slice = this.getSelectedSlice();
        if (slice) {
          slice.weather = cloneRoomWeatherSettings({
            ...slice.weather,
            mode,
          });
        }
        this.renderUi();
      },
      onSetWeatherIntensity: (intensity) => {
        editorState.selectedWeatherIntensity = intensity;
        const slice = this.getSelectedSlice();
        if (slice) {
          slice.weather = cloneRoomWeatherSettings({
            ...slice.weather,
            intensity,
          });
        }
        this.renderUi();
      },
      onSetGoalType: (goalType) => this.setGoalType(goalType),
      onSetGoalTimeLimitSeconds: (seconds) => this.setGoalTimeLimitSeconds(seconds),
      onSetGoalRequiredCount: (requiredCount) => this.setGoalRequiredCount(requiredCount),
      onSetGoalSurvivalSeconds: (seconds) => this.setGoalSurvivalSeconds(seconds),
      onSetNpcQuestType: (questType) => {
        this.getSelectedSlice()?.runtime.setNpcQuestType(questType);
        this.renderUi();
      },
      onSetGoalIntroText: () => {},
      onStartGoalMarkerPlacement: (mode) => this.startGoalMarkerPlacement(mode),
      onClearGoalMarkers: () => this.clearGoalMarkers(),
      onSetCourseGoalType: (goalType) => this.setCourseGoalType(goalType),
      onSetCourseGoalTimeLimitSeconds: (seconds) => this.setCourseGoalTimeLimitSeconds(seconds),
      onSetCourseGoalRequiredCount: (requiredCount) => this.setCourseGoalRequiredCount(requiredCount),
      onSetCourseGoalSurvivalSeconds: (seconds) => this.setCourseGoalSurvivalSeconds(seconds),
      onStartCourseGoalMarkerPlacement: (mode) => this.startCourseGoalMarkerPlacement(mode),
      onClearCourseGoalMarkers: () => this.clearCourseGoalMarkers(),
      onBeginPressurePlateConnection: () => this.objectInspectorController.beginFocusedPressurePlateConnection(),
      onClearPressurePlateConnection: () => this.objectInspectorController.clearFocusedPressurePlateConnection(),
      onCancelPressurePlateConnection: () => this.objectInspectorController.cancelPressurePlateConnection(),
      onClearContainerContents: () => this.objectInspectorController.clearFocusedContainerContents(),
      onSetFocusedSwordsmanObjectiveMode: () => {},
      onSetFocusedSwordsmanDefeatMode: () => {},
      onSetFocusedPoliceBehaviorMode: () => {},
      onSetFocusedPolicePatrolShoots: () => {},
      onSetFocusedNpcMode: () => {},
      onSetFocusedNpcPushable: () => {},
      onSetFocusedNpcCanJumpFall: () => {},
      onSetFocusedNpcPlayerCollision: () => {},
      onSetFocusedNpcFriendlyFire: () => {},
      onSetFocusedNpcName: () => {},
      onSetFocusedNpcDialogue: () => {},
      onSetFocusedNpcDefeatMode: () => {},
    });
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
    this.musicPatternController.create();
    this.cameras.main.setRoundPixels(true);
    this.events.on('wake', this.handleWake, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);
    this.scale.on('resize', this.handleResize, this);
    this.game.canvas.addEventListener('contextmenu', this.handleCanvasContextMenu);
    this.game.canvas.addEventListener('wheel', this.handleCanvasWheel, { passive: false });
    this.setupPointerControls();
    this.setupKeyboard();
    this.renderMusicUi();
    void this.openFromData(data);
  }

  update(): void {
    this.syncRoomSliceBackgrounds();
    this.objectInspectorController.updatePressurePlateOverlay(this.pressurePlateGraphics);
    this.objectInspectorController.updateContainerOverlay(this.containerGraphics);
    this.musicPatternController.updateOverlay(this.musicModeActive && this.musicComposerMode === 'sequencer');
  }

  getCourseEditorState(): EditorCourseUiState {
    const draft = this.getActiveCourseDraft();
    const goal = draft?.goal ?? null;
    const cellUsageText = draft
      ? this.courseRecord
        ? getExpandedRoomCellUsageText(this.courseRecord)
        : formatExpandedRoomCellCount(draft.roomRefs.length)
      : '';

    return {
      visible: true,
      statusHidden: !this.statusText,
      statusText: this.statusText,
      roomStepText: draft
        ? `${cellUsageText} · editing ${this.getSelectedSlice()?.coordinates.x ?? 0},${this.getSelectedSlice()?.coordinates.y ?? 0}`
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
          ? 'Click an expanded room cell to place the start.'
          : this.courseGoalPlacementMode === 'exit'
            ? 'Click an expanded room cell to place the exit.'
            : this.courseGoalPlacementMode === 'checkpoint'
              ? 'Click an expanded room cell to add a checkpoint.'
              : this.courseGoalPlacementMode === 'finish'
                ? 'Click an expanded room cell to place the finish.'
                : '',
      summaryText: draft
        ? getCourseGoalSummaryText(draft, {
            collectiblesPlaced: this.countPlacedObjectsByCategory('collectible'),
          })
        : 'No expanded room selected.',
      placeStartHidden: !(goal?.type === 'reach_exit' || goal?.type === 'checkpoint_sprint'),
      placeStartActive: this.courseGoalPlacementMode === 'start',
      placeExitHidden: goal?.type !== 'reach_exit',
      placeExitActive: this.courseGoalPlacementMode === 'exit',
      addCheckpointHidden: goal?.type !== 'checkpoint_sprint',
      addCheckpointActive: this.courseGoalPlacementMode === 'checkpoint',
      placeFinishHidden: goal?.type !== 'checkpoint_sprint',
      placeFinishActive: this.courseGoalPlacementMode === 'finish',
    };
  }

  async returnToWorld(): Promise<void> {
    await this.returnToCourseBuilder();
  }

  async returnToCourseBuilder(): Promise<void> {
    this.setMusicModeActive(false);
    this.persistSessionOverridesForPlayableSlices();
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

  setGoalType(_nextType: RoomGoalType | null): void {
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

  useCustomSpriteAsTile(sprite: CustomSpriteDefinition): boolean {
    const slice = this.getSelectedSlice();
    const result = selectCustomSpriteTileForCourseRoom(
      sprite,
      slice
        ? {
            canSaveDraft: slice.permissions.canSaveDraft,
            label: this.getSliceLabel(slice),
            useCustomSpriteAsTile: (candidate) => Boolean(slice.runtime.useCustomSpriteAsTile(candidate)),
          }
        : null,
    );

    if (result.statusText) {
      this.statusText = result.statusText;
    }
    if (result.selected) {
      this.objectInspectorController.clearTransientState();
    }
    this.renderUi();
    return result.selected;
  }

  usesCustomSprite(spriteId: string): boolean {
    return Array.from(this.roomSlices.values()).some((slice) => (
      roomSnapshotUsesCustomSprite(slice.runtime.exportRoomSnapshot(), spriteId)
    ));
  }

  async saveDraft(
    _force?: boolean,
    options: { promptForSignInOnUnauthorized?: boolean } = {}
  ): Promise<RoomRecord | null> {
    const dirtySlices = this.getDirtySlices();
    if (dirtySlices.length === 0) {
      this.statusText = 'No room draft changes to save.';
      this.renderUi();
      return null;
    }

    if (options.promptForSignInOnUnauthorized) {
      await refreshAuthSession();
      if (!getAuthDebugState().authenticated) {
        await this.saveSlicesLocally(
          dirtySlices,
          this.getLocalDraftSavedStatusText(
            dirtySlices.length,
            'Drafts saved locally. Sign in to save room drafts to your account.',
            'Draft saved locally. Sign in to save room drafts to your account.'
          ),
          { keepOverride: true }
        );
        promptForSignIn('Sign in to save drafts to your account. Your local draft is safe.');
        return null;
      }
    }

    showBusyOverlay('Saving expanded room cells...', `Saving ${dirtySlices.length} room draft${dirtySlices.length === 1 ? '' : 's'}...`);
    let lastRecord: RoomRecord | null = null;
    try {
      for (const slice of dirtySlices) {
        const record = await this.roomRepository.saveDraft(slice.runtime.exportRoomSnapshot());
        this.applyStoredRoomRecordToSlice(slice, record, { keepDirty: false, keepOverride: true });
        clearLocalRoomStorageEntry(record.draft.id);
        lastRecord = record;
      }
      this.statusText = `Saved ${dirtySlices.length} room draft${dirtySlices.length === 1 ? '' : 's'}.`;
      this.renderUi();
      return lastRecord;
    } catch (error) {
      if (this.shouldPersistGuestDraftLocally(error)) {
        await this.saveSlicesLocally(
          dirtySlices,
          this.getLocalDraftSavedStatusText(
            dirtySlices.length,
            options.promptForSignInOnUnauthorized
              ? 'Drafts saved locally. Sign in to save room drafts to your account.'
              : 'Drafts saved locally. Sign in to publish.',
            options.promptForSignInOnUnauthorized
              ? 'Draft saved locally. Sign in to save room drafts to your account.'
              : 'Draft saved locally. Sign in to publish.'
          ),
          { keepOverride: true }
        );
        if (options.promptForSignInOnUnauthorized) {
          promptForSignIn('Sign in to save drafts to your account. Your local draft is safe.');
        }
        return null;
      }
      if (this.showDailyRoomClaimLimitModal(error)) {
        return null;
      }
      this.statusText = error instanceof Error ? error.message : 'Failed to save expanded room cell drafts.';
      this.renderUi();
      return null;
    } finally {
      if (getAppFeedbackDebugState().busyState !== 'error') {
        hideBusyOverlay();
      }
    }
  }

  async publishRoom(): Promise<RoomRecord | null> {
    const targetSlices = this.getChangedSlicesForPublish();
    if (targetSlices.length === 0) {
      this.statusText = 'No changed rooms to publish.';
      this.renderUi();
      return null;
    }

    showBusyOverlay('Publishing expanded room cells...', `Publishing ${targetSlices.length} room${targetSlices.length === 1 ? '' : 's'}...`);
    let lastRecord: RoomRecord | null = null;
    try {
      await refreshAuthSession();
      if (!getAuthDebugState().authenticated) {
        await this.saveSlicesLocally(
          targetSlices,
          this.getLocalDraftSavedStatusText(
            targetSlices.length,
            'Drafts saved locally. Sign in to publish.',
            'Draft saved locally. Sign in to publish.'
          ),
          { keepOverride: true }
        );
        promptForSignIn('Sign in to publish this room. Your local draft is safe.');
        return null;
      }

      for (const slice of targetSlices) {
        const record = await this.roomRepository.publish(slice.runtime.exportRoomSnapshot());
        this.applyStoredRoomRecordToSlice(slice, record, { keepDirty: false, keepOverride: false });
        clearLocalRoomStorageEntry(record.draft.id);
        lastRecord = record;
      }
      await refreshAuthSession();
      this.statusText = `Published ${targetSlices.length} room${targetSlices.length === 1 ? '' : 's'}.`;
      await this.musicWorkflow.handleRoomPublished();
      this.renderUi();
      return lastRecord;
    } catch (error) {
      if (this.shouldPersistGuestDraftLocally(error)) {
        await this.saveSlicesLocally(
          targetSlices,
          this.getLocalDraftSavedStatusText(
            targetSlices.length,
            'Drafts saved locally. Sign in to publish.',
            'Draft saved locally. Sign in to publish.'
          ),
          { keepOverride: true }
        );
        promptForSignIn('Sign in to publish this room. Your local draft is safe.');
        return null;
      }
      if (this.showDailyRoomClaimLimitModal(error)) {
        return null;
      }
      this.statusText = error instanceof Error ? error.message : 'Failed to publish changed expanded room cells.';
      this.renderUi();
      return null;
    } finally {
      if (getAppFeedbackDebugState().busyState !== 'error') {
        hideBusyOverlay();
      }
    }
  }

  async saveCourseDraft(): Promise<void> {
    const courseRecord = this.syncCourseRecordFromSession();
    if (!courseRecord) {
      return;
    }

    const disabledReason = this.getCourseSaveDisabledReason();
    if (disabledReason) {
      this.statusText = disabledReason;
      this.renderUi();
      return;
    }

    showBusyOverlay('Saving expanded room...', 'Saving expanded room goal and setup...');
    try {
      const saved = await this.expandedRoomEditorRepository.saveDraft(courseRecord.draft);
      setActiveCourseDraftSessionRecord(saved, { selectedRoomId: this.selectedRoomId });
      this.courseRecord = getActiveCourseDraftSessionRecord();
      this.statusText = 'Expanded room changes saved.';
      this.redrawCourseMarkers();
      this.renderUi();
    } catch (error) {
      this.statusText = error instanceof Error ? error.message : 'Failed to save expanded room changes.';
      this.renderUi();
    } finally {
      hideBusyOverlay();
    }
  }

  async publishCourseDraft(): Promise<void> {
    const courseRecord = this.syncCourseRecordFromSession();
    if (!courseRecord) {
      return;
    }

    const disabledReason = this.getCoursePublishDisabledReason();
    if (disabledReason) {
      this.statusText = disabledReason;
      this.renderUi();
      return;
    }

    showBusyOverlay('Publishing expanded room...', 'Saving expanded room goal and publishing the expanded room...');
    try {
      const saved = await this.expandedRoomEditorRepository.saveDraft(courseRecord.draft);
      setActiveCourseDraftSessionRecord(saved, { selectedRoomId: this.selectedRoomId });
      this.courseRecord = getActiveCourseDraftSessionRecord();
      const published = await this.expandedRoomEditorRepository.publishExpandedRoom(
        this.courseRecord?.draft.id ?? saved.draft.id
      );
      setActiveCourseDraftSessionRecord(published, { selectedRoomId: this.selectedRoomId });
      this.courseRecord = getActiveCourseDraftSessionRecord();
      this.statusText = 'Expanded room published.';
      this.redrawCourseMarkers();
      this.renderUi();
    } catch (error) {
      this.statusText = error instanceof Error ? error.message : 'Failed to publish expanded room.';
      this.renderUi();
    } finally {
      hideBusyOverlay();
    }
  }

  async startPlayMode(): Promise<void> {
    const draft = this.getActiveCourseDraft();
    if (!draft || draft.roomRefs.length === 0) {
      this.statusText = 'Add expanded room cells before testing.';
      this.renderUi();
      return;
    }

    this.persistSessionOverridesForPlayableSlices();
    const startRoom =
      (draft.startPoint
        ? draft.roomRefs.find((roomRef) => roomRef.roomId === draft.startPoint?.roomId) ?? null
        : draft.roomRefs[0] ?? null);
    if (!startRoom) {
      this.statusText = 'Expanded room draft has no playable cells.';
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

    this.hideObjectInspectorUi();
    this.setMusicModeActive(false);
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

  private get roomMusic(): RoomMusic | null {
    return this.getSelectedSlice()?.runtime.currentRoomMusic ?? null;
  }

  private get roomPermissions(): RoomPermissions {
    return this.getSelectedSlice()?.permissions ?? {
      canSaveDraft: false,
      canPublish: false,
      canRevert: false,
      canMint: false,
    };
  }

  private get roomVersion(): number {
    return this.getSelectedSlice()?.currentVersion ?? 0;
  }

  private get saveInFlight(): boolean {
    return this.loading;
  }

  private updatePersistenceStatus(text: string): void {
    this.statusText = text;
    this.renderUi();
  }

  setMusicModeActive(active: boolean): void {
    this.musicWorkflow.setMusicModeActive(active);
  }

  toggleMusicMode(): void {
    this.musicWorkflow.toggleMusicMode();
  }

  async saveRoomMusicDraftAndPhrases(options?: EditorMusicPhraseSaveOptions): Promise<RoomRecord | null> {
    return this.musicWorkflow.saveRoomMusicDraftAndPhrases(options);
  }

  closeRoomMusicPhraseSavePrompt(): void {
    this.musicWorkflow.closeRoomMusicPhraseSavePrompt();
  }

  setRoomMusicPhraseSavePromptName(value: string): void {
    this.musicWorkflow.setRoomMusicPhraseSavePromptName(value);
  }

  async saveActiveRoomMusicPhrase(): Promise<RoomRecord | null> {
    return this.musicWorkflow.saveActiveRoomMusicPhrase();
  }

  saveAsActiveRoomMusicPhrase(): void {
    this.musicWorkflow.saveAsActiveRoomMusicPhrase();
  }

  async confirmRoomMusicPhraseSavePrompt(): Promise<void> {
    await this.musicWorkflow.confirmRoomMusicPhraseSavePrompt();
  }

  async startNewRoomMusicPhrase(): Promise<void> {
    await this.musicWorkflow.startNewRoomMusicPhrase();
  }

  toggleRoomMusicPhraseMetadataEditor(): void {
    this.musicWorkflow.toggleRoomMusicPhraseMetadataEditor();
  }

  async deleteActiveRoomMusicPhrase(): Promise<void> {
    await this.musicWorkflow.deleteActiveRoomMusicPhrase();
  }

  setMusicComposerMode(mode: EditorMusicComposerMode): void {
    this.musicWorkflow.setMusicComposerMode(mode);
  }

  setMusicPatternInstrumentTab(instrumentId: RoomPatternInstrumentId): void {
    this.musicWorkflow.setMusicPatternInstrumentTab(instrumentId);
  }

  setRoomMusicPitchMode(mode: RoomPatternPitchMode): void {
    this.musicWorkflow.setRoomMusicPitchMode(mode);
  }

  setRoomMusicKeyTonic(tonic: RoomMusicKeyTonic): void {
    this.musicWorkflow.setRoomMusicKeyTonic(tonic);
  }

  setRoomMusicKeyMode(mode: RoomMusicKeyMode): void {
    this.musicWorkflow.setRoomMusicKeyMode(mode);
  }

  shiftRoomMusicOctave(delta: number): void {
    this.musicWorkflow.shiftRoomMusicOctave(delta);
  }

  shiftRoomMusicTempo(delta: number): void {
    this.musicWorkflow.shiftRoomMusicTempo(delta);
  }

  shiftRoomMusicSwing(delta: number): void {
    this.musicWorkflow.shiftRoomMusicSwing(delta);
  }

  setRoomMusicPhraseNameSuffix(value: string): void {
    this.musicWorkflow.setRoomMusicPhraseNameSuffix(value);
  }

  replaceLegacyRoomMusicWithPattern(): void {
    this.musicWorkflow.replaceLegacyRoomMusicWithPattern();
  }

  refreshMusicPhraseLibrary(): void {
    this.musicWorkflow.refreshMusicPhraseLibrary();
  }

  loadMoreMusicPhrases(): void {
    this.musicWorkflow.loadMoreMusicPhrases();
  }

  async useMusicPhrase(phraseId: string): Promise<void> {
    await this.musicWorkflow.useMusicPhrase(phraseId);
  }

  selectArrangementSlot(instrumentId: RoomPatternInstrumentId, slotIndex: number): void {
    this.musicWorkflow.selectArrangementSlot(instrumentId, slotIndex);
  }

  clearSelectedArrangementSlot(): void {
    this.musicWorkflow.clearSelectedArrangementSlot();
  }

  clearAllArrangementSlots(): void {
    this.musicWorkflow.clearAllArrangementSlots();
  }

  async assignMusicPhraseToArrangementSlot(
    phraseId: string,
    instrumentId: RoomPatternInstrumentId,
    slotIndex: number,
  ): Promise<void> {
    await this.musicWorkflow.assignMusicPhraseToArrangementSlot(phraseId, instrumentId, slotIndex);
  }

  setRoomMusicArrangementSlotCount(slotCount: number): void {
    this.musicWorkflow.setRoomMusicArrangementSlotCount(slotCount);
  }

  toggleRoomMusicPreview(): void {
    this.musicWorkflow.toggleRoomMusicPreview();
  }

  private handleMusicPointerDown(pointer: Phaser.Input.Pointer): void {
    this.musicWorkflow.handleMusicPointerDown(pointer);
  }

  private handleMusicPointerMove(pointer: Phaser.Input.Pointer): void {
    this.musicWorkflow.handleMusicPointerMove(pointer);
  }

  private handleMusicPointerUp(pointer: Phaser.Input.Pointer): void {
    this.musicWorkflow.handleMusicPointerUp(pointer);
  }

  private updateMusicCursorHighlight(): boolean {
    return this.musicWorkflow.updateMusicCursorHighlight(this.cursorGraphics);
  }

  private renderMusicUi(): void {
    this.musicWorkflow.renderUi();
  }

  describeState(): Record<string, unknown> {
    const camera = this.cameras.main;
    return {
      scene: 'course-editor',
      courseId: this.courseRecord?.draft.id ?? null,
      roomCount: this.courseRecord?.draft.roomRefs.length ?? 0,
      selectedRoomId: this.selectedRoomId,
      zoom: camera?.zoom ?? this.inspectZoom,
      dirtyRoomCount: this.getDirtySlices().length,
      courseGoalPlacementMode: this.courseGoalPlacementMode,
    };
  }

  private async openFromData(data?: CourseEditorSceneData): Promise<void> {
    setAppMode('editor');
    document.body.dataset.editorCourseMode = 'true';
    this.isShuttingDown = false;
    this.musicWorkflow.resetForSceneOpen();
    this.musicPatternController.reset();
    this.loading = true;
    this.statusText = data?.statusMessage ?? 'Loading expanded room editor...';
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
        this.statusText = `Editing ${record.draft.title?.trim() || 'expanded room'} across ${getExpandedRoomCellUsageText(record)}.`;
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
      hideBusyOverlay();
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

    const record = await this.expandedRoomEditorRepository.loadExpandedRoomRecord(courseId);
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
    this.objectInspectorController.clearTransientState();
    this.uiBridge?.renderInspector(createEmptyCourseInspectorState());
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
      lighting: cloneRoomLightingSettings(null),
      weather: cloneRoomWeatherSettings(null),
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
        getTilemap: () => slice.map,
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
          editorState.selectedSolidBackgroundColor = getSolidColorFromBackgroundValue(
            backgroundId,
            editorState.selectedSolidBackgroundColor,
          );
        },
        getSelectedLightingSettings: () => cloneRoomLightingSettings(slice.lighting),
        setSelectedLightingSettings: (lighting) => {
          slice.lighting = cloneRoomLightingSettings(lighting);
        },
        getSelectedWeatherSettings: () => cloneRoomWeatherSettings(slice.weather),
        setSelectedWeatherSettings: (weather) => {
          slice.weather = cloneRoomWeatherSettings(weather);
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
            select.value = getBackgroundSelectionValue(backgroundId);
          }
        },
        updateLightingControlsValue: (lighting) => {
          if (this.selectedRoomId !== slice.roomId) {
            return;
          }
          const select = document.getElementById(
            'lighting-mode-select'
          ) as HTMLSelectElement | null;
          const darknessRange = document.getElementById(
            'lighting-darkness-range'
          ) as HTMLInputElement | null;
          const radiusRange = document.getElementById(
            'lighting-radius-range'
          ) as HTMLInputElement | null;
          const normalizedLighting = cloneRoomLightingSettings(lighting);
          if (select) {
            select.value = normalizedLighting.mode;
          }
          if (darknessRange) {
            darknessRange.value = String(normalizedLighting.darkness);
          }
          if (radiusRange) {
            radiusRange.value = String(normalizedLighting.radius);
          }
        },
        updateWeatherControlsValue: (weather) => {
          if (this.selectedRoomId !== slice.roomId) {
            return;
          }
          const select = document.getElementById(
            'weather-mode-select'
          ) as HTMLSelectElement | null;
          const intensityRange = document.getElementById(
            'weather-intensity-range'
          ) as HTMLInputElement | null;
          const normalizedWeather = cloneRoomWeatherSettings(weather);
          if (select) {
            select.value = normalizedWeather.mode;
          }
          if (intensityRange) {
            intensityRange.value = String(normalizedWeather.intensity);
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
        recordBuildPlacement: () => {},
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
    slice.lighting = cloneRoomLightingSettings(snapshot.lighting);
    slice.weather = cloneRoomWeatherSettings(snapshot.weather);
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
    this.courseRecord = getActiveCourseDraftSessionRecord();
    this.redrawCourseMarkers();
  }

  private syncCourseRecordFromSession(): CourseRecord | null {
    const currentCourseId = this.courseRecord?.draft.id ?? null;
    if (!currentCourseId) {
      return this.courseRecord;
    }

    const sessionRecord = getActiveCourseDraftSessionRecord();
    if (sessionRecord?.draft.id === currentCourseId) {
      this.courseRecord = sessionRecord;
    }

    return this.courseRecord;
  }

  private shouldPersistGuestDraftLocally(error: unknown): boolean {
    return isRoomApiError(error) && error.status === 401;
  }

  private showDailyRoomClaimLimitModal(error: unknown): boolean {
    if (!isRoomApiError(error) || error.status !== 429) {
      return false;
    }
    if (!error.message.startsWith(DAILY_ROOM_CLAIM_LIMIT_ERROR_PREFIX)) {
      return false;
    }

    this.statusText = DAILY_ROOM_CLAIM_LIMIT_ERROR_PREFIX;
    this.renderUi();
    showBusyError(DAILY_ROOM_CLAIM_LIMIT_MESSAGE, {
      title: DAILY_ROOM_CLAIM_LIMIT_TITLE,
      closeLabel: 'OK',
    });
    return true;
  }

  private async saveSlicesLocally(
    slices: CourseRoomSlice[],
    successText: string,
    options: { keepOverride: boolean }
  ): Promise<RoomRecord | null> {
    let lastRecord: RoomRecord | null = null;
    for (const slice of slices) {
      const record = await this.localRoomRepository.saveDraft(slice.runtime.exportRoomSnapshot());
      this.applyStoredRoomRecordToSlice(slice, record, {
        keepDirty: false,
        keepOverride: options.keepOverride,
      });
      lastRecord = record;
    }
    this.statusText = successText;
    this.renderUi();
    return lastRecord;
  }

  private getLocalDraftSavedStatusText(
    count: number,
    pluralText: string,
    singularText: string
  ): string {
    return count === 1 ? singularText : pluralText;
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
      draft.objectLinks = normalized.objectLinks;
      draft.pressurePlateLinks = normalized.pressurePlateLinks;
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
      return 'No expanded room loaded.';
    }

    return this.courseRecord.permissions.canSaveDraft
      ? getCurrentCourseDraftSaveDisabledReason(this.courseRecord, isActiveCourseDraftSessionDirty())
      : 'This expanded room is read-only for your account.';
  }

  private getCoursePublishDisabledReason(): string | null {
    if (!this.courseRecord) {
      return 'No expanded room loaded.';
    }

    return this.courseRecord.permissions.canPublish
      ? getCurrentCourseDraftPublishDisabledReason(this.courseRecord)
      : 'This expanded room is read-only for your account.';
  }

  private getChangedSlicesForPublish(): CourseRoomSlice[] {
    return Array.from(this.roomSlices.values()).filter(
      (slice) =>
        slice.runtime.isRoomDirty ||
        getActiveCourseDraftSessionRoomOverride(slice.roomId) !== null
    );
  }

  private persistSessionOverridesForPlayableSlices(): void {
    for (const slice of this.roomSlices.values()) {
      setActiveCourseDraftSessionRoomOverride(slice.runtime.exportRoomSnapshot());
    }
  }

  private getSelectedSlice(): CourseRoomSlice | null {
    return this.selectedRoomId ? this.roomSlices.get(this.selectedRoomId) ?? null : null;
  }

  private countPlacedObjectsByCategory(category: 'collectible' | 'enemy'): number {
    let count = 0;
    for (const slice of this.roomSlices.values()) {
      for (const placed of slice.placedObjects) {
        if (placedObjectContributesToCategory(placed, category)) {
          count += 1;
        }
      }
    }
    return count;
  }

  private selectRoomById(roomId: string | null): void {
    const fallback = this.courseRecord?.draft.roomRefs[0]?.roomId ?? null;
    const nextRoomId = roomId && this.roomSlices.has(roomId) ? roomId : fallback;
    const roomChanged = nextRoomId !== this.selectedRoomId;
    this.selectedRoomId = nextRoomId;
    if (roomChanged) {
      this.objectInspectorController.clearTransientState();
    }
    setActiveCourseDraftSessionSelectedRoom(nextRoomId);
    const slice = this.getSelectedSlice();
    if (slice) {
      editorState.selectedBackground = slice.backgroundId;
      editorState.selectedSolidBackgroundColor = getSolidColorFromBackgroundValue(
        slice.backgroundId,
        editorState.selectedSolidBackgroundColor,
      );
      editorState.selectedLightingMode = slice.lighting.mode;
      editorState.selectedLightingDarkness = slice.lighting.darkness;
      editorState.selectedLightingRadius = slice.lighting.radius;
      editorState.selectedWeatherMode = slice.weather.mode;
      editorState.selectedWeatherIntensity = slice.weather.intensity;
      const select = document.getElementById('background-select') as HTMLSelectElement | null;
      if (select) {
        select.value = getBackgroundSelectionValue(slice.backgroundId);
      }
      const colorInput = document.getElementById(
        'background-solid-color-input'
      ) as HTMLInputElement | null;
      if (colorInput) {
        colorInput.value = editorState.selectedSolidBackgroundColor;
      }
      const lightingSelect = document.getElementById(
        'lighting-mode-select'
      ) as HTMLSelectElement | null;
      const darknessRange = document.getElementById(
        'lighting-darkness-range'
      ) as HTMLInputElement | null;
      const radiusRange = document.getElementById(
        'lighting-radius-range'
      ) as HTMLInputElement | null;
      const weatherSelect = document.getElementById(
        'weather-mode-select'
      ) as HTMLSelectElement | null;
      const weatherIntensityRange = document.getElementById(
        'weather-intensity-range'
      ) as HTMLInputElement | null;
      if (lightingSelect) {
        lightingSelect.value = slice.lighting.mode;
      }
      if (darknessRange) {
        darknessRange.value = String(slice.lighting.darkness);
      }
      if (radiusRange) {
        radiusRange.value = String(slice.lighting.radius);
      }
      if (weatherSelect) {
        weatherSelect.value = slice.weather.mode;
      }
      if (weatherIntensityRange) {
        weatherIntensityRange.value = String(slice.weather.intensity);
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
        this.beginPointerPan(pointer);
        if (
          pointer.rightButtonDown() &&
          !this.modifierKeys.SPACE?.isDown &&
          !this.modifierKeys.ALT?.isDown
        ) {
          this.pendingRightClickPanPointerId = pointer.id;
        } else {
          this.isPanning = true;
        }
        return;
      }

      if (this.musicModeActive) {
        this.handleMusicPointerDown(pointer);
        this.updateMusicCursorHighlight();
        return;
      }

      this.handlePrimaryPointerDown(pointer);
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.pendingRightClickPanPointerId === pointer.id) {
        const distance = Phaser.Math.Distance.Between(
          this.panStartPointer.x,
          this.panStartPointer.y,
          pointer.x,
          pointer.y,
        );
        if (distance >= PAN_THRESHOLD) {
          this.pendingRightClickPanPointerId = null;
          this.isPanning = true;
          this.applyPointerPan(pointer);
        }
        return;
      }

      if (this.isPanning) {
        this.applyPointerPan(pointer);
        return;
      }

      if (this.musicModeActive) {
        this.updateMusicCursorHighlight();
        this.handleMusicPointerMove(pointer);
        return;
      }

      this.updateCursorHighlight(pointer);
      this.handlePointerDrag(pointer);
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (this.pendingRightClickPanPointerId === pointer.id) {
        this.pendingRightClickPanPointerId = null;
        this.handleSecondaryPointerClick(pointer);
        return;
      }

      if (this.isPanning) {
        this.isPanning = false;
        return;
      }

      if (this.musicModeActive) {
        this.handleMusicPointerUp(pointer);
        this.updateMusicCursorHighlight();
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

    if (editorState.paletteMode === 'objects') {
      if (this.objectInspectorController.isConnectingPressurePlate()) {
        this.objectInspectorController.handlePressurePlateConnectionClick(slice, pointer.worldX, pointer.worldY);
        this.renderUi();
        return;
      }
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
      if (editorState.activeTool === 'eraser') {
        if (this.objectInspectorController.handleObjectModeSecondaryAction(slice, pointer.worldX, pointer.worldY)) {
          this.renderUi();
          return;
        }

        this.removeObjectAt(slice, pointer.worldX, pointer.worldY);
        this.renderUi();
        return;
      }
      const clickedPressurePlate = slice.runtime.findPlacedObjectAt(
        pointer.worldX,
        pointer.worldY,
        (placed) => canPlacedObjectUseObjectLink(placed)
      );
      const clickedSign = slice.runtime.findPlacedObjectAt(
        pointer.worldX,
        pointer.worldY,
        (placed) => canPlacedObjectHaveSignText(placed),
      );
      if (clickedSign?.instanceId) {
        this.openPlacedSignTextEditor(clickedSign, this.getSliceLabel(slice));
        this.renderUi();
        return;
      }
      if (clickedPressurePlate) {
        this.objectInspectorController.focusPressurePlate(clickedPressurePlate);
        this.renderUi();
        return;
      }

      if (this.objectInspectorController.handleContainerContentsClick(slice, pointer.worldX, pointer.worldY)) {
        return;
      }

      if (this.objectInspectorController.hasPinnedInspector()) {
        const hasSelectedObject = Boolean(editorState.selectedObjectId);
        this.objectInspectorController.clearPinnedInspector();
        if (!hasSelectedObject) {
          return;
        }
      }

      this.handleObjectPlace(slice, pointer, localTile.tileX, localTile.tileY);
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
    if (this.objectInspectorController.handleObjectPlaced(placed)) {
      return;
    }

    if (placed?.instanceId && canPlacedObjectHaveSignText(placed)) {
      this.openPlacedSignTextEditor(placed, this.getSliceLabel(slice));
    }
  }

  private removeObjectAt(slice: CourseRoomSlice, worldX: number, worldY: number): void {
    const removed = slice.runtime.removeObjectAt(worldX, worldY);
    if (!removed) {
      return;
    }

    this.objectInspectorController.handleObjectRemoved(slice.roomId, removed);
  }

  private handleSecondaryPointerClick(pointer: Phaser.Input.Pointer): void {
    if (this.musicModeActive) {
      return;
    }

    const slice = this.getSliceForPointer(pointer);
    if (!slice) {
      return;
    }

    this.selectRoomById(slice.roomId);
    const localTile = this.getLocalTileForPointer(pointer, slice);
    if (!localTile) {
      return;
    }

    if (editorState.paletteMode === 'objects') {
      if (this.objectInspectorController.handleObjectModeSecondaryAction(slice, pointer.worldX, pointer.worldY)) {
        this.renderUi();
        return;
      }

      this.removeObjectAt(slice, pointer.worldX, pointer.worldY);
      this.renderUi();
      return;
    }

    slice.runtime.beginTileBatch();
    slice.runtime.eraseTileAt(pointer.worldX, pointer.worldY);
    slice.runtime.commitTileBatch();
    this.renderUi();
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
        this.statusText = 'Copied tile region. Click any expanded room cell to paste.';
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

  private hideObjectInspectorUi(): void {
    this.objectInspectorController.hideUi(this.pressurePlateGraphics, this.containerGraphics);
  }

  setPlacedSignText(instanceId: string, text: string | null): boolean {
    const target = this.objectInspectorController.getPlacedObjectRefByInstanceId(instanceId);
    if (!target) {
      return false;
    }

    const updated = target.slice.runtime.setSignText(instanceId, text);
    if (!updated) {
      return false;
    }

    this.statusText = `Updated sign text in ${this.getSliceLabel(target.slice as CourseRoomSlice)}.`;
    this.renderUi();
    return true;
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

  private beginPointerPan(pointer: Phaser.Input.Pointer): void {
    this.panStartPointer = { x: pointer.x, y: pointer.y };
    this.panStartScroll = {
      x: this.cameras.main.scrollX,
      y: this.cameras.main.scrollY,
    };
  }

  private applyPointerPan(pointer: Phaser.Input.Pointer): void {
    const dx = (this.panStartPointer.x - pointer.x) / this.cameras.main.zoom;
    const dy = (this.panStartPointer.y - pointer.y) / this.cameras.main.zoom;
    this.cameras.main.setScroll(this.panStartScroll.x + dx, this.panStartScroll.y + dy);
    this.constrainCamera();
  }

  private syncCameraBounds(): void {
    const size = getCourseWorkspacePixelSize(this.workspaceBounds);
    const zoom = Math.max(this.cameras.main.zoom || this.inspectZoom, MIN_ZOOM);
    const visibleWidth = this.scale.width / zoom;
    const visibleHeight = this.scale.height / zoom;
    const dynamicMargin = Math.max(TILE_SIZE * 8, Math.max(visibleWidth, visibleHeight) * 0.35);
    const margin = Math.min(dynamicMargin, Math.max(ROOM_PX_WIDTH, ROOM_PX_HEIGHT) * 2);
    this.cameras.main.setBounds(
      -margin,
      -margin,
      size.width + margin * 2,
      size.height + margin * 2,
    );
  }

  private centerCameraOnWorkspace(): void {
    const size = getCourseWorkspacePixelSize(this.workspaceBounds);
    this.syncCameraBounds();
    this.cameras.main.centerOn(size.width * 0.5, size.height * 0.5);
    this.constrainCamera();
  }

  private constrainCamera(): void {
    constrainInspectCamera(this.cameras.main);
  }

  private adjustButtonZoom(factor: number): void {
    this.adjustZoomByFactor(factor, this.scale.width * 0.5, this.scale.height * 0.5);
  }

  private adjustZoomByFactor(factor: number, screenX: number, screenY: number): void {
    const camera = this.cameras.main;
    const nextZoom = Phaser.Math.Clamp(camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(nextZoom - camera.zoom) < 0.0001) {
      return;
    }

    const anchor = getScreenAnchorWorldPoint(screenX, screenY, camera);
    this.inspectZoom = Number(nextZoom.toFixed(3));
    camera.setZoom(this.inspectZoom);
    this.syncCameraBounds();
    const nextScroll = getScrollForScreenAnchor(anchor.x, anchor.y, screenX, screenY, camera);
    camera.setScroll(nextScroll.x, nextScroll.y);
    this.constrainCamera();
    this.renderUi();
  }

  private renderUi(): void {
    this.renderMusicUi();
    if (this.isShuttingDown || !this.uiBridge) {
      return;
    }
    const camera = this.cameras.main;
    if (!camera) {
      return;
    }
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
          ? 'Loading expanded room...'
          : this.statusText ??
            (dirtySlices.length > 0
              ? `${dirtySlices.length} room draft${dirtySlices.length === 1 ? '' : 's'} changed.`
              : 'Expanded room cells are ready.'),
      accentText: '',
      linkLabel: '',
      linkHref: null,
    };

    this.uiBridge?.render(
      buildEditorUiViewModel({
        roomTitle: selectedSlice?.roomTitle ?? '',
        roomCoordinates: selectedSlice?.coordinates ?? { x: 0, y: 0 },
        roomGoal: null,
        roomGoalIntroText: null,
        roomPlacementMode: null as GoalPlacementMode,
        goalUsesMarkers: false,
        goalSummaryText: 'Room goals are hidden while editing the whole expanded room.',
        roomPermissions: selectedPermissions,
        publishValidationError: null,
        mintedTokenId: null,
        canRefreshMintMetadata: false,
        saveInFlight: this.loading,
        mintedMetadataCurrent: true,
        publishedVersion: selectedSlice?.publishedVersion ?? 0,
        roomVersionHistory: selectedSlice?.roomVersionHistory ?? [],
        entrySource: 'world',
        zoomText: `Zoom: ${camera.zoom.toFixed(2)}x`,
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
      backButton.setAttribute('title', 'Return to Expanded Room Setup (Esc)');
    }
    const publishButton = document.getElementById('btn-publish-room');
    if (publishButton) {
      publishButton.setAttribute(
        'title',
        'Publish changed room drafts only. Expanded room goal and expanded room publish actions live in the Expanded Room Goal section.'
      );
    }

    const courseSaveButton = document.getElementById('btn-course-editor-save-course') as HTMLButtonElement | null;
    if (courseSaveButton) {
      courseSaveButton.disabled = Boolean(courseSaveDisabledReason);
      courseSaveButton.title = courseSaveDisabledReason ?? 'Save the expanded room goal, markers, and cell membership.';
    }

    const coursePublishButton = document.getElementById('btn-course-editor-publish-course') as HTMLButtonElement | null;
    if (coursePublishButton) {
      coursePublishButton.disabled = Boolean(coursePublishDisabledReason);
      coursePublishButton.title =
        coursePublishDisabledReason ??
        'Publish the expanded room goal and cell membership. Room changes still publish separately.';
    }

    const topStatus = document.getElementById('editor-top-save-status');
    if (topStatus) {
      topStatus.textContent = draft
        ? `${dirtyRoomCount} changed room${dirtyRoomCount === 1 ? '' : 's'} · ${courseDirty ? 'expanded room draft dirty' : 'expanded room saved'} · room edits and expanded room edits publish separately`
        : 'No expanded room loaded.';
    }
  }

  private getSliceLabel(slice: CourseRoomSlice): string {
    return slice.roomTitle?.trim() || `Room ${slice.coordinates.x},${slice.coordinates.y}`;
  }

  private openPlacedSignTextEditor(placed: PlacedObject, sliceLabel: string): void {
    if (!placed.instanceId) {
      return;
    }

    requestSignTextEdit({
      instanceId: placed.instanceId,
      objectId: placed.id,
      objectLabel: getObjectById(placed.id)?.name ?? 'Sign',
      currentText: getPlacedObjectSignText(placed) ?? '',
      contextHint: sliceLabel,
    });
  }

  private handleShutdown = (): void => {
    this.isShuttingDown = true;
    this.events.off('wake', this.handleWake, this);
    this.scale.off('resize', this.handleResize, this);
    this.game.canvas.removeEventListener('contextmenu', this.handleCanvasContextMenu);
    this.game.canvas.removeEventListener('wheel', this.handleCanvasWheel);
    this.musicWorkflow.resetForShutdown({ stopMode: 'editor-preview', render: true });
    this.musicPatternController.destroy();
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
    delete document.body.dataset.editorCourseMode;
  };
}
