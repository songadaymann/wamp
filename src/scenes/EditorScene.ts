import Phaser from 'phaser';
import { getAuthDebugState } from '../auth/client';
import {
  TILE_SIZE,
  ROOM_WIDTH,
  ROOM_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_PX_HEIGHT,
  LAYER_NAMES,
  TILESETS,
  editorState,
} from '../config';
import { globalRoomMusicController } from '../music/controller';
import {
  type RoomMusic,
  type RoomMusicKeyMode,
  type RoomMusicKeyTonic,
  type RoomPatternInstrumentId,
  type RoomPatternPitchMode,
} from '../music/model';
import { registerCustomSprites } from '../customSprites/registry';
import {
  DEFAULT_ROOM_COORDINATES,
  DEFAULT_ROOM_ID,
  cloneRoomSnapshot,
  createRoomRepository,
  roomIdFromCoordinates,
  type RoomCoordinates,
  type RoomPermissions,
  type RoomRecord,
  type RoomSpawnPoint,
  type RoomSnapshot,
  type RoomVersionRecord,
} from '../persistence/roomRepository';
import { createWorldRepository } from '../persistence/worldRepository';
import { getSolidColorFromBackgroundValue } from '../backgrounds/model';
import {
  type CourseGoalType,
  type CourseSnapshot,
} from '../courses/model';
import {
  cloneRoomGoal,
  type RoomGoal,
  type RoomGoalType,
} from '../goals/roomGoals';
import { setAppMode } from '../ui/appMode';
import {
  hideBusyOverlay,
  showBusyError,
  showBusyOverlay,
} from '../ui/appFeedback';
import { isNativeTextEditingFocused, isTextInputFocused } from '../ui/keyboardFocus';
import type { CustomSpriteDefinition } from '../customSprites/model';
import type {
  CourseEditorSceneData,
  CourseEditedRoomData,
  EditorSceneData,
  OverworldPlaySceneData,
} from './sceneData';
import { EditorUiBridge } from './editor/uiBridge';
import { EditorRoomSession } from './editor/roomSession';
import { EditorBackgroundController } from './editor/backgrounds';
import { EditorEditRuntime, type GoalPlacementMode } from './editor/editRuntime';
import { EditorSceneFlowController } from './editor/flow';
import { EditorInspectorController } from './editor/inspector';
import { EditorInteractionController } from './editor/interaction';
import { GuestBuilderActivityTracker } from './editor/guestBuilderActivityTracker';
import { EditorMusicPatternController } from './editor/musicPatternEditor';
import {
  type EditorMusicComposerMode,
} from './editor/musicUi';
import {
  EditorMusicWorkflowCoordinator,
  type EditorMusicPhraseSaveOptions,
  type EditorMusicPreviewState,
} from './editor/musicWorkflow';
import { EditorPresenceController } from './editor/presence';
import { EditorPersistenceController } from './editor/persistence';
import { EditorToolController } from './editor/tools';
import { EditorCourseController } from './editor/courseController';
import { EditorOverlayController } from './editor/overlays';
import { EditorChromeController } from './editor/chrome';
import { RoomLightingController } from '../lighting/controller';
import {
  extractRoomStaticLightingEmitters,
  type RoomStaticLightingEmitters,
} from '../lighting/emissiveSources';
import {
  cloneRoomLightingSettings,
  type RoomLightingEmitter,
  type RoomLightingSettings,
} from '../lighting/model';
import { resolvePlayerAuraDarkAuraDiameter } from '../lighting/presets';
import { RoomWeatherController } from '../weather/controller';
import {
  cloneRoomWeatherSettings,
  type RoomWeatherSettings,
} from '../weather/model';
import { buildRoomWeatherSurfaceSegments } from '../weather/surfaces';
import type { EditorCourseUiState } from '../ui/setup/sceneBridge';

const EDITOR_NEIGHBOR_RADIUS = 1;
type EditorMarkerPlacementMode = Exclude<GoalPlacementMode, null> | 'start';

export class EditorScene extends Phaser.Scene {
  private uiBridge: EditorUiBridge | null = null;
  private roomEditCount = 0;
  private readonly musicWorkflow: EditorMusicWorkflowCoordinator;

  // Tilemap
  private map!: Phaser.Tilemaps.Tilemap;
  private tilesets: Map<string, Phaser.Tilemaps.Tileset> = new Map();
  private layers: Map<string, Phaser.Tilemaps.TilemapLayer> = new Map();

  // Single-room persistence (local-first, ready for a remote adapter later)
  private readonly editRuntime: EditorEditRuntime;
  private readonly guestBuilderActivityTracker: GuestBuilderActivityTracker;
  private readonly roomSession: EditorRoomSession;
  private readonly worldRepository = createWorldRepository();
  private readonly backgroundController: EditorBackgroundController;
  private readonly courseController: EditorCourseController;
  private readonly flowController: EditorSceneFlowController;
  private readonly inspectorController: EditorInspectorController;
  private readonly interactionController: EditorInteractionController;
  private readonly musicPatternController: EditorMusicPatternController;
  private readonly overlayController: EditorOverlayController;
  private readonly presenceController: EditorPresenceController;
  private readonly persistenceController: EditorPersistenceController;
  private readonly toolController: EditorToolController;
  private readonly chromeController: EditorChromeController;
  private readonly lightingController: RoomLightingController;
  private readonly weatherController: RoomWeatherController;
  private lightingPreviewStaticEmitters: RoomStaticLightingEmitters = {
    emitters: [],
    objectCount: 0,
    tileCount: 0,
  };
  private lightingPreviewCacheKey = '';
  private entrySource: 'world' | 'direct' = 'direct';
  private initialRoomSnapshot: RoomSnapshot | null = null;
  private forceInitialRoomSnapshot = false;
  private readonly handleWake = (): void => {
    setAppMode('editor');
    delete document.body.dataset.editorCourseMode;
    editorState.isPlaying = false;
    this.presenceController.sync();
    this.updateBottomBar();
    this.updateGoalUi();
  };

  private get musicModeActive(): boolean {
    return this.musicWorkflow.isActive();
  }

  private get musicComposerMode(): EditorMusicComposerMode {
    return this.musicWorkflow.getComposerMode();
  }

  private get musicPreviewState(): EditorMusicPreviewState {
    return this.musicWorkflow.getPreviewState();
  }
  private readonly handleCanvasContextMenu = (event: Event): void => {
    event.preventDefault();
  };
  private readonly handleResize = (): void => {
    this.interactionController.handleViewportResize();
    this.updateBackgroundPreview();
    this.updateZoomUI();
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
        this.toolController.redo();
      } else {
        this.toolController.undo();
      }
      return;
    }

    if (isTextInputFocused()) {
      return;
    }

    if (key === 'escape') {
      event.preventDefault();
      event.stopPropagation();
      if (this.musicModeActive) {
        if (this.musicPatternController.isPastePreviewActive()) {
          this.musicPatternController.cancelPastePreview();
          this.renderEditorUi();
          return;
        }

        this.setMusicModeActive(false);
        return;
      }

      if (this.inspectorController.isConnectingPressurePlate()) {
        this.cancelPressurePlateConnection();
        return;
      }

      if (this.toolController.isClipboardPastePreviewActive()) {
        this.toolController.cancelClipboardPastePreview();
        return;
      }

      if (this.inspectorController.hasPinnedInspector()) {
        this.inspectorController.clearPinnedSelection();
        return;
      }

      if (this.getCourseEditorState().canReturnToCourseBuilder) {
        void this.returnToCourseBuilder();
      } else {
        void this.returnToWorld();
      }
      return;
    }

    if (this.musicModeActive && this.musicComposerMode === 'sequencer' && primaryModifier && key === 'v') {
      event.preventDefault();
      event.stopPropagation();
      this.musicPatternController.beginPastePreview();
      this.renderEditorUi();
      return;
    }

    if (primaryModifier && key === 's') {
      event.preventDefault();
      event.stopPropagation();
      if (this.musicModeActive) {
        void this.saveRoomMusicDraftAndPhrases();
      } else {
        void this.saveDraft(true, { promptForSignInOnUnauthorized: true });
      }
      return;
    }

    if (primaryModifier && event.shiftKey && key === 'p') {
      event.preventDefault();
      event.stopPropagation();
      void this.publishRoom();
      return;
    }

    if (primaryModifier && key === 'v') {
      if (!this.editRuntime.hasClipboardTiles() || editorState.paletteMode !== 'tiles') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.toolController.beginClipboardPastePreview();
      return;
    }

    if (primaryModifier && key === 'c' && editorState.paletteMode === 'tiles' && editorState.activeTool === 'copy') {
      if (!this.toolController.repeatLastCopySelection()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (event.code === 'Digit1') {
      event.preventDefault();
      this.toolController.selectTool('pencil');
      return;
    }

    if (event.code === 'Digit2') {
      event.preventDefault();
      this.toolController.selectTool('eraser');
      return;
    }

    if (event.code === 'Digit3') {
      event.preventDefault();
      this.toolController.selectTool('copy');
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      void this.startPlayMode();
      return;
    }

    if (this.musicModeActive && event.code === 'Space') {
      event.preventDefault();
      event.stopPropagation();
      this.toggleRoomMusicPreview();
    }
  };
  private readonly handleShutdown = (): void => {
    this.events.off('wake', this.handleWake, this);
    this.scale.off('resize', this.handleResize, this);
    this.input.removeAllListeners();
    this.input.keyboard?.removeAllListeners();
    this.game.canvas.removeEventListener('contextmenu', this.handleCanvasContextMenu);
    this.inspectorController.reset();
    globalRoomMusicController.stopArrangement({
      transition: 'immediate',
      fadeDurationSec: 0.08,
      mode: 'idle',
      resetTransport: true,
    });
    this.uiBridge?.destroy();
    this.uiBridge = null;
    this.musicPatternController.destroy();
    this.presenceController.destroy();
    this.resetRuntimeState();
  };

  constructor() {
    super({ key: 'EditorScene' });
    this.musicWorkflow = new EditorMusicWorkflowCoordinator({
      commitRoomMusic: (nextMusic) => this.editRuntime.setRoomMusic(nextMusic),
      getCurrentUserId: () => getAuthDebugState().user?.id ?? null,
      getPublishValidationError: () => this.editRuntime.getPublishValidationError(),
      getRoomMusic: () => this.roomMusic,
      getRoomPermissions: () => this.roomPermissions,
      getRoomVersion: () => this.roomVersion,
      getSaveInFlight: () => this.saveInFlight,
      getSummaryScope: () => ({ kind: 'room' }),
      onMusicModeToolActivated: () => this.toolController.updateToolUi(),
      replaceLegacyRoomMusicWithPattern: () => this.editRuntime.replaceRoomMusicWithPattern(),
      requestRender: () => this.renderEditorUi(),
      saveDraft: (force = false, options) => this.saveDraft(force, options),
      updatePersistenceStatus: (text) => this.updatePersistenceStatus(text),
    });
    this.guestBuilderActivityTracker = new GuestBuilderActivityTracker({
      getRoomId: () => this.roomId,
      getRoomCoordinates: () => ({ ...this.roomCoordinates }),
      getRoomTitle: () => this.roomTitle,
    });
    this.editRuntime = new EditorEditRuntime(this, {
      getLayers: () => this.layers,
      getTilemap: () => this.map,
      getRoomSnapshotMetadata: () => ({
        roomId: this.roomId,
        coordinates: this.roomCoordinates,
        title: this.roomTitle,
        version: this.roomVersion,
        createdAt: this.roomCreatedAt,
        updatedAt: this.roomUpdatedAt,
        publishedAt: this.roomPublishedAt,
      }),
      getRoomOrigin: () => ({ x: 0, y: 0 }),
      getSelectedBackground: () => editorState.selectedBackground,
      setSelectedBackground: (backgroundId) => {
        editorState.selectedBackground = backgroundId;
        editorState.selectedSolidBackgroundColor = getSolidColorFromBackgroundValue(
          backgroundId,
          editorState.selectedSolidBackgroundColor,
        );
      },
      getSelectedLightingSettings: () => this.getSelectedLightingSettings(),
      setSelectedLightingSettings: (lighting) => {
        this.setSelectedLightingSettings(lighting);
      },
      getSelectedWeatherSettings: () => this.getSelectedWeatherSettings(),
      setSelectedWeatherSettings: (weather) => {
        this.setSelectedWeatherSettings(weather);
      },
      getPlacedObjects: () => editorState.placedObjects,
      setPlacedObjects: (placedObjects) => {
        editorState.placedObjects = placedObjects;
      },
      updateBackgroundSelectValue: () => {},
      updateLightingControlsValue: (lighting) => {
        this.syncLightingControls(lighting);
      },
      updateWeatherControlsValue: (weather) => {
        this.syncWeatherControls(weather);
      },
      updateBackground: () => this.updateBackground(),
      updateGoalUi: () => this.updateGoalUi(),
      syncBackgroundCameraIgnores: () => this.syncBackgroundCameraIgnores(),
      updatePersistenceStatus: (text) => this.updatePersistenceStatus(text),
      canSaveDraft: () => this.roomPermissions.canSaveDraft,
      recordBuildPlacement: (count) => this.guestBuilderActivityTracker.recordPlacedBuildContent(count),
    });
    this.roomSession = new EditorRoomSession(createRoomRepository(), {
      applyRoomSnapshot: (room) => {
        this.applyRoomSnapshot(room);
      },
      exportRoomSnapshot: () => this.exportRoomSnapshot(),
      getPublishValidationError: () => this.editRuntime.getPublishValidationError(),
      getRoomDirty: () => this.roomDirty,
      setRoomDirty: (dirty) => {
        this.roomDirty = dirty;
      },
      getLastDirtyAt: () => this.lastDirtyAt,
      refreshUi: () => {
        this.renderEditorUi();
      },
      refreshSurroundingRoomPreviews: () => {
        void this.refreshSurroundingRoomPreviews();
      },
    });
    this.persistenceController = new EditorPersistenceController(this.roomSession, {
      getRoomPermissions: () => this.roomPermissions,
      getRoomTitle: () => this.roomTitle,
      setRoomTitle: (title) => {
        this.roomTitle = title;
      },
      getRoomDirty: () => this.roomDirty,
      setRoomDirty: (dirty) => {
        this.roomDirty = dirty;
      },
      getLastDirtyAt: () => this.lastDirtyAt,
      setLastDirtyAt: (value) => {
        this.lastDirtyAt = value;
      },
      getInitialRoomSnapshot: () => this.initialRoomSnapshot ? cloneRoomSnapshot(this.initialRoomSnapshot) : null,
      syncActiveCourseRoomSessionSnapshot: (room, options) => {
        this.syncActiveCourseRoomSessionSnapshot(room, options);
      },
      onRoomMarkedDirty: () => {
        this.roomEditCount += 1;
        this.presenceController.markConstructionPreviewDirty();
        this.flowController.maybeTriggerPublishNudge();
      },
    });
    this.toolController = new EditorToolController(
      this,
      this.editRuntime,
      this.persistenceController,
      {
        startRectDrawing: (tileX, tileY) => this.interactionController.startRectDrawing(tileX, tileY),
        clearShapePreview: () => this.interactionController.clearShapePreview(),
        clearCoursePlacementMode: () => this.courseController.clearPlacementMode(),
        renderUi: () => this.renderEditorUi(),
      },
    );
    this.courseController = new EditorCourseController(this, {
      getRoomId: () => this.roomId,
      syncBackgroundCameraIgnores: () => this.syncBackgroundCameraIgnores(),
      updateGoalUi: () => this.updateGoalUi(),
      clearRoomGoalPlacementMode: () => {
        this.editRuntime.currentGoalPlacementMode = null;
      },
    });
    this.flowController = new EditorSceneFlowController(this.roomSession, {
      cancelClipboardPastePreview: () => this.toolController.cancelClipboardPastePreview(),
      getSelectedCoursePreviewForPlay: () => this.getSelectedCoursePreviewForPlay(),
      getRoomPermissions: () => this.roomPermissions,
      saveDraft: (force = false) => this.saveDraft(force),
      exportRoomSnapshot: () => this.exportRoomSnapshot(),
      getRoomDirty: () => this.roomDirty,
      getPublishedVersion: () => this.publishedVersion,
      getRoomCoordinates: () => ({ ...this.roomCoordinates }),
      buildCourseEditedRoomData: () => this.buildCourseEditedRoomData(),
      syncActiveCourseRoomSessionSnapshot: (room, options) => {
        this.syncActiveCourseRoomSessionSnapshot(room, options);
      },
      hideObjectInspectorUi: () => this.hideObjectInspectorUi(),
      clearEditorPresence: () => this.presenceController.clear(),
      sleepEditorScene: () => this.scene.sleep(),
      stopEditorScene: () => this.scene.stop(),
      wakeOverworld: (data) => this.scene.wake('OverworldPlayScene', data),
      wakeCourseComposer: (data) => this.scene.wake('CourseComposerScene', data),
      updateBottomBar: () => this.updateBottomBar(),
      hasActiveCourseEdit: () => this.courseController.hasActiveCourseEdit(),
      canReturnToCourseBuilder: () => this.courseController.getCourseEditorState().canReturnToCourseBuilder,
      shouldReturnToCourseEditor: () => this.shouldReturnToCourseEditor(),
      buildCourseEditorWakeData: (wakeData) => this.buildCourseEditorWakeData(wakeData),
      setCourseEditorStatusText: (text) => this.courseController.setStatusText(text),
      updateGoalUi: () => this.updateGoalUi(),
      getPersistenceStatusText: () => this.persistenceController.statusText,
      getMintedTokenId: () => this.mintedTokenId,
      getRoomEditCount: () => this.roomEditCount,
      publishRoom: () => this.publishRoom(),
    });
    this.inspectorController = new EditorInspectorController(
      this,
      this.editRuntime,
      (state) => this.uiBridge?.renderInspector(state),
    );
    this.chromeController = new EditorChromeController(
      this.editRuntime,
      this.flowController,
      this.persistenceController,
      this.toolController,
      this.inspectorController,
      this.courseController,
      {
        getUiBridge: () => this.uiBridge,
        getRoomTitle: () => this.roomTitle,
        getRoomCoordinates: () => ({ ...this.roomCoordinates }),
        getRoomGoal: () => this.roomGoal,
        getRoomPermissions: () => this.roomPermissions,
        getMintedTokenId: () => this.mintedTokenId,
        getRoomVersionHistory: () => this.roomVersionHistory,
        getPublishedVersion: () => this.publishedVersion,
        getEntrySource: () => this.entrySource,
        getCourseEditorState: () => this.courseController.getCourseEditorState(),
        getSaveInFlight: () => this.saveInFlight,
      },
    );
    this.presenceController = new EditorPresenceController({
      getRoomCoordinates: () => ({ ...this.roomCoordinates }),
      getEntrySource: () => this.entrySource,
      getPublishedVersion: () => this.publishedVersion,
      exportRoomSnapshot: () => this.exportRoomSnapshot(),
      isPlaying: () => editorState.isPlaying,
      isSceneActive: () => this.scene.isActive(this.scene.key),
    });
    this.interactionController = new EditorInteractionController(this, {
      getNeighborRadius: () => EDITOR_NEIGHBOR_RADIUS,
      getGoalPlacementMode: () => this.goalPlacementMode as GoalPlacementMode,
      isMusicModeActive: () => this.musicModeActive,
      handleMusicPointerDown: (pointer) => this.handleMusicPointerDown(pointer),
      handleMusicPointerMove: (pointer) => this.handleMusicPointerMove(pointer),
      handleMusicPointerUp: (pointer) => this.handleMusicPointerUp(pointer),
      updateMusicCursorHighlight: (graphics) => this.updateMusicCursorHighlight(graphics),
      handleObjectModePrimaryAction: (pointer) => this.handleObjectModePrimaryAction(pointer),
      handleObjectModeSecondaryAction: (worldX, worldY) =>
        this.handleObjectModeSecondaryAction(worldX, worldY),
      handleObjectPlace: (pointer) => this.handleObjectPlace(pointer),
      handleToolDown: (pointer) => this.toolController.handleToolDown(pointer),
      removeGoalMarkerAt: (worldX, worldY) => this.removeGoalMarkerAt(worldX, worldY),
      removeObjectAt: (worldX, worldY) => this.removeObjectAt(worldX, worldY),
      placeGoalMarker: (tileX, tileY) => this.placeGoalMarker(tileX, tileY),
      placeTileAt: (worldX, worldY) => this.editRuntime.placeTileAt(worldX, worldY),
      eraseTileAt: (worldX, worldY) => this.editRuntime.eraseTileAt(worldX, worldY),
      fillRect: (x1, y1, x2, y2) => this.editRuntime.fillRect(x1, y1, x2, y2),
      captureCopySelection: (x1, y1, x2, y2) => this.toolController.captureCopySelection(x1, y1, x2, y2),
      getClipboardPreview: () => this.toolController.getClipboardPreview(),
      isClipboardPastePreviewActive: () => this.toolController.isClipboardPastePreviewActive(),
      pasteClipboardAt: (tileX, tileY) => this.toolController.pasteClipboardAt(tileX, tileY),
      cancelClipboardPastePreview: () => this.toolController.cancelClipboardPastePreview(),
      beginTileBatch: () => this.editRuntime.beginTileBatch(),
      commitTileBatch: () => this.editRuntime.commitTileBatch(),
      startPlayMode: () => this.startPlayMode(),
      updateToolUi: () => this.toolController.updateToolUi(),
      updateBackgroundPreview: () => this.updateBackgroundPreview(),
      updateZoomUI: () => this.updateZoomUI(),
    });
    this.musicPatternController = new EditorMusicPatternController(this, {
      getRoomMusic: () => this.roomMusic,
      commitRoomMusic: (nextMusic) => this.musicWorkflow.commitRoomMusic(nextMusic),
      replaceLegacyRoomMusicWithPattern: () => this.musicWorkflow.commitLegacyRoomMusicPatternReplacement(),
      renderUi: () => this.renderEditorUi(),
      getMusicPlaybackDebugState: () => globalRoomMusicController.getDebugState(),
      getMusicPreviewState: () => this.musicWorkflow.getPreviewState(),
      previewPatternCell: (pattern, instrumentId, row) =>
        globalRoomMusicController.previewPatternCell(pattern, instrumentId, row),
    });
    this.musicWorkflow.attachPatternController(this.musicPatternController);
    this.overlayController = new EditorOverlayController(this, {
      getLayers: () => this.layers,
      getPlacedObjects: () => editorState.placedObjects,
      isClipboardPastePreviewActive: () => this.toolController.isClipboardPastePreviewActive(),
    });
    this.backgroundController = new EditorBackgroundController(this, this.worldRepository, {
      getRoomId: () => this.roomId,
      getRoomCoordinates: () => this.roomCoordinates,
      getIgnoredBackgroundObjects: () => {
        const ignored: Phaser.GameObjects.GameObject[] = [];

        for (const layerName of LAYER_NAMES) {
          const tilemapLayer = this.map?.getLayer(layerName);
          if (tilemapLayer?.tilemapLayer) {
            ignored.push(tilemapLayer.tilemapLayer);
          }
        }

        ignored.push(...this.objectSprites);
        if (this.spawnMarkerSprite) {
          ignored.push(this.spawnMarkerSprite);
        }
        ignored.push(...this.goalMarkerSprites);
        ignored.push(...this.goalMarkerLabels);

        const overlays = [
          this.overlayController.gridOverlay,
          this.overlayController.layerGuideOverlay,
          this.interactionController.cursorOverlay,
          this.interactionController.rectPreviewOverlay,
          this.overlayController.borderOverlay,
        ];
        for (const overlay of overlays) {
          if (overlay) {
            ignored.push(overlay);
          }
        }

        ignored.push(...this.lightingController.getBackdropIgnoredObjects());
        ignored.push(...this.weatherController.getBackdropIgnoredObjects());
        ignored.push(...this.musicPatternController.getIgnoredObjects());

        return ignored;
      },
      isSceneActive: () => this.scene.isActive(this.scene.key),
    });
    this.lightingController = new RoomLightingController({
      scene: this,
      overlayDepth: 80,
    });
    this.weatherController = new RoomWeatherController({
      scene: this,
      depth: 76,
    });
  }

  private get objectSprites(): Phaser.GameObjects.Sprite[] {
    return this.editRuntime.placedObjectSprites;
  }

  private get spawnMarkerSprite(): Phaser.GameObjects.Sprite | null {
    return this.editRuntime.currentSpawnMarkerSprite;
  }

  private get goalMarkerSprites(): Phaser.GameObjects.Sprite[] {
    return [...this.editRuntime.currentGoalMarkerSprites, ...this.courseController.getMarkerSprites()];
  }

  private get goalMarkerLabels(): Phaser.GameObjects.Text[] {
    return [...this.editRuntime.currentGoalMarkerLabels, ...this.courseController.getMarkerLabels()];
  }

  private get roomId(): string {
    return this.roomSession.currentRoomId;
  }

  private set roomId(value: string) {
    this.roomSession.currentRoomId = value;
  }

  private get roomCoordinates(): RoomCoordinates {
    return this.roomSession.currentRoomCoordinates;
  }

  private set roomCoordinates(value: RoomCoordinates) {
    this.roomSession.currentRoomCoordinates = value;
  }

  private get roomVersion(): number {
    return this.roomSession.currentRoomVersion;
  }

  private get roomTitle(): string | null {
    return this.roomSession.currentRoomTitle;
  }

  private set roomTitle(value: string | null) {
    this.roomSession.currentRoomTitle = value;
  }

  private get publishedVersion(): number {
    return this.roomSession.currentPublishedVersion;
  }

  private get roomCreatedAt(): string {
    return this.roomSession.currentRoomCreatedAt;
  }

  private get roomUpdatedAt(): string {
    return this.roomSession.currentRoomUpdatedAt;
  }

  private get roomPublishedAt(): string | null {
    return this.roomSession.currentRoomPublishedAt;
  }

  private get roomPermissions(): RoomPermissions {
    return this.roomSession.currentRoomPermissions;
  }

  private get roomVersionHistory(): RoomVersionRecord[] {
    return this.roomSession.currentRoomVersionHistory;
  }

  private get claimerDisplayName(): string | null {
    return this.roomSession.currentClaimerDisplayName;
  }

  private get mintedChainId(): number | null {
    return this.roomSession.currentMintedChainId;
  }

  private get mintedContractAddress(): string | null {
    return this.roomSession.currentMintedContractAddress;
  }

  private get mintedTokenId(): string | null {
    return this.roomSession.currentMintedTokenId;
  }

  private get mintedOwnerWalletAddress(): string | null {
    return this.roomSession.currentMintedOwnerWalletAddress;
  }

  private get mintedOwnerSyncedAt(): string | null {
    return this.roomSession.currentMintedOwnerSyncedAt;
  }

  private get saveInFlight(): boolean {
    return this.roomSession.isSaveInFlight;
  }

  private get roomGoal(): RoomGoal | null {
    return this.editRuntime.currentRoomGoal;
  }

  private get roomSpawnPoint(): RoomSpawnPoint | null {
    return this.editRuntime.currentRoomSpawnPoint;
  }

  private get roomMusic(): RoomMusic | null {
    return this.editRuntime.currentRoomMusic;
  }

  private get roomDirty(): boolean {
    return this.editRuntime.isRoomDirty;
  }

  private set roomDirty(value: boolean) {
    this.editRuntime.isRoomDirty = value;
  }

  private get lastDirtyAt(): number {
    return this.editRuntime.currentLastDirtyAt;
  }

  private set lastDirtyAt(value: number) {
    this.editRuntime.currentLastDirtyAt = value;
  }

  private get goalPlacementMode(): EditorMarkerPlacementMode {
    return this.courseController.getGoalPlacementMode() ?? (this.editRuntime.currentGoalPlacementMode as EditorMarkerPlacementMode);
  }

  private buildCourseEditedRoomData(): CourseEditedRoomData | null {
    return this.courseController.buildCourseEditedRoomData();
  }

  private syncActiveCourseRoomSessionSnapshot(
    room: RoomSnapshot,
    options: { published: boolean }
  ): void {
    this.courseController.syncActiveCourseRoomSessionSnapshot(room, options);
  }

  getCourseEditorState(): EditorCourseUiState {
    return this.courseController.getCourseEditorState();
  }

  create(data?: EditorSceneData): void {
    this.resetRuntimeState();

    this.initialRoomSnapshot = data?.roomSnapshot ? cloneRoomSnapshot(data.roomSnapshot) : null;
    this.forceInitialRoomSnapshot = data?.forceRoomSnapshot === true;
    this.courseController.initialize(data?.courseEdit ?? null);

    if (this.initialRoomSnapshot) {
      this.roomCoordinates = { ...this.initialRoomSnapshot.coordinates };
      this.roomId = this.initialRoomSnapshot.id;
    } else if (data?.roomCoordinates) {
      this.roomCoordinates = { ...data.roomCoordinates };
      this.roomId = roomIdFromCoordinates(this.roomCoordinates);
    } else {
      this.roomCoordinates = { ...DEFAULT_ROOM_COORDINATES };
      this.roomId = DEFAULT_ROOM_ID;
    }
    this.entrySource = data?.source ?? 'direct';
    setAppMode('editor');
    delete document.body.dataset.editorCourseMode;
    this.uiBridge = new EditorUiBridge({
      onRequestRender: () => this.renderEditorUi(),
      onDocumentKeyDown: this.handleDocumentKeyDown,
      onAuthStateChanged: () => {
        this.presenceController.refreshIdentity();
        this.renderEditorUi();
      },
      onBack: () => this.handleEditorBackAction(),
      onStartPlayMode: () => this.startPlayMode(),
      onSaveDraft: async () => {
        await this.saveDraft(true, { promptForSignInOnUnauthorized: true });
      },
      onPublishRoom: async () => {
        await this.publishRoom();
      },
      onPublishNudge: () => this.handlePublishNudgeAction(),
      onMintRoom: async () => {
        await this.persistenceController.mintRoom();
      },
      onRefreshMintMetadata: async () => {
        await this.persistenceController.refreshMintMetadata();
      },
      onFitToScreen: () => this.fitToScreen(),
      onZoomIn: () => this.zoomIn(),
      onZoomOut: () => this.zoomOut(),
      onSetRoomTitle: (title) => this.persistenceController.setRoomTitle(title),
      onSelectTool: (tool) => this.toolController.selectTool(tool),
      onClearCurrentLayer: () => this.toolController.clearCurrentLayer(),
      onClearAllTiles: () => this.toolController.clearAllTiles(),
      onClearAllObjects: () => this.toolController.clearAllObjects(),
      onSelectBackground: () => this.applySelectedBackground(),
      onSelectLighting: (mode) => this.applySelectedLightingMode(mode),
      onSetLightingDarkness: (darkness) => this.applySelectedLightingDarkness(darkness),
      onSetLightingRadius: (radius) => this.applySelectedLightingRadius(radius),
      onSelectWeather: (mode) => this.applySelectedWeatherMode(mode),
      onSetWeatherIntensity: (intensity) => this.applySelectedWeatherIntensity(intensity),
      onSetGoalType: (nextType) => this.toolController.setGoalType(nextType),
      onSetGoalTimeLimitSeconds: (seconds) => this.toolController.setGoalTimeLimitSeconds(seconds),
      onSetGoalRequiredCount: (requiredCount) => this.toolController.setGoalRequiredCount(requiredCount),
      onSetGoalSurvivalSeconds: (seconds) => this.toolController.setGoalSurvivalSeconds(seconds),
      onSetNpcQuestType: (questType) => this.toolController.setNpcQuestType(questType),
      onSetGoalIntroText: (text) => this.toolController.setGoalIntroText(text),
      onStartGoalMarkerPlacement: (mode) => this.toolController.startGoalMarkerPlacement(mode),
      onClearGoalMarkers: () => this.toolController.clearGoalMarkers(),
      onSetCourseGoalType: (goalType) => this.setCourseGoalType(goalType),
      onSetCourseGoalTimeLimitSeconds: (seconds) => this.setCourseGoalTimeLimitSeconds(seconds),
      onSetCourseGoalRequiredCount: (requiredCount) => this.setCourseGoalRequiredCount(requiredCount),
      onSetCourseGoalSurvivalSeconds: (seconds) => this.setCourseGoalSurvivalSeconds(seconds),
      onStartCourseGoalMarkerPlacement: (mode) => this.startCourseGoalMarkerPlacement(mode),
      onClearCourseGoalMarkers: () => this.clearCourseGoalMarkers(),
      onBeginPressurePlateConnection: () => this.beginFocusedPressurePlateConnection(),
      onClearPressurePlateConnection: () => this.clearFocusedPressurePlateConnection(),
      onCancelPressurePlateConnection: () => this.cancelPressurePlateConnection(),
      onClearContainerContents: () => this.clearFocusedContainerContents(),
      onSetFocusedSwordsmanObjectiveMode: (objectiveMode) =>
        this.inspectorController.setFocusedSwordsmanObjectiveMode(objectiveMode),
      onSetFocusedSwordsmanDefeatMode: (defeatMode) =>
        this.inspectorController.setFocusedSwordsmanDefeatMode(defeatMode),
      onSetFocusedNpcMode: (mode) =>
        this.inspectorController.setFocusedNpcMode(mode),
      onSetFocusedNpcPushable: (pushable) =>
        this.inspectorController.setFocusedNpcPushable(pushable),
      onSetFocusedNpcCanJumpFall: (canJumpFall) =>
        this.inspectorController.setFocusedNpcCanJumpFall(canJumpFall),
      onSetFocusedNpcPlayerCollision: (playerCollision) =>
        this.inspectorController.setFocusedNpcPlayerCollision(playerCollision),
      onSetFocusedNpcFriendlyFire: (friendlyFire) =>
        this.inspectorController.setFocusedNpcFriendlyFire(friendlyFire),
      onSetFocusedNpcName: (name) =>
        this.inspectorController.setFocusedNpcName(name),
      onSetFocusedNpcDialogue: (text) =>
        this.inspectorController.setFocusedNpcDialogue(text),
      onSetFocusedNpcDefeatMode: (defeatMode) =>
        this.inspectorController.setFocusedNpcDefeatMode(defeatMode),
    });

    this.createBackground();
    this.createTilemap();
    this.createCursorOverlay();
    this.musicPatternController.create();
    this.overlayController.createOverlays();
    this.setupCamera();
    this.setupInput();
    this.setupKeyboard();
    this.rebuildObjectSprites();
    this.syncBackgroundCameraIgnores();
    this.updateBackgroundPreview();
    this.updateLightingPreview();
    this.updateWeatherPreview();
    this.renderMusicUi();

    this.events.on('wake', this.handleWake, this);
    this.scale.on('resize', this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);

    if (this.initialRoomSnapshot) {
      const editableSnapshot = cloneRoomSnapshot(this.initialRoomSnapshot);
      editableSnapshot.status = 'draft';
      this.applyRoomSnapshot(editableSnapshot);
      this.updatePersistenceStatus('Loading room...');
    }

    void this.loadPersistedRoom();
    this.presenceController.initialize();
    this.updateBottomBar();
    this.updateGoalUi();
  }

  update(time: number): void {
    this.maybeAutoSave(time);
    this.presenceController.sync();
    this.updateBackgroundPreview();
    this.updateLightingPreview();
    this.updateWeatherPreview();
    this.updateCursorHighlight();
    this.overlayController.updateLayerGuideOverlay();
    this.overlayController.updatePressurePlateOverlay((graphics) => {
      this.inspectorController.updatePressurePlateOverlay(graphics);
    });
    this.overlayController.updateContainerOverlay((graphics) => {
      this.inspectorController.updateContainerOverlay(graphics);
    });
    this.overlayController.updateLayerIndicator();
    this.musicPatternController.updateOverlay(this.musicModeActive && this.musicComposerMode === 'sequencer');
  }

  // ══════════════════════════════════════
  // BACKGROUND
  // ══════════════════════════════════════

  private createBackground(): void {
    this.backgroundController.createBackground(editorState.selectedBackground);
  }

  private resetRuntimeState(): void {
    this.lightingController.reset();
    this.weatherController.reset();
    this.lightingPreviewStaticEmitters = {
      emitters: [],
      objectCount: 0,
      tileCount: 0,
    };
    this.lightingPreviewCacheKey = '';
    this.backgroundController.reset();
    this.interactionController.reset();
    this.overlayController.reset();
    this.tilesets = new Map();
    this.layers = new Map();
    this.editRuntime.reset();
    this.musicPatternController.reset();
    this.flowController.reset();
    this.inspectorController.reset();
    this.courseController.reset();
    this.roomSession.reset();
    this.toolController.reset();
    this.guestBuilderActivityTracker.reset();
    this.roomEditCount = 0;
    editorState.tileFlipX = false;
    editorState.tileFlipY = false;
    this.setSelectedLightingSettings(null);
    this.setSelectedWeatherSettings(null);
    editorState.isPlaying = false;
    this.musicWorkflow.resetForRuntimeClear();
    globalRoomMusicController.stopPreviewClip();
    document.body.dataset.editorMusicMode = 'false';
    document.body.dataset.editorMusicUiLocked = 'false';
    this.uiBridge?.notifyEditorStateChanged();
  }

  updateBackground(): void {
    this.backgroundController.updateBackground(editorState.selectedBackground);
  }

  private applySelectedBackground(): void {
    this.updateBackground();
    this.persistenceController.markRoomDirty();
    this.renderEditorUi();
  }

  private getSelectedLightingSettings(): RoomLightingSettings {
    return cloneRoomLightingSettings({
      mode: editorState.selectedLightingMode,
      darkness: editorState.selectedLightingDarkness,
      radius: editorState.selectedLightingRadius,
    });
  }

  private setSelectedLightingSettings(lighting: RoomLightingSettings | null | undefined): void {
    const normalized = cloneRoomLightingSettings(lighting);
    editorState.selectedLightingMode = normalized.mode;
    editorState.selectedLightingDarkness = normalized.darkness;
    editorState.selectedLightingRadius = normalized.radius;
  }

  private syncLightingControls(lighting: RoomLightingSettings | null | undefined): void {
    const normalized = cloneRoomLightingSettings(lighting);
    const lightingSelect = document.getElementById(
      'lighting-mode-select'
    ) as HTMLSelectElement | null;
    const darknessRange = document.getElementById(
      'lighting-darkness-range'
    ) as HTMLInputElement | null;
    const radiusRange = document.getElementById(
      'lighting-radius-range'
    ) as HTMLInputElement | null;
    if (lightingSelect) {
      lightingSelect.value = normalized.mode;
    }
    if (darknessRange) {
      darknessRange.value = String(normalized.darkness);
    }
    if (radiusRange) {
      radiusRange.value = String(normalized.radius);
    }
  }

  private getSelectedWeatherSettings(): RoomWeatherSettings {
    return cloneRoomWeatherSettings({
      mode: editorState.selectedWeatherMode,
      intensity: editorState.selectedWeatherIntensity,
    });
  }

  private setSelectedWeatherSettings(weather: RoomWeatherSettings | null | undefined): void {
    const normalized = cloneRoomWeatherSettings(weather);
    editorState.selectedWeatherMode = normalized.mode;
    editorState.selectedWeatherIntensity = normalized.intensity;
  }

  private syncWeatherControls(weather: RoomWeatherSettings | null | undefined): void {
    const normalized = cloneRoomWeatherSettings(weather);
    const weatherSelect = document.getElementById(
      'weather-mode-select'
    ) as HTMLSelectElement | null;
    const intensityRange = document.getElementById(
      'weather-intensity-range'
    ) as HTMLInputElement | null;
    if (weatherSelect) {
      weatherSelect.value = normalized.mode;
    }
    if (intensityRange) {
      intensityRange.value = String(normalized.intensity);
    }
  }

  private applySelectedLightingMode(mode: RoomSnapshot['lighting']['mode']): void {
    editorState.selectedLightingMode = mode;
    this.updateLightingPreview();
    this.persistenceController.markRoomDirty();
    this.renderEditorUi();
  }

  private applySelectedLightingDarkness(darkness: number): void {
    editorState.selectedLightingDarkness = darkness;
    this.updateLightingPreview();
    this.persistenceController.markRoomDirty();
    this.renderEditorUi();
  }

  private applySelectedLightingRadius(radius: number): void {
    editorState.selectedLightingRadius = radius;
    this.updateLightingPreview();
    this.persistenceController.markRoomDirty();
    this.renderEditorUi();
  }

  private applySelectedWeatherMode(mode: RoomSnapshot['weather']['mode']): void {
    editorState.selectedWeatherMode = mode;
    this.updateWeatherPreview();
    this.persistenceController.markRoomDirty();
    this.renderEditorUi();
  }

  private applySelectedWeatherIntensity(intensity: number): void {
    editorState.selectedWeatherIntensity = intensity;
    this.updateWeatherPreview();
    this.persistenceController.markRoomDirty();
    this.renderEditorUi();
  }

  private syncBackgroundCameraIgnores(): void {
    this.backgroundController.syncBackgroundCameraIgnores();
  }

  private updateBackgroundPreview(): void {
    this.backgroundController.updateBackgroundPreview();
  }

  private updateLightingPreview(): void {
    const lighting = this.getSelectedLightingSettings();
    const emitter = this.roomSpawnPoint
      ? {
          x: this.roomSpawnPoint.x,
          y: this.roomSpawnPoint.y,
        }
      : {
          x: ROOM_PX_WIDTH * 0.5,
          y: ROOM_PX_HEIGHT * 0.5,
        };
    const playerRevealRadiusPx = resolvePlayerAuraDarkAuraDiameter(lighting.radius) * 0.5;
    const emitters: RoomLightingEmitter[] = [
      {
        sourceType: 'player',
        x: emitter.x,
        y: emitter.y,
        revealRadiusPx: playerRevealRadiusPx,
      },
      ...this.getLightingPreviewStaticEmitters().emitters,
    ];
    const structureChanged = this.lightingController.sync({
      roomId: this.roomId,
      bounds: {
        x: 0,
        y: 0,
        width: ROOM_PX_WIDTH,
        height: ROOM_PX_HEIGHT,
      },
      lighting,
      emitters,
      debugCounts: {
        playerGhostEmitterCount: 1,
        staticObjectEmitterCount: this.lightingPreviewStaticEmitters.objectCount,
        staticTileEmitterCount: this.lightingPreviewStaticEmitters.tileCount,
      },
    });

    if (structureChanged) {
      this.syncBackgroundCameraIgnores();
    }
  }

  private updateWeatherPreview(): void {
    const weather = this.getSelectedWeatherSettings();
    const weatherRoom = weather.mode === 'rain' ? this.editRuntime.exportRoomSnapshot() : null;
    const structureChanged = this.weatherController.sync({
      roomId: this.roomId,
      bounds: {
        x: 0,
        y: 0,
        width: ROOM_PX_WIDTH,
        height: ROOM_PX_HEIGHT,
      },
      weather,
      surfaces: weatherRoom ? buildRoomWeatherSurfaceSegments(weatherRoom) : [],
    });

    if (structureChanged) {
      this.syncBackgroundCameraIgnores();
    }
  }

  private async refreshSurroundingRoomPreviews(): Promise<void> {
    await this.backgroundController.refreshSurroundingRoomPreviews(EDITOR_NEIGHBOR_RADIUS);
  }

  private getLightingPreviewStaticEmitters(): RoomStaticLightingEmitters {
    const cacheKey = [
      this.roomId,
      this.roomVersion,
      this.roomUpdatedAt,
      this.lastDirtyAt,
    ].join(':');
    if (cacheKey === this.lightingPreviewCacheKey) {
      return this.lightingPreviewStaticEmitters;
    }

    this.lightingPreviewStaticEmitters = extractRoomStaticLightingEmitters(this.exportRoomSnapshot());
    this.lightingPreviewCacheKey = cacheKey;
    return this.lightingPreviewStaticEmitters;
  }

  // ══════════════════════════════════════
  // ROOM PERSISTENCE
  // ══════════════════════════════════════

  private async loadPersistedRoom(): Promise<void> {
    const loaded = await this.roomSession.loadPersistedRoom(this.initialRoomSnapshot, {
      forceInitialRoomSnapshot: this.forceInitialRoomSnapshot,
    });
    if (!loaded) {
      if (this.entrySource === 'world') {
        showBusyError('Failed to load room.', {
          retryHandler: () => {
            showBusyOverlay('Opening editor...', 'Loading room...');
            return this.loadPersistedRoom();
          },
          closeHandler: async () => {
            hideBusyOverlay();
            this.scene.stop();
            if (this.shouldReturnToCourseEditor()) {
              const courseEdit = this.buildCourseEditedRoomData();
              this.scene.wake('CourseComposerScene', {
                courseId: courseEdit?.courseId ?? null,
                selectedCoordinates: { ...this.roomCoordinates },
                centerCoordinates: { ...this.roomCoordinates },
                statusMessage: 'Failed to open room.',
              } satisfies CourseEditorSceneData);
              return;
            }

            this.scene.wake('OverworldPlayScene', {
              centerCoordinates: { ...this.roomCoordinates },
              roomCoordinates: { ...this.roomCoordinates },
              mode: 'browse',
              statusMessage: 'Failed to open room.',
            });
          },
        });
      }
      return;
    }

    if (this.entrySource === 'world' && this.mintedTokenId && !this.roomPermissions.canSaveDraft) {
      this.returnToWorldReadOnly();
      return;
    }

    if (this.entrySource === 'world') {
      hideBusyOverlay();
    }

    this.presenceController.sync();
    this.updateGoalUi();
  }

  private returnToWorldReadOnly(): void {
    this.flowController.returnToWorldReadOnly();
  }

  private applyRoomSnapshot(room: RoomSnapshot): void {
    registerCustomSprites(room.customSprites ?? [], { persist: false });
    this.editRuntime.applyRoomSnapshot(room);
    this.lightingPreviewStaticEmitters = {
      emitters: [],
      objectCount: 0,
      tileCount: 0,
    };
    this.lightingPreviewCacheKey = '';
    this.inspectorController.reset();
    this.inspectorController.handleObjectSpritesRebuilt();
    this.toolController.reset();
    this.updateLightingPreview();
    if (this.musicPreviewState === 'playing') {
      this.syncRoomMusicPreviewPlayback();
    }
    this.renderMusicUi();
  }

  private exportRoomSnapshot(): RoomSnapshot {
    return this.editRuntime.exportRoomSnapshot();
  }

  private maybeAutoSave(_time: number): void {
    this.persistenceController.maybeAutoSave(editorState.isPlaying);
  }

  private updatePersistenceStatus(text: string): void {
    this.persistenceController.setStatusText(text);
  }

  async saveDraft(
    force: boolean = false,
    options?: { promptForSignInOnUnauthorized?: boolean }
  ): Promise<RoomRecord | null> {
    return this.persistenceController.saveDraft(force, options);
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

  async publishRoom(successText?: string): Promise<RoomRecord | null> {
    const record = await this.persistenceController.publishRoom(successText);
    if (record?.published) {
      await this.musicWorkflow.handleRoomPublished();
    }
    return record;
  }

  exportWampOGramRoomSnapshot(): RoomSnapshot {
    return cloneRoomSnapshot(this.exportRoomSnapshot());
  }

  async revertToVersion(targetVersion: number): Promise<RoomRecord | null> {
    return this.persistenceController.revertToVersion(targetVersion);
  }

  async adminRestoreToVersion(targetVersion: number): Promise<RoomRecord | null> {
    return this.persistenceController.adminRestoreToVersion(targetVersion);
  }

  // ══════════════════════════════════════
  // TILEMAP SETUP
  // ══════════════════════════════════════

  private createTilemap(): void {
    this.map = this.make.tilemap({
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      width: ROOM_WIDTH,
      height: ROOM_HEIGHT,
    });

    // Add all tilesets with their firstGid offsets
    for (const ts of TILESETS) {
      const tileset = this.map.addTilesetImage(ts.key, ts.key, TILE_SIZE, TILE_SIZE, 0, 0, ts.firstGid);
      if (tileset) {
        this.tilesets.set(ts.key, tileset);
      }
    }

    const allTilesets = Array.from(this.tilesets.values());

    // Create layers in render order (bottom to top)
    for (const layerName of LAYER_NAMES) {
      const layer = this.map.createBlankLayer(layerName, allTilesets, 0, 0);
      if (layer) {
        this.layers.set(layerName, layer);
        // Foreground renders above player
        if (layerName === 'foreground') {
          layer.setDepth(50);
        } else if (layerName === 'terrain') {
          layer.setDepth(10);
        } else {
          layer.setDepth(1);
        }
      }
    }
  }

  // ══════════════════════════════════════
  // GRID & VISUAL OVERLAYS
  // ══════════════════════════════════════

  private createCursorOverlay(): void {
    this.interactionController.initializeOverlays();
    this.editRuntime.initializeGraphics();
  }

  private updateCursorHighlight(): void {
    this.interactionController.updateCursorHighlight();
  }

  // ══════════════════════════════════════
  // CAMERA
  // ══════════════════════════════════════

  private setupCamera(): void {
    this.interactionController.setupCamera();
  }

  private updateZoomUI(): void {
    this.renderEditorUi();
  }

  fitToScreen(): void {
    this.interactionController.fitToScreen();
  }

  zoomIn(): void {
    this.interactionController.zoomIn();
  }

  zoomOut(): void {
    this.interactionController.zoomOut();
  }

  // ══════════════════════════════════════
  // INPUT
  // ══════════════════════════════════════

  private setupInput(): void {
    this.interactionController.setupInput(this.handleCanvasContextMenu);
  }

  private setupKeyboard(): void {
    this.interactionController.setupKeyboard();
  }

  // ══════════════════════════════════════
  // OBJECT PLACEMENT
  // ══════════════════════════════════════

  private handleObjectModePrimaryAction(pointer: Phaser.Input.Pointer): boolean {
    return this.inspectorController.handleObjectModePrimaryAction(pointer);
  }

  private handleObjectModeSecondaryAction(worldX: number, worldY: number): boolean {
    return this.inspectorController.handleObjectModeSecondaryAction(worldX, worldY);
  }

  private handleObjectPlace(pointer: Phaser.Input.Pointer): void {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const tileX = Math.floor(worldPoint.x / TILE_SIZE);
    const tileY = Math.floor(worldPoint.y / TILE_SIZE);
    const placed = this.editRuntime.handleObjectPlace(worldPoint.x, worldPoint.y, tileX, tileY);
    this.inspectorController.handleObjectPlaced(placed);
  }

  private removeObjectAt(worldX: number, worldY: number): void {
    const removed = this.editRuntime.removeObjectAt(worldX, worldY);
    this.inspectorController.handleObjectRemoved(removed);
  }

  rebuildObjectSprites(): void {
    this.editRuntime.rebuildObjectSprites();
    this.inspectorController.handleObjectSpritesRebuilt();
  }

  useCustomSpriteAsTile(sprite: CustomSpriteDefinition): boolean {
    if (!this.roomPermissions.canSaveDraft) {
      this.updatePersistenceStatus('Minted room is read-only for non-owners.');
      return false;
    }

    const result = this.editRuntime.useCustomSpriteAsTile(sprite);
    if (!result) {
      this.updatePersistenceStatus('Only 16x16 solid or decoration sprites can be used as tiles.');
      return false;
    }

    this.inspectorController.reset();
    this.renderEditorUi();
    this.updateToolUi();
    this.updateLightingPreview();
    this.presenceController.markConstructionPreviewDirty();
    this.updatePersistenceStatus('Saved as tile. Click in the room to paint it.');
    return true;
  }

  beginFocusedPressurePlateConnection(): void {
    this.inspectorController.beginFocusedPressurePlateConnection();
  }

  clearFocusedPressurePlateConnection(): void {
    this.inspectorController.clearFocusedPressurePlateConnection();
  }

  cancelPressurePlateConnection(): void {
    this.inspectorController.cancelPressurePlateConnection();
  }

  clearFocusedContainerContents(): void {
    this.inspectorController.clearFocusedContainerContents();
  }

  setPlacedSignText(instanceId: string, text: string | null): boolean {
    const updated = this.editRuntime.setSignText(instanceId, text);
    if (updated) {
      this.renderEditorUi();
    }
    return updated;
  }

  setGoalType(nextType: RoomGoalType | null): void {
    this.toolController.setGoalType(nextType);
  }

  setGoalTimeLimitSeconds(seconds: number | null): void {
    this.toolController.setGoalTimeLimitSeconds(seconds);
  }

  setGoalRequiredCount(requiredCount: number): void {
    this.toolController.setGoalRequiredCount(requiredCount);
  }

  setGoalSurvivalSeconds(seconds: number): void {
    this.toolController.setGoalSurvivalSeconds(seconds);
  }

  startGoalMarkerPlacement(mode: EditorMarkerPlacementMode): void {
    this.toolController.startGoalMarkerPlacement(mode);
  }

  clearGoalMarkers(): void {
    this.toolController.clearGoalMarkers();
  }

  setCourseGoalType(goalType: CourseGoalType | null): void {
    this.courseController.setCourseGoalType(goalType);
  }

  setCourseGoalTimeLimitSeconds(seconds: number | null): void {
    this.courseController.setCourseGoalTimeLimitSeconds(seconds);
  }

  setCourseGoalRequiredCount(requiredCount: number): void {
    this.courseController.setCourseGoalRequiredCount(requiredCount);
  }

  setCourseGoalSurvivalSeconds(seconds: number): void {
    this.courseController.setCourseGoalSurvivalSeconds(seconds);
  }

  startCourseGoalMarkerPlacement(mode: EditorMarkerPlacementMode): void {
    this.courseController.startCourseGoalMarkerPlacement(mode);
  }

  clearCourseGoalMarkers(): void {
    this.courseController.clearCourseGoalMarkers();
  }

  getGoalEditorState(): {
    goal: RoomGoal | null;
    placementMode: GoalPlacementMode;
    availableCollectibles: number;
    availableEnemies: number;
  } {
    return this.toolController.getGoalEditorState();
  }

  private getSelectedCoursePreviewForPlay(): CourseSnapshot | null {
    return this.courseController.getSelectedCoursePreviewForPlay();
  }

  private placeGoalMarker(tileX: number, tileY: number): void {
    if (this.courseController.placeGoalMarker(tileX, tileY)) {
      return;
    }

    this.editRuntime.placeGoalMarker(tileX, tileY);
  }

  private removeGoalMarkerAt(worldX: number, worldY: number): boolean {
    if (this.courseController.removeGoalMarkerAt(worldX, worldY)) {
      return true;
    }

    return this.editRuntime.removeGoalMarkerAt(worldX, worldY);
  }

  private updateGoalUi(): void {
    this.chromeController.refreshGoalUi();
  }

  private hideObjectInspectorUi(): void {
    this.inspectorController.hideTransientUi();
    this.overlayController.clearObjectInspectorOverlays();
  }

  // ══════════════════════════════════════
  // PLAY MODE
  // ══════════════════════════════════════

  async startPlayMode(): Promise<void> {
    if (this.musicPreviewState !== 'stopped') {
      this.stopRoomMusicPreview();
    }
    await this.flowController.startPlayMode();
  }

  async handlePublishNudgeAction(): Promise<void> {
    await this.flowController.handlePublishNudgeAction();
  }

  updateToolUi(): void {
    this.toolController.updateToolUi();
  }

  private updateBottomBar(): void {
    this.chromeController.refreshBottomBar();
  }

  private renderEditorUi(): void {
    this.chromeController.render();
    this.renderMusicUi();
  }

  // ── Public API for UI ──

  getMap(): Phaser.Tilemaps.Tilemap {
    return this.map;
  }

  setRoomTitle(nextTitle: string | null): void {
    this.persistenceController.setRoomTitle(nextTitle);
  }

  getLayers(): Map<string, Phaser.Tilemaps.TilemapLayer> {
    return this.layers;
  }

  getHistoryState(): {
    roomId: string;
    claimerDisplayName: string | null;
    claimedAt: string | null;
    canRevert: boolean;
    canPublish: boolean;
    canMint: boolean;
    canRefreshMintMetadata: boolean;
    canonicalVersion: number | null;
    mintedTokenId: string | null;
    mintedOwnerWalletAddress: string | null;
    mintedMetadataRoomVersion: number | null;
    mintedMetadataUpdatedAt: string | null;
    mintedMetadataCurrent: boolean;
    versions: RoomVersionRecord[];
  } {
    return this.persistenceController.getHistoryState();
  }

  loadHistory(): Promise<void> {
    return this.persistenceController.loadHistory();
  }

  async returnToWorld(): Promise<void> {
    if (this.musicPreviewState !== 'stopped') {
      this.stopRoomMusicPreview();
    }
    await this.flowController.returnToWorld();
  }

  async returnToCourseBuilder(): Promise<void> {
    await this.flowController.returnToCourseBuilder();
  }

  private async handleEditorBackAction(): Promise<void> {
    await this.flowController.handleEditorBackAction();
  }

  private shouldReturnToCourseEditor(): boolean {
    return Boolean(
      this.buildCourseEditedRoomData() &&
        (this.scene.isSleeping('CourseComposerScene') ||
          this.scene.isPaused('CourseComposerScene') ||
          this.scene.isActive('CourseComposerScene'))
    );
  }

  private buildCourseEditorWakeData(wakeData: OverworldPlaySceneData): CourseEditorSceneData {
    const courseEdit = this.buildCourseEditedRoomData();
    return {
      courseId: courseEdit?.courseId ?? null,
      selectedCoordinates: { ...this.roomCoordinates },
      centerCoordinates: { ...(wakeData.centerCoordinates ?? this.roomCoordinates) },
      statusMessage: wakeData.statusMessage ?? null,
      courseEditedRoom: this.buildCourseEditedRoomData(),
      draftRoom: wakeData.draftRoom ?? null,
      publishedRoom: wakeData.publishedRoom ?? null,
      clearDraftRoomId: wakeData.clearDraftRoomId ?? null,
      invalidateRoomId: wakeData.invalidateRoomId ?? null,
    };
  }

  async mintRoom(): Promise<RoomRecord | null> {
    return this.persistenceController.mintRoom();
  }

  async refreshMintMetadata(): Promise<RoomRecord | null> {
    return this.persistenceController.refreshMintMetadata();
  }

  async setCanonicalVersion(targetVersion: number): Promise<RoomRecord | null> {
    return this.persistenceController.setCanonicalVersion(targetVersion);
  }

  async setLeaderboardSourceVersion(
    targetVersion: number,
    sourceVersion: number | null
  ): Promise<RoomRecord | null> {
    return this.persistenceController.setLeaderboardSourceVersion(targetVersion, sourceVersion);
  }

  undoAction(): void {
    this.toolController.undo();
    this.updateBottomBar();
  }

  redoAction(): void {
    this.toolController.redo();
    this.updateBottomBar();
  }

  setMusicModeActive(active: boolean): void {
    this.musicWorkflow.setMusicModeActive(active);
  }

  toggleMusicMode(): void {
    this.musicWorkflow.toggleMusicMode();
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

  private stopRoomMusicPreview(): void {
    this.musicWorkflow.stopRoomMusicPreview();
  }

  private syncRoomMusicPreviewPlayback(): void {
    this.musicWorkflow.syncRoomMusicPreviewPlayback();
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

  private updateMusicCursorHighlight(graphics: Phaser.GameObjects.Graphics): boolean {
    return this.musicWorkflow.updateMusicCursorHighlight(graphics);
  }

  private renderMusicUi(): void {
    this.musicWorkflow.renderUi();
  }

  describeState(): Record<string, unknown> {
    return {
      scene: 'editor',
      roomId: this.roomId,
      coordinates: { ...this.roomCoordinates },
      source: this.entrySource,
      roomVersion: this.roomVersion,
      publishedVersion: this.publishedVersion,
      versionHistoryCount: this.roomVersionHistory.length,
      roomDirty: this.roomDirty,
      claimerDisplayName: this.claimerDisplayName,
      mintedChainId: this.mintedChainId,
      mintedContractAddress: this.mintedContractAddress,
      mintedTokenId: this.mintedTokenId,
      mintedOwnerWalletAddress: this.mintedOwnerWalletAddress,
      mintedOwnerSyncedAt: this.mintedOwnerSyncedAt,
      canSaveDraft: this.roomPermissions.canSaveDraft,
      canPublish: this.roomPermissions.canPublish,
      canRevert: this.roomPermissions.canRevert,
      canMint: this.roomPermissions.canMint,
      background: editorState.selectedBackground,
      goal: cloneRoomGoal(this.roomGoal),
      goalPlacementMode: this.goalPlacementMode,
      courseEdit: this.buildCourseEditedRoomData(),
      spawnPoint: this.roomSpawnPoint ? { ...this.roomSpawnPoint } : null,
      backgroundLayerCount: this.backgroundController.backgroundLayerCount,
      hasBackgroundCamera: this.backgroundController.hasBackgroundCamera,
      lighting: this.lightingController.getDebugState(),
      weather: this.weatherController.getDebugState(),
      activeTool: editorState.activeTool,
      selectedLayer: editorState.activeLayer,
      zoom: editorState.zoom,
      camera: {
        scrollX: Math.round(this.cameras.main.scrollX),
        scrollY: Math.round(this.cameras.main.scrollY),
      },
      placedObjects: editorState.placedObjects.length,
      canUndo: this.editRuntime.hasUndoHistory(),
      canRedo: this.editRuntime.hasRedoHistory(),
      isPlaying: editorState.isPlaying,
    };
  }
}
