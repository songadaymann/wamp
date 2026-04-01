import Phaser from 'phaser';
import {
  TILE_SIZE,
  ROOM_WIDTH,
  ROOM_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_PX_HEIGHT,
  LAYER_NAMES,
  TILESETS,
  editorState,
  resetEditorPaletteSelection,
} from '../config';
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
import { isTextInputFocused } from '../ui/keyboardFocus';
import type {
  CourseEditorSceneData,
  CourseEditedRoomData,
  EditorCourseEditData,
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
import { EditorPresenceController } from './editor/presence';
import { EditorPersistenceController } from './editor/persistence';
import { EditorToolController } from './editor/tools';
import { EditorCourseController } from './editor/courseController';
import { EditorOverlayController } from './editor/overlays';
import { EditorChromeController } from './editor/chrome';
import { RoomLightingController } from '../lighting/controller';
import type { EditorCourseUiState } from '../ui/setup/sceneBridge';

const EDITOR_NEIGHBOR_RADIUS = 1;
type EditorMarkerPlacementMode = Exclude<GoalPlacementMode, null> | 'start';

export class EditorScene extends Phaser.Scene {
  private uiBridge: EditorUiBridge | null = null;
  private roomEditCount = 0;

  // Tilemap
  private map!: Phaser.Tilemaps.Tilemap;
  private tilesets: Map<string, Phaser.Tilemaps.Tileset> = new Map();
  private layers: Map<string, Phaser.Tilemaps.TilemapLayer> = new Map();

  // Single-room persistence (local-first, ready for a remote adapter later)
  private readonly editRuntime: EditorEditRuntime;
  private readonly roomSession: EditorRoomSession;
  private readonly worldRepository = createWorldRepository();
  private readonly backgroundController: EditorBackgroundController;
  private readonly courseController: EditorCourseController;
  private readonly flowController: EditorSceneFlowController;
  private readonly inspectorController: EditorInspectorController;
  private readonly interactionController: EditorInteractionController;
  private readonly overlayController: EditorOverlayController;
  private readonly presenceController: EditorPresenceController;
  private readonly persistenceController: EditorPersistenceController;
  private readonly toolController: EditorToolController;
  private readonly chromeController: EditorChromeController;
  private readonly lightingController: RoomLightingController;
  private entrySource: 'world' | 'direct' = 'direct';
  private initialRoomSnapshot: RoomSnapshot | null = null;
  private readonly handleWake = (): void => {
    setAppMode('editor');
    editorState.isPlaying = false;
    this.presenceController.sync();
    this.updateBottomBar();
    this.updateGoalUi();
  };
  private readonly handleCanvasContextMenu = (event: Event): void => {
    event.preventDefault();
  };
  private readonly handleResize = (): void => {
    this.centerCameraOnRoom();
    this.updateBackgroundPreview();
    this.updateZoomUI();
  };
  private readonly handleDocumentKeyDown = (event: KeyboardEvent): void => {
    if (!this.scene.isActive(this.scene.key) || editorState.isPlaying || isTextInputFocused()) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === 'escape') {
      event.preventDefault();
      event.stopPropagation();
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

    const primaryModifier = event.metaKey || event.ctrlKey;
    if (primaryModifier && key === 's') {
      event.preventDefault();
      event.stopPropagation();
      void this.saveDraft(true, { promptForSignInOnUnauthorized: true });
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

    if (primaryModifier && key === 'z') {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) {
        this.toolController.redo();
      } else {
        this.toolController.undo();
      }
      return;
    }

    if (event.ctrlKey && !event.metaKey && key === 'y') {
      event.preventDefault();
      event.stopPropagation();
      this.toolController.redo();
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
    }
  };
  private readonly handleShutdown = (): void => {
    this.events.off('wake', this.handleWake, this);
    this.scale.off('resize', this.handleResize, this);
    this.input.removeAllListeners();
    this.input.keyboard?.removeAllListeners();
    this.game.canvas.removeEventListener('contextmenu', this.handleCanvasContextMenu);
    this.inspectorController.reset();
    this.uiBridge?.destroy();
    this.uiBridge = null;
    this.presenceController.destroy();
    this.resetRuntimeState();
  };

  constructor() {
    super({ key: 'EditorScene' });
    this.editRuntime = new EditorEditRuntime(this, {
      getLayers: () => this.layers,
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
      },
      getSelectedLightingMode: () => editorState.selectedLightingMode,
      setSelectedLightingMode: (mode) => {
        editorState.selectedLightingMode = mode;
      },
      getPlacedObjects: () => editorState.placedObjects,
      setPlacedObjects: (placedObjects) => {
        editorState.placedObjects = placedObjects;
      },
      updateBackgroundSelectValue: () => {},
      updateLightingSelectValue: (mode) => {
        const lightingSelect = document.getElementById(
          'lighting-mode-select'
        ) as HTMLSelectElement | null;
        if (lightingSelect) {
          lightingSelect.value = mode;
        }
      },
      updateBackground: () => this.updateBackground(),
      updateGoalUi: () => this.updateGoalUi(),
      syncBackgroundCameraIgnores: () => this.syncBackgroundCameraIgnores(),
      updatePersistenceStatus: (text) => this.updatePersistenceStatus(text),
      canSaveDraft: () => this.roomPermissions.canSaveDraft,
    });
    this.roomSession = new EditorRoomSession(createRoomRepository(), {
      applyRoomSnapshot: (room) => {
        this.applyRoomSnapshot(room);
      },
      exportRoomSnapshot: () => this.exportRoomSnapshot(),
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
      saveDraft: (force = false) => this.persistenceController.saveDraft(force),
      exportRoomSnapshot: () => this.exportRoomSnapshot(),
      getRoomDirty: () => this.roomDirty,
      getPublishedVersion: () => this.publishedVersion,
      getRoomCoordinates: () => ({ ...this.roomCoordinates }),
      buildCourseEditedRoomData: () => this.buildCourseEditedRoomData(),
      syncActiveCourseRoomSessionSnapshot: (room, options) => {
        this.syncActiveCourseRoomSessionSnapshot(room, options);
      },
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
      publishRoom: () => this.persistenceController.publishRoom(),
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
        getEntrySource: () => this.entrySource,
        getCourseEditorState: () => this.courseController.getCourseEditorState(),
        getSaveInFlight: () => this.saveInFlight,
      },
    );
    this.presenceController = new EditorPresenceController({
      getRoomCoordinates: () => ({ ...this.roomCoordinates }),
      isPlaying: () => editorState.isPlaying,
      isSceneActive: () => this.scene.isActive(this.scene.key),
    });
    this.interactionController = new EditorInteractionController(this, {
      getNeighborRadius: () => EDITOR_NEIGHBOR_RADIUS,
      getGoalPlacementMode: () => this.goalPlacementMode as GoalPlacementMode,
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

        return ignored;
      },
      isSceneActive: () => this.scene.isActive(this.scene.key),
    });
    this.lightingController = new RoomLightingController({
      scene: this,
      overlayDepth: 80,
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

  private getAdjacentCourseEdit(offset: -1 | 1): EditorCourseEditData | null {
    return null;
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
        await this.persistenceController.saveDraft(true, { promptForSignInOnUnauthorized: true });
      },
      onPublishRoom: async () => {
        await this.persistenceController.publishRoom();
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
      onSelectBackground: () => this.applySelectedBackground(),
      onSelectLighting: (mode) => this.applySelectedLighting(mode),
      onSetGoalType: (nextType) => this.toolController.setGoalType(nextType),
      onSetGoalTimeLimitSeconds: (seconds) => this.toolController.setGoalTimeLimitSeconds(seconds),
      onSetGoalRequiredCount: (requiredCount) => this.toolController.setGoalRequiredCount(requiredCount),
      onSetGoalSurvivalSeconds: (seconds) => this.toolController.setGoalSurvivalSeconds(seconds),
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
    });

    this.createBackground();
    this.createTilemap();
    this.createCursorOverlay();
    this.overlayController.createOverlays();
    this.setupCamera();
    this.setupInput();
    this.setupKeyboard();
    this.rebuildObjectSprites();
    this.syncBackgroundCameraIgnores();
    this.updateBackgroundPreview();
    this.updateLightingPreview();

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
    this.updateCursorHighlight();
    this.overlayController.updateLayerGuideOverlay();
    this.overlayController.updatePressurePlateOverlay((graphics) => {
      this.inspectorController.updatePressurePlateOverlay(graphics);
    });
    this.overlayController.updateContainerOverlay((graphics) => {
      this.inspectorController.updateContainerOverlay(graphics);
    });
    this.overlayController.updateLayerIndicator();
  }

  // ══════════════════════════════════════
  // BACKGROUND
  // ══════════════════════════════════════

  private createBackground(): void {
    this.backgroundController.createBackground(editorState.selectedBackground);
  }

  private resetRuntimeState(): void {
    this.lightingController.reset();
    this.backgroundController.reset();
    this.interactionController.reset();
    this.overlayController.reset();
    this.tilesets = new Map();
    this.layers = new Map();
    this.editRuntime.reset();
    this.flowController.reset();
    this.inspectorController.reset();
    this.courseController.reset();
    this.roomSession.reset();
    this.toolController.reset();
    this.roomEditCount = 0;
    resetEditorPaletteSelection();
    editorState.tileFlipX = false;
    editorState.tileFlipY = false;
    editorState.selectedLightingMode = 'off';
    editorState.isPlaying = false;
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

  private applySelectedLighting(mode: RoomSnapshot['lighting']['mode']): void {
    editorState.selectedLightingMode = mode;
    this.updateLightingPreview();
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
    const emitter = this.roomSpawnPoint
      ? {
          x: this.roomSpawnPoint.x,
          y: this.roomSpawnPoint.y,
        }
      : {
          x: ROOM_PX_WIDTH * 0.5,
          y: ROOM_PX_HEIGHT * 0.5,
        };
    const structureChanged = this.lightingController.sync({
      roomId: this.roomId,
      bounds: {
        x: 0,
        y: 0,
        width: ROOM_PX_WIDTH,
        height: ROOM_PX_HEIGHT,
      },
      lighting: {
        mode: editorState.selectedLightingMode,
      },
      emitters: [emitter],
    });

    if (structureChanged) {
      this.syncBackgroundCameraIgnores();
    }
  }

  private async refreshSurroundingRoomPreviews(): Promise<void> {
    await this.backgroundController.refreshSurroundingRoomPreviews(EDITOR_NEIGHBOR_RADIUS);
  }

  // ══════════════════════════════════════
  // ROOM PERSISTENCE
  // ══════════════════════════════════════

  private async loadPersistedRoom(): Promise<void> {
    const loaded = await this.roomSession.loadPersistedRoom(this.initialRoomSnapshot);
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
    this.editRuntime.applyRoomSnapshot(room);
    this.inspectorController.reset();
    this.inspectorController.handleObjectSpritesRebuilt();
    this.toolController.reset();
    this.updateLightingPreview();
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

  async publishRoom(successText?: string): Promise<RoomRecord | null> {
    return this.persistenceController.publishRoom(successText);
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

  private centerCameraOnRoom(): void {
    this.interactionController.centerCameraOnRoom();
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

  // ══════════════════════════════════════
  // PLAY MODE
  // ══════════════════════════════════════

  async startPlayMode(): Promise<void> {
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

  async returnToWorld(): Promise<void> {
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
